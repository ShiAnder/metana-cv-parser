// Simple echo endpoint for debugging
export default function handler(req, res) {
  console.log('Echo API called with method:', req.method);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request in echo');
    return res.status(200).end();
  }

  // Accept any method for this debugging endpoint
  console.log('Request headers:', req.headers);
  console.log('Request URL:', req.url);
  console.log('Request method:', req.method);

  // Return basic response with request info
  return res.status(200).json({
    success: true,
    message: 'Echo endpoint responding',
    timestamp: new Date().toISOString(),
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      query: req.query
    }
  });
} 