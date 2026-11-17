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
      let skipped = 0;

      // Per-sender remaining quota for the rolling 24h window (Gmail anti-spam).
      // Emails whose sender is exhausted stay 'queued' and are retried next run.
      const senderQuota = new Map(); // senderId -> remaining sends

      // Track campaign IDs to update later
      const campaignStats = new Map(); // campaignId -> { sent, failed, total }

      for (const email of queuedEmails) {
        // Initialize campaign stats
        if (!campaignStats.has(email.campaign_id)) {
          campaignStats.set(email.campaign_id, { sent: 0, failed: 0 });
        }
        
        try {
          const remaining = await this.getSenderRemainingQuota(email.sender_id, senderQuota);
          if (remaining <= 0) {
            skipped++;
            continue; // leave queued; picked up after the 24h window moves
          }

          // Get recipient
          const recipient = await CommonModel.getData(
            'crm_marketing_email_recipient',
            '*',
            `id = ${email.recipient_id}`
          );
          
          if (!recipient || recipient.length === 0) {
            await this.markEmailFailed(email.id, 'Recipient not found');
            failed++;
            const stats = campaignStats.get(email.campaign_id);
            stats.failed++;
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
            const stats = campaignStats.get(email.campaign_id);
            stats.failed++;
            continue;
          }
          
          // Prepare email data
          const emailData = {
            name: (recipient[0].name + ' ' + recipient[0].last_name).trim() || 'Valued Customer',
            email: recipient[0].email
          };
          
          // Generate email content
          const emailContent = await getCampaignEmailContent(
            emailData,
            template[0].slug
          );
          
          if (!emailContent) {
            await this.markEmailFailed(email.id, 'Failed to generate email content');
            failed++;
            const stats = campaignStats.get(email.campaign_id);
            stats.failed++;
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
            senderQuota.set(email.sender_id, remaining - 1);
            sent++;
            const stats = campaignStats.get(email.campaign_id);
            stats.sent++;
            console.log(`✅ Email sent to ${recipient[0].email}`);
          } else {
            await this.markEmailFailed(email.id, result.error);
            failed++;
            const stats = campaignStats.get(email.campaign_id);
            stats.failed++;
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`❌ Failed to send email ${email.id}:`, error);
          await this.markEmailFailed(email.id, error.message);
          failed++;
          const stats = campaignStats.get(email.campaign_id);
          stats.failed++;
        }
      }
      
      // ✅ Update campaign status based on stats
      for (const [campaignId, stats] of campaignStats) {
        await this.updateCampaignStatus(campaignId);
      }
      
      console.log(`📊 Summary: ${sent} sent, ${failed} failed, ${skipped} deferred (daily limit)`);
      return { sent, failed, skipped };

    } catch (error) {
      console.error('Cron job error:', error);
      return { sent: 0, failed: 0, error: error.message };
    }
  }

  // Remaining sends for a sender in the rolling 24h window, cached per run
  static async getSenderRemainingQuota(senderId, cache) {
    if (cache.has(senderId)) return cache.get(senderId);

    const sender = await CommonModel.getData(
      'crm_sender_emails',
      'id, daily_limit',
      `id = ${senderId}`
    );
    const dailyLimit = sender?.[0]?.daily_limit > 0 ? sender[0].daily_limit : 100;

    const sentResult = await CommonModel.getData(
      'crm_campaign_email_logs',
      'COUNT(*) as total',
      `sender_id = ${senderId} AND status = 'sent' AND sent_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );
    const sentLast24 = Number(sentResult?.[0]?.total || 0);

    const remaining = Math.max(0, dailyLimit - sentLast24);
    cache.set(senderId, remaining);
    return remaining;
  }

  // ✅ New method to update campaign status
  static async updateCampaignStatus(campaignId) {
    try {
      // Get total emails for this campaign
      const totalResult = await CommonModel.getData(
        'crm_campaign_email_logs',
        'COUNT(*) as total',
        `campaign_id = ${campaignId}`
      );
      const totalEmails = totalResult?.[0]?.total || 0;
      
      // Get sent count
      const sentResult = await CommonModel.getData(
        'crm_campaign_email_logs',
        'COUNT(*) as sent',
        `campaign_id = ${campaignId} AND status = 'sent'`
      );
      const sentCount = sentResult?.[0]?.sent || 0;
      
      // Get failed count
      const failedResult = await CommonModel.getData(
        'crm_campaign_email_logs',
        'COUNT(*) as failed',
        `campaign_id = ${campaignId} AND status = 'failed'`
      );
      const failedCount = failedResult?.[0]?.failed || 0;
      
      const processedCount = sentCount + failedCount;
      
      console.log(`Campaign ${campaignId}: Total: ${totalEmails}, Sent: ${sentCount}, Failed: ${failedCount}, Processed: ${processedCount}`);
      
      // Update campaign mailing lists sent count
      const campaignLists = await CommonModel.getData(
        'crm_campaign_mailing_lists',
        '*',
        `campaign_id = ${campaignId}`
      ) || [];

      for (const campaignList of campaignLists) {
        // Get sent count for this specific mailing list
        const listSentResult = await CommonModel.getData(
          'crm_campaign_email_logs',
          'COUNT(*) as sent',
          `campaign_id = ${campaignId} AND status = 'sent' AND recipient_id IN (SELECT id FROM crm_marketing_email_recipient WHERE mailing_list_id = ${campaignList.mailing_list_id})`
        );

        await CommonModel.updateData(
          'crm_campaign_mailing_lists',
          {
            sent_count: listSentResult?.[0]?.sent || 0,
            updated_at: new Date()
          },
          `id = ${campaignList.id}`
        );
      }
      
      // ✅ If all emails are processed, update campaign status
      if (processedCount >= totalEmails && totalEmails > 0) {
        let newStatus = 'completed';
        
        // If all failed, you might want to mark as failed
        if (sentCount === 0 && failedCount > 0) {
          newStatus = 'failed';
        }
        
        await CommonModel.updateData(
          'crm_campaigns',
          { 
            status: newStatus,
            updated_at: new Date()
          },
          `id = ${campaignId}`
        );
        
        console.log(`✅ Campaign ${campaignId} marked as ${newStatus}`);
        
        // Update all mailing lists status
        await CommonModel.updateData(
          'crm_campaign_mailing_lists',
          { status: 'completed' },
          `campaign_id = ${campaignId}`
        );
      } else {
        // Update campaign mailing lists status
        for (const campaignList of campaignLists) {
          const listTotal = await CommonModel.getData(
            'crm_campaign_email_logs',
            'COUNT(*) as total',
            `campaign_id = ${campaignId} AND recipient_id IN (SELECT id FROM crm_marketing_email_recipient WHERE mailing_list_id = ${campaignList.mailing_list_id})`
          );
          
          const listSent = await CommonModel.getData(
            'crm_campaign_email_logs',
            'COUNT(*) as sent',
            `campaign_id = ${campaignId} AND status = 'sent' AND recipient_id IN (SELECT id FROM crm_marketing_email_recipient WHERE mailing_list_id = ${campaignList.mailing_list_id})`
          );
          
          const listProcessed = (listSent?.[0]?.sent || 0);
          const listTotalCount = listTotal?.[0]?.total || 0;
          
          if (listProcessed >= listTotalCount && listTotalCount > 0) {
            await CommonModel.updateData(
              'crm_campaign_mailing_lists',
              { status: 'completed' },
              `id = ${campaignList.id}`
            );
          }
        }
      }
      
      return { success: true };
      
    } catch (error) {
      console.error(`Error updating campaign status for ${campaignId}:`, error);
      return { success: false, error: error.message };
    }
  }
  
  static async markEmailSent(logId, messageId, response) {
    await CommonModel.updateData(
      'crm_campaign_email_logs',
      {
        status: 'sent',
        sent_at: new Date(),
        gmail_message_id: messageId,
        response: JSON.stringify(response),
        updated_at: new Date()
      },
      `id = ${logId}`
    );
  }
  
  static async markEmailFailed(logId, errorMessage) {
    await CommonModel.updateData(
      'crm_campaign_email_logs',
      {
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date()
      },
      `id = ${logId}`
    );
  }
  
  static async updateRecipientStatus(recipientId, status) {
    await CommonModel.updateData(
      'crm_marketing_email_recipient',
      { 
        mail_status: status,
        updated_at: new Date()
      },
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
      ) || [];

      // Rotate senders and templates round-robin across recipients so the
      // load spreads over every configured sender/template (anti-spam), the
      // same way the legacy PHP cron did.
      const templateIds = String(campaign[0].template_id || '').split(',').map(s => s.trim()).filter(Boolean);
      const senderIds = String(campaign[0].sender_email_id || '').split(',').map(s => s.trim()).filter(Boolean);

      if (!templateIds.length || !senderIds.length) {
        throw new Error('Campaign has no templates or senders configured');
      }

      let totalQueued = 0;

      for (const campaignList of campaignLists) {
        // Only fresh recipients — skip already sent/failed/unsubscribed ones
        const recipients = await CommonModel.getData(
          'crm_marketing_email_recipient',
          '*',
          `mailing_list_id = ${campaignList.mailing_list_id} AND mail_status = 'pending'`
        ) || [];

        let listQueued = 0;

        for (const recipient of recipients) {
          await CommonModel.insertData('crm_campaign_email_logs', {
            template_id: templateIds[totalQueued % templateIds.length],
            sender_id: senderIds[totalQueued % senderIds.length],
            recipient_id: recipient.id,
            campaign_id: campaignId,
            recipient_email: recipient.email,
            status: 'queued',
            created_at: new Date(),
            updated_at: new Date()
          });

          await CommonModel.updateData(
            'crm_marketing_email_recipient',
            { mail_status: 'queued', updated_at: new Date() },
            `id = ${recipient.id}`
          );

          totalQueued++;
          listQueued++;
        }

        await CommonModel.updateData(
          'crm_campaign_mailing_lists',
          {
            status: 'in_progress',
            total_emails: listQueued,
            updated_at: new Date()
          },
          `id = ${campaignList.id}`
        );
      }
      
      await CommonModel.updateData(
        'crm_campaigns',
        { 
          status: 'in_progress',
          updated_at: new Date()
        },
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