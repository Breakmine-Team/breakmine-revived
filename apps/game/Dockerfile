# syntax=docker/dockerfile:1
#
# cors.js on :6006. It answers the API on every hostname, and additionally
# serves the game client when the request is for the site hostname
# (SITE_HOSTNAMES, default breakmine.com), so one container can back both
# breakmine.com and api.breakmine.com.

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

# better-sqlite3, bcrypt and discord-rpc have prebuilt binaries for linux, but
# fall back to compiling from source when none matches, so keep a toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=6006 \
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
# No vite build: index.html is already a native-ESM entry point and the source
# tree has no bare npm imports, so the raw sources are servable as-is.
COPY --from=assets /app/src/ /app/public/src/
COPY index.html style.css /app/public/
COPY libraries/ /app/public/libraries/

# API discovery (RFC 9727). The catalog is copied in twice on purpose:
# .well-known/api-catalog is the well-known URI, catalog.json is the document
# itself, which the catalog may be served from per RFC 9727 s4. Both are read
# by cors.js from /app (not /app/public), so it gets its own copy below.
COPY .well-known/ /app/public/.well-known/
COPY catalog.json openapi.json api-docs.html /app/public/
COPY _headers /app/public/_headers

# --- the auth API -------------------------------------------------------------
COPY cors.js ./
# cors.js reads these from its own directory when serving the catalog,
# rel=service-desc and rel=service-doc.
COPY catalog.json openapi.json api-docs.html ./

# cors.js requires these two game modules directly:
#   src/js/net/minecraft/client/fs/IsomorphicFilesystem.js -> ./Filesystem.js, ../lib/pako.js
#   src/js/net/minecraft/server/logger.js
# Copy only those (~2 MB) instead of the whole 130 MB source tree.
COPY libraries/ ./libraries/
COPY src/js/net/minecraft/client/fs/ ./src/js/net/minecraft/client/fs/
COPY src/js/net/minecraft/lib/ ./src/js/net/minecraft/lib/
COPY src/js/net/minecraft/server/logger.js ./src/js/net/minecraft/server/logger.js

# Named volume target. secrets.json is generated here on first boot, so it is
# never baked into the image; persisting /data keeps logins valid across rebuilds.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 6006

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6006)+'/',{headers:{host:process.env.SITE_HOSTNAMES?.split(',')[0]||'breakmine.com'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "cors.js"]
