import db from '../../../config/knex.js';
import { CRM_FEATURES, CRM_CAPABILITIES, isValidFeature, isValidCapability } from '../../../helpers/V1/crmPermissions.catalog.js';

const currentUserId = (req) => req.user?.id || 1;

// ==================== STAFF LIST ====================
// The Staff page — every ups_users account that has been onboarded as CRM
// staff (has a crm_users row), joined with their role/admin/permission count.

export const getAllStaff = async (req, res) => {
    try {
        const { search, status } = req.query;

        let query = db('crm_users as cu')
            .join('ups_users as u', 'u.id', 'cu.user_id')
            .leftJoin('crm_roles as r', 'r.id', 'cu.role_id')
            .select(
                'cu.id as crm_user_id', 'u.id as user_id', 'u.first_name', 'u.last_name', 'u.email',
                'u.mobile', 'u.status', 'cu.is_admin', 'cu.department', 'cu.designation',
                'cu.role_id', 'r.name as role_name', 'cu.created_on'
            );

        if (status) query = query.where('u.status', status);
        if (search) {
            query = query.where((qb) => {
                qb.where('u.first_name', 'like', `%${search}%`)
                    .orWhere('u.last_name', 'like', `%${search}%`)
                    .orWhere('u.email', 'like', `%${search}%`);
            });
        }

        const staff = await query.orderBy('u.first_name', 'asc');

        const permissionCounts = await db('crm_staff_permissions')
            .select('staff_id')
            .count('id as total')
            .groupBy('staff_id');
        const countByStaff = new Map(permissionCounts.map((p) => [p.staff_id, Number(p.total)]));

        const data = staff.map((s) => ({
            ...s,
            full_name: `${s.first_name || ''} ${s.last_name || ''}`.trim(),
            permission_count: countByStaff.get(s.user_id) || 0,
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getStaffById = async (req, res) => {
    try {
        const { id } = req.params; // ups_users.id

        const staff = await db('crm_users as cu')
            .join('ups_users as u', 'u.id', 'cu.user_id')
            .leftJoin('crm_roles as r', 'r.id', 'cu.role_id')
            .select(
                'cu.id as crm_user_id', 'u.id as user_id', 'u.first_name', 'u.last_name', 'u.email',
                'u.mobile', 'u.status', 'cu.is_admin', 'cu.department', 'cu.designation', 'cu.role_id', 'r.name as role_name'
            )
            .where('u.id', id)
            .first();

        if (!staff) return res.status(404).json({ success: false, message: "Staff member not found" });

        const permissions = await db('crm_staff_permissions').select('feature', 'capability').where('staff_id', id);

        res.status(200).json({
            success: true,
            data: {
                ...staff,
                full_name: `${staff.first_name || ''} ${staff.last_name || ''}`.trim(),
                permissions,
            },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// Only an admin can promote/demote another admin — a non-admin (even one
// with full per-feature grants) can never escalate themselves or anyone
// else, matching the legacy admin-flag-is-special behavior.
export const setStaffAdmin = async (req, res) => {
    try {
        if (!req.user?.is_admin) {
            return res.status(403).json({ success: false, message: "Only an admin can change admin status" });
        }

        const { id } = req.params;
        const { is_admin } = req.body;

        const existing = await db('crm_users').where('user_id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Staff member not found" });

        await db('crm_users').where('user_id', id).update({ is_admin: Boolean(is_admin), updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: `Admin access ${is_admin ? 'granted' : 'revoked'}` });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== PERMISSION CATALOG ====================

export const getFeatureCatalog = async (req, res) => {
    res.status(200).json({ success: true, data: { features: CRM_FEATURES, capabilities: CRM_CAPABILITIES } });
};

// ==================== PER-STAFF PERMISSIONS ====================

export const getStaffPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const permissions = await db('crm_staff_permissions').select('feature', 'capability').where('staff_id', id);
        res.status(200).json({ success: true, data: permissions });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// Replaces the full permission set for a staff member in one call — the
// frontend sends a checkbox grid (feature x capability), simplest to just
// diff-free replace rather than track individual toggles.
export const setStaffPermissions = async (req, res) => {
    try {
        if (!req.user?.is_admin) {
            return res.status(403).json({ success: false, message: "Only an admin can change staff permissions" });
        }

        const { id } = req.params;
        const { permissions } = req.body;

        if (!Array.isArray(permissions)) {
            return res.status(400).json({ success: false, message: "permissions must be an array of {feature, capability}" });
        }

        const staff = await db('crm_users').where('user_id', id).first();
        if (!staff) return res.status(404).json({ success: false, message: "Staff member not found" });

        const validRows = permissions.filter((p) => isValidFeature(p.feature) && isValidCapability(p.capability));

        await db.transaction(async (trx) => {
            await trx('crm_staff_permissions').where('staff_id', id).del();
            if (validRows.length) {
                await trx('crm_staff_permissions').insert(validRows.map((p) => ({
                    staff_id: id,
                    feature: p.feature,
                    capability: p.capability,
                    created_by: currentUserId(req),
                })));
            }
        });

        res.status(200).json({ success: true, message: "Permissions updated successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const setStaffRole = async (req, res) => {
    try {
        if (!req.user?.is_admin) {
            return res.status(403).json({ success: false, message: "Only an admin can change staff roles" });
        }

        const { id } = req.params;
        const { role_id, apply_template } = req.body;

        const staff = await db('crm_users').where('user_id', id).first();
        if (!staff) return res.status(404).json({ success: false, message: "Staff member not found" });

        if (role_id) {
            const role = await db('crm_roles').where('id', role_id).first();
            if (!role) return res.status(404).json({ success: false, message: "Role not found" });
        }

        await db.transaction(async (trx) => {
            await trx('crm_users').where('user_id', id).update({ role_id: role_id || null, updated_by: currentUserId(req) });

            // Applying the template ADDS the role's permissions on top of
            // whatever the staff member already has — it doesn't strip
            // custom grants, matching "role = starting point, staff-level
            // grants are still the source of truth" from the migration note.
            if (apply_template && role_id) {
                const templateRows = await trx('crm_role_permissions').select('feature', 'capability').where('role_id', role_id);
                for (const row of templateRows) {
                    await trx('crm_staff_permissions')
                        .insert({ staff_id: id, feature: row.feature, capability: row.capability, created_by: currentUserId(req) })
                        .onConflict(['staff_id', 'feature', 'capability'])
                        .ignore();
                }
            }
        });

        res.status(200).json({ success: true, message: "Role updated successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// A user's own permission set — used by the frontend to decide what to show
// in the sidebar / gate pages client-side. Real enforcement is still
// server-side via requirePermission; this is purely for UI.
export const getMyPermissions = async (req, res) => {
    try {
        const userId = req.user.id;
        if (req.user.is_admin) {
            // Admins implicitly have everything — hand back the full catalog
            // rather than an empty grant list, so the frontend's `can()`
            // check doesn't need a separate "is admin" special case.
            const all = CRM_FEATURES.flatMap((f) => CRM_CAPABILITIES.map((c) => ({ feature: f.key, capability: c })));
            return res.status(200).json({ success: true, data: { is_admin: true, permissions: all } });
        }

        const permissions = await db('crm_staff_permissions').select('feature', 'capability').where('staff_id', userId);
        res.status(200).json({ success: true, data: { is_admin: false, permissions } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
