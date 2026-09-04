import fs from 'fs';
import path from 'path';
import { parse } from 'json2csv';
import db from '../../../config/knex.js';
import OCRService from '../../../services/ocrService.js';
import { uploadToAzureBlob, getAzureBlobStream, deleteBlobByUrl } from '../../../helpers/V1/azureBlobService.js';
import { notifyUser } from '../../../services/notificationService.js';
import { hasGlobalLeadView, scopeLeadsForUser } from '../../../helpers/V1/leadAccess.js';

const TABLES = {
    LEADS: 'crm_leads',
    STATUS: 'crm_lead_status',
    SOURCE: 'crm_lead_source',
    ACTIVITY: 'crm_lead_activity_log',
    NOTES: 'crm_lead_notes',
    REMINDERS: 'crm_lead_reminders',
    ATTACHMENTS: 'crm_lead_attachments',
    AUDIO_NOTES: 'crm_lead_audio_notes',
    TAGS: 'crm_tags',
    PROCESS: 'crm_process',
    PROCESS_STAFF: 'crm_process_staff',
    EMAIL_QUEUE: 'crm_email_queue',
    USERS: 'ups_users',
    CRM_USERS: 'crm_users',
    SAVED_FILTERS: 'crm_lead_saved_filters',
};

// Leads that are lost/junk/deleted don't show up in the pipeline (table,
// kanban, summary counts) — mirrors the legacy CRM's default Kanban/list view.
const activeLeadScope = (qb) => qb.where('l.lost', false).where('l.junk', false).where('l.is_deleted', false);

const currentUserId = (req) => req.user?.id || 1;
const currentUserName = (req) => req.user?.full_name || `${req.user?.first_name || ''} ${req.user?.last_name || ''}`.trim() || 'System';

const logActivity = async (leadId, description, req, trx = null) => {
    const knex = trx || db;
    await knex(TABLES.ACTIVITY).insert({
        lead_id: leadId,
        description,
        date: new Date(),
        staffid: currentUserId(req),
        full_name: currentUserName(req),
    });
};

const queueIntroductoryEmail = async (leadId, data) => {
    try {
        await db(TABLES.EMAIL_QUEUE).insert({
            lead_id: leadId,
            email_to: data.email,
            email_subject: data.email_subject,
            email_content: data.email_content,
            contact_date_time: data.contact_date_time,
            status: 'pending',
        });
        return true;
    } catch (error) {
        console.error('Error queueing email:', error);
        return false;
    }
};

const leadSelectColumns = [
    'l.*',
    's.name as status_name',
    's.color as status_color',
    'src.name as source_name',
    'u.first_name as assigned_firstname',
    'u.last_name as assigned_lastname',
];

const withLeadJoins = (qb) => qb
    .leftJoin(`${TABLES.STATUS} as s`, 's.id', 'l.status')
    .leftJoin(`${TABLES.SOURCE} as src`, 'src.id', 'l.source')
    .leftJoin(`${TABLES.USERS} as u`, 'u.id', 'l.assigned');

// ==================== LEAD STATUS CRUD ====================

