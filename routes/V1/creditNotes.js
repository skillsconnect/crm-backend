import express from 'express';
import {
    getFormData,
    getAllCreditNotes,
    getCreditNoteById,
    createCreditNote,
    updateCreditNote,
    deleteCreditNote,
    voidCreditNote,
    applyCreditNoteToInvoice,
    downloadCreditNotePdf,
} from '../../modules/controllers/V1/creditNoteController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('credit_notes', 'view');
const create = requirePermission('credit_notes', 'create');
const edit = requirePermission('credit_notes', 'edit');
const del = requirePermission('credit_notes', 'delete');

router.get('/form-data', view, getFormData);
router.get('/', view, getAllCreditNotes);
router.post('/', create, createCreditNote);
router.get('/:id', view, getCreditNoteById);
router.put('/:id', edit, updateCreditNote);
router.delete('/:id', del, deleteCreditNote);

router.patch('/:id/void', edit, voidCreditNote);
router.post('/:id/apply', edit, applyCreditNoteToInvoice);
router.get('/:id/pdf', view, downloadCreditNotePdf);

export default router;
