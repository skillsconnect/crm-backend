import CommonModel from '../../../modules/models/mysql/commonModel/commonModel.js';
import { getProcessEmailContent } from '../../../helpers/V1/email_content.helper.js';
import db from '../../../config/knex.js';

const TABLES = {
    PROCESS: 'crm_process',
    PROCESS_STAFF: 'crm_process_staff'
};

const parseBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    }
    return false;
};

// Builds the comma-joined communication_mode column from either an explicit
// communication_mode string or the email/whatsapp checkboxes the process
// form submits.
const buildCommunicationMode = (body = {}) => {
    if (body.communication_mode && String(body.communication_mode).trim()) {
        return String(body.communication_mode).trim();
    }

    const channels = [];
    if (parseBoolean(body.email)) channels.push('email');
    if (parseBoolean(body.whatsapp)) channels.push('whatsapp');
    return channels.join(',');
};

// ==================== PROCESS MASTER ====================

export const assignProcessToLead = async (req, res) => {
    try {
        const { lead_id, process_id, contact_date_time, staff_id } = req.body;

        console.log("Assign process request:", { lead_id, process_id, contact_date_time, staff_id });

        if (!lead_id) {
            return res.status(400).json({
                success: false,
                message: "Lead ID is required"
            });
        }

        if (!process_id) {
            return res.status(400).json({
                success: false,
                message: "Process ID is required"
            });
        }

        if (!contact_date_time) {
            return res.status(400).json({
                success: false,
                message: "Schedule date and time is required"
            });
        }

        // Get master process details
        const masterProcess = await CommonModel.getData(
            'crm_process',
            '*',
            `id = ${process_id} AND status = 'Active'`
        );

        if (!masterProcess || masterProcess.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Process not found"
            });
        }

        const processData = masterProcess[0];

        // Check if already assigned
        const existing = await CommonModel.getData(
            'crm_process_staff',
            '*',
            `lead_id = ${lead_id} AND master_process_id = ${process_id}`
        );

        const dataToSave = {
            lead_id: lead_id,
            master_process_id: process_id,
            sequence: processData.sequence,
            process_name: processData.process_name,
            email_subject: processData.email_subject,
            email_content: processData.email_content,
            staff_id: staff_id || 1,
            contact_date_time: contact_date_time,
            email_sent: 'pending',
            status: 'Active',
            updated_on: new Date(),
            updated_by: staff_id || 1
        };

        let result;
        let message;

        if (existing && existing.length > 0) {
            result = await CommonModel.updateData(
                'crm_process_staff',
                dataToSave,
                `id = ${existing[0].id}`
            );
            message = "Process assignment updated successfully";
        } else {
            dataToSave.created_on = new Date();
            dataToSave.created_by = staff_id || 1;
            result = await CommonModel.insertData('crm_process_staff', dataToSave);
            message = "Process assigned to lead successfully";
        }

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error assigning process"
            });
        }

        res.status(200).json({
            success: true,
            message: message,
            data: { lead_id, process_id }
        });
        
    } catch (error) {
        console.error('Error in assignProcessToLead:', error);
        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
};

