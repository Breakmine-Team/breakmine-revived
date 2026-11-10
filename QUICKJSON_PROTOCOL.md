# QuickJSON protocol (JsonMultiplayer)

QuickJSON is the small, JSON-only multiplayer protocol used when the protocol
picker in Direct Connect is set to **QuickJSON** (internal id `jsonmultiplayer`).
It exists so that a lightweight server can be written with nothing more than a
WebSocket library and a JSON parser: every frame in both directions is a single
JSON object with a `type` field.

Reference implementation: [`src/js/net/minecraft/client/network/JsonMultiplayer.js`](src/js/net/minecraft/client/network/JsonMultiplayer.js)
Example server: [`quickjson-server.js`](quickjson-server.js)

---

## 1. Transport

| Property | Value |
| --- | --- |
| Transport | WebSocket (`ws://` or `wss://`) |
| Framing | One JSON object per text frame. No length prefix, no batching |
| Encoding | UTF-8 |
| Binary frames | Not part of the protocol; the client ignores them |
| Compression | None |
| Encryption | None |
| Version field | Only `handshake.version` (the client sends its Minecraft protocol version, currently `47`) |

Rules:

- Every message **must** be a JSON object with a string `type`. Anything else,
  including invalid JSON, is ignored by the client.
- Unknown `type` values are ignored by both sides. This is how optional
  extensions (section 8) coexist with the core protocol.
- A server may ignore any message it does not need.

---

## 2. Conventions

| Term | Meaning |
| --- | --- |
| Block state | `(blockId << 4) | metadata`, an integer. `0` is air. Sent as `blockState` |
| Block position | Integer world coordinates (`x`, `y`, `z`) |
| Chunk coordinates | `chunkX = floor(blockX / 16)`, same for `z` |
| `eid` | Entity id, assigned by the server, unique per connected player |
| `uuid` | Canonical UUID string `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, unique per player |
| Coordinates | Double world coordinates (`x`, `y`, `z`); `y` is the player's feet |
| Angles | Degrees (`yaw`, `pitch`), `0`–`360`. The client converts internally |
| `§` | Legacy colour-code prefix in chat text (`§e`, `§7`, ...) |

The client converts JSON coordinates and angles into its internal fixed-point
representation itself, so servers always send plain numbers.

---

## 3. Connection flow

Connection states on the client are `LOGIN` and `PLAY`. Messages marked
**PLAY** below are only processed once `loginSuccess` has been handled.

Minimum sequence for a joining player:

```
client -> server   {"type":"handshake","version":47,"nextState":"login","mods":[]}
client -> server   {"type":"login","username":"Steve"}

server -> client   {"type":"loginSuccess","uuid":"...","username":"Steve"}
server -> client   {"type":"joinGame","eid":2,"gamemode":1,"dimension":0,...}
server -> client   {"type":"spawnPosition","x":0,"y":10,"z":0}
server -> client   {"type":"time","time":6000}
server -> client   {"type":"position","x":0.5,"y":10,"z":0.5,"yaw":0,"pitch":0}
server -> client   {"type":"terrain","generator":"flat","viewDistance":4,"layers":[...]}
                   ... the client generates chunks itself; no "chunk" messages ...

client -> server   {"type":"move","x":0.5,"y":10,"z":0.5,"yaw":0,"pitch":0,"onGround":true}

server -> client   {"type":"keepAlive","id":1}          (every 15 s in the example server)
client -> server   {"type":"keepAlive","id":1}
```

The player is not spawned into the world by the client until `joinGame` has been
received, so `joinGame` must come before chunk, position or entity messages.

---

## 4. Client → server messages

### 4.1 `handshake`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `version` | integer | yes | Minecraft protocol version of the client (`47`) |
| `nextState` | string | yes | `"login"` normally; `"status"` or `"handshake"` otherwise |
| `mods` | array | no | `[{ "id": string, "name": string, "version": string }]` |

Sent directly after the socket opens, before `login`. A server may ignore it.

### 4.2 `login`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `username` | string | yes | Requested player name |

Logs the connection in. Exactly one per connection. The example server accepts
1–16 characters matching `[A-Za-z0-9_]` and otherwise substitutes
`"Player<eid>"`.

### 4.3 `keepAlive`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes | Echo of the id from the server's `keepAlive` |

Sent in reply to a server `keepAlive`. The client does not send unsolicited
keep-alives.

### 4.4 `chat`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message` | string | yes | Chat text or a `/command` |

