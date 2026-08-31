import db from '../../../config/knex.js';
import { calculateTotals } from '../../../helpers/V1/billing_totals.helper.js';
import { streamBillingDocumentPdf } from '../../../services/pdfDocumentService.js';

const TABLES = {
    CREDIT_NOTES: 'crm_credit_notes',
    ITEMS: 'crm_credit_note_items',
    APPLICATIONS: 'crm_credit_note_applications',
    CLIENTS: 'crm_clients',
    LEADS: 'crm_leads',
    TAX_RATES: 'crm_tax_rates',
    INVOICES: 'crm_invoices',
    INVOICE_PAYMENTS: 'crm_invoice_payments',
};

const currentUserId = (req) => req.user?.id || 1;

const respondError = (res, error, fallbackMessage = "Internal Server Error") => {
    console.error('Error:', error);
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: fallbackMessage });
};

const loadTaxRateMap = async () => {
    const rates = await db(TABLES.TAX_RATES).select('id', 'name', 'rate');
    return new Map(rates.map((r) => [r.id, r]));
};

const withPartyJoins = (qb) => qb
    .leftJoin(`${TABLES.CLIENTS} as c`, 'c.id', 'cn.client_id')
    .leftJoin(`${TABLES.LEADS} as l`, 'l.id', 'cn.lead_id')
    .select('cn.*', 'c.company as client_company', 'l.name as lead_name');

// Draft and Void are explicit, sticky states. Otherwise a credit note is
// Open while untouched, Partially Applied while some but not all of it has
// been used, and Applied once fully consumed.
const deriveStatus = (creditNote) => {
    if (['Draft', 'Void'].includes(creditNote.status)) return creditNote.status;
    const used = Number(creditNote.amount_used);
    const remaining = Number(creditNote.total) - used;
    if (remaining <= 0.01) return 'Applied';
    return used > 0.01 ? 'Partially Applied' : 'Open';
};