export const getAllStatuses = async (req, res) => {
    try {
        const { status } = req.query;
        let query = db(TABLES.STATUS).select('*').orderBy('sequence', 'asc');
        if (status === 'active') query = query.where('status', 'Active');
        else if (status) query = query.where('status', status);

        const statuses = await query;
        res.status(200).json({ success: true, data: statuses || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getStatusById = async (req, res) => {
    try {
        const { id } = req.params;
        const status = await db(TABLES.STATUS).where('id', id).first();
        if (!status) return res.status(404).json({ success: false, message: "Status not found" });
        res.status(200).json({ success: true, data: status });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// Single save handler for both add and edit — id comes from the URL (PUT
// /statuses/:id) or the body (POST /statuses with an id in the payload).
export const saveStatus = async (req, res) => {
    try {
        const id = req.params.id || req.body.id;
        const { name, color, sequence, status } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;

        if (!id && !trimmedName) {
            return res.status(400).json({ success: false, message: "Status name is required" });
        }

        if (trimmedName) {
            let dupQuery = db(TABLES.STATUS).where('name', trimmedName);
            if (id) dupQuery = dupQuery.whereNot('id', id);
            const duplicate = await dupQuery.first();
            if (duplicate) {
                return res.status(400).json({ success: false, message: "A status with this name already exists" });
            }
        }

        if (id) {
            const existing = await db(TABLES.STATUS).where('id', id).first();
            if (!existing) return res.status(404).json({ success: false, message: "Status not found" });

            const updateData = { updated_by: currentUserId(req) };
            if (trimmedName) updateData.name = trimmedName;
            if (color) updateData.color = color;
            if (sequence !== undefined && sequence !== null && sequence !== '') updateData.sequence = sequence;
            if (status) updateData.status = status;

            await db(TABLES.STATUS).where('id', id).update(updateData);
            const updatedStatus = await db(TABLES.STATUS).where('id', id).first();
            return res.status(200).json({ success: true, message: "Status updated successfully", data: updatedStatus });
        }

        const maxSequence = await db(TABLES.STATUS).max('sequence as max_seq').first();
        const nextSequence = (maxSequence?.max_seq || 0) + 1;

        const [insertedId] = await db(TABLES.STATUS).insert({
            name: trimmedName,
            color: color || '#6B7280',
            sequence: sequence || nextSequence,
            status: status || 'Active',
            created_by: currentUserId(req),
            updated_by: currentUserId(req),
        });

        const newStatus = await db(TABLES.STATUS).where('id', insertedId).first();
        return res.status(201).json({ success: true, message: "Status created successfully", data: newStatus });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.STATUS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Status not found" });

        const leadsUsing = await db(TABLES.LEADS).where('status', id).first();
        if (leadsUsing) {
            return res.status(400).json({ success: false, message: "Cannot delete status used in leads" });
        }

        await db(TABLES.STATUS).where('id', id).del();
        res.status(200).json({ success: true, message: "Status deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD SOURCE CRUD ====================

export const getAllSources = async (req, res) => {
    try {
        const { status } = req.query;
        let query = db(TABLES.SOURCE).select('*').orderBy('sequence', 'asc');
        if (status === 'active') query = query.where('status', 'Active');
        else if (status) query = query.where('status', status);

        const sources = await query;
        res.status(200).json({ success: true, data: sources || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getSourceById = async (req, res) => {
    try {
        const { id } = req.params;
        const source = await db(TABLES.SOURCE).where('id', id).first();
        if (!source) return res.status(404).json({ success: false, message: "Source not found" });
        res.status(200).json({ success: true, data: source });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const saveSource = async (req, res) => {
    try {
        const id = req.params.id || req.body.id;
        const { name, sequence, status } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;

        if (!id && !trimmedName) {
            return res.status(400).json({ success: false, message: "Source name is required" });
        }

        if (trimmedName) {
            let dupQuery = db(TABLES.SOURCE).where('name', trimmedName);
            if (id) dupQuery = dupQuery.whereNot('id', id);
            const duplicate = await dupQuery.first();
            if (duplicate) {
                return res.status(400).json({ success: false, message: "A source with this name already exists" });
            }
        }

        if (id) {
            const existing = await db(TABLES.SOURCE).where('id', id).first();
            if (!existing) return res.status(404).json({ success: false, message: "Source not found" });

            const updateData = { updated_by: currentUserId(req) };
            if (trimmedName) updateData.name = trimmedName;
            if (sequence !== undefined && sequence !== null && sequence !== '') updateData.sequence = sequence;
            if (status) updateData.status = status;

            await db(TABLES.SOURCE).where('id', id).update(updateData);
            const updatedSource = await db(TABLES.SOURCE).where('id', id).first();
            return res.status(200).json({ success: true, message: "Source updated successfully", data: updatedSource });
        }

        const maxSequence = await db(TABLES.SOURCE).max('sequence as max_seq').first();
        const nextSequence = (maxSequence?.max_seq || 0) + 1;

        const [insertedId] = await db(TABLES.SOURCE).insert({
            name: trimmedName,
            sequence: sequence || nextSequence,
            status: status || 'Active',
            created_by: currentUserId(req),
            updated_by: currentUserId(req),
        });

        const newSource = await db(TABLES.SOURCE).where('id', insertedId).first();
        return res.status(201).json({ success: true, message: "Source created successfully", data: newSource });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteSource = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.SOURCE).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Source not found" });

        const leadsUsing = await db(TABLES.LEADS).where('source', id).first();
        if (leadsUsing) {
            return res.status(400).json({ success: false, message: "Cannot delete source used in leads" });
        }

        await db(TABLES.SOURCE).where('id', id).del();
        res.status(200).json({ success: true, message: "Source deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD TAGS ====================

export const getAllTags = async (req, res) => {
    try {
        const { search } = req.query;
        let query = db(TABLES.TAGS).select('*').orderBy('name', 'asc');
        if (search) query = query.whereILike('name', `%${search}%`);
        const tags = await query;
        res.status(200).json({ success: true, data: tags || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const createTag = async (req, res) => {
    try {
        const { name } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;
        if (!trimmedName) return res.status(400).json({ success: false, message: "Tag name is required" });

        const duplicate = await db(TABLES.TAGS).where('name', trimmedName).first();
        if (duplicate) return res.status(400).json({ success: false, message: "Tag already exists" });

        const [insertedId] = await db(TABLES.TAGS).insert({ name: trimmedName, created_by: currentUserId(req) });
        const newTag = await db(TABLES.TAGS).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Tag created successfully", data: newTag });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const updateTag = async (req, res) => {
    try {
        const { tagId } = req.params;
        const { name } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;
        if (!trimmedName) return res.status(400).json({ success: false, message: "Tag name is required" });

        const existing = await db(TABLES.TAGS).where('id', tagId).first();
        if (!existing) return res.status(404).json({ success: false, message: "Tag not found" });

        const duplicate = await db(TABLES.TAGS).where('name', trimmedName).whereNot('id', tagId).first();
        if (duplicate) return res.status(400).json({ success: false, message: "Another tag with this name exists" });

        await db(TABLES.TAGS).where('id', tagId).update({ name: trimmedName });
        const updatedTag = await db(TABLES.TAGS).where('id', tagId).first();
        res.status(200).json({ success: true, message: "Tag updated successfully", data: updatedTag });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteTag = async (req, res) => {
    try {
        const { tagId } = req.params;
        const existing = await db(TABLES.TAGS).where('id', tagId).first();
        if (!existing) return res.status(404).json({ success: false, message: "Tag not found" });

        await db(TABLES.TAGS).where('id', tagId).del();
        res.status(200).json({ success: true, message: "Tag deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const assignLeadTags = async (req, res) => {
    try {
        const { id } = req.params;
        const { tags } = req.body;
        const tagsList = Array.isArray(tags) ? tags.filter(Boolean) : [];

        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        await db(TABLES.LEADS).where('id', id).update({
            tags: tagsList.join(', '),
            updated_by: currentUserId(req),
        });

        res.status(200).json({ success: true, message: "Tags updated successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD SAVED FILTERS ====================

const parseFilters = (value) => {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
};

export const getSavedFilters = async (req, res) => {
    try {
        const rows = await db(TABLES.SAVED_FILTERS)
            .where('created_by', currentUserId(req))
            .orderBy('id', 'desc');

        const data = rows.map((row) => ({ ...row, filters: parseFilters(row.filters) }));
        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const createSavedFilter = async (req, res) => {
    try {
        const { name, filters } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;
        if (!trimmedName) return res.status(400).json({ success: false, message: "Filter name is required" });
        if (!filters || typeof filters !== 'object') {
            return res.status(400).json({ success: false, message: "Filter criteria is required" });
        }

        const [insertedId] = await db(TABLES.SAVED_FILTERS).insert({
            name: trimmedName,
            filters: JSON.stringify(filters),
            created_by: currentUserId(req),
        });

        const newFilter = await db(TABLES.SAVED_FILTERS).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Filter saved successfully", data: { ...newFilter, filters: parseFilters(newFilter.filters) } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteSavedFilter = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await db(TABLES.SAVED_FILTERS).where({ id, created_by: currentUserId(req) }).del();
        if (!deleted) return res.status(404).json({ success: false, message: "Saved filter not found" });
        res.status(200).json({ success: true, message: "Saved filter deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD FORM DATA ====================

export const getLeadFormData = async (req, res) => {
    try {
        const statuses = await db(TABLES.STATUS).select('*').where('status', 'Active').orderBy('sequence', 'asc');
        const sources = await db(TABLES.SOURCE).select('*').where('status', 'Active').orderBy('sequence', 'asc');
        const members = await db(`${TABLES.CRM_USERS} as cu`)
            .join(`${TABLES.USERS} as u`, 'u.id', 'cu.user_id')
            .select('u.id as staffid', 'u.first_name as firstname', 'u.last_name as lastname')
            .orderBy('u.first_name', 'asc');

        const defaultStatus = statuses[0]?.id || null;

        res.status(200).json({
            success: true,
            data: {
                statuses,
                sources,
                members,
                defaults: {
                    status: defaultStatus,
                    source: null,
                    assigned: currentUserId(req),
                },
            },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD LIST / KANBAN ====================

const buildLeadFilters = (qb, { search, status, source, assigned, tag }) => {
    if (search) {
        qb.where((builder) => {
            builder.where('l.name', 'like', `%${search}%`)
                .orWhere('l.email', 'like', `%${search}%`)
                .orWhere('l.phonenumber', 'like', `%${search}%`)
                .orWhere('l.company', 'like', `%${search}%`);
        });
    }
    if (status) qb.where('l.status', status);
    if (source) qb.where('l.source', source);
    if (assigned) qb.where('l.assigned', assigned);
    if (tag) qb.where('l.tags', 'like', `%${tag}%`);
    return qb;
};

const buildProcessState = (processSteps, processStaffRows) => {
    const byLead = new Map();
    for (const row of processStaffRows) {
        if (!byLead.has(row.lead_id)) byLead.set(row.lead_id, {});
        byLead.get(row.lead_id)[row.master_process_id] = {
            state: row.email_sent,
            timestamp: row.sent_at || row.contact_date_time,
            disabled: row.email_sent === 'sent',
        };
    }
    return byLead;
};

export const getAllLeads = async (req, res) => {
    try {
        const { search, status, source, assigned, tag, sort_by = 'id', sort_dir = 'desc', page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 50, 1);
        const offset = (pageNum - 1) * pageSize;

        const sortableColumns = ['id', 'name', 'company', 'lastcontact', 'dateadded', 'leadorder'];
        const sortColumn = sortableColumns.includes(sort_by) ? `l.${sort_by}` : 'l.id';
        const sortDir = String(sort_dir).toLowerCase() === 'asc' ? 'asc' : 'desc';

        const isGlobalView = await hasGlobalLeadView(req);

        const baseQuery = () => withLeadJoins(db(`${TABLES.LEADS} as l`))
            .modify(activeLeadScope)
            .modify(scopeLeadsForUser(req, isGlobalView))
            .modify((qb) => buildLeadFilters(qb, { search, status, source, assigned, tag }));

        const totalRow = await baseQuery().count('l.id as total').first();
        const total = Number(totalRow?.total || 0);

        const rows = await baseQuery()
            .select(leadSelectColumns)
            .orderBy(sortColumn, sortDir)
            .offset(offset)
            .limit(pageSize);

        // Per-status counts, restricted to the same set of leads the user can see.
        const statusCountRows = await db(`${TABLES.LEADS} as l`)
            .modify(activeLeadScope)
            .modify(scopeLeadsForUser(req, isGlobalView))
            .groupBy('l.status')
            .select('l.status')
            .count('l.id as total');
        const totalByStatus = new Map(statusCountRows.map((r) => [Number(r.status), Number(r.total || 0)]));
        const activeStatuses = await db(TABLES.STATUS).where('status', 'Active').orderBy('sequence', 'asc').select('id', 'name', 'color');
        const summaryRaw = activeStatuses.map((s) => ({ id: s.id, name: s.name, color: s.color, total: totalByStatus.get(Number(s.id)) || 0 }));

        const processes = await db(TABLES.PROCESS).select('id', 'process_name', 'sequence').where('status', 'Active').orderBy('sequence', 'asc');

        let processState = new Map();
        if (rows.length && processes.length) {
            const leadIds = rows.map((r) => r.id);
            const processStaffRows = await db(TABLES.PROCESS_STAFF).whereIn('lead_id', leadIds).select('lead_id', 'master_process_id', 'email_sent', 'sent_at', 'contact_date_time');
            processState = buildProcessState(processes, processStaffRows);
        }

        const formattedRows = rows.map((lead) => {
            const state = processState.get(lead.id) || {};
            const sentUpto = Object.values(state).filter((s) => s.state === 'sent').length;
            return { ...lead, process_state: state, sent_upto: sentUpto };
        });

        res.status(200).json({
            success: true,
            data: formattedRows,
            summary: summaryRaw.map((s) => ({ id: s.id, name: s.name, color: s.color, total: Number(s.total || 0) })),
            processes,
            pagination: { total, page: pageNum, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
        });
    } catch (error) {
        console.error('Error in getAllLeads:', error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
    }
};

export const getLeadsKanban = async (req, res) => {
    try {
        const { search, status, sort_by = 'leadorder', sort_dir = 'asc', page = 1, limit = 25 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 25, 1);
        const offset = (pageNum - 1) * pageSize;
        const sortColumn = sort_by === 'leadorder' ? 'l.leadorder' : 'l.id';
        const sortDir = String(sort_dir).toLowerCase() === 'desc' ? 'desc' : 'asc';

        let statuses;
        if (status) {
            const single = await db(TABLES.STATUS).where('id', status).first();
            statuses = single ? [single] : [];
        } else {
            statuses = await db(TABLES.STATUS).select('*').where('status', 'Active').orderBy('sequence', 'asc');
        }

        const isGlobalView = await hasGlobalLeadView(req);

        const columns = [];
        for (const statusRow of statuses) {
            const baseQuery = () => db(`${TABLES.LEADS} as l`)
                .modify(activeLeadScope)
                .modify(scopeLeadsForUser(req, isGlobalView))
                .where('l.status', statusRow.id)
                .modify((qb) => buildLeadFilters(qb, { search }));

            const totalRow = await baseQuery().count('l.id as total').first();
            const total = Number(totalRow?.total || 0);

            const leads = await baseQuery()
                .select('l.id', 'l.name', 'l.company', 'l.email', 'l.phonenumber', 'l.tags', 'l.leadorder')
                .orderBy(sortColumn, sortDir)
                .offset(offset)
                .limit(pageSize);

            columns.push({
                status: { id: statusRow.id, name: statusRow.name, color: statusRow.color },
                leads,
                pagination: { total, page: pageNum, has_more: total > pageNum * pageSize },
            });
        }

        res.status(200).json({ success: true, data: columns });
    } catch (error) {
        console.error('Error in getLeadsKanban:', error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
    }
};

export const updateLeadKanbanStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status_id, order = [] } = req.body;

        if (!status_id) return res.status(400).json({ success: false, message: "status_id is required" });

        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        const targetStatus = await db(TABLES.STATUS).where('id', status_id).first();
        if (!targetStatus) return res.status(404).json({ success: false, message: "Status not found" });

        await db.transaction(async (trx) => {
            await trx(TABLES.LEADS).where('id', id).update({
                status: status_id,
                last_status_change: new Date(),
                updated_by: currentUserId(req),
            });

            if (Array.isArray(order) && order.length) {
                for (let i = 0; i < order.length; i += 1) {
                    await trx(TABLES.LEADS).where('id', order[i]).where('status', status_id).update({ leadorder: i + 1 });
                }
            }

            await logActivity(id, `Status changed to ${targetStatus.name}`, req, trx);
        });

        if (existing.assigned) {
            await notifyUser(existing.assigned, {
                type: 'lead_status_changed',
                title: 'Lead status updated',
                message: `${existing.name} → ${targetStatus.name}`,
                link: `/lead/edit/${id}`,
                meta: { lead_id: Number(id), status_id: Number(status_id) },
                actorId: currentUserId(req),
            });
        }

        res.status(200).json({ success: true, message: "Lead status updated successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD DETAIL ====================

export const getLeadById = async (req, res) => {
    try {
        const { id } = req.params;

        const lead = await withLeadJoins(db(`${TABLES.LEADS} as l`)).where('l.id', id).select(leadSelectColumns).first();
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        const notes = await db(TABLES.NOTES).where('lead_id', id).orderBy('dateadded', 'desc');
        const activity = await db(TABLES.ACTIVITY).where('lead_id', id).orderBy('date', 'desc');
        const reminders = await db(TABLES.REMINDERS).where('lead_id', id).orderBy('date', 'asc');
        const attachments = await db(TABLES.ATTACHMENTS).where('lead_id', id).orderBy('dateadded', 'desc');
        const audioNotes = await db(TABLES.AUDIO_NOTES).where('lead_id', id).orderBy('dateadded', 'desc');
        const process = await db(TABLES.PROCESS_STAFF).where('lead_id', id).orderBy('id', 'desc').first();

        res.status(200).json({
            success: true,
            data: {
                lead,
                notes,
                activity,
                reminders,
                attachments,
                audioNotes,
                process: process ? {
                    master_process_id: process.master_process_id,
                    communication_mode: process.communication_mode,
                    email_subject: process.email_subject,
                    email_content: process.email_content,
                    whatsapp_content: process.whatsapp_content,
                    contact_date_time: process.contact_date_time,
                    status: process.status,
                } : null,
            },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const createLead = async (req, res) => {
    try {
        const {
            name, email, phonenumber, company, title,
            status, source, assigned, tags, description,
            address, city, state, country, zip,
            website, lead_value, is_public, public_contacted_today,
            employee_count, sector, alternative_email,
            send_introductry_mail, email_subject, email_content, whatsapp_content,
            contact_date_time, event_name, uploaded_card_name, persist_mail_24h,
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Lead name is required" });
        }

        const insertData = {
            name: name.trim(),
            email: email || null,
            phonenumber: phonenumber || null,
            company: company || null,
            title: title || null,
            status: status || 0,
            source: source || 0,
            assigned: assigned || 0,
            addedfrom: currentUserId(req),
            tags: tags || null,
            description: description || null,
            address: address || null,
            city: city || null,
            state: state || null,
            country: country || 0,
            zip: zip || null,
            website: website || null,
            lead_value: (lead_value === '' || lead_value === null || lead_value === undefined || Number.isNaN(Number(lead_value))) ? null : lead_value,
            is_public: Boolean(is_public),
            public_contacted_today: Boolean(public_contacted_today),
            employee_count: employee_count || null,
            sector: sector || null,
            alternative_email: alternative_email || null,
            send_introductry_mail: send_introductry_mail ? 'Yes' : 'No',
            email_subject: email_subject || null,
            email_content: email_content || null,
            whatsapp_content: whatsapp_content || null,
            contact_date_time: contact_date_time || null,
            event_name: event_name || null,
            uploaded_card_name: uploaded_card_name || null,
            persist_mail_24h: Boolean(persist_mail_24h),
            dateadded: new Date(),
            dateassigned: assigned ? new Date() : null,
        };

        const [insertedId] = await db(TABLES.LEADS).insert(insertData);

        // Side effects must not fail the request after the lead is committed —
        // otherwise the client retries and creates a duplicate lead.
        try {
            await logActivity(insertedId, 'Lead created', req);

            if (insertData.assigned) {
                await notifyUser(insertData.assigned, {
                    type: 'lead_assigned',
                    title: 'New lead assigned to you',
                    message: `${insertData.name}${insertData.company ? ` — ${insertData.company}` : ''}`,
                    link: `/lead/edit/${insertedId}`,
                    meta: { lead_id: insertedId },
                    actorId: currentUserId(req),
                });
            }

            if (send_introductry_mail && contact_date_time && email_subject && email_content && email) {
                await queueIntroductoryEmail(insertedId, { email, email_subject, email_content, contact_date_time });
            }
        } catch (sideEffectError) {
            console.error('createLead post-insert side effect failed:', sideEffectError?.message || sideEffectError);
        }

        const newLead = await db(TABLES.LEADS).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Lead created successfully", data: newLead });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const UPDATABLE_LEAD_FIELDS = [
    'name', 'email', 'phonenumber', 'company', 'title', 'status', 'source', 'assigned',
    'tags', 'description', 'address', 'city', 'state', 'country', 'zip', 'website',
    'lead_value', 'is_public', 'public_contacted_today', 'employee_count', 'sector',
    'alternative_email', 'send_introductry_mail', 'email_subject', 'email_content',
    'whatsapp_content', 'contact_date_time', 'event_name', 'uploaded_card_name', 'persist_mail_24h',
    'lastcontact',
];

export const updateLead = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        const updateData = { updated_by: currentUserId(req) };
        for (const field of UPDATABLE_LEAD_FIELDS) {
            if (req.body[field] === undefined) continue;
            if (field === 'name') {
                updateData.name = String(req.body.name).trim();
            } else if (['is_public', 'public_contacted_today', 'persist_mail_24h'].includes(field)) {
                updateData[field] = Boolean(req.body[field]);
            } else if (['status', 'source', 'assigned', 'country'].includes(field)) {
                // NOT NULL int columns (default 0) — the form sends null/"" when
                // nothing is picked, so coerce that to 0 rather than a null write.
                updateData[field] = req.body[field] || 0;
            } else if (field === 'lead_value') {
                // decimal column — "" from the form is not a valid decimal (strict
                // mode rejects it), so store NULL when empty / non-numeric.
                const v = req.body.lead_value;
                updateData.lead_value = (v === '' || v === null || Number.isNaN(Number(v))) ? null : v;
            } else {
                updateData[field] = req.body[field];
            }
        }

        if (updateData.assigned && Number(updateData.assigned) !== Number(existing.assigned)) {
            updateData.dateassigned = new Date();
        }
        if (updateData.status && Number(updateData.status) !== Number(existing.status)) {
            updateData.last_status_change = new Date();
        }

        await db(TABLES.LEADS).where('id', id).update(updateData);
        const updatedLead = await db(TABLES.LEADS).where('id', id).first();

        try {
            const actorId = currentUserId(req);
            const assigneeChanged = updateData.assigned !== undefined
                && Number(updateData.assigned) !== Number(existing.assigned);
            const statusChanged = updateData.status !== undefined
                && Number(updateData.status) !== Number(existing.status);

            if (assigneeChanged && updateData.assigned) {
                await notifyUser(updateData.assigned, {
                    type: 'lead_assigned',
                    title: 'A lead was assigned to you',
                    message: `${updatedLead.name}${updatedLead.company ? ` — ${updatedLead.company}` : ''}`,
                    link: `/lead/edit/${id}`,
                    meta: { lead_id: Number(id) },
                    actorId,
                });
            }

            // Notify whoever currently owns the lead when someone else moves it.
            const owner = Number(updateData.assigned ?? existing.assigned);
            if (statusChanged && owner) {
                const st = await db(TABLES.STATUS).where('id', updateData.status).first();
                await notifyUser(owner, {
                    type: 'lead_status_changed',
                    title: 'Lead status updated',
                    message: `${updatedLead.name} → ${st?.name || 'new status'}`,
                    link: `/lead/edit/${id}`,
                    meta: { lead_id: Number(id), status_id: Number(updateData.status) },
                    actorId,
                });
            }
        } catch (notifyError) {
            console.error('updateLead notification failed:', notifyError?.message || notifyError);
        }

        res.status(200).json({ success: true, message: "Lead updated successfully", data: updatedLead });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteLead = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        await db(TABLES.LEADS).where('id', id).update({ is_deleted: true, updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: "Lead deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const bulkActionLeads = async (req, res) => {
    try {
        const { ids, status, source, assigned, tags, visibility, last_contact, lost, mass_delete } = req.body;

        if (!Array.isArray(ids) || !ids.length) {
            return res.status(400).json({ success: false, message: "No leads selected" });
        }

        // Without leads:view_global, a bulk action may only touch leads the user
        // owns / that are public — drop the rest from the selection.
        let scopedIds = ids;
        if (!(await hasGlobalLeadView(req))) {
            scopedIds = await db(`${TABLES.LEADS} as l`)
                .whereIn('l.id', ids)
                .modify(scopeLeadsForUser(req, false))
                .pluck('l.id');
        }
        if (!scopedIds.length) {
            return res.status(403).json({ success: false, message: "You don't have access to the selected leads" });
        }

        if (mass_delete) {
            await db(TABLES.LEADS).whereIn('id', scopedIds).update({ is_deleted: true, updated_by: currentUserId(req) });
            return res.status(200).json({ success: true, message: `${scopedIds.length} leads deleted successfully` });
        }

        const updateData = { updated_by: currentUserId(req) };
        if (status) updateData.status = status;
        if (source) updateData.source = source;
        if (assigned) { updateData.assigned = assigned; updateData.dateassigned = new Date(); }
        if (tags) updateData.tags = tags;
        if (visibility) updateData.is_public = visibility === 'public';
        if (last_contact) updateData.lastcontact = last_contact;
        if (lost === 'true' || lost === true) updateData.lost = true;
        if (lost === 'false' || lost === false) updateData.lost = false;

        if (Object.keys(updateData).length <= 1) {
            return res.status(400).json({ success: false, message: "No changes provided" });
        }

        await db(TABLES.LEADS).whereIn('id', scopedIds).update(updateData);

        if (updateData.assigned) {
            await notifyUser(updateData.assigned, {
                type: 'lead_assigned',
                title: scopedIds.length > 1 ? `${scopedIds.length} leads assigned to you` : 'A lead was assigned to you',
                message: scopedIds.length > 1 ? 'Open the leads list to review them.' : '',
                link: '/lead',
                meta: { lead_ids: scopedIds },
                actorId: currentUserId(req),
            });
        }

        res.status(200).json({ success: true, message: `${scopedIds.length} leads updated successfully` });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD NOTES ====================

export const addLeadNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { description } = req.body;
        if (!description || !description.trim()) {
            return res.status(400).json({ success: false, message: "Note description is required" });
        }

        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        const [insertedId] = await db(TABLES.NOTES).insert({
            lead_id: id,
            description: description.trim(),
            date_contacted: new Date(),
            addedfrom: currentUserId(req),
            dateadded: new Date(),
        });

        const newNote = await db(TABLES.NOTES).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Note added successfully", data: newNote });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteLeadNote = async (req, res) => {
    try {
        const { id, noteId } = req.params;
        const deleted = await db(TABLES.NOTES).where({ id: noteId, lead_id: id }).del();
        if (!deleted) return res.status(404).json({ success: false, message: "Note not found" });
        res.status(200).json({ success: true, message: "Note deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD ACTIVITY ====================

export const addLeadActivity = async (req, res) => {
    try {
        const { id } = req.params;
        const { activity } = req.body;
        if (!activity || !activity.trim()) {
            return res.status(400).json({ success: false, message: "Activity description is required" });
        }

        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        await logActivity(id, activity.trim(), req);
        const activityRows = await db(TABLES.ACTIVITY).where('lead_id', id).orderBy('date', 'desc');
        res.status(201).json({ success: true, message: "Activity logged successfully", data: activityRows[0] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD REMINDERS ====================

export const getLeadReminders = async (req, res) => {
    try {
        const { id } = req.params;
        const reminders = await db(TABLES.REMINDERS).where('lead_id', id).orderBy('date', 'asc');
        res.status(200).json({ success: true, data: reminders || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const addLeadReminder = async (req, res) => {
    try {
        const { id } = req.params;
        const { description, date } = req.body;
        if (!date) return res.status(400).json({ success: false, message: "Reminder date is required" });

        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        const [insertedId] = await db(TABLES.REMINDERS).insert({
            lead_id: id,
            description: description || null,
            date,
            staff: currentUserId(req),
            creator: currentUserId(req),
        });

        const newReminder = await db(TABLES.REMINDERS).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Reminder created successfully", data: newReminder });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const updateLeadReminder = async (req, res) => {
    try {
        const { id, reminderId } = req.params;
        const { description, date, isnotified } = req.body;

        const existing = await db(TABLES.REMINDERS).where({ id: reminderId, lead_id: id }).first();
        if (!existing) return res.status(404).json({ success: false, message: "Reminder not found" });

        const updateData = {};
        if (description !== undefined) updateData.description = description;
        if (date !== undefined) updateData.date = date;
        if (isnotified !== undefined) updateData.isnotified = Boolean(Number(isnotified));

        await db(TABLES.REMINDERS).where('id', reminderId).update(updateData);
        const updatedReminder = await db(TABLES.REMINDERS).where('id', reminderId).first();
        res.status(200).json({ success: true, message: "Reminder updated successfully", data: updatedReminder });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteLeadReminder = async (req, res) => {
    try {
        const { id, reminderId } = req.params;
        const deleted = await db(TABLES.REMINDERS).where({ id: reminderId, lead_id: id }).del();
        if (!deleted) return res.status(404).json({ success: false, message: "Reminder not found" });
        res.status(200).json({ success: true, message: "Reminder deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD ATTACHMENTS ====================

export const uploadLeadAttachment = async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${req.file.originalname}`;
        const blobUrl = await uploadToAzureBlob(uniqueName, req.file.buffer, req.file.mimetype, 'crm/lead_attachments');
        if (!blobUrl) return res.status(502).json({ success: false, message: "Failed to upload file to storage" });

        const [insertedId] = await db(TABLES.ATTACHMENTS).insert({
            lead_id: id,
            file_name: req.file.originalname,
            filetype: req.file.mimetype,
            file_path: blobUrl,
            staffid: currentUserId(req),
            dateadded: new Date(),
        });

        await logActivity(id, `Attachment "${req.file.originalname}" uploaded by ${currentUserName(req)}`, req);

        const newAttachment = await db(TABLES.ATTACHMENTS).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Attachment uploaded successfully", data: newAttachment });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const downloadLeadAttachment = async (req, res) => {
    try {
        const { id, attachmentId } = req.params;
        const attachment = await db(TABLES.ATTACHMENTS).where({ id: attachmentId, lead_id: id }).first();
        if (!attachment) return res.status(404).json({ success: false, message: "Attachment not found" });
        if (!attachment.file_path) return res.status(404).json({ success: false, message: "File is missing on the server" });

        const { stream, contentType } = await getAzureBlobStream(attachment.file_path);
        res.setHeader('Content-Type', contentType || attachment.filetype || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${attachment.file_name}"`);
        stream.pipe(res);
    } catch (error) {
        console.error('Error:', error);
        res.status(404).json({ success: false, message: "File is missing on the server" });
    }
};

export const deleteLeadAttachment = async (req, res) => {
    try {
        const { id, attachmentId } = req.params;
        const attachment = await db(TABLES.ATTACHMENTS).where({ id: attachmentId, lead_id: id }).first();
        if (!attachment) return res.status(404).json({ success: false, message: "Attachment not found" });

        await db(TABLES.ATTACHMENTS).where('id', attachmentId).del();
        if (attachment.file_path) await deleteBlobByUrl(attachment.file_path);

        res.status(200).json({ success: true, message: "Attachment deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD AUDIO NOTES ====================

export const uploadLeadAudioNote = async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ success: false, message: "No audio file uploaded" });

        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        const fileName = req.file.originalname || `audio-note-${Date.now()}.webm`;
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${fileName}`;
        const blobUrl = await uploadToAzureBlob(uniqueName, req.file.buffer, req.file.mimetype, 'crm/lead_audio_notes');
        if (!blobUrl) return res.status(502).json({ success: false, message: "Failed to upload audio note to storage" });

        const durationSeconds = req.body?.duration_seconds ? Number(req.body.duration_seconds) : null;

        const [insertedId] = await db(TABLES.AUDIO_NOTES).insert({
            lead_id: id,
            file_name: fileName,
            file_path: blobUrl,
            mime_type: req.file.mimetype,
            duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
            staffid: currentUserId(req),
            dateadded: new Date(),
        });

        await logActivity(id, `Audio note recorded by ${currentUserName(req)}`, req);

        const newAudioNote = await db(TABLES.AUDIO_NOTES).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Audio note saved successfully", data: newAudioNote });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const streamLeadAudioNote = async (req, res) => {
    try {
        const { id, audioId } = req.params;
        const audioNote = await db(TABLES.AUDIO_NOTES).where({ id: audioId, lead_id: id }).first();
        if (!audioNote) return res.status(404).json({ success: false, message: "Audio note not found" });
        if (!audioNote.file_path) return res.status(404).json({ success: false, message: "Audio file is missing on the server" });

        const { stream, contentType } = await getAzureBlobStream(audioNote.file_path);
        res.setHeader('Content-Type', contentType || audioNote.mime_type || 'audio/webm');
        stream.pipe(res);
    } catch (error) {
        console.error('Error:', error);
        res.status(404).json({ success: false, message: "Audio file is missing on the server" });
    }
};

export const deleteLeadAudioNote = async (req, res) => {
    try {
        const { id, audioId } = req.params;
        const audioNote = await db(TABLES.AUDIO_NOTES).where({ id: audioId, lead_id: id }).first();
        if (!audioNote) return res.status(404).json({ success: false, message: "Audio note not found" });

        await db(TABLES.AUDIO_NOTES).where('id', audioId).del();
        if (audioNote.file_path) await deleteBlobByUrl(audioNote.file_path);

        res.status(200).json({ success: true, message: "Audio note deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== LEAD LOST / JUNK / CONVERT ====================

export const markLeadLost = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        await db(TABLES.LEADS).where('id', id).update({ lost: true, updated_by: currentUserId(req) });
        await logActivity(id, 'Lead marked as lost', req);
        res.status(200).json({ success: true, message: "Lead marked as lost" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const unmarkLeadLost = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        await db(TABLES.LEADS).where('id', id).update({ lost: false, updated_by: currentUserId(req) });
        await logActivity(id, 'Lead unmarked as lost', req);
        res.status(200).json({ success: true, message: "Lead unmarked as lost" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const markLeadJunk = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        await db(TABLES.LEADS).where('id', id).update({ junk: true, updated_by: currentUserId(req) });
        await logActivity(id, 'Lead marked as junk', req);
        res.status(200).json({ success: true, message: "Lead marked as junk" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const unmarkLeadJunk = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        await db(TABLES.LEADS).where('id', id).update({ junk: false, updated_by: currentUserId(req) });
        await logActivity(id, 'Lead unmarked as junk', req);
        res.status(200).json({ success: true, message: "Lead unmarked as junk" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const convertLeadToCustomer = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.LEADS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

        const customerStatus = await db(TABLES.STATUS).where('isdefault', true).first();

        await db(TABLES.LEADS).where('id', id).update({
            status: customerStatus?.id || existing.status,
            date_converted: new Date(),
            updated_by: currentUserId(req),
        });

        await logActivity(id, 'Lead converted to customer', req);
        res.status(200).json({ success: true, message: "Lead converted to customer successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== CSV IMPORT / EXPORT ====================

const CSV_HEADER_MAP = {
    'name': 'name',
    'position': 'title',
    'company': 'company',
    'description': 'description',
    'country': 'country',
    'zip': 'zip',
    'city': 'city',
    'state': 'state',
    'address': 'address',
    'status': 'status',
    'source': 'source',
    'email': 'email',
    'website': 'website',
    'phonenumber': 'phonenumber',
    'lead value': 'lead_value',
    'send introductry mail': 'send_introductry_mail',
    'contact date time': 'contact_date_time',
    'event name': 'event_name',
    'uploaded card name': 'uploaded_card_name',
    'tags': 'tags',
    'employee count': 'employee_count',
    'sector / industry': 'sector',
    'alternate emails': 'alternative_email',
};

const normalizeCSVRow = (row) => {
    const normalized = {};
    for (const [header, value] of Object.entries(row)) {
        const key = CSV_HEADER_MAP[header.trim().toLowerCase()];
        if (key) normalized[key] = typeof value === 'string' ? value.trim() : value;
    }
    return normalized;
};

const resolveImportRow = async (row, fallback, statusByName, sourceByName) => {
    const name = row.name || '/';
    const email = row.email || null;

    let statusId = fallback.status || null;
    if (row.status && statusByName.has(row.status.toLowerCase())) {
        statusId = statusByName.get(row.status.toLowerCase());
    }

    let sourceId = fallback.source || null;
    if (row.source && sourceByName.has(row.source.toLowerCase())) {
        sourceId = sourceByName.get(row.source.toLowerCase());
    }

    return {
        name,
        email,
        company: row.company || null,
        title: row.title || null,
        description: row.description || null,
        country: row.country || 0,
        zip: row.zip || null,
        city: row.city || null,
        state: row.state || null,
        address: row.address || null,
        website: row.website || null,
        phonenumber: row.phonenumber || null,
        lead_value: row.lead_value || null,
        send_introductry_mail: row.send_introductry_mail || null,
        contact_date_time: row.contact_date_time || null,
        event_name: row.event_name || null,
        uploaded_card_name: row.uploaded_card_name || null,
        tags: row.tags || null,
        employee_count: row.employee_count || null,
        sector: row.sector || null,
        alternative_email: row.alternative_email || null,
        status: statusId || 0,
        source: sourceId || 0,
    };
};

const loadMasterMaps = async () => {
    const statuses = await db(TABLES.STATUS).select('id', 'name');
    const sources = await db(TABLES.SOURCE).select('id', 'name');
    return {
        statusByName: new Map(statuses.map((s) => [s.name.toLowerCase(), s.id])),
        sourceByName: new Map(sources.map((s) => [s.name.toLowerCase(), s.id])),
    };
};

export const simulateLeadsImportCSV = async (req, res) => {
    try {
        const records = req.parsedCSV || [];
        const { status, source, responsible } = req.body;
        const { statusByName, sourceByName } = await loadMasterMaps();

        const previewRows = [];
        let ready = 0;
        let skipped = 0;

        for (let i = 0; i < records.length; i += 1) {
            const normalized = normalizeCSVRow(records[i]);
            const resolved = await resolveImportRow(normalized, { status, source }, statusByName, sourceByName);

            let result = 'ready';
            let reason = '';

            if (resolved.email) {
                const duplicate = await db(TABLES.LEADS).where('email', resolved.email).where('is_deleted', false).first();
                if (duplicate) {
                    result = 'skip';
                    reason = 'Duplicate email';
                }
            }

            if (result === 'ready') ready += 1; else skipped += 1;

            previewRows.push({
                row: i + 1,
                name: resolved.name,
                email: resolved.email,
                company: resolved.company,
                status: normalized.status || '',
                source: normalized.source || '',
                result,
                reason,
            });
        }

        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.status(200).json({
            success: true,
            message: "Simulation completed",
            data: {
                total_rows: records.length,
                ready_rows: ready,
                skipped_rows: skipped,
                preview_rows: previewRows,
            },
        });
    } catch (error) {
        console.error('Simulate import error:', error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, message: error.message || "Failed to simulate import" });
    }
};

export const importLeadsCSV = async (req, res) => {
    try {
        const records = req.parsedCSV || [];
        const { status, source, responsible } = req.body;
        const { statusByName, sourceByName } = await loadMasterMaps();

        let inserted = 0;
        const skippedRows = [];

        for (let i = 0; i < records.length; i += 1) {
            const normalized = normalizeCSVRow(records[i]);
            const resolved = await resolveImportRow(normalized, { status, source }, statusByName, sourceByName);

            if (resolved.email) {
                const duplicate = await db(TABLES.LEADS).where('email', resolved.email).where('is_deleted', false).first();
                if (duplicate) {
                    skippedRows.push({ row: i + 1, name: resolved.name, email: resolved.email, reason: 'Duplicate email' });
                    continue;
                }
            }

            await db(TABLES.LEADS).insert({
                ...resolved,
                assigned: responsible || 0,
                addedfrom: currentUserId(req),
                dateadded: new Date(),
                dateassigned: responsible ? new Date() : null,
            });
            inserted += 1;
        }

        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.status(200).json({
            success: true,
            message: `Imported ${inserted} leads successfully, ${skippedRows.length} skipped`,
            data: {
                total_rows: records.length,
                inserted,
                skipped: skippedRows.length,
                skipped_rows: skippedRows,
            },
        });
    } catch (error) {
        console.error('Import error:', error);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, message: error.message || "Failed to import leads" });
    }
};

export const exportLeadsCSV = async (req, res) => {
    try {
        const { search, status, source, assigned, tag, ids } = req.query;

        const selectedIds = String(ids || '')
            .split(',')
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0);

        const isGlobalView = await hasGlobalLeadView(req);

        const leads = await withLeadJoins(db(`${TABLES.LEADS} as l`))
            .modify(activeLeadScope)
            .modify(scopeLeadsForUser(req, isGlobalView))
            .modify((qb) => {
                if (selectedIds.length) {
                    qb.whereIn('l.id', selectedIds);
                } else {
                    buildLeadFilters(qb, { search, status, source, assigned, tag });
                }
            })
            .select(
                'l.name', 'l.email', 'l.phonenumber', 'l.company', 'l.title', 'l.tags', 'l.description',
                's.name as status_name', 'src.name as source_name',
            )
            .orderBy('l.id', 'desc');

        if (!leads.length) {
            return res.status(404).json({ success: false, message: "No leads found to export" });
        }

        const csvData = leads.map((lead) => ({
            Name: lead.name,
            Email: lead.email || '',
            Phone: lead.phonenumber || '',
            Company: lead.company || '',
            Position: lead.title || '',
            Status: lead.status_name || '',
            Source: lead.source_name || '',
            Tags: lead.tags || '',
            Description: lead.description || '',
        }));

        const csv = parse(csvData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=leads_export_${Date.now()}.csv`);
        res.status(200).send(csv);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ success: false, message: error.message || "Failed to export leads" });
    }
};

// ==================== OCR BUSINESS CARD ====================

export const ocrBusinessCard = async (req, res) => {
    // .array('business_card', 2) -> req.files; keep single-file callers working.
    const files = (req.files && req.files.length)
        ? req.files
        : (req.file ? [req.file] : []);

    const cleanup = () => {
        for (const file of files) {
            if (file?.path && fs.existsSync(file.path)) {
                try { fs.unlinkSync(file.path); } catch (_) { /* ignore */ }
            }
        }
    };

    try {
        if (!files.length) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const imagePaths = files.map((f) => f.path);

        // Provider is configured in OCRService (BUSINESS_CARD_AI_PROVIDER —
        // NVIDIA Nemotron by default, Azure GPT-4o vision opt-in). Falls back to
        // the other provider, then a regex parse of the OCR text.
        const { parsed = {}, source } = await OCRService.extractCardData(imagePaths);

        const uploadedCardName = files.map((f) => path.basename(f.path)).join(', ');

        res.status(200).json({
            success: true,
            message: "Business card processed successfully",
            source,
            uploaded_card_name: uploadedCardName,
            data: {
                name: parsed.name || '',
                designation: parsed.position || '',
                company_name: parsed.company || '',
                contact_number: parsed.phone || '',
                email: parsed.email || '',
                website: parsed.website || '',
                address: parsed.address || '',
                city: parsed.city || '',
                state: parsed.state || '',
                country: parsed.country || '',
                pin_code: parsed.pin_code || '',
            },
        });
    } catch (error) {
        console.error('OCR business card error:', error);
        cleanup();
        res.status(500).json({ success: false, message: error.message || "Failed to process business card" });
    }
};
