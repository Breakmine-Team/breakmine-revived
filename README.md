# Minecraft recode in JavaScript (Breakmine: Revived)

### IMPORTANT
Before running the game, *make sure* you type: `node scripts/build-assets.js`!!!

### Account API transports (HTTP and WebSocket)

The account API (`cors.js`, port 6006) serves every route over HTTP and over a
WebSocket at `/api-ws`. The socket exists for networks that block plain HTTP
requests to the API host but let WebSocket traffic through: `AuthLib` in the
client tries it first and falls back to HTTP when the socket is unavailable.
Skin and cape *images* are still fetched over HTTP.

Protocol: one JSON request per frame, one JSON reply per frame.

```json
{"id": "3", "method": "POST", "path": "/api/login",
 "headers": {"Content-Type": "application/json"},
 "body": "{\"username\":\"steve\",\"password\":\"secret\"}"}
```

```json
{"id": "3", "status": 200, "contentType": "application/json; charset=utf-8",
 "json": {"token": "...", "expiresIn": "7d"}}
```

Binary requests (skin uploads) send `bodyBase64` instead of `body`; replies that
are not JSON come back as `bodyBase64`. Each frame is relayed to the loopback
HTTP API, so both transports share one implementation and one set of
validation rules. Only `/api/`, `/skin/` and `/cape/` paths are accepted, so the
socket cannot be used to proxy the rest of the site. A connection is limited to
120 requests per 15 minutes (10 of them to `/api/login` and `/api/register`) and
8 requests in flight; the HTTP rate limiters skip these relayed requests,
because they all arrive from loopback under a single address.

```
wss://api.breakmine.com/api-ws
```

### Multiplayer server switches

These environment variables are read by the dedicated server at startup. Use
`true`, `1`, `yes`, or `on` to enable a switch; leave it unset for normal
Minecraft behavior.

- `SERVER_DISABLE_TNT=true` — right-clicking TNT no longer detonates it.
- `SERVER_DISABLE_LIQUID_FLOW=true` — water and lava stay where they are; they
  no longer spread, fall, decay, or solidify on contact.

```sh
SERVER_DISABLE_TNT=true SERVER_DISABLE_LIQUID_FLOW=true node server.js
```

### Connection protection (anti-DDoS and anti-VPN)

The dedicated multiplayer server rate-limits new connections and the messages
players send, and can refuse players whose address belongs to a VPN, proxy, or
hosting provider. Singleplayer is unaffected.

Anti-DDoS is on by default: 12 connection attempts per 10 seconds and 5
simultaneous sockets per address, 256 sockets server-wide, roughly 900 messages
in a burst and 300 per second per player, plus a 1-minute limit to log in. An
address that keeps tripping the limits is blocked for 10 minutes. A small
amount of burst is normal (chunk loading), so these values are far above real
play.

Anti-VPN is also on by default and looks each new address up once, caching the
answer for six hours. The default provider, [ip-api.com](https://ip-api.com),
needs no account (free, non-commercial, HTTP only). For more accurate results
and datacenter detection use [proxycheck.io](https://proxycheck.io) with a key:

```sh
SERVER_ANTIVPN_KEY=your-key SERVER_ANTIVPN_PROVIDER=proxycheck node server.js
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `SERVER_ANTIDDOS` | `true` | Set to `false` to disable connection/message flood limits. |
| `SERVER_ANTIVPN` | `true` | Set to `false` to disable address reputation checks. |
| `SERVER_ANTIVPN_PROVIDER` | `ipapi` | `ipapi` or `proxycheck`. |
| `SERVER_ANTIVPN_KEY` | — | proxycheck.io key. Without it the server uses ip-api.com. |
| `SERVER_ANTIVPN_BLOCK_HOSTING` | `true` | Also refuse datacenter/hosting addresses. |
| `SERVER_ANTIVPN_FAIL_OPEN` | `true` | Allow players when the lookup service is unreachable. Set to `false` to refuse them instead. |
| `SERVER_ANTIVPN_TIMEOUT_MS` | `3000` | Lookup timeout. |
| `SERVER_TRUST_PROXY` | local proxy | Which peers may report the real client address: unset trusts loopback/LAN peers, `true` trusts any peer, `false` ignores forwarded headers, or a comma-separated list of proxy addresses. |

Refused players see a disconnect screen explaining why. Loopback and LAN
addresses are never looked up.

#### Behind a reverse proxy (play.breakmine.com)

When players reach the server through a proxy, every socket comes from the
proxy, so the per-IP limits and the VPN verdict would be shared by the whole
server. The server therefore reads the player's address from `CF-Connecting-IP`
(set by Cloudflare, which always overwrites it) or from the last
`X-Forwarded-For` entry, but only when the connecting peer is trusted.

By default that means loopback and LAN, which covers a proxy running on the
same machine or network (nginx, Caddy, cloudflared). If your proxy reaches the
server from a public address, name it:

```sh
SERVER_TRUST_PROXY=203.0.113.10 node server.js
```

`SERVER_TRUST_PROXY=true` trusts any peer and is only safe when the game port
itself is not reachable from the internet. Keep it firewalled or bound to the
proxy — otherwise a client can claim any address and dodge the per-IP limits
and the VPN check.

### Server-side mods

A server can ship its own mods to clients. Put mod folders in `servermods/`
next to the server (for the main server) or in `worlds/<name>/servermods/` for
an additional server. Each folder uses the normal mod layout, with a
`ModData.js` at its root.

```
servermods/
  cooldeco/
    ModData.js
    blocks/
    textures/
```

The server registers the mods' blocks and items for its own simulation, then
sends the same files to every player on join. Clients load them for that
connection only and unregister their blocks, textures, recipes, tabs and
commands when they disconnect, so server content never leaks into another
server or singleplayer.

`serverMods = false` in `serverconfig.conf` disables both loading and sending
server-side mods. `serverModsDir` overrides the folder name.

### Installing server mods from URLs

Set `SERVER_MOD_URLS` to a comma-, semicolon- or whitespace-separated list of
mod pages or direct download links. At startup the server downloads them and
installs each archive into the active server's `servermods/` folder before
loading mods:

```sh
SERVER_MOD_URLS="https://mods.breakmine.com/view/10,https://mods.breakmine.com/view/12" node server.js
```

A `/view/<id>` page is resolved to its newest `/download/<id>/v/<version>`
archive automatically. Direct download URLs are also accepted. A mod installed
this way is replaced when the server starts again, so restarting picks up the
current version from the URL. Failed downloads are logged and the server still
starts with the mods that did install.

### Licensing
- The main rendering library is [three.js](https://github.com/mrdoob/three.js/)
- 64 bits number implementation by [long.js](https://github.com/dcodeIO/long.js)
- AES encryption implemented by [aes-js](https://github.com/ricmoo/aes-js)
- BigInt extension for RSA encryption by [bigint-mod-arith](https://github.com/juanelas/bigint-mod-arith)
- Public key parser implemented by [asn1-parser.js](https://git.coolaj86.com/coolaj86/asn1-parser.js)
- Minecraft chat component parser by [mc-chat-format](https://github.com/janispritzkau/mc-chat-format)
<hr>

NOT OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG.