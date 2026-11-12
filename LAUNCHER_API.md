# Launcher API

The game has a small control surface for the desktop launcher. It is only
installed when the page is loaded with `?launcher=1`, so a normal browser visit
sees nothing new.

In launcher mode the game:

1. signs in with the account the launcher passes in the URL (see
   [Auto sign-in](#2-auto-sign-in)),
2. exposes `window.BreakmineLauncher` for the host to call,
3. listens for launcher messages (`breakmine:launcher:call`),
4. emits events (`ready`, `account`, `gameState`, `authFailed`).

Implementation: [`src/js/net/minecraft/client/launcher/LauncherApi.js`](src/js/net/minecraft/client/launcher/LauncherApi.js)

---

## 1. Enabling launcher mode

```
https://breakmine.com/?launcher=1
```

The flag is read once, when the game starts. Without it the API object is never
created and no messages are handled.

The launcher uses Electron's `<webview>`, so there are two directions to wire up:

| Direction | How |
| --- | --- |
| Launcher → game | `webview.executeJavaScript(...)` (recommended), or `webview.send()` + a preload that re-posts the message |
| Game → launcher | a preload that uses `ipcRenderer.sendToHost` (recommended), or polling `events.drain()` |

---

## 2. Auto sign-in

Sign-in happens automatically from the URL query string:

| Parameter | Meaning |
| --- | --- |
| `launcher` | `1` turns launcher mode on |
| `username` | Account name to sign in as |
| `token` | Bearer token for that account - applied directly, no network call |
| `password` | Password, used only when no `token` is given. The account is created if the username does not exist yet |

```js
// launcher side
const url = new URL('https://breakmine.com/');
url.searchParams.set('launcher', '1');
url.searchParams.set('username', account.username);
url.searchParams.set('token', account.token); // URLSearchParams encodes for you

webview.src = url.toString();
```

`token` wins over `password`. If neither is present the game just boots, and the
launcher can sign in afterwards by calling `accounts.loginWithToken(...)` or by
sending a `breakmine:launcher:auth` message.

A successful sign-in behaves exactly like the in-game Account screen: the token
is stored in `localStorage`, `settings.loggedIn` is set, the cape is refreshed,
and the main menu is rebuilt so *Multiplayer* becomes available. A failing
sign-in never blocks the game: it stays signed out, `info().authError` holds the
message, and an `authFailed` event is emitted.

> Passwords and tokens travel in the URL, so keep the URL out of logs and
> history. The message form (`breakmine:launcher:auth`) avoids this entirely and
> is the better choice when the account is not known before load.

---

## 3. Calling the API

Every method returns JSON-serializable data, so `executeJavaScript` can hand the
result straight back to the launcher. Promises are awaited by Electron.

```js
const account = await webview.executeJavaScript('BreakmineLauncher.accounts.get()');
const mods = await webview.executeJavaScript('BreakmineLauncher.mods.list()');
```

The object appears as soon as the game boots (textures load asynchronously), so
`did-finish-load` may fire before it exists. Wait for the `ready` event, or poll:

```js
async function waitForLauncherApi(webview, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await webview.executeJavaScript('typeof window.BreakmineLauncher !== "undefined"');
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The game did not expose the launcher API in time.');
}
```

Methods throw (reject in the host) with a readable message on bad input or a
failed login.

---

## 4. Methods

### `info()`

```json
{
  "apiVersion": 1,
  "gameVersion": "5.2.1a",
  "launcherMode": true,
  "signedIn": true,
  "account": { "username": "steve", "uuid": "…", "signedIn": true },
  "authError": null
}
```

### `accounts`

| Method | Params | Returns |
| --- | --- | --- |
| `accounts.get()` | - | The signed-in account, or `null` |
| `accounts.list()` | - | `[]` or `[account]` (the game holds one session at a time) |
| `accounts.login({ username, password, uuid? })` | `password` is sent to the auth server; the account is registered when it does not exist | The signed-in account |
| `accounts.loginWithToken({ username, token, uuid? })` | Applies a token the launcher already owns; no network call | The signed-in account |
| `accounts.logout()` | - | `null` |

An account object is `{ username, uuid, signedIn }`. `uuid` is `null` when the
game generated a profile without an explicit UUID; pass `uuid` to `login` /
`loginWithToken` if the launcher manages fixed offline UUIDs.

```js
await webview.executeJavaScript(
  `BreakmineLauncher.accounts.loginWithToken(${JSON.stringify({ username, token })})`
);
```

### `mods`

| Method | Params | Returns |
| --- | --- | --- |
| `mods.list()` | - | Installed mods |
| `mods.setEnabled({ id, enabled })` | Loads or unloads the mod immediately and persists the choice | Installed mods |
| `mods.installZip({ base64 })` | `.zip` contents as base64 (a `data:` URL is accepted too) | `{ id, mods }` |
| `mods.uninstall({ id })` | Deletes a mod that lives in the game's mod storage | Installed mods |

Each entry of the mod list is:

```json
{
  "id": "fireworks",
  "name": "Fireworks Mod",
  "author": "someone",
  "version": "1.0.0",
  "description": "…",
  "license": "MIT",
  "icon": "data:image/png;base64,…",
  "enabled": true,
  "disk": false
}
```

`disk: true` marks a mod read from the launcher's `mods/` folder; the game
cannot delete those (`mods.uninstall` throws), so remove the folder and restart.

```js
const zip = fs.readFileSync(modPath);           // main process
const base64 = zip.toString('base64');
await webview.executeJavaScript(
  `BreakmineLauncher.mods.installZip({ base64: ${JSON.stringify(base64)} })`
);
```

Toggling a mod takes effect for the next server join; it does not disconnect a
running session.

### `game`

| Method | Params | Returns |
| --- | --- | --- |
| `game.getState()` | - | Snapshot of the game state |

```json
{
  "state": "menu",
  "inGame": false,
  "guiOpen": true,
  "screen": "GuiMainMenu",
  "loading": false,
  "pointerLock": false,
  "focusLocked": false,
  "hasFocus": false,
  "paused": false,
  "hudHidden": false,
  "world": null,
  "singleplayer": false,
  "tvmode": false,
  "mobile": false,
  "fps": 0,
  "maxFps": 0,
  "time": 1762850000000,
  "player": { "x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0, "health": 0 }
}
```

`state` is one of `boot`, `loading`, `menu`, `ingame`, `gui`, `paused`.

### `events`

| Method | Params | Returns |
| --- | --- | --- |
| `events.drain()` | - | Every event queued since the last call, oldest first |

---

## 5. Events

Events let the launcher react without polling. They are delivered in this order:

1. `window.breakmineHost.emit(payload)` — the preload bridge, when installed,
2. `postMessage` to `window.parent` / `window.opener` — works inside an iframe;
   in a `<webview>` guest it is best effort,
3. a `breakmine:launcher` DOM `CustomEvent` inside the page,
4. the queue behind `events.drain()`.

Every event is queued (the last 100 are kept), so a launcher can poll for events
it missed.

Envelope:

```json
{
  "type": "breakmine:launcher:event",
  "event": "account",
  "data": { "username": "steve", "uuid": "…", "signedIn": true },
  "time": 1762850000000
}
```

| Event | When | `data` |
| --- | --- | --- |
| `ready` | The API is installed, before auto sign-in runs | Same shape as `info()` |
| `account` | The session changed - via this API, the launcher, or the in-game Account screen | Account object, or `null` after logout |
| `gameState` | The summary changed (`state`, `screen`, `world`, `paused`, `singleplayer`) | `{ state, screen, world, paused, singleplayer }` |
| `authFailed` | URL sign-in or `breakmine:launcher:auth` failed | `{ error }` |

### Receiving events with a webview preload

```js
// preload.js used by <webview preload="file:///…/preload.js">
const { contextBridge, ipcRenderer } = require('electron');

// game -> launcher
contextBridge.exposeInMainWorld('breakmineHost', {
  emit: (event) => ipcRenderer.sendToHost('breakmine:launcher', event),
});

// launcher -> game (optional, forwards webview.send() into the page)
ipcRenderer.on('breakmine:launcher', (_event, message) => {
  window.postMessage(message, '*');
});
```

```js
// launcher main process
webview.addEventListener('ipc-message', (event) => {
  if (event.channel !== 'breakmine:launcher') return;
  const message = event.args[0];

  if (message.type === 'breakmine:launcher:event' && message.event === 'account') {
    updateAccountBadge(message.data);
  }
});
```

### Polling instead

```js
setInterval(async () => {
  const events = await webview.executeJavaScript('BreakmineLauncher.events.drain()');
  for (const event of events) handleEvent(event);
}, 1000);
```

---

## 6. Message protocol (launcher → game)

Messages are ordinary `postMessage` payloads or `webview.send()` payloads
forwarded by the preload above. Anything without a `breakmine:launcher:` type is
ignored.

### Call a method

```json
{
  "type": "breakmine:launcher:call",
  "id": 7,
  "method": "accounts.loginWithToken",
  "params": { "username": "steve", "token": "…" }
}
```

`method` is the dotted name from section 4 (`info`, `accounts.get`,
`mods.setEnabled`, `game.getState`, …). `params` is always an object.

Reply:

```json
{
  "type": "breakmine:launcher:result",
  "id": 7,
  "method": "accounts.loginWithToken",
  "ok": true,
  "result": { "username": "steve", "uuid": "…", "signedIn": true },
  "time": 1762850000000
}
```

Failures use `"ok": false` and an `error` string instead of `result`:

```json
{ "type": "breakmine:launcher:result", "id": 7, "method": "mods.setEnabled", "ok": false, "error": "mods.setEnabled requires 'id'." }
```

### Push an account (no URL credentials)

```json
{
  "type": "breakmine:launcher:auth",
  "id": 1,
  "account": { "username": "steve", "token": "…", "uuid": "optional-uuid" }
}
```

`id` is optional; include it to get a `breakmine:launcher:result` back (with
`method: "breakmine:launcher:auth"`). Without it, watch for the `account` or
`authFailed` event.

```js
webview.send('breakmine:launcher', {
  type: 'breakmine:launcher:auth',
  id: 1,
  account: { username, token },
});
```

---

## 7. Notes

- The API exists only with `?launcher=1`; nothing is exposed in a normal browser.
- `executeJavaScript` and the message protocol share the same handlers, so both
  paths behave identically and report the same errors.
- Signing in from the launcher writes the same settings as the in-game Account
  screen, so the choice survives restarts. `accounts.logout()` clears the stored
  token.
- `accounts.login` talks to the auth server (`api.breakmine.com` unless the
  player changed the API URL); `accounts.loginWithToken` never does.
- Mod edits are written to the same storage the in-game Mods screen uses.
