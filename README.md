# Minecraft recode in JavaScript (Breakmine: Revived)

### IMPORTANT
Before running the game, *make sure* you type: `node scripts/build-assets.js`!!!

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