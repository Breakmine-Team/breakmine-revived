# Unbreakable Blocks — example Patchwork mod

A small but complete example mod for [Patchwork](https://github.com/Breakmine-Team/patchwork-docs), the Breakmine mod loader.

Requires Patchwork **v1.1.0** or later.

## What it demonstrates

| File | Feature |
| ---- | ------- |
| `ModData.js` | Mod metadata (NAME / ID / AUTHOR / VERSION / DESCRIPTION / LICENSE) |
| `ModLoad.js` | Entry point: keybind, HUD overlay text, JSON storage, render hook, code-registered command |
| `blocks/BlockUnbreakableBlock.js` | Custom block (indestructible, own texture + tooltip) |
| `items/ItemUnbreakableIngot.js` | Custom item |
| `crafting/BlockUnbreakableBlockCrafting.js` | Shapeless crafting recipe: 4 ingots -> 1 unbreakable block |
| `commands/CommandUnbreakable.js` | Chat command with arguments (`/unbreakable [give <count>]`) |
| `tabs/TabUnbreakable.js` | Custom creative inventory tab |
| `textures/unbreakable_block.png` | 16x16 block/item texture |

## Install

Copy this folder into your Breakmine `mods/` directory and restart, or select it
with the folder installer in the in-game Mods screen.

## Try it out

1. Find the **Unbreakable** tab in the creative inventory.
2. Run `/unbreakable give 8`, then craft two Unbreakable Blocks from the ingots.
3. Try (and fail) to break one.
4. Toggle the HUD with **H** and check the console for the render hook message.
5. Run `/unbreakable` to see how many ingots you are carrying.

## Docs

Full documentation: https://github.com/Breakmine-Team/patchwork-docs
- [Setting Up Your First Mod](https://github.com/Breakmine-Team/patchwork-docs/blob/main/docs/Example%20Mod/setup.md)
- [Packaging & Distribution](https://github.com/Breakmine-Team/patchwork-docs/blob/main/docs/Example%20Mod/packaging.md)
- [ModAPI Reference](https://github.com/Breakmine-Team/patchwork-docs/blob/main/docs/API/mod_api.md)
- [Patching](https://github.com/Breakmine-Team/patchwork-docs/blob/main/docs/API/patching_api.md)
