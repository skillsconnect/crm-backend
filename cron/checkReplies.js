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
        // Read recent emails from Gmail
        const { emails } = await GoogleOAuthHelper.readEmails(sender.id, 20);
        
        for (const email of emails) {
          // Check if already processed
          const existing = await CommonModel.getData(
            'crm_email_reply_logs',
            'id',
            `gmail_message_id = '${email.id}'`
          );
          
          if (existing && existing.length > 0) continue;
          
          // Check if it's a reply to our campaign
          const isReply = email.subject.toLowerCase().includes('re:') || 
                          email.inReplyTo ||
                          email.threadId;
          
          if (isReply) {
            // Log the reply
            await CommonModel.insertData('crm_email_reply_logs', {
              sender_id: sender.id,
              gmail_message_id: email.id,
              thread_id: email.threadId,
              from_email: email.from,
              subject: email.subject,
              received_at: new Date(),
              created_at: new Date()
            });
            
            processed++;
            console.log(`📨 Reply received from: ${email.from}`);
          }
        }
        
      } catch (error) {
        console.error(`Error checking replies for sender ${sender.id}:`, error);
      }
    }
    
    console.log(`📊 Processed ${processed} new replies`);
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