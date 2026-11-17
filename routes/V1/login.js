import Router from 'express'
import rateLimit from 'express-rate-limit'
import { login, logout, refreshTokenEndpoint } from '../../modules/controllers/V1/auth.js'
import authenticate from '../../middlewares/Authenticate.js'

const router = Router()

// app.js's global limiter (50 req/s) is sized for normal API traffic, not
// credential guessing — at that rate a brute-force script can try thousands
// of passwords per minute. Login gets its own much tighter, per-IP limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: false, msg: 'Too many login attempts. Please try again in a few minutes.' },
});

router.post('/login', loginLimiter, login)
router.post('/logout', authenticate(), logout)
router.post('/refresh-token', refreshTokenEndpoint)

export default router;
