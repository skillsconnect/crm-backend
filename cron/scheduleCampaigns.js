// cron/scheduleCampaigns.js
import CommonModel from '../modules/models/mysql/commonModel/commonModel.js';
import EmailSendingService from '../services/emailSendingService.js';

const getIST = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

async function schedulePendingCampaigns() {
  console.log(`[${getIST()}] 🔍 Checking for campaigns to schedule...`);
  
  try {
  const now = new Date();
  const offset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istDate = new Date(now.getTime() + offset);
  const currentDateTime = istDate.toISOString().slice(0, 19).replace('T', ' ');

    // console.log("time :",currentDateTime);
    

    // Get campaigns that are scheduled and ready to send
    const campaigns = await CommonModel.getData(
      'crm_campaigns',
      '*',
      `status = 'scheduled' AND schedule_time <= '${currentDateTime}'`
    );

    // console.log("campaign :",campaigns);
    
    
    if (!campaigns || campaigns.length === 0) {
      console.log('No campaigns to schedule');
      return { scheduled: 0 };
    }
    
    let scheduled = 0;
    
    for (const campaign of campaigns) {
      console.log(`📢 Scheduling campaign: ${campaign.name} (ID: ${campaign.id})`);
      
      // Queue emails for this campaign
      const result = await EmailSendingService.queueCampaignEmails(campaign.id);
      
      if (result.success) {
        scheduled++;
        console.log(`✅ Queued ${result.queued} emails for campaign ${campaign.id}`);
      } else {
        console.log(`❌ Failed to queue campaign ${campaign.id}: ${result.error}`);
      }
    }
    
    console.log(`📊 Scheduled ${scheduled} campaigns`);
    return { scheduled };
    
  } catch (error) {
    console.error('❌ Schedule cron error:', error);
    return { scheduled: 0, error: error.message };
  }
}

// Run the function
schedulePendingCampaigns()
  .then(result => {
    console.log(`[${getIST()}] Schedule completed:`, result);
    process.exit(0);
  })
  .catch(error => {
    console.error('Cron failed:', error);
    process.exit(1);
  });