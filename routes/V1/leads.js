import Router from 'express';
import { getAllLeads } from '../../modules/controllers/V1/leads.js';

const router = Router();

router.get('/getAllLeads', getAllLeads);

export default router;