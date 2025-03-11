import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import saveToSheet from '../../lib/cvParser'; // Import the updated saveToSheet function
import sendConfirmationEmail from '../../lib/emailSender'; // Import the email sender
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

// Ensure the temp directory exists
const tempDir = path.resolve('./temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

export const config = {
  api: {
    bodyParser: false, // Disable Next.js default body parsing to handle file uploads
  },
};

// Function to extract text from a file (PDF/Word)
async function extractText(filePath, mimeType) {
  try {
    console.log('Extracting text from file with mimetype:', mimeType);
    const buffer = fs.readFileSync(filePath);
    
    if (mimeType === 'application/pdf') {
      const data = await pdf(new Uint8Array(buffer));
      return data.text;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const data = await mammoth.extractRawText({ buffer });
      return data.value;
    } else if (mimeType === 'text/plain') {
      return buffer.toString('utf8');
    }
    
    throw new Error(`Unsupported file format: ${mimeType}. Only PDF and DOCX files are currently supported.`);
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error(`Failed to extract text from file: ${error.message}`);
  }
}

// Function to upload file to Google Cloud Storage
async function uploadToGCS(filePath, originalFilename) {
  try {
    console.log('Starting file upload to Google Cloud Storage...');
    
    // Initialize storage with credentials from environment variable
    const storageConfig = JSON.parse(process.env.GCS_CREDENTIALS);
    const storage = new Storage({
      projectId: storageConfig.project_id,
      credentials: {
        client_email: storageConfig.client_email,
        private_key: storageConfig.private_key,
      },
      retryOptions: {
        // Make more resilient to network issues
        maxRetries: 5,
        retryDelayMultiplier: 2.0,
        totalTimeout: 60000
      }
    });

    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
    const sanitizedFilename = `${Date.now()}-${originalFilename.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    const file = bucket.file(sanitizedFilename);

    // Upload file with proper options and add proper error handling
    try {
      // First attempt: try with stream upload
      await new Promise((resolve, reject) => {
        let hasError = false;
        
        const stream = fs.createReadStream(filePath)
          .pipe(file.createWriteStream({
            resumable: true, // Enable resumable uploads for better reliability
            validation: true,
            metadata: {
              contentType: fs.existsSync(filePath) ? 
                (originalFilename.endsWith('.pdf') ? 'application/pdf' : 
                 originalFilename.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 
                 'application/octet-stream') : 'application/octet-stream',
              cacheControl: 'public, max-age=31536000',
            },
          }));

        stream.on('error', (err) => {
          console.error('Stream error:', err);
          hasError = true;
          reject(err);
        });

        stream.on('finish', () => {
          if (!hasError) {
            console.log('File upload stream finished successfully');
            resolve();
          }
        });
      });
    } catch (streamError) {
      console.log('Stream upload failed, trying with uploadFile method...', streamError);
      
      // Second attempt: try with uploadFile method
      await file.save(fs.readFileSync(filePath), {
        resumable: false,
        metadata: {
          contentType: fs.existsSync(filePath) ? 
            (originalFilename.endsWith('.pdf') ? 'application/pdf' : 
             originalFilename.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 
             'application/octet-stream') : 'application/octet-stream',
        }
      });
    }

    console.log('File uploaded successfully to GCS');
    const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${sanitizedFilename}`;
    return publicUrl;
  } catch (error) {
    console.error('Error uploading file to GCS:', error);
    
    // Instead of throwing, return a local path or placeholder
    // This ensures the process can continue even if GCS upload fails
    console.log('Using local file path as fallback due to GCS upload failure');
    return `local://${filePath}`;
  }
}

// Main handler function for file upload
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed', 
      message: 'Only POST requests are allowed' 
    });
  }
  
  let tempFilePath;
  let newFilePath;

  try {
    const form = new IncomingForm({
      keepExtensions: true,
      uploadDir: tempDir,
      multiples: false,
    });

    // Parse the form using Promise to handle errors better
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          reject(err);
          return;
        }
        resolve([fields, files]);
      });
    });

    const uploadedFile = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : null;
    if (!uploadedFile) {
      return res.status(400).json({ 
        success: false,
        error: 'No file uploaded or incorrect field name' 
      });
    }

    const mimeType = uploadedFile.mimetype;
    console.log('Uploaded file type:', mimeType, 'File name:', uploadedFile.originalFilename);
    const originalFilename = uploadedFile.originalFilename;
    tempFilePath = uploadedFile.filepath;
    newFilePath = path.join(tempDir, originalFilename);

    // Rename file to keep original filename
    fs.renameSync(tempFilePath, newFilePath);

    // Check if file type is supported
    const supportedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!supportedTypes.includes(mimeType)) {
      try { fs.unlinkSync(newFilePath); } catch (e) { console.error('Error deleting file:', e); }
      
      return res.status(400).json({ 
        success: false,
        error: 'Unsupported file format', 
        message: `File type ${mimeType} is not supported. Please upload a PDF or DOCX file.` 
      });
    }

    // Extract text from the renamed file
    let text;
    try {
      text = await extractText(newFilePath, mimeType);
    } catch (error) {
      console.error('Text extraction error:', error);
      // Clean up the file
      try { fs.unlinkSync(newFilePath); } catch (e) { console.error('Error deleting file:', e); }
      
      return res.status(400).json({ 
        success: false,
        error: 'Text extraction failed', 
        message: `Could not extract text from the file. Please ensure it's a valid ${mimeType === 'application/pdf' ? 'PDF' : 'DOCX'} file.`
      });
    }

    if (!text) {
      // Clean up the file
      try { fs.unlinkSync(newFilePath); } catch (e) { console.error('Error deleting file:', e); }
      
      return res.status(400).json({
        success: false,
        error: 'Empty content',
        message: 'Failed to extract text from file'
      });
    }

    // Upload to Google Cloud Storage
    const cvUrl = await uploadToGCS(newFilePath, originalFilename);
    const isLocalFile = cvUrl.startsWith('local://');
    
    if (isLocalFile) {
      console.log('Using local file as fallback instead of GCS. Process will continue but CV download may not work.');
    }

    // Prepare data to save
    const parsedData = {
      content: text,
      cvUrl,
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      filename: originalFilename, // Include the filename in the data
      isLocalFile // Flag to indicate if this is a local file
    };

    // Save extracted data to Google Sheets
    try {
      await saveToSheet(parsedData);
      console.log("Data successfully saved to Google Sheets");
    } catch (sheetError) {
      console.error("Error saving to Google Sheets:", sheetError);
      // Continue with the response even if sheet saving fails
    }

    console.log("This is the parsed data in upload.js:", parsedData);

    // Send confirmation email
    try {
      await sendConfirmationEmail(fields.name, fields.email, originalFilename);
      console.log("Confirmation email sent successfully");
    } catch (emailError) {
      console.error("Error sending confirmation email:", emailError);
      // Continue with the response even if email sending fails
    }

    // Return success response with proper JSON structure
    return res.status(200).json({ 
      success: true,
      message: 'CV processed successfully',
      data: {
        filename: originalFilename,
        email: fields.email
      }
    });
  } catch (error) {
    console.error('Error processing request:', error);
    // Ensure we return a properly formatted JSON response
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error', 
      message: error.message || 'An unexpected error occurred'
    });
  } finally {
    // Clean up the temporary file regardless of success or failure
    if (newFilePath && fs.existsSync(newFilePath)) {
      try {
        fs.unlinkSync(newFilePath);
        console.log(`Cleaned up temporary file: ${newFilePath}`);
      } catch (cleanupError) {
        console.error('Error cleaning up temporary file:', cleanupError);
      }
    }
    
    // Clean up the original temp file created by formidable if it still exists
    if (tempFilePath && fs.existsSync(tempFilePath) && tempFilePath !== newFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log(`Cleaned up original temporary file: ${tempFilePath}`);
      } catch (cleanupError) {
        console.error('Error cleaning up original temporary file:', cleanupError);
      }
    }
  }
}
