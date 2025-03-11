import { google } from 'googleapis';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import dotenv from 'dotenv';
//import sendWebhook from './webhookSender'; // Import the webhook sender




// Load environment variables
dotenv.config({ path: '.env.local' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// Function to create or get the sheet in Google Sheets
async function createOrGetSheet(sheets, spreadsheetId, sheetTitle) {
  try {
    const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = sheetMetadata.data.sheets.some(
      (sheet) => sheet.properties.title === sheetTitle
    );

    if (!sheetExists) {
      console.log(`Sheet '${sheetTitle}' not found. Creating new sheet.`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{ addSheet: { properties: { title: sheetTitle } } }],
        },
      });
    }
  } catch (error) {
    console.error(`Error checking/creating sheet '${sheetTitle}':`, error);
    throw error;
  }
}

// Function to extract text from a file (PDF/Word)
async function extractTextFromFile(content) {
  // If content is already a string, return it directly
  if (typeof content === 'string') return content;
  
  // If content has a 'content' property that's a string, return that
  if (content.content && typeof content.content === 'string') {
    return content.content;
  }

  try {
    // Log the structure of the content for debugging
    console.log('Content object structure:', JSON.stringify({
      keys: Object.keys(content),
      hasType: 'type' in content,
      type: content.type,
      hasBuffer: !!content.buffer,
      hasContent: !!content.content,
      contentType: content.content ? typeof content.content : 'N/A',
    }));
    
    if (!content.type) {
      // If type is missing but we have a filename, try to infer the type
      if (content.filename) {
        const ext = content.filename.split('.').pop().toLowerCase();
        if (ext === 'pdf') {
          console.log('Inferred type as PDF from filename:', content.filename);
          content.type = 'application/pdf';
        } else if (['docx', 'doc'].includes(ext)) {
          console.log('Inferred type as DOCX from filename:', content.filename);
          content.type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (['txt', 'text'].includes(ext)) {
          console.log('Inferred type as text from filename:', content.filename);
          content.type = 'text/plain';
        } else {
          throw new Error(`Unable to determine file type from filename: ${content.filename}`);
        }
      } else {
        throw new Error('Missing file type information and no filename to infer from');
      }
    }
    
    // Extract text based on file type
    if (content.type === 'application/pdf') {
      if (!content.buffer) {
        throw new Error('PDF file buffer is missing');
      }
      const pdfBuffer = Buffer.from(content.buffer, 'base64');
      console.log('PDF buffer size:', pdfBuffer.length);
      const pdfText = await pdfParse(pdfBuffer);
      return pdfText.text;
    }

    if (content.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      if (!content.buffer) {
        throw new Error('DOCX file buffer is missing');
      }
      const wordBuffer = Buffer.from(content.buffer, 'base64');
      console.log('DOCX buffer size:', wordBuffer.length);
      const wordText = await mammoth.extractRawText({ buffer: wordBuffer });
      return wordText.value;
    }

    // Check for text-based file types that might be acceptable
    if (content.type === 'text/plain') {
      if (content.buffer) {
        const textBuffer = Buffer.from(content.buffer, 'base64');
        console.log('Text buffer size:', textBuffer.length);
        return textBuffer.toString('utf8');
      }
    }

    throw new Error(`Unsupported file type: ${content.type}. Only PDF and DOCX files are currently supported.`);
  } catch (error) {
    console.error('Error extracting text from file:', error);
    throw error;
  }
}

// Function to analyze CV using OpenAI's GPT model
async function analyzeCVWithChatGPT(text) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { 
          role: 'system', 
          content: `Extract structured information from the given resume text into a JSON format with the following structure exactly as shown:
{
  "Personal Information": {
    "Name": "Full Name",
    "Email": "email@example.com",
    "Phone": "phone number",
    "Address": "full address",
    "LinkedIn": "linkedin url",
    "GitHub": "github url"
  },
  "Education": [
    {
      "Degree Type": "degree name",
      "Field of Study": "field",
      "Institution": "school name",
      "Period": "time period",
      "Details": "additional details"
    }
  ],
  "Experience": [
    {
      "Job Title": "position title",
      "Company": "company name",
      "Period": "time period",
      "Description": "job description"
    }
  ],
  "Projects": [
    {
      "Project Name": "name of project",
      "Technologies used": "technologies",
      "Description": "project description"
    }
  ]
}

Ensure each section follows this exact structure with these exact field names.` 
        },
        { 
          role: 'user', 
          content: `Extract all relevant information from the following CV text and format it according to the specified JSON structure. Include as much detail as possible while maintaining the exact field names.

Here is the CV text:
"${text}"` 
        },
      ],
      max_tokens: 1500,
      temperature: 0.2,
      top_p: 1,
    });

    console.log(response.choices[0].message.content);
    
    try {
      // Parse the JSON response
      const parsedData = JSON.parse(response.choices[0].message.content);
      
      // Ensure the structure is consistent
      const structuredData = {
        personal_info: parsedData["Personal Information"] || {},
        education: parsedData["Education"] || [],
        experience: parsedData["Experience"] || [],
        projects: parsedData["Projects"] || []
      };
      
      return structuredData;
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      // Return a minimal valid structure if parsing fails
      return {
        personal_info: {},
        education: [],
        experience: [],
        projects: []
      };
    }
  } catch (error) {
    console.error('Error analyzing CV with OpenAI:', error);
    throw error;
  }
}

