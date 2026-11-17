// FULL NODE.JS CONVERSION OF PERFEX LEADS CONTROLLER
// Stack: Express + Knex (Production Ready, Perfex-Compatible)

import db from '../../../config/knex.js';
import crypto from 'crypto';
import fs from 'fs';

// ---------------- HELPERS ----------------

const now = () => new Date();
const toInt = (v) => (v ? parseInt(v, 10) : null);
const generateHash = () => crypto.randomBytes(16).toString('hex');

// ---------------- GET LEADS ----------------

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const normalizeCsvRow = (row = {}) => {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = typeof value === 'string' ? value.trim() : value;
  }
  return normalized;
};

const getCsvValue = (normalizedRow, aliases = []) => {
  for (const alias of aliases) {
    const value = normalizedRow[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const toLowerSafe = (value) => String(value || '').trim().toLowerCase();

const parseDateOrNull = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseBooleanLike = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = toLowerSafe(value);
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === 'y';
};

const resolveByIdOrName = (items, rawValue, fallbackId = null) => {
  const input = String(rawValue || '').trim();
  if (!input) return fallbackId;

  const numericValue = Number.parseInt(input, 10);
  if (Number.isFinite(numericValue)) {
    const matchById = items.find((item) => Number(item.id) === numericValue);
    if (matchById) return Number(matchById.id);
  }

  const normalizedInput = toLowerSafe(input);
  const matchByName = items.find((item) => toLowerSafe(item.name) === normalizedInput);
  if (matchByName) return Number(matchByName.id);

  return fallbackId;
};

const resolveCountryId = (countries, rawValue) => {
  const input = String(rawValue || '').trim();
  if (!input) return 0;

  const numericValue = Number.parseInt(input, 10);
  if (Number.isFinite(numericValue)) {
    const matchById = countries.find((item) => Number(item.country_id) === numericValue);
    if (matchById) return Number(matchById.country_id);
  }

  const normalizedInput = toLowerSafe(input);
  const matchByName = countries.find((item) => {
    return (
      toLowerSafe(item.short_name) === normalizedInput ||
      toLowerSafe(item.long_name) === normalizedInput ||
      toLowerSafe(item.iso2) === normalizedInput
    );
  });

  return matchByName ? Number(matchByName.country_id) : 0;
};

const cleanupUploadedFile = (file) => {
  try {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  } catch (error) {
    console.warn('Failed to cleanup uploaded CSV file', error?.message || error);
  }
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getAllLeads = async (req, res) => {
  try {
    const {
      search = '',
      status = '',
      source = '',
      assigned = '',
      sort_by = 'id',
      sort_dir = 'desc',
      page = 1,
      limit = 50,
    } = req.query || {};

    const currentPage = toPositiveInt(page, 1);
    const pageSize = Math.min(toPositiveInt(limit, 50), 500);

    let query = db('tblleads as l')
      .leftJoin('tblleads_status as s', 'l.status', 's.id')
      .leftJoin('tblleads_sources as src', 'l.source', 'src.id')
      .leftJoin('tblstaff as st', 'l.assigned', 'st.staffid');

    const searchValue = String(search || '').trim();
    if (searchValue) {
      query.where(function () {
        this.where('l.name', 'like', `%${searchValue}%`)
          .orWhere('l.company', 'like', `%${searchValue}%`)
          .orWhere('l.email', 'like', `%${searchValue}%`)
          .orWhere('l.phonenumber', 'like', `%${searchValue}%`)
          .orWhere('s.name', 'like', `%${searchValue}%`)
          .orWhere('src.name', 'like', `%${searchValue}%`);
      });
    }

    const statusFilter = toInt(status);
    if (statusFilter) query.where('l.status', statusFilter);
    const sourceFilter = toInt(source);
    if (sourceFilter) query.where('l.source', sourceFilter);
    const assignedFilter = toInt(assigned);
    if (assignedFilter) query.where('l.assigned', assignedFilter);

    // Default: exclude lost & junk
    query.where({ 'l.lost': 0, 'l.junk': 0 });

    const allowedSort = {
      id: 'l.id',
      name: 'l.name',
      company: 'l.company',
      email: 'l.email',
      lastcontact: 'l.lastcontact',
      dateadded: 'l.dateadded',
      status: 's.name',
      source: 'src.name',
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
        's.name as status_name',
        's.color as status_color',
        'src.name as source_name',
        'st.firstname as assigned_firstname',
        'st.lastname as assigned_lastname',
      ])
      .orderBy(sortColumn, sortDirection)
      .limit(pageSize)
      .offset((currentPage - 1) * pageSize);

    const summary = await db('tblleads_status as s')
      .leftJoin('tblleads as l', function () {
        this.on('l.status', '=', 's.id')
          .andOn('l.lost', '=', db.raw('0'))
          .andOn('l.junk', '=', db.raw('0'));
      })
      .select('s.id', 's.name', 's.color')
      .countDistinct({ total: 'l.id' })
      .groupBy('s.id', 's.name', 's.color', 's.statusorder')
      .orderBy('s.statusorder', 'asc');

    return res.status(200).json({
      success: true,
      data: rows || [],
      summary: (summary || []).map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        total: Number(item.total || 0),
      })),
      pagination: {
        page: currentPage,
        limit: pageSize,
        total,
        total_pages: pageSize ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch (err) {
    console.error('getAllLeads error', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// Backward compatibility for any existing internal imports
export const getLeads = getAllLeads;

export const getLeadFormData = async (req, res) => {
  try {
    const [statuses, sources, members] = await Promise.all([
      db('tblleads_status')
        .select('id', 'name', 'color', 'isdefault')
        .orderBy('statusorder', 'asc'),
      db('tblleads_sources')
        .select('id', 'name')
        .orderBy('name', 'asc'),
      db('tblstaff')
        .select('staffid', 'firstname', 'lastname')
        .where('active', 1)
        .orderBy('firstname', 'asc'),
    ]);

    const defaultStatus = statuses.find((item) => Number(item.isdefault) === 1)?.id || statuses[0]?.id || '';
    const defaultSource = sources[0]?.id || '';
    const defaultAssigned = members[0]?.staffid || '';

    return res.status(200).json({
      success: true,
      data: {
        statuses,
        sources,
        members,
        defaults: {
          status: defaultStatus,
          source: defaultSource,
          assigned: defaultAssigned,
        },
      },
    });
  } catch (error) {
    console.error('getLeadFormData error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// ---------------- CREATE LEAD ----------------

export const createLead = async (req, res) => {
  try {
    const body = req.body;

    if (!body.name || !body.company) {
      return res.status(400).json({ success: false, message: 'Name & Company required' });
    }

    if (body.email) {
      const exists = await db('tblleads')
        .whereRaw('LOWER(email) = ?', [body.email.toLowerCase()])
        .first();

      if (exists) {
        return res.status(400).json({ success: false, message: 'Lead already exists' });
      }
    }

    const insertData = {
      hash: generateHash(),
      name: body.name,
      title: body.title || '',
      company: body.company,
      description: body.description || '',

      email: body.email || null,
      phonenumber: body.phonenumber || body.phone || '',
      website: body.website || '',

      status: toInt(body.status),
      source: toInt(body.source),
      assigned: toInt(body.assigned),

      dateadded: now(),
      lastcontact: now(),
      dateassigned: body.assigned ? now() : null,

      addedfrom: req.user?.id || 1,

      address: body.address || '',
      city: body.city || '',
      state: body.state || '',
      zip: body.zip || '',
      country: toInt(body.country),

      lead_value: Number(body.lead_value) || 0,

      contact_date_time: body.contact_date_time || null,
      event_name: body.event_name || '',

      is_public: 1,
    };

    const [id] = await db('tblleads').insert(insertData);

    // PROCESS AUTOMATION (INTRO MAIL)
    if (body.send_introductry_mail) {
      const staffId = req.user?.id || 1;
      const introductionProcess = await db('tblprocess')
        .select(
          'id',
          'process_name',
          'email_subject',
          'email_content',
          'whatsapp_content',
          'whatsapp_template_name',
          'communication_mode'
        )
        .where('process_name', 'Introduction')
        .first();

      if (introductionProcess?.id) {
        await db('tblprocess_staff').insert({
          process_name: introductionProcess.process_name || 'Introduction',
          email_content: body.email_content || introductionProcess.email_content || '',
          email_subject: body.email_subject || introductionProcess.email_subject || '',
          whatsapp_content: introductionProcess.whatsapp_content || '',
          whatsapp_template_name: introductionProcess.whatsapp_template_name || null,
          communication_mode: introductionProcess.communication_mode || 'email',
          status: 'Active',
          staff_id: staffId,
          master_process_id: introductionProcess.id,
          lead_id: id,
          contact_date_time: body.contact_date_time || now(),
          created_on: now(),
          updated_on: now(),
          created_by: staffId,
          updated_by: staffId,
        });
      }
    }

    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

const prepareLeadImportRows = async (req) => {
  const body = req.body || {};
  const parsedRows = Array.isArray(req.parsedCSV) ? req.parsedCSV : [];

  if (!parsedRows.length) {
    return { error: 'CSV file is empty' };
  }

  const fallbackStatusRaw = String(body.status || '').trim();
  const fallbackSourceRaw = String(body.source || '').trim();
  const fallbackResponsibleRaw = String(body.responsible || '').trim();

  if (!fallbackStatusRaw || !fallbackSourceRaw) {
    return { error: 'Fallback status and source are required' };
  }

  const [statuses, sources, leadColumnInfo] = await Promise.all([
    db('tblleads_status').select('id', 'name'),
    db('tblleads_sources').select('id', 'name'),
    db('tblleads').columnInfo(),
  ]);

  const leadColumns = new Set(Object.keys(leadColumnInfo || {}));

  let countries = [];
  try {
    countries = await db('tblcountries').select('country_id', 'short_name', 'long_name', 'iso2');
  } catch (error) {
    countries = [];
  }

  const fallbackStatusId = resolveByIdOrName(statuses, fallbackStatusRaw, null);
  const fallbackSourceId = resolveByIdOrName(sources, fallbackSourceRaw, null);
  const fallbackResponsibleId = toInt(fallbackResponsibleRaw);

  if (!fallbackStatusId || !fallbackSourceId) {
    return { error: 'Invalid fallback status or source' };
  }

  const csvEmails = parsedRows
    .map((row) => {
      const normalized = normalizeCsvRow(row);
      return toLowerSafe(getCsvValue(normalized, ['email', 'emailaddress']));
    })
    .filter(Boolean);

  const uniqueCsvEmails = [...new Set(csvEmails)];

  let existingEmailSet = new Set();
  if (uniqueCsvEmails.length > 0) {
    const placeholders = uniqueCsvEmails.map(() => '?').join(',');
    const existingRows = await db('tblleads')
      .select(db.raw('LOWER(email) as email'))
      .whereRaw(`LOWER(email) IN (${placeholders})`, uniqueCsvEmails);

    existingEmailSet = new Set((existingRows || []).map((row) => toLowerSafe(row.email)).filter(Boolean));
  }

  const statusNameById = new Map(statuses.map((item) => [Number(item.id), item.name]));
  const sourceNameById = new Map(sources.map((item) => [Number(item.id), item.name]));
  const seenEmailsInFile = new Set();

  const readyRows = [];
  const skippedRows = [];
  const previewRows = [];

  parsedRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const normalized = normalizeCsvRow(row);

    const csvFirstName = getCsvValue(normalized, ['firstname', 'first', 'first_name']);
    const csvLastName = getCsvValue(normalized, ['lastname', 'last', 'last_name']);
    const csvName = getCsvValue(normalized, ['name', 'leadname', 'fullname']);
    const csvEmail = toLowerSafe(getCsvValue(normalized, ['email', 'emailaddress']));
    const csvCompany = getCsvValue(normalized, ['company', 'organization', 'organisation']);
    const csvStatus = getCsvValue(normalized, ['status']);
    const csvSource = getCsvValue(normalized, ['source']);
    const csvUploadedCardName = getCsvValue(normalized, ['uploadedcardname', 'uploadedcard', 'uploaded_card_name']);
    const csvTags = getCsvValue(normalized, ['tags']);
    const csvEmployeeCount = getCsvValue(normalized, ['employeecount', 'employee_count']);
    const csvSectorIndustry = getCsvValue(normalized, ['sectorindustry', 'sector', 'industry']);
    const csvAlternateEmails = getCsvValue(normalized, ['alternateemails', 'alternativeemail', 'alternate_emails', 'alternative_email']);
    const sendIntroductryMail = parseBooleanLike(getCsvValue(normalized, ['sendintroductrymail', 'sendintroductorymail', 'sendintro']));
    const parsedContactDateTime = parseDateOrNull(getCsvValue(normalized, ['contactdatetime', 'contactdatetime', 'contactdate', 'contact_date_time']));

    const fullName = csvName || `${csvFirstName} ${csvLastName}`.trim() || '/';
    const resolvedStatusId = resolveByIdOrName(statuses, csvStatus, fallbackStatusId);
    const resolvedSourceId = resolveByIdOrName(sources, csvSource, fallbackSourceId);

    const reasons = [];
    if (!resolvedStatusId) reasons.push('Unable to resolve status');
    if (!resolvedSourceId) reasons.push('Unable to resolve source');
    if (csvEmail && !EMAIL_PATTERN.test(csvEmail)) reasons.push('Invalid email format');

    if (csvEmail) {
      if (existingEmailSet.has(csvEmail)) {
        reasons.push('Email already exists');
      }
      if (seenEmailsInFile.has(csvEmail)) {
        reasons.push('Duplicate email in uploaded CSV');
      }
      seenEmailsInFile.add(csvEmail);
    }

    const baseInsertData = {
      hash: generateHash(),
      name: fullName,
      title: getCsvValue(normalized, ['title', 'position']) || '',
      company: csvCompany || fullName,
      description: getCsvValue(normalized, ['description', 'notes']) || '',

      email: csvEmail || null,
      phonenumber: getCsvValue(normalized, ['phonenumber', 'phone', 'mobile']) || '',
      website: getCsvValue(normalized, ['website', 'url']) || '',

      status: resolvedStatusId,
      source: resolvedSourceId,
      assigned: fallbackResponsibleId || null,

      dateadded: now(),
      lastcontact: now(),
      dateassigned: fallbackResponsibleId ? now() : null,

      addedfrom: req.user?.id || 1,

      address: getCsvValue(normalized, ['address']) || '',
      city: getCsvValue(normalized, ['city']) || '',
      state: getCsvValue(normalized, ['state']) || '',
      zip: getCsvValue(normalized, ['zip', 'zipcode', 'pincode']) || '',
      country: resolveCountryId(countries, getCsvValue(normalized, ['country', 'countryid'])),

      lead_value: Number(getCsvValue(normalized, ['leadvalue', 'lead_value'])) || 0,

      contact_date_time: parsedContactDateTime,
      event_name: getCsvValue(normalized, ['eventname', 'event_name']) || '',

      is_public: 1,
      lost: 0,
      junk: 0,
    };

    if (csvUploadedCardName) {
      if (leadColumns.has('uploaded_card_name')) baseInsertData.uploaded_card_name = csvUploadedCardName;
      if (leadColumns.has('uploaded_card')) baseInsertData.uploaded_card = csvUploadedCardName;
      if (leadColumns.has('uploadedcardname')) baseInsertData.uploadedcardname = csvUploadedCardName;
    }

    if (csvTags && leadColumns.has('tags')) {
      baseInsertData.tags = csvTags;
    }

    if (csvEmployeeCount) {
      const employeeCountValue = Number(csvEmployeeCount) || csvEmployeeCount;
      if (leadColumns.has('employee_count')) baseInsertData.employee_count = employeeCountValue;
      if (leadColumns.has('employeecount')) baseInsertData.employeecount = employeeCountValue;
    }

    if (csvSectorIndustry) {
      if (leadColumns.has('sector')) baseInsertData.sector = csvSectorIndustry;
      if (leadColumns.has('sector_industry')) baseInsertData.sector_industry = csvSectorIndustry;
      if (leadColumns.has('industry')) baseInsertData.industry = csvSectorIndustry;
    }

    if (csvAlternateEmails) {
      if (leadColumns.has('alternate_emails')) baseInsertData.alternate_emails = csvAlternateEmails;
      if (leadColumns.has('alternative_email')) baseInsertData.alternative_email = csvAlternateEmails;
      if (leadColumns.has('alternateemails')) baseInsertData.alternateemails = csvAlternateEmails;
    }

    const insertData = Object.fromEntries(
      Object.entries(baseInsertData).filter(([column]) => leadColumns.has(column))
    );

    const preview = {
      row: rowNumber,
      name: insertData.name,
      email: insertData.email,
      company: insertData.company,
      status: statusNameById.get(Number(insertData.status)) || String(insertData.status || ''),
      source: sourceNameById.get(Number(insertData.source)) || String(insertData.source || ''),
      assigned: insertData.assigned,
      send_introductry_mail: sendIntroductryMail,
      result: reasons.length > 0 ? 'skipped' : 'ready',
      reason: reasons.join('; '),
    };

    previewRows.push(preview);

    if (reasons.length > 0) {
      skippedRows.push(preview);
      return;
    }

    readyRows.push({
      row: rowNumber,
      insertData,
      sendIntroductryMail,
      contactDateTime: parsedContactDateTime,
      preview,
    });
  });

  return {
    totalRows: parsedRows.length,
    readyRows,
    skippedRows,
    previewRows,
  };
};

export const simulateLeadsImport = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'CSV file is required' });
    }

    const prepared = await prepareLeadImportRows(req);
    if (prepared.error) {
      return res.status(400).json({ success: false, message: prepared.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Simulation completed',
      data: {
        total_rows: prepared.totalRows,
        ready_rows: prepared.readyRows.length,
        skipped_rows: prepared.skippedRows.length,
        preview_rows: prepared.previewRows.slice(0, 100),
      },
    });
  } catch (error) {
    console.error('simulateLeadsImport error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    cleanupUploadedFile(req.file);
  }
};

export const importLeadsCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'CSV file is required' });
    }

    const prepared = await prepareLeadImportRows(req);
    if (prepared.error) {
      return res.status(400).json({ success: false, message: prepared.error });
    }

    let inserted = 0;
    let introScheduled = 0;
    let introSkipped = 0;
    const skippedOnInsert = [];
    const staffId = req.user?.id || 1;

    let introductionProcess = null;
    if (prepared.readyRows.some((row) => row.sendIntroductryMail)) {
      introductionProcess = await db('tblprocess')
        .select(
          'id',
          'process_name',
          'email_subject',
          'email_content',
          'whatsapp_content',
          'whatsapp_template_name',
          'communication_mode'
        )
        .where('process_name', 'Introduction')
        .first();
    }

    for (const item of prepared.readyRows) {
      try {
        const insertedIds = await db('tblleads').insert(item.insertData);
        const insertedLeadId = Array.isArray(insertedIds) ? insertedIds[0] : insertedIds;
        inserted += 1;

        if (item.sendIntroductryMail) {
          if (!introductionProcess?.id) {
            introSkipped += 1;
          } else {
            try {
              await db('tblprocess_staff').insert({
                process_name: introductionProcess.process_name || 'Introduction',
                email_content: introductionProcess.email_content || '',
                email_subject: introductionProcess.email_subject || '',
                whatsapp_content: introductionProcess.whatsapp_content || '',
                whatsapp_template_name: introductionProcess.whatsapp_template_name || null,
                communication_mode: introductionProcess.communication_mode || 'email',
                status: 'Active',
                staff_id: staffId,
                master_process_id: introductionProcess.id,
                lead_id: insertedLeadId,
                contact_date_time: item.contactDateTime || now(),
                created_on: now(),
                updated_on: now(),
                created_by: staffId,
                updated_by: staffId,
              });
              introScheduled += 1;
            } catch (automationError) {
              console.error('importLeadsCSV intro process schedule error', automationError);
              introSkipped += 1;
            }
          }
        }
      } catch (error) {
        skippedOnInsert.push({
          ...item.preview,
          result: 'skipped',
          reason: error?.code === 'ER_DUP_ENTRY' ? 'Duplicate entry' : (error?.message || 'Insert failed'),
        });
      }
    }

    const allSkipped = [...prepared.skippedRows, ...skippedOnInsert];

    return res.status(200).json({
      success: true,
      message: `${inserted} lead(s) imported, ${allSkipped.length} skipped`,
      data: {
        total_rows: prepared.totalRows,
        inserted,
        skipped: allSkipped.length,
        intro_scheduled: introScheduled,
        intro_skipped: introSkipped,
        skipped_rows: allSkipped.slice(0, 200),
      },
    });
  } catch (error) {
    console.error('importLeadsCSV error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    cleanupUploadedFile(req.file);
  }
};

// ---------------- UPDATE LEAD ----------------

export const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    await db('tblleads').where({ id }).update({
      name: body.name,
      company: body.company,
      email: body.email,
      phonenumber: body.phone,
      status: toInt(body.status),
      source: toInt(body.source),
      assigned: toInt(body.assigned),
      lastcontact: now(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

// ---------------- MARK AS LOST ----------------

export const markAsLost = async (req, res) => {
  const { id } = req.params;

  await db('tblleads').where({ id }).update({ lost: 1 });

  res.json({ success: true });
};

export const unmarkAsLost = async (req, res) => {
  const { id } = req.params;

  await db('tblleads').where({ id }).update({ lost: 0 });

  res.json({ success: true });
};

// ---------------- MARK AS JUNK ----------------

export const markAsJunk = async (req, res) => {
  const { id } = req.params;

  await db('tblleads').where({ id }).update({ junk: 1 });

  res.json({ success: true });
};

export const unmarkAsJunk = async (req, res) => {
  const { id } = req.params;

  await db('tblleads').where({ id }).update({ junk: 0 });

  res.json({ success: true });
};

// ---------------- KANBAN ----------------

export const getKanbanLeads = async (req, res) => {
  const { status } = req.query;

  const leads = await db('tblleads')
    .where({ status, lost: 0, junk: 0 })
    .orderBy('leadorder', 'asc');

  res.json({ success: true, data: leads });
};

// ---------------- BULK ACTION ----------------

export const bulkAction = async (req, res) => {
  const { ids, status, source, assigned } = req.body;

  if (!ids || !ids.length) return res.json({ success: false });

  for (const id of ids) {
    const update = {};

    if (status) update.status = status;
    if (source) update.source = source;
    if (assigned) update.assigned = assigned;

    if (Object.keys(update).length) {
      await db('tblleads').where({ id }).update(update);
    }
  }

  res.json({ success: true });
};

// ---------------- CONVERT TO CUSTOMER ----------------

export const convertToCustomer = async (req, res) => {
  const { id } = req.params;

  await db('tblleads').where({ id }).update({
    date_converted: now(),
    lost: 0,
    junk: 0,
  });

  res.json({ success: true });
};
