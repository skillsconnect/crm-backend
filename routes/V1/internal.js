import Router from 'express'
import internalAuth from '../../middlewares/internalAuth.js'
import { createOrUpdateUser } from '../../modules/controllers/V1/internalController.js'

const router = Router()

router.post('/users', internalAuth, createOrUpdateUser)

export default router;
