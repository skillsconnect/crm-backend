import fs from 'fs';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

class OCRService {
    
    static async extractFromImage(filePath) {
        try {
            console.log("Processing image with OCR...");
            
            // Better image preprocessing for higher accuracy
            const processedPath = filePath + '_processed.png';
            
            await sharp(filePath)
                .resize(1600, null, { fit: 'inside' }) // Higher resolution
                .grayscale()
                .normalize()
                .sharpen()
                .threshold(128) // Convert to B&W for better contrast
                .toFile(processedPath);
            
            // Use English + additional language for better recognition
            const worker = await createWorker('eng');
            
            // Set tessedit character whitelist for better accuracy
            await worker.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@._+-/() ',
                tessedit_pageseg_mode: '6', // Treat image as uniform block of text
            });
            
            const { data } = await worker.recognize(processedPath);
            await worker.terminate();
            
            // Cleanup
            if (fs.existsSync(processedPath)) {
                fs.unlinkSync(processedPath);
            }
            
            console.log("OCR text length:", data.text.length);
            console.log("OCR Raw Text:", data.text);
            return data.text;
        } catch (error) {
            console.error("OCR error:", error.message);
            return "";
        }
    }
    
    static extractStructuredData(text) {
        const data = {};
        
        if (!text || text.trim().length === 0) {
            return data;
        }
        
        console.log("Extracting data from text...");
        console.log("Text to parse:", text);
        
        // 1. EMAIL - Multiple patterns
        const emailPatterns = [
            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
            /[a-zA-Z0-9._%+-]+\s*@\s*[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,}/,
        ];
        
        for (const pattern of emailPatterns) {
            const emailMatch = text.match(pattern);
            if (emailMatch) {
                data.email = emailMatch[0].replace(/\s/g, '');
                console.log("Email found:", data.email);
                break;
            }
        }
        
        // 2. PHONE - Multiple Indian phone patterns
        const phonePatterns = [
            /(?:\+91|0)?[-\s]?[6-9]\d{9}/,                    // +91 9876543210
            /[6-9]\d{9}/,                                     // 9876543210
            /\+\d{2}[-\s]?\d{10}/,                            // +919876543210
            /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,           // (123) 456-7890
        ];
        
        for (const pattern of phonePatterns) {
            const phoneMatch = text.match(pattern);
            if (phoneMatch) {
                let phone = phoneMatch[0].replace(/[-\s]/g, '');
                if (!phone.startsWith('+') && phone.length === 10) {
                    phone = '+91' + phone;
                }
                if (phone.length >= 10 && phone.length <= 13) {
                    data.phone = phone;
                    console.log("Phone found:", data.phone);
                    break;
                }
            }
        }
        
        // 3. NAME - Look for name patterns (usually at top, capitalized)
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        
        // First, try to find name in the first 3 lines
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            let line = lines[i].trim();
            
            // Clean the line
            line = line.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
            
            if (line.length < 3 || line.length > 50) continue;
            
            // Skip lines that look like emails, phones, or websites
            if (line.includes('@') || line.match(/\d{5,}/) || line.includes('www.')) continue;
            
            const words = line.split(/\s+/);
            
            // Name should have 2-4 words, all starting with capital letters
            let allCapitalized = true;
            for (const word of words) {
                if (word.length > 0 && word[0] !== word[0].toUpperCase()) {
                    allCapitalized = false;
                    break;
                }
            }
            
            if (allCapitalized && words.length >= 2 && words.length <= 4) {
                data.name = line;
                data.firstName = words[0];
                data.lastName = words[words.length - 1];
                console.log("Name found:", data.name);
                break;
            }
        }
        
        // 4. POSITION/TITLE - Look for job titles
        const positionKeywords = [
            'manager', 'director', 'lead', 'head', 'officer', 'executive', 
            'engineer', 'analyst', 'consultant', 'specialist', 'hr', 'ceo', 
            'cto', 'cfo', 'president', 'vp', 'supervisor', 'coordinator',
            'architect', 'developer', 'designer', 'marketing', 'sales',
            'administrator', 'assistant', 'associate', 'chief'
        ];
        
        // Also look for common title patterns
        const positionPatterns = [
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Manager|Director|Lead|Head))/i,
            /(?:Sr\.?|Senior|Jr\.?|Junior|Lead|Head|Chief)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:at|of|for)\s+[A-Z]/i,
        ];
        
        // Try patterns first
        for (const pattern of positionPatterns) {
            const match = text.match(pattern);
            if (match) {
                data.position = match[1] || match[0];
                data.position = data.position.trim();
                console.log("Position found (pattern):", data.position);
                break;
            }
        }
        
        // If no position found, try keyword search
        if (!data.position) {
            for (const keyword of positionKeywords) {
                const regex = new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*\\s+${keyword})`, 'i');
                const match = text.match(regex);
                if (match) {
                    data.position = match[1].trim();
                    console.log("Position found (keyword):", data.position);
                    break;
                }
            }
        }
        
        // 5. COMPANY - Look for company names
        const companyKeywords = [
            'pvt', 'ltd', 'limited', 'technologies', 'solutions', 'systems', 
            'enterprises', 'group', 'industries', 'corp', 'inc', 'llc', 
            'company', 'organization', 'firm', 'consulting', 'services',
            'software', 'digital', 'global', 'international', 'ventures'
        ];
        
        const companyPatterns = [
            /(?:at|with|for)\s+([A-Z][A-Za-z0-9\s&]{2,50}(?:Technologies|Solutions|Systems|Corp|Inc|Ltd|LLC))/i,
            /(?:Company|Organization|Firm):\s*([A-Z][A-Za-z0-9\s&]{2,50})/i,
            /([A-Z][A-Za-z0-9\s&]{2,50}(?:Pvt\.?\s*Ltd\.?|Limited|Technologies|Solutions))/i,
        ];
        
        // Try patterns first
        for (const pattern of companyPatterns) {
            const match = text.match(pattern);
            if (match) {
                data.company = match[1].trim();
                console.log("Company found (pattern):", data.company);
                break;
            }
        }
        
        // If no company found, try keyword search
        if (!data.company) {
            for (const keyword of companyKeywords) {
                const regex = new RegExp(`([A-Z][A-Za-z0-9\\s&]{2,50}${keyword})`, 'i');
                const match = text.match(regex);
                if (match && match[1].length < 60) {
                    data.company = match[1].trim();
                    console.log("Company found (keyword):", data.company);
                    break;
                }
            }
        }
        
        // 6. WEBSITE
        const websiteMatch = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[a-zA-Z0-9-]*)*/);
        if (websiteMatch) {
            let website = websiteMatch[0];
            if (!website.startsWith('http')) {
                website = 'https://' + website;
            }
            data.website = website;
            console.log("Website found:", data.website);
        }
        
        // 7. ADDRESS (Street, City, etc.)
        const addressPatterns = [
            /\d+[^,\n]+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Drive|Dr|Boulevard|Blvd)/i,
            /(?:Address|Location):\s*([^,\n]+(?:,\s*[^,\n]+){0,2})/i,
        ];
        
        for (const pattern of addressPatterns) {
            const match = text.match(pattern);
            if (match) {
                data.address = (match[1] || match[0]).trim();
                console.log("Address found:", data.address);
                break;
            }
        }
        
        // 8. CITY
        const cities = ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 
                        'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Nagpur', 'Indore'];
        for (const city of cities) {
            if (text.includes(city)) {
                data.city = city;
                console.log("City found:", data.city);
                break;
            }
        }
        
        // 9. If still no city, try pattern
        if (!data.city) {
            const cityMatch = text.match(/City:\s*([A-Za-z\s]+)/i);
            if (cityMatch) {
                data.city = cityMatch[1].trim();
                console.log("City found (pattern):", data.city);
            }
        }
        
        console.log("Final extracted data:", data);
        return data;
    }
}

export default OCRService;