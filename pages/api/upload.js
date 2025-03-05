import { Storage } from '@google-cloud/storage';
import { formidable } from 'formidable';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import saveToSheet from "@/lib/googleSheets";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '10mb',
  },
};

async function extractText(buffer, mimeType) {
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
  // Log request details
  console.log('Request method:', req.method);
  console.log('Request headers:', req.headers);

  // Ensure it's a POST request
  if (req.method.toUpperCase() !== "POST") {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    // Configure formidable to keep file data in memory
    const form = formidable({
      keepExtensions: true,
      multiples: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      filter: function ({ mimetype }) {
        // Accept only PDF and DOCX files
        const isAllowed = mimetype && (
          mimetype.includes('pdf') ||
          mimetype.includes('document')
        );
        console.log('File type check:', mimetype, isAllowed ? 'allowed' : 'rejected');
        return isAllowed;
      }
    });

    // Parse the form data
    const formData = await new Promise((resolve, reject) => {
      const fileData = {
        chunks: [],
        info: null
      };

      form.onPart = (part) => {
        if (!part.mimetype) {
          // Handle non-file parts normally
          form._handlePart(part);
          return;
        }

        console.log('Receiving file part:', part.filename, part.mimetype);

        // Store file info when we first see the part
        fileData.info = {
          originalFilename: part.filename,
          mimetype: part.mimetype
        };
        
        part.on('data', (chunk) => {
          fileData.chunks.push(chunk);
        });

        part.on('end', () => {
          console.log('Finished receiving file part:', part.filename);
        });
      };

      form.parse(req, (err, fields) => {
        if (err) {
          console.error('Formidable error:', err);
          reject(err);
          return;
        }

        // Only create the file object if we have both info and chunks
        if (fileData.info && fileData.chunks.length > 0) {
          const buffer = Buffer.concat(fileData.chunks);
          console.log('File assembled:', fileData.info.originalFilename, 'Size:', buffer.length);
          resolve({
            fields,
            file: {
              ...fileData.info,
              buffer
            }
          });
        } else {
          console.log('No valid file data received');
          resolve({ fields, file: null });
        }
      });
    });

    if (!formData.file) {
      console.log('No file in form data');
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = formData.file;
    console.log('Processing file:', file.originalFilename, 'Type:', file.mimetype);

    try {
      // Extract text from the file based on mimeType
      const extractedText = await extractText(file.buffer, file.mimetype);
      console.log('Text extracted successfully, length:', extractedText?.length || 0);

      // Initialize Google Cloud Storage
      const storage = new Storage();
      const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
      console.log('Using GCS bucket:', process.env.GCS_BUCKET_NAME);

      // Generate a unique filename to prevent collisions
      const uniqueFilename = `${Date.now()}-${file.originalFilename}`;
      const blob = bucket.file(uniqueFilename);
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: file.mimetype,
      });

      blobStream.on('error', (err) => {
        console.error('Blob stream error:', err);
        res.status(500).json({ error: err.message });
      });

      blobStream.on('finish', async () => {
        const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${uniqueFilename}`;
        console.log('File uploaded to:', publicUrl);

        // Save the extracted text to Google Sheets
        try {
          await saveToSheet({ name: file.originalFilename, content: extractedText });
          console.log('Data saved to Google Sheets');
          
          // Send the response with the URL and the extracted text
          res.status(200).json({ 
            url: publicUrl, 
            extractedText,
            filename: file.originalFilename
          });
        } catch (error) {
          console.error('Google Sheets error:', error);
          res.status(500).json({ error: "Error saving to Google Sheets: " + error.message });
        }
      });

      // Write the buffer directly to Google Cloud Storage
      blobStream.end(file.buffer);

    } catch (error) {
      console.error('Processing error:', error);
      res.status(500).json({ error: "Error processing file: " + error.message });
    }
  } catch (error) {
    console.error('Main error:', error);
    res.status(500).json({ error: error.message });
  }
}
