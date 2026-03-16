import Router from 'express'
import { login, logout} from '../../modules/controllers/V1/auth.js'

const router = Router()

router.use('/login', login)

export default router;
