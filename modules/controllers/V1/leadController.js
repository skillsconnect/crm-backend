import fs from 'fs';
import CommonModel from '../../../modules/models/mysql/commonModel/commonModel.js';
import { parse } from 'json2csv';
import PDFParserService from '../../../services/pdfParserService.js';
import OCRService from '../../../services/ocrService.js';

const TABLES = {
    LEADS: 'crm_leads',
    STATUS: 'crm_lead_status',
    SOURCE: 'crm_lead_source',
    PROCESS_STAFF: 'crm_process_staff',
    PROCESS: 'crm_process',
    EMAIL_QUEUE: 'crm_email_queue'
};

// ==================== HELPER FUNCTIONS ====================

const queueIntroductoryEmail = async (leadId, data) => {
    try {
        const emailData = {
            lead_id: leadId,
            email_to: data.email,
            email_subject: data.email_subject,
            email_content: data.email_content,
            contact_date_time: data.contact_date_time,
            status: 'pending',
            created_on: new Date(),
            updated_on: new Date()
        };
        
        await CommonModel.insertData(TABLES.EMAIL_QUEUE, emailData);
        console.log(`Email queued for lead ${leadId}`);
        return true;
    } catch (error) {
        console.error('Error queueing email:', error);
        return false;
    }
};

// ==================== LEAD STATUS CRUD ====================

