import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import CommonModel from '../../modules/models/mysql/commonModel/commonModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reusable filler function
function fillPlaceholders(template, data) {
  let out = template ?? '';
  for (const [key, value] of Object.entries(data || {})) {
    out = out.replace(new RegExp(`{${key}}`, 'g'), String(value ?? ''));
  }
  return out;
}

// Resolve common header/footer path
const commonWrapperPath = path.resolve(
  __dirname,
  '../../Modules/Views/common/emailTemplate/emailLayout.ejs'
);

/**
 * Get campaign email content with layout
 */
export async function getCampaignEmailContent(data, templateSlug) {
  if (!templateSlug || !data) return getFallbackEmail(data || {});
 
  try {
    const condition = `slug = '${templateSlug}' AND status = 'Active'`;
    const templates = await CommonModel.getData('crm_email_campaign_template', '*', condition);

    if (!templates || templates.length === 0) {
      console.warn(`Template not found: ${templateSlug}. Using fallback.`);
      return getFallbackEmail(data);
    }

    const templateData = templates[0];
    const rawBody = templateData.email_content || '';
    const rawSubject = templateData.email_subject || '';

    const filledBody = fillPlaceholders(rawBody, data);
    const filledSubject = fillPlaceholders(rawSubject, data);

    const fullHtml = await ejs.renderFile(commonWrapperPath, { 
      message: filledBody 
    });

    return { 
      html: fullHtml, 
      subject: filledSubject 
    };
    
  } catch (error) {
    console.error('Error generating campaign email:', error);
    return getFallbackEmail(data);
  }
}

/**
 * Get process email content with layout (for process module)
 */
export async function getProcessEmailContent(data, emailContent, emailSubject) {
  if (!emailContent || !emailSubject) {
    return getFallbackEmail(data);
  }

  try {
    const filledBody = fillPlaceholders(emailContent, data);
    const filledSubject = fillPlaceholders(emailSubject, data);

    const fullHtml = await ejs.renderFile(commonWrapperPath, { 
      message: filledBody 
    });

    return { 
      html: fullHtml, 
      subject: filledSubject 
    };
    
  } catch (error) {
    console.error('Error generating process email:', error);
    return getFallbackEmail(data);
  }
}

/**
 * Get signup verification OTP email content
 */
export async function getSignupVerificationOTPEmailContent(data, templateSlug) {
  if (!templateSlug || !data) return null;
 
  try {
    const condition = `slug = '${templateSlug}' AND status = 'Active'`;
    const templates = await CommonModel.getData('crm_email_campaign_template', '*', condition);

    if (!templates || templates.length === 0) {
      console.warn(`Template not found: ${templateSlug}.`);
      return null;
    }

    const templateData = templates[0];
    const rawBody = templateData.email_content || '';
    const rawSubject = templateData.email_subject || '';

    const filledBody = fillPlaceholders(rawBody, data);
    const filledSubject = fillPlaceholders(rawSubject, data);

    const fullHtml = await ejs.renderFile(commonWrapperPath, { 
      message: filledBody 
    });

    return { 
      html: fullHtml, 
      subject: filledSubject 
    };
    
  } catch (error) {
    console.error('Error generating signup email:', error);
    return null;
  }
}

/**
 * Get email content body from template
 */
export async function getEmailContentBody(data, templateSlug) {
  if (!templateSlug || !data) return null;
 
  try {
    const condition = `slug = '${templateSlug}' AND status = 'Active'`;
    const templates = await CommonModel.getData('crm_email_campaign_template', '*', condition);

    if (!templates || templates.length === 0) {
      console.warn(`Template not found: ${templateSlug}.`);
      return null;
    }

    const templateData = templates[0];
    const rawBody = templateData.email_content || '';
    const rawSubject = templateData.email_subject || '';

    const filledBody = fillPlaceholders(rawBody, data);
    const filledSubject = fillPlaceholders(rawSubject, data);

    const fullHtml = await ejs.renderFile(commonWrapperPath, { 
      message: filledBody 
    });

    return { 
      fullHtml: fullHtml, 
      subject: filledSubject,
      html: filledBody
    };
    
  } catch (error) {
    console.error('Error generating email content:', error);
    return null;
  }
}

/**
 * Get staff assignment email content
 */
export async function getStaffAssignEmailContent(data, templateSlug) {
  if (!templateSlug || !data) return null;
 
  try {
    const condition = `slug = '${templateSlug}' AND status = 'Active'`;
    const templates = await CommonModel.getData('crm_email_campaign_template', '*', condition);

    if (!templates || templates.length === 0) {
      console.warn(`Template not found: ${templateSlug}.`);
      return null;
    }

    const templateData = templates[0];
    const rawBody = templateData.email_content || '';
    const rawSubject = templateData.email_subject || '';

    const filledBody = fillPlaceholders(rawBody, data);
    const filledSubject = fillPlaceholders(rawSubject, data);

    const fullHtml = await ejs.renderFile(commonWrapperPath, { 
      message: filledBody 
    });

    return { 
      html: fullHtml, 
      subject: filledSubject 
    };
    
  } catch (error) {
    console.error('Error generating staff assign email:', error);
    return null;
  }
}

/**
 * Get company welcome email content
 */
export async function getCompanyWelcomeEmailContent(data, templateSlug) {
  if (!templateSlug || !data) return null;
 
  try {
    const condition = `slug = '${templateSlug}' AND status = 'Active'`;
    const templates = await CommonModel.getData('crm_email_campaign_template', '*', condition);

    if (!templates || templates.length === 0) {
      console.warn(`Template not found: ${templateSlug}.`);
      return null;
    }

    const templateData = templates[0];
    const rawBody = templateData.email_content || '';
    const rawSubject = templateData.email_subject || '';

    const filledBody = fillPlaceholders(rawBody, data);
    const filledSubject = fillPlaceholders(rawSubject, data);

    const fullHtml = await ejs.renderFile(commonWrapperPath, { 
      message: filledBody 
    });

    return { 
      html: fullHtml, 
      subject: filledSubject 
    };
    
  } catch (error) {
    console.error('Error generating welcome email:', error);
    return null;
  }
}

/**
 * Fallback email if template fails or not found
 */
function getFallbackEmail(data) {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
      <h2 style="color: #005E6A;">Hello ${data.name || data.first_name || 'User'}!</h2>
      <p>${data.message || 'Thank you for connecting with us.'}</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">
        This is an automated message from our system.
      </p>
    </div>
  `;
  
  return {
    html: html,
    subject: data.subject || 'Notification from our Team'
  };
}