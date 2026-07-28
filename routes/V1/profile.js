import express from 'express';
import { getMyProfile, updateMyProfile, changeMyPassword } from '../../modules/controllers/V1/profileController.js';
import authenticate from '../../middlewares/Authenticate.js';

const router = express.Router();

router.use(authenticate());

router.get('/', getMyProfile);
router.put('/', updateMyProfile);
router.post('/change-password', changeMyPassword);

export default router;
