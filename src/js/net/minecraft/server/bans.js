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




const UNITS = [
    [['years', 'year', 'yrs', 'yr', 'y'], YEAR],
    [['months', 'month', 'mons', 'mon', 'mo', 'm'], MONTH],
    [['weeks', 'week', 'wks', 'wk', 'w'], WEEK],
    [['days', 'day', 'd'], DAY],
    [['hours', 'hour', 'hrs', 'hr', 'h'], HOUR],
    [['minutes', 'minute', 'mins', 'min'], MINUTE],
    [['seconds', 'second', 'secs', 'sec', 's'], 1000]
];







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

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
        return '0 seconds';
    }

    const units = [[YEAR, 'year'], [MONTH, 'month'], [WEEK, 'week'], [DAY, 'day'], [HOUR, 'hour'], [MINUTE, 'minute']];
    const parts = [];

    let rest = Math.max(1000, Math.round(ms / 1000) * 1000);

    for (const [unit, name] of units) {
        const count = Math.floor(rest / unit);
        if (count <= 0) {
            continue;
        }
        parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
        rest -= count * unit;

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
