const WebSocket = require('ws');
const https = require('https');
const { fork } = require('child_process');
const { initServer, onConnection, stopServer, verifyConnection } = require('./ServerRuntime.js');
const security = require('./security.js');
const Logger = require('./logger.js').default;
const config = require('./config.js').default;
const { installServerModsFromEnv } = require('./serverModDownloads.js');
const { IsomorphicFilesystem } = require('../client/fs/IsomorphicFilesystem.js');

let log = Logger;
const PORT = config.port;
const fs = new IsomorphicFilesystem();

// Set on every child a multiserver process starts. Such a child is pinned to
// one server, whose world files it owns, so it may not switch worlds.
const MULTISERVER_CHILD_ENV = 'MULTISERVER_CHILD';
// "main:6008,second:6009", so a child can name every sibling's port in
// /server list without guessing from its own configuration.
const MULTISERVER_PORTS_ENV = 'MULTISERVER_PORTS';


if (process.env.DATA_DIR) {
    const nodeFs = require('fs');
    const nodePath = require('path');
    if (!nodeFs.existsSync(process.env.DATA_DIR)) {
        nodeFs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    }

    // The image ships a default serverconfig.conf next to the code, but only
    // the data volume survives a redeploy. Seed the volume once so the main
    // server reads (and /op writes) /data/serverconfig.conf rather than the
    // copy baked into the image.
    const shippedConfig = nodePath.join(__dirname, '..', '..', '..', '..', '..', 'serverconfig.conf');
    const volumeConfig = nodePath.join(process.env.DATA_DIR, 'serverconfig.conf');
    try {
        if (!nodeFs.existsSync(volumeConfig) && nodeFs.existsSync(shippedConfig)) {
            nodeFs.copyFileSync(shippedConfig, volumeConfig);
            log.info('Server', `Seeded ${volumeConfig} from the default server config`);
        }
    } catch (e) {
        log.warn('Server', `Could not seed serverconfig.conf: ${e.message}`);
    }

    process.chdir(process.env.DATA_DIR);
    log.info('Server', `Working directory set to ${process.env.DATA_DIR}`);
}

let wss = null;
let supervisor = null;

// Multiserver mode
// ----------------
// The whole game runtime (world, players, tick loop) is module state, so one
// process can only ever host one world. A deployment that lists two or more
// servers in `servers` therefore runs this file as a supervisor: it starts one
// child per server, each pinned to its own world directory and port, and keeps
// them alive. The supervisor itself never binds a port and never loads a world.
//
// The list is opt-in on purpose. Servers detected under ./worlds/ are still
// only offered by /server, so a stray directory does not start a listener.
function getMultiServerTargets() {
    if (config.requestedServer) {
        return null;
    }
    if (!Array.isArray(config.servers) || config.servers.length < 2) {
        return null;
    }

    const targets = [];
    const byPort = new Map();

    for (const name of config.listServers()) {
        const port = config.loadConfig(name).port;

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            log.error('MultiServer', `Server "${name}" has port "${port}"; set port = <number> in its serverconfig.conf.`);
            process.exit(1);
        }
        if (byPort.has(port)) {
            log.error('MultiServer', `Servers "${byPort.get(port)}" and "${name}" both use port ${port}; give each its own port in its serverconfig.conf.`);
            process.exit(1);
        }

        byPort.set(port, name);
        targets.push({ name, port });
    }

    return targets;
}

// Child output goes through pipes so each line can be tagged with the server it
// came from; two interleaved untagged logs are useless in a container.
function prefixOutput(stream, name, out) {
    if (!stream) return;

    let pending = '';
    stream.setEncoding('utf8');

    stream.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
            out.write(`[${name}] ${line}\n`);
        }
    });

    stream.on('end', () => {
        if (pending.length > 0) {
            out.write(`[${name}] ${pending}\n`);
        }
        pending = '';
    });
}

function runMultiServer(targets) {
    const running = new Map();
    const retries = new Map();
    let stopping = false;

    const ports = targets.map(t => `${t.name}:${t.port}`).join(',');

    log.info('MultiServer', `Running ${targets.length} servers: ${ports.replace(/,/g, ', ')}`);

    function launch(target) {
        if (stopping) return;

        const env = {
            ...process.env,
            SERVER_PORT: String(target.port),
            [MULTISERVER_CHILD_ENV]: '1',
            [MULTISERVER_PORTS_ENV]: ports
        };
        // Under Electron process.execPath is the app binary, which would open a
        // window instead of running the server. This makes it behave as node.
        if (process.versions.electron) {
            env.ELECTRON_RUN_AS_NODE = '1';
        }

        const child = fork(__filename, ['--server', target.name, '--port', String(target.port)], {
            cwd: process.cwd(),
            env,
            silent: true
        });
        const startedAt = Date.now();

        running.set(target.name, child);
        prefixOutput(child.stdout, target.name, process.stdout);
        prefixOutput(child.stderr, target.name, process.stderr);

        child.on('error', (e) => {
            log.error('MultiServer', `${target.name} could not start: ${e.message}`);
        });

        child.on('exit', (code, signal) => {
            running.delete(target.name);
            if (stopping) return;

            const retry = retries.get(target.name) || { attempts: 0, timer: null };
            if (Date.now() - startedAt > 60 * 1000) {
                retry.attempts = 0;
            }

            if (code === 0 && !signal) {
                log.info('MultiServer', `${target.name} exited`);
                retries.set(target.name, retry);
                return;
            }

            // A crashing server is restarted with a growing delay rather than a
            // tight loop that would fill the disk with logs.
            const delay = Math.min(30 * 1000, 1000 * Math.pow(2, Math.min(retry.attempts, 5)));
            retry.attempts += 1;
            retry.timer = setTimeout(() => {
                retry.timer = null;
                launch(target);
            }, delay);
            if (typeof retry.timer.unref === 'function') retry.timer.unref();
            retries.set(target.name, retry);

            log.warn('MultiServer', `${target.name} stopped (${signal || `exit ${code}`}), restarting in ${Math.round(delay / 1000)}s`);
        });

        log.info('MultiServer', `${target.name} started on port ${target.port} (pid ${child.pid})`);
    }

    for (const target of targets) {
        launch(target);
    }

    return {
        stop() {
            stopping = true;

            for (const retry of retries.values()) {
                if (retry.timer) clearTimeout(retry.timer);
            }

            const children = [...running.values()];
            if (children.length === 0) {
                process.exit(0);
                return;
            }

            // Children save their world on SIGTERM, so give them time to finish
            // before anything is killed outright.
            const killTimer = setTimeout(() => {
                for (const child of children) {
                    try {
                        child.kill('SIGKILL');
                    } catch (e) {
                    }
                }
                process.exit(0);
            }, 25 * 1000);
            if (typeof killTimer.unref === 'function') killTimer.unref();

            let remaining = children.length;
            for (const child of children) {
                child.once('exit', () => {
                    remaining -= 1;
                    if (remaining > 0) return;
                    clearTimeout(killTimer);
                    process.exit(0);
                });
                try {
                    child.kill('SIGTERM');
                } catch (e) {
                }
            }
        }
    };
}

async function main() {
    const targets = getMultiServerTargets();
    if (targets !== null) {
        supervisor = runMultiServer(targets);
        return;
    }

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
    if (supervisor !== null) {
        supervisor.stop();
        return;
    }

    stopServer();
    try {
        if (wss) wss.close();
    } catch (e) {
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