export const getAllStatuses = async (req, res) => {
    try {
        const { status } = req.query;
        let condition = "1=1";
        
        if (status === 'active') condition = "status = 'Active'";
        if (status && status !== 'active') condition = `status = '${status}'`;

        const statuses = await CommonModel.getData(
            TABLES.STATUS,
            '*',
            condition,
            'sequence',
            'asc'
        );

        res.status(200).json({
            success: true,
            data: statuses || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getStatusById = async (req, res) => {
    try {
        const { id } = req.params;
        const status = await CommonModel.getData(TABLES.STATUS, '*', `id = ${id}`);

        if (!status || status.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Status not found"
            });
        }

        res.status(200).json({
            success: true,
            data: status[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createStatus = async (req, res) => {
    try {
        const { name, color, sequence, status } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Status name is required"
            });
        }

        const existing = await CommonModel.getData(
            TABLES.STATUS,
            'id',
            `name = '${name.trim()}'`
        );

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Status already exists"
            });
        }

        const maxSequence = await CommonModel.getData(
            TABLES.STATUS,
            'MAX(sequence) as max_seq',
            "1=1"
        );
        
        const nextSequence = (maxSequence?.[0]?.max_seq || 0) + 1;

        const insertData = {
            name: name.trim(),
            color: color || '#6B7280',
            sequence: sequence || nextSequence,
            status: status || 'Active',
            created_on: new Date(),
            updated_on: new Date(),
            created_by: req.user?.id || 1,
            updated_by: req.user?.id || 1
        };

        const result = await CommonModel.insertData(TABLES.STATUS, insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error creating status"
            });
        }

        const newStatus = await CommonModel.getData(TABLES.STATUS, '*', `id = ${result}`);

        res.status(201).json({
            success: true,
            message: "Status created successfully",
            data: newStatus[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, color, sequence, status } = req.body;

        const existing = await CommonModel.getData(TABLES.STATUS, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Status not found"
            });
        }

        const updateData = {
            updated_on: new Date(),
            updated_by: req.user?.id || 1
        };

        if (name && name.trim()) {
            const nameExists = await CommonModel.getData(
                TABLES.STATUS,
                'id',
                `name = '${name.trim()}' AND id != ${id}`
            );
            if (nameExists && nameExists.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Another status with this name exists"
                });
            }
            updateData.name = name.trim();
        }

        if (color) updateData.color = color;
        if (sequence) updateData.sequence = sequence;
        if (status) updateData.status = status;

        const updated = await CommonModel.updateData(TABLES.STATUS, updateData, `id = ${id}`);

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating status"
            });
        }

        const updatedStatus = await CommonModel.getData(TABLES.STATUS, '*', `id = ${id}`);

        res.status(200).json({
            success: true,
            message: "Status updated successfully",
            data: updatedStatus[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await CommonModel.getData(TABLES.STATUS, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Status not found"
            });
        }

        const leadsUsing = await CommonModel.getData(
            TABLES.LEADS,
            'id',
            `status_id = ${id}`
        );

        if (leadsUsing && leadsUsing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete status used in leads"
            });
        }

        const deleted = await CommonModel.deleteRecord(TABLES.STATUS, `id = ${id}`);

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting status"
            });
        }

        res.status(200).json({
            success: true,
            message: "Status deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== LEAD SOURCE CRUD ====================

export const getAllSources = async (req, res) => {
    try {
        const { status } = req.query;
        let condition = "1=1";
        
        if (status === 'active') condition = "status = 'Active'";
        if (status && status !== 'active') condition = `status = '${status}'`;

        const sources = await CommonModel.getData(
            TABLES.SOURCE,
            '*',
            condition,
            'sequence',
            'asc'
        );

        res.status(200).json({
            success: true,
            data: sources || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getSourceById = async (req, res) => {
    try {
        const { id } = req.params;
        const source = await CommonModel.getData(TABLES.SOURCE, '*', `id = ${id}`);

        if (!source || source.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Source not found"
            });
        }

        res.status(200).json({
            success: true,
            data: source[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createSource = async (req, res) => {
    try {
        const { name, sequence, status } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Source name is required"
            });
        }

        const existing = await CommonModel.getData(
            TABLES.SOURCE,
            'id',
            `name = '${name.trim()}'`
        );

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Source already exists"
            });
        }

        const maxSequence = await CommonModel.getData(
            TABLES.SOURCE,
            'MAX(sequence) as max_seq',
            "1=1"
        );
        
        const nextSequence = (maxSequence?.[0]?.max_seq || 0) + 1;

        const insertData = {
            name: name.trim(),
            sequence: sequence || nextSequence,
            status: status || 'Active',
            created_on: new Date(),
            updated_on: new Date(),
            created_by: req.user?.id || 1,
            updated_by: req.user?.id || 1
        };

        const result = await CommonModel.insertData(TABLES.SOURCE, insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error creating source"
            });
        }

        const newSource = await CommonModel.getData(TABLES.SOURCE, '*', `id = ${result}`);

        res.status(201).json({
            success: true,
            message: "Source created successfully",
            data: newSource[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateSource = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, sequence, status } = req.body;

        const existing = await CommonModel.getData(TABLES.SOURCE, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Source not found"
            });
        }

        const updateData = {
            updated_on: new Date(),
            updated_by: req.user?.id || 1
        };

        if (name && name.trim()) {
            const nameExists = await CommonModel.getData(
                TABLES.SOURCE,
                'id',
                `name = '${name.trim()}' AND id != ${id}`
            );
            if (nameExists && nameExists.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Another source with this name exists"
                });
            }
            updateData.name = name.trim();
        }

        if (sequence) updateData.sequence = sequence;
        if (status) updateData.status = status;

        const updated = await CommonModel.updateData(TABLES.SOURCE, updateData, `id = ${id}`);

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating source"
            });
        }

        const updatedSource = await CommonModel.getData(TABLES.SOURCE, '*', `id = ${id}`);

        res.status(200).json({
            success: true,
            message: "Source updated successfully",
            data: updatedSource[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteSource = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await CommonModel.getData(TABLES.SOURCE, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Source not found"
            });
        }

        const leadsUsing = await CommonModel.getData(
            TABLES.LEADS,
            'id',
            `source_id = ${id}`
        );

        if (leadsUsing && leadsUsing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete source used in leads"
            });
        }

        const deleted = await CommonModel.deleteRecord(TABLES.SOURCE, `id = ${id}`);

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting source"
            });
        }

        res.status(200).json({
            success: true,
            message: "Source deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== LEAD CRUD ====================

export const importLeadsCSV = async (req, res) => {
    try {
        const records = req.parsedCSV;
        
        if (!records || records.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No data to import"
            });
        }

        let imported = 0;
        let failed = 0;
        const errors = [];

        for (const record of records) {
            try {
                // Validate required fields
                if (!record.name || !record.name.trim()) {
                    errors.push(`Row ${imported + failed + 1}: Name is required`);
                    failed++;
                    continue;
                }

                // Prepare insert data
                const insertData = {
                    name: record.name.trim(),
                    email: record.email || null,
                    phone: record.phone || null,
                    company: record.company || null,
                    designation: record.designation || record.position || null,
                    tags: record.tags || null,
                    status: 'Active',
                    created_on: new Date(),
                    updated_on: new Date(),
                    created_by: req.user?.id || 1,
                    updated_by: req.user?.id || 1
                };

                // Try to match status by name
                if (record.status) {
                    const statuses = await CommonModel.getData(
                        'crm_lead_status',
                        'id',
                        `name = '${record.status}' AND status = 'Active'`
                    );
                    if (statuses && statuses.length > 0) {
                        insertData.status_id = statuses[0].id;
                    }
                }

                // Try to match source by name
                if (record.source) {
                    const sources = await CommonModel.getData(
                        'crm_lead_source',
                        'id',
                        `name = '${record.source}' AND status = 'Active'`
                    );
                    if (sources && sources.length > 0) {
                        insertData.source_id = sources[0].id;
                    }
                }

                const result = await CommonModel.insertData('crm_leads', insertData);
                if (result) {
                    imported++;
                } else {
                    failed++;
                    errors.push(`Row ${imported + failed}: Failed to insert`);
                }
            } catch (err) {
                failed++;
                errors.push(`Row ${imported + failed}: ${err.message}`);
            }
        }

        // Clean up temp file
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(200).json({
            success: true,
            message: `Imported ${imported} leads successfully, ${failed} failed`,
            data: {
                imported,
                failed,
                errors: errors.slice(0, 10) // Return first 10 errors
            }
        });
    } catch (error) {
        console.error('Import error:', error);
        
        // Clean up temp file
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({
            success: false,
            message: error.message || "Failed to import leads"
        });
    }
};

