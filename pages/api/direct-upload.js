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
    
    // Return a fuller response with more details
    const responseData = {
      success: true,
      message: 'File received, processing in background',
      fileInfo: fileInfo,
      fields: fields,
      processing: 'async',
      timestamp: new Date().toISOString()
    };
    
    // Send the response
    res.status(200).json(responseData);
    
    // IMPORTANT: Execute the processing in a way that doesn't block the response
    // but still completes even if Vercel tries to terminate the function
    
    // Create an async function for background processing
    const backgroundProcess = async () => {
      try {
        console.log('[Background] Starting background processing');
        
        // Extract text from the file
        console.log('[Background] Extracting text from file...');
        const text = await extractText(fileBuffer, fileInfo.type);
        console.log('[Background] Text extracted successfully, length:', text.length);
        
        // Upload to Google Cloud Storage
        console.log('[Background] Starting GCS upload...');
        let cvUrl = null;
        try {
          cvUrl = await uploadToGCS(fileBuffer, fileInfo.name, fileInfo.type);
          console.log('[Background] File uploaded to GCS:', cvUrl);
        } catch (uploadError) {
          console.error('[Background] GCS upload failed:', uploadError);
        }
        
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
        
        // Save to Google Sheets
        console.log('[Background] Saving to Google Sheets...');
        console.log('[Background] ParsedData:', JSON.stringify(parsedData));
        try {
          await saveToSheet(parsedData);
          console.log('[Background] Data saved to sheet successfully');
        } catch (sheetError) {
          console.error('[Background] Sheet error:', sheetError);
        }
        
        // Send email
        console.log('[Background] Sending confirmation email...');
        try {
          await sendConfirmationEmail(fields.name, fields.email, fileInfo.name);
          console.log('[Background] Email sent successfully');
        } catch (emailError) {
          console.error('[Background] Email error:', emailError);
        }
        
        console.log('[Background] Background processing completed successfully');
      } catch (processingError) {
        console.error('[Background] Processing error:', processingError);
      }
    };
    
    // Execute the background processing
    backgroundProcess().catch(err => {
      console.error('[Background] Fatal error in background processing:', err);
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
        
        console.log(`Extracted from GCS_CREDENTIALS: project_id=${projectId ? 'present' : 'missing'}, client_email=${clientEmail ? 'present' : 'missing'}, private_key=${privateKey ? 'present' : 'missing'}`);
        
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
    
    console.log(`Final credentials: projectId=${projectId ? 'present' : 'missing'}, bucketName=${bucketName ? 'present' : 'missing'}, privateKey=${privateKey ? 'present' : 'missing'}, clientEmail=${clientEmail ? 'present' : 'missing'}`);
    
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