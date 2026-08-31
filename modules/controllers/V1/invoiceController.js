import db from '../../../config/knex.js';
import { calculateTotals } from '../../../helpers/V1/billing_totals.helper.js';
import { streamBillingDocumentPdf } from '../../../services/pdfDocumentService.js';
import { computeNextRunDate, generateDueRecurringInvoices } from '../../../services/recurringInvoiceService.js';

const TABLES = {
    INVOICES: 'crm_invoices',
    ITEMS: 'crm_invoice_items',
    PAYMENTS: 'crm_invoice_payments',
    CLIENTS: 'crm_clients',
    LEADS: 'crm_leads',
    TAX_RATES: 'crm_tax_rates',
    PAYMENT_MODES: 'crm_payment_modes',
};

const currentUserId = (req) => req.user?.id || 1;

const loadTaxRateMap = async () => {
    const rates = await db(TABLES.TAX_RATES).select('id', 'name', 'rate');
    return new Map(rates.map((r) => [r.id, r]));
};

const withPartyJoins = (qb) => qb
    .leftJoin(`${TABLES.CLIENTS} as c`, 'c.id', 'i.client_id')
    .leftJoin(`${TABLES.LEADS} as l`, 'l.id', 'i.lead_id')
    .select('i.*', 'c.company as client_company', 'l.name as lead_name');

// An invoice's status only auto-transitions between the "money" states
// (Unpaid/Partially Paid/Paid/Overdue) — Draft and Cancelled are explicit
// choices the derivation below must not clobber.
const deriveStatus = (invoice) => {
    if (['Draft', 'Cancelled'].includes(invoice.status)) return invoice.status;

    const total = Number(invoice.total) || 0;
    const paid = Number(invoice.amount_paid) || 0;

    if (paid >= total && total > 0) return 'Paid';
    if (paid > 0) return 'Partially Paid';
    if (invoice.due_date && new Date(invoice.due_date) < new Date()) return 'Overdue';
    return 'Unpaid';
};

