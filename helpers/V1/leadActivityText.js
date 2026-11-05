// Activity rows migrated from the legacy (Perfex) CRM store a language key in
// `description` (e.g. "not_lead_activity_contacted") and the sprintf arguments
// as a PHP-serialized array in `additional_data`. This turns them back into the
// sentence the old CRM showed. Rows written by this app are plain text already
// and pass through unchanged.

const LEGACY_ACTIVITY_TEXT = {
    not_lead_activity_created: 'created lead',
    not_lead_activity_status_updated: '%s updated lead status from %s to %s',
    not_lead_activity_contacted: '%s contacted this lead on %s',
    not_activity_new_reminder_created: 'set a new reminder for %s with date %s',
    not_lead_activity_assigned_to: '%s assigned to %s',
    not_lead_activity_marked_lost: 'marked as lost',
    not_lead_activity_unmarked_lost: 'unmarked as lost',
    not_lead_activity_marked_junk: 'marked as junk',
    not_lead_activity_unmarked_junk: 'unmarked as junk',
    not_lead_activity_added_attachment: 'added attachment',
    not_lead_activity_created_proposal: 'created new proposal - %s',
};

// Minimal PHP unserialize for the flat arrays Perfex stores here. String
// lengths in PHP serialization are byte counts, so walk a UTF-8 buffer rather
// than the JS string.
const unserializePhpArray = (value) => {
    if (!value || typeof value !== 'string' || !value.startsWith('a:')) return [];
    const buf = Buffer.from(value, 'utf8');
    let pos = 0;

    const readUntil = (ch) => {
        const end = buf.indexOf(ch, pos);
        if (end === -1) throw new Error('bad serialized data');
        const out = buf.toString('utf8', pos, end);
        pos = end + 1;
        return out;
    };

    const readValue = () => {
        const type = String.fromCharCode(buf[pos]);
        pos += 2; // type + ':'
        switch (type) {
            case 's': {
                const len = Number(readUntil(':'));
                pos += 1; // opening quote
                const out = buf.toString('utf8', pos, pos + len);
                pos += len + 2; // closing quote + ';'
                return out;
            }
            case 'i':
            case 'd':
                return Number(readUntil(';'));
            case 'b':
                return readUntil(';') === '1';
            case 'N':
                return null;
            case 'a': {
                const count = Number(readUntil(':'));
                pos += 1; // '{'
                const arr = [];
                for (let i = 0; i < count; i++) {
                    readValue(); // key
                    arr.push(readValue());
                }
                pos += 1; // '}'
                return arr;
            }
            default:
                throw new Error(`unsupported serialized type ${type}`);
        }
    };

    try {
        const result = readValue();
        return Array.isArray(result) ? result : [];
    } catch {
        return [];
    }
};

const stripHtml = (value) => String(value ?? '').replace(/<[^>]*>/g, '').trim();

export const formatLeadActivityText = (row) => {
    const description = String(row?.description || '');
    const template = LEGACY_ACTIVITY_TEXT[description];
    if (!template) {
        // Unknown legacy key: make it readable rather than showing the raw key.
        if (/^not_[a-z_]+$/.test(description)) {
            return description.replace(/^not_(lead_)?(activity_)?/, '').replace(/_/g, ' ');
        }
        return description;
    }

    const args = unserializePhpArray(row?.additional_data).map(stripHtml);
    let i = 0;
    return template.replace(/%s/g, () => args[i++] ?? '').replace(/\s+/g, ' ').trim();
};
