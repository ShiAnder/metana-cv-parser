import dotenv from 'dotenv';
import { google } from 'googleapis';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function testGoogleSheets() {
  try {
    console.log('Testing Google Sheets connection...');
    
    // Check environment variables
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    console.log('Environment variables status:');
    console.log(`- GOOGLE_SERVICE_ACCOUNT_EMAIL: ${serviceAccountEmail ? 'Present' : 'Missing'}`);
    console.log(`- GOOGLE_PRIVATE_KEY: ${privateKey ? 'Present' : 'Missing'}`);
    console.log(`- GOOGLE_SHEET_ID: ${spreadsheetId ? 'Present' : 'Missing'}`);
    
    if (!privateKey || !serviceAccountEmail || !spreadsheetId) {
      throw new Error('Missing required Google authentication environment variables.');
    }
    
    // Create auth client
    console.log('Creating auth client...');
    const auth = new google.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    // Authorize
    console.log('Authorizing...');
    await auth.authorize();
    console.log('Authorization successful!');
    
    // Get spreadsheet
    const sheets = google.sheets({ version: 'v4', auth });
    console.log('Getting spreadsheet metadata...');
    const metaData = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });
    
    console.log('Spreadsheet title:', metaData.data.properties.title);
    console.log('Available sheets:');
    metaData.data.sheets.forEach((sheet, index) => {
      console.log(`  ${index + 1}. ${sheet.properties.title}`);
    });
    
    // Write test data
    console.log('Writing test data...');
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'CV-Informations!A2',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [['Test User', 'test@example.com', '123-456-7890', 'test.pdf', 'Test Education', 'Test Experience', 'Test Projects', 'N/A']]
      }
    });
    
    console.log('Test data written successfully!');
    console.log('Google Sheets integration test complete. All systems operational.');
    
  } catch (error) {
    console.error('Error testing Google Sheets integration:', error);
  }
}

// Run the test
testGoogleSheets().then(() => console.log('Test complete')); 