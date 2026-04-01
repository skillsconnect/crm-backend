// services/emailSendingService.js
import CommonModel from '../modules/models/mysql/commonModel/commonModel.js';
import GoogleOAuthHelper from '../helpers/V1/googleOAuthHelper.js';
import { getCampaignEmailContent } from '../helpers/V1/email_content.helper.js';

export class EmailSendingService {

  static async sendQueuedEmails(batchSize = 50) {
    console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] Starting email sending...`);
    
    try {
      const queuedEmails = await CommonModel.getDataLimit(
        'crm_campaign_email_logs',
        '*',
        "status = 'queued'",
        'id',
        'ASC',
        batchSize,
        0
      );
      
      if (!queuedEmails || queuedEmails.length === 0) {
        console.log('No queued emails');
        return { sent: 0, failed: 0 };
      }
      
      let sent = 0;
      let failed = 0;
      
      for (const email of queuedEmails) {
        try {
          // Get recipient
          const recipient = await CommonModel.getData(
            'crm_marketing_email_recipient',
            '*',
            `id = ${email.recipient_id}`
          );
          
          if (!recipient || recipient.length === 0) {
            await this.markEmailFailed(email.id, 'Recipient not found');
            failed++;
            continue;
          }
          
          // Get template slug
          const template = await CommonModel.getData(
            'crm_email_campaign_template',
            '*',
            `id = ${email.template_id}`
          );
          
          if (!template || template.length === 0) {
            await this.markEmailFailed(email.id, 'Template not found');
            failed++;
            continue;
          }
          
          // ✅ Sirf data prepare karo, replacement getCampaignEmailContent karega
          const emailData = {
            name: recipient[0].name + ' ' + recipient[0].last_name || 'Valued Customer',
            email: recipient[0].email
          };
          
          // ✅ getCampaignEmailContent handle karega:
          // 1. Template fetch karna
          // 2. {name} replace karna
          // 3. Layout render karna
          const emailContent = await getCampaignEmailContent(
            emailData,
            template[0].slug  // template slug (e.g., "winter-sale")
          );
          
          if (!emailContent) {
            await this.markEmailFailed(email.id, 'Failed to generate email content');
            failed++;
            continue;
          }
          
          // Send email via Gmail
          const result = await GoogleOAuthHelper.sendEmail(
            email.sender_id,
            recipient[0].email,
            emailContent.subject,
            emailContent.html
          );
          
          if (result.success) {
            await this.markEmailSent(email.id, result.messageId, result);
            await this.updateRecipientStatus(recipient[0].id, 'sent');
            sent++;
            console.log(`✅ Email sent to ${recipient[0].email}`);
          } else {
            await this.markEmailFailed(email.id, result.error);
            failed++;
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`❌ Failed to send email ${email.id}:`, error);
          await this.markEmailFailed(email.id, error.message);
          failed++;
        }
      }
      
      console.log(`📊 Summary: ${sent} sent, ${failed} failed`);
      return { sent, failed };
      
    } catch (error) {
      console.error('Cron job error:', error);
      return { sent: 0, failed: 0, error: error.message };
    }
  }
  
  static async markEmailSent(logId, messageId, response) {
    await CommonModel.updateData(
      'crm_campaign_email_logs',
      {
        status: 'sent',
        sent_at: new Date(),
        gmail_message_id: messageId,
        response: JSON.stringify(response)
      },
      `id = ${logId}`
    );
  }
  
  static async markEmailFailed(logId, errorMessage) {
    await CommonModel.updateData(
      'crm_campaign_email_logs',
      {
        status: 'failed',
        error_message: errorMessage
      },
      `id = ${logId}`
    );
  }
  
  static async updateRecipientStatus(recipientId, status) {
    await CommonModel.updateData(
      'crm_marketing_email_recipient',
      { mail_status: status },
      `id = ${recipientId}`
    );
  }
  
  static async queueCampaignEmails(campaignId) {
    try {
      const campaign = await CommonModel.getData(
        'crm_campaigns',
        '*',
        `id = ${campaignId}`
      );
      
      if (!campaign || campaign.length === 0) {
        throw new Error('Campaign not found');
      }
      
      const campaignLists = await CommonModel.getData(
        'crm_campaign_mailing_lists',
        '*',
        `campaign_id = ${campaignId} AND status = 'pending'`
      );
      
      let totalQueued = 0;
      
      for (const campaignList of campaignLists) {
        const recipients = await CommonModel.getData(
          'crm_marketing_email_recipient',
          '*',
          `mailing_list_id = ${campaignList.mailing_list_id}`
          // `mailing_list_id = ${campaignList.mailing_list_id} AND mail_status = 'pending'`
        );
        
        for (const recipient of recipients) {
          await CommonModel.insertData('crm_campaign_email_logs', {
            template_id: campaign[0].template_id.split(',')[0],
            sender_id: campaign[0].sender_email_id.split(',')[0],
            recipient_id: recipient.id,
            campaign_id: campaignId,
            recipient_email: recipient.email,
            status: 'queued',
            created_at: new Date(),
            updated_at: new Date()
          });
          totalQueued++;
        }
        
        await CommonModel.updateData(
          'crm_campaign_mailing_lists',
          {
            status: 'in_progress',
            total_emails: totalQueued
          },
          `id = ${campaignList.id}`
        );
      }
      
      await CommonModel.updateData(
        'crm_campaigns',
        { status: 'in_progress'},
        `id = ${campaignId}`
      );
      
      console.log(`📧 Queued ${totalQueued} emails for campaign ${campaignId}`);
      return { success: true, queued: totalQueued };
      
    } catch (error) {
      console.error('Error queueing campaign emails:', error);
      return { success: false, error: error.message };
    }
  }
}

export default EmailSendingService;