export const getFormData = async (req, res) => {
    try {
        const clients = await db(TABLES.CLIENTS).select('id', 'company', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country').where('status', 'Active').orderBy('company', 'asc');
        const leads = await db(TABLES.LEADS).select('id', 'name', 'company', 'email', 'phonenumber').where('is_deleted', false).orderBy('name', 'asc').limit(500);
        const taxRates = await db(TABLES.TAX_RATES).select('*').where('status', 'Active');

        res.status(200).json({ success: true, data: { clients, leads, taxRates } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getAllCreditNotes = async (req, res) => {
    try {
        const { search, status, client_id, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 50, 1);

        let query = withPartyJoins(db(`${TABLES.CREDIT_NOTES} as cn`));
        if (status) query = query.where('cn.status', status);
        if (client_id) query = query.where('cn.client_id', client_id);
        if (search) query = query.where('cn.credit_note_number', 'like', `%${search}%`);

        const totalRow = await query.clone().clearSelect().count('cn.id as total').first();
        const creditNotes = await query.orderBy('cn.id', 'desc').offset((pageNum - 1) * pageSize).limit(pageSize);

        res.status(200).json({
            success: true,
            data: creditNotes || [],
            pagination: { total: Number(totalRow?.total || 0), page: pageNum, limit: pageSize },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getCreditNoteById = async (req, res) => {
    try {
        const { id } = req.params;
        const creditNote = await withPartyJoins(db(`${TABLES.CREDIT_NOTES} as cn`)).where('cn.id', id).first();
        if (!creditNote) return res.status(404).json({ success: false, message: "Credit note not found" });

        const items = await db(TABLES.ITEMS).where('credit_note_id', id).orderBy('item_order', 'asc');
        const taxRateById = await loadTaxRateMap();
        const itemsWithTax = items.map((item) => ({ ...item, tax_name: item.tax_rate_id ? taxRateById.get(Number(item.tax_rate_id))?.name : null }));

        const applications = await db(`${TABLES.APPLICATIONS} as a`)
            .join(`${TABLES.INVOICES} as i`, 'i.id', 'a.invoice_id')
            .where('a.credit_note_id', id)
            .select('a.*', 'i.invoice_number')
            .orderBy('a.applied_date', 'desc');

        res.status(200).json({ success: true, data: { ...creditNote, items: itemsWithTax, applications } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const validateReferencedInvoice = async (invoice_id, client_id, lead_id) => {
    if (!invoice_id) return null;
    const invoice = await db(TABLES.INVOICES).where('id', invoice_id).first();
    if (!invoice) throw Object.assign(new Error('Referenced invoice not found'), { status: 400 });
    const sameClient = client_id && invoice.client_id === Number(client_id);
    const sameLead = lead_id && invoice.lead_id === Number(lead_id);
    if (!sameClient && !sameLead) {
        throw Object.assign(new Error('Referenced invoice does not belong to the selected client/lead'), { status: 400 });
    }
    return invoice;
};

const buildCreditNotePayload = async (body) => {
    const { client_id, lead_id, invoice_id, currency, discount_type, discount_percent, adjustment, date, notes, assigned, items } = body;

    const validItems = (Array.isArray(items) ? items : []).filter((i) => i.description?.trim());
    for (const item of validItems) {
        if (!(Number(item.qty) > 0)) {
            throw Object.assign(new Error(`Quantity must be greater than zero for item "${item.description.trim()}"`), { status: 400 });
        }
        if (Number(item.rate) < 0) {
            throw Object.assign(new Error(`Rate must be valid for item "${item.description.trim()}"`), { status: 400 });
        }
    }
    if (!validItems.length) {
        throw Object.assign(new Error('At least one line item is required'), { status: 400 });
    }

    await validateReferencedInvoice(invoice_id, client_id, lead_id);

    const taxRateById = await loadTaxRateMap();
    const totals = calculateTotals(validItems, { discount_type, discount_percent, adjustment }, taxRateById);

    return {
        record: {
            client_id: client_id || null,
            lead_id: lead_id || null,
            invoice_id: invoice_id || null,
            currency: currency || 'INR',
            discount_type: discount_type || null,
            discount_percent: discount_percent || 0,
            discount_total: totals.discount_total,
            total_tax: totals.total_tax,
            subtotal: totals.subtotal,
            adjustment: adjustment || 0,
            total: totals.total,
            date: date || new Date().toISOString().slice(0, 10),
            notes: notes || null,
            assigned: assigned || null,
        },
        items: validItems,
    };
};

export const createCreditNote = async (req, res) => {
    try {
        if (!req.body.client_id && !req.body.lead_id) {
            return res.status(400).json({ success: false, message: "A client or a lead is required" });
        }

        const { record, items } = await buildCreditNotePayload(req.body);
        record.assigned = record.assigned || currentUserId(req);
        record.created_by = currentUserId(req);
        record.updated_by = currentUserId(req);
        record.status = req.body.status === 'Draft' ? 'Draft' : 'Open';

        const creditNoteId = await db.transaction(async (trx) => {
            const lastNote = await trx(TABLES.CREDIT_NOTES).orderBy('id', 'desc').first();
            const nextNumber = (lastNote ? lastNote.id : 0) + 1;
            record.credit_note_number = `CN-${String(nextNumber).padStart(4, '0')}`;

            const [insertedId] = await trx(TABLES.CREDIT_NOTES).insert(record);
            if (items.length) {
                await trx(TABLES.ITEMS).insert(items.map((item, idx) => ({
                    credit_note_id: insertedId,
                    description: item.description.trim(),
                    long_description: item.long_description || null,
                    qty: item.qty || 1,
                    rate: item.rate || 0,
                    unit: item.unit || null,
                    tax_rate_id: item.tax_rate_id || null,
                    item_order: idx,
                })));
            }
            return insertedId;
        });

        const newCreditNote = await db(TABLES.CREDIT_NOTES).where('id', creditNoteId).first();
        res.status(201).json({ success: true, message: "Credit note created successfully", data: newCreditNote });
    } catch (error) {
        respondError(res, error);
    }
};

export const updateCreditNote = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.CREDIT_NOTES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Credit note not found" });
        if (Number(existing.amount_used) > 0) {
            return res.status(400).json({ success: false, message: "Cannot edit a credit note that has already been applied to an invoice" });
        }

        const { record, items } = await buildCreditNotePayload(req.body);
        record.updated_by = currentUserId(req);
        record.status = deriveStatus({ ...existing, ...record });

        await db.transaction(async (trx) => {
            await trx(TABLES.CREDIT_NOTES).where('id', id).update(record);
            await trx(TABLES.ITEMS).where('credit_note_id', id).del();
            if (items.length) {
                await trx(TABLES.ITEMS).insert(items.map((item, idx) => ({
                    credit_note_id: id,
                    description: item.description.trim(),
                    long_description: item.long_description || null,
                    qty: item.qty || 1,
                    rate: item.rate || 0,
                    unit: item.unit || null,
                    tax_rate_id: item.tax_rate_id || null,
                    item_order: idx,
                })));
            }
        });

        const updated = await db(TABLES.CREDIT_NOTES).where('id', id).first();
        res.status(200).json({ success: true, message: "Credit note updated successfully", data: updated });
    } catch (error) {
        respondError(res, error);
    }
};

export const deleteCreditNote = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.CREDIT_NOTES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Credit note not found" });
        if (existing.status !== 'Draft') {
            return res.status(400).json({ success: false, message: "Only a draft credit note can be deleted — void it instead" });
        }

        await db.transaction(async (trx) => {
            await trx(TABLES.ITEMS).where('credit_note_id', id).del();
            await trx(TABLES.CREDIT_NOTES).where('id', id).del();
        });

        res.status(200).json({ success: true, message: "Credit note deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const voidCreditNote = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.CREDIT_NOTES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Credit note not found" });
        if (existing.status === 'Void') {
            return res.status(400).json({ success: false, message: "This credit note has already been voided" });
        }

        await db(TABLES.CREDIT_NOTES).where('id', id).update({
            status: 'Void',
            voided_by: currentUserId(req),
            voided_on: new Date(),
            updated_by: currentUserId(req),
        });
        res.status(200).json({ success: true, message: "Credit note voided" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== APPLY TO INVOICE ====================
// Applying a credit note both logs an entry here (the credit-note-side
// ledger, crm_credit_note_applications) and records a normal invoice
// payment with payment_mode='Credit Note' — so the invoice's existing
// amount_paid/deriveStatus logic handles the balance with no special case.

export const applyCreditNoteToInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { invoice_id, amount, applied_date } = req.body;

        const applyAmount = Number(amount);
        if (!applyAmount || applyAmount <= 0) {
            return res.status(400).json({ success: false, message: "A positive amount is required" });
        }

        await db.transaction(async (trx) => {
            // Lock both rows for the duration of the transaction so two concurrent
            // apply requests against the same credit note/invoice can't both read
            // stale amount_used/amount_paid and jointly over-apply credit.
            const creditNote = await trx(TABLES.CREDIT_NOTES).where('id', id).forUpdate().first();
            if (!creditNote) throw Object.assign(new Error('Credit note not found'), { status: 404 });
            if (creditNote.status === 'Void') throw Object.assign(new Error('This credit note has been voided'), { status: 400 });
            if (creditNote.status === 'Draft') throw Object.assign(new Error('Finalize this credit note before applying it'), { status: 400 });

            const invoice = await trx(TABLES.INVOICES).where('id', invoice_id).forUpdate().first();
            if (!invoice) throw Object.assign(new Error('Invoice not found'), { status: 404 });

            const creditRemaining = Number(creditNote.total) - Number(creditNote.amount_used);
            if (applyAmount > creditRemaining + 0.01) {
                throw Object.assign(new Error(`Amount exceeds the credit note's remaining balance of ${creditRemaining.toFixed(2)}`), { status: 400 });
            }

            const invoiceRemaining = Number(invoice.total) - Number(invoice.amount_paid);
            if (applyAmount > invoiceRemaining + 0.01) {
                throw Object.assign(new Error(`Amount exceeds the invoice's remaining balance of ${invoiceRemaining.toFixed(2)}`), { status: 400 });
            }

            const [paymentId] = await trx(TABLES.INVOICE_PAYMENTS).insert({
                invoice_id,
                amount: applyAmount,
                payment_mode: 'Credit Note',
                payment_date: applied_date || new Date().toISOString().slice(0, 10),
                note: `Applied from credit note ${creditNote.credit_note_number}`,
                recorded_by: currentUserId(req),
            });

            const newInvoiceAmountPaid = Number(invoice.amount_paid) + applyAmount;
            const invoiceStatus = ['Draft', 'Cancelled'].includes(invoice.status)
                ? invoice.status
                : newInvoiceAmountPaid >= Number(invoice.total) ? 'Paid' : 'Partially Paid';

            await trx(TABLES.INVOICES).where('id', invoice_id).update({
                amount_paid: newInvoiceAmountPaid,
                status: invoiceStatus,
                updated_by: currentUserId(req),
            });

            await trx(TABLES.APPLICATIONS).insert({
                credit_note_id: id,
                invoice_id,
                invoice_payment_id: paymentId,
                amount: applyAmount,
                applied_date: applied_date || new Date().toISOString().slice(0, 10),
                applied_by: currentUserId(req),
            });

            const newAmountUsed = Number(creditNote.amount_used) + applyAmount;
            const newStatus = deriveStatus({ ...creditNote, amount_used: newAmountUsed });
            await trx(TABLES.CREDIT_NOTES).where('id', id).update({
                amount_used: newAmountUsed,
                status: newStatus,
                updated_by: currentUserId(req),
            });
        });

        res.status(201).json({ success: true, message: "Credit note applied to invoice successfully" });
    } catch (error) {
        respondError(res, error);
    }
};

export const downloadCreditNotePdf = async (req, res) => {
    try {
        const { id } = req.params;
        const creditNote = await db(TABLES.CREDIT_NOTES).where('id', id).first();
        if (!creditNote) return res.status(404).json({ success: false, message: "Credit note not found" });

        const items = await db(TABLES.ITEMS).where('credit_note_id', id).orderBy('item_order', 'asc');
        const taxRateById = await loadTaxRateMap();

        let partyName = null;
        if (creditNote.client_id) {
            const client = await db(TABLES.CLIENTS).where('id', creditNote.client_id).first();
            partyName = client?.company;
        } else if (creditNote.lead_id) {
            const lead = await db(TABLES.LEADS).where('id', creditNote.lead_id).first();
            partyName = lead?.name;
        }

        streamBillingDocumentPdf(res, {
            kind: 'credit_note',
            doc: creditNote,
            items,
            taxRateById,
            party: { name: partyName },
        });
    } catch (error) {
        console.error('PDF error:', error);
        res.status(500).json({ success: false, message: "Failed to generate PDF" });
    }
};
