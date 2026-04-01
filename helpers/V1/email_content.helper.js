import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import CommonModel from '../../modules/models/mysql/commonModel/commonModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reusable filler function (same as your existing one)
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

    // Fill placeholders in body and subject
    const filledBody = fillPlaceholders(rawBody, data);
    const filledSubject = fillPlaceholders(rawSubject, data);

    // Render with layout
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
 * Fallback email if template fails or not found
 */
function getFallbackEmail(data) {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
      <h1 style="color: #005E6A;">Hello ${data.name || 'User'}!</h1>
      <p>${data.message || 'Thank you for reaching out to us.'}</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">
        You received this because of your activity on our platform.
        <br>
        <a href="${data.unsubscribe_link || '#'}" style="color: #005E6A;">Unsubscribe</a>
      </p>
    </div>
  `;
  
  return {
    html: html,
    subject: data.subject || 'Notification from our Team'
  };
}