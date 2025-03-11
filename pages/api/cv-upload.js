import { IncomingForm } from 'formidable';
import { Storage } from '@google-cloud/storage';
import saveToSheet from '../../lib/cvParser';
import sendConfirmationEmail from '../../lib/emailSender';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// Required for Next.js API routes
export const config = {
  api: {
    bodyParser: false,
  },
};

// Simple file upload handler designed specifically for Vercel
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  console.log('CV upload API called with method:', req.method);

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    console.log(`Method ${req.method} not allowed`);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed',
      message: 'Only POST is allowed for this endpoint'
    });
  }

  try {
    console.log('Processing POST request for CV upload');

    // Parse form using promise wrapper
    const formData = await parseForm(req);
    
    // Get file and fields
    const file = formData.files.file;
    const fields = formData.fields;
    
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'Missing file',
        message: 'No file was uploaded or the field name is incorrect'
      });
    }

    console.log(`File received: ${file.originalFilename} (${file.mimetype})`);

    // Get file content as buffer
    let fileBuffer;
    console.log('File object properties:', Object.keys(file));
    
    if (file.filepath) {
      // For local dev environment
      const fs = require('fs');
      fileBuffer = fs.readFileSync(file.filepath);
      console.log('Read file from filepath:', file.filepath);
    } else if (file.buffer) {
      // For some Vercel environments
      fileBuffer = file.buffer;
      console.log('Using buffer property');
    } else if (file.path) {
      // For other Vercel environments
      const fs = require('fs');
      fileBuffer = fs.readFileSync(file.path);
      console.log('Read file from path:', file.path);
    } else {
      console.error('No file path or buffer available:', file);
      return res.status(500).json({
        success: false,
        error: 'File processing error',
        message: 'Unable to access file content'
      });
    }
    
    console.log('File buffer obtained, size:', fileBuffer.length);

    // Extract text based on mimetype
    let text;
    try {
      text = await extractText(fileBuffer, file.mimetype);
    } catch (error) {
      console.error('Text extraction error:', error);
      return res.status(400).json({
        success: false,
        error: 'Text extraction failed',
        message: error.message
      });
    }

    // Upload to Google Cloud Storage if possible
    let cvUrl = null;
    try {
      cvUrl = await uploadToGCS(fileBuffer, file.originalFilename, file.mimetype);
    } catch (uploadError) {
      console.warn('GCS upload failed, continuing without it:', uploadError);
      // Continue without GCS upload
    }

    // Prepare data for processing
    const parsedData = {
      content: text,
      cvUrl: cvUrl || 'N/A',
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      filename: file.originalFilename
    };

    // Save to Google Sheets
    try {
      await saveToSheet(parsedData);
      console.log('Data saved to sheet');
    } catch (sheetError) {
      console.error('Sheet error:', sheetError);
      // Continue even if sheet fails
    }

    // Send email
    try {
      await sendConfirmationEmail(fields.name, fields.email, file.originalFilename);
      console.log('Email sent');
    } catch (emailError) {
      console.error('Email error:', emailError);
      // Continue even if email fails
    }

    // Return success
    return res.status(200).json({
      success: true,
      message: 'CV processed successfully',
      data: {
        filename: file.originalFilename,
        email: fields.email
      }
    });
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
}

// Simple form parser for Vercel
function parseForm(req) {
  return new Promise((resolve, reject) => {
    console.log('Starting form parsing');
    
    // Create formidable instance with simpler config for Vercel
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024,
      multiples: false,
      // Remove fileWriteStreamHandler to use default memory storage
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error('Form parsing error:', err);
        return reject(err);
      }
      
      console.log('Form parsed successfully:', {
        fieldKeys: Object.keys(fields),
        fileKeys: Object.keys(files),
        fileInfo: files.file ? {
          size: files.file.size,
          name: files.file.originalFilename,
          type: files.file.mimetype
        } : 'No file found'
      });
      
      resolve({ fields, files });
    });
  });
}

// Extract text based on mimetype
async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  } 
  
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const data = await mammoth.extractRawText({ buffer });
    return data.value;
  }
  
  if (mimeType === 'text/plain') {
    return buffer.toString('utf8');
  }
  
  throw new Error(`Unsupported file type: ${mimeType}`);
}

// Upload to Google Cloud Storage
async function uploadToGCS(buffer, filename, mimeType) {
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

  // Upload buffer
  await file.save(buffer, {
    metadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000',
    },
  });

  return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${sanitizedFilename}`;
} 