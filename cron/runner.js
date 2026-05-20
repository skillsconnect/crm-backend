import cron from 'node-cron';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getIST = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

console.log('🕐 Starting cron job runner...');

// Run scheduleCampaigns every minute
cron.schedule('* * * * *', () => {
  console.log(`[${getIST()}] Running scheduleCampaigns...`);
  exec('node cron/scheduleCampaigns.js', { cwd: path.resolve(__dirname, '..') }, (error, stdout, stderr) => {
    if (error) console.error(`Schedule error: ${error}`);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
});

// Run sendEmails every 30 seconds
cron.schedule('*/30 * * * * *', () => {
  console.log(`[${getIST()}] Running sendEmails...`);
  exec('node cron/sendEmails.js', { cwd: path.resolve(__dirname, '..') }, (error, stdout, stderr) => {
    if (error) console.error(`Send error: ${error}`);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
});

// Run checkReplies every 3 minutes
cron.schedule('*/3 * * * *', () => {
  console.log(`[${getIST()}] Running checkReplies...`);
  exec('node cron/checkReplies.js', { cwd: path.resolve(__dirname, '..') }, (error, stdout, stderr) => {
    if (error) console.error(`Reply check error: ${error}`);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
});

// ✅ NEW: Run process email sender every minute
cron.schedule('* * * * *', () => {
  console.log(`[${getIST()}] Running process email sender...`);
  exec('node cron/scheduleProcessEmails.js', { cwd: path.resolve(__dirname, '..') }, (error, stdout, stderr) => {
    if (error) console.error(`Process email error: ${error}`);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
});

// Keep the process running
process.stdin.resume();