import CommonModel from '../../../modules/models/mysql/commonModel/commonModel.js';
import { slugify } from '../../../helpers/V1/core_helper.js';

export const getAllTemplates = async (req, res) => {
    try {
        const { status } = req.query;
        let condition = "1=1";
        if (status === 'active') condition = "status = 'Active'";

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
        const { status } = req.query;
        let condition = "1=1";
        if (status === 'active') condition = "status = 'Active'";

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
        const { email, daily_limit, status } = req.body;

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
        const { email, daily_limit, status, email_details } = req.body;

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
        const { status } = req.query;
        let condition = "1=1";
        if (status === 'active') condition = "status = 'Active'";

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

        const recipients = await CommonModel.getData(
            'crm_marketing_email_recipient',
            '*',
            `mailing_list_id = ${listId}`,
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
            `email = '${email}'`
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

// ==================== CAMPAIGN MANAGEMENT ====================

export const getAllCampaigns = async (req, res) => {
    try {
        const campaigns = await CommonModel.getData(
            'crm_campaigns',
            '*',
            '1=1',
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

                const mailingLists = await CommonModel.getData(
                    'crm_campaign_mailing_lists',
                    'COUNT(*) as list_count',
                    `campaign_id = ${campaign.id}`
                );
                campaign.mailing_list_count = mailingLists?.[0]?.list_count || 0;
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

export const getCampaignLogs = async (req, res) => {
    try {
        const { campaignId, page, limit } = req.query;

        let condition = "1=1";
        if (campaignId) condition = `l.campaign_id = ${campaignId}`;

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
                condition,
                { "l.id": "desc" },
                "",
                { offset, rows: parseInt(limit) }
            );

            const totalResult = await CommonModel.getData('crm_campaign_email_logs', 'COUNT(*) as total', condition);

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
                condition,
                { "l.id": "desc" }
            );

            res.status(200).json({
                success: true,
                data: logs || []
            });
        }
    } catch (error) {
        console.error('Error:', error);
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
            'id, email',
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