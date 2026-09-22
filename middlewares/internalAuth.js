// Service-to-service auth for internal endpoints (e.g. called by skillsconnect-node,
// never by an end-user browser). Not a user JWT — a shared static key.
import crypto from 'crypto';

const INTERNAL_API_KEY = process.env.CRM_INTERNAL_API_KEY;
const expectedBuffer = INTERNAL_API_KEY ? Buffer.from(INTERNAL_API_KEY) : null;

const internalAuth = (req, res, next) => {
  const key = req.headers['x-internal-api-key'];

  // `!==` on secrets leaks timing info proportional to the matching prefix
  // length; timingSafeEqual needs equal-length buffers, so length is checked
  // separately first (that comparison isn't secret-dependent, so it's fine
  // to short-circuit on it).
  if (!expectedBuffer || typeof key !== 'string') {
    return res.status(401).json({ status: false, msg: 'Unauthorized: invalid internal API key' });
  }
  const keyBuffer = Buffer.from(key);
  if (keyBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(keyBuffer, expectedBuffer)) {
    return res.status(401).json({ status: false, msg: 'Unauthorized: invalid internal API key' });
  }
  next();
};

export default internalAuth;
