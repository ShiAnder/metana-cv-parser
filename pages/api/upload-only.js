import busboy from 'busboy';
import { Storage } from '@google-cloud/storage';

// Required for Next.js API routes
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  console.log('Upload-only API called with method:', req.method);

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
    console.log('Processing POST request in upload-only');
    
    // Parse the form data
    const { fileInfo, fileBuffer, fields } = await parseFormWithBusboy(req);
    
    if (!fileInfo || !fileBuffer) {
      return res.status(400).json({
        success: false,
        error: 'Missing file',
        message: 'No file was uploaded or the file content could not be read'
      });
    }
    
    // Just upload to Google Cloud Storage - nothing else
    try {
      console.log('Attempting GCS upload of file:', fileInfo.name);
      
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
      const sanitizedFilename = `${Date.now()}-${fileInfo.name.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
      const file = bucket.file(sanitizedFilename);

      // Upload buffer
      await file.save(fileBuffer, {
        metadata: {
          contentType: fileInfo.type,
          cacheControl: 'public, max-age=31536000',
        },
      });

      const fileUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${sanitizedFilename}`;
      console.log('File uploaded to GCS:', fileUrl);
      
      // Return success with URL
      return res.status(200).json({
        success: true,
        message: 'File uploaded to storage',
        fileUrl: fileUrl,
        fileInfo: fileInfo
      });
      
    } catch (uploadError) {
      console.error('GCS upload error:', uploadError);
      return res.status(500).json({
        success: false,
        error: 'Storage upload error',
        message: uploadError.message || 'Failed to upload file to storage'
      });
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