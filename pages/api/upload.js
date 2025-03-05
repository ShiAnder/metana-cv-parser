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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const form = formidable();
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const file = files.file[0];
    const fileStream = fs.createReadStream(file.filepath);

    // Extract text from the file based on mimeType
    const extractedText = await extractText(file.filepath, file.mimetype);

    // Initialize Google Cloud Storage
    const storage = new Storage();
    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

    const blob = bucket.file(file.originalFilename);
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
    });

    await new Promise((resolve, reject) => {
      blobStream.on('error', (err) => {
        reject(err);
      });

      blobStream.on('finish', async () => {
        const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${file.originalFilename}`;

        try {
          // Save the extracted text to Google Sheets
          await saveToSheet({ name: file.originalFilename, content: extractedText });
          
          // Send the response with the URL and the extracted text
          res.status(200).json({ url: publicUrl, extractedText });
          resolve();
        } catch (error) {
          reject(new Error("Error saving to Google Sheets: " + error.message));
        }
      });

      fileStream.pipe(blobStream);
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || "Error processing upload" });
  }
}
