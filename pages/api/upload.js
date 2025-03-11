import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import saveToSheet from '../../lib/cvParser'; // Import the updated saveToSheet function
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

// Ensure the temp directory exists
const tempDir = path.resolve('./temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

export const config = {
  api: {
    bodyParser: false, // Disable Next.js default body parsing to handle file uploads
  },
};

// Function to extract text from a file (PDF/Word)
async function extractText(filePath, mimeType) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (mimeType === 'application/pdf') {
      const data = await pdf(new Uint8Array(buffer));
      return data.text;
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const data = await mammoth.extractRawText({ buffer });
      return data.value;
    }
    return null;
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error('Failed to extract text from file');
  }
}

// Function to upload file to Google Cloud Storage
async function uploadToGCS(filePath, originalFilename) {
  try {
    // Initialize storage with credentials from environment variable
    const storageConfig = JSON.parse(process.env.GCS_CREDENTIALS);
    const storage = new Storage({
      projectId: storageConfig.project_id,
      credentials: {
        client_email: storageConfig.client_email,
        private_key: storageConfig.private_key,
      },
    });

    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
    const sanitizedFilename = `${Date.now()}-${originalFilename.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    const file = bucket.file(sanitizedFilename);

    // Upload file with proper options
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath)
        .pipe(file.createWriteStream({
          resumable: false,
          validation: false,
          metadata: {
            contentType: 'application/pdf', // Set appropriate content type
            cacheControl: 'public, max-age=31536000',
          },
        }));

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        reject(err);
      });

      stream.on('finish', () => {
        resolve();
      });
    });

    // Make the file public
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${sanitizedFilename}`;
    return publicUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error(`Failed to upload to Google Cloud Storage: ${error.message}`);
  }
}

// Main handler function for file upload
export default async function handler(req, res) {
  const form = new IncomingForm({
    keepExtensions: true,
    uploadDir: tempDir,
    multiples: false,
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Error in form parsing:', err);
      return res.status(400).json({ error: 'File upload failed', details: err.message });
    }

    try {
      const uploadedFile = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : null;
      if (!uploadedFile) {
        return res.status(400).json({ error: 'No file uploaded or incorrect field name' });
      }

      const mimeType = uploadedFile.mimetype;
      const originalFilename = uploadedFile.originalFilename;
      const tempFilePath = uploadedFile.filepath;
      const newFilePath = path.join(tempDir, originalFilename);

      // Rename file to keep original filename
      fs.renameSync(tempFilePath, newFilePath);

      // Extract text from the renamed file
      const text = await extractText(newFilePath, mimeType);

      if (!text) {
        throw new Error('Unsupported file format');
      }

      // Upload to Google Cloud Storage
      const cvUrl = await uploadToGCS(newFilePath, originalFilename);

      // Prepare data to save
      const parsedData = {
        content: text,
        cvUrl,
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        filename: originalFilename, // Include the filename in the data
      };

      // Save extracted data to Google Sheets
      await saveToSheet(parsedData);

      console.log("This is the parsed data in upload.js:", JSON.stringify(parsedData, null, 2));

      // Return success response
      return res.status(200).json({ message: 'CV processed successfully' });
    } catch (error) {
      console.error('Error processing request:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  });
}
