import db from '../config/knex.js';
import { sendMessageToWSClient } from '../helpers/V1/websocket.js';

const TABLE = 'crm_notifications';

const parseMeta = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

// knex runs with dateStrings:true + timezone +05:30, so timestamps come back as
// "YYYY-MM-DD HH:MM:SS" with no zone. Pin them to IST so the browser (any TZ)
// renders "x minutes ago" correctly.
const toIso = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const m = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) {
        const d = new Date(`${m[1]}T${m[2]}+05:30`);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return String(value);
};

export const formatNotification = (row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message || '',
    link: row.link || null,
    meta: parseMeta(row.meta),
    actor_id: row.actor_id || null,
    is_read: Boolean(row.is_read),
    created_on: toIso(row.created_on),
});

/**
 * Persist a notification for `userId` and, if that user has a live WebSocket
 * connection, push it immediately. Never throws — a notification failure must
 * not break the action that triggered it. No-ops when the recipient is the
 * actor (you don't get notified about your own action) or the recipient is
 * missing / 0.
 */
export const notifyUser = async (userId, { type, title, message = '', link = null, meta = null, actorId = null } = {}) => {
    const recipient = Number(userId) || 0;
    if (!recipient || !type || !title) return null;
    if (actorId && Number(actorId) === recipient) return null;

    try {
        const [id] = await db(TABLE).insert({
            user_id: recipient,
            actor_id: Number(actorId) || null,
            type,
            title,
            message: message || null,
            link: link || null,
            meta: meta ? JSON.stringify(meta) : null,
        });

        const row = await db(TABLE).where('id', id).first();
        const payload = formatNotification(row);

        sendMessageToWSClient(String(recipient), { type: 'notification', notification: payload });

        return payload;
    } catch (error) {
        console.error('notifyUser failed:', error?.message || error);
        return null;
    }
};

/** Fan-out helper — de-dupes recipients and skips the actor. */
export const notifyUsers = async (userIds, options) => {
    const unique = [...new Set((userIds || []).map((v) => Number(v) || 0).filter(Boolean))];
    await Promise.all(unique.map((uid) => notifyUser(uid, options)));
};
