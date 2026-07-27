import express from 'express';
import {
    getCountries,
    saveCountry,
    deleteCountry,
    getStates,
    saveState,
    deleteState,
    getCities,
    saveCity,
    deleteCity,
} from '../../modules/controllers/V1/masterDataController.js';
import authenticate from '../../middlewares/Authenticate.js';
import requirePermission from '../../middlewares/requirePermission.js';

const router = express.Router();

router.use(authenticate());

const view = requirePermission('master_data', 'view');
const edit = requirePermission('master_data', 'edit');

router.get('/countries', view, getCountries);
router.post('/countries', edit, saveCountry);
router.put('/countries/:id', edit, saveCountry);
router.delete('/countries/:id', edit, deleteCountry);

router.get('/states', view, getStates);
router.post('/states', edit, saveState);
router.put('/states/:id', edit, saveState);
router.delete('/states/:id', edit, deleteState);

router.get('/cities', view, getCities);
router.post('/cities', edit, saveCity);
router.put('/cities/:id', edit, saveCity);
router.delete('/cities/:id', edit, deleteCity);

export default router;
