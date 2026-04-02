// cron/checkReplies.js
import CommonModel from '../modules/models/mysql/commonModel/commonModel.js';
import GoogleOAuthHelper from '../helpers/V1/googleOAuthHelper.js';

const getIST = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

async function checkEmailReplies() {
  console.log(`[${getIST()}] 📬 Checking email replies...`);
  
  try {
    // Get all connected senders
    const senders = await CommonModel.getData(
      'crm_sender_emails',
      '*',
      "email_details IS NOT NULL AND status = 'Active'"
    );
    
    if (!senders || senders.length === 0) {
      console.log('No connected senders found');
      return { processed: 0 };
    }
    
    let processed = 0;
    
    for (const sender of senders) {
      try {
        // Get Gmail client
        const gmail = await GoogleOAuthHelper.getGmailClient(sender.id);
        
        // Fetch recent messages
        const response = await gmail.users.messages.list({
          userId: 'me',
          maxResults: 30,
          labelIds: ['INBOX']
        });
        
        const messages = response.data.messages || [];
        
        for (const msg of messages) {
          // Get full message details
          const email = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full'
          });
          
          // Check if already processed
          const existing = await CommonModel.getData(
            'crm_email_reply_logs',
            'id',
            `gmail_message_id = '${email.data.id}'`
          );
          
          if (existing && existing.length > 0) continue;
          
          // Extract headers
          const headers = email.data.payload.headers;
          const from = headers.find(h => h.name === 'From')?.value || '';
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const inReplyTo = headers.find(h => h.name === 'In-Reply-To')?.value || '';
          const references = headers.find(h => h.name === 'References')?.value || '';
          const date = headers.find(h => h.name === 'Date')?.value || '';
          
          // Extract plain text body
          let bodyText = '';
          const extractBody = (part) => {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              bodyText = Buffer.from(part.body.data, 'base64').toString('utf-8');
              return true;
            }
            if (part.parts) {
              for (const p of part.parts) {
                if (extractBody(p)) return true;
              }
            }
            return false;
          };
          extractBody(email.data.payload);
          
          // Determine email type
          let type = 'normal';
          const isReply = subject.toLowerCase().includes('re:') || inReplyTo || references;
          const isBounce = subject.toLowerCase().includes('delivery status') || 
                           subject.toLowerCase().includes('failure') ||
                           subject.toLowerCase().includes('undelivered') ||
                           subject.toLowerCase().includes('mailer-daemon') ||
                           from.toLowerCase().includes('mailer-daemon');
          
          if (isBounce) type = 'bounce';
          else if (isReply) type = 'reply';
          
          // Extract email address from "From" header
          let fromEmail = from;
          const emailMatch = from.match(/<(.+?)>/);
          if (emailMatch) fromEmail = emailMatch[1];
          fromEmail = fromEmail.trim().toLowerCase();
          
          let bounceRecipient = null;
          let updateRecipientStatus = false;
          let newStatus = '';
          let reason = '';
          
          // Process based on type
          if (type === 'bounce') {
            // Extract original recipient from bounce message
            const recipientMatch = bodyText.match(/Final-Recipient:\s*[^;]+;\s*([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i) ||
                                   bodyText.match(/Original-Recipient:\s*[^;]+;\s*([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i) ||
                                   bodyText.match(/for\s+([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i);
            
            bounceRecipient = recipientMatch ? recipientMatch[1].trim().toLowerCase() : null;
            
            if (bounceRecipient) {
              updateRecipientStatus = true;
              newStatus = 'failed';
              reason = `Email bounced: ${bodyText.substring(0, 200)}`;
              
              // Update campaign email logs
              await CommonModel.updateData(
                'crm_campaign_email_logs',
                {
                  status: 'failed',
                  error_message: reason,
                  updated_at: new Date()
                },
                `recipient_email = '${bounceRecipient}' AND status = 'sent'`
              );
              
              console.log(`📨 Bounce detected for: ${bounceRecipient}`);
            }
          }
          
          // Check for unsubscribe request (in any email)
          const isUnsubscribe = bodyText.toLowerCase().includes('unsubscribe') || 
                                bodyText.toLowerCase().includes('remove me') ||
                                bodyText.toLowerCase().includes('stop sending') ||
                                bodyText.toLowerCase().includes('opt-out') ||
                                bodyText.toLowerCase().includes('opt out');
          
          if (isUnsubscribe && fromEmail) {
            updateRecipientStatus = true;
            newStatus = 'unsubscribed';
            reason = `User requested unsubscribe via reply: ${bodyText.substring(0, 100)}`;
            console.log(`📨 Unsubscribe request from: ${fromEmail}`);
          }
          
          // Update recipient status in crm_marketing_email_recipient
          if (updateRecipientStatus && fromEmail) {
            const recipient = await CommonModel.getData(
              'crm_marketing_email_recipient',
              '*',
              `email = '${fromEmail}'`
            );
            
            if (recipient && recipient.length > 0) {
              await CommonModel.updateData(
                'crm_marketing_email_recipient',
                {
                  mail_status: newStatus,
                  reason: reason,
                  updated_at: new Date()
                },
                `id = ${recipient[0].id}`
              );
              
              console.log(`✅ Updated recipient ${fromEmail} status to: ${newStatus}`);
            } else if (bounceRecipient) {
              // Try with bounce recipient if fromEmail didn't match
              const bounceRecipientData = await CommonModel.getData(
                'crm_marketing_email_recipient',
                '*',
                `email = '${bounceRecipient}'`
              );
              
              if (bounceRecipientData && bounceRecipientData.length > 0) {
                await CommonModel.updateData(
                  'crm_marketing_email_recipient',
                  {
                    mail_status: newStatus,
                    reason: reason,
                    updated_at: new Date()
                  },
                  `id = ${bounceRecipientData[0].id}`
                );
                
                console.log(`✅ Updated bounce recipient ${bounceRecipient} status to: ${newStatus}`);
              }
            }
          }
          
          // Log the email
          await CommonModel.insertData('crm_email_reply_logs', {
            sender_id: sender.id,
            gmail_message_id: email.data.id,
            thread_id: email.data.threadId,
            from_email: from,
            from_email_clean: fromEmail,
            subject: subject,
            in_reply_to: inReplyTo,
            type: type,
            received_at: date ? new Date(date) : new Date(),
            created_at: new Date(),
            bounce_recipient: bounceRecipient,
            body_snippet: bodyText.substring(0, 500),
            processed: true
          });
          
          processed++;
          console.log(`📨 Processed: ${type} from ${fromEmail || from}`);
        }
        
      } catch (error) {
        console.error(`Error checking replies for sender ${sender.id}:`, error.message);
      }
    }
    
    console.log(`📊 Processed ${processed} new emails`);
    return { processed };
    
  } catch (error) {
    console.error('❌ Reply check cron error:', error);
    return { processed: 0, error: error.message };
  }
}

// Run the function
checkEmailReplies()
  .then(result => {
    console.log(`[${getIST()}] Reply check completed:`, result);
    process.exit(0);
  })
  .catch(error => {
    console.error('Cron failed:', error);
    process.exit(1);
  });