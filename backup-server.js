const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8081;
const DATA_DIR = process.env.DATA_DIR || '/data';
const WORLD_FILE = path.join(DATA_DIR, 'world_data.bin');

const server = http.createServer((req, res) => {
    if (req.url === '/world_data.bin') {
        if (!fs.existsSync(WORLD_FILE)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('World data file not found');
            return;
        }

        const stat = fs.statSync(WORLD_FILE);
        const fileSize = stat.size;

        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileSize,
            'Content-Disposition': 'attachment; filename=world_data.bin'
        });

        const stream = fs.createReadStream(WORLD_FILE);
        stream.pipe(res);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Backup server running. Download world data at /world_data.bin\n');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backup] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[Backup] Download world data at http://0.0.0.0:${PORT}/world_data.bin`);
    console.log(`[Backup] Serving file: ${WORLD_FILE}`);
});

process.on('SIGTERM', () => {
    console.log('[Backup] Shutting down...');
    server.close(() => process.exit(0));
});
