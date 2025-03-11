// Simple health check API endpoint
export default function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed',
      message: 'Only GET is allowed for this endpoint'
    });
  }

  // Return health status
  return res.status(200).json({
    success: true,
    message: 'API is healthy',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    // Include minimal environment info
    environment: {
      node: process.version,
      platform: process.platform,
      runtime: 'Next.js API Routes'
    },
    // Include available configuration without exposing secrets
    config: {
      hasBucketName: !!process.env.GCS_BUCKET_NAME || !!process.env.GOOGLE_STORAGE_BUCKET,
      hasGcsCredentials: !!process.env.GCS_CREDENTIALS,
      hasGoogleServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !!process.env.GCP_CLIENT_EMAIL
    }
  });
} 