import Logger from './logger.js';
import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import config from './config.js';

const log = Logger;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// Unit spellings, longest first so "months" is never read as "m" + "onths".
// "m" and "mo" mean months (the /tempban argument is a number of days, so its
// units are the long ones); minutes are spelled "min".
const UNITS = [
    [['years', 'year', 'yrs', 'yr', 'y'], YEAR],
    [['months', 'month', 'mons', 'mon', 'mo', 'm'], MONTH],
    [['weeks', 'week', 'wks', 'wk', 'w'], WEEK],
    [['days', 'day', 'd'], DAY],
    [['hours', 'hour', 'hrs', 'hr', 'h'], HOUR],
    [['minutes', 'minute', 'mins', 'min'], MINUTE],
    [['seconds', 'second', 'secs', 'sec', 's'], 1000]
];

// Bans live in the active server's own directory, next to its world data:
//   main    -> <root>/bans.json
//   server2 -> <root>/worlds/server2/bans.json
// Each entry is { name, reason, by, bannedAt, expires }, where `expires` is an
// epoch timestamp in ms or null for a permanent ban.

function getBansFile() {
    return path.join(config.getServerDir(config.server), 'bans.json');
}

function normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function readBans() {
    const file = getBansFile();
    if (!fs.existsSync(file)) {
        return {};
    }

    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (e) {
        log.warn('Bans', `Could not read ${file}: ${e.message}`);
        return {};
    }
}

function writeBans(bans) {
    const dir = config.getServerDir(config.server);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getBansFile(), JSON.stringify(bans, null, 2));
}

/**
 * Parse a /tempban duration: a bare number is days, a unit suffix scales it.
 * Accepts 30, 4m, 4d, 4w, 4months, 1yr (plus h/min/s). Returns ms, or null.
 */
function parseDuration(input) {
    if (typeof input !== 'string') {
        return null;
    }

    const text = input.trim().toLowerCase().replace(/\s+/g, '');
    const match = /^(\d+(?:[.,]\d+)?)([a-z]*)$/.exec(text);
    if (!match) {
        return null;
    }

    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    const unit = match[2];
    if (!unit) {
        return Math.round(amount * DAY);
    }

    for (const [names, ms] of UNITS) {
        if (names.includes(unit)) {
            return Math.round(amount * ms);
        }
    }
    return null;
}

/** Human-readable length, e.g. "4 months", "2 days", "30 seconds". */
function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
        return '0 seconds';
    }

    const units = [[YEAR, 'year'], [MONTH, 'month'], [WEEK, 'week'], [DAY, 'day'], [HOUR, 'hour'], [MINUTE, 'minute']];
    const parts = [];

    // Round to the nearest second first: a ban set to "exactly 4 days" is a
    // fraction of a millisecond short by the time it is shown, and must read
    // "4 days" rather than "3 days 23 hours".
    let rest = Math.max(1000, Math.round(ms / 1000) * 1000);

    for (const [unit, name] of units) {
        const count = Math.floor(rest / unit);
        if (count <= 0) {
            continue;
        }
        parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
        rest -= count * unit;

        // Two units is plenty for a ban length ("1 month 2 weeks").
        if (parts.length === 2) {
            break;
        }
    }

    if (parts.length === 0) {
        const seconds = Math.max(1, Math.round(ms / 1000));
        return `${seconds} second${seconds === 1 ? '' : 's'}`;
    }

    return parts.join(' ');
}

/** The ban entry for a username, or null. Expired bans are dropped here. */
function isBanned(name) {
    const key = normalizeName(name);
    if (!key) {
        return null;
    }

    const bans = readBans();
    const entry = bans[key];
    if (!entry) {
        return null;
    }

    if (entry.expires && entry.expires <= Date.now()) {
        delete bans[key];
        try {
            writeBans(bans);
        } catch (e) {
            log.warn('Bans', `Could not drop expired ban for ${name}: ${e.message}`);
        }
        return null;
    }

    return entry;
}

/**
 * Lift a ban. Returns the entry that was removed, or null if there was none.
 */
function unban(name) {
    const key = normalizeName(name);
    if (!key) {
        return null;
    }

    const bans = readBans();
    const entry = bans[key];
    if (!entry) {
        return null;
    }

    delete bans[key];
    writeBans(bans);
    return entry;
}

/**
 * Ban a username (which does not have to be online). `expires` is a length in
 * ms; omit it for a permanent ban. Re-banning replaces the old entry.
 */
function banPlayer(name, { reason = '', by = '', expires = null } = {}) {
    const key = normalizeName(name);
    if (!key) {
        return null;
    }

    const bans = readBans();
    const entry = {
        name: String(name),
        reason: String(reason || '').slice(0, 256),
        by: String(by || 'server'),
        bannedAt: Date.now(),
        expires: expires ? Date.now() + expires : null
    };

    bans[key] = entry;
    writeBans(bans);
    return entry;
}

/**
 * The text a banned player is shown on the disconnect screen: what happened,
 * why, and when it lifts. The expiry is sent as a {{until:<epoch ms>}} marker
 * rather than a date, because only the client knows the player's time zone.
 */
function describeBan(entry) {
    const reason = (entry && entry.reason) ? entry.reason : 'Banned by an operator';

    const lines = [
        '§cYou are banned from this server!',
        '§7Reason: §f' + reason
    ];

    console.log('e');
    if (entry && entry.expires) {
        lines.push(`§oYour ban will be removed on {{until:${entry.expires}}}`);
    } else {
        lines.push('§oYour ban will not be removed automatically.');
    }

    return lines.join('\n');
}

export {
    parseDuration,
    formatDuration,
    isBanned,
    unban,
    banPlayer,
    describeBan,
    getBansFile
};
