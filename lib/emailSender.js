import { Resend } from 'resend';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends a confirmation email to applicants after CV submission
 * @param {string} name - Applicant's name
 * @param {string} email - Applicant's email address
 * @param {string} filename - Name of the CV file
 * @returns {Promise<boolean>} - Whether the email was sent successfully
 */
export async function sendConfirmationEmail(name, email, filename) {
  try {
    console.log(`Sending confirmation email to ${email}...`);
    
    // Prepare applicant name
    const applicantName = name && name !== 'N/A' ? name : 'Applicant';
    
    // Email content
    const subject = 'Your CV Application Confirmation';
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #4338ca;">CV Application Received</h1>
        </div>
        
        <p>Dear ${applicantName},</p>
        
        <p>Thank you for submitting your CV (<strong>${filename}</strong>). Your application has been received and is currently under review.</p>
        
        <p>Our team will carefully evaluate your qualifications and experience. If your profile matches our requirements, we will contact you for the next steps in the application process.</p>
        
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Please Note:</strong> This email is automatically generated. Please do not reply to this message.</p>
        </div>
        
        <p>Best regards,</p>
        <p>The Recruitment Team</p>
      </div>
    `;
    
    // Send the email using Resend
    const { data, error } = await resend.emails.send({
      from: 'Metana CV Parser <onboarding@resend.dev>',
      to: email,
      subject: subject,
      html: htmlContent,
    });
    
    if (error) {
      console.error('Email sending failed:', error);
      return false;
    }
    
    console.log('Confirmation email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error sending confirmation email:', error);
    return false;
  }
}

export default sendConfirmationEmail; 