export const getAllProcesses = async (req, res) => {
    try {
        const { status } = req.query;
        let condition = "1=1";
        
        if (status === 'active') condition = "status = 'Active'";
        if (status && status !== 'active') condition = `status = '${status}'`;

        const processes = await CommonModel.getData(
            TABLES.PROCESS,
            'id, sequence, process_name, communication_mode, email_subject, email_content, status, created_on',
            condition,
            'sequence',
            'asc'
        );

        // CommonModel.getData returns `false` (not []) when there are no
        // matching rows — guard before mapping.
        const formattedProcesses = (processes || []).map(p => ({
            id: p.id,
            sequence: p.sequence,
            name: p.process_name,
            process_name: p.process_name,
            communication_mode: p.communication_mode,
            email_subject: p.email_subject,
            email_content: p.email_content,
            status: p.status,
            created_on: p.created_on,
            displayName: `P${p.sequence}: ${p.process_name}`,
            tooltip: `${p.process_name} - ${p.email_subject}`
        }));

        res.status(200).json({
            success: true,
            data: formattedProcesses || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const getProcessById = async (req, res) => {
    try {
        const { id } = req.params;

        const process = await CommonModel.getData(
            TABLES.PROCESS,
            '*',
            `id = ${id}`
        );

        if (!process || process.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Process not found"
            });
        }

        res.status(200).json({
            success: true,
            data: process[0]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const createProcess = async (req, res) => {
    try {
        const { process_name, email_subject, email_content, whatsapp_content, status } = req.body;

        if (!process_name || !process_name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Process name is required"
            });
        }

        const communication_mode = buildCommunicationMode(req.body);
        if (!communication_mode) {
            return res.status(400).json({
                success: false,
                message: "At least one communication mode is required"
            });
        }
        const modes = communication_mode.split(',');

        if (modes.includes('email')) {
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
        }

        if (modes.includes('whatsapp') && (!whatsapp_content || !whatsapp_content.trim())) {
            return res.status(400).json({
                success: false,
                message: "WhatsApp content is required"
            });
        }

        const existing = await CommonModel.getData(
            TABLES.PROCESS,
            'id',
            `process_name = '${process_name.trim()}'`
        );

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Process with this name already exists"
            });
        }

        const maxSequence = await CommonModel.getData(
            TABLES.PROCESS,
            'MAX(sequence) as max_seq',
            "1=1"
        );

        const nextSequence = (maxSequence?.[0]?.max_seq || 0) + 1;

        const insertData = {
            sequence: nextSequence,
            process_name: process_name.trim(),
            email_subject: email_subject ? email_subject.trim() : '',
            email_content: email_content || '',
            whatsapp_content: whatsapp_content || '',
            communication_mode,
            status: status || 'Active',
            created_on: new Date(),
            updated_on: new Date(),
            created_by: req.user?.id || 1,
            updated_by: req.user?.id || 1
        };

        const result = await CommonModel.insertData(TABLES.PROCESS, insertData);

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error creating process"
            });
        }

        const newProcess = await CommonModel.getData(TABLES.PROCESS, '*', `id = ${result}`);

        res.status(201).json({
            success: true,
            message: "Process created successfully",
            data: { ...newProcess[0], displayName: `P${nextSequence}: ${newProcess[0].process_name}` }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const updateProcess = async (req, res) => {
    try {
        const { id } = req.params;
        const { process_name, email_subject, email_content, whatsapp_content, status } = req.body;

        const existing = await CommonModel.getData(TABLES.PROCESS, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Process not found"
            });
        }

        const updateData = { 
            updated_on: new Date(),
            updated_by: req.user?.id || 1
        };

        if (process_name && process_name.trim()) {
            const nameExists = await CommonModel.getData(
                TABLES.PROCESS,
                'id',
                `process_name = '${process_name.trim()}' AND id != ${id}`
            );
            if (nameExists && nameExists.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Another process with this name exists"
                });
            }
            updateData.process_name = process_name.trim();
        }

        if (email_subject && email_subject.trim()) updateData.email_subject = email_subject.trim();
        if (email_content) updateData.email_content = email_content;
        if (whatsapp_content !== undefined) updateData.whatsapp_content = whatsapp_content;
        if (status) updateData.status = status;

        const communication_mode = buildCommunicationMode(req.body);
        if (communication_mode) updateData.communication_mode = communication_mode;

        const updated = await CommonModel.updateData(TABLES.PROCESS, updateData, `id = ${id}`);

        if (!updated) {
            return res.status(400).json({
                success: false,
                message: "Error updating process"
            });
        }

        const updatedProcess = await CommonModel.getData(TABLES.PROCESS, '*', `id = ${id}`);

        res.status(200).json({
            success: true,
            message: "Process updated successfully",
            data: { ...updatedProcess[0], displayName: `P${updatedProcess[0].sequence}: ${updatedProcess[0].process_name}` }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteProcess = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await CommonModel.getData(TABLES.PROCESS, '*', `id = ${id}`);

        if (!existing || existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Process not found"
            });
        }

        const staffProcess = await CommonModel.getData(
            TABLES.PROCESS_STAFF,
            'id',
            `master_process_id = ${id}`
        );

        if (staffProcess && staffProcess.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete process used in assignments"
            });
        }

        const deleted = await CommonModel.deleteRecord(TABLES.PROCESS, `id = ${id}`);

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting process"
            });
        }

        res.status(200).json({
            success: true,
            message: "Process deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== GET PROCESSES FOR FRONTEND (WITH SEQUENCE) ====================

export const getAllProcessesWithSequence = async (req, res) => {
    try {
        const { status } = req.query;
        let condition = "1=1";
        
        if (status === 'active') condition = "status = 'Active'";
        if (status && status !== 'active') condition = `status = '${status}'`;

        const processes = await CommonModel.getData(
            TABLES.PROCESS,
            'id, sequence, process_name, email_subject, status',
            condition,
            'sequence',
            'asc'
        );

        const formattedProcesses = (processes || []).map(p => ({
            id: p.id,
            sequence: p.sequence,
            name: p.process_name,
            email_subject: p.email_subject,
            status: p.status,
            displayName: `P${p.sequence}: ${p.process_name}`,
            tooltip: `${p.process_name} - ${p.email_subject}`
        }));

        res.status(200).json({
            success: true,
            data: formattedProcesses || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== PROCESS FLOW MAP ====================

// GET /process/flow — the active P1..Pn pipeline in sequence order, each step
// enriched with how many leads are currently sitting at that step (by
// email_sent state), so the flow map shows the live pipeline, not just the
// abstract step definitions.
export const getProcessFlow = async (req, res) => {
    try {
        const steps = await db(TABLES.PROCESS)
            .select('id', 'sequence', 'process_name', 'communication_mode', 'email_subject', 'status')
            .where('status', 'Active')
            .orderBy('sequence', 'asc');

        if (!steps.length) {
            return res.status(200).json({ success: true, data: [] });
        }

        const stepIds = steps.map((s) => s.id);
        const counts = await db(TABLES.PROCESS_STAFF)
            .select('master_process_id', 'email_sent')
            .whereIn('master_process_id', stepIds)
            .count('id as total')
            .groupBy('master_process_id', 'email_sent');

        const countsByStep = new Map();
        for (const row of counts) {
            if (!countsByStep.has(row.master_process_id)) {
                countsByStep.set(row.master_process_id, { pending: 0, sent: 0, failed: 0, total: 0 });
            }
            const bucket = countsByStep.get(row.master_process_id);
            const key = ['pending', 'sent', 'failed'].includes(row.email_sent) ? row.email_sent : 'pending';
            bucket[key] += Number(row.total);
            bucket.total += Number(row.total);
        }

        const data = steps.map((step) => ({
            ...step,
            leads: countsByStep.get(step.id) || { pending: 0, sent: 0, failed: 0, total: 0 },
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== PROCESS STAFF (Lead Assignment) ====================

// export const assignProcessToLead = async (req, res) => {
//     try {
//         const { lead_id, process_id, contact_date_time, staff_id } = req.body;

//         if (!lead_id) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Lead ID is required"
//             });
//         }

//         if (!process_id) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Process ID is required"
//             });
//         }

//         if (!contact_date_time) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Schedule date and time is required"
//             });
//         }

//         const masterProcess = await CommonModel.getData(
//             TABLES.PROCESS,
//             '*',
//             `id = ${process_id} AND status = 'Active'`
//         );

//         if (!masterProcess || masterProcess.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Process not found"
//             });
//         }

//         const processData = masterProcess[0];

//         const existing = await CommonModel.getData(
//             TABLES.PROCESS_STAFF,
//             '*',
//             `lead_id = ${lead_id} AND master_process_id = ${process_id}`
//         );

//         const dataToSave = {
//             lead_id: lead_id,
//             master_process_id: process_id,
//             sequence: processData.sequence,
//             process_name: processData.process_name,
//             email_subject: processData.email_subject,
//             email_content: processData.email_content,
//             staff_id: staff_id || req.user?.id || 1,
//             contact_date_time: contact_date_time,
//             email_sent: 'pending',
//             status: 'Active',
//             updated_on: new Date(),
//             updated_by: req.user?.id || 1
//         };

//         let result;
//         let message;

//         if (existing && existing.length > 0) {
//             result = await CommonModel.updateData(
//                 TABLES.PROCESS_STAFF,
//                 dataToSave,
//                 `id = ${existing[0].id}`
//             );
//             message = "Process assignment updated successfully";
//         } else {
//             dataToSave.created_on = new Date();
//             dataToSave.created_by = req.user?.id || 1;
//             result = await CommonModel.insertData(TABLES.PROCESS_STAFF, dataToSave);
//             message = "Process assigned to lead successfully";
//         }

//         if (!result) {
//             return res.status(400).json({
//                 success: false,
//                 message: "Error assigning process"
//             });
//         }

//         res.status(200).json({
//             success: true,
//             message: message,
//             data: { lead_id, process_id }
//         });
//     } catch (error) {
//         console.error('Error:', error);
//         res.status(500).json({
//             success: false,
//             message: "Internal Server Error"
//         });
//     }
// };

export const getLeadProcesses = async (req, res) => {
    try {
        const { lead_id } = req.params;

        const processes = await CommonModel.getData(
            TABLES.PROCESS_STAFF,
            '*',
            `lead_id = ${lead_id}`,
            'sequence',
            'ASC'
        );

        res.status(200).json({
            success: true,
            data: processes || []
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

export const deleteLeadProcess = async (req, res) => {
    try {
        const { lead_id, process_id } = req.params;

        if (!lead_id) {
            return res.status(400).json({
                success: false,
                message: "Lead ID is required"
            });
        }

        let condition = `lead_id = ${lead_id}`;
        if (process_id) {
            condition += ` AND master_process_id = ${process_id}`;
        }

        const deleted = await CommonModel.deleteRecord(TABLES.PROCESS_STAFF, condition);

        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: "Error deleting lead process"
            });
        }

        res.status(200).json({
            success: true,
            message: "Lead process deleted successfully"
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};

// ==================== PROCESS DETAILS (per-lead automation editor) ====================

// GET /process/details?master_process_id=&lead_id= — returns both the
// unmodified master template (processMaster) and the lead's saved/customized
// assignment if one exists (process), so the drawer can offer "reset to
// template" without losing the lead-specific edits.
export const getProcessDetails = async (req, res) => {
    try {
        const { master_process_id, lead_id } = req.query;

        if (!master_process_id || !lead_id) {
            return res.status(400).json({
                success: false,
                message: "master_process_id and lead_id are required"
            });
        }

        const processMaster = await CommonModel.getData(
            TABLES.PROCESS,
            '*',
            `id = ${master_process_id}`
        );

        if (!processMaster || processMaster.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Process not found"
            });
        }

        const existing = await CommonModel.getData(
            TABLES.PROCESS_STAFF,
            '*',
            `lead_id = ${lead_id} AND master_process_id = ${master_process_id}`
        );

        res.status(200).json({
            success: true,
            data: {
                processMaster: processMaster[0],
                process: (existing && existing.length > 0) ? existing[0] : null
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

// POST /process/details — create or update the lead's automation assignment
// for a given process step. Mirrors assignProcessToLead but accepts the
// edited content/schedule/communication-mode straight from the drawer.
export const saveProcessDetails = async (req, res) => {
    try {
        const {
            lead_id, master_process_id, process_name,
            email_subject, email_content, whatsapp_content,
            status, contact_date_time, email, whatsapp
        } = req.body;

        if (!lead_id || !master_process_id) {
            return res.status(400).json({
                success: false,
                message: "lead_id and master_process_id are required"
            });
        }

        const masterProcess = await CommonModel.getData(
            TABLES.PROCESS,
            '*',
            `id = ${master_process_id}`
        );

        if (!masterProcess || masterProcess.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Process not found"
            });
        }

        const modes = [];
        if (email) modes.push('email');
        if (whatsapp) modes.push('whatsapp');

        const existing = await CommonModel.getData(
            TABLES.PROCESS_STAFF,
            '*',
            `lead_id = ${lead_id} AND master_process_id = ${master_process_id}`
        );

        const dataToSave = {
            lead_id,
            master_process_id,
            sequence: masterProcess[0].sequence,
            process_name: process_name || masterProcess[0].process_name,
            email_subject: email_subject ?? masterProcess[0].email_subject,
            email_content: email_content ?? masterProcess[0].email_content,
            whatsapp_content: whatsapp_content ?? masterProcess[0].whatsapp_content,
            communication_mode: modes.length ? modes.join(',') : 'email',
            staff_id: req.user?.id || 1,
            contact_date_time: contact_date_time || null,
            status: status || 'Active',
            updated_on: new Date(),
            updated_by: req.user?.id || 1
        };

        let result;
        if (existing && existing.length > 0) {
            // Re-editing a step that already sent resets it back to pending
            // so the scheduler picks up the new content/date.
            dataToSave.email_sent = 'pending';
            result = await CommonModel.updateData(
                TABLES.PROCESS_STAFF,
                dataToSave,
                `id = ${existing[0].id}`
            );
        } else {
            dataToSave.email_sent = 'pending';
            dataToSave.created_on = new Date();
            dataToSave.created_by = req.user?.id || 1;
            result = await CommonModel.insertData(TABLES.PROCESS_STAFF, dataToSave);
        }

        if (!result) {
            return res.status(400).json({
                success: false,
                message: "Error saving process automation"
            });
        }

        res.status(200).json({
            success: true,
            message: "Automation workflow saved successfully",
            data: { lead_id, master_process_id }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};