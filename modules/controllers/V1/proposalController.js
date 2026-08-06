import crypto from 'crypto';
import db from '../../../config/knex.js';
import { calculateTotals } from '../../../helpers/V1/billing_totals.helper.js';
import { streamBillingDocumentPdf } from '../../../services/pdfDocumentService.js';

const TABLES = {
    PROPOSALS: 'crm_proposals',
    ITEMS: 'crm_proposal_items',
    CLIENTS: 'crm_clients',
    LEADS: 'crm_leads',
    TAX_RATES: 'crm_tax_rates',
    INVOICES: 'crm_invoices',
    INVOICE_ITEMS: 'crm_invoice_items',
};

const currentUserId = (req) => req.user?.id || 1;

const loadTaxRateMap = async () => {
    const rates = await db(TABLES.TAX_RATES).select('id', 'name', 'rate');
    return new Map(rates.map((r) => [r.id, r]));
};

const withPartyJoins = (qb) => qb
    .leftJoin(`${TABLES.CLIENTS} as c`, 'c.id', 'p.client_id')
    .leftJoin(`${TABLES.LEADS} as l`, 'l.id', 'p.lead_id')
    .select('p.*', 'c.company as client_company', 'l.name as lead_name');

export const getFormData = async (req, res) => {
    try {
        const clients = await db(TABLES.CLIENTS).select('id', 'company', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country').where('status', 'Active').orderBy('company', 'asc');
        const leads = await db(TABLES.LEADS).select('id', 'name', 'company', 'email', 'phonenumber', 'address', 'city', 'state', 'zip', 'country').where('is_deleted', false).orderBy('name', 'asc').limit(500);
        const taxRates = await db(TABLES.TAX_RATES).select('*').where('status', 'Active');

        res.status(200).json({ success: true, data: { clients, leads, taxRates } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getAllProposals = async (req, res) => {
    try {
        const { search, status, client_id, lead_id, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 50, 1);

        let query = withPartyJoins(db(`${TABLES.PROPOSALS} as p`));
        if (status) query = query.where('p.status', status);
        if (client_id) query = query.where('p.client_id', client_id);
        if (lead_id) query = query.where('p.lead_id', lead_id);
        if (search) query = query.where('p.subject', 'like', `%${search}%`);

        const totalRow = await query.clone().clearSelect().count('p.id as total').first();
        const proposals = await query.orderBy('p.id', 'desc').offset((pageNum - 1) * pageSize).limit(pageSize);

        res.status(200).json({
            success: true,
            data: proposals || [],
            pagination: { total: Number(totalRow?.total || 0), page: pageNum, limit: pageSize },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getProposalById = async (req, res) => {
    try {
        const { id } = req.params;
        const proposal = await withPartyJoins(db(`${TABLES.PROPOSALS} as p`)).where('p.id', id).first();
        if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });

        const items = await db(TABLES.ITEMS).where('proposal_id', id).orderBy('item_order', 'asc');
        const taxRateById = await loadTaxRateMap();
        const itemsWithTax = items.map((item) => ({ ...item, tax_name: item.tax_rate_id ? taxRateById.get(Number(item.tax_rate_id))?.name : null }));

        res.status(200).json({ success: true, data: { ...proposal, items: itemsWithTax } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const buildProposalPayload = async (body, req) => {
    const { subject, content, client_id, lead_id, proposal_to, email, phone, address, city, state, zip, country,
        currency, discount_type, discount_percent, adjustment, date, open_till, assigned, items } = body;

    const validItems = (Array.isArray(items) ? items : []).filter((i) => i.description?.trim());
    const taxRateById = await loadTaxRateMap();
    const totals = calculateTotals(validItems, { discount_type, discount_percent, adjustment }, taxRateById);

    return {
        record: {
            subject: subject?.trim(),
            content: content || null,
            client_id: client_id || null,
            lead_id: lead_id || null,
            proposal_to: proposal_to || null,
            email: email || null,
            phone: phone || null,
            address: address || null,
            city: city || null,
            state: state || null,
            zip: zip || null,
            country: country || 0,
            currency: currency || 'INR',
            discount_type: discount_type || null,
            discount_percent: discount_percent || 0,
            discount_total: totals.discount_total,
            total_tax: totals.total_tax,
            subtotal: totals.subtotal,
            adjustment: adjustment || 0,
            total: totals.total,
            date: date || new Date().toISOString().slice(0, 10),
            open_till: open_till || null,
            assigned: assigned || currentUserId(req),
        },
        items: validItems,
    };
};

export const createProposal = async (req, res) => {
    try {
        if (!req.body.subject || !req.body.subject.trim()) {
            return res.status(400).json({ success: false, message: "Subject is required" });
        }
        if (!req.body.client_id && !req.body.lead_id) {
            return res.status(400).json({ success: false, message: "A client or a lead is required" });
        }

        const { record, items } = await buildProposalPayload(req.body, req);
        record.hash = crypto.randomBytes(16).toString('hex');
        record.created_by = currentUserId(req);
        record.updated_by = currentUserId(req);

        const proposalId = await db.transaction(async (trx) => {
            const [insertedId] = await trx(TABLES.PROPOSALS).insert(record);
            if (items.length) {
                await trx(TABLES.ITEMS).insert(items.map((item, idx) => ({
                    proposal_id: insertedId,
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

        const newProposal = await db(TABLES.PROPOSALS).where('id', proposalId).first();
        res.status(201).json({ success: true, message: "Proposal created successfully", data: newProposal });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const updateProposal = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.PROPOSALS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Proposal not found" });

        const { record, items } = await buildProposalPayload(req.body, req);
        record.updated_by = currentUserId(req);

        await db.transaction(async (trx) => {
            await trx(TABLES.PROPOSALS).where('id', id).update(record);
            await trx(TABLES.ITEMS).where('proposal_id', id).del();
            if (items.length) {
                await trx(TABLES.ITEMS).insert(items.map((item, idx) => ({
                    proposal_id: id,
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

        const updated = await db(TABLES.PROPOSALS).where('id', id).first();
        res.status(200).json({ success: true, message: "Proposal updated successfully", data: updated });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteProposal = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.PROPOSALS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Proposal not found" });

        if (existing.converted_invoice_id) {
            return res.status(400).json({ success: false, message: "Cannot delete a proposal that has been converted to an invoice" });
        }

        await db.transaction(async (trx) => {
            await trx(TABLES.ITEMS).where('proposal_id', id).del();
            await trx(TABLES.PROPOSALS).where('id', id).del();
        });

        res.status(200).json({ success: true, message: "Proposal deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const VALID_STATUSES = ['Draft', 'Sent', 'Viewed', 'Declined', 'Accepted'];

export const updateProposalStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, acceptance_name, acceptance_email } = req.body;

        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const existing = await db(TABLES.PROPOSALS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Proposal not found" });

        const updateData = { status, updated_by: currentUserId(req) };
        if (status === 'Accepted') {
            updateData.acceptance_name = acceptance_name || null;
            updateData.acceptance_email = acceptance_email || null;
            updateData.acceptance_date = new Date();
        }

        await db(TABLES.PROPOSALS).where('id', id).update(updateData);
        res.status(200).json({ success: true, message: `Proposal marked as ${status}` });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const convertProposalToInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const proposal = await db(TABLES.PROPOSALS).where('id', id).first();
        if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
        if (proposal.converted_invoice_id) {
            return res.status(400).json({ success: false, message: "Proposal has already been converted" });
        }

        const items = await db(TABLES.ITEMS).where('proposal_id', id).orderBy('item_order', 'asc');

        const invoiceId = await db.transaction(async (trx) => {
            const lastInvoice = await trx(TABLES.INVOICES).orderBy('id', 'desc').first();
            const nextNumber = (lastInvoice ? lastInvoice.id : 0) + 1;

            const [newInvoiceId] = await trx(TABLES.INVOICES).insert({
                invoice_number: `INV-${String(nextNumber).padStart(4, '0')}`,
                client_id: proposal.client_id,
                lead_id: proposal.lead_id,
                proposal_id: proposal.id,
                currency: proposal.currency,
                date: new Date().toISOString().slice(0, 10),
                subtotal: proposal.subtotal,
                discount_type: proposal.discount_type,
                discount_percent: proposal.discount_percent,
                discount_total: proposal.discount_total,
                total_tax: proposal.total_tax,
                adjustment: proposal.adjustment,
                total: proposal.total,
                status: 'Draft',
                assigned: proposal.assigned,
                created_by: currentUserId(req),
                updated_by: currentUserId(req),
            });

            if (items.length) {
                await trx(TABLES.INVOICE_ITEMS).insert(items.map((item) => ({
                    invoice_id: newInvoiceId,
                    description: item.description,
                    long_description: item.long_description,
                    qty: item.qty,
                    rate: item.rate,
                    unit: item.unit,
                    tax_rate_id: item.tax_rate_id,
                    item_order: item.item_order,
                })));
            }

            await trx(TABLES.PROPOSALS).where('id', id).update({
                converted_invoice_id: newInvoiceId,
                date_converted: new Date(),
                updated_by: currentUserId(req),
            });

            return newInvoiceId;
        });

        res.status(201).json({ success: true, message: "Proposal converted to invoice", data: { invoice_id: invoiceId } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== PUBLIC (no auth) — client-facing accept/decline link ====================

export const getPublicProposalByHash = async (req, res) => {
    try {
        const { hash } = req.params;
        const proposal = await withPartyJoins(db(`${TABLES.PROPOSALS} as p`)).where('p.hash', hash).first();
        if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });

        const items = await db(TABLES.ITEMS).where('proposal_id', proposal.id).orderBy('item_order', 'asc');
        const taxRateById = await loadTaxRateMap();
        const itemsWithTax = items.map((item) => ({ ...item, tax_name: item.tax_rate_id ? taxRateById.get(Number(item.tax_rate_id))?.name : null }));

        // First time the client opens the link, mark it Viewed — matches legacy behavior.
        if (proposal.status === 'Sent') {
            await db(TABLES.PROPOSALS).where('id', proposal.id).update({ status: 'Viewed' });
            proposal.status = 'Viewed';
        }

        res.status(200).json({ success: true, data: { ...proposal, items: itemsWithTax } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const FINAL_STATUSES = ['Accepted', 'Declined'];

export const publicRespondToProposal = async (req, res) => {
    try {
        const { hash } = req.params;
        const { decision, name, email, signature } = req.body;

        if (!['accept', 'decline'].includes(decision)) {
            return res.status(400).json({ success: false, message: "Invalid decision" });
        }

        const proposal = await db(TABLES.PROPOSALS).where('hash', hash).first();
        if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });
        if (FINAL_STATUSES.includes(proposal.status)) {
            return res.status(409).json({ success: false, message: `This proposal was already ${proposal.status.toLowerCase()}` });
        }

        if (decision === 'accept') {
            if (!name?.trim()) return res.status(400).json({ success: false, message: "Name is required to accept" });
            await db(TABLES.PROPOSALS).where('id', proposal.id).update({
                status: 'Accepted',
                acceptance_name: name.trim(),
                acceptance_email: email || null,
                acceptance_date: new Date(),
                acceptance_ip: req.ip || req.headers['x-forwarded-for'] || null,
                signature: signature || null,
            });
        } else {
            await db(TABLES.PROPOSALS).where('id', proposal.id).update({ status: 'Declined' });
        }

        res.status(200).json({ success: true, message: decision === 'accept' ? "Proposal accepted" : "Proposal declined" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const downloadProposalPdf = async (req, res) => {
    try {
        const { id } = req.params;
        const proposal = await db(TABLES.PROPOSALS).where('id', id).first();
        if (!proposal) return res.status(404).json({ success: false, message: "Proposal not found" });

        const items = await db(TABLES.ITEMS).where('proposal_id', id).orderBy('item_order', 'asc');
        const taxRateById = await loadTaxRateMap();

        let partyName = proposal.proposal_to;
        if (!partyName && proposal.client_id) {
            const client = await db(TABLES.CLIENTS).where('id', proposal.client_id).first();
            partyName = client?.company;
        }
        if (!partyName && proposal.lead_id) {
            const lead = await db(TABLES.LEADS).where('id', proposal.lead_id).first();
            partyName = lead?.name;
        }

        streamBillingDocumentPdf(res, {
            kind: 'proposal',
            doc: proposal,
            items,
            taxRateById,
            party: { name: partyName, email: proposal.email, phone: proposal.phone, address: [proposal.address, proposal.city, proposal.state].filter(Boolean).join(', ') },
        });
    } catch (error) {
        console.error('PDF error:', error);
        res.status(500).json({ success: false, message: "Failed to generate PDF" });
    }
};
