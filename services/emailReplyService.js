// services/emailReplyService.js
import CommonModel from '../modules/models/mysql/commonModel/commonModel.js';
import GoogleOAuthHelper from '../helpers/V1/googleOAuthHelper.js';
import db from '../config/knex.js';

const REPLY_SOURCE_NAME = 'Email Reply';
const REPLY_TAG_NAME = 'Email Reply';

export class EmailReplyService {
  
  static async checkAndProcessReplies() {
    console.log(`[${new Date().toISOString()}] Checking for email replies...`);
    
    try {
      // Get all active senders with Gmail connected
      const senders = await CommonModel.getData(
        'crm_sender_emails',
        '*',
        "status = 'Active' AND email_details IS NOT NULL"
      );
      
      if (!senders || senders.length === 0) {
        console.log('No senders found');
        return { processed: 0 };
      }
      
      let processed = 0;
      
      for (const sender of senders) {
        try {
          const { emails } = await GoogleOAuthHelper.readEmails(sender.id, 30);
          
          for (const email of emails) {
            // Check if already processed
            const existing = await CommonModel.getData(
              'crm_email_reply_logs',
              'id',
              `gmail_message_id = '${email.id}'`
            );
            
            if (existing && existing.length > 0) continue;
            
            // Extract headers
            const headers = email.payload.headers;
            const from = headers.find(h => h.name === 'From')?.value || '';
            const subject = headers.find(h => h.name === 'Subject')?.value || '';
            const inReplyTo = headers.find(h => h.name === 'In-Reply-To')?.value || '';
            const date = headers.find(h => h.name === 'Date')?.value || '';
            
            // Determine type
            let type = 'normal';
            if (inReplyTo) type = 'reply';
            if (subject.toLowerCase().includes('delivery status notification')) type = 'bounce';
            
            // Extract plain text body
            const plainText = this.extractPlainText(email.payload);
            
            // Extract recipient email from bounce
            let bounceRecipient = null;
            if (type === 'bounce') {
              const emailMatch = plainText.match(/Final-Recipient:\s*[^;]+;\s*([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i) ||
                                 plainText.match(/Original-Recipient:\s*[^;]+;\s*([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i);
              bounceRecipient = emailMatch ? emailMatch[1] : null;
            }
            
            // Log the email
            await CommonModel.insertData('crm_email_reply_logs', {
              sender_id: sender.id,
              gmail_message_id: email.id,
              thread_id: email.threadId,
              from_email: from,
              subject: subject,
              in_reply_to: inReplyTo,
              type: type,
              received_at: new Date(date),
              created_at: new Date(),
              bounce_recipient: bounceRecipient,
              body_snippet: plainText.substring(0, 500)
            });
            
            // Update campaign logs if bounce
            if (type === 'bounce' && bounceRecipient) {
              await this.updateBounceStatus(bounceRecipient, plainText, email.threadId);
            }

            // A genuine reply (not a bounce, not an unrelated inbound email)
            // from someone who isn't already a lead or client becomes a new
            // lead — mirrors legacy CRM's reply→lead auto-creation.
            if (type === 'reply') {
              try {
                await this.createLeadFromReplyIfNew(from, subject, plainText);
              } catch (leadError) {
                console.error('Reply-to-lead creation failed for', email.id, leadError);
              }
            }

            processed++;
          }
          
        } catch (error) {
          console.error(`Error processing sender ${sender.id}:`, error);
        }
      }
      
      console.log(`Processed ${processed} emails`);
      return { processed };
      
    } catch (error) {
      console.error('Email reply service error:', error);
      return { processed: 0, error: error.message };
    }
  }
  
  static parseFromHeader(fromHeader) {
    const match = String(fromHeader || '').match(/^(.*?)\s*<([^>]+)>$/);
    if (match) {
      return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim().toLowerCase() };
    }
    const email = String(fromHeader || '').trim().toLowerCase();
    return { name: '', email };
  }

  static async findOrCreateReplySourceId() {
    const existing = await db('crm_lead_source').where('name', REPLY_SOURCE_NAME).first();
    if (existing) return existing.id;
    const [id] = await db('crm_lead_source').insert({ name: REPLY_SOURCE_NAME, status: 'Active' });
    return id;
  }

  /**
   * Creates a new lead from a campaign reply, unless the sender already
   * matches an existing lead or client (by email) — avoids spamming the
   * pipeline with duplicate leads every time an existing contact replies.
   */
  static async createLeadFromReplyIfNew(fromHeader, subject, bodySnippet) {
    const { name, email } = this.parseFromHeader(fromHeader);
    if (!email || !email.includes('@')) return null;

    const existingLead = await db('crm_leads').where({ email, is_deleted: false }).first();
    if (existingLead) return null;

    const existingClient = await db('crm_clients').where('email', email).first();
    if (existingClient) return null;

    const existingContact = await db('crm_client_contacts').where('email', email).first();
    if (existingContact) return null;

    const sourceId = await this.findOrCreateReplySourceId();
    const displayName = name || email.split('@')[0];

    const [leadId] = await db('crm_leads').insert({
      name: displayName,
      email,
      source: sourceId,
      status: 0,
      assigned: 0,
      addedfrom: 1,
      tags: REPLY_TAG_NAME,
      description: `Auto-created from an email reply.\nSubject: ${subject || '(no subject)'}\n\n${String(bodySnippet || '').slice(0, 300)}`,
      dateadded: new Date(),
    });

    await db('crm_lead_activity_log').insert({
      lead_id: leadId,
      description: `Lead auto-created from email reply (${email})`,
      date: new Date(),
      staffid: 0,
      full_name: 'System',
    });

    console.log(`[email replies] created lead #${leadId} from reply by ${email}`);
    return leadId;
  }

  static extractPlainText(payload) {
    let body = '';
    
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          break;
        }
        if (part.parts) {
          body = this.extractPlainText(part);
          if (body) break;
        }
      }
    } else if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    
    return body;
  }
  
  static async updateBounceStatus(recipientEmail, bounceInfo, threadId) {
    // Update campaign logs
    await CommonModel.updateData(
      'crm_campaign_email_logs',
      {
        status: 'failed',
        error_message: bounceInfo.substring(0, 500),
        updated_at: new Date()
      },
      `recipient_email = '${recipientEmail}' AND status = 'sent'`
    );
    
    // Update recipient
    await CommonModel.updateData(
      'crm_marketing_email_recipient',
      {
        mail_status: 'failed',
        reason: bounceInfo.substring(0, 500),
        updated_at: new Date()
      },
      `email = '${recipientEmail}'`
    );
  }
}

export default EmailReplyService;