export const exportLeadsCSV = async (req, res) => {
    try {
        const { status_id, source_id, search } = req.query;
        let condition = "l.status = 'Active'";
        
        if (status_id) condition += ` AND l.status_id = ${status_id}`;
        if (source_id) condition += ` AND l.source_id = ${source_id}`;
        if (search) condition += ` AND (l.name LIKE '%${search}%' OR l.email LIKE '%${search}%')`;

        const leads = await CommonModel.joinFetch(
            ["crm_leads as l", [
                "l.name",
                "l.email",
                "l.phone",
                "l.company",
                "l.designation",
                "l.tags",
                "l.notes",
                "s.name as status_name",
                "src.name as source_name"
            ]],
            [
                ["LEFT", "crm_lead_status as s", "l.status_id = s.id"],
                ["LEFT", "crm_lead_source as src", "l.source_id = src.id"]
            ],
            condition,
            { "l.id": "desc" }
        );

        if (!leads || leads.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No leads found to export"
            });
        }

        // Format data for CSV
        const csvData = leads.map(lead => ({
            'Name': lead.name,
            'Email': lead.email || '',
            'Phone': lead.phone || '',
            'Company': lead.company || '',
            'Designation': lead.designation || '',
            'Status': lead.status_name || '',
            'Source': lead.source_name || '',
            'Tags': lead.tags || '',
            'Notes': lead.notes || ''
        }));

        const csv = parse(csvData);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=leads_export_${Date.now()}.csv`);
        res.status(200).send(csv);
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to export leads"
        });
    }
};

export const getImportTemplate = async (req, res) => {
    try {
        const template = `name,email,phone,company,designation,status,source,tags,notes
