// cron/sendEmails.js
import EmailSendingService from '../services/emailSendingService.js';

const getIST = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

async function sendQueuedEmails() {
  console.log(`[${getIST()}] 📧 Starting email sender...`);
  
  try {
    const result = await EmailSendingService.sendQueuedEmails(50);
    
    console.log(`📊 Email sender completed: ${result.sent} sent, ${result.failed} failed`);
    
    if (result.error) {
      console.log(`⚠️ Error: ${result.error}`);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Email sender cron error:', error);
    return { sent: 0, failed: 0, error: error.message };
  }
}

// Run the function
sendQueuedEmails()
  .then(result => {
    console.log(`[${getIST()}] Email sender completed:`, result);
    process.exit(0);
  })
  .catch(error => {
    console.error('Cron failed:', error);
    process.exit(1);
  });