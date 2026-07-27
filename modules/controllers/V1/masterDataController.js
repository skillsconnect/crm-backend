import db from '../../../config/knex.js';

const TABLES = {
    COUNTRIES: 'ups_countries',
    STATES: 'ups_states',
    CITIES: 'ups_cities',
};

const currentUserId = (req) => req.user?.id || 1;

// These are shared platform-wide reference tables (used by jobs/colleges/
// companies elsewhere in SkillsConnect, not CRM-only), so deletes are always
// soft (is_deleted='Yes') — never a hard DELETE — to avoid corrupting data
// other parts of the platform depend on.

// ==================== COUNTRIES ====================

export const getCountries = async (req, res) => {
    try {
        const { search, status } = req.query;
        let query = db(TABLES.COUNTRIES).select('*').where('is_deleted', 'No').orderBy('name', 'asc');
        if (status) query = query.where('status', status);
        if (search) query = query.where('name', 'like', `%${search}%`);

        const countries = await query;
        res.status(200).json({ success: true, data: countries || [] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const saveCountry = async (req, res) => {
    try {
        const id = req.params.id || req.body.id;
        const { name, sortname, phonecode, status } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;

        if (!id && !trimmedName) {
            return res.status(400).json({ success: false, message: "Country name is required" });
        }

        if (id) {
            const existing = await db(TABLES.COUNTRIES).where('id', id).first();
            if (!existing) return res.status(404).json({ success: false, message: "Country not found" });

            const updateData = { updated_by: currentUserId(req) };
            if (trimmedName) updateData.name = trimmedName;
            if (sortname !== undefined) updateData.sortname = sortname;
            if (phonecode !== undefined) updateData.phonecode = phonecode;
            if (status) updateData.status = status;

            await db(TABLES.COUNTRIES).where('id', id).update(updateData);
            const updated = await db(TABLES.COUNTRIES).where('id', id).first();
            return res.status(200).json({ success: true, message: "Country updated successfully", data: updated });
        }

        const [insertedId] = await db(TABLES.COUNTRIES).insert({
            name: trimmedName,
            sortname: sortname || '',
            phonecode: phonecode || 0,
            status: status || 'Active',
            created_by: currentUserId(req),
            updated_by: currentUserId(req),
        });

        const newCountry = await db(TABLES.COUNTRIES).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "Country created successfully", data: newCountry });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteCountry = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.COUNTRIES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "Country not found" });

        const statesUsing = await db(TABLES.STATES).where({ country_id: id, is_deleted: 'No' }).first();
        if (statesUsing) {
            return res.status(400).json({ success: false, message: "Cannot delete a country that has states" });
        }

        await db(TABLES.COUNTRIES).where('id', id).update({ is_deleted: 'Yes', updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: "Country deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== STATES ====================

export const getStates = async (req, res) => {
    try {
        const { search, status, country_id, page = 1, limit = 100 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 100, 1);

        let query = db(`${TABLES.STATES} as s`)
            .leftJoin(`${TABLES.COUNTRIES} as c`, 'c.id', 's.country_id')
            .select('s.*', 'c.name as country_name')
            .where('s.is_deleted', 'No')
            .orderBy('s.name', 'asc');

        if (status) query = query.where('s.status', status);
        if (country_id) query = query.where('s.country_id', country_id);
        if (search) query = query.where('s.name', 'like', `%${search}%`);

        const totalRow = await query.clone().clearSelect().clearOrder().count('s.id as total').first();
        const states = await query.offset((pageNum - 1) * pageSize).limit(pageSize);

        res.status(200).json({
            success: true,
            data: states || [],
            pagination: { total: Number(totalRow?.total || 0), page: pageNum, limit: pageSize },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const saveState = async (req, res) => {
    try {
        const id = req.params.id || req.body.id;
        const { name, country_id, zone_id, status } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;

        if (!id && (!trimmedName || !country_id)) {
            return res.status(400).json({ success: false, message: "State name and country are required" });
        }

        if (id) {
            const existing = await db(TABLES.STATES).where('id', id).first();
            if (!existing) return res.status(404).json({ success: false, message: "State not found" });

            const updateData = { updated_by: currentUserId(req) };
            if (trimmedName) updateData.name = trimmedName;
            if (country_id !== undefined) updateData.country_id = country_id;
            if (zone_id !== undefined) updateData.zone_id = zone_id;
            if (status) updateData.status = status;

            await db(TABLES.STATES).where('id', id).update(updateData);
            const updated = await db(TABLES.STATES).where('id', id).first();
            return res.status(200).json({ success: true, message: "State updated successfully", data: updated });
        }

        const [insertedId] = await db(TABLES.STATES).insert({
            name: trimmedName,
            country_id,
            zone_id: zone_id || 1,
            status: status || 'Active',
            created_by: currentUserId(req),
            updated_by: currentUserId(req),
        });

        const newState = await db(TABLES.STATES).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "State created successfully", data: newState });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteState = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.STATES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "State not found" });

        const citiesUsing = await db(TABLES.CITIES).where({ state_id: id, is_deleted: 'No' }).first();
        if (citiesUsing) {
            return res.status(400).json({ success: false, message: "Cannot delete a state that has cities" });
        }

        await db(TABLES.STATES).where('id', id).update({ is_deleted: 'Yes', updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: "State deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

// ==================== CITIES ====================
// 48k+ rows — search or state_id filter is effectively required; listing
// without either still works but is capped by the normal page size.

export const getCities = async (req, res) => {
    try {
        const { search, status, state_id, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const pageSize = Math.max(parseInt(limit) || 50, 1);

        let query = db(`${TABLES.CITIES} as c`)
            .leftJoin(`${TABLES.STATES} as s`, 's.id', 'c.state_id')
            .select('c.*', 's.name as state_name')
            .where('c.is_deleted', 'No')
            .orderBy('c.name', 'asc');

        if (status) query = query.where('c.status', status);
        if (state_id) query = query.where('c.state_id', state_id);
        if (search) query = query.where('c.name', 'like', `%${search}%`);

        const totalRow = await query.clone().clearSelect().clearOrder().count('c.id as total').first();
        const cities = await query.offset((pageNum - 1) * pageSize).limit(pageSize);

        res.status(200).json({
            success: true,
            data: cities || [],
            pagination: { total: Number(totalRow?.total || 0), page: pageNum, limit: pageSize },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const saveCity = async (req, res) => {
    try {
        const id = req.params.id || req.body.id;
        const { name, state_id, status } = req.body;
        const trimmedName = name && name.trim() ? name.trim() : null;

        if (!id && (!trimmedName || !state_id)) {
            return res.status(400).json({ success: false, message: "City name and state are required" });
        }

        if (id) {
            const existing = await db(TABLES.CITIES).where('id', id).first();
            if (!existing) return res.status(404).json({ success: false, message: "City not found" });

            const updateData = { updated_by: currentUserId(req) };
            if (trimmedName) updateData.name = trimmedName;
            if (state_id !== undefined) updateData.state_id = state_id;
            if (status) updateData.status = status;

            await db(TABLES.CITIES).where('id', id).update(updateData);
            const updated = await db(TABLES.CITIES).where('id', id).first();
            return res.status(200).json({ success: true, message: "City updated successfully", data: updated });
        }

        const [insertedId] = await db(TABLES.CITIES).insert({
            name: trimmedName,
            state_id,
            status: status || 'Active',
            created_by: currentUserId(req),
            updated_by: currentUserId(req),
        });

        const newCity = await db(TABLES.CITIES).where('id', insertedId).first();
        res.status(201).json({ success: true, message: "City created successfully", data: newCity });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const deleteCity = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await db(TABLES.CITIES).where('id', id).first();
        if (!existing) return res.status(404).json({ success: false, message: "City not found" });

        await db(TABLES.CITIES).where('id', id).update({ is_deleted: 'Yes', updated_by: currentUserId(req) });
        res.status(200).json({ success: true, message: "City deleted successfully" });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
