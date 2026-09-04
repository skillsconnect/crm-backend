// Location normalisation for CRM records (leads, clients, …).
//
// The CRM tables are inconsistent by design/legacy:
//   - `country` is an INTEGER FK to ups_countries.id  (NOT NULL, default 0)
//   - `state` / `city` are VARCHAR(100) holding the *name* (what the leads
//     table + UI have always stored)
//
// Callers (CSV import, OCR, API clients) may pass a name, a numeric id, or a
// blank for any of the three. This resolves whatever comes in against the
// shared master tables and returns values shaped for the columns above:
//   { country: <int>, state: <string|null>, city: <string|null> }
//
// ups_* master tables are platform-wide reference data; rows are soft-deleted
// with is_deleted = 'Yes', so every lookup filters is_deleted = 'No'.
import db from '../../config/knex.js';

const TABLES = {
    COUNTRIES: 'ups_countries',
    STATES: 'ups_states',
    CITIES: 'ups_cities',
};

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const isNumericId = (v) => /^\d+$/.test(String(v).trim());

// Bulk imports resolve the same handful of place names thousands of times.
// Callers can pass a plain object as `cache` (e.g. one per CSV import) to
// collapse those into a single query each.
const cached = async (cache, key, loader) => {
    if (!cache) return loader();
    if (!(key in cache)) cache[key] = await loader();
    return cache[key];
};

const resolveCountryId = async (country, cache) => {
    if (isBlank(country)) return 0;
    const raw = String(country).trim();
    if (isNumericId(raw)) return Number(raw);

    const lower = raw.toLowerCase();
    return cached(cache, `country:${lower}`, async () => {
        const row =
            (await db(TABLES.COUNTRIES)
                .where('is_deleted', 'No')
                .whereRaw('LOWER(name) = ?', [lower])
                .select('id')
                .first()) ||
            (await db(TABLES.COUNTRIES)
                .where('is_deleted', 'No')
                .whereRaw('LOWER(TRIM(sortname)) = ?', [lower])
                .select('id')
                .first());
        return row ? row.id : 0;
    });
};

const resolveStateRow = async (state, countryId, cache) => {
    if (isBlank(state)) return null;
    const raw = String(state).trim();

    return cached(cache, `state:${countryId || 0}:${raw.toLowerCase()}`, async () => {
        const base = () => db(TABLES.STATES).where('is_deleted', 'No').select('id', 'name');
        const match = (qb) =>
            isNumericId(raw) ? qb.where('id', Number(raw)) : qb.whereRaw('LOWER(name) = ?', [raw.toLowerCase()]);

        // Prefer a state that belongs to the resolved country; fall back to a
        // global match so a wrong/blank country doesn't drop a valid state.
        let row = null;
        if (countryId) row = await match(base()).where('country_id', countryId).first();
        if (!row) row = await match(base()).first();

        if (row) return row;
        return isNumericId(raw) ? null : { id: null, name: raw };
    });
};

const resolveCityName = async (city, stateId, cache) => {
    if (isBlank(city)) return null;
    const raw = String(city).trim();

    return cached(cache, `city:${stateId || 0}:${raw.toLowerCase()}`, async () => {
        const base = () => db(TABLES.CITIES).where('is_deleted', 'No').select('name');
        const match = (qb) =>
            isNumericId(raw) ? qb.where('id', Number(raw)) : qb.whereRaw('LOWER(name) = ?', [raw.toLowerCase()]);

        let row = null;
        if (stateId) row = await match(base()).where('state_id', stateId).first();
        if (!row) row = await match(base()).first();

        if (row) return row.name;
        return isNumericId(raw) ? null : raw;
    });
};

/**
 * @param {{country?: any, state?: any, city?: any}} input
 * @param {{cache?: object}} [opts] pass a shared `cache` object across a batch
 * @returns {Promise<{country: number, state: string|null, city: string|null}>}
 */
export const resolveLocation = async (input = {}, opts = {}) => {
    const { cache } = opts;
    const country = await resolveCountryId(input.country, cache);
    const stateRow = await resolveStateRow(input.state, country, cache);
    const city = await resolveCityName(input.city, stateRow?.id, cache);
    return {
        country,
        state: stateRow ? stateRow.name : null,
        city,
    };
};

export default resolveLocation;
