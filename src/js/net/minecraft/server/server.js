const WebSocket = require('ws');
const https = require('https');
const { initServer, onConnection, stopServer, verifyConnection } = require('./ServerRuntime.js');
const security = require('./security.js');
const Logger = require('./logger.js').default;
const config = require('./config.js').default;
const { installServerModsFromEnv } = require('./serverModDownloads.js');
const { IsomorphicFilesystem } = require('../client/fs/IsomorphicFilesystem.js');

let log = Logger;
const PORT = config.port;
const fs = new IsomorphicFilesystem();

// Change to data directory if set (for Docker persistence)
if (process.env.DATA_DIR) {
    const nodeFs = require('fs');
    if (!nodeFs.existsSync(process.env.DATA_DIR)) {
        nodeFs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    }
    process.chdir(process.env.DATA_DIR);
    log.info('Server', `Working directory set to ${process.env.DATA_DIR}`);
}

let wss = null;

async function main() {
    const startupStartedAt = Date.now();

    // Install SERVER_MOD_URLS before initServer() so downloaded mods are part
    // of the first load and get sent to players on join.
    try {
        await installServerModsFromEnv();
    } catch (e) {
        log.warn('Server', `Could not install startup mods: ${e.message}`);
    }
    log.info('Server', `Startup mods finished in ${Date.now() - startupStartedAt}ms`);

    // Load SSL certificate and key if available
    let server = null;
    let options = {};

    try {
        if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
            options = {
                cert: fs.readFileSync('cert.pem'),
                key: fs.readFileSync('key.pem')
            };
            server = https.createServer(options);
            log.info('Server', 'WSS enabled using cert.pem and key.pem');
        }
    } catch (e) {
        log.error('Server', 'Failed to load SSL certificates: ' + e.message);
    }

    // Without certs: create a plain HTTP server so the admin panel and the
    // WebSocket can share the same port.
    if (!server) {
        server = require('http').createServer();
    }

    // Admin panel (passcode-protected world upload/download) on the same port.
    const { attachAdminPanel } = require('./admin.js');
    attachAdminPanel(server);

    // Anti-DDoS admission check: floods and blocked addresses are refused
    // during the HTTP upgrade, before a WebSocket or any game state exists.
    wss = new WebSocket.Server({
        server: server,
        verifyClient: (info, callback) => {
            const verdict = verifyConnection(info);
            if (verdict.accepted) {
                callback(true);
                return;
            }
            log.warn('Security', `Refused ${verdict.ip || 'unknown address'}: ${verdict.reason || 'connection refused'}`);
            callback(false, verdict.code || 403, verdict.message || 'Connection refused');
        }
    });
    wss.on('connection', (ws, req) => onConnection(ws, req));

    // Open the port before the synchronous world load. Traefik and clients can
    // establish a connection immediately; Node does not run the connection
    // callbacks until initServer() returns, so no player sees a half-loaded
    // world. Keep the header timeout high enough for that initial load.
    server.headersTimeout = 5 * 60 * 1000;
    server.requestTimeout = 5 * 60 * 1000;
    server.on('error', (e) => {
        log.error('Server', `Listener failed: ${e.message}`);
        process.exit(1);
    });
    server.listen(PORT, config.host, () => {
        log.info('Server', `Socket listening on ${config.host}:${PORT}`);
    });
    log.info('Server', `Socket open on ${config.host}:${PORT}; loading world...`);

    // Initialize the world (loads config, world data, block registry, tick loop).
    const initStartedAt = Date.now();
    initServer();
    log.info('Server', `World initialized in ${Date.now() - initStartedAt}ms`);

    log.info('Server', `Minecraft server running!!! (v47)`);
    log.info('Server', `Listening on ${server ? 'wss' : 'ws'}://${config.host}:${PORT}`);
    log.info('Security', security.describeSettings());
    if (process.env.ADMIN_PASSCODE) {
        log.info('Server', `Admin panel enabled at http://${config.host}:${PORT}/admin`);
    } else {
        log.warn('Server', 'Admin panel disabled (set ADMIN_PASSCODE env variable to enable it)');
    }

}

main().catch((e) => {
    log.error('Server', `Failed to start: ${e.message}`);
    process.exit(1);
});

function shutdown() {
    stopServer();
    try {
        if (wss) wss.close();
    } catch (e) {
        // Ignore close errors on shutdown.
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
