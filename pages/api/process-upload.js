import { Storage } from '@google-cloud/storage';
import saveToSheet from '../../lib/cvParser';
import sendConfirmationEmail from '../../lib/emailSender';
import { kv } from '@vercel/kv';

// This endpoint is designed to be called by a webhook or scheduled task
// to continue processing an upload that may have been interrupted due to
// Vercel serverless function timeout limits

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed',
      message: 'Only POST is allowed for this endpoint'
    });
  }

  try {
    // Get upload data from request body
    const { uploadId, stage, fileBuffer, fileInfo, fields, extractedText } = req.body;
    
    if (!uploadId || !fileInfo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required data',
        message: 'Upload ID and file information are required'
      });
    }
    
    console.log(`[ProcessUpload] Continuing processing for upload ${uploadId} from stage ${stage || 'unknown'}`);
    
    // Send an immediate response to prevent timeout
    res.status(202).json({
      success: true,
      message: 'Processing continuing in background',
      uploadId,
      stage: stage || 'continuing'
    });
    
    // Check if there's already status in KV
    const uploadKey = `upload:${uploadId}`;
    let currentStatus;
    
    try {
      currentStatus = await kv.get(uploadKey);
      console.log(`[ProcessUpload] Retrieved current status from KV: ${JSON.stringify(currentStatus)}`);
    } catch (kvError) {
      console.error(`[ProcessUpload] Error retrieving status from KV: ${kvError.message}`);
      // Create a new status if not found
      currentStatus = { 
        stage: stage || 'unknown',
        progress: 0,
        startTime: new Date().toISOString()
      };
    }
    
    // If no status was found, create an initial status
    if (!currentStatus) {
      console.log(`[ProcessUpload] No status found, creating initial status`);
      currentStatus = { 
        stage: stage || 'unknown',
        progress: 0,
        startTime: new Date().toISOString()
      };
      
      try {
        await kv.set(uploadKey, currentStatus);
        await kv.expire(uploadKey, 3600); // 1 hour TTL
      } catch (kvSetError) {
        console.error(`[ProcessUpload] Error setting initial status: ${kvSetError.message}`);
      }
    }
    
    // Continue processing from the appropriate stage
    try {
      let cvUrl = null;
      let text = extractedText || null;
      
      // Process based on current stage
      switch(stage) {
        case 'received':
          // Start from the beginning
          // We would need the file buffer here, but it might be too large to pass
          // In a production system, this would use a shared storage or database
          console.log(`[ProcessUpload] Starting from beginning, but file buffer not available`);
          
          // Update status to show we're trying to process
          try {
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'processing_without_buffer',
              progress: 15,
              lastUpdated: new Date().toISOString()
            });
          } catch (kvUpdateError) {
            console.error(`[ProcessUpload] Error updating status: ${kvUpdateError.message}`);
          }
          break;
          
        case 'extracting_text':
          // If text extraction was interrupted
          // Same issue as above - we need the file buffer
          console.log(`[ProcessUpload] Text extraction stage, but file buffer not available`);
          
          // Update status to show we're trying to process
          try {
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'processing_without_buffer',
              progress: 25,
              lastUpdated: new Date().toISOString()
            });
          } catch (kvUpdateError) {
            console.error(`[ProcessUpload] Error updating status: ${kvUpdateError.message}`);
          }
          break;
          
        case 'uploading_to_cloud':
          // If the file upload was interrupted
          // Same issue - would need file buffer
          console.log(`[ProcessUpload] Upload stage, but file buffer not available`);
          
          // Update status to show we're trying to process
          try {
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'processing_without_buffer',
              progress: 35,
              lastUpdated: new Date().toISOString()
            });
          } catch (kvUpdateError) {
            console.error(`[ProcessUpload] Error updating status: ${kvUpdateError.message}`);
          }
          break;
          
        case 'saving_to_sheets':
          // If Google Sheets saving was interrupted
          console.log(`[ProcessUpload] Continuing with Google Sheets integration`);
          
          // Update status to show we're saving to sheets
          try {
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'saving_to_sheets',
              progress: 65,
              lastUpdated: new Date().toISOString()
            });
          } catch (kvUpdateError) {
            console.error(`[ProcessUpload] Error updating status: ${kvUpdateError.message}`);
          }
          
          // Prepare data for processing
          const parsedData = {
            content: text || 'Text extraction not completed',
            extractedText: text || 'Text extraction not completed',
            cvUrl: fileInfo.gcsUrl || 'N/A',
            name: fields.name,
            email: fields.email,
            phone: fields.phone,
            filename: fileInfo.name,
            mimeType: fileInfo.type,
            size: fileInfo.size,
            uploadDate: new Date().toISOString()
          };
          
          // Save to Google Sheets
          try {
            await saveToSheet(parsedData);
            console.log(`[ProcessUpload] Data saved to sheet successfully`);
            
            // Update status to show we're sending email
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'sending_email',
              progress: 80,
              lastUpdated: new Date().toISOString()
            });
          } catch (sheetError) {
            console.error(`[ProcessUpload] Sheet error:`, sheetError);
            
            // Update status to show error
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'error',
              error: `Sheet error: ${sheetError.message}`,
              progress: 70,
              lastUpdated: new Date().toISOString()
            });
            
            throw sheetError;
          }
          
          // Continue to next stage (sending email)
          console.log(`[ProcessUpload] Sending confirmation email...`);
          try {
            await sendConfirmationEmail(fields.name, fields.email, fileInfo.name);
            console.log(`[ProcessUpload] Email sent successfully`);
            
            // Update status to completed
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'completed',
              progress: 100,
              lastUpdated: new Date().toISOString()
            });
          } catch (emailError) {
            console.error(`[ProcessUpload] Email error:`, emailError);
            
            // Even if email fails, mark as mostly completed
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'completed_without_email',
              progress: 90,
              error: `Email error: ${emailError.message}`,
              lastUpdated: new Date().toISOString()
            });
          }
          
          console.log(`[ProcessUpload] Processing completed for upload ${uploadId}`);
          break;
          
        case 'sending_email':
          // If just the email sending was interrupted
          console.log(`[ProcessUpload] Sending confirmation email...`);
          
          // Update status to show we're sending email
          try {
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'sending_email',
              progress: 80,
              lastUpdated: new Date().toISOString()
            });
          } catch (kvUpdateError) {
            console.error(`[ProcessUpload] Error updating status: ${kvUpdateError.message}`);
          }
          
          try {
            await sendConfirmationEmail(fields.name, fields.email, fileInfo.name);
            console.log(`[ProcessUpload] Email sent successfully`);
            
            // Update status to completed
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'completed',
              progress: 100,
              lastUpdated: new Date().toISOString()
            });
          } catch (emailError) {
            console.error(`[ProcessUpload] Email error:`, emailError);
            
            // Even if email fails, mark as mostly completed
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'completed_without_email',
              progress: 90,
              error: `Email error: ${emailError.message}`,
              lastUpdated: new Date().toISOString()
            });
          }
          
          console.log(`[ProcessUpload] Processing completed for upload ${uploadId}`);
          break;
          
        default:
          console.log(`[ProcessUpload] Unknown stage ${stage}, unable to continue processing`);
          
          // Update status to show error with unknown stage
          try {
            await kv.set(uploadKey, {
              ...currentStatus,
              stage: 'error',
              error: `Unknown stage: ${stage}`,
              lastUpdated: new Date().toISOString()
            });
          } catch (kvUpdateError) {
            console.error(`[ProcessUpload] Error updating status: ${kvUpdateError.message}`);
          }
      }
      
    } catch (processingError) {
      console.error(`[ProcessUpload] Error continuing processing:`, processingError);
      
      // Update status to show error
      try {
        await kv.set(uploadKey, {
          ...currentStatus,
          stage: 'error',
          error: processingError.message,
          lastUpdated: new Date().toISOString()
        });
      } catch (kvUpdateError) {
        console.error(`[ProcessUpload] Error updating error status: ${kvUpdateError.message}`);
      }
    }
    
  } catch (error) {
    console.error('Server error:', error);
    // If we haven't sent a response yet
    if (!res.headersSent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Server error',
        message: error.message || 'An unexpected error occurred'
      });
    }
  }
} 