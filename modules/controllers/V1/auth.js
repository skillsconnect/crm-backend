import db from '../../../config/knex.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const keySecret = process.env.SECRET_KEY;
const refreshSecret = process.env.REFRESH_TOKEN_SECRET || keySecret;
const ACCESS_TOKEN_TTL_DAYS = parseInt(process.env.ACCESS_TOKEN_TTL_DAYS || '2', 10);
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10);

// user_type 23 = CRM Staff (see skillsconnect-node ups_roles id 23)
const CRM_STAFF_USER_TYPE = 23;

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

/**
 * POST /crm/auth/login
 * Accepts either { email, password } (direct login) or { logintoken } (SSO
 * handoff from skillsconnect-react, minted via POST /website/auth/crm-sso-token).
 * Only user_type=23 (CRM Staff) accounts may authenticate here.
 */
export const login = async (req, res) => {
  try {
    const { email, password, logintoken } = req.body;
    let user;

    if (logintoken) {
      const decoded = jwt.decode(logintoken);
      if (!decoded?.id) {
        return res.status(400).json({ status: false, msg: 'Invalid login token.' });
      }

      const tokenRow = await db('ups_user_token')
        .where({ token: logintoken })
        .whereNull('revoked_at')
        .andWhere('expires_at', '>', db.fn.now())
        .first();

      if (!tokenRow) {
        return res.status(400).json({ status: false, msg: 'Login token is expired or revoked.' });
      }

      user = await db('ups_users as u')
        .select('u.id', 'u.email', 'u.full_name', 'u.first_name', 'u.last_name', 'u.status', 'u.user_type')
        .where({ 'u.id': decoded.id, 'u.is_deleted': 'No' })
        .first();
    } else {
      if (!email || !password) {
        return res.status(400).json({ status: false, msg: 'Email and password are required.' });
      }

      user = await db('ups_users as u')
        .select('u.id', 'u.email', 'u.full_name', 'u.first_name', 'u.last_name', 'u.status', 'u.user_type')
        .where({ 'u.email': email, 'u.password': md5(password), 'u.is_deleted': 'No' })
        .first();
    }

    if (!user) {
      return res.status(401).json({ status: false, msg: 'Entered email or password is incorrect.' });
    }

    if (Number(user.user_type) !== CRM_STAFF_USER_TYPE) {
      return res.status(403).json({ status: false, msg: 'This account is not a CRM account.' });
    }

    if (['Blocked', 'Disabled'].includes(user.status)) {
      return res.status(403).json({ status: false, msg: 'This account has been disabled. Contact your administrator.' });
    }

    const crmProfile = await db('crm_users').where({ user_id: user.id }).first();
    const permissionRows = await db('crm_permissions').where({ user_id: user.id }).select('feature', 'capability');

    const tokenPayload = {
      id: user.id,
      email: user.email,
      user_type: user.user_type,
      source: 'mysql',
      permissions: permissionRows,
    };

    const token = jwt.sign(tokenPayload, keySecret, { expiresIn: `${ACCESS_TOKEN_TTL_DAYS}d` });
    const refreshToken = jwt.sign({ session: tokenPayload }, refreshSecret, { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` });

    const now = new Date();
    const tokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const refreshTokenExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db('ups_user_token').insert({
      user_id: user.id,
      email: user.email,
      token,
      refresh_token: refreshToken,
      user_agent: req.headers['user-agent'] || '',
      device_id: null,
      ip_address: req.ip || req.connection?.remoteAddress,
      expires_at: tokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      created_at: now,
      updated_at: now,
    });

    res.cookie('authToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      status: true,
      msg: 'Login successful',
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        is_admin: !!crmProfile?.is_admin,
        department: crmProfile?.department ?? null,
      },
      permissions: permissionRows,
    });
  } catch (error) {
    console.error('crm-backend login error:', error?.message || error);
    return res.status(500).json({ status: false, msg: 'Something went wrong during login.' });
  }
};

/**
 * POST /crm/auth/refresh-token
 * Mirrors skillsconnect-node's refresh flow: verify the refresh JWT, cross-check
 * it against ups_user_token (not revoked/expired), then either return the
 * still-valid access token as-is or mint + persist a new one.
 */
export const refreshTokenEndpoint = async (req, res) => {
  try {
    const incomingRefreshToken = req.body?.refreshToken || req.cookies?.refreshToken;
    if (!incomingRefreshToken) {
      return res.status(401).json({ status: false, msg: 'No refresh token provided.', requireLogin: true });
    }

    let decoded;
    try {
      decoded = jwt.verify(incomingRefreshToken, refreshSecret);
    } catch {
      return res.status(401).json({ status: false, msg: 'Invalid refresh token. Please login again.', requireLogin: true });
    }
    const payload = decoded.session;

    const dbToken = await db('ups_user_token').where({ refresh_token: incomingRefreshToken }).first();
    if (!dbToken) {
      return res.status(401).json({ status: false, msg: 'Invalid refresh token. Please login again.', requireLogin: true });
    }
    if (dbToken.revoked_at) {
      return res.status(401).json({ status: false, msg: 'Refresh token has been revoked. Please login again.', requireLogin: true });
    }
    if (dbToken.refresh_token_expires_at && new Date(dbToken.refresh_token_expires_at) < new Date()) {
      await db('ups_user_token').where({ id: dbToken.id }).update({ revoked_at: new Date() });
      return res.status(401).json({ status: false, msg: 'Refresh token expired. Please login again.', requireLogin: true });
    }

    const user = await db('ups_users')
      .where({ id: payload.id, email: payload.email, is_deleted: 'No' })
      .first('id', 'status', 'user_type');
    if (!user || Number(user.user_type) !== CRM_STAFF_USER_TYPE) {
      await db('ups_user_token').where({ id: dbToken.id }).update({ revoked_at: new Date() });
      return res.status(401).json({ status: false, msg: 'User not found. Please login again.', requireLogin: true });
    }
    if (['Blocked', 'Disabled'].includes(user.status)) {
      await db('ups_user_token').where({ id: dbToken.id }).update({ revoked_at: new Date() });
      return res.status(403).json({ status: false, msg: 'This account has been disabled.', requireLogin: true });
    }

    // Still comfortably valid — hand back the existing access token rather than rotating early.
    const refreshWindowMs = 30 * 60 * 1000;
    if (dbToken.token && dbToken.expires_at) {
      const timeLeftMs = new Date(dbToken.expires_at).getTime() - Date.now();
      if (timeLeftMs > refreshWindowMs) {
        res.cookie('authToken', dbToken.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'Strict',
          maxAge: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        });
        return res.json({ status: true, token: dbToken.token, expiresIn: Math.floor(timeLeftMs / 1000) });
      }
    }

    const newToken = jwt.sign(payload, keySecret, { expiresIn: `${ACCESS_TOKEN_TTL_DAYS}d` });
    const newExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db('ups_user_token')
      .where({ id: dbToken.id })
      .whereNull('revoked_at')
      .update({ token: newToken, updated_at: new Date(), expires_at: newExpiresAt });

    res.cookie('authToken', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    return res.json({ status: true, token: newToken, expiresIn: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 });
  } catch (error) {
    console.error('crm-backend refreshTokenEndpoint error:', error?.message || error);
    return res.status(500).json({ status: false, msg: 'Something went wrong refreshing the session.' });
  }
};

/**
 * POST /crm/auth/logout
 * Requires an authenticated session (Authenticate middleware populates req.user).
 */
export const logout = async (req, res) => {
  try {
    const userId = req.user?.id;
    const bearer = req.headers?.authorization || '';
    const tokenFromHeader = bearer.startsWith('Bearer ') ? bearer.slice(7) : undefined;
    const token = req.cookies?.authToken || tokenFromHeader;

    if (!userId) {
      return res.status(401).json({ status: false, msg: 'User not authenticated' });
    }

    if (token) {
      await db('ups_user_token').where({ token, user_id: userId }).update({ revoked_at: new Date() });
    } else {
      await db('ups_user_token').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: new Date() });
    }

    res.clearCookie('authToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
    });

    return res.status(200).json({ status: true, msg: 'Logged out successfully' });
  } catch (error) {
    console.error('crm-backend logout error:', error?.message || error);
    return res.status(500).json({ status: false, msg: 'Something went wrong during logout.' });
  }
};
