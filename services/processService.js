import CommonModel from '../modules/models/mysql/commonModel/commonModel.js';
import { sendMail } from '../helpers/V1/mail.helper.js';
import { getProcessEmailContent } from '../helpers/V1/email_content.helper.js';

const TABLES = {
    PROCESS_STAFF: 'crm_process_staff',
    PROCESS: 'crm_process'
};

const getIST = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

class ProcessService {

    // Send pending process emails (called by cron)
    static async sendPendingEmails(batchSize = 50) {
        console.log(`[${getIST()}] 📧 Starting process email sender...`);
        
        try {
            const currentDateTime = new Date();
            
            // Get pending processes where contact_date_time <= now
            const pendingProcesses = await CommonModel.getDataLimit(
                TABLES.PROCESS_STAFF,
                '*',
                `email_sent = 'pending' AND contact_date_time <= '${currentDateTime.toISOString().slice(0, 19).replace('T', ' ')}' AND status = 'Active'`,
                'id',
                'ASC',
                batchSize,
                0
            );
            
            if (!pendingProcesses || pendingProcesses.length === 0) {
                console.log('No pending process emails');
                return { sent: 0, failed: 0 };
            }
            
            let sent = 0;
            let failed = 0;
            
            for (const process of pendingProcesses) {
                try {
                    // Get lead details (assuming you have leads table)
                    const lead = await CommonModel.getData(
                        'crm_leads', // Change to your leads table name
                        '*',
                        `id = ${process.lead_id}`
                    );
                    
                    if (!lead || lead.length === 0) {
                        await this.markEmailFailed(process.id, 'Lead not found');
                        failed++;
                        continue;
                    }
                    
                    // Prepare email data
                    const emailData = {
                        name: lead[0].name || lead[0].first_name || 'Valued Customer',
                        email: lead[0].email,
                        company: lead[0].company || ''
                    };
                    
                    // Generate email content (replace placeholders)
                    let emailContent = process.email_content;
                    let emailSubject = process.email_subject;
                    
                    // Replace placeholders with actual data
                    emailContent = this.replacePlaceholders(emailContent, emailData);
                    emailSubject = this.replacePlaceholders(emailSubject, emailData);
                    
                    // Send email
                    const result = await sendMail({
                        emailFrom: 'noreply@skillsconnect.co.in',
                        emailTo: lead[0].email,
                        subject: emailSubject,
                        mailBody: emailContent,
                        purpose: 'process_automation',
                        userId: lead[0].id,
                        createdBy: process.created_by
                    });
                    
                    if (result) {
                        await this.markEmailSent(process.id, result);
                        sent++;
                        console.log(`✅ Process email sent to ${lead[0].email}`);
                    } else {
                        await this.markEmailFailed(process.id, 'Email sending failed');
                        failed++;
                    }
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (error) {
                    console.error(`❌ Failed to send process email ${process.id}:`, error);
                    await this.markEmailFailed(process.id, error.message);
                    failed++;
                }
            }
            
            console.log(`📊 Process email summary: ${sent} sent, ${failed} failed`);
            return { sent, failed };
            
        } catch (error) {
            console.error('Process email cron error:', error);
            return { sent: 0, failed: 0, error: error.message };
        }
    }
    
    static async markEmailSent(processId, response) {
        await CommonModel.updateData(
            TABLES.PROCESS_STAFF,
            {
                email_sent: 'sent',
                sent_at: new Date(),
                updated_on: new Date()
            },
            `id = ${processId}`
        );
    }
    
    static async markEmailFailed(processId, errorMessage) {
        await CommonModel.updateData(
            TABLES.PROCESS_STAFF,
            {
                email_sent: 'failed',
                updated_on: new Date()
            },
            `id = ${processId}`
        );
        console.error(`Process ${processId} failed: ${errorMessage}`);
    }
    
    static replacePlaceholders(content, data) {
        if (!content) return content;
        
        let replaced = content;
        
        // Replace common placeholders
        const placeholders = {
            '{name}': data.name || '',
            '{email}': data.email || '',
            '{company}': data.company || '',
            '{first_name}': data.name?.split(' ')[0] || '',
            '{last_name}': data.name?.split(' ')[1] || '',
            '{date}': new Date().toLocaleDateString(),
            '{time}': new Date().toLocaleTimeString()
        };
        
        for (const [key, value] of Object.entries(placeholders)) {
            replaced = replaced.replace(new RegExp(key, 'g'), value);
        }
        
        return replaced;
    }
    
    // Schedule a process for a lead
    static async scheduleProcess(leadId, processId, contactDateTime, staffId) {
        try {
            const masterProcess = await CommonModel.getData(
                TABLES.PROCESS,
                '*',
                `id = ${processId}`
            );
            
            if (!masterProcess || masterProcess.length === 0) {
                throw new Error('Process not found');
            }
            
            const existing = await CommonModel.getData(
                TABLES.PROCESS_STAFF,
                '*',
                `lead_id = ${leadId} AND master_process_id = ${processId}`
            );
            
            const dataToSave = {
                lead_id: leadId,
                master_process_id: processId,
                process_name: masterProcess[0].process_name,
                email_subject: masterProcess[0].email_subject,
                email_content: masterProcess[0].email_content,
                communication_mode: masterProcess[0].communication_mode,
                staff_id: staffId,
                contact_date_time: contactDateTime,
                email_sent: 'pending',
                status: 'Active',
                updated_on: new Date(),
                updated_by: staffId
            };
            
            if (existing && existing.length > 0) {
                await CommonModel.updateData(
                    TABLES.PROCESS_STAFF,
                    dataToSave,
                    `id = ${existing[0].id}`
                );
            } else {
                dataToSave.created_on = new Date();
                dataToSave.created_by = staffId;
                await CommonModel.insertData(TABLES.PROCESS_STAFF, dataToSave);
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error scheduling process:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Get all pending processes for a lead
    static async getLeadProcesses(leadId) {
        try {
            const processes = await CommonModel.getData(
                TABLES.PROCESS_STAFF,
                '*',
                `lead_id = ${leadId}`,
                'contact_date_time',
                'ASC'
            );
            
            return processes || [];
        } catch (error) {
            console.error('Error getting lead processes:', error);
            return [];
        }
    }
}

export default ProcessService;