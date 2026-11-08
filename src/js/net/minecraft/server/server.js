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

    try {
        await installServerModsFromEnv();
    } catch (e) {
        log.warn('Server', `Could not install startup mods: ${e.message}`);
    }
    log.info('Server', `Startup mods finished in ${Date.now() - startupStartedAt}ms`);

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

    if (!server) {
        server = require('http').createServer();
    }

    const { attachAdminPanel } = require('./admin.js');
    attachAdminPanel(server);

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
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
