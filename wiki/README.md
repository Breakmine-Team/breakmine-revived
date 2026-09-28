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

- Wiki: `https://wiki.breakmine.com` (container port 8001)
- Mods: `https://mods.breakmine.com` (container port 8004)
- Logs: `docker compose logs -f wiki`
- Stop: `docker compose down`  (**keeps data**)

### Routing (Dokploy / Coolify / Traefik)

Ports are only `expose`d, not published - Traefik reaches them over the Docker
network. Routing is **not** configured in `docker-compose.yml`: on Dokploy and
Coolify the proxy is driven by the Domains field in the panel, and hand-written
`traefik.*` labels are ignored (file provider) or collide with the routers the
panel generates (docker provider).

In the panel, add a domain per site, pointing at the container port:

| Domain                   | Port | Serves            |
| ------------------------ | ---- | ----------------- |
| `wiki.breakmine.com`     | 8001 | wiki articles     |
| `mods.breakmine.com`    | 8004 | mods / downloads  |

A `404` from Traefik means no router matched that hostname - the domain is
missing from the panel, or its port does not match the table above. Point the
DNS for both names at the proxy host and let the panel issue the certificate.

The container ports are pinned to 8001/8004 in `docker-compose.yml` on purpose:
platforms inject their own `PORT` variable, and if the app followed it the wiki
would move off 8001 and stop matching the router.

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

### Discord login

Optional. Set both in `.env` and the "Login with Discord" button appears on the
login page and in the login modals on both sites:

```
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
```

The client secret is a credential: it is read from the environment only and is
never stored in the repo. `.env` is gitignored. If it is ever pasted into a
chat, issue or commit, reset it in the Discord developer portal.

Register these exact redirect URIs in the Discord portal - one per host, since
the app is served from two:

```
https://wiki.breakmine.com/callback
https://mods.breakmine.com/callback
```

The callback URL is built from the host that started the flow, so both hosts
work from the same code. This relies on the proxy forwarding `X-Forwarded-Proto`
and `X-Forwarded-Host`, which Traefik does by default; the app trusts exactly
one hop of those headers, which is safe because container ports are only
reachable on the proxy network.

How accounts work:

- First Discord login creates a local user row with that Discord username, a
  random unusable password, and the Discord ID in `users.discord_id`.
- Later logins match on the Discord ID, so renaming your Discord username does
  not create a second account.
- A Discord login can never take over an existing password account. If the
  Discord username is already taken, the new row gets a numeric suffix
  (`kai2`), which matters because the `kai` account can edit the wiki.
- The `kai` account is not linked to Discord. To let a Discord user administer
  the wiki, point its `discord_id` at the `kai` row or keep using the password.
- The `email` scope is requested but not stored - there is no email column.

## Public JSON API

Read-only and unauthenticated, on the mods host only (`mods.breakmine.com`), so
the game client and anything else can read the catalogue without a session. CORS
is open like the rest of the mods app. Errors are JSON too - `{"error": "..."}`
with a matching status - so a client never has to parse an HTML error page.

| Endpoint                    | Returns                                    |
| --------------------------- | ------------------------------------------ |
| `GET /api/mods`             | `{"count", "mods"}` - newest first         |
| `GET /api/mods/search`      | same, but `q` is required (400 without it) |
| `GET /api/mods/<id>/files`  | `{"mod", "count", "files"}` - per version   |
| `GET /api/mods/<id>/comments` | `{"mod", "count", "comments"}`           |

`/api/mods` and `/api/mods/search` both take optional `cat` (`mod` or
`texture pack`, 400 on anything else) and `q` (matched against name and
description). Each entry in `mods` carries `url` and `download_url` as absolute
URLs; `/files` gives one `url` per version with `latest: true` on the current
one. Fetching a `download_url` is what increments `downloads` - reading the API
does not.

```sh
curl https://mods.breakmine.com/api/mods
curl 'https://mods.breakmine.com/api/mods/search?q=zoom'
curl https://mods.breakmine.com/api/mods/1/files
curl https://mods.breakmine.com/api/mods/1/comments
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
