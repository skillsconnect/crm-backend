import crypto from 'crypto';
import db from '../../../config/knex.js';
import GoogleOAuthHelper from '../../../helpers/V1/googleOAuthHelper.js';

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

// req.user is populated by Authenticate middleware from ups_users — the same
// hashing scheme as login (md5) is reused here for consistency; changing it
// would break login for anyone who changes their password via this page.

export const getMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await db('ups_users')
            .select('id', 'first_name', 'last_name', 'full_name', 'email', 'mobile', 'whatsapp_number', 'image_name')
            .where('id', userId)
            .first();

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const crmProfile = await db('crm_users')
            .select('is_admin', 'department', 'designation', 'profile_image')
            .where('user_id', userId)
            .first();

        res.status(200).json({
            success: true,
            data: {
                ...user,
                is_admin: Boolean(crmProfile?.is_admin),
                department: crmProfile?.department || '',
                designation: crmProfile?.designation || '',
                profile_image: crmProfile?.profile_image || user.image_name || '',
            },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const updateMyProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { first_name, last_name, mobile, whatsapp_number, department, designation } = req.body;

        if (!first_name || !first_name.trim()) {
            return res.status(400).json({ success: false, message: "First name is required" });
        }

        const userUpdate = {
            first_name: first_name.trim(),
            full_name: `${first_name.trim()} ${(last_name || '').trim()}`.trim(),
        };
        if (last_name !== undefined) userUpdate.last_name = last_name;
        if (mobile !== undefined) userUpdate.mobile = mobile;
        if (whatsapp_number !== undefined) userUpdate.whatsapp_number = whatsapp_number;

        await db('ups_users').where('id', userId).update(userUpdate);

        const existingCrmProfile = await db('crm_users').where('user_id', userId).first();
        if (existingCrmProfile) {
            const crmUpdate = { updated_by: userId };
            if (department !== undefined) crmUpdate.department = department;
            if (designation !== undefined) crmUpdate.designation = designation;
            await db('crm_users').where('user_id', userId).update(crmUpdate);
        }

        const updated = await db('ups_users')
            .select('id', 'first_name', 'last_name', 'full_name', 'email', 'mobile', 'whatsapp_number', 'image_name')
            .where('id', userId)
            .first();

        res.status(200).json({ success: true, message: "Profile updated successfully", data: updated });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== GOOGLE CALENDAR CONNECTION ====================

export const getCalendarStatus = async (req, res) => {
    try {
        const connection = await db('crm_staff_google_calendar').where('staff_id', req.user.id).first();
        res.status(200).json({
            success: true,
            data: connection
                ? { connected: Boolean(connection.connected), last_error: connection.last_error, connected_at: connection.connected_at }
                : { connected: false },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getCalendarConnectUrl = async (req, res) => {
    try {
        const url = GoogleOAuthHelper.getCalendarAuthUrl(req.user.id);
        res.status(200).json({ success: true, data: { url } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const disconnectCalendar = async (req, res) => {
    try {
        await GoogleOAuthHelper.disconnectCalendar(req.user.id);
        res.status(200).json({ success: true, message: "Google Calendar disconnected" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const changeMyPassword = async (req, res) => {
    try {
        const userId = req.user.id;
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ success: false, message: "Current and new password are required" });
        }
        if (String(new_password).length < 6) {
            return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
        }

        const user = await db('ups_users').select('id', 'password').where('id', userId).first();
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        if (user.password !== md5(current_password)) {
            return res.status(400).json({ success: false, message: "Current password is incorrect" });
        }

        await db('ups_users').where('id', userId).update({ password: md5(new_password) });
        res.status(200).json({ success: true, message: "Password changed successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