The plain protocol has no command set; the example server treats every message
as chat. Empty/whitespace messages are dropped by the example server.

### 4.5 `move`

Emitted from the client's movement packets. Position and rotation fields are
included only for the parts that changed, so a message may carry only a
rotation, or only a position.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `onGround` | boolean | yes | Always present |
| `x`, `y`, `z` | numbers | conditional | Present when the position changed |
| `yaw`, `pitch` | numbers | conditional | Present when the rotation changed |

Servers should update only the fields that are present (the example server does
exactly that) and rebroadcast the resulting state to other players.

### 4.6 `placeBlock`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `z` | integers | yes | The block that was **clicked**, not the placement position |
| `face` | integer | yes | Clicked face `0`–`5` (see table below); `255` means "use item", not a placement |
| `blockId` | integer | yes | Id of the held item; `-1` when the hand is empty |
| `metadata` | integer | yes | Requested metadata `0`–`15`, or `-1` for the block's default |

Face values and the offset they add to the clicked block:

| `face` | Direction | Offset |
| --- | --- | --- |
| `0` | bottom | `(0, -1, 0)` |
| `1` | top | `(0, 1, 0)` |
| `2` | north | `(0, 0, -1)` |
| `3` | south | `(0, 0, 1)` |
| `4` | west | `(-1, 0, 0)` |
| `5` | east | `(1, 0, 0)` |

The server decides whether the placement is legal, applies it, and broadcasts
`blockChange` (section 5.8). The example server places only into air, rejects
`blockId` outside `1`–`255`, and caps metadata at `15`.

### 4.7 `dig`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `z` | integers | yes | The block being dug |
| `face` | integer | yes | Face `0`–`5` |
| `status` | integer | yes | `0` = started, `1` = cancelled, `2` = block broken |

The current client only ever sends `status: 2` when a break completes; `0` and
`1` are reserved for clients that stream dig progress. A server should change
the world only for `status: 2`, then broadcast `blockChange` with `blockState: 0`.

---

## 5. Server → client messages

### 5.1 `loginSuccess`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `uuid` | string | recommended | Player UUID; the client falls back to `00000000-0000-0000-0000-000000000002` if missing or malformed |
| `username` | string | yes | Player name shown to the client |

Switches the client from `LOGIN` to `PLAY` and installs the play handler. Must
be the first message after `login`.

### 5.2 `joinGame`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `eid` | integer | yes | The receiving player's own entity id (`entityId` is also accepted) |
| `gamemode` | integer | no | `0` survival, `1` creative, `3` spectator. Default `0` |
| `dimension` | integer | no | `0` overworld, `1` nether. Default `0` |
| `difficulty` | integer | no | Default `0` |
| `maxPlayers` | integer | no | Default `0` |
| `worldType` | string | no | Default `"default"` |

Tells the client to create the client world. Send before chunks or positions.

### 5.3 `spawnPosition`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `z` | numbers | yes | World spawn point, floored by the client |

