import fs from 'fs';
import PDFParser from 'pdf2json';

class PDFParserService {
    
    static async parsePDF(filePath) {
        return new Promise((resolve, reject) => {
            console.log("=== PDF PARSING STARTED ===");
            console.log("File path:", filePath);
            
            if (!fs.existsSync(filePath)) {
                reject(new Error(`File not found: ${filePath}`));
                return;
            }
            
            const pdfParser = new PDFParser();
            
            pdfParser.on("pdfParser_dataError", errData => {
                console.error('PDF Parse Error:', errData);
                reject(new Error(errData.parserError));
            });
            
            pdfParser.on("pdfParser_dataReady", pdfData => {
                try {
                    // Get text content from PDF
                    let text = '';
                    if (pdfData.Pages) {
                        for (const page of pdfData.Pages) {
                            if (page.Texts) {
                                for (const textItem of page.Texts) {
                                    if (textItem.R) {
                                        for (const line of textItem.R) {
                                            if (line.T) {
                                                text += decodeURIComponent(line.T) + ' ';
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Log the extracted text for debugging
                    console.log("\n=== EXTRACTED TEXT ===");
                    console.log("Full text length:", text.length);
                    console.log("First 1000 characters:");
                    console.log(text.substring(0, 1000));
                    console.log("\n=== END EXTRACTED TEXT ===\n");
                    
                    // If no text found, try raw text extraction
                    if (text.length === 0) {
                        const rawText = pdfParser.getRawTextContent();
                        console.log("Raw text extraction attempt:", rawText.substring(0, 500));
                        text = rawText;
                    }
                    
                    // Try to find common patterns in the text
                    console.log("\n=== PATTERN SEARCH RESULTS ===");
                    
                    // Look for email
                    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    console.log("Email found:", emailMatch ? emailMatch[0] : "NOT FOUND");
                    
                    // Look for phone
                    const phoneMatch = text.match(/[0-9]{10}/);
                    console.log("Phone found:", phoneMatch ? phoneMatch[0] : "NOT FOUND");
                    
                    // Look for name patterns (two capitalized words)
                    const nameMatch = text.match(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/);
                    console.log("Name pattern found:", nameMatch ? nameMatch[0] : "NOT FOUND");
                    
                    // Look for company (words ending with common suffixes)
                    const companyMatch = text.match(/\b([A-Za-z0-9\s]+)(?:Pvt|Ltd|Inc|Corp|Technologies|Solutions)\b/i);
                    console.log("Company pattern found:", companyMatch ? companyMatch[0] : "NOT FOUND");
                    
                    const extractedData = {
                        name: PDFParserService.extractName(text),
                        email: PDFParserService.extractEmail(text),
                        phone: PDFParserService.extractPhone(text),
                        position: PDFParserService.extractPosition(text),
                        company: PDFParserService.extractCompany(text),
                        address: PDFParserService.extractAddress(text),
                        city: PDFParserService.extractCity(text),
                        state: PDFParserService.extractState(text),
                        country: PDFParserService.extractCountry(text),
                        zip_code: PDFParserService.extractZipCode(text),
                        website: PDFParserService.extractWebsite(text),
                        lead_value: PDFParserService.extractLeadValue(text),
                        employee_count: PDFParserService.extractEmployeeCount(text),
                        sector_industry: PDFParserService.extractIndustry(text),
                        tags: PDFParserService.extractTags(text),
                        description: PDFParserService.extractDescription(text),
                        alternate_emails: PDFParserService.extractAlternateEmails(text)
                    };
                    
                    console.log("\n=== FINAL EXTRACTED DATA ===");
                    console.log(JSON.stringify(extractedData, null, 2));
                    
                    resolve(PDFParserService.cleanData(extractedData));
                } catch (error) {
                    console.error("Error processing PDF data:", error);
                    reject(error);
                }
            });
            
            pdfParser.loadPDF(filePath);
        });
    }
    
    static extractEmail(text) {
        const patterns = [
            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
            /Email:?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
            /E-mail:?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const email = match[1] || match[0];
                console.log("Email extracted:", email);
                return email;
            }
        }
        return null;
    }
    
    static extractPhone(text) {
        // Look for 10-digit numbers (Indian phone numbers)
        const patterns = [
            /[6-9][0-9]{9}/,
            /Phone:?\s*([+\d\s\-\(\)]{10,20})/i,
            /Mobile:?\s*([+\d\s\-\(\)]{10,20})/i,
            /Contact:?\s*([+\d\s\-\(\)]{10,20})/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                let phone = (match[1] || match[0]).replace(/[-\s]/g, '');
                phone = phone.replace(/[^0-9+]/g, '');
                if (phone.length === 10) {
                    phone = '+91' + phone;
                }
                if (phone.length >= 10 && phone.length <= 15) {
                    console.log("Phone extracted:", phone);
                    return phone;
                }
            }
        }
        return null;
    }
    
    static extractName(text) {
        // Look for patterns like "Name: John Doe" or just "John Doe" at beginning
        const patterns = [
            /Name:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
            /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/m,
            /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const name = match[1].trim();
                if (name.length < 50 && name.length > 3) {
                    console.log("Name extracted:", name);
                    return name;
                }
            }
        }
        return null;
    }
    
    static extractCompany(text) {
        const patterns = [
            /Company:?\s*([A-Za-z0-9\s&]+)(?:\n|,|$)/i,
            /Organization:?\s*([A-Za-z0-9\s&]+)(?:\n|,|$)/i,
            /\b([A-Z][A-Za-z0-9\s&]{3,50}?(?:Pvt|Ltd|Inc|Corp|Technologies|Solutions|Systems|Enterprises|Group))\b/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const company = match[1].trim();
                if (company.length < 60 && company.length > 2) {
                    console.log("Company extracted:", company);
                    return company;
                }
            }
        }
        return null;
    }
    
    static extractPosition(text) {
        const patterns = [
            /Position:?\s*([A-Za-z\s&]+)(?:\n|,|$)/i,
            /Title:?\s*([A-Za-z\s&]+)(?:\n|,|$)/i,
            /Designation:?\s*([A-Za-z\s&]+)(?:\n|,|$)/i,
            /\b(?:Manager|Director|Head|Lead|Officer|Executive|Engineer|Analyst|Consultant|Specialist|HR|CEO|CTO|CFO|President|VP|Supervisor|Coordinator)\b/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const position = (match[1] || match[0]).trim();
                if (position.length < 50) {
                    console.log("Position extracted:", position);
                    return position;
                }
            }
        }
        return null;
    }
    
    static extractAddress(text) {
        const patterns = [
            /Address:?\s*([^,\n]+(?:,\s*[^,\n]+){0,2})/i,
            /\d+[^,\n]+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Drive|Dr)/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const address = match[1].trim();
                if (address.length > 5) {
                    console.log("Address extracted:", address);
                    return address;
                }
            }
        }
        return null;
    }
    
