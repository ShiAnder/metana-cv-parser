import { google } from 'googleapis';

async function saveToSheet(data) {
  try {
    // Parse the private key properly
    const privateKey = process.env.GOOGLE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .replace(/"/g, '');

    // Log service account email for verification (remove in production)
    console.log('Using service account:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);

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

    // Prepare the data
    const values = [[
      new Date().toISOString(),
      data.name,
      data.content
    ]];

    // Append the data to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:C',
      valueInputOption: 'RAW',
      requestBody: {
        values,
      },
    });

    return true;
  } catch (error) {
    console.error('Google Sheets Error:', error);
    throw error;
  }
}

export default saveToSheet;
