# Breakmine workspace

This repository contains the Breakmine applications as separate boundaries:

- `apps/game/` — browser and Electron game client, integrated server, and legacy auth service.
- `apps/website/` — public website, Discord authentication, and Cloudflare Worker API.
- `apps/wiki/` — Wiki and Mods service.
- `apps/studio/` — standalone studio page.
- `packages/` — future shared types and multiplayer protocol packages.
- `examples/` — reference mods.
- `archive/` — legacy releases and imports.

## Common commands

```sh
npm run dev
npm run build
npm run website:dev
npm run website:worker:check
```

See [docs/REPOSITORY.md](docs/REPOSITORY.md) for the migration map.
