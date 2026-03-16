// Helpers/email_content.helper.js (ESM)
// import CommonModel from '../../../Models/MySQL/commonModel.js';
const VERSION = process.env.WEBSITE_VERSION;
const { default: CommonModel } = await import(
  `../../../Modules/Models/Website/MySQL/commonModel/commonModel.js`
);

import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reusable filler
function fillPlaceholders(template, data) {
  let out = template ?? '';
  for (const [key, value] of Object.entries(data || {})) {
    out = out.replace(new RegExp(`{${key}}`, 'g'), String(value ?? ''));
  }
  return out;
}

// Resolve common header/footer path once
const commonWrapperPath = path.resolve(
  __dirname,
  '../../../Modules/Views/common/emailTemplate/emailLayout.ejs'
);
export async function getSignupVerificationOTPEmailContent(data, templateName) {
  if (!templateName || !data) return false;

  try {
    const condition = `email_slug = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, { otp: data.otp });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    // console.log('Generated Email HTML:', fullHtml);
    
    return fullHtml;
  } catch (error) {
    console.error('Error generating signup verification email:', error);
    return false;
  }
}

export async function getMeetingCancelledEmailContent(data, templateName) {
  if (!templateName || !data) return false;

  try {
    const condition = `template_entity = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';

    const dateStr = data.interview_date
      ? new Date(data.interview_date).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '';

    const filledBody = fillPlaceholders(emailBody, {
      position_name: data.job_title,
      first_name: data.full_name,
      company_name: data.company_name,
      date: dateStr,
    });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return fullHtml;
  } catch (error) {
    console.error('Error generating meeting cancelled email:', error);
    return false;
  }
}


export async function getOTPEmailContent(data, templateName){
  if (!templateName || !data) return false;
  try {
    const condition = `email_slug = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, { code: data.otp,name:data.full_name });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return fullHtml;
  } catch (error) {
    console.error('Error generating signup verification email:', error);
    return false;
  }
}

export async function getRejectedTemplateEmailContent(data, templateName) {
  if (!templateName || !data) return false;
  try {
    const condition = `email_slug = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, { job_title: data.position_name ,company_name:data.company_name ,candidate_name:data.full_name,email:data.email });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return fullHtml;
  } catch (error) {
    console.error('Error generating rejected template email:', error);
    return false;
  }
}

export async function getCVselectedTemplateEmailContent(data, templateName) {
  if (!templateName || !data) return false;
  try {
    const condition = `email_slug = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);
    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, { job_title: data.position_name ,company_name:data.company_name ,candidate_name:data.full_name,job_preferred_loc:data.preferred_location,email:data.email });
    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return fullHtml;
  } catch (error) {
    console.error('Error generating CV selected template email:', error);
    return false;
  }
}

export async function getSurveyInviteEmailContent(data, templateEntity = 'survey-email-template') {
  if (!templateEntity || !data) return false;

  try {
    const condition = `template_entity = '${templateEntity}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const emailSubject = templates[0].email_subject || templates[0].subject || '';

    const templateData = {
      safeName: data.safeName,
      safeJob: data.safeJob,
      safeProcess: data.safeProcess,
      safeCompany: data.safeCompany,
      candidate_name: data.safeName,
      job_title: data.safeJob,
      process_name: data.safeProcess,
      company_name: data.safeCompany,
      survey_link: data.survey_link,
      invite_link: data.survey_link,
      linkMarkup: data.linkMarkup,
    };

    let filledBody = emailBody;
    Object.entries(templateData).forEach(([key, value]) => {
      const safeVal = value === undefined || value === null ? '' : String(value);
      filledBody = filledBody.replace(new RegExp(`\\{${key}\\}`, 'g'), safeVal);
      filledBody = filledBody.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), safeVal);
    });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    const filledSubject = Object.entries(templateData).reduce((acc, [key, value]) => {
      const safeVal = value === undefined || value === null ? '' : String(value);
      return acc.replace(new RegExp(`\\{${key}\\}`, 'g'), safeVal).replace(new RegExp(`\\$\\{${key}\\}`, 'g'), safeVal);
    }, emailSubject || '');

    return { subject: filledSubject, html: fullHtml };
  } catch (error) {
    console.error('Error generating survey invite email:', error);
    return false;
  }
}

export const scheduleMeetingTemplateEmailContent = async (data, templateName) => {
  if (!templateName || !data) return false;
  
  try {
    let condition;
    let templateData = {};
    if(data.meeting_mode == "in-office"){

      if(data.reschedule && data.reschedule == "yes"){
        condition = `template_entity = 'interview-reschedule-offline-template' AND is_deleted = 'No' AND status = 'Active'`;
      }else{
        condition = `template_entity = 'interview-invitation-offline' AND is_deleted = 'No' AND status = 'Active'`;
      }

      templateData.location_type = "Location"
      templateData.meeting_link = data.location
      templateData.map_link = data.meeting_map_link ? `Map Link: <a href='${data.meeting_map_link}' target='_blank'>Click Here</a>` : ''
      templateData.location = data.location;
      templateData.contact_details = data.contact_person;

    }else{
      condition = `template_entity = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`
      templateData.location_type = "Link";
      templateData.meeting_link = data.meeting_link;
     
    }
   
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, {
      meeting_link: data.meeting_link,
      token: data.token,
      base_url: data.base_url,
      email: data.email,
      meeting_mode: data.meeting_mode,
      contact_person: data.contact_person,
      location: data.meeting_address,
      map_link: data.meeting_map_link,
      position_name: data.position_name,
      job_title: data.job_title,
      company_name: data.company_name,
      first_name: data.first_name,
      time: data.time,
      date: data.date,
      base_url: data.base_url,
      contact_details:data.contact_person,

    });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return fullHtml;
  } catch (error) {
    console.error('Error generating schedule meeting template email:', error);
    return false;
  }
}


