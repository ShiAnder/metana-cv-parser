import { google } from 'googleapis';
<<<<<<< HEAD
import { parseCVContent } from './cvParser.js.old';
=======
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
>>>>>>> 802fbf86e1396c8f80d8addc4adb19c8491ee90f

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

<<<<<<< HEAD
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
=======
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
>>>>>>> 802fbf86e1396c8f80d8addc4adb19c8491ee90f
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

<<<<<<< HEAD
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
=======
    console.log('Data appended successfully to sheet');
    return true;
  } catch (error) {
    console.error('Error:', error);
>>>>>>> 802fbf86e1396c8f80d8addc4adb19c8491ee90f
    throw new Error(`Failed to process CV: ${error.message}`);
  }
}

export default saveToSheet;
