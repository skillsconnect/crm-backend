import db from '../../../config/knex.js';
import { sendMail } from '../../../helpers/V1/mail.helper.js';
import GoogleOAuthHelper from '../../../helpers/V1/googleOAuthHelper.js';
import { notifyUser } from '../../../services/notificationService.js';

const formatDemoWhen = (value) =>
    new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const TABLES = {
    DEMOS: 'crm_demo_schedules',
    LEADS: 'crm_leads',
    ACTIVITY: 'crm_lead_activity_log',
    USERS: 'ups_users',
    CRM_USERS: 'crm_users',
};

const currentUserId = (req) => req.user?.id || 1;
const currentUserName = (req) => req.user?.full_name || `${req.user?.first_name || ''} ${req.user?.last_name || ''}`.trim() || 'System';

const withJoins = (qb) => qb
    .leftJoin(`${TABLES.LEADS} as l`, 'l.id', 'd.lead_id')
    .leftJoin(`${TABLES.USERS} as u`, 'u.id', 'd.assigned_staff_id')
    .select('d.*', 'l.name as lead_name', 'l.company as lead_company', 'u.first_name as staff_firstname', 'u.last_name as staff_lastname');

// Two half-open ranges [startA,endA) and [startB,endB) overlap iff
// startA < endB AND endA > startB. Used to keep both the staff's and the
// lead's "calendar" free of double-bookings.
const findOverlaps = async ({ leadId, staffId, startAt, durationMinutes, excludeId }) => {
    const endExpr = db.raw('DATE_ADD(demo_date_time, INTERVAL duration_minutes MINUTE)');

    const baseQuery = (qb) => {
        qb.where('status', 'Scheduled')
            .where('demo_date_time', '<', db.raw('DATE_ADD(?, INTERVAL ? MINUTE)', [startAt, durationMinutes]))
            .where(endExpr, '>', startAt);
        if (excludeId) qb.whereNot('id', excludeId);
        return qb;
    };

    const staffConflict = await db(TABLES.DEMOS).modify(baseQuery).where('assigned_staff_id', staffId).first();
    const leadConflict = await db(TABLES.DEMOS).modify(baseQuery).where('lead_id', leadId).first();

    return { staffConflict, leadConflict };
};

