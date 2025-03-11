import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

/**
 * Creates an authenticated Google client for API access
 * Uses multiple strategies to ensure the private key works
 */
export async function getAuthenticatedGoogleClient() {
  console.log('Setting up Google authentication...');
  
  // Get environment variables
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  
  if (!serviceAccountEmail) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is missing');
  }
  
  if (!privateKey) {
    throw new Error('GOOGLE_PRIVATE_KEY environment variable is missing');
  }
  
  console.log(`Service account email: ${serviceAccountEmail}`);
  console.log(`Private key length: ${privateKey.length} characters`);
  
  // Create a temporary key file to ensure proper formatting
  // This is the most reliable way to handle newlines and formatting issues
  const tempKeyPath = path.join(process.cwd(), 'temp-google-key.json');
  
  try {
    // Try several key format approaches
    console.log('Attempting multiple key format strategies...');
    let auth = null;
    let authSuccess = false;
    
    // Strategy 1: Direct use of the key
    try {
      console.log('Strategy 1: Using key directly');
      auth = new google.auth.JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      
      await auth.authorize();
      console.log('✅ Strategy 1 succeeded!');
      authSuccess = true;
    } catch (error) {
      console.log('❌ Strategy 1 failed:', error.message);
    }
    
    // Strategy 2: Clean and format the key
    if (!authSuccess) {
      try {
        console.log('Strategy 2: Cleaning and formatting key');
        // Remove quotes and normalize newlines
        let cleanKey = privateKey;
        
        if (cleanKey.startsWith('"') && cleanKey.endsWith('"')) {
          cleanKey = cleanKey.slice(1, -1);
        }
        
        cleanKey = cleanKey.replace(/\\n/g, '\n');
        
        auth = new google.auth.JWT({
          email: serviceAccountEmail,
          key: cleanKey,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        await auth.authorize();
        console.log('✅ Strategy 2 succeeded!');
        authSuccess = true;
      } catch (error) {
        console.log('❌ Strategy 2 failed:', error.message);
      }
    }
    
    // Strategy 3: Use a temporary file
    if (!authSuccess) {
      try {
        console.log('Strategy 3: Using temporary key file');
        // Create a properly formatted key file
        const keyFileContent = JSON.stringify({
          type: 'service_account',
          project_id: 'metana-test-2',
          private_key_id: 'temp-key-id',
          private_key: privateKey.replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
          client_email: serviceAccountEmail,
          client_id: 'temp-client-id',
          auth_uri: 'https://accounts.google.com/o/oauth2/auth',
          token_uri: 'https://oauth2.googleapis.com/token',
          auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
          client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(serviceAccountEmail)}`
        }, null, 2);
        
        fs.writeFileSync(tempKeyPath, keyFileContent);
        console.log('Temporary key file created successfully');
        
        // Use the Google auth client with the file
        auth = new google.auth.GoogleAuth({
          keyFile: tempKeyPath,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        // Get the client
        const authClient = await auth.getClient();
        console.log('✅ Strategy 3 succeeded!');
        authSuccess = true;
        
        // Use this client directly
        auth = authClient;
      } catch (error) {
        console.log('❌ Strategy 3 failed:', error.message);
      }
    }
    
    // If all strategies failed, throw an error
    if (!authSuccess) {
      throw new Error('All Google authentication strategies failed');
    }
    
    // Return the authenticated client
    return auth;
  } finally {
    // Clean up temporary file
    if (fs.existsSync(tempKeyPath)) {
      fs.unlinkSync(tempKeyPath);
      console.log('Temporary key file cleaned up');
    }
  }
}

/**
 * Gets an authenticated Google Sheets API client
 */
export async function getGoogleSheetsClient() {
  const auth = await getAuthenticatedGoogleClient();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Gets an authenticated Google Drive API client
 */
export async function getGoogleDriveClient() {
  const auth = await getAuthenticatedGoogleClient();
  return google.drive({ version: 'v3', auth });
}

export default {
  getAuthenticatedGoogleClient,
  getGoogleSheetsClient,
  getGoogleDriveClient
}; 