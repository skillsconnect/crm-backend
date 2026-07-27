// Central catalog of CRM modules ("features") and the actions ("capabilities")
// that can be granted on each — mirrors the legacy CRM's feature/capability
// pairing (tblstaff_permissions), but with a uniform capability set instead
// of legacy's inconsistent per-feature set (proposals had "view_own" +
// "view_all_templates", tasks had no "view" at all, etc.). Uniform is easier
// to reason about and to build one permission grid UI for.
//
// Add a new module here and it automatically shows up in the Staff
// permissions UI and can be enforced via requirePermission(feature, cap).

export const CRM_CAPABILITIES = ['view', 'create', 'edit', 'delete'];

export const CRM_FEATURES = [
    { key: 'leads', label: 'Leads' },
    { key: 'process', label: 'Process' },
    { key: 'clients', label: 'Clients' },
    { key: 'proposals', label: 'Proposals' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'demos', label: 'Demo Scheduling' },
    { key: 'master_data', label: 'Master Data' },
    { key: 'email_campaign', label: 'Email Campaign' },
    { key: 'staff', label: 'Staff & Permissions' },
];

export const CRM_FEATURE_KEYS = CRM_FEATURES.map((f) => f.key);

export const isValidFeature = (feature) => CRM_FEATURE_KEYS.includes(feature);
export const isValidCapability = (capability) => CRM_CAPABILITIES.includes(capability);
