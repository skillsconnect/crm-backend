import express from 'express';
import multer from 'multer';
import fs from 'fs';
import {
    getAllStatuses,
    getStatusById,
    saveStatus,
    deleteStatus,
    getAllSources,
    getSourceById,
    saveSource,
    deleteSource,
    getAllTags,
    createTag,
    updateTag,
    deleteTag,
    assignLeadTags,
    getSavedFilters,
    createSavedFilter,
    deleteSavedFilter,
    getLeadFormData,
    getAllLeads,
    getLeadsKanban,
    updateLeadKanbanStatus,
    getLeadById,
    createLead,
    updateLead,
    deleteLead,
    bulkActionLeads,
    addLeadNote,
    deleteLeadNote,
    addLeadActivity,
    getLeadReminders,
    addLeadReminder,
    updateLeadReminder,
    deleteLeadReminder,
    markLeadLost,
    unmarkLeadLost,
    markLeadJunk,
    unmarkLeadJunk,
    convertLeadToCustomer,
    simulateLeadsImportCSV,
    importLeadsCSV,
    exportLeadsCSV,
    ocrBusinessCard,
    uploadLeadAttachment,
    downloadLeadAttachment,
    deleteLeadAttachment,
    uploadLeadAudioNote,
    streamLeadAudioNote,
    deleteLeadAudioNote,
} from '../../modules/controllers/V1/leadController.js';

import {
    getCountries,
    getStates,
    getCities,
} from '../../modules/controllers/V1/masterDataController.js';

import { uploadCSV, parseCSV, validateCSV } from '../../middlewares/csvMiddleware.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

// Every route in this router is CRM-staff-only.
router.use(authenticate());

const view = requirePermission('leads', 'view');
const create = requirePermission('leads', 'create');
const edit = requirePermission('leads', 'edit');
const del = requirePermission('leads', 'delete');

const businessCardDir = 'uploads/business_cards';
if (!fs.existsSync(businessCardDir)) {
    fs.mkdirSync(businessCardDir, { recursive: true });
}

const businessCardStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, businessCardDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    },
});

const uploadBusinessCard = multer({
    storage: businessCardStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (allowedTypes.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only image files are allowed'));
    },
});

// Attachments and audio notes are held in memory just long enough to stream
// straight to Azure Blob Storage — no local uploads/ directory for these two.
const uploadAttachment = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
});

const uploadAudioNote = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if ((file.mimetype || '').startsWith('audio/')) cb(null, true);
        else cb(new Error('Only audio files are allowed'));
    },
});

// ==================== LEAD FORM DATA ====================
router.get('/form-data', view, getLeadFormData);

// ==================== LOCATION LOOKUPS ====================
// Read-only proxies to the shared master-data reference tables so the lead
// add/edit form can drive dependent country -> state -> city dropdowns
// without requiring the separate master_data:view permission.
router.get('/locations/countries', view, getCountries);
router.get('/locations/states', view, getStates);
router.get('/locations/cities', view, getCities);

// ==================== LEAD STATUS ROUTES ====================
router.get('/statuses', view, getAllStatuses);
router.get('/statuses/:id', view, getStatusById);
router.post('/statuses', edit, saveStatus);
router.put('/statuses/:id', edit, saveStatus);
router.delete('/statuses/:id', edit, deleteStatus);

// ==================== LEAD SOURCE ROUTES ====================
router.get('/sources', view, getAllSources);
router.get('/sources/:id', view, getSourceById);
router.post('/sources', edit, saveSource);
router.put('/sources/:id', edit, saveSource);
router.delete('/sources/:id', edit, deleteSource);

// ==================== LEAD TAGS ====================
router.get('/tags', view, getAllTags);
router.post('/tags', edit, createTag);
router.put('/tags/:tagId', edit, updateTag);
router.delete('/tags/:tagId', edit, deleteTag);

// ==================== LEAD KANBAN (before /:id routes) ====================
router.get('/kanban', view, getLeadsKanban);

// ==================== LEAD SAVED FILTERS (before /:id routes) ====================
// Personal to the logged-in user — no feature permission needed beyond login.
router.get('/saved-filters', getSavedFilters);
router.post('/saved-filters', createSavedFilter);
router.delete('/saved-filters/:id', deleteSavedFilter);

// ==================== LEAD IMPORT/EXPORT (before /:id routes) ====================
router.post('/import/simulate', create, uploadCSV, parseCSV, validateCSV, simulateLeadsImportCSV);
router.post('/import', create, uploadCSV, parseCSV, validateCSV, importLeadsCSV);
router.get('/export', view, exportLeadsCSV);

// ==================== OCR ====================
// Up to 2 images — a business card may be photographed front and back.
router.post('/ocr/business-card', create, uploadBusinessCard.array('business_card', 2), ocrBusinessCard);

// ==================== LEAD BULK ACTIONS ====================
router.post('/bulk-actions', edit, bulkActionLeads);

// ==================== LEAD CRUD ====================
router.get('/', view, getAllLeads);
router.post('/', create, createLead);
router.get('/:id', view, getLeadById);
router.put('/:id', edit, updateLead);
router.delete('/:id', del, deleteLead);

// ==================== LEAD DETAIL SUB-RESOURCES ====================
router.patch('/:id/status', edit, updateLeadKanbanStatus);
router.post('/:id/activity', edit, addLeadActivity);
router.post('/:id/notes', edit, addLeadNote);
router.delete('/:id/notes/:noteId', edit, deleteLeadNote);
router.get('/:id/reminders', view, getLeadReminders);
router.post('/:id/reminders', edit, addLeadReminder);
router.put('/:id/reminders/:reminderId', edit, updateLeadReminder);
router.delete('/:id/reminders/:reminderId', edit, deleteLeadReminder);
router.patch('/:id/lost', edit, markLeadLost);
router.patch('/:id/unlost', edit, unmarkLeadLost);
router.patch('/:id/junk', edit, markLeadJunk);
router.patch('/:id/unjunk', edit, unmarkLeadJunk);
router.post('/:id/convert', edit, convertLeadToCustomer);
router.post('/:id/tags', edit, assignLeadTags);

// ==================== LEAD ATTACHMENTS ====================
router.post('/:id/attachments', edit, uploadAttachment.single('file'), uploadLeadAttachment);
router.get('/:id/attachments/:attachmentId/download', view, downloadLeadAttachment);
router.delete('/:id/attachments/:attachmentId', edit, deleteLeadAttachment);

// ==================== LEAD AUDIO NOTES ====================
router.post('/:id/audio-notes', edit, uploadAudioNote.single('audio'), uploadLeadAudioNote);
router.get('/:id/audio-notes/:audioId/stream', view, streamLeadAudioNote);
router.delete('/:id/audio-notes/:audioId', edit, deleteLeadAudioNote);

export default router;
