import express from 'express';
import { getPublicProposalByHash, publicRespondToProposal } from '../../modules/controllers/V1/proposalController.js';

// No authenticate() here — these are the client-facing, no-login routes
// (proposal accept/decline links sent to leads/clients outside the CRM).
const router = express.Router();

router.get('/proposals/:hash', getPublicProposalByHash);
router.post('/proposals/:hash/respond', publicRespondToProposal);

export default router;
