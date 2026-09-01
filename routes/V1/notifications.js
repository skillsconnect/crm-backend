import express from 'express';
import {
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead,
} from '../../modules/controllers/V1/notificationController.js';
import authenticate from '../../middlewares/Authenticate.js';

const router = express.Router();

// Personal to the logged-in user — login is the only gate (no feature permission).
router.use(authenticate());

router.get('/', getNotifications);
router.post('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);

export default router;
