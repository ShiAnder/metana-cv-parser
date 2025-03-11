import { Storage } from '@google-cloud/storage';
import saveToSheet from '../../lib/cvParser';
import sendConfirmationEmail from '../../lib/emailSender';
import sendWebhook from '../../lib/webhookSender';
import { redis } from '../../lib/redis';

// This endpoint is designed to be called by a webhook or scheduled task
// to continue processing an upload that may have been interrupted due to
// Vercel serverless function timeout limits

export default async function handler(req, res) {
  console.log('[Process Upload API] Called with method:', req.method);
  
  // Set CORS headers 
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight');
    return res.status(200).end();
  }
  
  // GET request to check status 
  if (req.method === 'GET') {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing id parameter',
        message: 'Please provide an upload ID to check the status'
      });
    }
    
    console.log(`[Process Upload API] Checking status for upload ID: ${id}`);
    
    try {
      // Query Redis for the status
      const uploadKey = `upload:${id}`;
      const status = await redis.get(uploadKey);
      
      if (!status) {
        console.log(`[Process Upload API] No status found for upload ID: ${id}`);
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'No upload found with this ID' 
        });
      }
      
      console.log(`[Process Upload API] Retrieved status for ${id}:`, JSON.stringify(status));
      return res.status(200).json({
        success: true,
        status
      });
    } catch (redisError) {
      console.error(`[Process Upload API] Error retrieving status from Redis:`, redisError);
      return res.status(500).json({
        success: false,
        error: 'Storage error',
        message: 'Error retrieving upload status'
      });
    }
  }
  
  // POST request to continue processing
  if (req.method === 'POST') {
    try {
      const { uploadId } = req.body;
      
      if (!uploadId) {
        return res.status(400).json({
          success: false,
          error: 'Missing upload ID',
          message: 'Upload ID is required'
        });
      }
      
      console.log(`[Process Upload API] Received processing request for upload ID: ${uploadId}`);
      
      // Check if upload exists in Redis
      const uploadKey = `upload:${uploadId}`;
      const uploadData = await redis.get(uploadKey);
      
      if (!uploadData) {
        console.log(`[Process Upload API] Upload not found: ${uploadId}`);
        return res.status(404).json({
          success: false,
          error: 'Upload not found',
          message: 'No upload found with this ID'
        });
      }
      
      console.log(`[Process Upload API] Found upload data:`, JSON.stringify(uploadData));
      
      // Return a response immediately (we'll process in the background)
      res.status(200).json({
        success: true,
        message: 'Processing started in the background',
        uploadId
      });
      
      // Update status to processing_without_buffer
      try {
        const currentStatus = await redis.get(uploadKey) || {};
        await redis.set(uploadKey, {
          ...currentStatus,
          stage: 'processing_without_buffer',
          progress: 40,
          lastUpdated: new Date().toISOString()
        });
        console.log(`[Process Upload API] Updated status to processing_without_buffer`);
      } catch (redisError) {
        console.error(`[Process Upload API] Error updating Redis status:`, redisError);
      }
      
      // Background processing
      try {
        console.log('[Process Upload API] Starting background webhook processing');
        
        // Update status to saving_to_sheets
        try {
          const currentStatus = await redis.get(uploadKey) || {};
          await redis.set(uploadKey, {
            ...currentStatus,
            stage: 'saving_to_sheets',
            progress: 60,
            lastUpdated: new Date().toISOString()
          });
          console.log(`[Process Upload API] Updated status to saving_to_sheets`);
        } catch (redisError) {
          console.error(`[Process Upload API] Error updating Redis status:`, redisError);
        }
        
        // Send webhook if needed
        let webhookSent = false;
        try {
          if (uploadData.fileInfo && uploadData.fields) {
            console.log('[Process Upload API] Sending webhook');
            webhookSent = await sendWebhook({
              name: uploadData.fields.name,
              email: uploadData.fields.email,
              phone: uploadData.fields.phone,
              fileName: uploadData.fileInfo.name,
              fileSize: uploadData.fileInfo.size,
              fileType: uploadData.fileInfo.type,
              uploadDate: new Date().toISOString()
            });
            console.log(`[Process Upload API] Webhook sent: ${webhookSent}`);
          }
        } catch (webhookError) {
          console.error('[Process Upload API] Webhook error:', webhookError);
        }
        
        // Update status to sending_email
        try {
          const currentStatus = await redis.get(uploadKey) || {};
          await redis.set(uploadKey, {
            ...currentStatus,
            stage: 'sending_email',
            progress: 80,
            webhookSent,
            lastUpdated: new Date().toISOString()
          });
          console.log(`[Process Upload API] Updated status to sending_email`);
        } catch (redisError) {
          console.error(`[Process Upload API] Error updating Redis status:`, redisError);
        }
        
        // Send email if we have the necessary data
        if (uploadData.fields && uploadData.fields.email) {
          try {
            console.log('[Process Upload API] Sending confirmation email');
            await sendConfirmationEmail(
              uploadData.fields.name,
              uploadData.fields.email,
              uploadData.fileInfo.name
            );
            console.log('[Process Upload API] Email sent successfully');
          } catch (emailError) {
            console.error('[Process Upload API] Email error:', emailError);
          }
        }
        
        // Update final status
        try {
          const currentStatus = await redis.get(uploadKey) || {};
          await redis.set(uploadKey, {
            ...currentStatus,
            stage: 'completed',
            progress: 100,
            lastUpdated: new Date().toISOString()
          });
          console.log(`[Process Upload API] Updated status to completed`);
        } catch (redisError) {
          console.error(`[Process Upload API] Error updating final Redis status:`, redisError);
        }
        
        console.log('[Process Upload API] Background processing completed');
      } catch (processingError) {
        console.error('[Process Upload API] Processing error:', processingError);
        
        // Update error status
        try {
          const currentStatus = await redis.get(uploadKey) || {};
          await redis.set(uploadKey, {
            ...currentStatus,
            stage: 'error',
            error: processingError.message,
            lastUpdated: new Date().toISOString()
          });
        } catch (redisError) {
          console.error(`[Process Upload API] Error updating Redis status:`, redisError);
        }
      }
    } catch (error) {
      console.error('[Process Upload API] Server error:', error);
      
      // If we haven't sent a response yet
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: 'Server error',
          message: error.message || 'An unexpected error occurred'
        });
      }
    }
  } else {
    // Method not allowed
    if (!res.headersSent) {
      return res.status(405).json({
        success: false,
        error: 'Method not allowed',
        message: 'Only GET and POST methods are allowed'
      });
    }
  }
} 