export const getFormData = async (req, res) => {
    try {
        // A handful of recently-added leads as the default pick list before
        // the user types anything — full lookup happens via searchLeads
        // below, since there are thousands of leads and loading them all
        // up front isn't workable (and wouldn't be searchable by
        // id/email/phone client-side anyway).
        const leads = await db(TABLES.LEADS)
            .select('id', 'name', 'company', 'email', 'phonenumber')
            .where('is_deleted', false)
            .orderBy('dateadded', 'desc')
            .limit(20);

        const staff = await db(`${TABLES.CRM_USERS} as cu`)
            .join(`${TABLES.USERS} as u`, 'u.id', 'cu.user_id')
            .select('u.id as staff_id', 'u.first_name as firstname', 'u.last_name as lastname')
            .orderBy('u.first_name', 'asc');

        res.status(200).json({ success: true, data: { leads, staff } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// Search-as-you-type lead lookup for the demo scheduler — matches on id
// (exact), name, email, phone, or company, since a staff member might be
// searching by any of those depending on what they have in front of them.
export const searchLeads = async (req, res) => {
    try {
        const { q } = req.query;
        const term = String(q || '').trim();

        let query = db(TABLES.LEADS)
            .select('id', 'name', 'company', 'email', 'phonenumber')
            .where('is_deleted', false);

        if (term) {
            const isNumeric = /^\d+$/.test(term);
            query = query.where((qb) => {
                qb.where('name', 'like', `%${term}%`)
                    .orWhere('email', 'like', `%${term}%`)
                    .orWhere('phonenumber', 'like', `%${term}%`)
                    .orWhere('company', 'like', `%${term}%`);
                if (isNumeric) qb.orWhere('id', Number(term));
            });
        }

        const leads = await query.orderBy('dateadded', 'desc').limit(20);
        res.status(200).json({ success: true, data: leads || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getAllDemos = async (req, res) => {
    try {
        const { staff_id, lead_id, status, from, to } = req.query;

        let query = withJoins(db(`${TABLES.DEMOS} as d`));
        if (staff_id) query = query.where('d.assigned_staff_id', staff_id);
        if (lead_id) query = query.where('d.lead_id', lead_id);
        if (status) query = query.where('d.status', status);
        if (from) query = query.where('d.demo_date_time', '>=', from);
        if (to) query = query.where('d.demo_date_time', '<=', to);

        const demos = await query.orderBy('d.demo_date_time', 'asc');
        res.status(200).json({ success: true, data: demos || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getDemoById = async (req, res) => {
    try {
        const { id } = req.params;
        const demo = await withJoins(db(`${TABLES.DEMOS} as d`)).where('d.id', id).first();
        if (!demo) return res.status(404).json({ success: false, message: "Demo not found" });
        res.status(200).json({ success: true, data: demo });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// One-way push only — a staff member without a connected calendar (the
// common case, since it's opt-in) just gets null back and nothing happens.
// Never let a calendar failure block scheduling/updating/cancelling a demo.
const pushDemoToCalendar = async (demo) => {
    try {
        const start = new Date(demo.demo_date_time);
        const end = new Date(start.getTime() + demo.duration_minutes * 60000);

        const eventId = await GoogleOAuthHelper.createCalendarEvent(demo.assigned_staff_id, {
            summary: demo.title || `Demo with ${demo.client_name || demo.lead_name || ''}`,
            description: [demo.notes, demo.meeting_link ? `Meeting link: ${demo.meeting_link}` : null].filter(Boolean).join('\n\n'),
            startISO: start.toISOString(),
            endISO: end.toISOString(),
            attendeeEmail: demo.client_email || null,
        });

        if (eventId) await db(TABLES.DEMOS).where('id', demo.id).update({ google_event_id: eventId });
    } catch (error) {
        console.error('pushDemoToCalendar failed:', error.message);
    }
};

const updateDemoOnCalendar = async (demo) => {
    if (!demo.google_event_id) return;
    try {
        const start = new Date(demo.demo_date_time);
        const end = new Date(start.getTime() + demo.duration_minutes * 60000);
        await GoogleOAuthHelper.updateCalendarEvent(demo.assigned_staff_id, demo.google_event_id, {
            summary: demo.title,
            startISO: start.toISOString(),
            endISO: end.toISOString(),
        });
    } catch (error) {
        console.error('updateDemoOnCalendar failed:', error.message);
    }
};

const removeDemoFromCalendar = async (demo) => {
    if (!demo.google_event_id) return;
    try {
        await GoogleOAuthHelper.deleteCalendarEvent(demo.assigned_staff_id, demo.google_event_id);
    } catch (error) {
        console.error('removeDemoFromCalendar failed:', error.message);
    }
};

const sendClientConfirmationEmail = async (demo, lead) => {
    const clientEmail = demo.client_email || lead?.email;
    if (!clientEmail) return;

    const demoDate = new Date(demo.demo_date_time);
    try {
        await sendMail({
            emailTo: clientEmail,
            subject: `Demo Scheduled: ${demoDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
            mailBody: `<p>Hi ${demo.client_name || lead?.name || ''},</p>
<p>Your demo has been scheduled for <b>${demoDate.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })}</b> (${demo.duration_minutes} minutes).</p>
${demo.meeting_link ? `<p>Meeting link: <a href="${demo.meeting_link}">${demo.meeting_link}</a></p>` : ''}
<p>We look forward to speaking with you.</p>`,
            purpose: 'demo_confirmation',
        });
    } catch (error) {
        console.error('Failed to send demo confirmation email:', error.message);
    }
};

export const createDemo = async (req, res) => {
    try {
        const { lead_id, assigned_staff_id, demo_date_time, duration_minutes, client_name, client_email, client_phone, meeting_link, notes } = req.body;

        if (!lead_id || !assigned_staff_id || !demo_date_time) {
            return res.status(400).json({ success: false, message: "lead_id, assigned_staff_id and demo_date_time are required" });
        }

        const lead = await db(TABLES.LEADS).where('id', lead_id).first();
        if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

        const duration = duration_minutes || 30;
        const { staffConflict, leadConflict } = await findOverlaps({
            leadId: lead_id,
            staffId: assigned_staff_id,
            startAt: demo_date_time,
            durationMinutes: duration,
        });

        if (staffConflict) {
            return res.status(409).json({ success: false, message: "The assigned staff member already has a demo scheduled at that time", conflict: staffConflict });
        }
        if (leadConflict) {
            return res.status(409).json({ success: false, message: "This lead already has a demo scheduled at that time", conflict: leadConflict });
        }

        const [insertedId] = await db(TABLES.DEMOS).insert({
            lead_id,
            assigned_staff_id,
            title: req.body.title || `Demo with ${lead.name}`,
            demo_date_time,
            duration_minutes: duration,
            client_name: client_name || lead.name,
            client_email: client_email || lead.email,
            client_phone: client_phone || lead.phonenumber,
            meeting_link: meeting_link || null,
            notes: notes || null,
            created_by: currentUserId(req),
            updated_by: currentUserId(req),
        });

        const newDemo = await withJoins(db(`${TABLES.DEMOS} as d`)).where('d.id', insertedId).first();

        await db(TABLES.ACTIVITY).insert({
            lead_id,
            description: `Demo scheduled for ${new Date(demo_date_time).toLocaleString('en-IN')}`,
            date: new Date(),
            staffid: currentUserId(req),
            full_name: currentUserName(req),
        });

        await sendClientConfirmationEmail(newDemo, lead);
        await pushDemoToCalendar(newDemo);

        await notifyUser(assigned_staff_id, {
            type: 'demo_scheduled',
            title: 'Demo scheduled for you',
            message: `${lead.name}${lead.company ? ` (${lead.company})` : ''} on ${formatDemoWhen(demo_date_time)}`,
            link: '/demos',
            meta: { demo_id: insertedId, lead_id, meeting_link: meeting_link || null },
            actorId: currentUserId(req),
        });

        res.status(201).json({ success: true, message: "Demo scheduled successfully", data: newDemo });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const UPDATABLE_FIELDS = ['assigned_staff_id', 'demo_date_time', 'duration_minutes', 'client_name', 'client_email', 'client_phone', 'meeting_link', 'notes', 'title', 'status'];

export const updateDemo = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.DEMOS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Demo not found" });

        const nextStaffId = req.body.assigned_staff_id || existing.assigned_staff_id;
        const nextDateTime = req.body.demo_date_time || existing.demo_date_time;
        const nextDuration = req.body.duration_minutes || existing.duration_minutes;
        const nextStatus = req.body.status || existing.status;

        if (nextStatus === 'Scheduled') {
            const { staffConflict, leadConflict } = await findOverlaps({
                leadId: existing.lead_id,
                staffId: nextStaffId,
                startAt: nextDateTime,
                durationMinutes: nextDuration,
                excludeId: id,
            });

            if (staffConflict) return res.status(409).json({ success: false, message: "The assigned staff member already has a demo scheduled at that time", conflict: staffConflict });
            if (leadConflict) return res.status(409).json({ success: false, message: "This lead already has a demo scheduled at that time", conflict: leadConflict });
        }

        const updateData = { updated_by: currentUserId(req) };
        for (const field of UPDATABLE_FIELDS) {
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }

        // Rescheduling resets reminders so the new time gets its own reminder cycle.
        if (req.body.demo_date_time && req.body.demo_date_time !== existing.demo_date_time) {
            updateData.reminder_12hr_sent = false;
            updateData.reminder_1hr_sent = false;
            updateData.reminder_30min_sent = false;
        }

        await db(TABLES.DEMOS).where('id', id).update(updateData);
        const updated = await withJoins(db(`${TABLES.DEMOS} as d`)).where('d.id', id).first();

        if (updated.status === 'Cancelled') await removeDemoFromCalendar(updated);
        else await updateDemoOnCalendar(updated);

        try {
            const actorId = currentUserId(req);
            const staffChanged = Number(nextStaffId) !== Number(existing.assigned_staff_id);
            const timeChanged = req.body.demo_date_time && req.body.demo_date_time !== existing.demo_date_time;
            const label = `${updated.lead_name || updated.client_name || 'Demo'} on ${formatDemoWhen(updated.demo_date_time)}`;

            if (updated.status === 'Cancelled') {
                await notifyUser(existing.assigned_staff_id, {
                    type: 'demo_cancelled',
                    title: 'Demo cancelled',
                    message: label,
                    link: '/demos',
                    meta: { demo_id: Number(id), lead_id: existing.lead_id },
                    actorId,
                });
            } else if (staffChanged) {
                await notifyUser(nextStaffId, {
                    type: 'demo_reassigned',
                    title: 'A demo was assigned to you',
                    message: label,
                    link: '/demos',
                    meta: { demo_id: Number(id), lead_id: existing.lead_id, meeting_link: updated.meeting_link || null },
                    actorId,
                });
            } else if (timeChanged) {
                await notifyUser(nextStaffId, {
                    type: 'demo_rescheduled',
                    title: 'Demo rescheduled',
                    message: label,
                    link: '/demos',
                    meta: { demo_id: Number(id), lead_id: existing.lead_id },
                    actorId,
                });
            }
        } catch (notifyError) {
            console.error('updateDemo notification failed:', notifyError?.message || notifyError);
        }

        res.status(200).json({ success: true, message: "Demo updated successfully", data: updated });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const cancelDemo = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.DEMOS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Demo not found" });

        await db(TABLES.DEMOS).where('id', id).update({ status: 'Cancelled', updated_by: currentUserId(req) });

        await db(TABLES.ACTIVITY).insert({
            lead_id: existing.lead_id,
            description: `Demo cancelled (was scheduled for ${new Date(existing.demo_date_time).toLocaleString('en-IN')})`,
            date: new Date(),
            staffid: currentUserId(req),
            full_name: currentUserName(req),
        });

        await removeDemoFromCalendar(existing);

        await notifyUser(existing.assigned_staff_id, {
            type: 'demo_cancelled',
            title: 'Demo cancelled',
            message: `Demo on ${formatDemoWhen(existing.demo_date_time)}`,
            link: '/demos',
            meta: { demo_id: Number(id), lead_id: existing.lead_id },
            actorId: currentUserId(req),
        });

        res.status(200).json({ success: true, message: "Demo cancelled successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const markDemoStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!['Completed', 'No-show'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const existing = await db(TABLES.DEMOS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Demo not found" });

        await db(TABLES.DEMOS).where('id', id).update({ status, updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: `Demo marked as ${status}` });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
