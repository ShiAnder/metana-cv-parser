import busboy from 'busboy';
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

export default async function handler(req, res) {
  console.log('Direct upload API called with method:', req.method);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight');
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
    console.log('Processing POST request in direct-upload');
    console.log('Request headers:', req.headers);
    
    // Use busboy for multipart parsing - this is fast
    const { fileInfo, fileBuffer, fields } = await parseFormWithBusboy(req);
    
    if (!fileInfo || !fileBuffer) {
      return res.status(400).json({
        success: false,
        error: 'Missing file',
        message: 'No file was uploaded or the file content could not be read'
      });
    }
    
    console.log('File parsed successfully:', fileInfo);
    
    // IMPORTANT CHANGE: Return a success response immediately
    // This prevents the Vercel function timeout
    res.status(200).json({
      success: true,
      message: 'File received, processing in background',
      fileInfo: fileInfo,
      fields: fields,
      processing: 'async'
    });
    
    // Process the file in the background *after* response is sent
    // Note: This isn't ideal as Vercel may still terminate the function
    // but it gives us a better chance of completing some of the work
    try {
      console.log('Starting background processing');
      
      // Extract text from the file
      const text = await extractText(fileBuffer, fileInfo.type);
      console.log('Text extracted successfully, length:', text.length);
      
      // Upload to Google Cloud Storage
      let cvUrl = null;
      try {
        cvUrl = await uploadToGCS(fileBuffer, fileInfo.name, fileInfo.type);
        console.log('File uploaded to GCS:', cvUrl);
      } catch (uploadError) {
        console.warn('GCS upload failed:', uploadError);
      }
      
      // Prepare data for processing
      const parsedData = {
        content: text,
        cvUrl: cvUrl || 'N/A',
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        filename: fileInfo.name
      };
      
      // Save to Google Sheets
      try {
        await saveToSheet(parsedData);
        console.log('Data saved to sheet');
      } catch (sheetError) {
        console.error('Sheet error:', sheetError);
      }
      
      // Send email
      try {
        await sendConfirmationEmail(fields.name, fields.email, fileInfo.name);
        console.log('Email sent');
      } catch (emailError) {
        console.error('Email error:', emailError);
      }
      
      console.log('Background processing completed successfully');
    } catch (processingError) {
      // Log errors but don't affect the response
      console.error('Background processing error:', processingError);
    }
    
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
}

// Parse form data with busboy
function parseFormWithBusboy(req) {
  return new Promise((resolve, reject) => {
    let fileInfo = null;
    let fileBuffer = null;
    let fields = {};
    const fileBufferChunks = [];
    
    // Initialize busboy with request headers
    const bb = busboy({ 
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
    });
    
    // Handle file parts
    bb.on('file', (name, file, info) => {
      const { filename, encoding, mimeType } = info;
      console.log(`File [${name}]: filename: ${filename}, encoding: ${encoding}, mimeType: ${mimeType}`);
      
      // Collect file data chunks
      file.on('data', (data) => {
        fileBufferChunks.push(data);
        console.log(`File chunk received: ${data.length} bytes`);
      });
      
      file.on('end', () => {
        // Combine chunks into a single buffer
        fileBuffer = Buffer.concat(fileBufferChunks);
        console.log(`File [${name}] done, total size: ${fileBuffer.length} bytes`);
        
        fileInfo = {
          name: filename,
          type: mimeType,
          size: fileBuffer.length
        };
      });
    });
    
    // Handle regular form fields
    bb.on('field', (name, val) => {
      console.log(`Field [${name}]: value: ${val}`);
      fields[name] = val;
    });
    
    // Handle parsing completion
    bb.on('finish', () => {
      console.log('Busboy parsing finished');
      resolve({ fileInfo, fileBuffer, fields });
    });
    
    // Handle errors
    bb.on('error', (err) => {
      console.error('Busboy error:', err);
      reject(err);
    });
    
    // Pipe the request into busboy
    req.pipe(bb);
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
  try {
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

    console.log(`File uploaded to GCS bucket: ${process.env.GCS_BUCKET_NAME}, filename: ${sanitizedFilename}`);
    return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${sanitizedFilename}`;
  } catch (error) {
    console.error('Error in GCS upload:', error);
    throw error;
  }
} 