import express from 'express';
import {
    getAllProcesses,
    getProcessById,
    createProcess,
    updateProcess,
    deleteProcess,
    getAllProcessesWithSequence,
    assignProcessToLead,
    getLeadProcesses,
    deleteLeadProcess,
    getProcessDetails,
    saveProcessDetails,
    getProcessFlow
} from '../../modules/controllers/V1/processController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

// This router is mounted at /crm/process (see routes/index.js) — paths here
// are relative to that, e.g. GET '/' => GET /crm/process.
router.use(authenticate());

const view = requirePermission('process', 'view');
const create = requirePermission('process', 'create');
const edit = requirePermission('process', 'edit');
const del = requirePermission('process', 'delete');

// Process Master Routes
router.get('/with-sequence', view, getAllProcessesWithSequence);
// Must come before '/:id' or Express would treat "details"/"flow" as an id.
router.get('/details', view, getProcessDetails);
router.post('/details', edit, saveProcessDetails);
router.get('/flow', view, getProcessFlow);
router.get('/:id', view, getProcessById);
router.get('/', view, getAllProcesses);
router.post('/', create, createProcess);
router.put('/:id', edit, updateProcess);
router.delete('/:id', del, deleteProcess);

// Process Assignment Routes
router.post('/process-staff', edit, assignProcessToLead);
router.get('/process-staff/lead/:lead_id', view, getLeadProcesses);
router.delete('/process-staff/lead/:lead_id', edit, deleteLeadProcess);
router.delete('/process-staff/lead/:lead_id/process/:process_id', edit, deleteLeadProcess);

export default router;
