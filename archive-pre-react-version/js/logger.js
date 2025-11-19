// Simple client-side logger for detailed runtime logging
// Features: timestamped messages, levels, in-memory buffer, optional send to server, download logs
const MAX_BUFFER = 2000;

function ts() {
    return new Date().toISOString();
}

function formatEntry(level, message, meta) {
    const entry = {
        ts: ts(),
        level,
        message: String(message),
        meta: meta || null,
    };
    return entry;
}

const buffer = [];

async function sendToServer(entry) {
    try {
        // default to same-origin /logs so the static server can receive logs
        const url = window.LOG_SERVER_URL !== undefined ? window.LOG_SERVER_URL : '/logs';
        if (!url) return false;
        const payload = JSON.stringify(entry);
        // Prefer sendBeacon for reliability during unload, but fall back to fetch so servers that expect JSON work reliably
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            const ok = navigator.sendBeacon(url, blob);
            if (ok) return true;
            // if sendBeacon failed, fall through to fetch
        }
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        });
        return true;
    } catch (err) {
        // ignore server send errors but record locally
        return false;
    }
}

function pushToBuffer(entry) {
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) buffer.shift();
}

function consoleOutput(entry) {
    const out = `[${entry.ts}] [${entry.level.toUpperCase()}] ${entry.message}`;
    if (entry.meta) {
        // Print meta separately for easier inspection
        switch (entry.level) {
            case 'debug':
                console.debug(out, entry.meta);
                break;
            case 'info':
                console.info(out, entry.meta);
                break;
            case 'warn':
                console.warn(out, entry.meta);
                break;
            case 'error':
                console.error(out, entry.meta);
                break;
            default:
                console.log(out, entry.meta);
        }
    } else {
        switch (entry.level) {
            case 'debug':
                console.debug(out);
                break;
            case 'info':
                console.info(out);
                break;
            case 'warn':
                console.warn(out);
                break;
            case 'error':
                console.error(out);
                break;
            default:
                console.log(out);
        }
    }
}

const logger = {
    debug(message, meta) {
        const entry = formatEntry('debug', message, meta);
        pushToBuffer(entry);
        consoleOutput(entry);
        sendToServer(entry);
    },
    info(message, meta) {
        const entry = formatEntry('info', message, meta);
        pushToBuffer(entry);
        consoleOutput(entry);
        sendToServer(entry);
    },
    warn(message, meta) {
        const entry = formatEntry('warn', message, meta);
        pushToBuffer(entry);
        consoleOutput(entry);
        sendToServer(entry);
    },
    error(message, meta) {
        const entry = formatEntry('error', message, meta);
        pushToBuffer(entry);
        consoleOutput(entry);
        sendToServer(entry);
    },
    getBuffer() {
        return buffer.slice();
    },
    clearBuffer() {
        buffer.length = 0;
    },
    downloadLogs(filename = `client-logs-${new Date().toISOString()}.json`) {
        try {
            const data = JSON.stringify(buffer, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            return true;
        } catch (err) {
            console.error('Failed to download logs', err);
            return false;
        }
    }
};

export { logger };
export default logger;