Sets the world spawn (and the player's position, if a player already exists).

### 5.4 `position`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `z` | numbers | yes | Absolute player position |
| `yaw`, `pitch` | numbers | yes | Absolute rotation in degrees |

Teleports the receiving player. The client answers with a `move` message.
`flags` are not part of the JSON form; offsets are never used.

### 5.5 `chunk`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x`, `z` | integers | yes | Chunk coordinates |
| `mask` | integer | no | Bitmask of present 16-block sections; default `65535`; `0` unloads the chunk |
| `data` | string | yes | Base64 of the chunk payload (section 6) |
| `fullChunk` | boolean | no | Default `true`. Use `false` for partial updates |

Servers that use the terrain extension (section 7) omit `chunk` messages
altogether; the client generates the chunks locally instead.

### 5.6 `time`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `time` | integer | yes | World time in ticks, `0`–`23999` (`worldTime` is also accepted) |

### 5.7 `chat`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `text` | string | yes | Plain text with optional `§` colour codes (`message` is also accepted) |

Displayed in the chat overlay. Valid in both `LOGIN` and `PLAY`.

### 5.8 `blockChange`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `x`, `y`, `z` | integers | yes | Block position |
| `blockState` | integer | yes | `(blockId << 4) | metadata`; `0` removes the block |

### 5.9 `spawnPlayer`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `eid` | integer | yes | The other player's entity id |
| `uuid` | string | recommended | Unique per player; needed so entities do not collide |
| `username` | string | yes | Name tag for the entity |
| `x`, `y`, `z` | numbers | yes | Spawn position |
| `yaw`, `pitch` | numbers | no | Degrees, default `0` |
| `currentItem` | integer | no | Default `0`; stored but not rendered by the client |

Use the same `eid` for that player in later `entityTeleport` / `destroyEntities`
messages.

### 5.10 `entityTeleport`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `eid` | integer | yes | Entity to move |
| `x`, `y`, `z` | numbers | yes | New position |
| `yaw`, `pitch` | numbers | no | Degrees, default `0` |
| `onGround` | boolean | no | Default `false` |

Absolute movement of another entity; used for player movement updates.

### 5.11 `destroyEntities`  **PLAY**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `eids` | array of integers | yes | Entities to remove |

### 5.12 `keepAlive`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | integer | yes | Any number; the client echoes it in a `keepAlive` reply |

Harmless in both states. Servers usually send it on a timer (the example server
uses 15 s) to keep idle connections open.

### 5.13 `disconnect`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string | yes | Shown on the disconnect screen; `§` codes allowed |

Works in both `LOGIN` and `PLAY`. The server may close the socket afterwards.

---

## 6. Chunk payload format

`data` is base64 of the same payload the binary protocol uses, one section at a
time for every bit set in `mask`:

| Part | Size | Contents |
| --- | --- | --- |
| Block states | `16 × 16 × 16 × 2` = 8192 bytes | One **little-endian** `uint16` per block: `(blockId << 4) | metadata` |
| Block light | 2048 bytes | One nibble per block |
| Sky light | 2048 bytes | One nibble per block |

Block order inside a section is `y` outer, then `z`, then `x`:

```
index = (y << 8) | (z << 4) | x
```

Sections are concatenated in ascending `y`, and empty sections are skipped
entirely (their bit in `mask` is `0`). A single-section chunk is therefore
12288 bytes before base64 (8192 block bytes + 2048 + 2048 light bytes). Fully lit
sections fill both light arrays with `0xFF`.

Example: a flat world can be sent with `mask: 1` (bottom section only), `0xFF`
light, and `blockState` values following `bedrock` at `y=0`, `stone` for
`y=1..7`, `dirt` at `y=8`, `grass` at `y=9`, air above.

---

## 7. Terrain extension (client-side chunk generation)

Instead of sending `chunk` messages, a server can describe its terrain once and
let the client build the chunks. For generated worlds this removes nearly all
world-transfer traffic; afterwards only `blockChange` edits are sent.

```json
{"type":"terrain","generator":"flat","viewDistance":4,
 "layers":[{"from":0,"to":0,"block":7},
           {"from":1,"to":7,"block":1},
           {"from":8,"to":8,"block":3},
           {"from":9,"to":9,"block":2}]}
```

### 7.1 `terrain` (server → client)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `generator` | string | yes | Only `"flat"` is supported. Unknown generators are ignored, so the server must then send `chunk` messages |
| `layers` | array | yes | Block bands, applied in order so later layers override earlier ones |
| `viewDistance` | integer | no | Chunks the client keeps generated around the player, clamped to `2`–`8`; default `2` |
| `skyLight` | boolean | no | `true` (default) fills every generated section's sky light with `0xFF`; `false` leaves it dark |

Layer fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `block` | integer | yes | Block id `0`–`4095`; `0` clears the band |
| `from`, `to` | integers | one required | Inclusive `y` range. `y` may be used for a single block. Values outside `0`–`255` are clamped |
| `metadata` | integer | no | `0`–`15`, default `0` |

Behaviour:

- The client turns the descriptor into the chunk payload of section 6 (sections
  up to the highest layer, fully lit by default) and feeds it through the normal
  chunk pipeline, so lighting and meshing are unchanged.
- It generates chunks within `viewDistance` of the player at join and keeps that
  area generated as the player moves; generated chunks stay loaded.
- Send it after `joinGame`. If it arrives before the client world exists it is
  applied on the next tick.
- Send it once per connection (or again to change the terrain). `blockChange`
  remains the only way to modify blocks afterwards.
- The server still has to answer placement and breaking itself; because it
  defined the generator, it can compute the base block for any position (the
  example server does this from its layer table).
- A server that does not use this extension sends `chunk` messages as described
  in section 5; the client supports both in the same session.

## 8. Behaviour of the bundled example server

[`quickjson-server.js`](quickjson-server.js) implements only the message types
above, with these rules:

- Listens on port `25565` by default (`node quickjson-server.js 25999` for a
  different port).
- Generates a flat world inline; no world files, no saving. Block edits live in
  memory and are lost on restart.
- Sends one `terrain` descriptor (`viewDistance: 4`) and no `chunk` messages;
  the client generates its own 9×9 area of bottom-section chunks and keeps it
  generated as the player moves.
- Only `y` `0`–`15` exists in the sent chunks (`MAX_BUILD_Y = 15`). A placement
  above that is undone by sending `blockChange` with `blockState: 0`.
- Places only into air. If the target cell is occupied, the server replies with
  the real `blockState` so the client's prediction is corrected.
- Treats only `dig` with `status: 2` as a break; breaking an already-air cell is
  a no-op.
- Spawns players at `(0.5, 10, 0.5)` standing on the grass at `y = 9`.
- Chat is broadcast as `<name> message`; join/leave messages use `§e`.
- Sends `keepAlive` every 15 s; ignores the client's reply.
- No accounts, inventory sync, item drops, mobs, dimensions or persistence.

---

## 9. Optional extensions (not required by the core protocol)

The client already understands the extra JSON messages the binary Breakmine
server uses, and treats any `type` it does not recognise as one of these. A
minimal QuickJSON server can ignore all of them; they are only needed if you
want the matching feature.

| Direction | `type` | Purpose |
| --- | --- | --- |
| server → client | `ping` | `{ id }`; the client replies with `{"type":"pong","id":...}` |
| client → server | `pong` | Reply to `ping` |
| server → client | `serverRules` | `{ allowTNT, allowLiquidFlow }` |
| server → client | `serverMods` | `{ mods: [{ id, name, version }] }` |
| server → client | `playerState` | `{ x, y, z, yaw, pitch, health, gamemode, flying }` |
| server → client | `respawn` | Same fields as `playerState` |
| server → client | `health` | `{ health }` (`0`–`20`) |
| server → client | `gamemode` | `{ gamemode, flying }` |
| server → client | `inventory` | `{ inventory }` |
| server → client | `blockInventories` | `{ inventories: [{ key, state }] }` |
| server → client | `blockInventory` | `{ key, inventory }` |
| server → client | `dimension` | `{ dimension, worldType }` |
| server → client | `cape:state` | `{ username, cape }` (cape as data URL or `null`) |
| server → client | `cctv:state` | `{ camera }` (`{ x, y, z }` or `null`) |
| server → client | `hurt` | `{ eid, damage, attacker }` |
| server → client | `spawnEntity` | `{ entityType, x, y, z, yaw, pitch }` |
| server → client | `voice` | Voice chat relay |
| client → server | `inventory` | `{ inventory }` |
| client → server | `blockInventory` | `{ key, inventory }` |
| client → server | `health` | `{ health }` |
| client → server | `gamemode` | `{ gamemode, flying }` |
| client → server | `death` | Death message for the chat feed |
| client → server | `respawn` | Player asked to respawn |
| client → server | `attack` | `{ target, damage }` |
| client → server | `cape:request` / `cape:update` | Cape state |
| client → server | `cctv:request` / `cctv:pair` | Camera state |
| client → server | `structurePaste` | Structure paste request |
| client → server | `modMessage` | `{ modId, payload }` |

---

## 10. Not part of QuickJSON

- Binary frames, compression and encryption.
- Chat components (JSON chat objects); chat is plain text with `§` codes.
- Server list ping / status handshakes.
- Tab list, scoreboard, containers, item entities and physics. Only the message
  types in sections 4–5 and 7 are guaranteed.
