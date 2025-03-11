import { google } from 'googleapis';
import { parseCVContent } from './cvParser.js.old';

// Function to create or get the sheet in Google Sheets
async function createOrGetSheet(sheets, spreadsheetId, sheetTitle) {
  try {
    // Try to retrieve the sheet by name
    await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [sheetTitle],
    });
    return true;
  } catch (error) {
    if (error.code === 400) {
      console.log(`Sheet '${sheetTitle}' not found. Creating new sheet.`);
      // Create the sheet if it doesn't exist
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: { title: sheetTitle },
            },
          }],
        },
      });
      return true;
    }
    throw error;
  }
}

// Function to save the parsed CV content to Google Sheets
async function saveToSheet(data) {
  try {
    // Ensure that required environment variables are set
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/"/g, '') || '';
    if (!privateKey || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SHEET_ID) {
      throw new Error('Missing required Google authentication environment variables.');
    }


    conosloe.log("this is the data parse to the save to" + data);
    // Set up authentication for Google Sheets API
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await auth.authorize();

    // Initialize Sheets API client
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Ensure required sheets exist
    const sheetNames = ['PersonalInfo', 'Education', 'Experience', 'Projects'];
    await Promise.all(sheetNames.map(sheet => createOrGetSheet(sheets, spreadsheetId, sheet)));

    // Parse the CV content
    const parsedData = await parseCVContent(data.content);
    const cvUrl = data.cvUrl ? String(data.cvUrl) : 'N/A';
    const downloadLink = `=HYPERLINK("${cvUrl}", "Click to Download CV")`;

    // Log parsed CV content for debugging
    console.log("Parsed CV content:", JSON.stringify(parsedData, null, 2));

    // Create the form data to insert into the sheet
    const formData = {
      name: Array.isArray(data.name) ? data.name.join(', ') : data.name || 'N/A',
      email: Array.isArray(data.email) ? data.email.join(', ') : data.email || 'N/A',
      phone: Array.isArray(data.phone) ? data.phone.join(', ') : data.phone || 'N/A',
      filename: data.filename || 'N/A',
      education: parsedData.education?.length ? parsedData.education.join(', ') : '-',
      experience: parsedData.experience?.length ? parsedData.experience.join(', ') : '-',
      projects: parsedData.projects?.length ? parsedData.projects.join(', ') : '-',
      personal_info: {
        address: parsedData.personal_info?.address || '-',
        email: parsedData.personal_info?.email || '-',
        github: parsedData.personal_info?.github || '-',
        linkedin: parsedData.personal_info?.linkedin || '-',
        name: Array.isArray(parsedData.personal_info?.name) 
          ? parsedData.personal_info.name.join(', ') 
          : parsedData.personal_info?.name || '-',
        nic: parsedData.personal_info?.nic || '-',
        phone: Array.isArray(parsedData.personal_info?.phone) 
          ? parsedData.personal_info.phone.join(', ') 
          : parsedData.personal_info?.phone || '-',
      },
    };

    // Debugging: Log processed form data before saving to Google Sheets
    console.log('Processed Form Data:', JSON.stringify(formData, null, 2));

    // Create row data to append
    const row = [
      formData.name, 
      formData.email, 
      formData.phone, 
      formData.personal_info.address,
      downloadLink, 
      formData.education, 
      formData.experience, 
      formData.projects, 
      formData.personal_info.github, 
      formData.personal_info.linkedin,
    ];

    // Append to "PersonalInfo" sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'PersonalInfo!A1',
      valueInputOption: 'RAW',
      resource: { values: [row] },
    });

    console.log('Data successfully appended to "PersonalInfo" sheet.');

    // If needed, you can append other parsed data to the respective sheets (Education, Experience, Projects).
    // Example: Appending Education Data
    if (parsedData.education?.length) {
      const educationRows = parsedData.education.map(edu => [edu]);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Education!A1',
        valueInputOption: 'RAW',
        resource: { values: educationRows },
      });
      console.log('Education data successfully appended.');
    }

    // Handle other sheets similarly (Experience, Projects)

  } catch (error) {
    console.error('Error saving to Google Sheets:', error.message);
    throw new Error(`Failed to process CV: ${error.message}`);
  }
}

export default saveToSheet;
