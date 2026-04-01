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
    gmailCallback
} from '../../modules/controllers/V1/email-campaign.js';

import { uploadCSV, parseCSV, validateCSV } from '../../middlewares/csvMiddleware.js';

const router = Router();

router.get('/templates', getAllTemplates);
router.get('/templates/:templateId', getTemplateById);
router.post('/templates', createTemplate);
router.put('/templates/:templateId', updateTemplate);
router.delete('/templates/:templateId', deleteTemplate);

router.get('/senders', getAllSenders);
router.get('/senders/:senderId', getSenderById);
router.post('/senders', createSender);
router.put('/senders/:senderId', updateSender);
router.delete('/senders/:senderId', deleteSender);

router.get('/mailing-lists', getAllMailingLists);
router.get('/mailing-lists/:listId', getMailingListById);
router.post('/mailing-lists', createMailingList);
router.put('/mailing-lists/:listId', updateMailingList);
router.delete('/mailing-lists/:listId', deleteMailingList);

router.get('/mailing-lists/:listId/recipients', getRecipientsByList);
router.post('/mailing-lists/:listId/recipients', addRecipient);
router.put('/recipients/:recipientId', updateRecipient);
router.delete('/recipients', deleteRecipients);
router.post('/import', uploadCSV, parseCSV, validateCSV, importCSV);

router.get('/campaigns', getAllCampaigns);
router.get('/campaigns/:campaignId', getCampaignById);
router.post('/campaigns', createCampaign);
router.put('/campaigns/:campaignId', updateCampaign);
router.delete('/campaigns/:campaignId', deleteCampaign);

router.get('/campaigns/:campaignId/mailing-lists', getCampaignMailingLists);
router.get('/logs', getCampaignLogs);
router.get('/form-data', getCampaignFormData);
router.get('/dashboard-stats', getDashboardStats);

// ==================== GMAIL ROUTES (NEW) ====================
router.get('/gmail/auth-url/:senderId', getGmailAuthUrl);
router.get('/gmail/callback', gmailCallback);

export default router;