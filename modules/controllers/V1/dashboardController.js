import db from '../../../config/knex.js';

const activeLeadScope = (qb) => qb.where('lost', false).where('junk', false).where('is_deleted', false);

const startOfMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export const getDashboardStats = async (req, res) => {
    try {
        const monthStart = startOfMonth();
        const now = new Date();
        const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

        // ---- Leads ----
        const totalActiveLeadsRow = await db('crm_leads').modify(activeLeadScope).count('id as total').first();
        const newLeadsThisMonthRow = await db('crm_leads').modify(activeLeadScope).where('dateadded', '>=', monthStart).count('id as total').first();

        const statuses = await db('crm_lead_status').where('status', 'Active').orderBy('sequence', 'asc');
        const firstStatusId = statuses[0]?.id || 0;
        const unqualifiedRow = firstStatusId
            ? await db('crm_leads').modify(activeLeadScope).where('status', firstStatusId).count('id as total').first()
            : { total: 0 };

        const funnel = await db('crm_lead_status as s')
            .leftJoin('crm_leads as l', function () {
                this.on('l.status', '=', 's.id').andOnVal('l.lost', false).andOnVal('l.junk', false).andOnVal('l.is_deleted', false);
            })
            .where('s.status', 'Active')
            .groupBy('s.id', 's.name', 's.color', 's.sequence')
            .orderBy('s.sequence', 'asc')
            .select('s.id', 's.name', 's.color')
            .count('l.id as total');

        // ---- Demos ----
        const demosScheduledRow = await db('crm_demo_schedules').where('status', 'Scheduled').count('id as total').first();
        const demosUpcomingRow = await db('crm_demo_schedules').where('status', 'Scheduled').where('demo_date_time', '>=', now).count('id as total').first();

        const upcomingDemos = await db('crm_demo_schedules as d')
            .leftJoin('crm_leads as l', 'l.id', 'd.lead_id')
            .leftJoin('ups_users as u', 'u.id', 'd.assigned_staff_id')
            .select('d.id', 'd.demo_date_time', 'd.duration_minutes', 'l.name as lead_name', 'l.company as lead_company', 'u.first_name as staff_firstname')
            .where('d.status', 'Scheduled')
            .whereBetween('d.demo_date_time', [now, in48h])
            .orderBy('d.demo_date_time', 'asc')
            .limit(6);

        // ---- Invoices ----
        const invoicesSentRow = await db('crm_invoices').whereNot('status', 'Draft').count('id as total').first();
        const invoicesValueRow = await db('crm_invoices').whereNotIn('status', ['Draft', 'Cancelled']).sum('total as total_value').first();
        const overdueRow = await db('crm_invoices').where('status', 'Overdue').count('id as total').sum('total as total_value').first();

        const dueInvoices = await db('crm_invoices as i')
            .leftJoin('crm_clients as c', 'c.id', 'i.client_id')
            .leftJoin('crm_leads as l', 'l.id', 'i.lead_id')
            .select('i.id', 'i.invoice_number', 'i.due_date', 'i.total', 'i.amount_paid', 'i.status', 'c.company as client_company', 'l.name as lead_name')
            .whereIn('i.status', ['Unpaid', 'Partially Paid', 'Overdue'])
            .orderBy('i.due_date', 'asc')
            .limit(8);

        // ---- Proposals ----
        const proposalsSharedRow = await db('crm_proposals').whereNot('status', 'Draft').count('id as total').first();
        const proposalsAcceptedRow = await db('crm_proposals').where('status', 'Accepted').count('id as total').first();

        // ---- This month summary ----
        const leadsCreatedMonthRow = newLeadsThisMonthRow;
        const leadsConvertedMonthRow = await db('crm_leads').where('date_converted', '>=', monthStart).count('id as total').first();
        const invoicesSentMonthRow = await db('crm_invoices').whereNot('status', 'Draft').where('date', '>=', monthStart).count('id as total').first();
        const proposalsAcceptedMonthRow = await db('crm_proposals').where('status', 'Accepted').where('updated_on', '>=', monthStart).count('id as total').first();

        // ---- Upcoming reminders (next 24h, not yet notified) ----
        const upcomingReminders = await db('crm_lead_reminders as r')
            .leftJoin('crm_leads as l', 'l.id', 'r.lead_id')
            .select('r.id', 'r.description', 'r.date', 'l.name as lead_name')
            .where('r.isnotified', false)
            .whereBetween('r.date', [now, in48h])
            .orderBy('r.date', 'asc')
            .limit(6);

        const created = Number(leadsCreatedMonthRow?.total || 0);
        const converted = Number(leadsConvertedMonthRow?.total || 0);

        res.status(200).json({
            success: true,
            data: {
                kpis: {
                    new_leads_this_month: Number(newLeadsThisMonthRow?.total || 0),
                    total_active_leads: Number(totalActiveLeadsRow?.total || 0),
                    qualified_leads: Math.max(0, Number(totalActiveLeadsRow?.total || 0) - Number(unqualifiedRow?.total || 0)),
                    invoices_sent: Number(invoicesSentRow?.total || 0),
                    invoices_total_value: Number(invoicesValueRow?.total_value || 0),
                    proposals_shared: Number(proposalsSharedRow?.total || 0),
                    proposals_accepted: Number(proposalsAcceptedRow?.total || 0),
                    demos_scheduled: Number(demosScheduledRow?.total || 0),
                    demos_upcoming: Number(demosUpcomingRow?.total || 0),
                    overdue_invoices: Number(overdueRow?.total || 0),
                    overdue_invoices_value: Number(overdueRow?.total_value || 0),
                },
                funnel: funnel.map((f) => ({ id: f.id, name: f.name, color: f.color, total: Number(f.total || 0) })),
                upcoming_demos: upcomingDemos,
                upcoming_reminders: upcomingReminders,
                due_invoices: dueInvoices,
                month_summary: {
                    leads_created: created,
                    leads_converted: converted,
                    conversion_rate: created > 0 ? Number(((converted / created) * 100).toFixed(1)) : 0,
                    invoices_sent: Number(invoicesSentMonthRow?.total || 0),
                    proposals_accepted: Number(proposalsAcceptedMonthRow?.total || 0),
                },
            },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
