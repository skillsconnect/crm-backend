// Service-to-service auth for internal endpoints (e.g. called by skillsconnect-node,
// never by an end-user browser). Not a user JWT — a shared static key.
const INTERNAL_API_KEY = process.env.CRM_INTERNAL_API_KEY;

const internalAuth = (req, res, next) => {
  const key = req.headers['x-internal-api-key'];
  if (!INTERNAL_API_KEY || !key || key !== INTERNAL_API_KEY) {
    return res.status(401).json({ status: false, msg: 'Unauthorized: invalid internal API key' });
  }
  next();
};

export default internalAuth;
