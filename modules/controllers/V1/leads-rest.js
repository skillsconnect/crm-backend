import db from '../../../config/knex.js';
import fs from 'fs';
import axios from 'axios';

const now = () => new Date();
const toInt = (v) => {
  const parsed = Number.parseInt(v, 10);
  return Number.isFinite(parsed) ? parsed : null;
};
const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const toLowerSafe = (value) => String(value || '').trim().toLowerCase();

const parseBooleanLike = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === 'y';
};

const parseDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const tableExistsCache = new Map();
const tableColumnsCache = new Map();

const hasTable = async (tableName) => {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName);
  const exists = await db.schema.hasTable(tableName);
  tableExistsCache.set(tableName, exists);
  return exists;
};

const getColumns = async (tableName) => {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  if (!(await hasTable(tableName))) {
    tableColumnsCache.set(tableName, new Set());
    return new Set();
  }

  const info = await db(tableName).columnInfo();
  const set = new Set(Object.keys(info || {}));
  tableColumnsCache.set(tableName, set);
  return set;
};

const filterPayloadByTableColumns = async (tableName, payload = {}) => {
  const columns = await getColumns(tableName);
  if (!columns.size) return {};

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => {
      return columns.has(key) && value !== undefined;
    })
  );
};

const cleanupUploadedFile = (file) => {
  try {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  } catch (error) {
    console.warn('Failed to cleanup file', error?.message || error);
  }
};

const parseIds = (ids) => {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0);
};

const csvEscape = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const stripCodeFence = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
};

const parseJsonLoose = (value) => {
  const direct = stripCodeFence(value);
  try {
    return JSON.parse(direct);
  } catch {
    // continue
  }

  const objectMatch = direct.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  return null;
};

const getTagNamesMap = async (leadIds = []) => {
  const ids = parseIds(leadIds);
  if (!ids.length) return new Map();
  if (!(await hasTable('tbltaggables')) || !(await hasTable('tbltags'))) return new Map();

  const rows = await db('tbltaggables as tg')
    .join('tbltags as t', 't.id', 'tg.tag_id')
    .select('tg.rel_id', 't.name')
    .whereIn('tg.rel_id', ids)
    .andWhere('tg.rel_type', 'lead')
    .orderBy('tg.tag_order', 'asc');

  const map = new Map();
  for (const row of rows || []) {
    const key = Number(row.rel_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row.name);
  }

  return map;
};