    static extractCity(text) {
        const cities = ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Nagpur', 'Indore'];
        
        for (const city of cities) {
            if (text.includes(city)) {
                console.log("City extracted:", city);
                return city;
            }
        }
        
        const match = text.match(/City:?\s*([A-Za-z\s]+)/i);
        if (match && match[1]) {
            console.log("City extracted:", match[1].trim());
            return match[1].trim();
        }
        return null;
    }
    
    static extractState(text) {
        const states = ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Telangana', 'West Bengal', 'Gujarat', 'Rajasthan'];
        
        for (const state of states) {
            if (text.includes(state)) {
                console.log("State extracted:", state);
                return state;
            }
        }
        return null;
    }
    
    static extractCountry(text) {
        if (text.includes('India')) return 'India';
        if (text.includes('USA')) return 'USA';
        if (text.includes('UK')) return 'UK';
        return 'India';
    }
    
    static extractZipCode(text) {
        const match = text.match(/\b\d{6}\b/);
        if (match) {
            console.log("Zip code extracted:", match[0]);
            return match[0];
        }
        return null;
    }
    
    static extractWebsite(text) {
        const match = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/);
        if (match) {
            let website = match[0];
            if (!website.startsWith('http')) {
                website = 'https://' + website;
            }
            console.log("Website extracted:", website);
            return website;
        }
        return null;
    }
    
    static extractLeadValue(text) {
        const match = text.match(/₹?\s?(\d{1,3}(?:,\d{3})*)/);
        if (match) {
            const value = parseFloat(match[1].replace(/,/g, ''));
            console.log("Lead value extracted:", value);
            return value;
        }
        return null;
    }
    
    static extractEmployeeCount(text) {
        const match = text.match(/(\d+)\s*(?:employees|staff|people)/i);
        if (match) {
            const count = parseInt(match[1]);
            console.log("Employee count extracted:", count);
            return count;
        }
        return null;
    }
    
    static extractIndustry(text) {
        const industries = ['IT', 'Software', 'Manufacturing', 'Healthcare', 'Banking', 'Finance', 'Retail', 'Education'];
        
        for (const industry of industries) {
            if (text.toLowerCase().includes(industry.toLowerCase())) {
                console.log("Industry extracted:", industry);
                return industry;
            }
        }
        return null;
    }
    
    static extractTags(text) {
        const tags = [];
        const keywords = ['urgent', 'priority', 'hot', 'cold', 'warm'];
        
        for (const keyword of keywords) {
            if (text.toLowerCase().includes(keyword.toLowerCase())) {
                tags.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
            }
        }
        
        return tags.length > 0 ? tags.join(', ') : null;
    }
    
    static extractDescription(text) {
        // Get first 200 characters
        const firstPart = text.substring(0, 200);
        if (firstPart.length > 20) {
            return firstPart.trim();
        }
        return null;
    }
    
    static extractAlternateEmails(text) {
        const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (matches && matches.length > 1) {
            return matches.slice(1).join(', ');
        }
        return null;
    }
    
    static cleanData(data) {
        const cleaned = {};
        for (const [key, value] of Object.entries(data)) {
            if (value && typeof value === 'string') {
                cleaned[key] = value.replace(/\s+/g, ' ').trim();
                if (cleaned[key] === '') cleaned[key] = null;
            } else {
                cleaned[key] = value;
            }
        }
        return cleaned;
    }
}

export default PDFParserService;