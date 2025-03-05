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

async function uploadToGCS(file, storage) {
  try {
    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
    console.log('Using GCS bucket:', process.env.GCS_BUCKET_NAME);

    // Generate a unique filename to prevent collisions
    const uniqueFilename = `${Date.now()}-${file.originalFilename}`;
    const blob = bucket.file(uniqueFilename);

    // Upload directly using buffer without setting ACL
    await blob.save(file.buffer, {
      contentType: file.mimetype,
      metadata: {
        cacheControl: 'public, max-age=31536000',
      },
    });

    // Construct the URL using the bucket's public URL
    const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${uniqueFilename}`;
    return publicUrl;
  } catch (error) {
    console.error('GCS upload error:', error);
    throw new Error(`Failed to upload to GCS: ${error.message}`);
  }
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

  let responseWasSent = false;

  try {
    // Configure formidable to keep file data in memory
    const form = formidable({
      keepExtensions: true,
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
      let fileBuffer = null;
      let fileInfo = null;

      form.onPart = (part) => {
        if (!part.mimetype) {
          form._handlePart(part);
          return;
        }

        const chunks = [];
        
        part.on('data', (chunk) => {
          chunks.push(chunk);
        });

        part.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
          fileInfo = {
            originalFilename: part.filename,
            mimetype: part.mimetype,
          };
        });
      };

      form.parse(req, (err, fields) => {
        if (err) {
          reject(err);
          return;
        }

        if (!fileBuffer || !fileInfo) {
          resolve({ fields, file: null });
          return;
        }

        resolve({
          fields,
          file: {
            ...fileInfo,
            buffer: fileBuffer
          }
        });
      });
    });

    if (!formData.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Initialize Google Cloud Storage
    const storage = new Storage();

    // Process everything in sequence
    const extractedText = await extractText(formData.file.buffer, formData.file.mimetype);
    const publicUrl = await uploadToGCS(formData.file, storage);
    await saveToSheet({ 
      name: formData.file.originalFilename, 
      content: extractedText 
    });

    if (!responseWasSent) {
      responseWasSent = true;
      return res.status(200).json({
        url: publicUrl,
        extractedText,
        filename: formData.file.originalFilename
      });
    }

  } catch (error) {
    console.error('Error:', error);
    if (!responseWasSent) {
      responseWasSent = true;
      return res.status(500).json({ 
        error: `Error processing file: ${error.message}` 
      });
    }
  }
}
