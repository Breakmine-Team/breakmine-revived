# syntax=docker/dockerfile:1
#
# The whole breakmine site in one image:
#   :8000  the game client, served statically by nginx
#   :6006  the auth/skin API (cors.js)
#
# This mirrors the old nixpacks start command, which ran cors.js and the static
# server side by side, so a single Dokploy app covers both domains.

# ---- asset generation stage --------------------------------------------------
FROM node:24-slim AS assets

WORKDIR /app

# src/resources.js (7 MB) and src/js/assetManifest.js are generated from the
# source tree by scripts/build-assets.js and are gitignored, so a fresh checkout
# cannot serve the client without this step. The script uses only node builtins,
# so no npm install is needed here.
COPY scripts/ ./scripts/
COPY src/ ./src/
RUN node scripts/build-assets.js

# ---- runtime stage -----------------------------------------------------------
FROM node:24-slim

# nginx serves the client; the toolchain is only needed if better-sqlite3,
# bcrypt or discord-rpc have no prebuilt binary for the platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
        nginx python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=6006

WORKDIR /app

# package-lock.json is gitignored, so it is usually absent from a fresh checkout
# and `npm ci` refuses to run without it. Prefer the lock when it is there.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev --no-audit --no-fund; \
    else \
        npm install --omit=dev --no-audit --no-fund; \
    fi \
    && npm cache clean --force

# --- the website --------------------------------------------------------------
# No vite build: index.html is already a native-ESM entry point and the source
# tree has no bare npm imports, so the raw sources are servable as-is.
COPY --from=assets /app/src/ /app/public/src/
COPY index.html style.css /app/public/
COPY libraries/ /app/public/libraries/

# --- the auth API -------------------------------------------------------------
# cors.js only needs this handful of game modules at require() time; the rest of
# src/ stays out of the API's path (~2 MB instead of 130 MB).
COPY cors.js ./
COPY libraries/ ./libraries/
COPY src/js/net/minecraft/client/fs/ ./src/js/net/minecraft/client/fs/
COPY src/js/net/minecraft/lib/ ./src/js/net/minecraft/lib/
COPY src/js/net/minecraft/server/logger.js ./src/js/net/minecraft/server/logger.js

# mime.types is required, otherwise every .js is served as octet-stream and the
# game will not boot. Listening on 8000 in the image rather than rewriting the
# stock config at runtime, so the port cannot silently end up as 80.
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 8000;
    server_name _;

    root /app/public;
    index index.html;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        try_files $uri =404;
    }
}
EOF

COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e
# nginx runs in the foreground as PID 1 so it receives SIGTERM on redeploy; the
# API runs alongside it, exactly like the old `concurrently` start command.
node /app/cors.js &
exec nginx -g 'daemon off;'
EOF
RUN chmod +x /app/entrypoint.sh

# Accounts (auth.db), the JWT secret and uploaded skins live here. Losing this
# volume signs everyone out and orphans every skin.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000 6006

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "Promise.all([fetch('http://127.0.0.1:8000/'),fetch('http://127.0.0.1:'+(process.env.PORT||6006)+'/')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"

CMD ["/app/entrypoint.sh"]
