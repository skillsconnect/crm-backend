import express from 'express';
import {
    getFormData,
    getAllProposals,
    getProposalById,
    createProposal,
    updateProposal,
    deleteProposal,
    updateProposalStatus,
    convertProposalToInvoice,
    downloadProposalPdf,
} from '../../modules/controllers/V1/proposalController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('proposals', 'view');
const create = requirePermission('proposals', 'create');
const edit = requirePermission('proposals', 'edit');
const del = requirePermission('proposals', 'delete');

router.get('/form-data', view, getFormData);
router.get('/', view, getAllProposals);
router.post('/', create, createProposal);
router.get('/:id', view, getProposalById);
router.put('/:id', edit, updateProposal);
router.delete('/:id', del, deleteProposal);

router.patch('/:id/status', edit, updateProposalStatus);
router.post('/:id/convert-to-invoice', edit, convertProposalToInvoice);
router.get('/:id/pdf', view, downloadProposalPdf);

export default router;
