// Row-level visibility for leads. `leads:view` lets a staff member into the
// module but only for leads they own (assigned/added) or that are public;
// `leads:view_global` (and any admin) lifts that to every lead. Mirrors the
// legacy CRM's "view own" vs global lead permission split.
import db from '../../config/knex.js';

export const hasGlobalLeadView = async (req) => {
    if (req.user?.is_admin) return true;
    if (!req.user?.id) return false;
    const grant = await db('crm_staff_permissions')
        .where({ staff_id: req.user.id, feature: 'leads', capability: 'view_global' })
        .first();
    return Boolean(grant);
};

export const userOwnsLead = (req, lead) => {
    const uid = Number(req.user?.id);
    if (!uid || !lead) return false;
    return Number(lead.assigned) === uid
        || Number(lead.addedfrom) === uid
        || Boolean(lead.is_public);
};

// Knex modifier: constrain a `crm_leads as l` query to the leads this user may
// see. Pass the result of hasGlobalLeadView so the DB check isn't repeated.
export const scopeLeadsForUser = (req, isGlobal) => (qb) => {
    if (isGlobal) return qb;
    const uid = Number(req.user?.id) || 0;
    return qb.where((b) => {
        b.where('l.assigned', uid)
            .orWhere('l.addedfrom', uid)
            .orWhere('l.is_public', true);
    });
};
