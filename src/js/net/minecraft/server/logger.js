let rl = null;

const USE_COLORS = typeof process !== 'undefined' && !!process.stderr && process.stderr.isTTY;

function color(code) {
    if (!USE_COLORS) return (text) => text;
    return (text) => `\x1b[${code}m${text}\x1b[0m`;
}

const green = color(32);
const yellow = color(33);
const red = color(31);
const cyan = color(36);

function logLevel(level, thread, message, colorFn = (t) => t) {
    const now = new Date();
    const time = [
        now.getHours().toString().padStart(2, '0'),
        now.getMinutes().toString().padStart(2, '0'),
        now.getSeconds().toString().padStart(2, '0')
    ].join(':');

    const coloredPrefix = `[${time}] ${colorFn(`[${thread}/${level}]`)}`;
    console.log(`${coloredPrefix}: ${message}`);
}

const Logger = {
    info: (thread, message) => {
        logLevel('INFO', thread, message, green);
        rl?.prompt(true);
    },
    warn: (thread, message) => {
        logLevel('WARN', thread, message, yellow);
        rl?.prompt(true);
    },
    error: (thread, message) => {
        logLevel('ERROR', thread, message, red);
        rl?.prompt(true);
    },
    debug: (thread, message) => {
        logLevel('DEBUG', thread, message, cyan);
        rl?.prompt(true);
    },
    setRl: (newrl) => {
        rl = newrl;
    }
};

export default Logger;
