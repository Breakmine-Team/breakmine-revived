#!/bin/sh
set -e

# A named volume created by an older root-owned deployment, or a bind mount,
# arrives owned by root. The game runs as the unprivileged `node` user and
# needs to write worlds, accounts, secrets and downloaded mods there, so hand
# the data directory over before dropping privileges.
if [ "$(id -u)" = "0" ]; then
    data_dir="${DATA_DIR:-/data}"
    mkdir -p "$data_dir"

    # Only walk the tree when something is actually not owned by node; a large
    # world should not be re-chowned on every boot.
    if [ -n "$(find "$data_dir" ! -user node -print -quit 2>/dev/null)" ]; then
        chown -R node:node "$data_dir" || true
    fi

    exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
