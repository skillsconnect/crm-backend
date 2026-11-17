import express from 'express';
import {
    getMyProfile,
    updateMyProfile,
    changeMyPassword,
    getCalendarStatus,
    getCalendarConnectUrl,
    disconnectCalendar,
} from '../../modules/controllers/V1/profileController.js';
import authenticate from '../../middlewares/Authenticate.js';

const router = express.Router();

router.use(authenticate());

router.get('/', getMyProfile);
router.put('/', updateMyProfile);
router.post('/change-password', changeMyPassword);

router.get('/calendar/status', getCalendarStatus);
router.get('/calendar/connect-url', getCalendarConnectUrl);
router.delete('/calendar', disconnectCalendar);

export default router;