const normalizeTagInput = (tags) => {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag || '').trim())
      .filter(Boolean);
  }

  return String(tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const ensureTags = async (tags = []) => {
  if (!(await hasTable('tbltags'))) return [];
  const names = normalizeTagInput(tags);
  if (!names.length) return [];

  const uniqueNames = [...new Set(names.map((name) => name.trim()))].filter(Boolean);
  const lowered = uniqueNames.map((name) => name.toLowerCase());

  const existing = await db('tbltags')
    .select('id', 'name')
    .whereIn(db.raw('LOWER(name)'), lowered);

  const idByLowerName = new Map((existing || []).map((item) => [toLowerSafe(item.name), Number(item.id)]));

  for (const name of uniqueNames) {
    const lowerName = toLowerSafe(name);
    if (idByLowerName.has(lowerName)) continue;

    const [insertedId] = await db('tbltags').insert({
      name,
      description: '',
      dateadded: now(),
      staff_id: 0,
    });

    idByLowerName.set(lowerName, Number(insertedId));
  }

  return uniqueNames
    .map((name) => idByLowerName.get(toLowerSafe(name)))
    .filter((id) => Number.isFinite(id));
};

const syncLeadTags = async (leadId, tags) => {
  const parsedLeadId = Number.parseInt(leadId, 10);
  if (!Number.isFinite(parsedLeadId) || parsedLeadId <= 0) return;
  if (!(await hasTable('tbltaggables')) || !(await hasTable('tbltags'))) return;

  const tagIds = await ensureTags(tags);

  await db('tbltaggables')
    .where({ rel_type: 'lead', rel_id: parsedLeadId })
    .del();

  if (!tagIds.length) return;

  const rows = tagIds.map((tagId, index) => ({
    rel_id: parsedLeadId,
    rel_type: 'lead',
    tag_id: tagId,
    tag_order: index + 1,
  }));

  await db('tbltaggables').insert(rows);
};

const applyLeadFilters = async (query, filters = {}) => {
  const {
    search,
    status,
    source,
    assigned,
    include_lost,
    include_junk,
    lost,
    junk,
    from,
    to,
    tag,
  } = filters;

  const searchValue = String(search || '').trim();

  if (searchValue) {
    if (searchValue.startsWith('#') && (await hasTable('tbltaggables')) && (await hasTable('tbltags'))) {
      const tagName = searchValue.slice(1).trim();
      if (tagName) {
        query.whereIn('l.id', function tagFilterSubquery() {
          this.select('tg.rel_id')
            .from('tbltaggables as tg')
            .join('tbltags as t', 't.id', 'tg.tag_id')
            .where('tg.rel_type', 'lead')
            .whereRaw('LOWER(t.name) = ?', [tagName.toLowerCase()]);
        });
      }
    } else {
      query.where(function searchClause() {
        this.where('l.name', 'like', `%${searchValue}%`)
          .orWhere('l.company', 'like', `%${searchValue}%`)
          .orWhere('l.email', 'like', `%${searchValue}%`)
          .orWhere('l.phonenumber', 'like', `%${searchValue}%`)
          .orWhere('s.name', 'like', `%${searchValue}%`)
          .orWhere('src.name', 'like', `%${searchValue}%`)
          .orWhere(db.raw("CONCAT(COALESCE(st.firstname,''), ' ', COALESCE(st.lastname,''))"), 'like', `%${searchValue}%`);
      });
    }
  }

  const statusFilter = toInt(status);
  if (statusFilter) query.where('l.status', statusFilter);

  const sourceFilter = toInt(source);
  if (sourceFilter) query.where('l.source', sourceFilter);

  const assignedFilter = toInt(assigned);
  if (assignedFilter) query.where('l.assigned', assignedFilter);

  const explicitLost = parseBooleanLike(lost, null);
  const explicitJunk = parseBooleanLike(junk, null);

  if (explicitLost === true) {
    query.where('l.lost', 1);
  } else if (parseBooleanLike(include_lost, false) !== true) {
    query.where('l.lost', 0);
  }

  if (explicitJunk === true) {
    query.where('l.junk', 1);
  } else if (parseBooleanLike(include_junk, false) !== true) {
    query.where('l.junk', 0);
  }

  const fromDate = parseDateOrNull(from);
  if (fromDate) {
    query.where('l.dateadded', '>=', fromDate);
  }

  const toDate = parseDateOrNull(to);
  if (toDate) {
    query.where('l.dateadded', '<=', toDate);
  }

  const tagFilter = String(tag || '').trim();
  if (tagFilter && (await hasTable('tbltaggables')) && (await hasTable('tbltags'))) {
    query.whereIn('l.id', function tagSubquery() {
      this.select('tg.rel_id')
        .from('tbltaggables as tg')
        .join('tbltags as t', 't.id', 'tg.tag_id')
        .where('tg.rel_type', 'lead')
        .whereRaw('LOWER(t.name) = ?', [tagFilter.toLowerCase()]);
    });
  }
};

const buildLeadQuery = () => {
  return db('tblleads as l')
    .leftJoin('tblleads_status as s', 'l.status', 's.id')
    .leftJoin('tblleads_sources as src', 'l.source', 'src.id')
    .leftJoin('tblstaff as st', 'l.assigned', 'st.staffid');
};

const parseComparableDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isDateAfter = (left, right) => {
  if (!left) return false;
  if (!right) return true;
  return left.getTime() > right.getTime();
};

const isDateBefore = (left, right) => {
  if (!left) return false;
  if (!right) return true;
  return left.getTime() < right.getTime();
};

const deriveMailState = (mailSent, mailRead) => {
  const sent = String(mailSent || '').trim().toLowerCase();
  const read = String(mailRead || '').trim().toLowerCase();

  if (read === 'read') return 'read';
  if (sent === 'bounce' || sent === 'failed') return 'failed';
  if (sent === 'sent') return 'sent';
  return 'sent';
};

const getProcessPillMetadata = async (leadIds = []) => {
  const parsedLeadIds = parseIds(leadIds);
  const byLead = new Map(parsedLeadIds.map((leadId) => [leadId, {}]));
  const sentUpto = new Map(parsedLeadIds.map((leadId) => [leadId, 0]));

  if (!parsedLeadIds.length || !(await hasTable('tblprocess'))) {
    return {
      processes: [],
      byLead,
      sentUpto,
    };
  }

  const processColumns = await getColumns('tblprocess');
  const processQuery = db('tblprocess')
    .select('id', 'process_name')
    .orderBy('id', 'asc');

  if (processColumns.has('status')) {
    processQuery.where('status', 'Active');
  }

  const processes = (await processQuery) || [];
  const processIds = new Set(processes.map((item) => Number(item.id)).filter((id) => Number.isFinite(id)));

  if (processIds.size && (await hasTable('tblsend_sales_mail'))) {
    const sentColumns = await getColumns('tblsend_sales_mail');
    const sentSelect = ['lead_id', 'process_id'];

    if (sentColumns.has('mail_sent')) sentSelect.push('mail_sent');
    if (sentColumns.has('mail_read')) sentSelect.push('mail_read');

    const sentDateColumn = ['updated_on', 'dateadded', 'created_on']
      .find((columnName) => sentColumns.has(columnName));

    if (sentDateColumn) {
      sentSelect.push(`${sentDateColumn} as event_at`);
    }

    const sentRows = await db('tblsend_sales_mail')
      .select(sentSelect)
      .whereIn('lead_id', parsedLeadIds);

    const latestByLeadAndProcess = new Map();

    for (const row of sentRows || []) {
      const leadId = Number(row.lead_id);
      const processId = Number(row.process_id);

      if (!byLead.has(leadId) || !processIds.has(processId)) continue;

      const key = `${leadId}:${processId}`;
      const candidateDate = parseComparableDate(row.event_at);
      const existing = latestByLeadAndProcess.get(key);
      const existingDate = parseComparableDate(existing?.event_at);

      if (!existing || isDateAfter(candidateDate, existingDate)) {
        latestByLeadAndProcess.set(key, row);
      }
    }

    for (const row of latestByLeadAndProcess.values()) {
      const leadId = Number(row.lead_id);
      const processId = Number(row.process_id);
      const currentMap = byLead.get(leadId) || {};

      currentMap[processId] = {
        state: deriveMailState(row.mail_sent, row.mail_read),
        timestamp: row.event_at || null,
        disabled: true,
      };

      byLead.set(leadId, currentMap);
      sentUpto.set(leadId, Math.max(Number(sentUpto.get(leadId) || 0), processId));
    }
  }

  if (processIds.size && (await hasTable('tblprocess_staff'))) {
    const staffColumns = await getColumns('tblprocess_staff');
    const hasRequiredColumns = staffColumns.has('lead_id')
      && staffColumns.has('master_process_id')
      && staffColumns.has('contact_date_time');

    if (hasRequiredColumns) {
      const nowDate = new Date();
      const scheduledRows = await db('tblprocess_staff')
        .select('lead_id', 'master_process_id', 'contact_date_time')
        .whereIn('lead_id', parsedLeadIds)
        .whereNotNull('contact_date_time')
        .andWhere('contact_date_time', '>=', nowDate);

      const nearestByLeadAndProcess = new Map();

      for (const row of scheduledRows || []) {
        const leadId = Number(row.lead_id);
        const processId = Number(row.master_process_id);

        if (!byLead.has(leadId) || !processIds.has(processId)) continue;

        const key = `${leadId}:${processId}`;
        const candidateDate = parseComparableDate(row.contact_date_time);
        const existing = nearestByLeadAndProcess.get(key);
        const existingDate = parseComparableDate(existing?.contact_date_time);

        if (!existing || isDateBefore(candidateDate, existingDate)) {
          nearestByLeadAndProcess.set(key, row);
        }
      }

      for (const row of nearestByLeadAndProcess.values()) {
        const leadId = Number(row.lead_id);
        const processId = Number(row.master_process_id);
        const currentMap = byLead.get(leadId) || {};

        // Keep parity with legacy behavior where upcoming schedule highlights the pill.
        currentMap[processId] = {
          state: 'scheduled',
          timestamp: row.contact_date_time || null,
          disabled: false,
        };

        byLead.set(leadId, currentMap);
      }
    }
  }

  return {
    processes,
    byLead,
    sentUpto,
  };
};

export const listLeads = async (req, res) => {
  try {
    const {
      sort_by = 'id',
      sort_dir = 'desc',
      page = 1,
      limit = 50,
    } = req.query || {};

    const currentPage = toPositiveInt(page, 1);
    const pageSize = Math.min(toPositiveInt(limit, 50), 500);

    const query = buildLeadQuery();
    await applyLeadFilters(query, req.query || {});

    const allowedSort = {
      id: 'l.id',
      name: 'l.name',
      company: 'l.company',
      email: 'l.email',
      phonenumber: 'l.phonenumber',
      lastcontact: 'l.lastcontact',
      dateadded: 'l.dateadded',
      status: 's.name',
      source: 'src.name',
      assigned: 'st.firstname',
      lead_value: 'l.lead_value',
    };

    const sortColumn = allowedSort[sort_by] || 'l.id';
    const sortDirection = String(sort_dir || '').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const totalRow = await query
      .clone()
      .clearSelect()
      .clearOrder()
      .countDistinct({ total: 'l.id' })
      .first();

    const total = Number(totalRow?.total || 0);

    const rows = await query
      .select([
        'l.id',
        'l.name',
        'l.title',
        'l.company',
        'l.email',
        'l.phonenumber',
        'l.lastcontact',
        'l.dateadded',
        'l.status as status_id',
        'l.source as source_id',
        'l.assigned as assigned_id',
        'l.lead_value',
        'l.lost',
        'l.junk',
        'l.last_status_change',
        's.name as status_name',
        's.color as status_color',
        'src.name as source_name',
        'st.firstname as assigned_firstname',
        'st.lastname as assigned_lastname',
      ])
      .orderBy(sortColumn, sortDirection)
      .limit(pageSize)
      .offset((currentPage - 1) * pageSize);

    const leadIds = (rows || []).map((item) => Number(item.id));
    const [tagsMap, processMeta] = await Promise.all([
      getTagNamesMap(leadIds),
      getProcessPillMetadata(leadIds),
    ]);

    const groupedTotals = await query
      .clone()
      .clearSelect()
      .clearOrder()
      .groupBy('l.status')
      .select('l.status as status_id')
      .countDistinct({ total: 'l.id' });

    const statusRows = await db('tblleads_status')
      .select('id', 'name', 'color')
      .orderBy('statusorder', 'asc');

    const totalsByStatus = new Map(
      (groupedTotals || []).map((item) => [Number(item.status_id), Number(item.total || 0)])
    );

    const summary = (statusRows || []).map((statusItem) => ({
      id: statusItem.id,
      name: statusItem.name,
      color: statusItem.color,
      total: totalsByStatus.get(Number(statusItem.id)) || 0,
    }));

    const data = (rows || []).map((item) => ({
      ...item,
      tags: (tagsMap.get(Number(item.id)) || []).join(', '),
      sent_upto: Number(processMeta.sentUpto.get(Number(item.id)) || 0),
      process_state: processMeta.byLead.get(Number(item.id)) || {},
    }));

    return res.status(200).json({
      success: true,
      data,
      summary,
      processes: processMeta.processes || [],
      pagination: {
        page: currentPage,
        limit: pageSize,
        total,
        total_pages: pageSize ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch (error) {
    console.error('listLeads error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getLeadDetail = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    const lead = await buildLeadQuery()
      .select([
        'l.*',
        's.name as status_name',
        's.color as status_color',
        'src.name as source_name',
        'st.firstname as assigned_firstname',
        'st.lastname as assigned_lastname',
      ])
      .where('l.id', leadId)
      .first();

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const [
      notes,
      activity,
      reminders,
      mailActivity,
      processRows,
      processMasters,
      tagsMap,
    ] = await Promise.all([
      hasTable('tblnotes')
        ? db('tblnotes')
            .select('*')
            .where({ rel_id: leadId, rel_type: 'lead' })
            .orderBy('dateadded', 'desc')
        : Promise.resolve([]),
      hasTable('tbllead_activity_log')
        ? db('tbllead_activity_log')
            .select('*')
            .where({ leadid: leadId })
            .orderBy('date', 'desc')
        : Promise.resolve([]),
      hasTable('tblreminders')
        ? db('tblreminders')
            .select('*')
            .where({ rel_id: leadId, rel_type: 'lead' })
            .orderBy('date', 'asc')
        : Promise.resolve([]),
      hasTable('tbllead_integration_emails')
        ? db('tbllead_integration_emails')
            .select('*')
            .where({ leadid: leadId })
            .orderBy('dateadded', 'desc')
        : Promise.resolve([]),
      hasTable('tblprocess_staff')
        ? db('tblprocess_staff')
            .select('*')
            .where({ lead_id: leadId })
            .orderBy('id', 'desc')
        : Promise.resolve([]),
      hasTable('tblprocess')
        ? db('tblprocess')
            .select('*')
            .where('process_name', 'Introduction')
            .orderBy('id', 'desc')
            .limit(1)
        : Promise.resolve([]),
      getTagNamesMap([leadId]),
    ]);

    const process = (processRows || [])[0] || (processMasters || [])[0] || null;

    return res.status(200).json({
      success: true,
      data: {
        lead: {
          ...lead,
          tags: (tagsMap.get(leadId) || []).join(', '),
        },
        notes: notes || [],
        activity: activity || [],
        reminders: reminders || [],
        mail_activity: mailActivity || [],
        process: process || null,
        counts: {
          notes: (notes || []).length,
          activity: (activity || []).length,
          reminders: (reminders || []).length,
          mail_activity: (mailActivity || []).length,
        },
      },
    });
  } catch (error) {
    console.error('getLeadDetail error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateLeadRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    const existing = await db('tblleads').where({ id: leadId }).first();
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const body = req.body || {};

    const payload = {
      name: body.name,
      title: body.title,
      company: body.company,
      description: body.description,
      email: body.email,
      phonenumber: body.phonenumber !== undefined ? body.phonenumber : body.phone,
      website: body.website,
      status: body.status !== undefined ? toInt(body.status) : undefined,
      source: body.source !== undefined ? toInt(body.source) : undefined,
      assigned: body.assigned !== undefined ? toInt(body.assigned) : undefined,
      address: body.address,
      city: body.city,
      state: body.state,
      zip: body.zip,
      country: body.country !== undefined ? toInt(body.country) : undefined,
      lead_value: body.lead_value !== undefined ? Number(body.lead_value) || 0 : undefined,
      event_name: body.event_name,
      contact_date_time: body.contact_date_time ? parseDateOrNull(body.contact_date_time) : undefined,
      is_public: body.is_public !== undefined ? (parseBooleanLike(body.is_public) ? 1 : 0) : undefined,
      employee_count: body.employee_count,
      employeecount: body.employee_count,
      sector: body.sector,
      sector_industry: body.sector,
      industry: body.industry,
      alternative_email: body.alternative_email,
      alternate_emails: body.alternate_emails,
      alternateemails: body.alternate_emails,
      lastcontact: body.lastcontact ? parseDateOrNull(body.lastcontact) : undefined,
      uploaded_card_name: body.uploaded_card_name,
    };

    if (payload.assigned !== undefined && payload.assigned !== existing.assigned) {
      payload.dateassigned = now();
    }

    if (payload.status !== undefined && payload.status !== existing.status) {
      payload.last_status_change = now();
      payload.lost = 0;
      payload.junk = 0;
    }

    const updateData = await filterPayloadByTableColumns('tblleads', payload);

    if (Object.keys(updateData).length > 0) {
      await db('tblleads').where({ id: leadId }).update(updateData);
    }

    if (body.tags !== undefined) {
      await syncLeadTags(leadId, body.tags);
    }

    return res.status(200).json({ success: true, message: 'Lead updated successfully' });
  } catch (error) {
    console.error('updateLeadRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const deleteLeadRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    const exists = await db('tblleads').where({ id: leadId }).first();
    if (!exists) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    await db.transaction(async (trx) => {
      if (await hasTable('tbltaggables')) {
        await trx('tbltaggables').where({ rel_type: 'lead', rel_id: leadId }).del();
      }
      if (await hasTable('tblnotes')) {
        await trx('tblnotes').where({ rel_type: 'lead', rel_id: leadId }).del();
      }
      if (await hasTable('tblreminders')) {
        await trx('tblreminders').where({ rel_type: 'lead', rel_id: leadId }).del();
      }
      if (await hasTable('tbllead_activity_log')) {
        await trx('tbllead_activity_log').where({ leadid: leadId }).del();
      }
      if (await hasTable('tbllead_integration_emails')) {
        await trx('tbllead_integration_emails').where({ leadid: leadId }).del();
      }
      if (await hasTable('tblprocess_staff')) {
        await trx('tblprocess_staff').where({ lead_id: leadId }).del();
      }

      await trx('tblleads').where({ id: leadId }).del();
    });

    return res.status(200).json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('deleteLeadRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const addLeadActivityRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    if (!(await hasTable('tbllead_activity_log'))) {
      return res.status(400).json({ success: false, message: 'Lead activity table not available' });
    }

    const activityText = String(req.body?.activity || req.body?.description || '').trim();
    if (!activityText) {
      return res.status(400).json({ success: false, message: 'Activity text is required' });
    }

    const payload = await filterPayloadByTableColumns('tbllead_activity_log', {
      date: now(),
      description: activityText,
      leadid: leadId,
      staffid: req.user?.id || 1,
      additional_data: req.body?.additional_data || '',
      full_name: req.user?.full_name || 'System',
      custom_activity: 1,
    });

    const [id] = await db('tbllead_activity_log').insert(payload);

    return res.status(201).json({ success: true, data: { id, ...payload } });
  } catch (error) {
    console.error('addLeadActivityRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const addLeadNoteRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    if (!(await hasTable('tblnotes'))) {
      return res.status(400).json({ success: false, message: 'Notes table not available' });
    }

    const description = String(req.body?.description || req.body?.lead_note_description || '').trim();
    if (!description) {
      return res.status(400).json({ success: false, message: 'Note description is required' });
    }

    const contactedDate = parseDateOrNull(req.body?.date_contacted || req.body?.custom_contact_date);

    const payload = await filterPayloadByTableColumns('tblnotes', {
      rel_id: leadId,
      rel_type: 'lead',
      description,
      dateadded: now(),
      addedfrom: req.user?.id || 1,
      date_contacted: contactedDate,
    });

    const [id] = await db('tblnotes').insert(payload);

    if (contactedDate) {
      const leadPatch = await filterPayloadByTableColumns('tblleads', { lastcontact: contactedDate });
      if (Object.keys(leadPatch).length > 0) {
        await db('tblleads').where({ id: leadId }).update(leadPatch);
      }
    }

    return res.status(201).json({ success: true, data: { id, ...payload } });
  } catch (error) {
    console.error('addLeadNoteRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const deleteLeadNoteRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    const noteId = Number.parseInt(req.params.noteId, 10);
    if (!Number.isFinite(leadId) || !Number.isFinite(noteId)) {
      return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    if (!(await hasTable('tblnotes'))) {
      return res.status(400).json({ success: false, message: 'Notes table not available' });
    }

    const deleted = await db('tblnotes')
      .where({ id: noteId, rel_id: leadId, rel_type: 'lead' })
      .del();

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }

    return res.status(200).json({ success: true, message: 'Note deleted successfully' });
  } catch (error) {
    console.error('deleteLeadNoteRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const listLeadRemindersRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    if (!(await hasTable('tblreminders'))) {
      return res.status(200).json({ success: true, data: [] });
    }

    const rows = await db('tblreminders')
      .select('*')
      .where({ rel_type: 'lead', rel_id: leadId })
      .orderBy('date', 'asc');

    return res.status(200).json({ success: true, data: rows || [] });
  } catch (error) {
    console.error('listLeadRemindersRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const createLeadReminderRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    if (!(await hasTable('tblreminders'))) {
      return res.status(400).json({ success: false, message: 'Reminders table not available' });
    }

    const reminderDate = parseDateOrNull(req.body?.date || req.body?.reminder_date);
    if (!reminderDate) {
      return res.status(400).json({ success: false, message: 'Reminder date is required' });
    }

    const payload = await filterPayloadByTableColumns('tblreminders', {
      rel_id: leadId,
      rel_type: 'lead',
      date: reminderDate,
      description: req.body?.description || '',
      isnotified: 0,
      notify_by_email: parseBooleanLike(req.body?.notify_by_email) ? 1 : 0,
      creator: req.user?.id || 1,
      staff: toInt(req.body?.staff) || req.user?.id || 1,
    });

    const [id] = await db('tblreminders').insert(payload);

    return res.status(201).json({ success: true, data: { id, ...payload } });
  } catch (error) {
    console.error('createLeadReminderRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateLeadReminderRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    const reminderId = Number.parseInt(req.params.reminderId, 10);
    if (!Number.isFinite(leadId) || !Number.isFinite(reminderId)) {
      return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    if (!(await hasTable('tblreminders'))) {
      return res.status(400).json({ success: false, message: 'Reminders table not available' });
    }

    const payload = await filterPayloadByTableColumns('tblreminders', {
      date: req.body?.date ? parseDateOrNull(req.body.date) : undefined,
      description: req.body?.description,
      isnotified: req.body?.isnotified !== undefined ? (parseBooleanLike(req.body.isnotified) ? 1 : 0) : undefined,
      notify_by_email: req.body?.notify_by_email !== undefined ? (parseBooleanLike(req.body.notify_by_email) ? 1 : 0) : undefined,
      staff: req.body?.staff !== undefined ? toInt(req.body.staff) : undefined,
    });

    if (!Object.keys(payload).length) {
      return res.status(400).json({ success: false, message: 'No valid update fields provided' });
    }

    const updated = await db('tblreminders')
      .where({ id: reminderId, rel_id: leadId, rel_type: 'lead' })
      .update(payload);

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }

    return res.status(200).json({ success: true, message: 'Reminder updated successfully' });
  } catch (error) {
    console.error('updateLeadReminderRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const deleteLeadReminderRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    const reminderId = Number.parseInt(req.params.reminderId, 10);
    if (!Number.isFinite(leadId) || !Number.isFinite(reminderId)) {
      return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    if (!(await hasTable('tblreminders'))) {
      return res.status(400).json({ success: false, message: 'Reminders table not available' });
    }

    const deleted = await db('tblreminders')
      .where({ id: reminderId, rel_id: leadId, rel_type: 'lead' })
      .del();

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }

    return res.status(200).json({ success: true, message: 'Reminder deleted successfully' });
  } catch (error) {
    console.error('deleteLeadReminderRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getKanbanBoard = async (req, res) => {
  try {
    const statusId = toInt(req.query?.status);
    const currentPage = toPositiveInt(req.query?.page, 1);
    const pageSize = Math.min(toPositiveInt(req.query?.limit, 20), 100);

    const statuses = statusId
      ? await db('tblleads_status').select('*').where({ id: statusId }).orderBy('statusorder', 'asc')
      : await db('tblleads_status').select('*').orderBy('statusorder', 'asc');

    const search = String(req.query?.search || '').trim();
    const sortBy = String(req.query?.sort_by || 'leadorder');
    const sortDir = String(req.query?.sort_dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

    const allowedSort = {
      leadorder: 'l.leadorder',
      dateadded: 'l.dateadded',
      lastcontact: 'l.lastcontact',
      lead_value: 'l.lead_value',
      name: 'l.name',
    };

    const sortColumn = allowedSort[sortBy] || 'l.leadorder';

    const result = [];
    for (const status of statuses || []) {
      const q = buildLeadQuery().where('l.status', status.id).where('l.lost', 0).where('l.junk', 0);
      if (search) {
        q.where(function kanbanSearchClause() {
          this.where('l.name', 'like', `%${search}%`)
            .orWhere('l.company', 'like', `%${search}%`)
            .orWhere('l.email', 'like', `%${search}%`)
            .orWhere('l.phonenumber', 'like', `%${search}%`);
        });
      }

      const totalRow = await q
        .clone()
        .clearSelect()
        .clearOrder()
        .countDistinct({ total: 'l.id' })
        .first();

      const total = Number(totalRow?.total || 0);

      const leads = await q
        .select([
          'l.id',
          'l.name',
          'l.company',
          'l.email',
          'l.phonenumber',
          'l.status',
          'l.leadorder',
          'l.lastcontact',
          'l.dateadded',
          'l.lead_value',
          'st.firstname as assigned_firstname',
          'st.lastname as assigned_lastname',
        ])
        .orderBy(sortColumn, sortDir)
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);

      const tagsMap = await getTagNamesMap((leads || []).map((item) => item.id));

      result.push({
        status,
        leads: (leads || []).map((lead) => ({
          ...lead,
          tags: (tagsMap.get(Number(lead.id)) || []).join(', '),
        })),
        pagination: {
          page: currentPage,
          limit: pageSize,
          total,
          total_pages: pageSize ? Math.ceil(total / pageSize) : 0,
          has_more: currentPage * pageSize < total,
        },
      });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('getKanbanBoard error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateLeadKanbanStatus = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    const statusId = toInt(req.body?.status_id || req.body?.status);

    if (!Number.isFinite(leadId) || !statusId) {
      return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    await db('tblleads')
      .where({ id: leadId })
      .update(
        await filterPayloadByTableColumns('tblleads', {
          status: statusId,
          lost: 0,
          junk: 0,
          last_status_change: now(),
        })
      );

    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    if (order.length > 0) {
      for (let index = 0; index < order.length; index += 1) {
        const orderedLeadId = Number.parseInt(order[index], 10);
        if (!Number.isFinite(orderedLeadId)) continue;

        await db('tblleads')
          .where({ id: orderedLeadId, status: statusId })
          .update(await filterPayloadByTableColumns('tblleads', { leadorder: index + 1 }));
      }
    }

    return res.status(200).json({ success: true, message: 'Lead status updated successfully' });
  } catch (error) {
    console.error('updateLeadKanbanStatus error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const bulkActionRest = async (req, res) => {
  try {
    const body = req.body || {};
    const ids = parseIds(body.ids);

    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'Lead ids are required' });
    }

    let updated = 0;
    let deleted = 0;

    if (parseBooleanLike(body.mass_delete)) {
      for (const leadId of ids) {
        const exists = await db('tblleads').where({ id: leadId }).first();
        if (!exists) continue;

        await db.transaction(async (trx) => {
          if (await hasTable('tbltaggables')) {
            await trx('tbltaggables').where({ rel_type: 'lead', rel_id: leadId }).del();
          }
          if (await hasTable('tblnotes')) {
            await trx('tblnotes').where({ rel_type: 'lead', rel_id: leadId }).del();
          }
          if (await hasTable('tblreminders')) {
            await trx('tblreminders').where({ rel_type: 'lead', rel_id: leadId }).del();
          }
          if (await hasTable('tbllead_activity_log')) {
            await trx('tbllead_activity_log').where({ leadid: leadId }).del();
          }
          if (await hasTable('tbllead_integration_emails')) {
            await trx('tbllead_integration_emails').where({ leadid: leadId }).del();
          }
          if (await hasTable('tblprocess_staff')) {
            await trx('tblprocess_staff').where({ lead_id: leadId }).del();
          }

          await trx('tblleads').where({ id: leadId }).del();
        });

        deleted += 1;
      }

      return res.status(200).json({
        success: true,
        message: `${deleted} lead(s) deleted successfully`,
        data: { deleted, updated: 0 },
      });
    }

    for (const leadId of ids) {
      const updateData = await filterPayloadByTableColumns('tblleads', {
        status: body.status !== undefined && body.status !== '' ? toInt(body.status) : undefined,
        source: body.source !== undefined && body.source !== '' ? toInt(body.source) : undefined,
        assigned: body.assigned !== undefined && body.assigned !== '' ? toInt(body.assigned) : undefined,
        lastcontact: body.last_contact ? parseDateOrNull(body.last_contact) : undefined,
        is_public:
          body.visibility !== undefined
            ? String(body.visibility) === 'public' || parseBooleanLike(body.visibility)
              ? 1
              : 0
            : undefined,
      });

      if (body.status !== undefined && body.status !== '') {
        updateData.last_status_change = now();
      }

      if (String(body.lost) === 'true') {
        updateData.lost = 1;
        if (updateData.status) {
          updateData.last_lead_status = updateData.status;
        }
        updateData.status = 0;
      }

      if (String(body.lost) === 'false') {
        updateData.lost = 0;
      }

      if (Object.keys(updateData).length > 0) {
        await db('tblleads').where({ id: leadId }).update(updateData);
      }

      if (body.tags !== undefined) {
        await syncLeadTags(leadId, body.tags);
      }

      updated += 1;
    }

    return res.status(200).json({
      success: true,
      message: `${updated} lead(s) updated successfully`,
      data: { updated, deleted: 0 },
    });
  } catch (error) {
    console.error('bulkActionRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const listLeadStatusesRest = async (_req, res) => {
  try {
    const rows = await db('tblleads_status').select('*').orderBy('statusorder', 'asc');
    return res.status(200).json({ success: true, data: rows || [] });
  } catch (error) {
    console.error('listLeadStatusesRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const createLeadStatusRest = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Status name is required' });
    }

    const duplicate = await db('tblleads_status').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
    if (duplicate) {
      return res.status(400).json({ success: false, message: 'Status already exists' });
    }

    const last = await db('tblleads_status').max({ maxOrder: 'statusorder' }).first();
    const statusOrder = Number(last?.maxOrder || 0) + 1;

    const payload = await filterPayloadByTableColumns('tblleads_status', {
      name,
      color: req.body?.color || '#757575',
      statusorder: req.body?.statusorder ? Number(req.body.statusorder) : statusOrder,
      isdefault: parseBooleanLike(req.body?.isdefault) ? 1 : 0,
    });

    const [id] = await db('tblleads_status').insert(payload);

    return res.status(201).json({ success: true, data: { id, ...payload } });
  } catch (error) {
    console.error('createLeadStatusRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateLeadStatusRest = async (req, res) => {
  try {
    const statusId = Number.parseInt(req.params.statusId, 10);
    if (!Number.isFinite(statusId)) {
      return res.status(400).json({ success: false, message: 'Invalid status id' });
    }

    const payload = await filterPayloadByTableColumns('tblleads_status', {
      name: req.body?.name,
      color: req.body?.color,
      statusorder: req.body?.statusorder !== undefined ? Number(req.body.statusorder) : undefined,
      isdefault: req.body?.isdefault !== undefined ? (parseBooleanLike(req.body?.isdefault) ? 1 : 0) : undefined,
    });

    if (!Object.keys(payload).length) {
      return res.status(400).json({ success: false, message: 'No valid update fields provided' });
    }

    const updated = await db('tblleads_status').where({ id: statusId }).update(payload);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Status not found' });
    }

    return res.status(200).json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    console.error('updateLeadStatusRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const deleteLeadStatusRest = async (req, res) => {
  try {
    const statusId = Number.parseInt(req.params.statusId, 10);
    if (!Number.isFinite(statusId)) {
      return res.status(400).json({ success: false, message: 'Invalid status id' });
    }

    const usage = await db('tblleads').where({ status: statusId }).count({ total: '*' }).first();
    if (Number(usage?.total || 0) > 0) {
      return res.status(409).json({ success: false, message: 'Status is referenced by leads and cannot be deleted' });
    }

    const deleted = await db('tblleads_status').where({ id: statusId }).del();
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Status not found' });
    }

    return res.status(200).json({ success: true, message: 'Status deleted successfully' });
  } catch (error) {
    console.error('deleteLeadStatusRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const reorderLeadStatusesRest = async (req, res) => {
  try {
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    if (!order.length) {
      return res.status(400).json({ success: false, message: 'order is required' });
    }

    for (const item of order) {
      const statusId = Number.parseInt(item?.id, 10);
      const sortOrder = Number.parseInt(item?.statusorder ?? item?.order, 10);
      if (!Number.isFinite(statusId) || !Number.isFinite(sortOrder)) continue;

      await db('tblleads_status').where({ id: statusId }).update({ statusorder: sortOrder });
    }

    return res.status(200).json({ success: true, message: 'Status order updated successfully' });
  } catch (error) {
    console.error('reorderLeadStatusesRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const listLeadSourcesRest = async (_req, res) => {
  try {
    const rows = await db('tblleads_sources').select('*').orderBy('name', 'asc');
    return res.status(200).json({ success: true, data: rows || [] });
  } catch (error) {
    console.error('listLeadSourcesRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const createLeadSourceRest = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Source name is required' });
    }

    const duplicate = await db('tblleads_sources').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
    if (duplicate) {
      return res.status(400).json({ success: false, message: 'Source already exists' });
    }

    const payload = await filterPayloadByTableColumns('tblleads_sources', {
      name,
    });

    const [id] = await db('tblleads_sources').insert(payload);

    return res.status(201).json({ success: true, data: { id, ...payload } });
  } catch (error) {
    console.error('createLeadSourceRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateLeadSourceRest = async (req, res) => {
  try {
    const sourceId = Number.parseInt(req.params.sourceId, 10);
    if (!Number.isFinite(sourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid source id' });
    }

    const payload = await filterPayloadByTableColumns('tblleads_sources', {
      name: req.body?.name,
    });

    if (!Object.keys(payload).length) {
      return res.status(400).json({ success: false, message: 'No valid update fields provided' });
    }

    const updated = await db('tblleads_sources').where({ id: sourceId }).update(payload);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Source not found' });
    }

    return res.status(200).json({ success: true, message: 'Source updated successfully' });
  } catch (error) {
    console.error('updateLeadSourceRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const deleteLeadSourceRest = async (req, res) => {
  try {
    const sourceId = Number.parseInt(req.params.sourceId, 10);
    if (!Number.isFinite(sourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid source id' });
    }

    const usage = await db('tblleads').where({ source: sourceId }).count({ total: '*' }).first();
    if (Number(usage?.total || 0) > 0) {
      return res.status(409).json({ success: false, message: 'Source is referenced by leads and cannot be deleted' });
    }

    const deleted = await db('tblleads_sources').where({ id: sourceId }).del();
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Source not found' });
    }

    return res.status(200).json({ success: true, message: 'Source deleted successfully' });
  } catch (error) {
    console.error('deleteLeadSourceRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const listTagsRest = async (req, res) => {
  try {
    if (!(await hasTable('tbltags'))) {
      return res.status(200).json({ success: true, data: [] });
    }

    const search = String(req.query?.search || '').trim();

    const query = db('tbltags').select('*').orderBy('name', 'asc');
    if (search) {
      query.where('name', 'like', `%${search}%`);
    }

    const rows = await query;

    return res.status(200).json({ success: true, data: rows || [] });
  } catch (error) {
    console.error('listTagsRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const createTagRest = async (req, res) => {
  try {
    if (!(await hasTable('tbltags'))) {
      return res.status(400).json({ success: false, message: 'Tags table not available' });
    }

    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'Tag name is required' });
    }

    const duplicate = await db('tbltags').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
    if (duplicate) {
      return res.status(400).json({ success: false, message: 'Tag already exists' });
    }

    const payload = await filterPayloadByTableColumns('tbltags', {
      name,
      description: req.body?.description || '',
      dateadded: now(),
      staff_id: req.user?.id || 1,
    });

    const [id] = await db('tbltags').insert(payload);

    return res.status(201).json({ success: true, data: { id, ...payload } });
  } catch (error) {
    console.error('createTagRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateTagRest = async (req, res) => {
  try {
    if (!(await hasTable('tbltags'))) {
      return res.status(400).json({ success: false, message: 'Tags table not available' });
    }

    const tagId = Number.parseInt(req.params.tagId, 10);
    if (!Number.isFinite(tagId)) {
      return res.status(400).json({ success: false, message: 'Invalid tag id' });
    }

    const payload = await filterPayloadByTableColumns('tbltags', {
      name: req.body?.name,
      description: req.body?.description,
    });

    if (!Object.keys(payload).length) {
      return res.status(400).json({ success: false, message: 'No valid update fields provided' });
    }

    const updated = await db('tbltags').where({ id: tagId }).update(payload);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    return res.status(200).json({ success: true, message: 'Tag updated successfully' });
  } catch (error) {
    console.error('updateTagRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const deleteTagRest = async (req, res) => {
  try {
    if (!(await hasTable('tbltags'))) {
      return res.status(400).json({ success: false, message: 'Tags table not available' });
    }

    const tagId = Number.parseInt(req.params.tagId, 10);
    if (!Number.isFinite(tagId)) {
      return res.status(400).json({ success: false, message: 'Invalid tag id' });
    }

    await db.transaction(async (trx) => {
      if (await hasTable('tbltaggables')) {
        await trx('tbltaggables').where({ tag_id: tagId }).del();
      }
      await trx('tbltags').where({ id: tagId }).del();
    });

    return res.status(200).json({ success: true, message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('deleteTagRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const assignLeadTagsRest = async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(leadId)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    await syncLeadTags(leadId, req.body?.tags || []);

    return res.status(200).json({ success: true, message: 'Lead tags updated successfully' });
  } catch (error) {
    console.error('assignLeadTagsRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const exportLeadsRest = async (req, res) => {
  try {
    const query = buildLeadQuery();
    await applyLeadFilters(query, req.query || {});

    const rows = await query
      .select([
        'l.id',
        'l.name',
        'l.title',
        'l.company',
        'l.email',
        'l.phonenumber',
        'l.lead_value',
        'l.lastcontact',
        'l.dateadded',
        's.name as status_name',
        'src.name as source_name',
        'st.firstname as assigned_firstname',
        'st.lastname as assigned_lastname',
      ])
      .orderBy('l.id', 'desc')
      .limit(20000);

    const leadIds = (rows || []).map((item) => Number(item.id));
    const tagsMap = await getTagNamesMap(leadIds);

    const headers = [
      'id',
      'name',
      'title',
      'company',
      'email',
      'phonenumber',
      'status_name',
      'source_name',
      'assigned_name',
      'tags',
      'lead_value',
      'lastcontact',
      'dateadded',
    ];

    const csvRows = [headers.join(',')];

    for (const row of rows || []) {
      const assignedName = `${row.assigned_firstname || ''} ${row.assigned_lastname || ''}`.trim();
      const line = [
        row.id,
        row.name,
        row.title,
        row.company,
        row.email,
        row.phonenumber,
        row.status_name,
        row.source_name,
        assignedName,
        (tagsMap.get(Number(row.id)) || []).join(', '),
        row.lead_value,
        row.lastcontact,
        row.dateadded,
      ].map(csvEscape).join(',');

      csvRows.push(line);
    }

    const filename = `leads_export_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    return res.status(200).send(csvRows.join('\n'));
  } catch (error) {
    console.error('exportLeadsRest error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const parseBusinessCardTextHeuristic = (text) => {
  const raw = String(text || '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const emails = [...new Set(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const websites = [...new Set(raw.match(/(?:https?:\/\/)?(?:www\.)?[A-Z0-9.-]+\.[A-Z]{2,}(?:\/[\w\-./?%&=]*)?/gi) || [])]
    .filter((site) => !emails.some((email) => site.includes(email)));
  const phones = [...new Set(raw.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [])];

  const companyLine = lines.find((line) => /pvt|limited|llp|inc|technologies|solutions|corp|company/i.test(line)) || lines[2] || '';

  return {
    name: lines[0] || '',
    designation: lines[1] || '',
    company_name: companyLine,
    email: emails.join(', '),
    contact_number: phones.join(', '),
    website: websites.join(', '),
    address: lines.slice(3).join(', '),
    city: '',
    state: '',
    country: '',
    pin_code: '',
    raw_text: raw,
  };
};

const extractViaOpenAI = async (file) => {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const fileBase64 = fs.readFileSync(file.path).toString('base64');
  const mimeType = file.mimetype || 'image/jpeg';

  const payload = {
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'Extract business card details into strict JSON keys: name, designation, company_name, contact_number, email, address, city, state, country, pin_code, website. Return JSON only.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Read this business card and return only JSON with those keys. If a field is unknown return empty string.',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${fileBase64}`,
            },
          },
        ],
      },
    ],
  };

  const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
  });

  const content = response?.data?.choices?.[0]?.message?.content;
  const parsed = parseJsonLoose(content);
  if (!parsed) return null;

  return { ...parsed, provider: 'openai' };
};

const extractViaAzureOpenAI = async (file) => {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

  if (!endpoint || !deployment || !apiKey) return null;

  const fileBase64 = fs.readFileSync(file.path).toString('base64');
  const mimeType = file.mimetype || 'image/jpeg';

  const payload = {
    messages: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: 'Extract business card details into strict JSON keys: name, designation, company_name, contact_number, email, address, city, state, country, pin_code, website. Return JSON only.',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Read this business card and return only JSON with those keys. If a field is unknown return empty string.',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${fileBase64}`,
            },
          },
        ],
      },
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: 800,
  };

  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const response = await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
  });

  const content = response?.data?.choices?.[0]?.message?.content;
  const parsed = parseJsonLoose(content);
  if (!parsed) return null;

  return { ...parsed, provider: 'azure-openai' };
};

const extractViaOcrSpace = async (file) => {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) return null;

  const fileBuffer = fs.readFileSync(file.path);
  const base64 = fileBuffer.toString('base64');
  const form = new URLSearchParams();
  form.append('apikey', apiKey);
  form.append('base64Image', `data:${file.mimetype || 'image/jpeg'};base64,${base64}`);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });

  const payload = await response.json();
  const parsedText = payload?.ParsedResults?.[0]?.ParsedText || '';
  if (!parsedText) return null;

  const parsed = parseBusinessCardTextHeuristic(parsedText);
  return { ...parsed, provider: 'ocr-space' };
};

export const ocrBusinessCardRest = async (req, res) => {
  const uploaded = req.files?.business_card?.[0] || req.files?.file?.[0] || req.file;

  try {
    if (!uploaded) {
      return res.status(400).json({ success: false, message: 'Business card file is required' });
    }

    let parsed = await extractViaAzureOpenAI(uploaded);
    if (!parsed) {
      parsed = await extractViaOpenAI(uploaded);
    }
    if (!parsed) {
      parsed = await extractViaOcrSpace(uploaded);
    }

    if (!parsed) {
      return res.status(400).json({
        success: false,
        message: 'No OCR/AI provider configured. Set AZURE_OPENAI_* or OPENAI_API_KEY or OCR_SPACE_API_KEY.',
      });
    }

    return res.status(200).json({
      success: true,
      data: parsed,
      uploaded_card_name: uploaded.originalname || uploaded.filename,
    });
  } catch (error) {
    console.error('ocrBusinessCardRest error', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to parse business card image',
    });
  } finally {
    cleanupUploadedFile(uploaded);
  }
};