John Doe,john@example.com,9876543210,ABC Corp,HR Manager,In Follow Up,LinkedIn,hot,Interested in demo
Jane Smith,jane@example.com,9876543211,XYZ Ltd,CEO,Cold,Website,warm,Will contact next quarter`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=lead_import_template.csv');
        res.status(200).send(template);
        
    } catch (error) {
        console.error('Template error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to generate template"
        });
    }
};

export const getAllLeads = async (req, res) => {
    try {
        const { status_id, source_id, assigned_to, search, page = 1, limit = 15 } = req.query;
        let condition = "l.status = 'Active'";
        
        if (status_id) condition += ` AND l.status_id = ${status_id}`;
        if (source_id) condition += ` AND l.source_id = ${source_id}`;
        if (assigned_to) condition += ` AND l.assigned_to = ${assigned_to}`;
        if (search) {
            condition += ` AND (l.name LIKE '%${search}%' 
                              OR l.email LIKE '%${search}%' 
                              OR l.phone LIKE '%${search}%'
                              OR l.company LIKE '%${search}%')`;
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const leads = await CommonModel.joinFetch(
            ["crm_leads as l", [
                "l.*",
                "s.name as status_name",
                "s.color as status_color",
                "src.name as source_name",
                "u.full_name as assigned_name"
            ]],
            [
                ["LEFT", "crm_lead_status as s", "l.status_id = s.id"],
                ["LEFT", "crm_lead_source as src", "l.source_id = src.id"],
                ["LEFT", "ups_users as u", "l.assigned_to = u.id"]
            ],
            condition,
            { "l.id": "desc" },
            "",
            { offset, rows: parseInt(limit) }
        );

        // Get total count
        const totalResult = await CommonModel.getData(
            'crm_leads',
            'COUNT(*) as total',
            condition.replace(/l\./g, '')
        );
        const total = totalResult?.[0]?.total || 0;

        // Get all active processes
        const allProcesses = await CommonModel.getData(
            'crm_process',
            'id, sequence',
            "status = 'Active'",
            'sequence',
            'asc'
        );

        // If no leads, return empty array
        if (!leads || leads.length === 0) {
            return res.status(200).json({
                success: true,
                data: [],
                pagination: {
                    total: 0,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: 0
                }
            });
        }

        // Get process completion status for each lead
        for (const lead of leads) {
            // ✅ FIX: Make sure completedProcesses is always an array
            let completedProcesses = await CommonModel.getData(
                'crm_process_staff',
                'master_process_id',
                `lead_id = ${lead.id} AND email_sent = 'sent'`
            );
            
            // If no data or false, set to empty array
            if (!completedProcesses) {
                completedProcesses = [];
            }
            
            // Ensure it's an array
            if (!Array.isArray(completedProcesses)) {
                completedProcesses = [];
            }
            
            const completedIds = new Set(completedProcesses.map(p => p.master_process_id));
            
            // Initialize process_status array
            lead.process_status = [];
            
            // Fill process_status based on allProcesses
            if (allProcesses && allProcesses.length > 0) {
                lead.process_status = allProcesses.map(p => completedIds.has(p.id));
            }
        }

        res.status(200).json({
            success: true,
            data: leads || [],
            pagination: {
                total: total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error in getAllLeads:', error);
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
};

export const getLeadById = async (req, res) => {
    try {
        const { id } = req.params;

        const leads = await CommonModel.joinFetch(
            ["crm_leads as l", [
                "l.*",
                "s.name as status_name",
                "s.color as status_color",
                "src.name as source_name",
                "u.full_name as assigned_name"
            ]],
            [
                ["LEFT", "crm_lead_status as s", "l.status_id = s.id"],
                ["LEFT", "crm_lead_source as src", "l.source_id = src.id"],
                ["LEFT", "ups_users as u", "l.assigned_to = u.id"]
            ],
            `l.id = ${id}`
        );

        if (!leads || leads.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Lead not found"
            });
        }

        const result = leads[0];

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createLead = async (req, res) => {
    try {
        const {
            name, email, phone, company, designation, position,
            status_id, source_id, assigned_to, tags, notes,
            address, city, state, country, zip_code,
            website, lead_value, description, public_contacted_today,
            employee_count, sector_industry, alternate_emails,
            send_introductory_mail, email_subject, email_content,
            next_followup_date, contact_date_time
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Lead name is required"
            });
        }

        const insertData = {
            name: name.trim(),
            email: email || null,
            phone: phone || null,
            company: company || null,
            designation: designation || null,
            position: position || null,
            status_id: status_id || null,
            source_id: source_id || null,
            assigned_to: assigned_to || null,
            tags: tags || null,
            notes: notes || null,
            address: address || null,
            city: city || null,
            state: state || null,
            country: country || null,
            zip_code: zip_code || null,
            website: website || null,
            lead_value: lead_value || null,
            description: description || null,
            public_contacted_today: public_contacted_today ? 1 : 0,
            employee_count: employee_count || null,
            sector_industry: sector_industry || null,
            alternate_emails: alternate_emails || null,
            send_introductory_mail: send_introductory_mail ? 1 : 0,
            email_subject: email_subject || null,
            email_content: email_content || null,
            next_followup_date: next_followup_date || null,
            contact_date_time: contact_date_time || null,
            status: 'Active',
            created_on: new Date(),
            updated_on: new Date(),
            created_by: req.user?.id || 1,
            updated_by: req.user?.id || 1
        };

        const result = await CommonModel.insertData(TABLES.LEADS, insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error creating lead"
            });
        }

        // If send_introductory_mail is true, queue the email
        if (send_introductory_mail && contact_date_time && email_subject && email_content) {
            await queueIntroductoryEmail(result, {
                email: email,
                email_subject: email_subject,
                email_content: email_content,
                contact_date_time: contact_date_time
            });
        }

        const newLead = await CommonModel.getData(TABLES.LEADS, '*', `id = ${result}`);

        res.status(201).json({
            success: true,
            message: "Lead created successfully",
            data: newLead[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateLead = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, email, phone, company, designation, position,
            status_id, source_id, assigned_to, tags, notes,
            address, city, state, country, zip_code,
            website, lead_value, description, public_contacted_today,
            employee_count, sector_industry, alternate_emails,
            send_introductory_mail, email_subject, email_content,
            next_followup_date, contact_date_time
        } = req.body;

        const existing = await CommonModel.getData(TABLES.LEADS, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Lead not found"
            });
        }

        const updateData = {
            updated_on: new Date(),
            updated_by: req.user?.id || 1
        };

        if (name) updateData.name = name.trim();
        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;
        if (company !== undefined) updateData.company = company;
        if (designation !== undefined) updateData.designation = designation;
        if (position !== undefined) updateData.position = position;
        if (status_id !== undefined) updateData.status_id = status_id;
        if (source_id !== undefined) updateData.source_id = source_id;
        if (assigned_to !== undefined) updateData.assigned_to = assigned_to;
        if (tags !== undefined) updateData.tags = tags;
        if (notes !== undefined) updateData.notes = notes;
        if (address !== undefined) updateData.address = address;
        if (city !== undefined) updateData.city = city;
        if (state !== undefined) updateData.state = state;
        if (country !== undefined) updateData.country = country;
        if (zip_code !== undefined) updateData.zip_code = zip_code;
        if (website !== undefined) updateData.website = website;
        if (lead_value !== undefined) updateData.lead_value = lead_value;
        if (description !== undefined) updateData.description = description;
        if (public_contacted_today !== undefined) updateData.public_contacted_today = public_contacted_today ? 1 : 0;
        if (employee_count !== undefined) updateData.employee_count = employee_count;
        if (sector_industry !== undefined) updateData.sector_industry = sector_industry;
        if (alternate_emails !== undefined) updateData.alternate_emails = alternate_emails;
        if (send_introductory_mail !== undefined) updateData.send_introductory_mail = send_introductory_mail ? 1 : 0;
        if (email_subject !== undefined) updateData.email_subject = email_subject;
        if (email_content !== undefined) updateData.email_content = email_content;
        if (next_followup_date !== undefined) updateData.next_followup_date = next_followup_date;
        if (contact_date_time !== undefined) updateData.contact_date_time = contact_date_time;

        const updated = await CommonModel.updateData(TABLES.LEADS, updateData, `id = ${id}`);

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating lead"
            });
        }

        const updatedLead = await CommonModel.getData(TABLES.LEADS, '*', `id = ${id}`);

        res.status(200).json({
            success: true,
            message: "Lead updated successfully",
            data: updatedLead[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteLead = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await CommonModel.getData(TABLES.LEADS, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Lead not found"
            });
        }

        const deleted = await CommonModel.updateData(
            TABLES.LEADS,
            { status: 'In-Active', updated_on: new Date() },
            `id = ${id}`
        );

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting lead"
            });
        }

        res.status(200).json({
            success: true,
            message: "Lead deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getLeadSummary = async (req, res) => {
    try {
        const statuses = await CommonModel.getData(
            TABLES.STATUS,
            'id, name, color',
            "status = 'Active'",
            'sequence',
            'asc'
        );

        const summary = [];
        for (const status of statuses) {
            const count = await CommonModel.getData(
                TABLES.LEADS,
                'COUNT(*) as total',
                `status_id = ${status.id} AND status = 'Active'`
            );
            summary.push({
                id: status.id,
                label: status.name,
                count: count?.[0]?.total || 0,
                color: status.color
            });
        }

        res.status(200).json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const bulkDeleteLeads = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !ids.length) {
            return res.status(400).json({
                success: false,
                message: "No leads selected"
            });
        }

        const idList = ids.join(',');
        const deleted = await CommonModel.updateData(
            TABLES.LEADS,
            { status: 'In-Active', updated_on: new Date() },
            `id IN (${idList})`
        );

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting leads"
            });
        }

        res.status(200).json({
            success: true,
            message: `${ids.length} leads deleted successfully`
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== PDF DECRYPT/UPLOAD ====================

// Add this function to your existing leadController.js
export const decryptPDF = async (req, res) => {
    try {
        console.log("=== PDF Decrypt Request ===");
        console.log("File received:", req.file);
        
        if (!req.file) {
            console.log("No file in request");
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        console.log("File path:", req.file.path);
        console.log("File original name:", req.file.originalname);
        console.log("File size:", req.file.size);
        
        // Check if file exists
        if (!fs.existsSync(req.file.path)) {
            console.log("File does not exist at path:", req.file.path);
            return res.status(400).json({
                success: false,
                message: "Uploaded file not found"
            });
        }

        // Parse PDF using pdf-parse
        const extractedData = await PDFParserService.parsePDF(req.file.path);
        
        console.log("Extracted data:", extractedData);
        
        // Delete temporary file
        try {
            fs.unlinkSync(req.file.path);
            console.log("Temp file deleted:", req.file.path);
        } catch (unlinkError) {
            console.log("Error deleting temp file:", unlinkError);
        }
        
        res.status(200).json({
            success: true,
            message: "PDF processed successfully",
            data: extractedData
        });
        
    } catch (error) {
        console.error('PDF Decrypt Error:', error);
        
        // Clean up file if exists
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.log("Error cleaning up file:", unlinkError);
            }
        }
        
        res.status(500).json({
            success: false,
            message: error.message || "Failed to process PDF"
        });
    }
};

export const extractFromImageOrPDF = async (req, res) => {
    try {
        console.log("=== OCR Extraction Request ===");
        
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        const filePath = req.file.path;
        const fileType = req.file.mimetype;
        
        let extractedText = "";
        
        if (fileType === 'application/pdf') {
            extractedText = await OCRService.extractFromPDF(filePath);
        } else if (fileType.startsWith('image/')) {
            extractedText = await OCRService.extractFromImage(filePath);
        }
        
        const extractedData = OCRService.extractStructuredData(extractedText);
        
        // Clean up
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        res.status(200).json({
            success: true,
            message: "File processed successfully",
            data: extractedData
        });
        
    } catch (error) {
        console.error('OCR Error:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: error.message || "Failed to process file"
        });
    }
};