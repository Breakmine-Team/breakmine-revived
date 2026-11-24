# Launcher API

Loaded only with `?launcher=1`. The game installs `window.BreakmineLauncher` for
the host (`<webview>` + `executeJavaScript`) and also accepts messages posted to
the window.

A call:

```js
{ type: "breakmine:launcher:call", id: 1, method: "mods.list", params: {} }
```

The reply:

```js
{ type: "breakmine:launcher:result", id: 1, method: "mods.list", ok: true, result: [...] }
// or { ok: false, error: "..." }
```

Events are emitted as `{ type: "breakmine:launcher:event", event, data, time }`
(posted to the host and dispatched as a DOM `breakmine:launcher` event). Queued
events can be collected with `events.drain()`. `API_VERSION` is `1`.

## Auto sign-in

Pass the account in the URL: `?launcher=1&username=<name>&token=<jwt>` (or
`&password=<password>`). Failures emit `authFailed`.

## Methods

### `info()`
`{ apiVersion, gameVersion, launcherMode, signedIn, account, authError }`

### Accounts
- `accounts.get()` → `{ username, uuid, signedIn } | null`
- `accounts.list()` → the same account in an array
- `accounts.login({ username, password, uuid? })`
- `accounts.loginWithToken({ username, token, uuid? })`
- `accounts.logout()`

### Mods (local installation)
- `mods.list()` → installed mods with `id, name, author, version, description, license, icon, enabled, disk`
- `mods.setEnabled({ id, enabled })` → updated list
- `mods.installZip({ base64 })` → installs a `.zip` or `.jph` package: `{ id, mods }`
- `mods.uninstall({ id })` → updated list
- `mods.readPackage({ id })` → `{ id, filename, base64 }`: the installed mod
  rebuilt as a `.zip`, so the launcher can hand the bytes to an upload
- `mods.openFolder()` → opens the mods folder in the desktop launcher

### Mods (mods.breakmine.com)
The mods app (`wiki/app.py`) exposes an unauthenticated staging upload at
`POST /tempmod/upload/<id>` (`file` multipart field, `.zip` only, 50 MB max,
deleted after 5 minutes) and a matching `GET /tempmod/download/<id>`. CORS is
open on the mods host.

- `mods.upload({ id?, base64, filename? })` → stages a `.zip`:
  `{ id, url, message, expiresInSeconds: 300 }`. `id` is sanitized to
  `[a-zA-Z0-9_-]` and generated when omitted.
- `mods.download({ id })` → `{ id, base64, size }` for a staged package, throws
  once it has expired.
- `mods.searchSite({ q?, cat? })` → the catalogue JSON from `GET /api/mods`
  (`cat` is `mod` or `texture pack`).
- `mods.openUploadPage()` → opens `https://mods.breakmine.com/upload` in a
  browser. Publishing a catalogue entry is the site's own session-login form,
  so it cannot be done from the launcher without that Flask session.

### Server
- `server.getInfo()` → `{ singleplayer, connected, address, port }`
- `server.getPlayers()` → `{ connected, count, players: [{ uuid, username, displayName, gameType, ping }] }`
  for the server currently joined (the same list as the Tab overlay)
- `server.ping({ address, port? })` → raw status-protocol response, rejects
  after 10 s. (The game server's own `status` socket message only reports a
  player *count*, not names.)

### Discord
The mods app implements Discord as session-based OAuth at `/login/discord` →
`/callback`; there is no token/link API for a client to call.

- `discord.getInfo()` → `{ loginUrl, richPresence, details, state, paused }`,
  where `richPresence` is true when the desktop launcher is driving Discord RPC
- `discord.openLogin()` → opens `https://mods.breakmine.com/login/discord`

### Game
- `game.getState()` → `{ state, screen, world, paused, singleplayer, ... }`
- `events.drain()` → queued events

## Events

`ready`, `account`, `authFailed`, `gameState`.
