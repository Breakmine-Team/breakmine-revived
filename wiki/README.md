# Breakmine Wiki

Flask app serving two sites from one process: the **wiki** (port 8001) and the
**mods** library (port 8004). All state lives in a SQLite database plus an
uploads directory.

## Run with Docker (recommended)

This folder is part of the larger `js-minecraft` repo, which has its own
`docker-compose.yml` at the repo root for the game client. That one is
unrelated to the wiki — always start the wiki with `-f` pointing here:

```sh
cp .env.example .env      # then set WIKI_ADMIN_PASSWORD
docker compose -f wiki/docker-compose.yml up -d --build
```

Add that as an alias if you use it often, e.g. `alias wikiup='docker compose -f wiki/docker-compose.yml'` from the repo root. Running `docker compose up -d` from inside `wiki/` works too and picks up the same file and `.env`.

- Wiki: `https://$WIKI_HOSTNAME` (container port 8001)
- Mods: `https://$MODS_HOSTNAME` (container port 8004)
- Logs: `docker compose logs -f wiki`
- Stop: `docker compose down`  (**keeps data**)

Ports are only `expose`d, not published: Traefik routes to them over the Docker
network, so nothing is bound on the host. Set the two hostnames in `.env` to
match your `Host(...)` rules.

For a quick local check without Traefik, publish a port on the fly:

```sh
docker run --rm -p 8001:8001 -e WIKI_ADMIN_PASSWORD=dev -v breakmine-wiki-data:/data \
  breakmine-wiki:latest
```

### Data persistence

Everything that must survive a restart lives in `/data` inside the container:

| Path                | Contents                                    |
| ------------------- | ------------------------------------------- |
| `/data/wiki.db`     | users, pages, revisions, mods, comments     |
| `/data/mod_files/`  | uploaded mod / texture pack `.zip` files    |
| `/data/temp_mods/`  | 5-minute temp uploads (safe to lose)        |

`/data` is the named volume `breakmine-wiki-data`, so data survives
`docker compose down`, container recreation, image rebuilds and `up -d`. The
image seeds the volume with the current `wiki.db` and `mod_files/` the first
time the volume is created, so a fresh clone comes up with the existing pages
and mods already in place.

Verify the volume is in use:

```sh
docker volume inspect breakmine-wiki-data
docker compose exec wiki ls -la /data
```

### Backup and restore

```sh
# Backup to ./data/backup-<date>.tar.gz
docker run --rm -v breakmine-wiki-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/backup-$(date +%F).tar.gz -C /data .

# Restore (stops the app, overwrites, starts again)
docker compose down
docker run --rm -v breakmine-wiki-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/backup-2026-01-01.tar.gz -C /data"
docker compose up -d
```

To use a host directory instead of the named volume, replace the `volumes:`
entry in `docker-compose.yml` with `./data:/data` (the directory must be
writable by uid 1000, the container user; `sudo chown -R 1000:1000 data`).

### Resetting the admin password

`WIKI_ADMIN_PASSWORD` is the source of truth for the `kai` account: it is
applied on every boot, so change it in `.env` and restart.

```sh
docker compose up -d --force-recreate wiki    # after editing .env
```

Or one-shot, without a terminal prompt:

```sh
docker compose run --rm -e WIKI_ADMIN_PASSWORD='new-password' \
  wiki python3 app.py --reset-kai-password --init-only
```

## Run without Docker

```sh
pip install -r requirements.txt
python3 app.py
```

Data defaults to the current directory. Useful flags/env:

- `WIKI_DATA_DIR` — where `wiki.db`, `mod_files/` and `temp_mods/` live
  (default `.`).
- `WIKI_ADMIN_PASSWORD` — set the `kai` password without an interactive prompt.
- `WIKI_SECRET_KEY` — cookie signing key (default: built-in constant).
- `WIKI_PORT` / `MODS_PORT` — listen ports (default 8001 / 8004).
- `WIKI_DEBUG=1` — enable the Werkzeug debugger when waitress is not installed.
- `--reset-kai-password` — set a new `kai` password; `--init-only` — create or
  migrate the database and exit without serving.
