import db from '../config/knex.js';
import { notifyUser } from './notificationService.js';
import { sendMail } from '../helpers/V1/mail.helper.js';

// Must run inside the same process as the WebSocket server (app.js) — the
// live `wsClients` connection map in helpers/V1/websocket.js is in-memory
// and process-local. Running this as a separate cron process (like the
// other scripts in cron/) would check a completely disconnected, always-
// empty client map and silently never deliver anything.

const CHECK_INTERVAL_MS = 60 * 1000;

const THRESHOLDS = [
    { minutes: 720, field: 'reminder_12hr_sent', label: '12 hours' },
    { minutes: 60, field: 'reminder_1hr_sent', label: '1 hour' },
    { minutes: 30, field: 'reminder_30min_sent', label: '30 minutes' },
];

const formatWhen = (value) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

async function checkAndSendReminders() {
    try {
        const now = new Date();
        const demos = await db('crm_demo_schedules as d')
            .leftJoin('crm_leads as l', 'l.id', 'd.lead_id')
            .leftJoin('ups_users as u', 'u.id', 'd.assigned_staff_id')
            .select(
                'd.id', 'd.lead_id', 'd.assigned_staff_id', 'd.demo_date_time', 'd.duration_minutes',
                'd.client_name', 'd.client_email', 'd.meeting_link',
                'd.reminder_12hr_sent', 'd.reminder_1hr_sent', 'd.reminder_30min_sent',
                'l.name as lead_name', 'l.company as lead_company',
                'u.first_name as staff_firstname', 'u.email as staff_email'
            )
            .where('d.status', 'Scheduled')
            .where('d.demo_date_time', '>', now);

        for (const demo of demos) {
            const minutesUntil = (new Date(demo.demo_date_time).getTime() - now.getTime()) / 60000;

            for (const threshold of THRESHOLDS) {
                if (demo[threshold.field]) continue; // already sent for this threshold
                if (minutesUntil > threshold.minutes) continue; // not due yet

                await sendReminder(demo, threshold);
                await db('crm_demo_schedules').where('id', demo.id).update({ [threshold.field]: true });
                demo[threshold.field] = true; // avoid double-sending within the same tick if multiple thresholds are already past
            }
        }
    } catch (error) {
        console.error('[demo reminders] check failed:', error);
    }
}

async function sendReminder(demo, threshold) {
    const when = formatWhen(demo.demo_date_time);

    // Persisted notification + live WebSocket push to the assigned staff member.
    await notifyUser(demo.assigned_staff_id, {
        type: 'demo_reminder',
        title: `Demo in ${threshold.label}`,
        message: `${demo.lead_name || demo.client_name || 'Demo'}${demo.lead_company ? ` (${demo.lead_company})` : ''} at ${when}`,
        link: '/demos',
        meta: {
            demo_id: demo.id,
            lead_id: demo.lead_id,
            meeting_link: demo.meeting_link || null,
            minutes_before: threshold.minutes,
        },
    });

    // Email nudge to the client so their side stays informed even though we
    // can't reach into an external calendar to block it directly.
    if (demo.client_email) {
        try {
            await sendMail({
                emailTo: demo.client_email,
                subject: `Reminder: Demo in ${threshold.label}`,
                mailBody: `<p>Hi ${demo.client_name || demo.lead_name || ''},</p>
<p>This is a reminder that your demo is scheduled in <b>${threshold.label}</b>, at ${when}.</p>
${demo.meeting_link ? `<p>Meeting link: <a href="${demo.meeting_link}">${demo.meeting_link}</a></p>` : ''}`,
                purpose: 'demo_reminder',
            });
        } catch (error) {
            console.error(`[demo reminders] failed to email client for demo ${demo.id}:`, error.message);
        }
    }

    console.log(`[demo reminders] sent ${threshold.label} reminder for demo ${demo.id} to staff ${demo.assigned_staff_id}`);
}

let intervalHandle = null;

export function startDemoReminderScheduler() {
    if (intervalHandle) return;
    intervalHandle = setInterval(checkAndSendReminders, CHECK_INTERVAL_MS);
    console.log('[demo reminders] scheduler started (checking every 60s)');
    // Run once shortly after boot too, rather than waiting a full interval.
    setTimeout(checkAndSendReminders, 5000);
}

export function stopDemoReminderScheduler() {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
}
