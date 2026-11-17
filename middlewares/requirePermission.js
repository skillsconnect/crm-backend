import db from '../config/knex.js';

// Legacy-CRM-equivalent access check: admins bypass everything (matches
// tblstaff.admin), everyone else needs an explicit
// (staff_id, feature, capability) grant row — same shape as legacy
// tblstaff_permissions, just renamed to crm_staff_permissions.
//
// req.user.is_admin is populated by Authenticate.js's crm_users lookup.
// Usage: router.post('/', requirePermission('leads', 'create'), createLead)
const requirePermission = (feature, capability) => async (req, res, next) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        if (req.user.is_admin) return next();

        const grant = await db('crm_staff_permissions')
            .where({ staff_id: req.user.id, feature, capability })
            .first();

        if (!grant) {
            return res.status(403).json({
                success: false,
                message: `You don't have permission to ${capability} ${feature.replace('_', ' ')}`,
            });
        }

        next();
    } catch (error) {
        console.error('Permission check failed:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export default requirePermission;
