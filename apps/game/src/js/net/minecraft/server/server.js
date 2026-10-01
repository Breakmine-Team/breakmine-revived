const WebSocket = require('ws');
const https = require('https');
const { initServer, onConnection, stopServer } = require('./ServerRuntime.js');
const Logger = require('./logger.js').default;
const config = require('./config.js').default;
const { IsomorphicFilesystem } = require('../client/fs/IsomorphicFilesystem.js');

let log = Logger;
const PORT = config.port;
const fs = new IsomorphicFilesystem();

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

const wss = new WebSocket.Server({ server: server, port: !server ? PORT : undefined, host: config.host });
if (server) {
    server.listen(PORT, config.host);
}
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
