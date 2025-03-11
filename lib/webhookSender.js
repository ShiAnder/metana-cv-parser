import nodeFetch from 'node-fetch';

const fetch = nodeFetch; // Use nodeFetch as fetch

/**
 * Sends processed CV data to a webhook endpoint
 * @param {Object} parsedData - The parsed CV data
 * @param {string} name - Applicant name
 * @param {string} email - Applicant email
 * @param {string} cvUrl - URL to the uploaded CV file
 * @returns {Promise<boolean>} - Whether the webhook was sent successfully
 */
export async function sendWebhook(parsedData, name, email, cvUrl) {
  try {
    console.log('Sending webhook with processed CV data...');
    
    // Handle local file paths from GCS upload failures
    const isLocalFile = typeof cvUrl === 'string' && cvUrl.startsWith('local://');
    const publicCvUrl = isLocalFile ? 'Not available - GCS upload failed' : cvUrl;
    
    // Construct the webhook payload
    const webhookPayload = {
      cv_data: {
        personal_info: parsedData.personalInfo || {},
        education: parsedData.education || [],
        qualifications: parsedData.qualifications || [],
        projects: parsedData.projects || [],
        cv_public_link: publicCvUrl || "N/A"
      },
      metadata: {
        applicant_name: name,
        email: email,
        status: "testing", // Use "testing" for test submissions
        cv_processed: true,
        processed_timestamp: new Date().toISOString(),
        gcs_upload_success: !isLocalFile
      }
    };
    
    // Log the webhook payload for debugging
    console.log('Webhook payload:', JSON.stringify(webhookPayload, null, 2));
    
    // Set up headers including the candidate email
    const headers = {
      'Content-Type': 'application/json',
      'X-Candidate-Email': 'withanageshihan@gmail.com' // Email used to apply for the role at Metana
    };
    
    // Send the webhook
    const webhookResponse = await fetch('https://rnd-assignment.automations-3d6.workers.dev/', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(webhookPayload)
    });
    
    if (webhookResponse.ok) {
      console.log('Webhook sent successfully:', await webhookResponse.text());
      return true;
    } else {
      console.error('Webhook failed:', webhookResponse.status, await webhookResponse.text());
      return false;
    }
  } catch (webhookError) {
    console.error('Error sending webhook:', webhookError);
    return false;
  }
}

export default sendWebhook; 