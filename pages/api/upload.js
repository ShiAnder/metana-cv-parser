import { Storage } from '@google-cloud/storage';
import { formidable } from 'formidable';
import fs from 'fs';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import saveToSheet from "@/lib/googleSheets";  // Import the saveToSheet function

export const config = { api: { bodyParser: false } };

async function extractText(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);

  if (mimeType === 'application/pdf') {
    const data = await pdf(buffer);
    return data.text;
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const data = await mammoth.extractRawText({ buffer });
    return data.value;
  }

  return null;
}

export default async function handler(req, res) {
  console.log('Request method:', req.method);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable({
      uploadDir: './uploads',
      keepExtensions: true,
      multiples: true,
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          console.error('Formidable error:', err);
          reject(err);
          return;
        }
        resolve([fields, files]);
      });
    });

    console.log('Files received:', files);

    if (!files.file || !files.file[0]) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = files.file[0];
    console.log('Processing file:', file.originalFilename, 'Type:', file.mimetype);

    const fileStream = fs.createReadStream(file.filepath);

    try {
      // Extract text from the file based on mimeType
      const extractedText = await extractText(file.filepath, file.mimetype);
      console.log('Text extracted successfully');

      // Initialize Google Cloud Storage
      const storage = new Storage();
      const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

      const blob = bucket.file(file.originalFilename);
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: file.mimetype,
      });

      blobStream.on('error', (err) => {
        console.error('Blob stream error:', err);
        res.status(500).json({ error: err.message });
      });

      blobStream.on('finish', async () => {
        const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${file.originalFilename}`;
        console.log('File uploaded to:', publicUrl);

        // Save the extracted text to Google Sheets
        try {
          await saveToSheet({ name: file.originalFilename, content: extractedText });
          console.log('Data saved to Google Sheets');
        } catch (error) {
          console.error('Google Sheets error:', error);
          return res.status(500).json({ error: "Error saving to Google Sheets: " + error.message });
        }

        // Send the response with the URL and the extracted text
        res.status(200).json({ url: publicUrl, extractedText });
      });

      fileStream.pipe(blobStream);

    } catch (error) {
      console.error('Processing error:', error);
      res.status(500).json({ error: "Error extracting text: " + error.message });
    }
  } catch (error) {
    console.error('Main error:', error);
    res.status(500).json({ error: error.message });
  }
}
