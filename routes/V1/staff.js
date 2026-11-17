import express from 'express';
import {
    getAllStaff,
    getStaffById,
    setStaffAdmin,
    getFeatureCatalog,
    getStaffPermissions,
    setStaffPermissions,
    setStaffRole,
    getMyPermissions,
} from '../../modules/controllers/V1/staffController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('staff', 'view');

// Catalog + "my own permissions" are needed by every logged-in user (to
// drive the sidebar/UI gating), not just staff-feature holders.
router.get('/feature-catalog', getFeatureCatalog);
router.get('/me/permissions', getMyPermissions);

router.get('/', view, getAllStaff);
router.get('/:id', view, getStaffById);

// Admin/role/permission mutations are intentionally hard-admin-only inside
// the controllers themselves (see staffController.js) rather than governed
// by a delegatable 'staff:edit' grant — letting a non-admin holder of
// 'staff:edit' hand out admin/permissions to themselves or others would be
// a privilege-escalation hole.
router.patch('/:id/admin', setStaffAdmin);
router.patch('/:id/role', setStaffRole);
router.get('/:id/permissions', view, getStaffPermissions);
router.put('/:id/permissions', setStaffPermissions);

export default router;
