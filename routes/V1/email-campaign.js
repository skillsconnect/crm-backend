import Router from "express";
import {
    getAllTemplates,
    getTemplateById,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getAllSenders,
    getSenderById,
    createSender,
    updateSender,
    deleteSender,
    getAllMailingLists,
    getMailingListById,
    createMailingList,
    updateMailingList,
    deleteMailingList,
    getRecipientsByList,
    addRecipient,
    updateRecipient,
    deleteRecipients,
    getAllCampaigns,
    getCampaignById,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    getCampaignMailingLists,
    getCampaignLogs,
    getCampaignFormData,
    getDashboardStats,
    importCSV,
    getGmailAuthUrl,
    gmailCallback,
    downloadSampleCSV,
    sendDemoEmail,
    previewCampaign,
    getCampaignPreview
} from '../../modules/controllers/V1/email-campaign.js';

import { uploadCSV, parseCSV, validateCSV } from '../../middlewares/csvMiddleware.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = Router();

// This router previously had no authenticate()/requirePermission() at all —
// every endpoint (including raw-SQL-backed filters and CSV import) was
// reachable by anyone on the internet with no login. gmailCallback is the one
// deliberate exception: Google's redirect back here is a cross-site
// top-level navigation, so the authToken cookie (SameSite=Strict) never
// arrives — it authorizes itself instead via a signed `state` (see
// signOAuthState/verifyOAuthState in the controller).
router.use((req, res, next) => {
    if (req.path === '/gmail/callback') return next();
    return authenticate()(req, res, next);
});

const view = requirePermission('email_campaign', 'view');
const create = requirePermission('email_campaign', 'create');
const edit = requirePermission('email_campaign', 'edit');
const del = requirePermission('email_campaign', 'delete');

router.get('/templates', view, getAllTemplates);
router.get('/templates/:templateId', view, getTemplateById);
router.post('/templates', create, createTemplate);
router.put('/templates/:templateId', edit, updateTemplate);
router.delete('/templates/:templateId', del, deleteTemplate);

router.get('/senders', view, getAllSenders);
router.get('/senders/:senderId', view, getSenderById);
router.post('/senders', create, createSender);
router.put('/senders/:senderId', edit, updateSender);
router.delete('/senders/:senderId', del, deleteSender);

router.get('/mailing-lists', view, getAllMailingLists);
router.get('/mailing-lists/:listId', view, getMailingListById);
router.post('/mailing-lists', create, createMailingList);
router.put('/mailing-lists/:listId', edit, updateMailingList);
router.delete('/mailing-lists/:listId', del, deleteMailingList);

router.get('/mailing-lists/:listId/recipients', view, getRecipientsByList);
router.post('/mailing-lists/:listId/recipients', create, addRecipient);
router.put('/recipients/:recipientId', edit, updateRecipient);
router.delete('/recipients', del, deleteRecipients);
router.post('/import', create, uploadCSV, parseCSV, validateCSV, importCSV);

router.get('/campaigns', view, getAllCampaigns);
router.get('/campaigns/:campaignId', view, getCampaignById);
router.post('/campaigns', create, createCampaign);
router.put('/campaigns/:campaignId', edit, updateCampaign);
router.delete('/campaigns/:campaignId', del, deleteCampaign);

router.get('/campaigns/:campaignId/mailing-lists', view, getCampaignMailingLists);
router.get('/logs', view, getCampaignLogs);
router.get('/form-data', view, getCampaignFormData);
router.get('/dashboard-stats', view, getDashboardStats);

// ==================== GMAIL ROUTES (NEW) ====================
router.get('/gmail/auth-url/:senderId', edit, getGmailAuthUrl);
router.get('/gmail/callback', gmailCallback); // unauthenticated by necessity — see note above

// Preview & Demo Email Routes
router.get('/campaigns/:campaignId/preview', view, getCampaignPreview);
router.post('/campaigns/:campaignId/preview', view, previewCampaign);
router.post('/campaigns/:campaignId/send-demo', edit, sendDemoEmail);
router.get('/download-sample-csv', view, downloadSampleCSV);

export default router;