export const getFormData = async (req, res) => {
    try {
        const clients = await db(TABLES.CLIENTS).select('id', 'company', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country').where('status', 'Active').orderBy('company', 'asc');
        const leads = await db(TABLES.LEADS).select('id', 'name', 'company', 'email', 'phonenumber', 'address', 'city', 'state', 'zip', 'country').where('is_deleted', false).orderBy('name', 'asc').limit(500);
        const taxRates = await db(TABLES.TAX_RATES).select('*').where('status', 'Active');
        const paymentModes = await db(TABLES.PAYMENT_MODES).select('*').where('status', 'Active');

        res.status(200).json({ success: true, data: { clients, leads, taxRates, paymentModes } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getAllInvoices = async (req, res) => {
    try {
        const { search, status, client_id, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 50, 1);

        let query = withPartyJoins(db(`${TABLES.INVOICES} as i`));
        if (status) query = query.where('i.status', status);
        if (client_id) query = query.where('i.client_id', client_id);
        if (search) {
            const term = `%${search}%`;
            query = query.where((qb) => {
                qb.where('i.invoice_number', 'like', term)
                    .orWhere('c.company', 'like', term)
                    .orWhere('l.name', 'like', term)
                    .orWhere('l.company', 'like', term);
            });
        }

        const totalRow = await query.clone().clearSelect().count('i.id as total').first();
        const invoices = await query.orderBy('i.id', 'desc').offset((pageNum - 1) * pageSize).limit(pageSize);

        const summary = await db(TABLES.INVOICES)
            .select('status')
            .count('id as total')
            .sum('total as total_value')
            .groupBy('status');

        res.status(200).json({
            success: true,
            data: invoices || [],
            summary,
            pagination: { total: Number(totalRow?.total || 0), page: pageNum, limit: pageSize },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await withPartyJoins(db(`${TABLES.INVOICES} as i`)).where('i.id', id).first();
        if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

        const items = await db(TABLES.ITEMS).where('invoice_id', id).orderBy('item_order', 'asc');
        const taxRateById = await loadTaxRateMap();
        const itemsWithTax = items.map((item) => ({ ...item, tax_name: item.tax_rate_id ? taxRateById.get(Number(item.tax_rate_id))?.name : null }));
        const payments = await db(TABLES.PAYMENTS).where('invoice_id', id).orderBy('payment_date', 'desc');

        let recurringChildren = [];
        if (invoice.is_recurring && !invoice.recurring_source_invoice_id) {
            recurringChildren = await db(TABLES.INVOICES).where('recurring_source_invoice_id', id).select('id', 'invoice_number', 'date', 'total', 'status').orderBy('date', 'desc');
        }
        const nextRunDate = invoice.is_recurring && !invoice.recurring_source_invoice_id ? computeNextRunDate(invoice) : null;

        res.status(200).json({ success: true, data: { ...invoice, items: itemsWithTax, payments, recurringChildren, nextRunDate } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const RECURRING_CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly'];

const buildInvoicePayload = async (body, req) => {
    const { client_id, lead_id, currency, discount_type, discount_percent, adjustment, date, due_date,
        terms, client_note, admin_note, assigned, items, is_recurring, recurring_cycle, recurring_cycles_total } = body;

    const validItems = (Array.isArray(items) ? items : []).filter((i) => i.description?.trim());
    const taxRateById = await loadTaxRateMap();
    const totals = calculateTotals(validItems, { discount_type, discount_percent, adjustment }, taxRateById);

    const recurring = Boolean(is_recurring) && RECURRING_CYCLES.includes(recurring_cycle);

    return {
        record: {
            client_id: client_id || null,
            lead_id: lead_id || null,
            currency: currency || 'INR',
            discount_type: discount_type || null,
            discount_percent: discount_percent || 0,
            discount_total: totals.discount_total,
            total_tax: totals.total_tax,
            subtotal: totals.subtotal,
            adjustment: adjustment || 0,
            total: totals.total,
            date: date || new Date().toISOString().slice(0, 10),
            due_date: due_date || null,
            terms: terms || null,
            client_note: client_note || null,
            admin_note: admin_note || null,
            assigned: assigned || currentUserId(req),
            is_recurring: recurring,
            recurring_cycle: recurring ? recurring_cycle : null,
            recurring_cycles_total: recurring && recurring_cycles_total ? Number(recurring_cycles_total) : null,
        },
        items: validItems,
    };
};

export const createInvoice = async (req, res) => {
    try {
        if (!req.body.client_id && !req.body.lead_id) {
            return res.status(400).json({ success: false, message: "A client or a lead is required" });
        }

        const { record, items } = await buildInvoicePayload(req.body, req);
        record.created_by = currentUserId(req);
        record.updated_by = currentUserId(req);
        record.status = req.body.status === 'Draft' ? 'Draft' : 'Unpaid';

        const invoiceId = await db.transaction(async (trx) => {
            const lastInvoice = await trx(TABLES.INVOICES).orderBy('id', 'desc').first();
            const nextNumber = (lastInvoice ? lastInvoice.id : 0) + 1;
            record.invoice_number = `INV-${String(nextNumber).padStart(4, '0')}`;

            const [insertedId] = await trx(TABLES.INVOICES).insert(record);
            if (items.length) {
                await trx(TABLES.ITEMS).insert(items.map((item, idx) => ({
                    invoice_id: insertedId,
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

        const newInvoice = await db(TABLES.INVOICES).where('id', invoiceId).first();
        res.status(201).json({ success: true, message: "Invoice created successfully", data: newInvoice });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const updateInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.INVOICES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Invoice not found" });

        const { record, items } = await buildInvoicePayload(req.body, req);
        record.updated_by = currentUserId(req);
        record.status = deriveStatus({ ...existing, ...record });

        await db.transaction(async (trx) => {
            await trx(TABLES.INVOICES).where('id', id).update(record);
            await trx(TABLES.ITEMS).where('invoice_id', id).del();
            if (items.length) {
                await trx(TABLES.ITEMS).insert(items.map((item, idx) => ({
                    invoice_id: id,
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

        const updated = await db(TABLES.INVOICES).where('id', id).first();
        res.status(200).json({ success: true, message: "Invoice updated successfully", data: updated });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.INVOICES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Invoice not found" });

        if (Number(existing.amount_paid) > 0) {
            return res.status(400).json({ success: false, message: "Cannot cancel an invoice that has recorded payments" });
        }

        await db(TABLES.INVOICES).where('id', id).update({ status: 'Cancelled', updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: "Invoice cancelled successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const markInvoiceSent = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.INVOICES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Invoice not found" });

        const status = deriveStatus({ ...existing, status: 'Unpaid' });
        await db(TABLES.INVOICES).where('id', id).update({ status, updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: "Invoice marked as sent" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== PAYMENTS ====================

export const addPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, payment_mode, payment_date, transaction_id, note } = req.body;

        const invoice = await db(TABLES.INVOICES).where('id', id).first();
        if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

        const paymentAmount = Number(amount);
        if (!paymentAmount || paymentAmount <= 0) {
            return res.status(400).json({ success: false, message: "A positive payment amount is required" });
        }

        const remaining = Number(invoice.total) - Number(invoice.amount_paid);
        if (paymentAmount > remaining + 0.01) {
            return res.status(400).json({ success: false, message: `Payment exceeds the remaining balance of ${remaining.toFixed(2)}` });
        }

        await db.transaction(async (trx) => {
            await trx(TABLES.PAYMENTS).insert({
                invoice_id: id,
                amount: paymentAmount,
                payment_mode: payment_mode || null,
                payment_date: payment_date || new Date().toISOString().slice(0, 10),
                transaction_id: transaction_id || null,
                note: note || null,
                recorded_by: currentUserId(req),
            });

            const newAmountPaid = Number(invoice.amount_paid) + paymentAmount;
            const newStatus = deriveStatus({ ...invoice, amount_paid: newAmountPaid });

            await trx(TABLES.INVOICES).where('id', id).update({
                amount_paid: newAmountPaid,
                status: newStatus,
                updated_by: currentUserId(req),
            });
        });

        res.status(201).json({ success: true, message: "Payment recorded successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deletePayment = async (req, res) => {
    try {
        const { id, paymentId } = req.params;
        const invoice = await db(TABLES.INVOICES).where('id', id).first();
        if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

        const payment = await db(TABLES.PAYMENTS).where({ id: paymentId, invoice_id: id }).first();
        if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

        await db.transaction(async (trx) => {
            await trx(TABLES.PAYMENTS).where('id', paymentId).del();

            const newAmountPaid = Math.max(0, Number(invoice.amount_paid) - Number(payment.amount));
            const newStatus = deriveStatus({ ...invoice, amount_paid: newAmountPaid });

            await trx(TABLES.INVOICES).where('id', id).update({
                amount_paid: newAmountPaid,
                status: newStatus,
                updated_by: currentUserId(req),
            });
        });

        res.status(200).json({ success: true, message: "Payment removed successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const downloadInvoicePdf = async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await db(TABLES.INVOICES).where('id', id).first();
        if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

        const items = await db(TABLES.ITEMS).where('invoice_id', id).orderBy('item_order', 'asc');
        const taxRateById = await loadTaxRateMap();

        let partyName = null;
        let partyEmail = null;
        let partyPhone = null;
        let partyAddress = null;
        if (invoice.client_id) {
            const client = await db(TABLES.CLIENTS).where('id', invoice.client_id).first();
            if (client) {
                partyName = client.company;
                partyEmail = client.email;
                partyPhone = client.phone;
                partyAddress = [client.address, client.city, client.state].filter(Boolean).join(', ');
            }
        } else if (invoice.lead_id) {
            const lead = await db(TABLES.LEADS).where('id', invoice.lead_id).first();
            if (lead) {
                partyName = lead.name;
                partyEmail = lead.email;
                partyPhone = lead.phonenumber;
                partyAddress = [lead.address, lead.city, lead.state].filter(Boolean).join(', ');
            }
        }

        streamBillingDocumentPdf(res, {
            kind: 'invoice',
            doc: invoice,
            items,
            taxRateById,
            party: { name: partyName, email: partyEmail, phone: partyPhone, address: partyAddress },
        });
    } catch (error) {
        console.error('PDF error:', error);
        res.status(500).json({ success: false, message: "Failed to generate PDF" });
    }
};

// ==================== RECURRING ====================

export const getRecurringInvoiceTemplates = async (req, res) => {
    try {
        const templates = await withPartyJoins(db(`${TABLES.INVOICES} as i`))
            .where('i.is_recurring', true)
            .whereNull('i.recurring_source_invoice_id')
            .orderBy('i.id', 'desc');

        const withNextRun = templates.map((t) => ({ ...t, nextRunDate: computeNextRunDate(t) }));
        res.status(200).json({ success: true, data: withNextRun });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const runRecurringInvoicesNow = async (req, res) => {
    try {
        const generated = await generateDueRecurringInvoices();
        res.status(200).json({ success: true, message: `Generated ${generated.length} invoice(s)`, data: { generated_ids: generated } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
