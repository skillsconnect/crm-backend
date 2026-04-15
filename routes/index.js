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
const processRouter = await loadRouter('process');

// route 
router.use("/auth", login);
router.use("/leads", leads)
router.use("/email-campaign", email_campaign)
router.use("/process", processRouter)

export default router;