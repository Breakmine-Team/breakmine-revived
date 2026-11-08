# syntax=docker/dockerfile:1
#
# cors.js on :6006. It answers the API on every hostname, and additionally
# serves the game client when the request is for the site hostname
# (SITE_HOSTNAMES, default breakmine.com), so one container can back both
# breakmine.com and api.breakmine.com. tunnel.js runs alongside it on :6007
# to relay WebSocket game traffic.

# ---- asset generation stage --------------------------------------------------
FROM node:24-slim AS assets

WORKDIR /app

# src/resources.js (7 MB) and src/js/assetManifest.js are generated from the
# source tree by scripts/build-assets.js and are gitignored, so a fresh checkout
# cannot serve the client without this step. The script uses only node builtins,
# so no npm install is needed here.
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY libraries/ ./libraries/
COPY .well-known/ ./.well-known/
COPY index.html style.css loading.gif catalog.json openapi.json api-docs.html _headers CNAME serve.json ./
RUN node scripts/build-assets.js \
    && node scripts/build-site.js

# ---- runtime stage -----------------------------------------------------------
FROM node:24-slim

# better-sqlite3, bcrypt and discord-rpc have prebuilt binaries for linux, but
# fall back to compiling from source when none matches, so keep a toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates util-linux findutils \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=6006 \
    TUNNEL_PORT=6007 \
    SITE_DIR=/app/public \
    SITE_HOSTNAMES=breakmine.com

WORKDIR /app

# package-lock.json is gitignored, so it is often missing from a fresh checkout
# and `npm ci` refuses to run without it. Prefer the lock when it is there.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev --no-audit --no-fund; \
    else \
        npm install --omit=dev --no-audit --no-fund; \
    fi \
    && npm cache clean --force

# --- the game client, served for SITE_HOSTNAMES ------------------------------
# scripts/build-site.js assembles exactly the tree the Nixpacks deployment
# served (index.html, src/, libraries/, loading.gif, CNAME, ...).
COPY --from=assets /app/public/ /app/public/

# API discovery (RFC 9727). The catalog is copied in twice on purpose:
# .well-known/api-catalog is the well-known URI, catalog.json is the document
# itself, which the catalog may be served from per RFC 9727 s4. Both are read
# by cors.js from /app (not /app/public), so it gets its own copy below.

# --- the auth API -------------------------------------------------------------
COPY cors.js ./

# --- the WebSocket tunnel relay ----------------------------------------------
# tunnel.js relays game traffic over WS on TUNNEL_PORT. It needs only the `ws`
# package and node builtins, both already present.
COPY tunnel.js ./
# cors.js reads these from its own directory when serving the catalog,
# rel=service-desc and rel=service-doc.
COPY catalog.json openapi.json api-docs.html ./

# server.js boots ServerRuntime, which loads the block/item registry. Those
# modules import client UI code (creative inventory tabs, the furnace screen,
# font icons, ...), so the multiplayer server needs the whole JS source tree,
# not just fs/server/util. Taking it from the assets stage also guarantees the
# generated assetManifest.js is present.
COPY libraries/ ./libraries/
COPY --from=assets /app/src/js/ ./src/js/
COPY server.js ./

# Named volume target. secrets.json is generated here on first boot, so it is
# never baked into the image; persisting /data keeps logins valid across rebuilds.
RUN mkdir -p /data && chown -R node:node /data /app

# Start as root only long enough to repair the ownership of an existing volume
# (older deployments and bind mounts are root-owned), then run as `node`.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

VOLUME ["/data"]
EXPOSE 6006 6007 6008

# The image runs either the HTTP API (cors.js, PORT) or the multiplayer server
# (server.js, SERVER_PORT), so probe whichever one the container is running.
# The server speaks WebSocket only, so a TCP connect is the right check there.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
    CMD if [ -n "$SERVER_PORT" ]; then node -e "const net=require('net');const s=net.connect(+process.env.SERVER_PORT,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"; else node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6006)+'/',{headers:{host:process.env.SITE_HOSTNAMES?.split(',')[0]||'breakmine.com'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; fi

# Run the API and the tunnel relay together. `kill 0` forwards SIGTERM/SIGINT
# to the whole process group so both children shut down gracefully.
# If SERVER_PORT is set, run the multiplayer server instead.
# `exec` matters for the multiplayer server: it makes node PID 1 so Docker's
# SIGTERM reaches its shutdown handler directly instead of orphaning it behind
# bash, which is what left the old instance running on redeploy.
CMD ["bash", "-c", "if [ -n \"$SERVER_PORT\" ]; then exec node /app/server.js; else trap 'kill 0' SIGTERM SIGINT; node cors.js & node tunnel.js & wait; fi"]