export async function getExportTemplateEmailContent(data, templateName){
   if (!templateName || !data) return false;
   try {
      const condition = `template_entity = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
      const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;
    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, { document_type: data.document_type, name:data.name,link: `<a href='${data.link}'>${data.link}</a>` });
    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return fullHtml;

   } catch (error) {
     console.error('Error generating export template email content:', error);
    return false;
   }
}

export async function getUpdatePrefferedLocationEmailContent(data, templateName) {
  if (!templateName || !data) return false;
  
  try {
    const condition = `template_entity = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, {
      job_title: data.position_name,
      company_name: data.company_name,
      candidate_name: data.full_name,
      current_location: data.current_location,
      preferred_location: data.preferred_location
    });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return fullHtml;
  } catch (error) {
    console.error('Error generating update preferred location email:', error);
    return false;
  }
}

export async function getEventInvitationEmailContent(data, templateName) {
  if (!templateName || !data) return false;

  try {
    const condition = `
      template_entity = '${templateName}'
      AND is_deleted = 'No'
      AND status = 'Active'
    `;

    const templates = await CommonModel.getData(
      'ups_email_template',
      '*',
      condition
    );

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';

    const filledBody = fillPlaceholders(emailBody, {
      recipient_name: data.recipient_name,
      event_title: data.event_title,
      host_name: data.host_name,
      event_date_time: data.event_date_time,
      event_link: data.event_link
        ? `<a href="${data.event_link}" target="_blank">${data.event_link}</a>`
        : '',
    });

    const fullHtml = await ejs.renderFile(commonWrapperPath, {
      message: filledBody,
    });

    return fullHtml;
  } catch (error) {
    console.error('Error generating event invitation email:', error);
    return false;
  }
}


export async function getEmailContentBody(data, templateName) {

  // console.log("data in email content helper:",data,templateName);
  // return false;
  if (!templateName || !data) return false;

  try {
    const condition = `template_entity = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);
    // console.log("templates in email content helper:",templates);
    // return false;
    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, data); // data needs to be an object with keys matching placeholders in the template
    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });  
    return {fullHtml:fullHtml,subject:templates[0].email_subject};
  } catch (error) {
    console.error('Error generating email content body:', error);
    return false;
  }
}

export async function getCompanyWelcomeEmailContent(data, templateName) {
  if (!templateName || !data) return false;
  
  try {
    const condition = `template_entity = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const filledBody = fillPlaceholders(emailBody, {
      company_name: data.company_name,
      executive_name: data.executive_name,
      email: data.email,
      website: data.website,
      company_size: data.company_size,
      support_contact: data.support_contact || 'support@skillsconnect.co.in',
      dashboard_url: data.dashboard_url || 'https://skillsconnect.co.in/dashboard'
    });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });
    return { fullHtml, subject: templates[0].email_subject };
  } catch (error) {
    console.error('Error generating company welcome email:', error);
    return false;
  }
}

export async function getTicketEmailContent(data, templateName) {
  // console.log("inside email : ", data, templateName);
  
  if (!templateName || !data) return false;

  // console.log("check");
  

  try {
    const condition = `template_entity = '${templateName}' AND is_deleted = 'No' AND status = 'Active'`;
    const templates = await CommonModel.getData('ups_email_template', '*', condition);

    if (!templates || templates.length === 0) return false;

    const emailBody = templates[0].email_body || '';
    const emailSubject = templates[0].email_subject || '';

    const attachmentsHTML = data.attachments?.length > 0 
      ? data.attachments.map(att => 
          `<li><a href="${att.url || att}">${att.filename || att.name || 'Attachment'}</a></li>`
        ).join('')
      : '<li>No attachments</li>';

    const publicUrl = `${process.env.FRONTEND_URL}/public/ticket/${data.publicToken}`;

    const templateData = {
      ticket_id: data.ticket_id,
      from_name: data.from_name,
      from_email: data.from_email,
      subject: data.subject,
      message: data.message || 'No message',
      mobile: data.mobile || 'Not provided',
      department: data.department,
      attachments: attachmentsHTML,
      public_url: publicUrl,
      public_url_link: `<a href="${publicUrl}">${publicUrl}</a>`,
      created_at: data.created_at || new Date().toLocaleString()
    };

    let filledBody = emailBody;
    Object.entries(templateData).forEach(([key, value]) => {
      const safeVal = value === undefined || value === null ? '' : String(value);
      filledBody = filledBody.replace(new RegExp(`\\{${key}\\}`, 'g'), safeVal);
    });

    let filledSubject = emailSubject;
    Object.entries(templateData).forEach(([key, value]) => {
      const safeVal = value === undefined || value === null ? '' : String(value);
      filledSubject = filledSubject.replace(new RegExp(`\\{${key}\\}`, 'g'), safeVal);
    });

    const fullHtml = await ejs.renderFile(commonWrapperPath, { message: filledBody });

    return { html: fullHtml, subject: filledSubject };
  } catch (error) {
    console.error('Error generating ticket email:', error);
    return false;
  }
}
