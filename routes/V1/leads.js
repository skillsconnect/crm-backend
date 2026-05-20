<<<<<<< HEAD
import Router from 'express';
import multer from 'multer';
import {
	getAllLeads,
	getLeadFormData,
	createLead,
	simulateLeadsImport,
	importLeadsCSV,
	bulkAction,
	markAsLost,
	unmarkAsLost,
	markAsJunk,
	unmarkAsJunk,
	convertToCustomer,
} from '../../modules/controllers/V1/leads.js';
import {
	listLeads,
	getLeadDetail,
	updateLeadRest,
	deleteLeadRest,
	addLeadActivityRest,
	addLeadNoteRest,
	deleteLeadNoteRest,
	listLeadRemindersRest,
	createLeadReminderRest,
	updateLeadReminderRest,
	deleteLeadReminderRest,
	getKanbanBoard,
	updateLeadKanbanStatus,
	bulkActionRest,
	listLeadStatusesRest,
	createLeadStatusRest,
	updateLeadStatusRest,
	deleteLeadStatusRest,
	reorderLeadStatusesRest,
	listLeadSourcesRest,
	createLeadSourceRest,
	updateLeadSourceRest,
	deleteLeadSourceRest,
	listTagsRest,
	createTagRest,
	updateTagRest,
	deleteTagRest,
	assignLeadTagsRest,
	exportLeadsRest,
	ocrBusinessCardRest,
} from '../../modules/controllers/V1/leads-rest.js';
import { uploadCSV, parseCSV } from '../../middlewares/csvMiddleware.js';

const router = Router();
const uploadBusinessCard = multer({ dest: 'uploads/tmp/' }).fields([
	{ name: 'business_card', maxCount: 1 },
	{ name: 'file', maxCount: 1 },
]);

// Legacy endpoints retained for compatibility with existing frontend references.
router.get('/getAllLeads', getAllLeads);
router.post('/bulk_action', async (req, res, next) => {
	try {
		await bulkAction(req, res);
	} catch (err) {
		next(err);
	}
});

// REST list/create/update/delete
router.get('/', listLeads);
router.get('/form-data', getLeadFormData);
router.post('/', createLead);
router.get('/export', exportLeadsRest);

// Kanban
router.get('/kanban', getKanbanBoard);

// Import/Export
router.post('/import/simulate', uploadCSV, parseCSV, simulateLeadsImport);
router.post('/import', uploadCSV, parseCSV, importLeadsCSV);

// OCR + AI business card extraction
router.post('/ocr/business-card', uploadBusinessCard, ocrBusinessCardRest);

// Bulk actions
router.post('/bulk-actions', bulkActionRest);

// Master: statuses
router.get('/statuses', listLeadStatusesRest);
router.post('/statuses', createLeadStatusRest);
router.patch('/statuses/order', reorderLeadStatusesRest);
router.put('/statuses/:statusId', updateLeadStatusRest);
router.delete('/statuses/:statusId', deleteLeadStatusRest);

// Master: sources
router.get('/sources', listLeadSourcesRest);
router.post('/sources', createLeadSourceRest);
router.put('/sources/:sourceId', updateLeadSourceRest);
router.delete('/sources/:sourceId', deleteLeadSourceRest);

// Master: tags
router.get('/tags', listTagsRest);
router.post('/tags', createTagRest);
router.put('/tags/:tagId', updateTagRest);
router.delete('/tags/:tagId', deleteTagRest);

// Lead detail panel resources
router.get('/:id', getLeadDetail);
router.put('/:id', updateLeadRest);
router.delete('/:id', deleteLeadRest);
router.post('/:id/activity', addLeadActivityRest);
router.post('/:id/notes', addLeadNoteRest);
router.delete('/:id/notes/:noteId', deleteLeadNoteRest);
router.get('/:id/reminders', listLeadRemindersRest);
router.post('/:id/reminders', createLeadReminderRest);
router.put('/:id/reminders/:reminderId', updateLeadReminderRest);
router.delete('/:id/reminders/:reminderId', deleteLeadReminderRest);
router.post('/:id/tags', assignLeadTagsRest);

// Legacy action mappings converted to REST paths
router.patch('/:id/status', updateLeadKanbanStatus);
router.patch('/:id/lost', markAsLost);
router.patch('/:id/unlost', unmarkAsLost);
router.patch('/:id/junk', markAsJunk);
router.patch('/:id/unjunk', unmarkAsJunk);
router.post('/:id/convert', convertToCustomer);
=======
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import { 
    getAllStatuses,
    getStatusById,
    createStatus,
    updateStatus,
    deleteStatus,
    getAllSources,
    getSourceById,
    createSource,
    updateSource,
    deleteSource,
    getAllLeads,
    getLeadById,
    createLead,
    updateLead,
    deleteLead,
    getLeadSummary,
    bulkDeleteLeads,
    importLeadsCSV,
    exportLeadsCSV,
    getImportTemplate,
    decryptPDF,
    extractFromImageOrPDF
} from '../../modules/controllers/V1/leadController.js';

// ✅ Import process functions
import { 
    assignProcessToLead,
    getLeadProcesses,
    deleteLeadProcess
} from '../../modules/controllers/V1/processController.js';

import { uploadCSV, parseCSV, validateCSV } from '../../middlewares/csvMiddleware.js';

const router = express.Router();

// Ensure upload directory exists
const uploadDir = 'uploads/tmp';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname)
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images and PDF files are allowed'));
        }
    }
});

// ==================== LEAD STATUS ROUTES ====================
router.get('/lead-status', getAllStatuses);
router.get('/lead-status/:id', getStatusById);
router.post('/lead-status', createStatus);
router.put('/lead-status/:id', updateStatus);
router.delete('/lead-status/:id', deleteStatus);

// ==================== LEAD SOURCE ROUTES ====================
router.get('/lead-source', getAllSources);
router.get('/lead-source/:id', getSourceById);
router.post('/lead-source', createSource);
router.put('/lead-source/:id', updateSource);
router.delete('/lead-source/:id', deleteSource);

// ==================== LEAD ROUTES ====================
router.get('/summary', getLeadSummary);
router.get('/', getAllLeads);
router.get('/:id', getLeadById);
router.post('/', createLead);
router.put('/:id', updateLead);
router.delete('/:id', deleteLead);
router.post('/bulk-delete', bulkDeleteLeads);

// ==================== LEAD PROCESS ASSIGNMENT ROUTES ====================
// ✅ ADD THESE ROUTES
router.post('/assign-process', assignProcessToLead);
router.get('/:lead_id/processes', getLeadProcesses);
router.delete('/:lead_id/processes/:process_id', deleteLeadProcess);

// ==================== LEAD IMPORT/EXPORT ====================
router.get('/export/template', getImportTemplate);
router.post('/import', uploadCSV, parseCSV, validateCSV, importLeadsCSV);
router.get('/export/csv', exportLeadsCSV);

// ==================== OCR EXTRACTION ====================
router.post('/extract', upload.single('file'), extractFromImageOrPDF);
router.post('/decrypt-pdf', upload.single('file'), decryptPDF);
>>>>>>> 368cdfcafcf3842b3e88e7e77977738ba1903a89

export default router;