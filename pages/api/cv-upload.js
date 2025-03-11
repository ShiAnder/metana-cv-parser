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

    // Extract text from the file
    let extractedText = '';
    try {
      console.log('Extracting text from the uploaded file...');
      extractedText = await extractText(fileBuffer, file.mimetype);
      console.log('Text extracted successfully');
    } catch (extractError) {
      console.error('Error extracting text:', extractError);
      extractedText = 'Failed to extract text from the file';
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

    // Save file metadata to Google Sheets
    try {
      const sheetData = {
        cvUrl,
        filename: file.originalFilename,
        mimeType: file.mimetype,
        size: file.size,
        uploadDate: new Date().toISOString(),
        email: fields.email ? fields.email[0] : '',
        name: fields.name ? fields.name[0] : '',
        phone: fields.phone ? fields.phone[0] : '',
        extractedText
      };

      console.log('Saving data to Google Sheets...');
      await saveToSheet(sheetData);
      console.log('Successfully saved to Google Sheets');
    } catch (sheetError) {
      console.error('Error saving to Google Sheets:', sheetError);
      // Continue the process even if saving to sheet fails
      // We already have the file uploaded to GCS
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
  console.log(`Starting Google Cloud Storage upload for ${filename} (${mimeType})`);
  
  try {
    // Get credentials from environment variables
    const projectId = process.env.GOOGLE_PROJECT_ID;
    const bucketName = process.env.GOOGLE_STORAGE_BUCKET;
    
    if (!projectId || !bucketName) {
      console.error('Missing required GCS environment variables');
      throw new Error('Missing required GCS environment variables');
    }
    
    console.log(`Using GCS project: ${projectId}, bucket: ${bucketName}`);
    
    // Create GCS credentials object
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    
    if (!privateKey || !clientEmail) {
      console.error('Missing required Google authentication environment variables');
      throw new Error('Missing required Google authentication environment variables');
    }
    
    // Clean and format the private key
    console.log('Processing private key for GCS...');
    
    // Fix escaped newlines
    if (privateKey.includes('\\n')) {
      console.log('Replacing escaped newlines in GCS key');
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    
    // Remove surrounding quotes if present
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      console.log('Removing surrounding quotes from GCS key');
      privateKey = privateKey.slice(1, -1);
    }
    
    // Create storage client with multiple fallback methods
    let storage;
    
    try {
      console.log('Strategy 1: Direct credentials object');
      storage = new Storage({
        projectId,
        credentials: {
          client_email: clientEmail,
          private_key: privateKey
        }
      });
    } catch (err) {
      console.error('Strategy 1 failed:', err);
      
      try {
        console.log('Strategy 2: Automatic authentication');
        storage = new Storage({projectId});
      } catch (err2) {
        console.error('Strategy 2 failed:', err2);
        throw new Error('Failed to initialize Google Cloud Storage');
      }
    }
    
    // Create a unique filename to avoid collisions
    const uniqueFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    
    // Upload the file buffer
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(uniqueFilename);
    
    console.log(`Uploading to ${bucketName}/${uniqueFilename}`);
    
    // Upload using the buffer
    await file.save(buffer, {
      contentType: mimeType,
      metadata: {
        contentType: mimeType,
      },
    });
    
    console.log('File uploaded to Google Cloud Storage successfully');
    
    // Make the file publicly accessible
    await file.makePublic();
    
    // Get the public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${uniqueFilename}`;
    console.log(`File public URL: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error('Error uploading to Google Cloud Storage:', error);
    throw error;
  }
} 