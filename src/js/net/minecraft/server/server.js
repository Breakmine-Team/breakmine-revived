const WebSocket = require('ws');
const https = require('https');
const { initServer, onConnection, stopServer } = require('./ServerRuntime.js');
const Logger = require('./logger.js').default;
const config = require('./config.js').default;
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

// Initialize the world (loads config, world data, block registry, tick loop).
initServer();

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

const wss = new WebSocket.Server({ server: server });
server.listen(PORT, config.host);
log.info('Server', `Minecraft server running!!! (v47)`);
log.info('Server', `Listening on ${server ? 'wss' : 'ws'}://${config.host}:${PORT}`);

wss.on('connection', onConnection);

function shutdown() {
    stopServer();
    try {
        wss.close();
    } catch (e) {
        // Ignore close errors on shutdown.
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
