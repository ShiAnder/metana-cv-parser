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
    
    // Use a basic promise wrapper for formidable
    const formData = await new Promise((resolve, reject) => {
      const form = new IncomingForm({ 
        maxFileSize: 10 * 1024 * 1024 // 10MB 
      });
      
      form.parse(req, (err, fields, files) => {
        if (err) {
          console.error('Form parsing error:', err);
          return reject(err);
        }
        resolve({ fields, files });
      });
    });
    
    // Basic success response without doing any actual processing
    return res.status(200).json({
      success: true,
      message: 'Upload received',
      fileInfo: formData.files.file ? {
        name: formData.files.file.originalFilename || formData.files.file.name || 'unknown',
        type: formData.files.file.mimetype || 'unknown',
        size: formData.files.file.size || 0
      } : 'No file received'
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