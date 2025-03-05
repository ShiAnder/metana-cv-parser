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

  const form = formidable();
  form.parse(req, async (err, _, files) => {
    if (err) return res.status(500).json({ error: "File parsing error" });

    const file = files.file[0];
    const fileStream = fs.createReadStream(file.filepath);

    try {
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

      blobStream.on('error', (err) => {
        res.status(500).json({ error: err.message });
      });

      blobStream.on('finish', async () => {
        const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${file.originalFilename}`;

        // Save the extracted text to Google Sheets
        try {
          await saveToSheet({ name: file.originalFilename, content: extractedText });
        } catch (error) {
          return res.status(500).json({ error: "Error saving to Google Sheets: " + error.message });
        }

        // Send the response with the URL and the extracted text
        res.status(200).json({ url: publicUrl, extractedText });
      });

      fileStream.pipe(blobStream);

    } catch (error) {
      res.status(500).json({ error: "Error extracting text: " + error.message });
    }
  });
}
