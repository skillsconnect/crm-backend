import express from 'express';
import {
    getFormData,
    searchLeads,
    getAllDemos,
    getDemoById,
    createDemo,
    updateDemo,
    cancelDemo,
    markDemoStatus,
} from '../../modules/controllers/V1/demoController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('demos', 'view');
const create = requirePermission('demos', 'create');
const edit = requirePermission('demos', 'edit');
const del = requirePermission('demos', 'delete');

router.get('/form-data', view, getFormData);
// Must come before '/:id' or Express would treat "leads-search" as an id.
router.get('/leads-search', view, searchLeads);
router.get('/', view, getAllDemos);
router.post('/', create, createDemo);
router.get('/:id', view, getDemoById);
router.put('/:id', edit, updateDemo);
router.delete('/:id', del, cancelDemo);
router.patch('/:id/status', edit, markDemoStatus);

export default router;
