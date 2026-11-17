import express from 'express';
import { getAllRoles, getRoleById, createRole, updateRole, deleteRole } from '../../modules/controllers/V1/roleController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('staff', 'view');
const edit = requirePermission('staff', 'edit');

router.get('/', view, getAllRoles);
router.post('/', edit, createRole);
router.get('/:id', view, getRoleById);
router.put('/:id', edit, updateRole);
router.delete('/:id', edit, deleteRole);

export default router;
