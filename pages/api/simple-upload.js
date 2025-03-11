import { IncomingForm } from 'formidable';
import fs from 'fs';

// Required for Next.js API routes
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  console.log('Simple upload API called with method:', req.method);

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
    console.log('Processing POST request');
    console.log('Request headers:', req.headers);
    
    // Create an array to store raw request data chunks
    const chunks = [];
    let rawBodySize = 0;
    
    // Process the raw request body
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        chunks.push(chunk);
        rawBodySize += chunk.length;
        console.log(`Received chunk: ${chunk.length} bytes`);
      });
      
      req.on('end', () => {
        console.log(`Received total: ${rawBodySize} bytes`);
        resolve();
      });
      
      req.on('error', (err) => {
        console.error('Error in request stream:', err);
        reject(err);
      });
    });
    
    // Create a buffer from all chunks
    const buffer = Buffer.concat(chunks);
    console.log(`Buffer size: ${buffer.length} bytes`);
    
    // Get content type to determine boundary
    const contentType = req.headers['content-type'];
    
    console.log('Content type:', contentType);
    
    // Simplified handling - just acknowledge receipt
    // In a real implementation, you'd parse the multipart form data
    // but this at least confirms we're receiving data
    return res.status(200).json({
      success: true,
      message: 'Upload received',
      fileInfo: {
        receivedBytes: buffer.length,
        contentType: contentType,
        boundary: contentType && contentType.includes('boundary=') 
          ? contentType.split('boundary=')[1].trim() 
          : 'No boundary found'
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