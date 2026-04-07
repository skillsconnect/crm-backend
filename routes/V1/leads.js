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

export default router;