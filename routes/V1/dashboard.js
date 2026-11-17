import express from 'express';
import { getDashboardStats } from '../../modules/controllers/V1/dashboardController.js';
import authenticate from '../../middlewares/Authenticate.js';

const router = express.Router();

router.use(authenticate());

router.get('/stats', getDashboardStats);

export default router;