// Function to parse CV content into structured data
export async function parseCVContent(content) {
  try {
    // If content is a simple string (text already extracted) or an object with a content property
    let fileText;
    if (typeof content === 'string') {
      fileText = content;
    } else if (content.content && typeof content.content === 'string') {
      // This handles the case when content is passed as {content: "text content"}
      fileText = content.content;
    } else {
      // Otherwise, try to extract text from the file
      fileText = await extractTextFromFile(content);
    }
    
    // Get structured data from GPT
    const structuredData = await analyzeCVWithChatGPT(fileText);
    
    // Log the structure of the data for debugging
    console.log("StructuredData from GPT:", JSON.stringify({
      personal_info_keys: Object.keys(structuredData.personal_info || {}),
      education_length: (structuredData.education || []).length,
      experience_length: (structuredData.experience || []).length,
      projects_length: (structuredData.projects || []).length
    }));

    // Determine which format we're dealing with (camelCase or Title Case)
    const personalInfo = structuredData.personal_info || {};
    const isKeyCamelCase = 'name' in personalInfo;

    // If using Title Case (like "Name" instead of "name"), normalize it
    let normalizedPersonalInfo = personalInfo;
    if (!isKeyCamelCase) {
      normalizedPersonalInfo = {};
      // Map common personal info fields from Title Case to camelCase
      if ('Name' in personalInfo) normalizedPersonalInfo.name = personalInfo.Name;
      if ('Email' in personalInfo) normalizedPersonalInfo.email = personalInfo.Email;
      if ('Phone' in personalInfo) normalizedPersonalInfo.phone = personalInfo.Phone;
      if ('Address' in personalInfo) normalizedPersonalInfo.address = personalInfo.Address;
      if ('LinkedIn' in personalInfo) normalizedPersonalInfo.linkedin = personalInfo.LinkedIn;
      if ('GitHub' in personalInfo) normalizedPersonalInfo.github = personalInfo.GitHub;
      // Copy any remaining fields
      Object.entries(personalInfo).forEach(([key, value]) => {
        if (!(key in normalizedPersonalInfo)) {
          normalizedPersonalInfo[key] = value;
        }
      });
    }

    // Ensure consistent structure with safe fallbacks
    return {
      personalInfo: normalizedPersonalInfo,
      education: structuredData.education || [],
      qualifications: structuredData.experience || [],
      projects: structuredData.projects || [],
    };
  } catch (error) {
    console.error('Error parsing CV content:', error);
    // Return a minimal valid structure if parsing fails
    return {
      personalInfo: {},
      education: [],
      qualifications: [],
      projects: [],
    };
  }
}

