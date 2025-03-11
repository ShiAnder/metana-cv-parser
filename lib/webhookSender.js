import axios from 'axios';
import { kv } from '@vercel/kv';

/**
 * Sends CV data to a webhook endpoint
 * @param {Object} cvData Processed CV data structure
 * @param {string} name Applicant name
 * @param {string} email Applicant email
 * @param {string} cvUrl URL to the CV file
 * @returns {Promise<Object>} Response from webhook
 */
async function sendWebhook(cvData, name, email, cvUrl) {
  try {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      console.log('No webhook URL configured. Skipping webhook.');
      return null;
    }

    console.log('Sending webhook with processed CV data...');
    
    // Ensure personal_info is a non-empty object
    const personalInfo = cvData.personalInfo || {};
    
    // If personalInfo is empty, create a minimal valid structure
    if (Object.keys(personalInfo).length === 0) {
      personalInfo.name = name || 'Not provided';
      personalInfo.email = email || 'Not provided';
      personalInfo.phone = cvData.phone || 'Not provided';
    }
    
    // Prepare the webhook payload in the expected format
    const webhookPayload = {
      cv_data: {
        personal_info: personalInfo,
        education: cvData.education || [],
        qualifications: cvData.qualifications || [],
        projects: cvData.projects || [],
        cv_public_link: cvUrl || 'N/A'
      },
      metadata: {
        applicant_name: name || personalInfo.name || 'Unknown',
        email: email || personalInfo.email || 'Unknown',
        status: 'testing',
        cv_processed: true,
        processed_timestamp: new Date().toISOString(),
        gcs_upload_success: Boolean(cvUrl && !cvUrl.startsWith('local://'))
      }
    };
    
    console.log('Webhook payload:', JSON.stringify(webhookPayload, null, 2));
    
    // Send the webhook
    const response = await axios.post(webhookUrl, webhookPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Webhook sent successfully. Status: ${response.status}`);

    // Store status
    await kv.set(`upload:${response.data.uploadId}`, { 
      stage: 'received',
      progress: 0,
      // other data
    });

    return response.data;
  } catch (error) {
    console.error(`Webhook failed: ${error.response?.status || error.message} ${error.response?.data || ''}`);
    return null;
  }
}

export default sendWebhook; 