import CommonModel from '../../../modules/models/mysql/commonModel/commonModel.js';
import { getProcessEmailContent } from '../../../helpers/V1/email_content.helper.js';

const TABLES = {
    PROCESS: 'crm_process',
    PROCESS_STAFF: 'crm_process_staff'
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
            'id, sequence, process_name, email_subject, email_content, status',
            condition,
            'sequence',
            'asc'
        );

        // Format for frontend with display name
        const formattedProcesses = processes.map(p => ({
            id: p.id,
            sequence: p.sequence,
            name: p.process_name,
            email_subject: p.email_subject,
            email_content: p.email_content,
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
        const { process_name, email_subject, email_content, status } = req.body;

        if (!process_name || !process_name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Process name is required"
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
            email_subject: email_subject.trim(),
            email_content: email_content,
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
        const { process_name, email_subject, email_content, status } = req.body;

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
        if (status) updateData.status = status;

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

        const formattedProcesses = processes.map(p => ({
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