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

### Licensing
- The main rendering library is [three.js](https://github.com/mrdoob/three.js/)
- 64 bits number implementation by [long.js](https://github.com/dcodeIO/long.js)
- AES encryption implemented by [aes-js](https://github.com/ricmoo/aes-js)
- BigInt extension for RSA encryption by [bigint-mod-arith](https://github.com/juanelas/bigint-mod-arith)
- Public key parser implemented by [asn1-parser.js](https://git.coolaj86.com/coolaj86/asn1-parser.js)
- Minecraft chat component parser by [mc-chat-format](https://github.com/janispritzkau/mc-chat-format)
<hr>

NOT OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG.