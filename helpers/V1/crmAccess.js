// Single source of truth for "may this ups_users account use the CRM?".
//
// CRM access is granted by having a crm_users row (explicit onboarding), and
// is limited to the account types below so that a SkillsConnect college,
// company, student or operations account can never get in even if a
// crm_users row exists for it by mistake. Superadmins/admins keep their
// user_type (and SkillsConnect access) and use the same login for the CRM.
//
// Checked on login, SSO, token refresh AND on every authenticated request, so
// demoting a user in SkillsConnect or removing their crm_users row takes
// effect immediately rather than when their token expires.

export const USER_TYPE = {
    SUPERADMIN: 1,
    ADMIN: 2,
    OPERATIONS: 3,
    CRM_STAFF: 23,
};

// Operations (3) is deliberately excluded: operations users who need the CRM
// are converted to CRM_STAFF (23) by the legacy migration instead.
export const CRM_LOGIN_USER_TYPES = [
    USER_TYPE.SUPERADMIN,
    USER_TYPE.ADMIN,
    USER_TYPE.CRM_STAFF,
];

// SkillsConnect superadmins are always CRM admins. Derived live from
// user_type (never persisted), so a demotion in SkillsConnect revokes it.
export const isPlatformSuperadmin = (user) => Number(user?.user_type) === USER_TYPE.SUPERADMIN;

export const isCrmAdmin = (user, crmUser) => isPlatformSuperadmin(user) || Boolean(crmUser?.is_admin);

/**
 * @param {{ user_type: number|string, status: string }} user  ups_users row
 * @param {object|null|undefined} crmUser  crm_users row for that user
 * @returns {{ ok: true } | { ok: false, code: 'not_crm_account'|'inactive', msg: string }}
 */
export const checkCrmAccess = (user, crmUser) => {
    if (!user || !CRM_LOGIN_USER_TYPES.includes(Number(user.user_type)) || !crmUser) {
        return { ok: false, code: 'not_crm_account', msg: 'This account does not have CRM access.' };
    }
    if (user.status !== 'Active') {
        return { ok: false, code: 'inactive', msg: 'This account is not active. Contact your administrator.' };
    }
    return { ok: true };
};
