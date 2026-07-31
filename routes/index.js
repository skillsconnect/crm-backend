import express from 'express';
const router = express.Router();

const VERSION = process.env.WEBSITE_VERSION;
if (!VERSION) {
  throw new Error('WEBSITE_VERSION is not set (e.g., V1 or v1)');
}

// Helper that resolves a module to an Express middleware/Router (a function)
const loadRouter = async (name) => {
  const mod = await import(`./${VERSION}/${name}.js`);
  // Try common export shapes: default export, named `router`, or the module itself
  const candidate = mod?.default ?? mod?.router ?? mod;
  // console.log(`/${VERSION}/${name}.js`);
  if (typeof candidate !== 'function') {
    const exported = Object.keys(mod || {}).join(', ') || '(no exports)';
    throw new TypeError(
      `[Mobile:${name}] argument handler must be a function. ` +
      `Expected an Express Router/middleware, but got "${typeof candidate}". ` +
      `Available exports: ${exported}. ` +
      `Make sure the file exports either "export default router" or "export const router = express.Router()".`
    );
  }
  return candidate;
};

const login = await loadRouter('login');
const leads = await loadRouter('leads');
const email_campaign = await loadRouter('email-campaign')
const processRouter = await loadRouter('processs')
const internal = await loadRouter('internal')
const masterData = await loadRouter('masterData')
const profile = await loadRouter('profile')
const clients = await loadRouter('clients')
const proposals = await loadRouter('proposals')
const invoices = await loadRouter('invoices')
const demos = await loadRouter('demos')
const dashboard = await loadRouter('dashboard')
const staff = await loadRouter('staff')
const roles = await loadRouter('roles')

// route
router.use("/auth", login);
router.use("/leads", leads)
router.use("/email-campaign", email_campaign)
router.use("/process", processRouter)
router.use("/internal", internal)
router.use("/master-data", masterData)
router.use("/profile", profile)
router.use("/clients", clients)
router.use("/proposals", proposals)
router.use("/invoices", invoices)
router.use("/demos", demos)
router.use("/dashboard", dashboard)
router.use("/staff", staff)
router.use("/roles", roles)

export default router;