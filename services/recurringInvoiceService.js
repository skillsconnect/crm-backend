import db from '../config/knex.js';

const TABLES = {
    INVOICES: 'crm_invoices',
    ITEMS: 'crm_invoice_items',
};

// Templates are recurring invoices that aren't themselves a generated copy —
// crm_invoices.recurring_source_invoice_id is null for the original, set for
// every invoice generated from it. Only templates are scanned for what's due;
// generated copies never spawn their own children.
const isTemplateDue = (invoice) => invoice.is_recurring
    && !invoice.recurring_source_invoice_id
    && !['Cancelled'].includes(invoice.status);

const addCycle = (date, cycle, count) => {
    const d = new Date(date);
    if (cycle === 'weekly') d.setDate(d.getDate() + 7 * count);
    else if (cycle === 'monthly') d.setMonth(d.getMonth() + count);
    else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3 * count);
    else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + count);
    return d;
};

export const computeNextRunDate = (template) => {
    if (!template.is_recurring || !template.recurring_cycle) return null;
    return addCycle(template.date, template.recurring_cycle, Number(template.recurring_cycles_done || 0) + 1);
};

const generateOneCycle = async (template, runDate) => {
    const items = await db(TABLES.ITEMS).where('invoice_id', template.id).orderBy('item_order', 'asc');

    return db.transaction(async (trx) => {
        const lastInvoice = await trx(TABLES.INVOICES).orderBy('id', 'desc').first();
        const nextNumber = (lastInvoice ? lastInvoice.id : 0) + 1;

        // Preserve the original due-date offset (e.g. "net 15 days") on each cycle.
        let dueDate = null;
        if (template.due_date) {
            const offsetDays = Math.round((new Date(template.due_date) - new Date(template.date)) / 86400000);
            const d = new Date(runDate);
            d.setDate(d.getDate() + offsetDays);
            dueDate = d.toISOString().slice(0, 10);
        }

        const [newInvoiceId] = await trx(TABLES.INVOICES).insert({
            invoice_number: `INV-${String(nextNumber).padStart(4, '0')}`,
            client_id: template.client_id,
            lead_id: template.lead_id,
            currency: template.currency,
            date: runDate.toISOString().slice(0, 10),
            due_date: dueDate,
            subtotal: template.subtotal,
            discount_type: template.discount_type,
            discount_percent: template.discount_percent,
            discount_total: template.discount_total,
            total_tax: template.total_tax,
            adjustment: template.adjustment,
            total: template.total,
            status: 'Unpaid',
            terms: template.terms,
            assigned: template.assigned,
            is_recurring: false,
            recurring_source_invoice_id: template.id,
            created_by: template.created_by,
            updated_by: template.created_by,
        });

        if (items.length) {
            await trx(TABLES.ITEMS).insert(items.map((item) => ({
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

        await trx(TABLES.INVOICES).where('id', template.id).increment('recurring_cycles_done', 1);

        return newInvoiceId;
    });
};

/**
 * Scans every recurring invoice template and generates any invoices that
 * are due (catching up on more than one missed cycle if the app was down).
 * Returns the list of newly generated invoice ids. Safe to call repeatedly —
 * a template with nothing due does nothing.
 */
export const generateDueRecurringInvoices = async () => {
    const templates = await db(TABLES.INVOICES).where({ is_recurring: true }).whereNull('recurring_source_invoice_id');
    const generated = [];

    for (const template of templates) {
        if (!isTemplateDue(template)) continue;

        let current = template;
        // Cap iterations defensively — a template left unattended for years
        // shouldn't generate an unbounded backlog in one pass.
        for (let i = 0; i < 24; i++) {
            if (current.recurring_cycles_total && current.recurring_cycles_done >= current.recurring_cycles_total) break;

            const nextRun = computeNextRunDate(current);
            if (!nextRun || nextRun > new Date()) break;

            const newId = await generateOneCycle(current, nextRun);
            generated.push(newId);
            current = await db(TABLES.INVOICES).where('id', template.id).first();
        }
    }

    return generated;
};

let intervalHandle = null;

export const startRecurringInvoiceScheduler = () => {
    if (intervalHandle) return;
    const run = async () => {
        try {
            const generated = await generateDueRecurringInvoices();
            if (generated.length) console.log(`[recurring invoices] generated ${generated.length} invoice(s): ${generated.join(', ')}`);
        } catch (error) {
            console.error('[recurring invoices] check failed:', error);
        }
    };
    run();
    intervalHandle = setInterval(run, 60 * 60 * 1000); // hourly is plenty for day-granularity billing cycles
    console.log('[recurring invoices] scheduler started (checking hourly)');
};
