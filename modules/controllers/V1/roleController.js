import db from '../../../config/knex.js';
import { isValidFeature, isValidCapability } from '../../../helpers/V1/crmPermissions.catalog.js';

const currentUserId = (req) => req.user?.id || 1;

export const getAllRoles = async (req, res) => {
    try {
        const roles = await db('crm_roles').select('*').orderBy('name', 'asc');

        const staffCounts = await db('crm_users').select('role_id').count('id as total').whereNotNull('role_id').groupBy('role_id');
        const countByRole = new Map(staffCounts.map((r) => [r.role_id, Number(r.total)]));

        const permCounts = await db('crm_role_permissions').select('role_id').count('id as total').groupBy('role_id');
        const permCountByRole = new Map(permCounts.map((r) => [r.role_id, Number(r.total)]));

        res.status(200).json({
            success: true,
            data: roles.map((r) => ({ ...r, staff_count: countByRole.get(r.id) || 0, permission_count: permCountByRole.get(r.id) || 0 })),
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getRoleById = async (req, res) => {
    try {
        const { id } = req.params;
        const role = await db('crm_roles').where('id', id).first();
        if (!role) return res.status(404).json({ success: false, message: "Role not found" });

        const permissions = await db('crm_role_permissions').select('feature', 'capability').where('role_id', id);
        res.status(200).json({ success: true, data: { ...role, permissions } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const createRole = async (req, res) => {
    try {
        const { name, description, permissions } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: "Role name is required" });
        }

        const existing = await db('crm_roles').where('name', name.trim()).first();
        if (existing) return res.status(400).json({ success: false, message: "A role with this name already exists" });

        const roleId = await db.transaction(async (trx) => {
            const [insertedId] = await trx('crm_roles').insert({
                name: name.trim(),
                description: description || null,
                created_by: currentUserId(req),
            });

            const validRows = (Array.isArray(permissions) ? permissions : []).filter((p) => isValidFeature(p.feature) && isValidCapability(p.capability));
            if (validRows.length) {
                await trx('crm_role_permissions').insert(validRows.map((p) => ({ role_id: insertedId, feature: p.feature, capability: p.capability })));
            }

            return insertedId;
        });

        const newRole = await db('crm_roles').where('id', roleId).first();
        res.status(201).json({ success: true, message: "Role created successfully", data: newRole });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const updateRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, permissions } = req.body;

        const existing = await db('crm_roles').where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Role not found" });

        const updateData = {};
        if (name && name.trim()) {
            const duplicate = await db('crm_roles').where('name', name.trim()).whereNot('id', id).first();
            if (duplicate) return res.status(400).json({ success: false, message: "Another role with this name exists" });
            updateData.name = name.trim();
        }
        if (description !== undefined) updateData.description = description;

        await db.transaction(async (trx) => {
            if (Object.keys(updateData).length) {
                await trx('crm_roles').where('id', id).update(updateData);
            }

            if (Array.isArray(permissions)) {
                await trx('crm_role_permissions').where('role_id', id).del();
                const validRows = permissions.filter((p) => isValidFeature(p.feature) && isValidCapability(p.capability));
                if (validRows.length) {
                    await trx('crm_role_permissions').insert(validRows.map((p) => ({ role_id: id, feature: p.feature, capability: p.capability })));
                }
            }
        });

        const updated = await db('crm_roles').where('id', id).first();
        res.status(200).json({ success: true, message: "Role updated successfully", data: updated });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteRole = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db('crm_roles').where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Role not found" });

        const staffUsing = await db('crm_users').where('role_id', id).first();
        if (staffUsing) {
            return res.status(400).json({ success: false, message: "Cannot delete a role assigned to staff — reassign them first" });
        }

        await db.transaction(async (trx) => {
            await trx('crm_role_permissions').where('role_id', id).del();
            await trx('crm_roles').where('id', id).del();
        });

        res.status(200).json({ success: true, message: "Role deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
