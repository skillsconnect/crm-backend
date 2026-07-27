import jwt from "jsonwebtoken";

const { default: commonModel } = await import(
  `../modules/models/mysql/commonModel/commonModel.js`
);


const keySecret = process.env.SECRET_KEY;
// import commonModel from '../Models_old/MySQL/commonModel.js';

const authenticate = (opts = {}) => async (req, res, next) => {
  try {

    const { skipPackageCheck = false, optional = false } = opts;

    const cookieToken = req.cookies?.authToken;
    const headerToken = req.headers.authorization?.startsWith("Bearer")
      ? req.headers.authorization.split(" ")[1]
      : null;
   
    let token = cookieToken || headerToken;
    if (!token) {
      if (optional) {
        // If optional auth and no token, proceed without user
        req.user = null;
        return next();
      }
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    const payload = jwt.verify(token, keySecret);
    // console.log(payload);
    // return false;

    // 🔒 DATABASE TOKEN VALIDATION - Check if token exists and is not revoked
    const tokenRecord = await commonModel.getData(
      'ups_user_token',
      '*',
      `token = '${token}' AND revoked_at IS NULL AND expires_at > NOW()`
    );
    // console.log("Token result:", token);
    // console.log("Token DB validation result:2",JSON.stringify(tokenRecord));
    if (!tokenRecord || tokenRecord.length == 0) {
      // Token not found, expired, or has been revoked
      if (cookieToken) {
        res.clearCookie('authToken', {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "Strict",
          path: '/',
        });
      }
      return res.status(401).json({ 
        error: "Unauthorized: Token has been revoked or expired",
        requireLogin: true 
      });
    }

    let enrichedPayload = { ...payload };

    if (payload.source === 'mysql') {
      const userResult = await commonModel.getData(
        "ups_users",
        "id,frecord_id,company_id,first_name,last_name,full_name,email,mobile,whatsapp_number,image_name,status,menu_tour,job_dashboard_tour,college_tour,college_invite_tour,web_push_notification,user_type",
        `id = ${payload.id} AND email = '${payload.email}' AND is_deleted = 'No'`
      );

      if (!userResult || userResult.length === 0) {
        return res.status(404).json({ error: "User not found" , requireLogin: true });
      }

      const user = userResult[0];

      // CRM-specific: is_admin bypasses all crm_staff_permissions checks
      // (see middlewares/requirePermission.js). Not every ups_users account
      // is CRM staff, so a missing row just means "no CRM access flags" —
      // routes that need CRM access still gate on crm_staff_permissions.
      const crmUserResult = await commonModel.getData(
        "crm_users",
        "is_admin, role_id, department, designation",
        `user_id = ${user.id}`
      );
      const crmUser = crmUserResult ? crmUserResult[0] : null;
      user.is_admin = Boolean(crmUser?.is_admin);
      user.crm_role_id = crmUser?.role_id ?? null;
      user.department = crmUser?.department ?? null;
      user.designation = crmUser?.designation ?? null;

      enrichedPayload.permissions = payload.permissions;
      enrichedPayload.user_type = user.user_type;

      // Enrich token payload conditionally
      const userType = user.user_type;
      const frecordId = user.frecord_id;
      if ([7, 8, 20, 16].includes(userType)) {
        const companyRows = await commonModel.joinFetch(
          ['ups_company_users as cu', ['cu.company_id', 'cu.recruiter_company_id']],
          [
            ['left', 'ups_companies as c', 'c.id = cu.company_id', ['c.company_name', 'c.client_type']],
            ['left', 'ups_companies as rc', 'rc.id = cu.recruiter_company_id', ['rc.company_name as recruiter_company_name']],
            ['left', 'ups_package_user_mapping as pum', 'pum.company_id = cu.company_id', ['pum.package_id', 'pum.package_validity_id', 'start_date', 'end_date', 'pum.payment_id', 'pum.transaction_id']],
            ['left', 'ups_packages_pricing as pp', 'pp.id = pum.package_validity_id', ['pp.package_validty']],
            ['left', 'ups_payments as p', 'p.id = pum.payment_id', ['p.coupon_id']],
            ['left', 'ups_coupon_master as cm', 'cm.id = p.coupon_id', ['cm.premium_college']],
          ],
          `cu.id = '${frecordId}'`
        );

        const c = companyRows[0] || {};
        enrichedPayload.company_id = c.company_id || c.recruiter_company_id;
        enrichedPayload.company_name = c.company_name || c.recruiter_company_name;
        enrichedPayload.client_type = c.client_type;
        enrichedPayload.package_id = c.package_id;
        enrichedPayload.package_validity_id = c.package_validity_id;
        enrichedPayload.start_date = c.start_date;
        enrichedPayload.end_date = c.end_date;
        enrichedPayload.transaction_id = c.transaction_id;
        enrichedPayload.payment_id = c.payment_id;
        enrichedPayload.coupon_id = c.coupon_id;
        enrichedPayload.premium_college = c.premium_college;
        enrichedPayload.package_validty = c.package_validty;
         // --- 🔥 PACKAGE EXPIRY CHECK ---
        // if (!skipPackageCheck && c.end_date) {
        //   const currentDate = new Date();
        //   const packageEnd = new Date(c.end_date);

        //   if (packageEnd < currentDate) {
        //     return res.status(406).json({
        //       success: false,
        //       message: "Your subscription package has expired. Please renew to continue.",
        //     });
        //   }
        // }

        if (!skipPackageCheck && c.end_date) {
          const now = new Date();

          const packageEnd = new Date(c.end_date);
          packageEnd.setHours(23, 59, 59, 999); // end of expiry day

          if (now > packageEnd) {
            return res.status(406).json({
              success: false,
              message: "Your subscription package has expired. Please renew to continue.",
            });
          }
        }


      }

      if ([4, 6, 9, 10, 11].includes(userType)) {
        const collegeRows = await commonModel.joinFetch(
          ['ups_college_users as cu', ['cu.master_college_id as college_id']],
          [[
            '',
            'ups_colleges as c',
            'c.id = cu.master_college_id',
            ['c.college_name', 'c.mou', 'c.mou_signed', 'c.updated_on as college_updated_on']
          ]],
          `cu.id = '${frecordId}'`
        );

        const clg = collegeRows[0] || {};
        // console.log(collegeRows);
        // return false;
        enrichedPayload.college_id = clg.college_id;
        enrichedPayload.college_name = clg.college_name;
        enrichedPayload.mou = clg.mou;
        enrichedPayload.mou_signed = clg.mou_signed;
        enrichedPayload.mou_last_updated = clg.college_updated_on;
      }

      if (userType === 5) {
        const collegeRows = await commonModel.joinFetch(
          ['ups_users as u', ['u.id as user_id']],
          [
            ['left', 'ups_college_users_tpo_mapping as cutm', 'cutm.user_id = u.id', ['cutm.master_college_id as college_id']],
            [
              'left',
              'ups_colleges as c',
              'c.id = cutm.master_college_id',
              ['c.college_name', 'c.mou', 'c.mou_signed', 'c.updated_on as college_updated_on']
            ]
          ],
          `u.id = '${payload.id}'`
        );

        const clg = collegeRows[0] || {};
        enrichedPayload.college_id = clg.college_id;
        enrichedPayload.college_name = clg.college_name;
        enrichedPayload.mou = clg.mou;
        enrichedPayload.mou_signed = clg.mou_signed;
        enrichedPayload.mou_last_updated = clg.college_updated_on;
      }

      req.user = {
        ...user,
        source: 'mysql',
        permissions: enrichedPayload.permissions,
        company_id: enrichedPayload.company_id,
        college_id: enrichedPayload.college_id,
        college_name: enrichedPayload.college_name,
        company_name: enrichedPayload.company_name,
        mou: enrichedPayload.mou,
        mou_signed: enrichedPayload.mou_signed,
        mou_last_updated: enrichedPayload.mou_last_updated
      };
    }
    delete enrichedPayload.exp;
    delete enrichedPayload.iat;
    // Decide whether to rotate/extend token based on last refresh time (24h window)
    const rec = Array.isArray(tokenRecord) ? tokenRecord[0] : tokenRecord;
    const rawTouched = rec?.updated_at || rec?.created_at || null;
    const lastTouched = rawTouched
      ? new Date(String(rawTouched).replace(' ', 'T'))
      : new Date();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const shouldRotate = Date.now() - lastTouched.getTime() >= twentyFourHoursMs;

    // console.log("rawTouched:", rawTouched);
    // console.log("lastTouched:", lastTouched.toISOString());
    // console.log("now:", new Date().toISOString());
    // console.log("shouldRotate:", shouldRotate);

    let refreshedToken = token; // default: keep same token

    if (shouldRotate) {
      // Issue refreshed token only if 24h passed
      refreshedToken = jwt.sign(enrichedPayload, keySecret, { expiresIn: "2d" });

      // Keep DB in sync with rotated token so DB validation doesn't fail on next request
      try {
        const newExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        await commonModel.updateData(
          'ups_user_token',
          { token: refreshedToken, updated_at: new Date(), expires_at: newExpiry },
          `id = ${rec.id}`
        );
      } catch (syncErr) {
        console.warn('Token DB sync warning:', syncErr?.message || syncErr);
        // Don't block the request if syncing fails; cookie/header will still carry refreshed token
      }

      // Web: update cookie only when rotating/extending
      if (cookieToken) {
        res.cookie("authToken", refreshedToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "Strict",
          maxAge: 2 * 24 * 60 * 60 * 1000
        });
      }

      // Mobile: set token in response header only when rotating
      if (headerToken) {
        res.setHeader("x-auth-token", refreshedToken);
      }
    }

    req.token = refreshedToken;
    next();
  } catch (err) {
    console.error("Authentication error:", err.message);
    res.status(401).json({ error: "Unauthorized: Invalid or expired token" ,requireLogin: true });
  }
};


export default authenticate;


