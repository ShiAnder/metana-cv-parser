import { IncomingForm } from 'formidable';
import { Storage } from '@google-cloud/storage';
import saveToSheet from '../../lib/cvParser';
import sendConfirmationEmail from '../../lib/emailSender';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// Vercel has a body size limit of 4.5MB
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

// Function to extract text from PDF buffer
async function extractTextFromPDF(buffer) {
  try {
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

// Function to extract text from DOCX buffer
async function extractTextFromDOCX(buffer) {
  try {
    const docxData = await mammoth.extractRawText({ buffer });
    return docxData.value;
  } catch (error) {
    console.error('Error extracting text from DOCX:', error);
    throw new Error(`Failed to extract text from DOCX: ${error.message}`);
  }
}

// Function to extract text based on mime type
async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    return extractTextFromPDF(buffer);
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractTextFromDOCX(buffer);
  } else if (mimeType === 'text/plain') {
    return buffer.toString('utf8');
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}

// Function to upload buffer to Google Cloud Storage
async function uploadToGCS(buffer, filename, mimeType) {
  try {
    console.log('Uploading to Google Cloud Storage...');
    
    // Initialize storage with credentials from environment variable
    let storageConfig;
    try {
      const credentials = process.env.GCS_CREDENTIALS;
      if (!credentials) {
        throw new Error('GCS_CREDENTIALS environment variable is missing');
      }
      
      // Handle already parsed JSON object (happens in some environments)
      if (typeof credentials === 'object') {
        storageConfig = credentials;
      } else {
        // Safely parse JSON string
        storageConfig = JSON.parse(credentials);
      }
    } catch (parseError) {
      console.error('Error parsing GCS credentials:', parseError);
      throw new Error(`Failed to parse GCS credentials: ${parseError.message}`);
    }
    
    const storage = new Storage({
      projectId: storageConfig.project_id,
      credentials: {
        client_email: storageConfig.client_email,
        private_key: storageConfig.private_key,
      },
    });

    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
    const sanitizedFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    const file = bucket.file(sanitizedFilename);

    // Upload buffer directly
    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000',
      },
    });

    const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${sanitizedFilename}`;
    return publicUrl;
  } catch (error) {
    console.error('Error uploading to GCS:', error);
    return null; // Return null instead of throwing to allow the process to continue
  }
}

// Parse the multipart form data in memory
function parseForm(req) {
  return new Promise((resolve, reject) => {
    // Check if req.body already exists (for some environments)
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Request body already parsed, using existing data');
      return resolve({ 
        fields: req.body, 
        files: req.files || {} 
      });
    }

    // Configure formidable to keep files in memory as buffers
    const options = {
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      multiples: false,
    };

    // In Vercel, use memory storage
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.log('Running in Vercel/production, using in-memory file handling');
      options.fileWriteStreamHandler = () => {
        // Use a custom stream that collects chunks in memory
        const chunks = [];
        return {
          write: (chunk) => {
            chunks.push(chunk);
            return true;
          },
          end: () => {},
          destroy: () => {},
          // Store the assembled buffer on the stream object
          getBuffer: () => Buffer.concat(chunks),
        };
      };
    }

    const form = new IncomingForm(options);

    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error('Form parsing error:', err);
        return reject(err);
      }
      
      console.log('Successfully parsed form with fields:', Object.keys(fields));
      console.log('Files received:', files.file ? 'Yes' : 'No');
      
      resolve({ fields, files });
    });
  });
}

// Main handler function for file upload
export default async function handler(req, res) {
  console.log('------ API ROUTE CALLED ------');
  console.log('Request method:', req.method);
  console.log('Request headers:', JSON.stringify(req.headers));
  
  // CRITICAL: Cross-origin headers for Vercel must be set FIRST, before any logic
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // Or specify your domain
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request (preflight) immediately
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST for actual uploads
  if (req.method !== 'POST') {
    console.log(`Rejected method: ${req.method}`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      message: 'Only POST requests are allowed',
      requestMethod: req.method
    });
  }

  try {
    console.log('Processing upload request...');
    
    // Parse the form data
    let fields, files;
    try {
      const result = await parseForm(req);
      fields = result.fields;
      files = result.files;
    } catch (parseError) {
      console.error('Form parsing error:', parseError);
      return res.status(400).json({
        success: false,
        error: 'Upload failed',
        message: `Could not parse form data: ${parseError.message}`
      });
    }
    
    const uploadedFile = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : null;
    if (!uploadedFile) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
        message: 'No file was uploaded or the field name is incorrect'
      });
    }

    const mimeType = uploadedFile.mimetype;
    const originalFilename = uploadedFile.originalFilename;
    
    console.log(`File received: ${originalFilename} (${mimeType})`);

    // Check if file type is supported
    const supportedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    if (!supportedTypes.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported file format',
        message: `File type ${mimeType} is not supported. Please upload a PDF or DOCX file.`
      });
    }

    // For Vercel, we need to get the file buffer from our custom file write stream
    // This assumes you're using the fileWriteStreamHandler in the IncomingForm options
    let fileBuffer;
    if (typeof uploadedFile.filepath.getBuffer === 'function') {
      // In-memory buffer (Vercel/production)
      fileBuffer = uploadedFile.filepath.getBuffer();
    } else if (uploadedFile.buffer) {
      // Already has buffer
      fileBuffer = uploadedFile.buffer;
    } else if (typeof uploadedFile.filepath === 'string') {
      // Local file path (development only)
      try {
        const fs = require('fs');
        fileBuffer = fs.readFileSync(uploadedFile.filepath);
      } catch (readError) {
        console.error('Error reading file:', readError);
        return res.status(500).json({
          success: false,
          error: 'File read error',
          message: 'Could not read the uploaded file'
        });
      }
    } else {
      console.error('Unsupported file object structure:', Object.keys(uploadedFile));
      return res.status(500).json({
        success: false,
        error: 'Unsupported file structure',
        message: 'The uploaded file format is not supported by the server'
      });
    }
    
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Empty file',
        message: 'The uploaded file appears to be empty'
      });
    }

    // Extract text from the file buffer
    let text;
    try {
      text = await extractText(fileBuffer, mimeType);
      if (!text || text.trim() === '') {
        throw new Error('No text could be extracted from the file');
      }
    } catch (error) {
      console.error('Text extraction error:', error);
      return res.status(400).json({
        success: false,
        error: 'Text extraction failed',
        message: error.message || `Could not extract text from the file. Please ensure it's a valid file.`
      });
    }

    // Upload to Google Cloud Storage directly from buffer
    const cvUrl = await uploadToGCS(fileBuffer, originalFilename, mimeType);
    
    // Prepare data to save
    const parsedData = {
      content: text,
      cvUrl: cvUrl || 'N/A',
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      filename: originalFilename,
      isLocalFile: !cvUrl
    };

    // Save extracted data to Google Sheets
    try {
      await saveToSheet(parsedData);
      console.log("Data successfully saved to Google Sheets");
    } catch (sheetError) {
      console.error("Error saving to Google Sheets:", sheetError);
      // Continue processing even if sheet saving fails
    }

    // Send confirmation email
    try {
      await sendConfirmationEmail(fields.name, fields.email, originalFilename);
      console.log("Confirmation email sent successfully");
    } catch (emailError) {
      console.error("Error sending confirmation email:", emailError);
      // Continue processing even if email sending fails
    }

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'CV processed successfully',
      data: {
        filename: originalFilename,
        email: fields.email
      }
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
}
