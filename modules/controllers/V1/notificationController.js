import db from '../../../config/knex.js';
import { formatNotification } from '../../../services/notificationService.js';

const TABLE = 'crm_notifications';
const currentUserId = (req) => req.user?.id || 0;

// GET /crm/notifications?limit=&before_id=&unread_only=
export const getNotifications = async (req, res) => {
    try {
        const userId = currentUserId(req);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);
        const beforeId = parseInt(req.query.before_id) || 0;
        const unreadOnly = String(req.query.unread_only) === 'true';

        let query = db(TABLE).where('user_id', userId).orderBy('id', 'desc').limit(limit);
        if (beforeId) query = query.where('id', '<', beforeId);
        if (unreadOnly) query = query.where('is_read', false);

        const rows = await query;
        const unreadRow = await db(TABLE).where({ user_id: userId, is_read: false }).count('id as c').first();

        res.status(200).json({
            success: true,
            data: rows.map(formatNotification),
            unread_count: Number(unreadRow?.c || 0),
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// PATCH /crm/notifications/:id/read
export const markNotificationRead = async (req, res) => {
    try {
        const userId = currentUserId(req);
        const updated = await db(TABLE)
            .where({ id: req.params.id, user_id: userId })
            .update({ is_read: true, read_at: new Date() });

        if (!updated) return res.status(404).json({ success: false, message: "Notification not found" });
        res.status(200).json({ success: true, message: "Marked as read" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// POST /crm/notifications/read-all
export const markAllNotificationsRead = async (req, res) => {
    try {
        const userId = currentUserId(req);
        await db(TABLE).where({ user_id: userId, is_read: false }).update({ is_read: true, read_at: new Date() });
        res.status(200).json({ success: true, message: "All notifications marked as read" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
