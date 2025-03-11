import { google } from 'googleapis';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// Function to create or get the sheet in Google Sheets
async function createOrGetSheet(sheets, spreadsheetId, sheetTitle) {
  try {
    await sheets.spreadsheets.get({ spreadsheetId, ranges: [sheetTitle] });
    return true;
  } catch (error) {
    if (error.code === 400) {
      console.log(`Sheet '${sheetTitle}' not found. Creating new sheet.`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: { properties: { title: sheetTitle } },
          }],
        },
      });
      return true;
    }
    throw error;
  }
}

// Function to extract text from a file (PDF/Word)
async function extractTextFromFile(content) {
  console.log('Received content:', content); // Log the content to check if it's already a string

  if (typeof content === 'string') {
    console.log('Content is already a string, returning it.');
    return content;
  }

  // Check if the content is a PDF or Word document
  if (content.type === 'application/pdf') {
    const pdfBuffer = Buffer.from(content.buffer, 'base64');
    const pdfText = await pdfParse(pdfBuffer);
    console.log('Extracted PDF text:', pdfText.text.substring(0, 100)); // Log first 100 characters
    return pdfText.text;
  }

  if (content.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const wordBuffer = Buffer.from(content.buffer, 'base64');
    const wordText = await mammoth.extractRawText({ buffer: wordBuffer });
    console.log('Extracted Word document text:', wordText.value.substring(0, 100)); // Log first 100 characters
    return wordText.value;
  }

  console.error('Unsupported file type:', content.type); // Log unsupported file types
  throw new Error("Unsupported file type");
}

// Function to analyze CV using OpenAI's GPT model
async function analyzeCVWithChatGPT(text) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Extract structured information from the given resume text into a structured JSON format.' },
        { role: 'user', content: `Extract the following details from the CV:
          - Personal Information: Name, Email, Phone, Address, NIC, LinkedIn, GitHub
          - Education: Degree Type, Field of Study, Institution, Period, Details
          - Experience: Job Title, Company, Period, Description of responsibilities
          - Projects: Project Name, Technologies used, Description
          \nHere is the CV text:\n"${text}"` },
      ],
      max_tokens: 1000,
      temperature: 0.2,
      top_p: 1,
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error("Error analyzing CV with OpenAI:", error.message);
    throw new Error("Failed to analyze CV with OpenAI");
  }
}

// Function to parse CV content into structured data
async function parseCVContent(content) {
  const sections = {
    personal_info: {
      name: "-",
      email: "-",
      phone: "-",
      address: "-",
      nic: "-",
      linkedin: "-",
      github: "-",
    },
    education: [],
    experience: [],
    projects: [],
  };

  try {
    const fileText = await extractTextFromFile(content);
    const structuredData = await analyzeCVWithChatGPT(fileText);

    console.log("Structured data parsed:", structuredData);

    if (structuredData) {
      sections.personal_info = structuredData.personal_info || sections.personal_info;
      sections.education = structuredData.education || sections.education;
      sections.experience = structuredData.experience || sections.experience;
      sections.projects = structuredData.projects || sections.projects;
    }
  } catch (error) {
    console.error("Error parsing CV content:", error.message);
    throw new Error("Failed to parse CV content");
  }

  return sections;
}

// Function to save the parsed CV content to Google Sheets
async function saveToSheet(data) {
  console.log('Data to save to sheet:', data);

  try {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/"/g, '') || '';
    if (!privateKey || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SHEET_ID) {
      throw new Error('Missing required Google authentication environment variables.');
    }

    // Set up authentication for Google Sheets API
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await auth.authorize();

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const sheetNames = ['PersonalInfo', 'Education', 'Experience', 'Projects'];
    await Promise.all(sheetNames.map(sheet => createOrGetSheet(sheets, spreadsheetId, sheet)));

    const parsedData = await parseCVContent(data.content);
    const cvUrl = data.cvUrl ? String(data.cvUrl) : 'N/A';
    const downloadLink = `=HYPERLINK("${cvUrl}", "Click to Download CV")`;

    const formData = {
      name: Array.isArray(data.name) ? data.name.join(', ') : data.name || 'N/A',
      email: Array.isArray(data.email) ? data.email.join(', ') : data.email || 'N/A',
      phone: Array.isArray(data.phone) ? data.phone.join(', ') : data.phone || 'N/A',
      filename: data.filename || 'N/A',
      education: parsedData.education.length ? parsedData.education.map(item => item.DegreeType).join(', ') : '-',
      experience: parsedData.experience.length ? parsedData.experience.map(item => item.JobTitle).join(', ') : '-',
      projects: parsedData.projects.length ? parsedData.projects.map(item => item.ProjectName).join(', ') : '-',
      cvDownloadLink: downloadLink,
    };

    // Append data to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'PersonalInfo!A2:F2',
      valueInputOption: 'RAW',
      resource: {
        values: [[
          formData.name,
          formData.email,
          formData.phone,
          formData.filename,
          formData.education,
          formData.experience,
          formData.projects,
          formData.cvDownloadLink,
        ]],
      },
    });

    console.log('Data successfully saved to Google Sheets.');
    return true;
  } catch (error) {
    console.error("Error saving CV to Google Sheets:", error.message);
    throw new Error("Failed to save CV to Google Sheets");
  }
}

export default saveToSheet;
