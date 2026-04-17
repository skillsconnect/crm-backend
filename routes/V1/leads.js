import Router from 'express';
import {
	getAllLeads,
	getLeadFormData,
	createLead,
	simulateLeadsImport,
	importLeadsCSV,
	bulkAction,
} from '../../modules/controllers/V1/leads.js';
import { uploadCSV, parseCSV } from '../../middlewares/csvMiddleware.js';

const router = Router();

router.get('/getAllLeads', getAllLeads);
router.get('/form-data', getLeadFormData);
router.post('/', createLead);
router.post('/import/simulate', uploadCSV, parseCSV, simulateLeadsImport);
router.post('/import', uploadCSV, parseCSV, importLeadsCSV);
router.post('/bulk_action', async (req, res, next) => {
	// simple wrapper to call controller
	try {
		await bulkAction(req, res);
	} catch (err) {
		next(err);
	}
});

export default router;