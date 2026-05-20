import multer from 'multer';
import fs from 'fs';
import csv from 'csv-parser';

const upload = multer({ dest: 'uploads/tmp/' });

export const uploadCSV = upload.single('file_csv');

export const parseCSV = (req, res, next) => {
    const results = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            req.parsedCSV = results;
            next();
        })
        .on('error', () => {
            fs.unlinkSync(req.file.path);
            res.status(400).json({ success: false, message: "Invalid CSV file" });
        });
};

export const validateCSV = (req, res, next) => {
    const records = req.parsedCSV;
    
    if (!records || records.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: "CSV file is empty" });
    }
    
    next();
};