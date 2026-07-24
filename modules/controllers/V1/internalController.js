import db from '../../../config/knex.js';
import CommonModel from '../../../modules/models/mysql/commonModel/commonModel.js';

/**
 * POST /crm/internal/users
 *
 * Called by skillsconnect-node (service-to-service, internalAuth-gated) whenever
 * a user_type=23 (CRM Staff) row is created in ups_users — both for the ongoing
 * auto-provisioning hook and for the one-time legacy tblstaff migration script.
 * Upserts the crm_users row and, if provided, the matching crm_permissions rows.
 */
export const createOrUpdateUser = async (req, res) => {
  try {
    const {
      user_id,
      legacy_staff_id,
      is_admin,
      department,
      designation,
      hourly_rate,
      default_language,
      profile_image,
      created_by,
      permissions, // optional: [{ feature, capability }, ...] — used by the migration path
    } = req.body;

    if (!user_id) {
      return res.status(400).json({ status: false, msg: 'user_id is required' });
    }

    // created_by: whoever triggered the ups_users creation on the node side
    // (falls back to system user 1 for the bulk legacy migration).
    const actorId = created_by ? Number(created_by) : 1;

    const crmUserData = {
      user_id: Number(user_id),
      legacy_staff_id: legacy_staff_id ?? null,
      is_admin: is_admin ? 1 : 0,
      department: department ?? null,
      designation: designation ?? null,
      hourly_rate: hourly_rate ?? null,
      default_language: default_language ?? null,
      profile_image: profile_image ?? null,
      updated_by: actorId,
    };

    const existingRow = await db('crm_users').where({ user_id: Number(user_id) }).first('id');
    if (!existingRow) {
      crmUserData.created_by = actorId;
    }

    const [row] = await db('crm_users')
      .insert(crmUserData)
      .onConflict('user_id')
      .merge();

    const existing = await CommonModel.getData('crm_users', 'id', `user_id = ${Number(user_id)}`);
    const crmUserId = existing?.[0]?.id ?? row;

    if (Array.isArray(permissions) && permissions.length) {
      const rows = permissions
        .filter((p) => p?.feature && p?.capability)
        .map((p) => ({ user_id: Number(user_id), feature: p.feature, capability: p.capability }));

      if (rows.length) {
        await db('crm_permissions').insert(rows).onConflict(['user_id', 'feature', 'capability']).ignore();
      }
    }

    return res.status(201).json({ status: true, msg: 'CRM user provisioned', data: { id: crmUserId, user_id: Number(user_id) } });
  } catch (error) {
    console.error('createOrUpdateUser error:', error?.message || error);
    return res.status(500).json({ status: false, msg: 'Something went wrong provisioning the CRM user.' });
  }
};
