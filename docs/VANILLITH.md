# Vanillith

Vanillith is Breakmine's Minecraft-inspired world generator. The current
release is **0.2.0-alpha**.
It's playable in singleplayer, but it is still being built.

This alpha includes the recent survival, crafting, armor and Bluestone work,
plus the streaming and terrain changes. Some mechanics are still incomplete.

## Start a world

1. Open **Singleplayer** and choose **Create New World**.
2. Open **More World Options** and switch **Generator** to **Vanillith**.
3. Choose a game mode and seed, then create the world.

The world saves locally, including block edits and player progress. Survival,
creative and spectator are available. World generation and streaming can take
time, especially when exploring new terrain. The Performance settings let you
adjust render distance, streaming and memory use.

## What's there

Terrain and biome decoration, mining and placement, health and hunger, basic
combat and armor, crafting and supported stonecutter recipes are available.
Breakmine's blue **Bluestone** stays in place of redstone. Some vanilla recipe
IDs use Bluestone items internally so those recipes can still resolve.

There are still gaps: structures, mobs, block states and interactions, recipes,
damage sources, enchantments and visual details are not complete. Some armor
doesn't render on the player yet. Bluestone circuits use Breakmine's existing
simulation, which doesn't cover every vanilla redstone mechanic. The current
renderer has a limited block-state ID range, so some block variants fall back
to simpler ones.

Vanillith singleplayer is separate from the full native generator path for
servers, which is still unavailable. The release version is only a label; it
doesn't alter world data, existing saves, or the pinned JAR version.

For source details, see [worldgen status](../packages/vanilla-worldgen/PORT_STATUS.md)
and [gameplay notes](../packages/vanilla-gameplay/README.md). Streaming and
distant-terrain documents in this folder record earlier work and measurements.
