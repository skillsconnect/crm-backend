import Router from 'express';
import {
	getAllProcesses,
	getProcessById,
	createProcess,
	updateProcess,
	deleteProcess,
	getProcessDetails,
	saveProcessDetails,
} from '../../modules/controllers/V1/process.js';

const router = Router();

router.get('/', getAllProcesses);
router.get('/details', getProcessDetails);
router.post('/details', saveProcessDetails);
router.get('/:id', getProcessById);
router.post('/', createProcess);
router.put('/:id', updateProcess);
router.delete('/:id', deleteProcess);

export default router;
