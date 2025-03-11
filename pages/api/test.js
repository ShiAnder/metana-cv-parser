// Simple test endpoint for Vercel
export default function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Return basic response with request info
  return res.status(200).json({
    success: true,
    message: 'API is working',
    request: {
      method: req.method,
      url: req.url,
      headers: Object.keys(req.headers)
    }
  });
} 