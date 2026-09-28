# Auth/skin server (cors.js).
#
# cors.js is CommonJS but pulls in ESM game modules via require(), which only
# works on Node >= 22.12 (require(esm)). Node 24 matches the local toolchain.
FROM node:24-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=6006

# better-sqlite3, bcrypt and discord-rpc have prebuilt binaries for linux, but
# fall back to compiling from source when none matches, so keep a toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

COPY cors.js ./

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
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6006)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "cors.js"]