// Function to save the parsed CV content to Google Sheets
async function saveToSheet(data) {
  try {
    // Log the data structure for debugging
    console.log('Data received in saveToSheet:', {
      hasContent: 'content' in data,
      contentType: typeof data.content,
      filename: data.filename,
      otherKeys: Object.keys(data).filter(k => k !== 'content')
    });

    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!privateKey || !serviceAccountEmail || !spreadsheetId) {
      throw new Error('Missing required Google authentication environment variables.');
    }

    const auth = new google.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await auth.authorize();

    const sheets = google.sheets({ version: 'v4', auth });

    // Ensure required sheets exist
    const sheetNames = ['CV-Informations'];
    await Promise.all(sheetNames.map(sheet => createOrGetSheet(sheets, spreadsheetId, sheet)));

    // Parse the CV content - pass the entire data object so parseCVContent can handle different formats
    const parsedData = await parseCVContent(data);
    
    // For debugging, let's log the structure of parsed data
    console.log("Parsed CV data structure:", JSON.stringify({
      personalInfoKeys: Object.keys(parsedData.personalInfo || {}),
      educationLength: (parsedData.education || []).length,
      qualificationsLength: (parsedData.qualifications || []).length,
      projectsLength: (parsedData.projects || []).length
    }));
    
    const cvUrl = data.cvUrl ? String(data.cvUrl) : 'N/A';
    const downloadLink = cvUrl !== 'N/A' ? `=HYPERLINK("${cvUrl}", "Click to Download CV")` : 'N/A';

    // Safely extract the name from parsed data or form data
    const name = parsedData.personalInfo && parsedData.personalInfo.name 
      ? String(parsedData.personalInfo.name) 
      : (data.name ? String(data.name) : 'N/A');
      
    // Extract other fields with proper string conversion
    const email = parsedData.personalInfo && parsedData.personalInfo.email 
      ? String(parsedData.personalInfo.email) 
      : (data.email ? String(data.email) : 'N/A');
      
    const phone = parsedData.personalInfo && parsedData.personalInfo.phone 
      ? String(parsedData.personalInfo.phone) 
      : (data.phone ? String(data.phone) : 'N/A');
      
    const filename = data.filename ? String(data.filename) : 'N/A';
    
    // Safely construct the education string
    let educationStr = 'N/A';
    if (parsedData.education && parsedData.education.length > 0) {
      try {
        educationStr = parsedData.education
          .map(e => {
            // Check for different property name patterns
            const degree = e["Degree Type"] || e.degree || '';
            const field = e["Field of Study"] || e.field || '';
            const institution = e.Institution || e.institution || '';
            return `${degree} in ${field} - ${institution}`;
          })
          .join('; ');
      } catch (error) {
        console.error('Error formatting education data:', error);
      }
    }
    
    // Safely construct the experience string
    let experienceStr = 'N/A';
    if (parsedData.qualifications && parsedData.qualifications.length > 0) {
      try {
        experienceStr = parsedData.qualifications
          .map(q => {
            // Check for different property name patterns
            const jobTitle = q["Job Title"] || q.jobTitle || '';
            const company = q.Company || q.company || '';
            return `${jobTitle} at ${company}`;
          })
          .join('; ');
      } catch (error) {
        console.error('Error formatting qualifications data:', error);
      }
    }
    
    // Safely construct the projects string
    let projectsStr = 'N/A';
    if (parsedData.projects && parsedData.projects.length > 0) {
      try {
        projectsStr = parsedData.projects
          .map(p => {
            // Check for different property name patterns
            const projectName = p["Project Name"] || p.projectName || '';
            const technologies = p["Technologies used"] || p.technologies || '';
            return `${projectName} (${technologies})`;
          })
          .join('; ');
      } catch (error) {
        console.error('Error formatting projects data:', error);
      }
    }
    
    // Log the actual values being sent to Google Sheets
    console.log("Values being sent to Google Sheets:", {
      name, email, phone, filename, 
      education: educationStr.substring(0, 50) + '...',
      experience: experienceStr.substring(0, 50) + '...',
      projects: projectsStr.substring(0, 50) + '...',
      downloadLink
    });

    // Append data to the spreadsheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'CV-Informations!A2',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          name,
          email,
          phone,
          filename,
          educationStr,
          experienceStr,
          projectsStr,
          downloadLink
        ]]
      }
    });

    console.log('Data successfully saved to Google Sheets.');
    
    // Send webhook to the specified endpoint
    try {
      await sendWebhook(parsedData, name, email, cvUrl);
    } catch (webhookError) {
      console.error('Error sending webhook:', webhookError);
      // Continue even if webhook fails
    }
    
    return true;
  } catch (error) {
    console.error('Error saving CV to Google Sheets:', error);
    throw error;
  }
}

export default saveToSheet;
