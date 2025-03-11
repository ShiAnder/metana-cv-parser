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
    const storageConfig = JSON.parse(process.env.GCS_CREDENTIALS);
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
    // Configure formidable to keep files in memory as buffers
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
      multiples: false,
      // In Vercel, don't specify uploadDir as we're keeping files in memory
      fileWriteStreamHandler: () => {
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
      },
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        return reject(err);
      }
      
      resolve({ fields, files });
    });
  });
}

// Main handler function for file upload
export default async function handler(req, res) {
  // Cross-origin headers for the API
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST for actual uploads
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      message: 'Only POST requests are allowed'
    });
  }

  try {
    console.log('Processing upload request...');
    
    // Parse the form data
    const { fields, files } = await parseForm(req);
    
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
    const fileBuffer = uploadedFile.filepath.getBuffer();
    
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
