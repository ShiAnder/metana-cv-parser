import busboy from 'busboy';

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
    
    // Use busboy for multipart parsing
    return await new Promise((resolve, reject) => {
      let fileInfo = null;
      let fields = {};
      
      // Initialize busboy with request headers
      const bb = busboy({ 
        headers: req.headers,
        limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
      });
      
      // Handle file parts
      bb.on('file', (name, file, info) => {
        const { filename, encoding, mimeType } = info;
        console.log(`File [${name}]: filename: ${filename}, encoding: ${encoding}, mimeType: ${mimeType}`);
        
        let fileSize = 0;
        file.on('data', (data) => {
          fileSize += data.length;
          console.log(`File [${name}] got ${data.length} bytes`);
        });
        
        file.on('end', () => {
          console.log(`File [${name}] done, total size: ${fileSize} bytes`);
          fileInfo = {
            name: filename,
            type: mimeType,
            size: fileSize
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
        res.status(200).json({
          success: true,
          message: 'Upload received and processed with busboy',
          fileInfo: fileInfo || 'No file received',
          fields: fields
        });
        resolve();
      });
      
      // Handle errors
      bb.on('error', (err) => {
        console.error('Busboy error:', err);
        res.status(500).json({
          success: false,
          error: 'Upload processing error',
          message: err.message
        });
        reject(err);
      });
      
      // Pipe the request into busboy
      req.pipe(bb);
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