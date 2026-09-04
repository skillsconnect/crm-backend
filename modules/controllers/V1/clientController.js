import db from '../../../config/knex.js';
import { resolveLocation } from '../../../helpers/V1/locationResolver.js';

const TABLES = {
    CLIENTS: 'crm_clients',
    CONTACTS: 'crm_client_contacts',
};

const currentUserId = (req) => req.user?.id || 1;

export const getAllClients = async (req, res) => {
    try {
        const { search, status, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 50, 1);

        let query = db(TABLES.CLIENTS).select('*');
        if (status) query = query.where('status', status);
        if (search) {
            query = query.where((qb) => {
                qb.where('company', 'like', `%${search}%`)
                    .orWhere('email', 'like', `%${search}%`)
                    .orWhere('phone', 'like', `%${search}%`);
            });
        }

        const totalRow = await query.clone().clearSelect().count('id as total').first();
        const clients = await query.orderBy('id', 'desc').offset((pageNum - 1) * pageSize).limit(pageSize);

        res.status(200).json({
            success: true,
            data: clients || [],
            pagination: { total: Number(totalRow?.total || 0), page: pageNum, limit: pageSize },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getClientById = async (req, res) => {
    try {
        const { id } = req.params;
        const client = await db(TABLES.CLIENTS).where('id', id).first();
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        const contacts = await db(TABLES.CONTACTS).where('client_id', id).orderBy('is_primary', 'desc');

        res.status(200).json({ success: true, data: { ...client, contacts } });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const createClient = async (req, res) => {
    try {
        const { company, vat, phone, email, website, address, city, state, zip, country, notes, lead_id, contacts } = req.body;

        if (!company || !company.trim()) {
            return res.status(400).json({ success: false, message: "Company name is required" });
        }

        // `country` is an integer FK to ups_countries; `state`/`city` are names.
        const location = await resolveLocation({ country, state, city });

        const result = await db.transaction(async (trx) => {
            const [insertedId] = await trx(TABLES.CLIENTS).insert({
                company: company.trim(),
                vat: vat || null,
                phone: phone || null,
                email: email || null,
                website: website || null,
                address: address || null,
                city: location.city,
                state: location.state,
                zip: zip || null,
                country: location.country,
                notes: notes || null,
                lead_id: lead_id || null,
                created_by: currentUserId(req),
                updated_by: currentUserId(req),
            });

            if (Array.isArray(contacts) && contacts.length) {
                await trx(TABLES.CONTACTS).insert(contacts.filter((c) => c.first_name?.trim()).map((c, idx) => ({
                    client_id: insertedId,
                    first_name: c.first_name.trim(),
                    last_name: c.last_name || null,
                    email: c.email || null,
                    phone: c.phone || null,
                    title: c.title || null,
                    is_primary: idx === 0,
                })));
            }

            return insertedId;
        });

        const newClient = await db(TABLES.CLIENTS).where('id', result).first();
        res.status(201).json({ success: true, message: "Client created successfully", data: newClient });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const UPDATABLE_CLIENT_FIELDS = ['company', 'vat', 'phone', 'email', 'website', 'address', 'city', 'state', 'zip', 'country', 'notes', 'status'];

export const updateClient = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.CLIENTS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Client not found" });

        const updateData = { updated_by: currentUserId(req) };
        for (const field of UPDATABLE_CLIENT_FIELDS) {
            if (field === 'country' || field === 'state' || field === 'city') continue;
            if (req.body[field] !== undefined) updateData[field] = req.body[field];
        }
        if (updateData.company !== undefined) updateData.company = String(updateData.company).trim();

        // country/state/city resolved together against the master tables so the
        // integer country FK and the state/city names stay consistent.
        if (['country', 'state', 'city'].some((f) => req.body[f] !== undefined)) {
            const location = await resolveLocation({
                country: req.body.country !== undefined ? req.body.country : existing.country,
                state: req.body.state !== undefined ? req.body.state : existing.state,
                city: req.body.city !== undefined ? req.body.city : existing.city,
            });
            updateData.country = location.country;
            updateData.state = location.state;
            updateData.city = location.city;
        }

        await db(TABLES.CLIENTS).where('id', id).update(updateData);
        const updated = await db(TABLES.CLIENTS).where('id', id).first();
        res.status(200).json({ success: true, message: "Client updated successfully", data: updated });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteClient = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.CLIENTS).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Client not found" });

        const proposalUsing = await db('crm_proposals').where('client_id', id).first();
        const invoiceUsing = await db('crm_invoices').where('client_id', id).first();
        if (proposalUsing || invoiceUsing) {
            return res.status(400).json({ success: false, message: "Cannot delete a client with proposals or invoices" });
        }

        await db(TABLES.CLIENTS).where('id', id).update({ status: 'In-active', updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: "Client deactivated successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== CLIENT CONTACTS ====================

export const addClientContact = async (req, res) => {
    try {
        const { id } = req.params;
        const { first_name, last_name, email, phone, title, is_primary } = req.body;

        if (!first_name || !first_name.trim()) {
            return res.status(400).json({ success: false, message: "Contact first name is required" });
        }

        const client = await db(TABLES.CLIENTS).where('id', id).first();
        if (!client) return res.status(404).json({ success: false, message: "Client not found" });

        if (is_primary) {
            await db(TABLES.CONTACTS).where('client_id', id).update({ is_primary: false });
        }

        const [insertedId] = await db(TABLES.CONTACTS).insert({
            client_id: id,
            first_name: first_name.trim(),
            last_name: last_name || null,
            email: email || null,
            phone: phone || null,
            title: title || null,
            is_primary: Boolean(is_primary),
        });

        const newContact = await db(TABLES.CONTACTS).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Contact added successfully", data: newContact });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteClientContact = async (req, res) => {
    try {
        const { id, contactId } = req.params;
        const deleted = await db(TABLES.CONTACTS).where({ id: contactId, client_id: id }).del();
        if (!deleted) return res.status(404).json({ success: false, message: "Contact not found" });
        res.status(200).json({ success: true, message: "Contact deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// Lightweight list for dropdowns (proposal/invoice forms).
export const getClientOptions = async (req, res) => {
    try {
        const clients = await db(TABLES.CLIENTS).select('id', 'company', 'email').where('status', 'Active').orderBy('company', 'asc');
        res.status(200).json({ success: true, data: clients || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
