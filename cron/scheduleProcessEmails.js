import ProcessService from '../services/processService.js';

const getIST = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

async function sendPendingProcessEmails() {
    console.log(`[${getIST()}] 🔍 Checking for pending process emails...`);
    
    try {
        const result = await ProcessService.sendPendingEmails(50);
        
        console.log(`[${getIST()}] Process email sender completed: ${result.sent} sent, ${result.failed} failed`);
        
        if (result.error) {
            console.log(`⚠️ Error: ${result.error}`);
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Process email cron error:', error);
        return { sent: 0, failed: 0, error: error.message };
    }
}

// Run the function
sendPendingProcessEmails()
    .then(result => {
        console.log(`[${getIST()}] Process email job completed:`, result);
        process.exit(0);
    })
    .catch(error => {
        console.error('Cron failed:', error);
        process.exit(1);
    });