import { google } from 'googleapis';

async function saveToSheet(data) {
  try {
    // Parse the private key properly
    const privateKey = process.env.GOOGLE_PRIVATE_KEY
      ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '')
      : '';

    if (!privateKey) {
      throw new Error('Google private key is not configured');
    }

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      throw new Error('Google service account email is not configured');
    }

    if (!process.env.GOOGLE_SHEET_ID) {
      throw new Error('Google Sheet ID is not configured');
    }

    // Create JWT client
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Verify authentication
    try {
      await auth.authorize();
      console.log('Authentication successful');
    } catch (authError) {
      console.error('Authentication failed:', authError);
      throw new Error(`Authentication failed: ${authError.message}`);
    }

    // Create sheets API client
    const sheets = google.sheets({ version: 'v4', auth });

    // Verify spreadsheet access
    try {
      await sheets.spreadsheets.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID
      });
      console.log('Spreadsheet access verified');
    } catch (accessError) {
      console.error('Spreadsheet access failed:', accessError);
      throw new Error(`Spreadsheet access failed: ${accessError.message}`);
    }

    // Ensure all data values are strings
    const timestamp = new Date().toISOString();
    const name = String(data.name || 'N/A');
    const email = String(data.email || 'N/A');
    const phone = String(data.phone || 'N/A');
    const filename = String(data.filename || 'N/A');
    const content = String(data.content || '');

    // Prepare the data as a single row
    const values = [[timestamp, name, email, phone, filename, content]];

    console.log('Attempting to append data:', values);

    // Append the data to the sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:F',
      valueInputOption: 'USER_ENTERED', // Changed from RAW to USER_ENTERED
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });

    console.log('Data appended successfully:', response.data);
    return true;
  } catch (error) {
    console.error('Google Sheets Error:', error);
    throw new Error(`Failed to save to Google Sheets: ${error.message}`);
  }
}

export default saveToSheet;
