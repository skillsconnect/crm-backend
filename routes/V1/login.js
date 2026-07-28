import Router from 'express'
import { login, logout, refreshTokenEndpoint } from '../../modules/controllers/V1/auth.js'
import authenticate from '../../middlewares/Authenticate.js'

const router = Router()

router.post('/login', login)
router.post('/logout', authenticate(), logout)
router.post('/refresh-token', refreshTokenEndpoint)

export default router;
