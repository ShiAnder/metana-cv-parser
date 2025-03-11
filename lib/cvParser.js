<<<<<<< HEAD
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
=======
export function parseCVContent(content) {
  const sections = {
    personalInfo: {
      name: '',
      email: '',
      phone: '',
      address: '',
      nic: '',
      linkedin: '',
      github: ''
    },
    education: [],
    qualifications: [],
    projects: []
  };

  const lines = content.split('\n').map(line => line.trim()).filter(line => line);

  let currentSection = '';
  let foundEmail = false;
  let foundAddress = false;
  let inReferences = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers
    if (line.toUpperCase().includes('EDUCATION')) {
      currentSection = 'education';
      continue;
    } else if (line.toUpperCase().includes('CERTIFICATE') || 
               line.toUpperCase().includes('DIPLOMA') || 
               line.toUpperCase().includes('HND') || 
               line.toUpperCase().includes('ADVANCED LEVEL') || 
               line.toUpperCase().includes('A/L')) {
      currentSection = 'education';
      continue;
    } else if (line.toUpperCase().includes('PROFESSIONAL EXPERIENCE') || 
               line.toUpperCase().includes('EXPERIENCE')) {
      currentSection = 'qualifications';
      continue;
    } else if (line.toUpperCase().includes('PROJECTS')) {
      currentSection = 'projects';
      continue;
    } else if (line.toUpperCase().includes('REFERENCES')) {
      inReferences = true;
      continue;
    }

    if (inReferences) continue;

    // Extract personal information
    if (line.includes('@') && !foundEmail) {
      sections.personalInfo.email = line;
      foundEmail = true;
    } else if (line.match(/^[0-9]{10}$/)) {
      sections.personalInfo.phone = line;
    } else if (line.includes('linkedin.com')) {
      sections.personalInfo.linkedin = line;
    } else if (line.includes('github.com')) {
      sections.personalInfo.github = line;
    } else if (line.match(/^[0-9]{9}[vV]$/)) {
      sections.personalInfo.nic = line;
    } else if (line.includes(',') && line.length > 30 && !foundAddress) {
      sections.personalInfo.address = line;
      foundAddress = true;
    } else if (!sections.personalInfo.name && line.length > 3 && !line.includes('@')) {
      sections.personalInfo.name = line;
    }

    // Process education entries
    if (currentSection === 'education' && line.length > 0) {
      // Check for Advanced Level entries
      if (line.includes('Advance') || line.includes('A/L')) {
        let subjectStream = '';
        let description = '';
        let period = '';
        let j = i + 1;
        
        // Get period, subject stream and description
        while (j < lines.length && 
               !lines[j].includes('BSc') && 
               !lines[j].includes('Bachelor') && 
               !lines[j].includes('Degree') &&
               !lines[j].includes('Certificate') &&
               !lines[j].includes('Course') &&
               !lines[j].includes('Diploma') &&
               !lines[j].includes('HND')) {
          if (lines[j].match(/^\d{4}$/)) {
            period = lines[j];
          } else if (lines[j].includes('Bio-Science') || lines[j].includes('Bio Science')) {
            subjectStream = lines[j];
          } else if (lines[j].includes('subjects')) {
            description = lines[j];
          }
          j++;
        }

        const educationEntry = {
          type: 'A/L',
          examination: 'Advance Level',
          period: period || '-',
          subjectStream: subjectStream || '-',
          description: description || '-'
        };
        sections.education.push(educationEntry);
        i = j - 1; // Update i to skip processed lines
        continue;
      }

      // Check for Degree entries
      if (line.includes('BSc') || line.includes('Bachelor') || line.includes('Degree')) {
        // Collect degree name from next lines until we find the institution
        let degreeName = line;
        let j = i + 1;
        while (j < lines.length && 
               !lines[j].includes('Institute') && 
               !lines[j].includes('University')) {
          degreeName += ' ' + lines[j];
          j++;
        }

        // Collect institution name from next lines
        let institution = lines[j];
        j++;
        while (j < lines.length && 
               !lines[j].match(/\d{4}/) && 
               !lines[j].includes('Advance') && 
               !lines[j].includes('A/L')) {
          institution += ' ' + lines[j];
          j++;
        }

        const period = lines[j] || '-';
        const location = lines[j + 1] || '-';
        const gpa = lines[j + 2] || '-';

        const educationEntry = {
          type: 'Degree',
          degree: degreeName,
          institution: institution,
          period: period,
          location: location,
          gpa: gpa
        };
        sections.education.push(educationEntry);
        i = j + 2; // Update i to skip processed lines
        continue;
      }

      // Check for Certificate/Course entries
      if (line.includes('Certificate') || line.includes('Course') || line.includes('Diploma') || line.includes('HND')) {
        // Collect certificate name from next lines until we find the institution
        let certificateName = line;
        let j = i + 1;
        while (j < lines.length && 
               !lines[j].includes('Institute') && 
               !lines[j].includes('University')) {
          certificateName += ' ' + lines[j];
          j++;
        }

        const institution = lines[j] || '-';
        const period = lines[j + 1] || '-';
        const location = lines[j + 2] || '-';

        const educationEntry = {
          type: 'Certificate',
          name: certificateName,
          institution: institution,
          period: period,
          location: location
        };
        sections.education.push(educationEntry);
        i = j + 2; // Update i to skip processed lines
        continue;
      }
    }

    // Process qualifications/experience entries
    if (currentSection === 'qualifications' && line.length > 0) {
      // Check for internship or job titles
      if (line.includes('Intern') || line.includes('Engineer') || line.includes('Developer')) {
        // Collect company name from next lines until we find a date
        let companyName = '';
        let j = i + 1;
        while (j < lines.length && !lines[j].match(/\d{4}/)) {
          companyName += (companyName ? ' ' : '') + lines[j];
          j++;
        }

        // Find the period (date)
        const period = lines[j] || '-';
        const location = lines[j + 1] || '-';

        // Collect description from subsequent lines until we hit another title or section
        let description = '';
        j = j + 2;
        while (j < lines.length && 
               !lines[j].includes('Intern') && 
               !lines[j].includes('Engineer') && 
               !lines[j].includes('Developer') &&
               !lines[j].toUpperCase().includes('PROJECTS') &&
               !lines[j].toUpperCase().includes('EDUCATION')) {
          description += (description ? '\n' : '') + lines[j];
          j++;
        }

        const qualificationEntry = {
          title: line,
          company: companyName,
          period: period,
          location: location,
          description: description
        };

        sections.qualifications.push(qualificationEntry);
        i = j - 1; // Update i to skip processed lines
      }
    }

    // Process projects entries
    if (currentSection === 'projects' && line.length > 0) {
      if (line.includes('Framework') || line.includes('System') || line.includes('Application')) {
        const projectEntry = {
          name: line,
          technology: lines[i + 1] || '-',
          description: lines[i + 2] || '-',
          link: lines[i + 3] || '-'
        };
        sections.projects.push(projectEntry);
        i += 3;
      }
    }
>>>>>>> 802fbf86e1396c8f80d8addc4adb19c8491ee90f
  }

  return sections;
}
<<<<<<< HEAD

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
=======
>>>>>>> 802fbf86e1396c8f80d8addc4adb19c8491ee90f
