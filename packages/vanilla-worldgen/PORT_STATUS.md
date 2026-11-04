# Vanillith worldgen status

Vanillith 0.2.0-alpha is a playable singleplayer work in progress. Create a
world from **Singleplayer → Create New World → More World Options → Generator:
Vanillith**. Survival, creative, spectator, block edits and local saves are
available. A separate terrain-only preview remains a development tool.

The reference is the user-supplied client JAR. Its SHA-256 and compatibility identifiers are in
[source-lock.json](source-lock.json). The Vanillith release number does not
change those identifiers or the save format.

Terrain, biomes, decoration, native block models and chunk streaming are in
place. Saved chunks and player progress can be reopened. The implementation is
still incomplete: structure generation, many block and item interactions,
mob behavior, contextual block shapes and some recipe types need more work.
Not every rendered block has every state available. In particular, the
12-bit renderer ID limit restricts the imported stair, door and gate variants.
The full native generator is not available through the integrated or remote
server path; those paths intentionally keep their compatibility guard.

See [the player guide](../../docs/VANILLITH.md),
[gameplay notes](../vanilla-gameplay/README.md), and
[older implementation notes](PORT_HISTORY.md).

## Source tools

The import scripts read the pinned JAR and check its hash. Some native oracles
also need Java and the matching launcher libraries. For example:

```sh
npm run worldgen:import -- /path/to/reference-client.jar
node packages/vanilla-worldgen/scripts/import-block-item-render.mjs /path/to/reference-client.jar
npm run gameplay:import -- /path/to/reference-client.jar /path/to/launcher/libraries
```

The JAR stays outside the repository. Imported assets and data are generated
from that source; the project is not affiliated with Mojang or Minecraft.
