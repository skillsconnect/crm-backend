import fs from 'fs';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import axios from 'axios';

/*
 * Business-card field extraction.
 *
 * Provider is chosen with BUSINESS_CARD_AI_PROVIDER ("nvidia" | "azure").
 * Default is NVIDIA NIM (Nemotron, a text LLM) — it works on Tesseract OCR text.
 * Azure OpenAI (GPT-4o vision) reads the card images directly and can be turned
 * on later by setting BUSINESS_CARD_AI_PROVIDER=azure. Whichever is primary, the
 * other is tried as a fallback, then a plain regex parse of the OCR text.
 *
 * NOTE: the API keys below are inline fallbacks matching this repo's existing
 * convention — prefer setting them via environment variables and rotating them.
 */

// --- NVIDIA NIM (default) --------------------------------------------------
const NVIDIA_API_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY
    || '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';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

// --- Azure OpenAI (opt-in) ----------------------------------------------------
const AZURE_OPENAI_URL = process.env.AZURE_OPENAI_URL
    || 'https://skills-ai.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-15-preview';
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || '3089c6a3603d4514ba45e52a50208de8';

const CARD_PROVIDER = (process.env.BUSINESS_CARD_AI_PROVIDER || 'nvidia').toLowerCase();

const CARD_SYSTEM_PROMPT = `You extract structured contact details from a business card.
The input is either photo(s) of the card or OCR-extracted text, and may contain BOTH sides of the SAME card (e.g. name/phone on one side, address on the other) - merge everything into ONE record.
Return ONLY a valid JSON object with EXACTLY these keys, using an empty string when a field is genuinely absent (never guess):
{"name":"","position":"","company":"","phone":"","email":"","website":"","address":"","city":"","state":"","country":"","pin_code":""}
Rules:
- name: the person's full name only - not the company, not a tagline/slogan, not logo text.
- position: job title / designation only.
- company: the organisation name, cleaned of OCR noise; keep legal suffixes like "Pvt. Ltd.".
- phone: primary number first; include country code as +<code> when shown; comma-separate multiple numbers.
- email: lowercase; comma-separate multiple.
- website: full URL including https://.
- address: street address on a single line WITHOUT the city, state, country or pin code.
- city, state, country: full names.
- pin_code: postal / ZIP digits only.
Fix obvious OCR character errors (e.g. "Senlor" -> "Senior", "EQUIPMETS" -> "EQUIPMENTS").`;

// Pull the first well-formed JSON object out of an LLM reply (handles ```json
// fences and any surrounding prose).
const extractJsonFromText = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const text = raw.replace(/```json/gi, '').replace(/```/g, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
};

const normalizeCard = (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
    return {
        name: str(parsed.name),
        position: str(parsed.position),
        company: str(parsed.company),
        phone: str(parsed.phone),
        email: str(parsed.email).toLowerCase(),
        website: str(parsed.website),
        address: str(parsed.address),
        city: str(parsed.city),
        state: str(parsed.state),
        country: str(parsed.country),
        pin_code: str(parsed.pin_code),
    };
};

const hasCoreFields = (c) => !!(c && (c.name || c.company || c.phone || c.email));

class OCRService {

