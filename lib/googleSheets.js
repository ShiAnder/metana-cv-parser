import { google } from 'googleapis';
import { parseCVContent } from './cvParser';

async function createOrGetSheet(sheets, spreadsheetId, sheetTitle) {
  try {
    // Try to get the sheet
    await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [sheetTitle]
    });
    console.log(`Sheet "${sheetTitle}" already exists`);
    return true;
  } catch (error) {
    // If sheet doesn't exist, create it
    if (error.code === 400) {
      const request = {
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetTitle
              }
            }
          }]
        }
      };
      await sheets.spreadsheets.batchUpdate(request);
      console.log(`Created new sheet "${sheetTitle}"`);
      return true;
    }
    throw error;
  }
}

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

    // Create required sheets if they don't exist
    const requiredSheets = ['PersonalInfo', 'Education', 'Qualifications', 'Projects'];
    await Promise.all(requiredSheets.map(sheetTitle => 
      createOrGetSheet(sheets, process.env.GOOGLE_SHEET_ID, sheetTitle)
    ));

    // Parse CV content
    const parsedData = parseCVContent(data.content);
    const cvUrl = String(data.cvUrl || 'N/A');
    const downloadLink = `=HYPERLINK("${cvUrl}", "Click to Download CV")`;

    // Use form data for basic info
    const formName = String(data.name || 'N/A');
    const formEmail = String(data.email || 'N/A');
    const formPhone = String(data.phone || 'N/A');

    // Format personal info as a string (including name and contact details from CV)
    const personalInfo = [
      `Name: ${parsedData.personalInfo.name}`,
      `Email: ${parsedData.personalInfo.email}`,
      `Phone: ${parsedData.personalInfo.phone}`,
      `Address: ${parsedData.personalInfo.address}`,
      `NIC: ${parsedData.personalInfo.nic}`,
      `LinkedIn: ${parsedData.personalInfo.linkedin}`,
      `GitHub: ${parsedData.personalInfo.github}`
    ].join('\n');

    // Format education as a string
    const education = parsedData.education.map(edu => {
      if (edu.type === 'A/L') {
        return `${edu.examination}\n${edu.period}\n${edu.subjectStream}\n${edu.description}`;
      } else if (edu.type === 'Degree') {
        return `${edu.degree}\n${edu.institution}\n${edu.period}\n${edu.location}\n${edu.gpa}`;
      } else if (edu.type === 'Certificate') {
        return `${edu.name}\n${edu.institution}\n${edu.period}\n${edu.location}`;
      }
      return '';
    }).filter(Boolean).join('\n\n');

    // Format qualifications/experience as a string
    const qualifications = parsedData.qualifications.map(qual => 
      `${qual.title}\n${qual.company}\n${qual.period}\n${qual.location}\n${qual.description}`
    ).join('\n\n');

    // Format projects as a string
    const projects = parsedData.projects.map(proj => 
      `${proj.name}\n${proj.technology}\n${proj.description}\n${proj.link}`
    ).join('\n\n');

    // Prepare the data as a single row
    const timestamp = new Date().toISOString();
    const values = [[
      timestamp,
      formName,        // Use form data
      formEmail,       // Use form data
      formPhone,       // Use form data
      downloadLink,
      personalInfo,    // From CV content
      qualifications,  // From CV content
      education,      // From CV content
      projects       // From CV content
    ]];

    // Append the data to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:I',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });

    console.log('Data appended successfully to sheet');
    return true;
  } catch (error) {
    console.error('Error:', error);
    throw new Error(`Failed to process CV: ${error.message}`);
  }
}

export default saveToSheet;
