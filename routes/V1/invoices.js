import express from 'express';
import {
    getFormData,
    getAllInvoices,
    getInvoiceById,
    createInvoice,
    updateInvoice,
    deleteInvoice,
    markInvoiceSent,
    addPayment,
    deletePayment,
    downloadInvoicePdf,
    getRecurringInvoiceTemplates,
    runRecurringInvoicesNow,
} from '../../modules/controllers/V1/invoiceController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('invoices', 'view');
const create = requirePermission('invoices', 'create');
const edit = requirePermission('invoices', 'edit');
const del = requirePermission('invoices', 'delete');

router.get('/form-data', view, getFormData);

// Before /:id — otherwise "recurring" would be parsed as an invoice id.
router.get('/recurring/templates', view, getRecurringInvoiceTemplates);
router.post('/recurring/run-now', edit, runRecurringInvoicesNow);

router.get('/', view, getAllInvoices);
router.post('/', create, createInvoice);
router.get('/:id', view, getInvoiceById);
router.put('/:id', edit, updateInvoice);
router.delete('/:id', del, deleteInvoice);

router.patch('/:id/send', edit, markInvoiceSent);
router.get('/:id/pdf', view, downloadInvoicePdf);

router.post('/:id/payments', edit, addPayment);
router.delete('/:id/payments/:paymentId', edit, deletePayment);

export default router;
