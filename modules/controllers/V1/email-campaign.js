import CommonModel from '../../../modules/models/mysql/commonModel/commonModel.js';
import { slugify } from '../../../helpers/V1/core_helper.js';
import fs from 'fs';
import GoogleOAuthHelper from '../../../helpers/V1/googleOAuthHelper.js';

// ==================== TEMPLATE MASTER ====================

export const getAllTemplates = async (req, res) => {
    try {
        const { status, template_name, email_subject } = req.query;
        let condition = "1=1";
        
        if (status === 'active') condition = "status = 'Active'";
        if (status && status !== 'active') condition = `status = '${status}'`;
        if (template_name) condition += ` AND template_name LIKE '%${template_name}%'`;
        if (email_subject) condition += ` AND email_subject LIKE '%${email_subject}%'`;

        const templates = await CommonModel.getData(
            'crm_email_campaign_template',
            '*',
            condition,
            'id',
            'desc'
        );

        res.status(200).json({
            success: true,
            data: templates || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getTemplateById = async (req, res) => {
    try {
        const { templateId } = req.params;

        const template = await CommonModel.getData(
            'crm_email_campaign_template',
            '*',
            `id = ${templateId}`
        );

        if (!template || template.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Template not found"
            });
        }

        res.status(200).json({
            success: true,
            data: template[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createTemplate = async (req, res) => {
    try {
        const { template_name, email_subject, email_content, status } = req.body;

        if (!template_name || !template_name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Template name is required"
            });
        }

        if (!email_subject || !email_subject.trim()) {
            return res.status(400).json({
                success: false,
                message: "Email subject is required"
            });
        }

        if (!email_content || !email_content.trim()) {
            return res.status(400).json({
                success: false,
                message: "Email content is required"
            });
        }

        const slug = slugify(template_name, { lower: true, strict: true });

        const existing = await CommonModel.getData(
            'crm_email_campaign_template',
            'id',
            `slug = '${slug}'`
        );

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Template with this name already exists"
            });
        }

        const insertData = {
            template_name: template_name.trim(),
            slug: slug,
            email_subject: email_subject.trim(),
            email_content: email_content,
            status: status || 'Active',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await CommonModel.insertData('crm_email_campaign_template', insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error creating template"
            });
        }

        const newTemplate = await CommonModel.getData(
            'crm_email_campaign_template',
            '*',
            `id = ${result}`
        );

        res.status(201).json({
            success: true,
            message: "Template created successfully",
            data: newTemplate[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateTemplate = async (req, res) => {
    try {
        const { templateId } = req.params;
        const { template_name, email_subject, email_content, status } = req.body;

        const existing = await CommonModel.getData(
            'crm_email_campaign_template',
            '*',
            `id = ${templateId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Template not found"
            });
        }

        const updateData = { updated_at: new Date() };

        if (template_name && template_name.trim()) {
            const slug = slugify(template_name, { lower: true, strict: true });
            const slugExists = await CommonModel.getData(
                'crm_email_campaign_template',
                'id',
                `slug = '${slug}' AND id != ${templateId}`
            );
            if (slugExists && slugExists.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Another template with this name exists"
                });
            }
            updateData.template_name = template_name.trim();
            updateData.slug = slug;
        }

        if (email_subject && email_subject.trim()) updateData.email_subject = email_subject.trim();
        if (email_content) updateData.email_content = email_content;
        if (status) updateData.status = status;

        const updated = await CommonModel.updateData(
            'crm_email_campaign_template',
            updateData,
            `id = ${templateId}`
        );

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating template"
            });
        }

        const updatedTemplate = await CommonModel.getData(
            'crm_email_campaign_template',
            '*',
            `id = ${templateId}`
        );

        res.status(200).json({
            success: true,
            message: "Template updated successfully",
            data: updatedTemplate[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteTemplate = async (req, res) => {
    try {
        const { templateId } = req.params;

        const existing = await CommonModel.getData(
            'crm_email_campaign_template',
            '*',
            `id = ${templateId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Template not found"
            });
        }

        const campaignUsing = await CommonModel.getData(
            'crm_campaigns',
            'id',
            `FIND_IN_SET(${templateId}, template_id)`
        );

        if (campaignUsing && campaignUsing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete template used in campaigns"
            });
        }

        const deleted = await CommonModel.deleteRecord(
            'crm_email_campaign_template',
            `id = ${templateId}`
        );

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting template"
            });
        }

        res.status(200).json({
            success: true,
            message: "Template deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== SENDER MASTER ====================

export const getAllSenders = async (req, res) => {
    try {
        const { status, sender_name, email } = req.query;
        let condition = "1=1";
        
        if (status === 'active') condition = "status = 'Active'";
        if (status && status !== 'active') condition = `status = '${status}'`;
        if (sender_name) condition += ` AND sender_name LIKE '%${sender_name}%'`;
        if (email) condition += ` AND email LIKE '%${email}%'`;

        const senders = await CommonModel.getData(
            'crm_sender_emails',
            '*',
            condition,
            'id',
            'desc'
        );

        res.status(200).json({
            success: true,
            data: senders || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getSenderById = async (req, res) => {
    try {
        const { senderId } = req.params;

        const sender = await CommonModel.getData(
            'crm_sender_emails',
            '*',
            `id = ${senderId}`
        );

        if (!sender || sender.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Sender not found"
            });
        }

        res.status(200).json({
            success: true,
            data: sender[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createSender = async (req, res) => {
    try {
        const { sender_name, email, daily_limit, status } = req.body;

        if (!sender_name || !sender_name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Sender name is required"
            });
        }

        if (!email || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        const existing = await CommonModel.getData(
            'crm_sender_emails',
            'id',
            `email = '${email}'`
        );

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Email already exists"
            });
        }

        const insertData = {
            sender_name: sender_name.trim(),
            email: email.trim(),
            daily_limit: daily_limit || 500,
            status: status || 'Active',
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await CommonModel.insertData('crm_sender_emails', insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error creating sender"
            });
        }

        const newSender = await CommonModel.getData(
            'crm_sender_emails',
            '*',
            `id = ${result}`
        );

        res.status(201).json({
            success: true,
            message: "Sender created successfully",
            data: newSender[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateSender = async (req, res) => {
    try {
        const { senderId } = req.params;
        const { sender_name, email, daily_limit, status, email_details } = req.body;

        const existing = await CommonModel.getData(
            'crm_sender_emails',
            '*',
            `id = ${senderId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Sender not found"
            });
        }

        const updateData = { updated_at: new Date() };

        if (sender_name && sender_name.trim()) {
            updateData.sender_name = sender_name.trim();
        }

        if (email && email.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid email format"
                });
            }
            const emailExists = await CommonModel.getData(
                'crm_sender_emails',
                'id',
                `email = '${email}' AND id != ${senderId}`
            );
            if (emailExists && emailExists.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Email already exists"
                });
            }
            updateData.email = email.trim();
        }

        if (daily_limit !== undefined) updateData.daily_limit = daily_limit;
        if (status) updateData.status = status;
        if (email_details) updateData.email_details = JSON.stringify(email_details);

        const updated = await CommonModel.updateData(
            'crm_sender_emails',
            updateData,
            `id = ${senderId}`
        );

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating sender"
            });
        }

        const updatedSender = await CommonModel.getData(
            'crm_sender_emails',
            '*',
            `id = ${senderId}`
        );

        res.status(200).json({
            success: true,
            message: "Sender updated successfully",
            data: updatedSender[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteSender = async (req, res) => {
    try {
        const { senderId } = req.params;

        const existing = await CommonModel.getData(
            'crm_sender_emails',
            '*',
            `id = ${senderId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Sender not found"
            });
        }

        const campaignUsing = await CommonModel.getData(
            'crm_campaigns',
            'id',
            `FIND_IN_SET(${senderId}, sender_email_id)`
        );

        if (campaignUsing && campaignUsing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete sender used in campaigns"
            });
        }

        const deleted = await CommonModel.deleteRecord(
            'crm_sender_emails',
            `id = ${senderId}`
        );

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting sender"
            });
        }

        res.status(200).json({
            success: true,
            message: "Sender deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== MAILING LIST MASTER ====================

export const getAllMailingLists = async (req, res) => {
    try {
        const { status, name } = req.query;
        let condition = "1=1";
        
        if (status === 'active') condition = "status = 'Active'";
        if (status && status !== 'active') condition = `status = '${status}'`;
        if (name) condition += ` AND name LIKE '%${name}%'`;

        const lists = await CommonModel.getData(
            'crm_mailing_list',
            '*',
            condition,
            'id',
            'desc'
        );

        if (lists && lists.length) {
            for (let list of lists) {
                const emailCount = await CommonModel.getData(
                    'crm_marketing_email_recipient',
                    'COUNT(*) as total',
                    `mailing_list_id = ${list.id}`
                );
                list.email_count = emailCount && emailCount[0] ? Number(emailCount[0].total) : 0;
            }
        }

        res.status(200).json({
            success: true,
            data: lists || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getMailingListById = async (req, res) => {
    try {
        const { listId } = req.params;

        const list = await CommonModel.getData(
            'crm_mailing_list',
            '*',
            `id = ${listId}`
        );

        if (!list || list.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Mailing list not found"
            });
        }

        const emailCount = await CommonModel.getData(
            'crm_marketing_email_recipient',
            'COUNT(*) as total',
            `mailing_list_id = ${listId}`
        );
        list[0].email_count = emailCount && emailCount[0] ? Number(emailCount[0].total) : 0;

        res.status(200).json({
            success: true,
            data: list[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createMailingList = async (req, res) => {
    try {
        const { name, status, userId } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "List name is required"
            });
        }

        const existing = await CommonModel.getData(
            'crm_mailing_list',
            'id',
            `name = '${name}'`
        );

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Mailing list already exists"
            });
        }

        const timestamp = Math.floor(Date.now() / 1000);

        const insertData = {
            name: name.trim(),
            created_at: timestamp,
            updated_at: timestamp,
            status: status || 'Active',
            created_by: userId || 0,
            updated_by: userId || 0
        };

        const result = await CommonModel.insertData('crm_mailing_list', insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error creating mailing list"
            });
        }

        const newList = await CommonModel.getData(
            'crm_mailing_list',
            '*',
            `id = ${result}`
        );

        res.status(201).json({
            success: true,
            message: "Mailing list created successfully",
            data: newList[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateMailingList = async (req, res) => {
    try {
        const { listId } = req.params;
        const { name, status, userId } = req.body;

        const existing = await CommonModel.getData(
            'crm_mailing_list',
            '*',
            `id = ${listId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Mailing list not found"
            });
        }

        const updateData = {
            updated_at: Math.floor(Date.now() / 1000),
            updated_by: userId || 0
        };

        if (name && name.trim()) {
            const nameExists = await CommonModel.getData(
                'crm_mailing_list',
                'id',
                `name = '${name}' AND id != ${listId}`
            );
            if (nameExists && nameExists.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Mailing list with this name already exists"
                });
            }
            updateData.name = name.trim();
        }

        if (status) updateData.status = status;

        const updated = await CommonModel.updateData(
            'crm_mailing_list',
            updateData,
            `id = ${listId}`
        );

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating mailing list"
            });
        }

        const updatedList = await CommonModel.getData(
            'crm_mailing_list',
            '*',
            `id = ${listId}`
        );

        res.status(200).json({
            success: true,
            message: "Mailing list updated successfully",
            data: updatedList[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteMailingList = async (req, res) => {
    try {
        const { listId } = req.params;

        const existing = await CommonModel.getData(
            'crm_mailing_list',
            '*',
            `id = ${listId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Mailing list not found"
            });
        }

        const campaignUsing = await CommonModel.getData(
            'crm_campaign_mailing_lists',
            'id',
            `mailing_list_id = ${listId}`
        );

        if (campaignUsing && campaignUsing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete mailing list used in campaigns"
            });
        }

        await CommonModel.deleteRecord(
            'crm_marketing_email_recipient',
            `mailing_list_id = ${listId}`
        );

        const deleted = await CommonModel.deleteRecord(
            'crm_mailing_list',
            `id = ${listId}`
        );

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting mailing list"
            });
        }

        res.status(200).json({
            success: true,
            message: "Mailing list deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== RECIPIENT MANAGEMENT ====================

export const getRecipientsByList = async (req, res) => {
    try {
        const { listId } = req.params;
        const { name, email, mail_status } = req.query;
        
        let condition = `mailing_list_id = ${listId}`;
        if (name && name.trim()) {
            condition += ` AND (name LIKE '%${name}%' OR last_name LIKE '%${name}%')`;
        }
        if (email && email.trim()) {
            condition += ` AND email LIKE '%${email}%'`;
        }
        if (mail_status && mail_status.trim()) {
            condition += ` AND mail_status = '${mail_status}'`;
        }

        const recipients = await CommonModel.getData(
            'crm_marketing_email_recipient',
            '*',
            condition,
            'id',
            'desc'
        );

        res.status(200).json({
            success: true,
            data: recipients || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const addRecipient = async (req, res) => {
    try {
        const { listId } = req.params;
        const { name, last_name, email, userId } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        const existing = await CommonModel.getData(
            'crm_marketing_email_recipient',
            'id',
            `email = '${email}' AND mailing_list_id = ${listId}`
        );

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Email already exists"
            });
        }

        const insertData = {
            name: name || null,
            last_name: last_name || null,
            email: email,
            mailing_list_id: listId,
            mail_status: 'pending',
            created_at: new Date(),
            updated_at: new Date(),
            created_by: userId || 0,
            updated_by: userId || 0
        };

        const result = await CommonModel.insertData('crm_marketing_email_recipient', insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error adding recipient"
            });
        }

        const newRecipient = await CommonModel.getData(
            'crm_marketing_email_recipient',
            '*',
            `id = ${result}`
        );

        res.status(201).json({
            success: true,
            message: "Recipient added successfully",
            data: newRecipient[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateRecipient = async (req, res) => {
    try {
        const { recipientId } = req.params;
        const { name, last_name, email, mail_status, userId } = req.body;

        const existing = await CommonModel.getData(
            'crm_marketing_email_recipient',
            '*',
            `id = ${recipientId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Recipient not found"
            });
        }

        const updateData = { updated_at: new Date(), updated_by: userId || 0 };

        if (name !== undefined) updateData.name = name;
        if (last_name !== undefined) updateData.last_name = last_name;
        if (mail_status) updateData.mail_status = mail_status;

        if (email && email !== existing[0].email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid email format"
                });
            }
            const emailExists = await CommonModel.getData(
                'crm_marketing_email_recipient',
                'id',
                `email = '${email}' AND id != ${recipientId}`
            );
            if (emailExists && emailExists.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Email already exists"
                });
            }
            updateData.email = email;
        }

        const updated = await CommonModel.updateData(
            'crm_marketing_email_recipient',
            updateData,
            `id = ${recipientId}`
        );

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating recipient"
            });
        }

        const updatedRecipient = await CommonModel.getData(
            'crm_marketing_email_recipient',
            '*',
            `id = ${recipientId}`
        );

        res.status(200).json({
            success: true,
            message: "Recipient updated successfully",
            data: updatedRecipient[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteRecipients = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids) {
            return res.status(400).json({
                success: false,
                message: "No recipient IDs provided"
            });
        }

        let idArray;
        if (Array.isArray(ids)) {
            idArray = ids;
        } else if (typeof ids === 'string') {
            idArray = ids.split(',').map(id => id.trim());
        } else {
            return res.status(400).json({
                success: false,
                message: "Invalid IDs format"
            });
        }

        if (idArray.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid IDs provided"
            });
        }

        const condition = `id IN (${idArray.join(',')})`;
        const deleted = await CommonModel.deleteRecord('crm_marketing_email_recipient', condition);

        res.status(200).json({
            success: true,
            message: `${idArray.length} recipient(s) deleted successfully`
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const importCSV = async (req, res) => {
    console.log("=== IMPORT CSV START ===");
    
    try {
        const { list_id } = req.body;
        
        if (!list_id) {
            return res.status(400).json({ 
                success: false, 
                message: "List ID is required" 
            });
        }
        
        if (!req.parsedCSV || req.parsedCSV.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "No valid data found in CSV" 
            });
        }

        // console.log("Parse CSv: ", req.parsedCSV);
        // console.log("ID : ", req.body.list_id);
    
        let inserted = 0;
        let skipped = 0;
        let duplicateEmails = []; // For emails that already exist in this list
        let failedImports = []; // For other errors
        
        for (let i = 0; i < req.parsedCSV.length; i++) {
            const row = req.parsedCSV[i];
            // Support multiple field name variations
            const email = row.email || row.Email || row.EMAIL;
            const firstName = row.first_name || row.firstname || row.firstName || row.name || row.Name;
            const lastName = row.last_name || row.lastname || row.lastName || '';
            const rowNum = i + 2;
            
            // Validate email
            if (!email) {
                skipped++;
                failedImports.push({
                    row: rowNum,
                    email: 'Missing',
                    reason: 'Email address is required'
                });
                continue;
            }
            
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                skipped++;
                failedImports.push({
                    row: rowNum,
                    email: email,
                    reason: 'Invalid email format'
                });
                continue;
            }

            // console.log("validations done");
            
            
            // Check if email already exists in this mailing list
            const existing = await CommonModel.getData(
                'crm_marketing_email_recipient',
                'id',
                `email = '${email}' AND mailing_list_id = ${list_id}`
            );
            
            // console.log("Db failing");
            
            // console.log("existing ", existing);
            
            if (existing && existing.length > 0) {
                skipped++;
                duplicateEmails.push({
                    row: rowNum,
                    email: email,
                    name: firstName,
                    last_name: lastName,
                    reason: 'Email already exists in this mailing list'
                });
                continue;
            }
            
            // Insert recipient
            const insertData = {
                name: firstName || '',
                last_name: lastName || '',
                email: email,
                mailing_list_id: list_id,
                mail_status: 'pending',
                created_at: new Date(),
                updated_at: new Date(),
                created_by: req.user?.id || 1,
                updated_by: req.user?.id || 1
            };
            console.log("Insert data by king make lokesh jaiswar if you have gut fix it", insertData);
            
            try {
                // console.log("Inside try");
                
                const result = await CommonModel.insertData('crm_marketing_email_recipient', insertData);
                console.log("Result by king make lokesh jaiswaar brother name uppercase  :", {result});
                
                if (result) {
                    console.log("if block");
                    
                    inserted++;
                } else {
                    skipped++;
                    console.log("else");
                    
                    failedImports.push({
                        row: rowNum,
                        email: email,
                        reason: 'Database insert failed'
                    });
                }
            } catch (dbError) {
                if (dbError.code === 'ER_DUP_ENTRY') {
                    skipped++;
                    duplicateEmails.push({
                        row: rowNum,
                        email: email,
                        name: firstName,
                        last_name: lastName,
                        reason: 'Email already exists'
                    });
                } else {
                    skipped++;
                    failedImports.push({
                        row: rowNum,
                        email: email,
                        reason: dbError.message
                    });
                }
            }
        }
        
        // Clean up file
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.json({
            success: true,
            message: `${inserted} imported, ${skipped} skipped`,
            data: { 
                inserted, 
                skipped,
                duplicate_emails: duplicateEmails,
                failed_imports: failedImports
            }
        });
        
    } catch (error) {
        console.error("Import error:", error);
        
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ 
            success: false, 
            message: "Import failed: " + error.message 
        });
    }
};

// ==================== CAMPAIGN MANAGEMENT ====================

export const getAllCampaigns = async (req, res) => {
    try {
        const { name, status } = req.query;
        let condition = "1=1";
        
        if (name) condition += ` AND name LIKE '%${name}%'`;
        if (status) condition += ` AND status = '${status}'`;

        const campaigns = await CommonModel.getData(
            'crm_campaigns',
            '*',
            condition,
            'id',
            'desc'
        );

        if (campaigns && campaigns.length) {
            for (let campaign of campaigns) {
                const senderIds = campaign.sender_email_id?.split(',') || [];
                if (senderIds.length && senderIds[0]) {
                    const senders = await CommonModel.getData(
                        'crm_sender_emails',
                        'email',
                        `id IN (${senderIds.join(',')})`
                    );
                    campaign.sender_emails = senders?.map(s => s.email).join(', ') || '';
                } else {
                    campaign.sender_emails = '';
                }

                const templateIds = campaign.template_id?.split(',') || [];
                if (templateIds.length && templateIds[0]) {
                    const templates = await CommonModel.getData(
                        'crm_email_campaign_template',
                        'template_name',
                        `id IN (${templateIds.join(',')})`
                    );
                    campaign.template_names = templates?.map(t => t.template_name).join(', ') || '';
                } else {
                    campaign.template_names = '';
                }

                // Get mailing list names for this campaign
                const campaignLists = await CommonModel.joinFetch(
                    ["crm_campaign_mailing_lists as cml", ["ml.name"]],
                    [["LEFT", "crm_mailing_list as ml", "cml.mailing_list_id = ml.id"]],
                    `cml.campaign_id = ${campaign.id}`
                );
                campaign.mailing_list_names = campaignLists?.map(cl => cl.name) || [];
                campaign.mailing_list_count = campaign.mailing_list_names.length;
            }
        }

        res.status(200).json({
            success: true,
            data: campaigns || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getCampaignById = async (req, res) => {
    try {
        const { campaignId } = req.params;

        const campaign = await CommonModel.getData(
            'crm_campaigns',
            '*',
            `id = ${campaignId}`
        );

        if (!campaign || campaign.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found"
            });
        }

        const mailingLists = await CommonModel.getData(
            'crm_campaign_mailing_lists',
            '*',
            `campaign_id = ${campaignId}`
        );

        const campaignData = campaign[0];
        campaignData.mail_from_ids = campaignData.sender_email_id?.split(',') || [];
        campaignData.mail_list_ids = mailingLists?.map(ml => ml.mailing_list_id) || [];
        campaignData.mail_template_ids = campaignData.template_id?.split(',') || [];

        // Get mailing list names
        const mailingListNames = await CommonModel.getData(
            'crm_mailing_list',
            'name',
            `id IN (${campaignData.mail_list_ids.join(',') || 0})`
        );
        campaignData.mailing_list_names = mailingListNames?.map(ml => ml.name) || [];

        res.status(200).json({
            success: true,
            data: campaignData
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createCampaign = async (req, res) => {
    try {
        const { campaign_name, mail_template, schedule_time, mail_from, mail_list } = req.body;

        if (!campaign_name) {
            return res.status(400).json({
                success: false,
                message: "Campaign name is required"
            });
        }

        if (!mail_template || !mail_template.length) {
            return res.status(400).json({
                success: false,
                message: "At least one template is required"
            });
        }

        if (!mail_from || !mail_from.length) {
            return res.status(400).json({
                success: false,
                message: "At least one sender email is required"
            });
        }

        if (!mail_list || !mail_list.length) {
            return res.status(400).json({
                success: false,
                message: "At least one mailing list is required"
            });
        }

        const templateIds = Array.isArray(mail_template) ? mail_template : [mail_template];
        const senderIds = Array.isArray(mail_from) ? mail_from : [mail_from];
        const mailingListIds = Array.isArray(mail_list) ? mail_list : [mail_list];

        const campaignData = {
            name: campaign_name,
            template_id: templateIds.join(','),
            sender_email_id: senderIds.join(','),
            schedule_time: schedule_time || new Date(),
            status: 'scheduled',
            created_at: new Date(),
            updated_at: new Date()
        };

        const campaignId = await CommonModel.insertData('crm_campaigns', campaignData);

        if (!campaignId) {
            return res.status(400).json({
                success: false,
                message: "Error creating campaign"
            });
        }

        for (const listId of mailingListIds) {
            const emailCount = await CommonModel.getData(
                'crm_marketing_email_recipient',
                'COUNT(*) as total',
                `mailing_list_id = ${listId}`
            );

            await CommonModel.insertData('crm_campaign_mailing_lists', {
                campaign_id: campaignId,
                mailing_list_id: listId,
                status: 'pending',
                total_emails: emailCount?.[0]?.total || 0,
                sent_count: 0
            });
        }

        const newCampaign = await CommonModel.getData(
            'crm_campaigns',
            '*',
            `id = ${campaignId}`
        );

        res.status(201).json({
            success: true,
            message: "Campaign created successfully",
            data: newCampaign[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateCampaign = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { campaign_name, mail_template, schedule_time, mail_from, mail_list } = req.body;

        const existing = await CommonModel.getData(
            'crm_campaigns',
            '*',
            `id = ${campaignId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found"
            });
        }

        const updateData = { updated_at: new Date() };

        if (campaign_name) updateData.name = campaign_name;
        if (schedule_time) updateData.schedule_time = schedule_time;

        if (mail_template && mail_template.length) {
            const templateIds = Array.isArray(mail_template) ? mail_template : [mail_template];
            updateData.template_id = templateIds.join(',');
        }

        if (mail_from && mail_from.length) {
            const senderIds = Array.isArray(mail_from) ? mail_from : [mail_from];
            updateData.sender_email_id = senderIds.join(',');
        }

        const updated = await CommonModel.updateData(
            'crm_campaigns',
            updateData,
            `id = ${campaignId}`
        );

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating campaign"
            });
        }

        if (mail_list && mail_list.length) {
            await CommonModel.deleteRecord(
                'crm_campaign_mailing_lists',
                `campaign_id = ${campaignId}`
            );

            const mailingListIds = Array.isArray(mail_list) ? mail_list : [mail_list];
            for (const listId of mailingListIds) {
                const emailCount = await CommonModel.getData(
                    'crm_marketing_email_recipient',
                    'COUNT(*) as total',
                    `mailing_list_id = ${listId}`
                );

                await CommonModel.insertData('crm_campaign_mailing_lists', {
                    campaign_id: campaignId,
                    mailing_list_id: listId,
                    status: 'pending',
                    total_emails: emailCount?.[0]?.total || 0,
                    sent_count: 0
                });
            }
        }

        const updatedCampaign = await CommonModel.getData(
            'crm_campaigns',
            '*',
            `id = ${campaignId}`
        );

        res.status(200).json({
            success: true,
            message: "Campaign updated successfully",
            data: updatedCampaign[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteCampaign = async (req, res) => {
    try {
        const { campaignId } = req.params;

        const existing = await CommonModel.getData(
            'crm_campaigns',
            '*',
            `id = ${campaignId}`
        );

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Campaign not found"
            });
        }

        await CommonModel.deleteRecord(
            'crm_campaign_mailing_lists',
            `campaign_id = ${campaignId}`
        );

        const deleted = await CommonModel.deleteRecord(
            'crm_campaigns',
            `id = ${campaignId}`
        );

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting campaign"
            });
        }

        res.status(200).json({
            success: true,
            message: "Campaign deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== CAMPAIGN MAILING LISTS ====================

export const getCampaignMailingLists = async (req, res) => {
    try {
        const { campaignId } = req.params;

        const campaignLists = await CommonModel.joinFetch(
            ["crm_campaign_mailing_lists as cml", ["cml.*", "ml.name as list_name"]],
            [
                ["LEFT", "crm_mailing_list as ml", "cml.mailing_list_id = ml.id"]
            ],
            `cml.campaign_id = ${campaignId}`,
            { "cml.id": "asc" }
        );

        res.status(200).json({
            success: true,
            data: campaignLists || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== CAMPAIGN LOGS ====================

// modules/controllers/V1/email-campaign.js

// modules/controllers/V1/email-campaign.js

export const getCampaignLogs = async (req, res) => {
    try {
        const { 
            campaignId, 
            page, 
            limit, 
            campaign_name, 
            recipient_email, 
            status, 
            date_from, 
            date_to 
        } = req.query;

        let condition = "1=1";
        
        // Build conditions for join query (using table aliases)
        let joinCondition = "1=1";
        
        if (campaignId) {
            joinCondition += ` AND l.campaign_id = ${campaignId}`;
        }
        if (campaign_name && campaign_name.trim()) {
            joinCondition += ` AND c.name LIKE '%${campaign_name}%'`;
        }
        if (recipient_email && recipient_email.trim()) {
            joinCondition += ` AND (l.recipient_email LIKE '%${recipient_email}%' OR r.email LIKE '%${recipient_email}%')`;
        }
        if (status && status.trim()) {
            joinCondition += ` AND l.status = '${status}'`;
        }
        if (date_from && date_from.trim()) {
            joinCondition += ` AND DATE(l.sent_at) >= '${date_from}'`;
        }
        if (date_to && date_to.trim()) {
            joinCondition += ` AND DATE(l.sent_at) <= '${date_to}'`;
        }

        // For total count query (no table alias)
        let countCondition = "1=1";
        
        if (campaignId) {
            countCondition += ` AND campaign_id = ${campaignId}`;
        }
        if (status && status.trim()) {
            countCondition += ` AND status = '${status}'`;
        }
        if (date_from && date_from.trim()) {
            countCondition += ` AND DATE(sent_at) >= '${date_from}'`;
        }
        if (date_to && date_to.trim()) {
            countCondition += ` AND DATE(sent_at) <= '${date_to}'`;
        }
        if (recipient_email && recipient_email.trim()) {
            countCondition += ` AND recipient_email LIKE '%${recipient_email}%'`;
        }

        // console.log("Join Condition:", joinCondition);
        // console.log("Count Condition:", countCondition);

        if (page && limit) {
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const logs = await CommonModel.joinFetch(
                ["crm_campaign_email_logs as l", ["l.*", "t.template_name", "s.email as sender_email", "c.name as campaign_name", "r.name as recipient_name", "r.email as recipient_email"]],
                [
                    ["LEFT", "crm_email_campaign_template as t", "l.template_id = t.id"],
                    ["LEFT", "crm_sender_emails as s", "l.sender_id = s.id"],
                    ["LEFT", "crm_campaigns as c", "l.campaign_id = c.id"],
                    ["LEFT", "crm_marketing_email_recipient as r", "l.recipient_id = r.id"]
                ],
                joinCondition,
                { "l.id": "desc" },
                "",
                { offset, rows: parseInt(limit) }
            );

            // Use countCondition without table alias
            const totalResult = await CommonModel.getData(
                'crm_campaign_email_logs', 
                'COUNT(*) as total', 
                countCondition
            );

            res.status(200).json({
                success: true,
                data: logs || [],
                pagination: {
                    totalRows: totalResult?.[0]?.total || 0,
                    perPage: parseInt(limit),
                    currentPage: parseInt(page),
                    totalPages: Math.ceil((totalResult?.[0]?.total || 0) / parseInt(limit))
                }
            });
        } else {
            const logs = await CommonModel.joinFetch(
                ["crm_campaign_email_logs as l", ["l.*", "t.template_name", "s.email as sender_email", "c.name as campaign_name", "r.name as recipient_name", "r.email as recipient_email"]],
                [
                    ["LEFT", "crm_email_campaign_template as t", "l.template_id = t.id"],
                    ["LEFT", "crm_sender_emails as s", "l.sender_id = s.id"],
                    ["LEFT", "crm_campaigns as c", "l.campaign_id = c.id"],
                    ["LEFT", "crm_marketing_email_recipient as r", "l.recipient_id = r.id"]
                ],
                joinCondition,
                { "l.id": "desc" }
            );

            res.status(200).json({
                success: true,
                data: logs || []
            });
        }
    } catch (error) {
        console.error('Error in getCampaignLogs:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== DASHBOARD DATA ====================

export const getCampaignFormData = async (req, res) => {
    try {
        const senders = await CommonModel.getData(
            'crm_sender_emails',
            'id, sender_name, email',
            "status = 'Active'"
        );

        const lists = await CommonModel.getData(
            'crm_mailing_list',
            'id, name',
            "status = 'Active'"
        );

        for (let list of lists) {
            const count = await CommonModel.getData(
                'crm_marketing_email_recipient',
                'COUNT(*) as total',
                `mailing_list_id = ${list.id}`
            );
            list.email_count = count?.[0]?.total || 0;
        }

        const templates = await CommonModel.getData(
            'crm_email_campaign_template',
            'id, template_name, email_subject',
            "status = 'Active'"
        );

        res.status(200).json({
            success: true,
            data: {
                senders: senders || [],
                mailing_lists: lists || [],
                templates: templates || []
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getDashboardStats = async (req, res) => {
    try {
        const totalCampaigns = await CommonModel.getData('crm_campaigns', 'COUNT(*) as total');
        const scheduledCampaigns = await CommonModel.getData('crm_campaigns', 'COUNT(*) as total', "status = 'scheduled'");
        const completedCampaigns = await CommonModel.getData('crm_campaigns', 'COUNT(*) as total', "status = 'completed'");
        
        const totalRecipients = await CommonModel.getData('crm_marketing_email_recipient', 'COUNT(*) as total');
        const totalLists = await CommonModel.getData('crm_mailing_list', 'COUNT(*) as total', "status = 'Active'");
        const totalTemplates = await CommonModel.getData('crm_email_campaign_template', 'COUNT(*) as total', "status = 'Active'");
        
        const emailsSent = await CommonModel.getData('crm_campaign_email_logs', 'COUNT(*) as total', "status = 'sent'");
        const emailsFailed = await CommonModel.getData('crm_campaign_email_logs', 'COUNT(*) as total', "status = 'failed'");

        res.status(200).json({
            success: true,
            data: {
                total_campaigns: totalCampaigns?.[0]?.total || 0,
                scheduled_campaigns: scheduledCampaigns?.[0]?.total || 0,
                completed_campaigns: completedCampaigns?.[0]?.total || 0,
                total_recipients: totalRecipients?.[0]?.total || 0,
                total_mailing_lists: totalLists?.[0]?.total || 0,
                total_templates: totalTemplates?.[0]?.total || 0,
                emails_sent: emailsSent?.[0]?.total || 0,
                emails_failed: emailsFailed?.[0]?.total || 0
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== GMAIL CONNECTION ====================

// Step 1: Get Google Auth URL
export const getGmailAuthUrl = async (req, res) => {
    try {
        const { senderId } = req.params;
        
        // ✅ Directly generate URL with senderId in state
        const authUrl = GoogleOAuthHelper.getAuthUrl(senderId);
        
        res.json({ 
            success: true, 
            url: authUrl 
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Step 2: Gmail Callback - Google redirects here
export const gmailCallback = async (req, res) => {
    try {
        const { code, state } = req.query;
        
        if (!code) {
            throw new Error('No authorization code received');
        }
        
        let senderId = null;
        if (state) {
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            senderId = stateData.senderId;
        }
        
        if (!senderId) {
            throw new Error('No sender ID found in state');
        }
        
        // Exchange code for tokens
        const tokens = await GoogleOAuthHelper.getTokensFromCode(code);
        
        // Save tokens to database
        await GoogleOAuthHelper.saveTokens(senderId, tokens);
        
        console.log(`✅ Gmail connected successfully for sender ID: ${senderId}`);
        
        // Redirect to frontend
        res.redirect(`${process.env.FRONTEND_URL}/email-campaign/senders?gmail_connected=true`);
        
    } catch (error) {
        console.error('Error in gmailCallback:', error);
        res.redirect(`${process.env.FRONTEND_URL}/email-campaign/senders?gmail_connected=false&error=${encodeURIComponent(error.message)}`);
    }
};