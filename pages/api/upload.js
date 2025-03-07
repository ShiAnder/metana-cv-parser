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

    // Ensure we have a valid filename and convert to string
    const originalFilename = String(file.originalFilename || '');
    if (!originalFilename || originalFilename === 'undefined') {
      throw new Error('Invalid or missing filename');
    }

    // Sanitize the filename to remove any potentially problematic characters
    const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    // Generate a unique filename while preserving the original name
    const uniqueFilename = `${Date.now()}-${sanitizedFilename}`;
    console.log('Uploading file with name:', uniqueFilename, 'Original name:', originalFilename);
    
    const blob = bucket.file(uniqueFilename);

    // Upload directly using buffer without setting ACL
    await blob.save(file.buffer, {
      contentType: file.mimetype,
      metadata: {
        cacheControl: 'public, max-age=31536000',
        originalFilename: originalFilename // Store original filename in metadata
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
      let fields = {};

      form.onPart = (part) => {
        if (!part.mimetype) {
          // This is a non-file field
          form._handlePart(part);
          return;
        }

        console.log('Received file part:', {
          name: part.filename,
          mimetype: part.mimetype
        });

        const chunks = [];
        
        part.on('data', (chunk) => {
          chunks.push(chunk);
        });

        part.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
          fileInfo = {
            originalFilename: String(part.filename || ''),
            mimetype: part.mimetype,
          };
          console.log('File info after processing:', fileInfo);
        });
      };

      form.parse(req, (err, parsedFields) => {
        if (err) {
          reject(err);
          return;
        }

        fields = parsedFields;
        console.log('Parsed fields:', fields);

        if (!fileBuffer || !fileInfo) {
          resolve({ fields, file: null });
          return;
        }

        // Use the separately sent filename if available
        if (fields.filename) {
          fileInfo.originalFilename = String(fields.filename);
        }

        // Ensure filename is valid
        if (!fileInfo.originalFilename || fileInfo.originalFilename === 'undefined') {
          const extension = fileInfo.mimetype === 'application/pdf' ? '.pdf' : '.docx';
          fileInfo.originalFilename = `unnamed-file-${Date.now()}${extension}`;
        }

        console.log('Final file info:', {
          filename: fileInfo.originalFilename,
          mimetype: fileInfo.mimetype
        });

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

    // Initialize Google Cloud Storage with credentials from environment variable
    const storage = new Storage({
      credentials: JSON.parse(process.env.GCS_CREDENTIALS),
    });

    // Process everything in sequence
    try {
      const extractedText = await extractText(formData.file.buffer, formData.file.mimetype);
      if (!extractedText) {
        throw new Error('Failed to extract text from the file');
      }

      const publicUrl = await uploadToGCS(formData.file, storage);
      if (!publicUrl) {
        throw new Error('Failed to upload file to Google Cloud Storage');
      }

      await saveToSheet({ 
        name: formData.fields.name || 'N/A',
        email: formData.fields.email || 'N/A',
        phone: formData.fields.phone || 'N/A',
        content: extractedText,
        cvUrl: publicUrl
      });

      if (!responseWasSent) {
        responseWasSent = true;
        return res.status(200).json({
          success: true,
          url: publicUrl,
          extractedText,
          filename: formData.file.originalFilename,
          name: formData.fields.name,
          email: formData.fields.email,
          phone: formData.fields.phone
        });
      }
    } catch (processError) {
      console.error('Processing error:', processError);
      if (!responseWasSent) {
        responseWasSent = true;
        return res.status(500).json({ 
          success: false,
          error: processError.message || 'Error processing file',
          details: process.env.NODE_ENV === 'development' ? processError.stack : undefined
        });
      }
    }
  } catch (error) {
    console.error('Request error:', error);
    if (!responseWasSent) {
      responseWasSent = true;
      return res.status(500).json({ 
        success: false,
        error: 'Error processing request',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
}
