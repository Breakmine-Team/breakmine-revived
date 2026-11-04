# Breakmine

Breakmine is a browser and Electron game. The game lives at the repository
root; the website is a separate app under `apps/`.

- `src/`, `libraries/`, `index.html` — Breakmine browser/Electron game and integrated server.
- `apps/website/` — public website and Cloudflare Worker API.
- `packages/` — world-generation and gameplay parity tooling.

## Vanillith

Vanillith 0.2.0-alpha is an in-progress singleplayer generator. It supports
saved worlds and survival gameplay, with some features still being built.
Start with the [Vanillith guide](docs/VANILLITH.md)
or see the [worldgen status](packages/vanilla-worldgen/PORT_STATUS.md).

## Common commands

```sh
npm run dev
npm run build
npm run website:dev
npm run website:worker:check
```
