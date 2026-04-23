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

export default router;