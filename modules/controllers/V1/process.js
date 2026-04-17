import CommonModel from '../../../modules/models/mysql/commonModel/commonModel.js';

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
};

const buildCommunicationMode = (body = {}) => {
  if (body.communication_mode && String(body.communication_mode).trim()) {
    return String(body.communication_mode).trim();
  }

  const channels = [];
  if (parseBoolean(body.email)) channels.push('email');
  if (parseBoolean(body.whatsapp)) channels.push('whatsapp');
  return channels.join(',');
};

export const getAllProcesses = async (req, res) => {
  try {
    const { status, process_name, sort_by, sort_dir } = req.query;
    let condition = '1=1';
    if (status) condition += ` AND status = '${String(status).replace(/'/g, "\\'")}'`;
    if (process_name) condition += ` AND process_name LIKE '%${String(process_name).replace(/'/g, "\\'")}%'`;

    // Allow only known sortable columns to avoid SQL injection
    const allowedSortColumns = new Set(['id', 'process_name', 'communication_mode', 'status', 'created_on', 'updated_on']);
    const orderBy = allowedSortColumns.has(String(sort_by)) ? String(sort_by) : 'id';
    const orderDir = String(sort_dir).toLowerCase() === 'asc' ? 'asc' : 'desc';

    const rows = await CommonModel.getData(
      'tblprocess',
      '*',
      condition,
      orderBy,
      orderDir
    );

    return res.status(200).json({ success: true, data: rows || [] });
  } catch (error) {
    console.error('getAllProcesses error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getProcessById = async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await CommonModel.getData(
      'tblprocess',
      '*',
      `id = ${Number(id)}`
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Process not found' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('getProcessById error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const createProcess = async (req, res) => {
  try {
    const body = req.body || {};
    const processName = body.process_name ? String(body.process_name).trim() : '';
    if (!processName) {
      return res.status(400).json({ success: false, message: 'Process name is required' });
    }

    const communication_mode = buildCommunicationMode(body);
    if (!communication_mode) {
      return res.status(400).json({ success: false, message: 'At least one communication mode is required' });
    }

    const duplicate = await CommonModel.getData(
      'tblprocess',
      'id',
      `process_name = '${processName.replace(/'/g, "\\'")}'`
    );
    if (duplicate && duplicate.length > 0) {
      return res.status(400).json({ success: false, message: 'Process already exists' });
    }

    const insertData = {
      process_name: processName,
      email_subject: body.email_subject ? String(body.email_subject).trim() : '',
      email_content: body.email_content || '',
      whatsapp_content: body.whatsapp_content || '',
      whatsapp_template_name: body.whatsapp_template_name || null,
      communication_mode,
      status: body.status || 'Active',
      created_on: new Date(),
      updated_on: new Date(),
      created_by: req.user?.id || body.created_by || 1,
      updated_by: req.user?.id || body.updated_by || 1,
    };

    const insertedId = await CommonModel.insertData('tblprocess', insertData);
    if (!insertedId) {
      return res.status(400).json({ success: false, message: 'Error creating process' });
    }

    const created = await CommonModel.getData(
      'tblprocess',
      '*',
      `id = ${insertedId}`
    );

    return res.status(201).json({ success: true, data: created?.[0] || null });
  } catch (error) {
    console.error('createProcess error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const updateProcess = async (req, res) => {
  try {
    const { id } = req.params;
    const processId = Number(id);
    const body = req.body || {};

    const existing = await CommonModel.getData(
      'tblprocess',
      '*',
      `id = ${processId}`
    );

    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Process not found' });
    }

    const updateData = { updated_on: new Date(), updated_by: req.user?.id || body.updated_by || 1 };

    if (body.process_name && String(body.process_name).trim()) {
      const processName = String(body.process_name).trim();
      const duplicate = await CommonModel.getData(
        'tblprocess',
        'id',
        `process_name = '${processName.replace(/'/g, "\\'")}' AND id != ${processId}`
      );
      if (duplicate && duplicate.length > 0) {
        return res.status(400).json({ success: false, message: 'Another process with this name exists' });
      }
      updateData.process_name = processName;
    }

    if (body.email_subject !== undefined) updateData.email_subject = body.email_subject;
    if (body.email_content !== undefined) updateData.email_content = body.email_content;
    if (body.whatsapp_content !== undefined) updateData.whatsapp_content = body.whatsapp_content;
    if (body.whatsapp_template_name !== undefined) updateData.whatsapp_template_name = body.whatsapp_template_name;
    if (body.status) updateData.status = body.status;

    const communication_mode = buildCommunicationMode(body);
    if (communication_mode) updateData.communication_mode = communication_mode;

    const updated = await CommonModel.updateData(
      'tblprocess',
      updateData,
      `id = ${processId}`
    );

    if (!updated) {
      return res.status(400).json({ success: false, message: 'Error updating process' });
    }

    const updatedRow = await CommonModel.getData(
      'tblprocess',
      '*',
      `id = ${processId}`
    );

    return res.status(200).json({ success: true, data: updatedRow?.[0] || null });
  } catch (error) {
    console.error('updateProcess error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const deleteProcess = async (req, res) => {
  try {
    const { id } = req.params;
    const processId = Number(id);

    const existing = await CommonModel.getData(
      'tblprocess',
      'id',
      `id = ${processId}`
    );

    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Process not found' });
    }

    const deleted = await CommonModel.deleteRecord('tblprocess', `id = ${processId}`);
    if (!deleted) {
      return res.status(400).json({ success: false, message: 'Error deleting process' });
    }

    return res.status(200).json({ success: true, message: 'Process deleted successfully' });
  } catch (error) {
    console.error('deleteProcess error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getProcessDetails = async (req, res) => {
  try {
    const masterProcessId = Number(req.query.master_process_id);
    const leadId = req.query.lead_id ? Number(req.query.lead_id) : null;
    const staffId = req.user?.id || (req.query.staff_id ? Number(req.query.staff_id) : null);

    if (!masterProcessId) {
      return res.status(400).json({ success: false, message: 'master_process_id is required' });
    }

    const processMaster = await CommonModel.getData(
      'tblprocess',
      '*',
      `id = ${masterProcessId}`
    );

    if (!processMaster || processMaster.length === 0) {
      return res.status(404).json({ success: false, message: 'Process not found' });
    }

    let staffCondition = `master_process_id = ${masterProcessId}`;
    if (staffId) staffCondition += ` AND staff_id = ${staffId}`;
    if (leadId) staffCondition += ` AND lead_id = ${leadId}`;

    const staffRows = await CommonModel.getData(
      'tblprocess_staff',
      '*',
      staffCondition,
      'id',
      'desc'
    );

    const staffProcess = staffRows && staffRows.length ? staffRows[0] : null;

    return res.status(200).json({
      success: true,
      data: {
        processMaster: processMaster[0],
        process: staffProcess,
        lead_id: leadId,
        master_process_id: masterProcessId,
      },
    });
  } catch (error) {
    console.error('getProcessDetails error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const saveProcessDetails = async (req, res) => {
  try {
    const body = req.body || {};
    const staffId = req.user?.id || body.staff_id;
    const leadId = body.lead_id ? Number(body.lead_id) : null;
    let masterProcessId = body.master_process_id ? Number(body.master_process_id) : null;

    if (!masterProcessId && body.process_name) {
      const masterByName = await CommonModel.getData(
        'tblprocess',
        'id, process_name, email_subject, whatsapp_content, whatsapp_template_name',
        `process_name = '${String(body.process_name).trim().replace(/'/g, "\\'")}'`
      );
      if (masterByName && masterByName.length > 0) {
        masterProcessId = masterByName[0].id;
      }
    }

    if (!masterProcessId) {
      return res.status(400).json({ success: false, message: 'master_process_id is required' });
    }

    if (!staffId) {
      return res.status(400).json({ success: false, message: 'staff_id is required' });
    }

    const masterRows = await CommonModel.getData(
      'tblprocess',
      'id, process_name, email_subject, whatsapp_content, whatsapp_template_name',
      `id = ${masterProcessId}`
    );
    if (!masterRows || masterRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Master process not found' });
    }

    const master = masterRows[0];
    const communication_mode = buildCommunicationMode(body);
    if (!communication_mode) {
      return res.status(400).json({ success: false, message: 'At least one communication mode is required' });
    }

    const saveData = {
      process_name: body.process_name ? String(body.process_name).trim() : master.process_name,
      email_content: body.email_content || '',
      email_subject: body.email_subject || master.email_subject,
      whatsapp_content: body.whatsapp_content || master.whatsapp_content,
      whatsapp_template_name: body.whatsapp_template_name || master.whatsapp_template_name,
      communication_mode,
      status: body.status || 'Active',
      staff_id: Number(staffId),
      master_process_id: masterProcessId,
    };

    let condition = `staff_id = ${Number(staffId)} AND master_process_id = ${masterProcessId}`;
    if (leadId) condition += ` AND lead_id = ${leadId}`;

    const existing = await CommonModel.getData(
      'tblprocess_staff',
      '*',
      condition,
      'id',
      'desc'
    );

    let updated = false;
    let savedId = null;

    if (existing && existing.length > 0) {
      const existingId = existing[0].id;
      saveData.updated_on = new Date();
      saveData.updated_by = Number(staffId);
      updated = await CommonModel.updateData('tblprocess_staff', saveData, `id = ${existingId}`);
      savedId = existingId;
    } else {
      saveData.lead_id = leadId;
      saveData.contact_date_time = body.contact_date_time
        ? new Date(body.contact_date_time)
        : new Date();
      saveData.created_on = new Date();
      saveData.created_by = Number(staffId);
      saveData.updated_on = new Date();
      saveData.updated_by = Number(staffId);
      savedId = await CommonModel.insertData('tblprocess_staff', saveData);
      updated = !!savedId;
    }

    if (!updated) {
      return res.status(400).json({ success: false, message: 'Unable to save process details' });
    }

    const saved = await CommonModel.getData(
      'tblprocess_staff',
      '*',
      `id = ${Number(savedId)}`
    );

    return res.status(200).json({
      success: true,
      message: existing && existing.length > 0 ? 'Mail Schedule Updated Successfully.' : 'Mail Scheduled Successfully.',
      data: saved?.[0] || null,
    });
  } catch (error) {
    console.error('saveProcessDetails error', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