    /**
     * NVIDIA NIM path (default). Nemotron is a TEXT model, so this runs on the
     * combined Tesseract OCR text of the card image(s). Returns null on failure.
     */
    static async extractWithNvidia(ocrText) {
        const text = (ocrText || '').trim();
        if (text.length < 8) return null;
        if (!NVIDIA_API_KEY) {
            console.error('NVIDIA NIM not configured (set NVIDIA_API_KEY)');
            return null;
        }

        try {
            const response = await axios.post(
                NVIDIA_API_URL,
                {
                    model: NVIDIA_MODEL,
                    messages: [
                        { role: 'system', content: CARD_SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: `Business card OCR text (may contain character errors; may include both sides):\n\n${text.substring(0, 6000)}`,
                        },
                    ],
                    temperature: 0.2,
                    top_p: 0.9,
                    max_tokens: 1200,
                    stream: false,
                    // Nemotron is a reasoning model — disabling thinking skips the
                    // reasoning-token pass, unnecessary for direct text -> JSON.
                    chat_template_kwargs: { enable_thinking: false },
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        Authorization: `Bearer ${NVIDIA_API_KEY}`,
                    },
                    timeout: 45000,
                }
            );

            const raw = response?.data?.choices?.[0]?.message?.content;
            return normalizeCard(extractJsonFromText(raw));
        } catch (error) {
            console.error('NVIDIA business card extraction failed:',
                error?.response?.data?.error?.message || JSON.stringify(error?.response?.data) || error.message);
            return null;
        }
    }

    /**
     * Azure OpenAI (GPT-4o vision) path. Sends the card image(s) straight to the
     * model — no OCR step. Enabled via BUSINESS_CARD_AI_PROVIDER=azure (or used
     * as the fallback when NVIDIA is primary). Returns null on failure.
     */
    static async extractWithAzure(filePaths = []) {
        const paths = (filePaths || []).filter((p) => p && fs.existsSync(p));
        if (!paths.length || !AZURE_OPENAI_KEY) return null;

        try {
            const imageParts = [];
            for (const p of paths) {
                const buffer = await sharp(p)
                    .rotate()
                    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                imageParts.push({
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}`, detail: 'high' },
                });
            }

            const response = await axios.post(
                AZURE_OPENAI_URL,
                {
                    messages: [
                        { role: 'system', content: CARD_SYSTEM_PROMPT },
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: 'Extract the contact details from this business card.' },
                                ...imageParts,
                            ],
                        },
                    ],
                    temperature: 0,
                    max_tokens: 700,
                },
                { headers: { 'Content-Type': 'application/json', 'api-key': AZURE_OPENAI_KEY }, timeout: 45000 }
            );

            const raw = response?.data?.choices?.[0]?.message?.content;
            return normalizeCard(extractJsonFromText(raw));
        } catch (error) {
            console.error('Azure business card extraction failed:',
                error?.response?.data?.error?.message || error.message);
            return null;
        }
    }

    /**
     * Orchestrator used by the controller. Runs the configured provider first,
     * the other one as a fallback, then a regex parse of the OCR text.
     * Returns { parsed, source } where source is "nvidia" | "azure" | "ocr".
     */
    static async extractCardData(filePaths = []) {
        const paths = (filePaths || []).filter((p) => p && fs.existsSync(p));
        if (!paths.length) return { parsed: {}, source: null };

        // OCR text — needed by the NVIDIA path and the regex fallback. Run once.
        let ocrTextCache = null;
        const getOcrText = async () => {
            if (ocrTextCache !== null) return ocrTextCache;
            const texts = [];
            for (const p of paths) texts.push(await OCRService.extractFromImage(p));
            ocrTextCache = texts.filter((t) => t && t.trim()).join('\n');
            return ocrTextCache;
        };

        const runners = {
            nvidia: async () => OCRService.extractWithNvidia(await getOcrText()),
            azure: () => OCRService.extractWithAzure(paths),
        };
        const order = CARD_PROVIDER === 'azure' ? ['azure', 'nvidia'] : ['nvidia', 'azure'];

        let best = null;
        let bestSource = null;
        for (const name of order) {
            let parsed = null;
            try {
                parsed = await runners[name]();
            } catch (error) {
                console.error(`Business card extraction via ${name} failed:`, error.message);
            }
            if (hasCoreFields(parsed)) return { parsed, source: name };
            if (parsed && !best) {
                best = parsed;
                bestSource = name;
            }
        }

        if (best) return { parsed: best, source: bestSource };

        const regex = OCRService.extractStructuredData(await getOcrText()) || {};
        return { parsed: regex, source: 'ocr' };
    }


    static async extractFromImage(filePath) {
        try {
            console.log("Processing image with OCR...");
            
            // Preprocess for OCR. A hard threshold() was destroying anti-aliased
            // and low-contrast text on real cards, so keep it to a gentle
            // grayscale + contrast stretch + sharpen at a higher resolution.
            const processedPath = filePath + '_processed.png';

            await sharp(filePath)
                .rotate() // honour EXIF orientation
                .resize(2200, null, { fit: 'inside', withoutEnlargement: false })
                .grayscale()
                .normalize()
                .sharpen()
                .toFile(processedPath);

            const worker = await createWorker('eng');

            await worker.setParameters({
                // No char whitelist — cards use ',', ':', '&', '#', "'" etc.
                tessedit_pageseg_mode: '3', // fully automatic page segmentation
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