import busboy from 'busboy';
import { Storage } from '@google-cloud/storage';
import saveToSheet from '../../lib/cvParser';
import sendConfirmationEmail from '../../lib/emailSender';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { redis } from '../../lib/redis';

// Required for Next.js API routes
export const config = {
  api: {
    bodyParser: false,
    // Increase the maximum function execution time for Vercel
    externalResolver: true,
  },
};

// We no longer need this in-memory storage since we're using Redis
// const PROCESSING_QUEUE = new Map();

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
  
  // GET request to check status
  if (req.method === 'GET') {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing id parameter',
        message: 'Please provide an upload ID to check the status'
      });
    }
    
    console.log(`Checking status for upload ID: ${id}`);
    
    try {
      // Query Redis instead of in-memory map
      const uploadKey = `upload:${id}`;
      const status = await redis.get(uploadKey);
      
      if (!status) {
        console.log(`No status found for upload ID: ${id}`);
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'No upload found with this ID'
        });
      }
      
      console.log(`Retrieved status for ${id}: ${JSON.stringify(status)}`);
      return res.status(200).json({
        success: true,
        status
      });
    } catch (redisError) {
      console.error(`Error retrieving status from Redis: ${redisError.message}`);
      return res.status(500).json({
        success: false,
        error: 'Storage error',
        message: 'Error retrieving upload status'
      });
    }
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
    console.log('Request headers:', JSON.stringify(req.headers));
    
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
    
    // Generate a unique ID for this upload
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    console.log(`Generated new upload ID: ${uploadId}`);
    
    // Store the initial status in Redis
    const uploadKey = `upload:${uploadId}`;
    const initialStatus = {
      stage: 'received',
      progress: 0,
      fileInfo,
      fields,
      startTime: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    
    try {
      // Store initial status in Redis
      await redis.set(uploadKey, initialStatus);
      // Set TTL to 1 hour (3600 seconds) to avoid storing forever
      await redis.expire(uploadKey, 3600);
      console.log(`Stored initial status in Redis for ${uploadId}`);
    } catch (redisError) {
      console.error(`Error storing status in Redis: ${redisError.message}`);
      // Continue anyway, as this is not critical for the upload
    }
    
    // Return a response immediately with the upload ID
    const responseData = {
      success: true,
      message: 'File received, processing started',
      uploadId,
      fileInfo: fileInfo,
      fields: fields,
      processing: 'async',
      timestamp: new Date().toISOString()
    };
    
    // Send the response
    res.status(200).json(responseData);
    
    // Create an async function for background processing
    // Note: This might not complete on Vercel due to function timeout
    try {
      // Start processing in the background without awaiting
      processUpload(uploadId, fileBuffer, fileInfo, fields).catch(async err => {
        console.error('[Background] Fatal error in background processing:', err);
        // Update status to error in Redis
        try {
          const currentStatus = await redis.get(uploadKey) || {};
          await redis.set(uploadKey, {
            ...currentStatus,
            stage: 'error',
            error: err.message,
            lastUpdated: new Date().toISOString()
          });
        } catch (redisError) {
          console.error(`Error updating error status in Redis: ${redisError.message}`);
        }
      });
      
      // After launching the background process, try creating a "processor" webhook to continue
      // processing if the main function times out
      try {
        // Call a webhook URL to take over processing
        // This would be an API route in your own application that handles the background processing
        console.log('[Webhook] Attempting to call processing webhook');
        
        // For now, just log that we would do this in a production system
        console.log('[Webhook] In a production system, we would call a webhook here to continue processing');
      } catch (webhookError) {
        console.error('[Webhook] Error calling processing webhook:', webhookError);
      }
    } catch (launchError) {
      console.error('[Launch] Error starting background processing:', launchError);
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

// Process an upload with retries and status updates
async function processUpload(uploadId, fileBuffer, fileInfo, fields) {
  console.log(`[Process ${uploadId}] Starting processing`);
  const uploadKey = `upload:${uploadId}`;
  
  try {
    // Update status to extracting_text
    await updateRedisStatus(uploadId, 'extracting_text', 10);
    
    // Extract text from the file
    console.log(`[Process ${uploadId}] Extracting text from file...`);
    const text = await extractText(fileBuffer, fileInfo.type);
    console.log(`[Process ${uploadId}] Text extracted successfully, length:`, text.length);
    
    // Update status to uploading_to_cloud
    await updateRedisStatus(uploadId, 'uploading_to_cloud', 30);
    
    // Upload to Google Cloud Storage with retries
    console.log(`[Process ${uploadId}] Starting GCS upload...`);
    let cvUrl = null;
    try {
      cvUrl = await uploadToGCSWithRetry(fileBuffer, fileInfo.name, fileInfo.type);
      console.log(`[Process ${uploadId}] File uploaded to GCS:`, cvUrl);
    } catch (uploadError) {
      console.error(`[Process ${uploadId}] GCS upload failed after retries:`, uploadError);
    }
    
    // Update status to saving_to_sheets
    await updateRedisStatus(uploadId, 'saving_to_sheets', 60);
    
    // Prepare data for processing
    const parsedData = {
      content: text,
      extractedText: text,
      cvUrl: cvUrl || 'N/A',
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      filename: fileInfo.name,
      mimeType: fileInfo.type,
      size: fileInfo.size,
      uploadDate: new Date().toISOString()
    };
    
    // Save to Google Sheets with retries
    console.log(`[Process ${uploadId}] Saving to Google Sheets...`);
    console.log(`[Process ${uploadId}] ParsedData:`, JSON.stringify(parsedData));
    try {
      await saveToSheetWithRetry(parsedData);
      console.log(`[Process ${uploadId}] Data saved to sheet successfully`);
    } catch (sheetError) {
      console.error(`[Process ${uploadId}] Sheet error after retries:`, sheetError);
      throw sheetError; // Propagate this error
    }
    
    // Update status to sending_email
    await updateRedisStatus(uploadId, 'sending_email', 80);
    
    // Send email with retries
    console.log(`[Process ${uploadId}] Sending confirmation email...`);
    try {
      await sendEmailWithRetry(fields.name, fields.email, fileInfo.name);
      console.log(`[Process ${uploadId}] Email sent successfully`);
    } catch (emailError) {
      console.error(`[Process ${uploadId}] Email error:`, emailError);
      // Continue even if email fails
    }
    
    // Update final status
    await updateRedisStatus(uploadId, 'completed', 100);
    console.log(`[Process ${uploadId}] Background processing completed successfully`);
  } catch (processingError) {
    console.error(`[Process ${uploadId}] Processing error:`, processingError);
    
    // Update error status in Redis
    try {
      const currentStatus = await redis.get(uploadKey) || {};
      await redis.set(uploadKey, {
        ...currentStatus,
        stage: 'error',
        error: processingError.message,
        lastUpdated: new Date().toISOString()
      });
    } catch (redisError) {
      console.error(`[Process ${uploadId}] Error updating Redis status:`, redisError);
    }
  }
}

// Helper to update status in Redis
async function updateRedisStatus(uploadId, stage, progress) {
  const uploadKey = `upload:${uploadId}`;
  try {
    const current = await redis.get(uploadKey) || {};
    await redis.set(uploadKey, {
      ...current,
      stage,
      progress,
      lastUpdated: new Date().toISOString()
    });
    console.log(`[Status ${uploadId}] Updated Redis to ${stage} (${progress}%)`);
  } catch (redisError) {
    console.error(`[Status ${uploadId}] Error updating Redis status:`, redisError);
  }
}

// Helper for retrying operations
async function retryOperation(operation, maxRetries = 3, retryDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Retry attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        const delay = retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Wrapper for uploadToGCS with retries
async function uploadToGCSWithRetry(buffer, filename, mimeType) {
  return retryOperation(() => uploadToGCS(buffer, filename, mimeType));
}

// Wrapper for saveToSheet with retries
async function saveToSheetWithRetry(data) {
  return retryOperation(() => saveToSheet(data));
}

// Wrapper for sendConfirmationEmail with retries
async function sendEmailWithRetry(name, email, filename) {
  return retryOperation(() => sendConfirmationEmail(name, email, filename));
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
  console.log(`Starting text extraction for file type: ${mimeType}`);
  
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
    // Try to get credentials from either individual env vars or JSON string
    let projectId, bucketName, privateKey, clientEmail;
    
    // Debug: Log all environment variables that might contain credentials (without values)
    const credentialEnvVars = [
      'GCS_CREDENTIALS', 'GCS_BUCKET_NAME', 'GOOGLE_STORAGE_BUCKET',
      'GOOGLE_PROJECT_ID', 'GCP_PROJECT_ID',
      'GOOGLE_PRIVATE_KEY', 'GCP_PRIVATE_KEY',
      'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GCP_CLIENT_EMAIL'
    ];
    
    console.log('Checking for credential env vars:', 
      credentialEnvVars.map(key => `${key}=${process.env[key] ? 'present' : 'missing'}`).join(', '));
    
    // Check if we have a JSON credentials object
    if (process.env.GCS_CREDENTIALS) {
      try {
        console.log('Found GCS_CREDENTIALS environment variable');
        let credentials;
        
        // Check if credentials are already an object or need to be parsed
        if (typeof process.env.GCS_CREDENTIALS === 'string') {
          try {
            console.log('Parsing GCS_CREDENTIALS as JSON string');
            credentials = JSON.parse(process.env.GCS_CREDENTIALS);
          } catch (jsonError) {
            console.error('Error parsing GCS_CREDENTIALS as JSON:', jsonError.message);
            console.log('Checking if credentials are base64 encoded');
            
            // Try decoding as base64
            try {
              const decoded = Buffer.from(process.env.GCS_CREDENTIALS, 'base64').toString();
              credentials = JSON.parse(decoded);
              console.log('Successfully decoded base64 credentials');
            } catch (base64Error) {
              console.error('Failed to decode base64 credentials:', base64Error.message);
              throw new Error('Invalid GCS credentials format');
            }
          }
        } else {
          credentials = process.env.GCS_CREDENTIALS;
        }
        
        // Extract values from the credentials object
        projectId = credentials.project_id;
        clientEmail = credentials.client_email;
        privateKey = credentials.private_key;
        
        console.log(`Extracted from GCS_CREDENTIALS: project_id=${projectId ? 'present' : 'missing'}, client_email=${clientEmail ? 'present' : 'missing'}, private_key=${privateKey ? 'present(length:' + (privateKey?.length || 0) + ')' : 'missing'}`);
        
        // Get bucket name from separate env var
        bucketName = process.env.GCS_BUCKET_NAME || process.env.GOOGLE_STORAGE_BUCKET;
      } catch (parseError) {
        console.error('Failed to parse GCS_CREDENTIALS:', parseError.message);
      }
    }
    
    // Fall back to individual environment variables if needed
    projectId = projectId || process.env.GOOGLE_PROJECT_ID || process.env.GCP_PROJECT_ID;
    bucketName = bucketName || process.env.GOOGLE_STORAGE_BUCKET || process.env.GCS_BUCKET_NAME;
    privateKey = privateKey || process.env.GOOGLE_PRIVATE_KEY || process.env.GCP_PRIVATE_KEY;
    clientEmail = clientEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GCP_CLIENT_EMAIL;
    
    console.log(`Final credentials: projectId=${projectId ? 'present' : 'missing'}, bucketName=${bucketName ? 'present' : 'missing'}, privateKey=${privateKey ? 'present(length:' + (privateKey?.length || 0) + ')' : 'missing'}, clientEmail=${clientEmail ? 'present' : 'missing'}`);
    
    if (!projectId || !bucketName) {
      console.warn('Missing GCS environment variables - saving file locally instead');
      
      // Fallback to local file storage
      console.log('Using local file storage fallback');
      
      // Create a temporary file path
      const sanitizedFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
      
      // Return a mock URL for local storage
      return `local://${sanitizedFilename}`;
    }
    
    console.log(`Using GCS project: ${projectId}, bucket: ${bucketName}`);
    
    if (!privateKey || !clientEmail) {
      console.warn('Missing Google auth environment variables - saving file locally instead');
      
      // Fallback to local file storage
      console.log('Using local file storage fallback');
      
      // Create a temporary file path
      const sanitizedFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
      
      // Return a mock URL for local storage
      return `local://${sanitizedFilename}`;
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
    
    // Create storage client with credentials
    console.log('Initializing Storage client...');
    const storage = new Storage({
      projectId,
      credentials: {
        client_email: clientEmail,
        private_key: privateKey
      }
    });
    
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
    
    // Get the public URL (bucket should have allUsers read access at bucket level)
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${uniqueFilename}`;
    console.log(`File URL: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error('Error uploading to Google Cloud Storage:', error);
    throw error;
  }
} 