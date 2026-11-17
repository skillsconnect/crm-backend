import express from 'express';
import {
    getAllClients,
    getClientById,
    createClient,
    updateClient,
    deleteClient,
    addClientContact,
    deleteClientContact,
    getClientOptions,
} from '../../modules/controllers/V1/clientController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('clients', 'view');
const create = requirePermission('clients', 'create');
const edit = requirePermission('clients', 'edit');
const del = requirePermission('clients', 'delete');

router.get('/options', view, getClientOptions);
router.get('/', view, getAllClients);
router.post('/', create, createClient);
router.get('/:id', view, getClientById);
router.put('/:id', edit, updateClient);
router.delete('/:id', del, deleteClient);

router.post('/:id/contacts', edit, addClientContact);
router.delete('/:id/contacts/:contactId', edit, deleteClientContact);

export default router;
