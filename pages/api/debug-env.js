// A simple endpoint to debug environment variables
export default function handler(req, res) {
  try {
    // Return only presence/absence of environment variables, not their values
    // for security reasons
    const envStatus = {
      // Google Sheets/GCS variables
      GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
      GOOGLE_SHEET_ID: !!process.env.GOOGLE_SHEET_ID,
      GCS_CREDENTIALS: !!process.env.GCS_CREDENTIALS,
      GCS_BUCKET_NAME: !!process.env.GCS_BUCKET_NAME,
      
      // Email variables
      EMAIL_HOST: !!process.env.EMAIL_HOST,
      EMAIL_PORT: !!process.env.EMAIL_PORT,
      EMAIL_USER: !!process.env.EMAIL_USER,
      EMAIL_PASS: !!process.env.EMAIL_PASS,
      
      // OpenAI
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      OPENAI_ORG_ID: !!process.env.OPENAI_ORG_ID,
      
      // Node environment
      NODE_ENV: process.env.NODE_ENV,
      VERCEL: !!process.env.VERCEL,
      
      // Check if dotenv is loaded correctly
      ENV_FILE_LOADED: process.env.ENV_FILE_LOADED === 'true'
    };
    
    // Return information about the environment
    return res.status(200).json({
      success: true,
      message: 'Environment variable availability',
      data: envStatus,
      missingKeys: Object.entries(envStatus)
        .filter(([key, value]) => value === false)
        .map(([key]) => key)
    });
  } catch (error) {
    console.error('Error retrieving environment info:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving environment information',
      error: error.message
    });
  }
} 