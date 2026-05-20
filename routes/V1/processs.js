import express from 'express';
import { 
    getAllProcesses,
    getProcessById,
    createProcess,
    updateProcess,
    deleteProcess,
    getAllProcessesWithSequence,  // Add this
    assignProcessToLead,
    getLeadProcesses,
    deleteLeadProcess
} from '../../modules/controllers/V1/processController.js';

const router = express.Router();

// Process Master Routes
router.get('/process', getAllProcesses);
router.get('/process/with-sequence', getAllProcessesWithSequence);  // Add this route
router.get('/process/:id', getProcessById);
router.post('/process', createProcess);
router.put('/process/:id', updateProcess);
router.delete('/process/:id', deleteProcess);

// Process Assignment Routes
router.post('/process-staff', assignProcessToLead);
router.get('/process-staff/lead/:lead_id', getLeadProcesses);
router.delete('/process-staff/lead/:lead_id', deleteLeadProcess);
router.delete('/process-staff/lead/:lead_id/process/:process_id', deleteLeadProcess);

export default router;