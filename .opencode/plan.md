# Plan: Add Vite Support to js-minecraft (Breakmine: Revived)

## Context

The project is a browser-based Minecraft clone built with Three.js and vanilla ES modules. Currently there is **zero build tooling** - all source files are served as raw static files, libraries are loaded via `<script type="module">` tags from a vendored `libraries/` directory, and asset paths are hardcoded strings like `"src/resources/sound/random/click.ogg"`. The project already has `vite` ^8.1.3 as a dependency but no configuration. Adding Vite enables a proper dev server with HMR, and a production build with bundling/minification.

## Challenges

1. **Static asset paths** - Textures, sounds, and music are loaded via runtime `new Image()`, `new Audio()`, and `THREE.AudioLoader()` with hardcoded relative paths like `"src/resources/terrain/terrain.png"`. These must resolve correctly under Vite's dev server and production build.
2. **Vendored libraries with global-scope patterns** - Libraries in `libraries/` use UMD/global-assignment patterns (`aesjs`, `ASN1`, `bigint-mod-arith`, `sha1`). The code accesses them via a `require()` shim that reads `window[module]`.
3. **CSS background-image** - `style.css` references `url(src/resources/gui/title/splash.png)`.
4. **Web Worker** - `worldgen.worker.js` is loaded via `new Worker(new URL(..., import.meta.url), { type: "module" })` - already Vite-compatible.
5. **`prelaunch.html`** - A second HTML entry point that sets `window.isPreLaunch = true`.
6. **CI/CD** - The Forgejo workflow currently copies the entire repo to a pages branch; after Vite, the deployable output will be `dist/`.

## Plan

### Step 1: Create `vite.config.js`

```js
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
  },
  server: {
    port: 3000,
  },
});
```

### Step 2: Move `src/resources/` to `public/resources/`

Vite serves files from `public/` as static assets at the root URL. Moving `src/resources/` to `public/resources/` means all asset paths become `/resources/...` instead of `src/resources/...`.

```bash
mkdir -p public
mv src/resources public/resources
```

### Step 3: Update asset paths in source files

All files that reference `"src/resources/..."` need to be updated to `"/resources/..."` (absolute from root, works in both dev and prod):

| File | Change |
|------|--------|
| `src/js/Start.js` | `image.src = "src/resources/"` → `image.src = "/resources/"` |
| `src/js/net/minecraft/client/sound/SoundManager.js` | `'src/resources/sound/...'` → `'/resources/sound/...'` |
| `src/js/net/minecraft/client/sound/MusicManager.js` | `'src/resources/sound/music/...'` → `'/resources/sound/music/...'` |
| `style.css` | `url(src/resources/gui/title/splash.png)` → `url(/resources/gui/title/splash.png)` |
| `index.html` | `href="src/resources/favicon.ico"` → `href="/resources/favicon.ico"` |
| `prelaunch.html` | `href="src/resources/favicon.ico"` → `href="/resources/favicon.ico"` |

### Step 4: Update `index.html` - remove library script tags, single Vite entry

Remove the five library `<script type="module">` tags and the `src/js/Start.js` script tag. Replace with:

```html
<script type="module" src="/src/js/Start.js"></script>
```

### Step 5: Update `prelaunch.html` - same changes as `index.html`

### Step 6: Move `vite` from `dependencies` to `devDependencies`

```bash
npm uninstall vite
npm install --save-dev vite
```

### Step 7: Add scripts to `package.json`

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

### Step 8: Add `dist/` to `.gitignore`

### Step 9: Update CI/CD deploy workflow

Update `.forgejo/workflows/deploy.yml` to build before deploying `dist/`:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: "20"
      cache: "npm"
  - run: npm ci
  - run: npm run build
  - uses: actions/push-to-another-repository@main
    env:
      API_TOKEN_GITHUB: ${{ secrets.CODEBERG_PAGES_TOKEN }}
    with:
      source-directory: 'dist'
      destination-github-username: 'BreakmineDevelopers'
      destination-repository-name: 'breakmine_revived'
      target-branch: 'pages'
      commit-message: 'Automated deploy from main branch'
```

### Step 10: Handle vendored library imports

The `require()` shim pattern relies on libraries being loaded as globals. With Vite we switch to direct ES imports.

Library export patterns (determined by inspecting source):
- `aes.js`: UMD, assigns `window.aesjs` in browser
- `asn1.js`: IIFE, assigns `window.ASN1` (actually `exports.ASN1` where `exports` is `window` in browser)
- `bigint-mod-arith.js`: Assigns `window["bigint-mod-arith"]`
- `sha1.min.js`: UMD, assigns `window.sha1`
- `three.module.js`: ES module, `export default` / named exports - already imported correctly
- `long.js`: ES module, `export default` - already imported correctly
- `chat.js`: ES module, named exports - already imported correctly
- `pako` (local copy at `src/js/net/minecraft/lib/pako.js`): ES module - already imported correctly

Changes per file:

**`src/js/net/minecraft/client/network/NetworkManager.js`**:
```js
// Replace: this.pako = require("pako");
// Replace: new (require("aesjs").ModeOfOperation).cfb(...)
// With top-level imports:
import * as aesjs from "../../../../../../libraries/aes.js";
// Keep existing pako import from lib/ (already works)
// Change require("aesjs") usages to aesjs
```

**`src/js/net/minecraft/client/network/util/CryptManager.js`**:
```js
// Replace: require("ASN1").parse(...)
// Replace: require("bigint-mod-arith")
// ASN1.js IIFE assigns to window when no module.exports. 
// In Vite it runs as side-effect → window.ASN1 is set.
// bigint-mod-arith assigns window["bigint-mod-arith"] directly.
// So we need side-effect imports that set globals:
import "../../../../../libraries/asn1.js";
import "../../../../../libraries/bigint-mod-arith.js";
// Then require("ASN1") and require("bigint-mod-arith") still work via the shim
```

**`src/js/net/minecraft/client/network/util/Authentication.js`**:
```js
// sha1.min.js UMD assigns window.sha1 in browser
import "../../../../../libraries/sha1.min.js";
// require("sha1") still works via the shim
```

**`src/js/Start.js`**:
- Remove `import * as aesjs from '../../libraries/aes.js'` (unused - aesjs is used only in NetworkManager)
- Keep the `require()` shim export so all `require()` calls in the codebase continue to work

**Approach**: Use side-effect imports for the UMD libraries that set `window.*` globals, so the existing `require()` shim continues to work without modifying every call site. Only `NetworkManager.js` needs a direct import since it does `require("aesjs").ModeOfOperation` inline (not as a simple lookup).

### Step 11: Test

1. `npm run dev` - verify game loads at `localhost:3000`
2. Verify textures, sounds, music load correctly
3. `npm run build && npm run preview` - verify production build
4. No console errors about missing assets or broken imports

## Files to create/modify

| File | Action |
|------|--------|
| `vite.config.js` | **Create** |
| `public/resources/` | **Create** (move `src/resources/` here) |
| `package.json` | **Modify** (scripts, move vite to devDeps) |
| `.gitignore` | **Modify** (add `dist/`) |
| `index.html` | **Modify** (remove library script tags, update favicon) |
| `prelaunch.html` | **Modify** (same) |
| `style.css` | **Modify** (update background-image URL) |
| `src/js/Start.js` | **Modify** (update asset paths, remove unused import) |
| `src/js/net/minecraft/client/sound/SoundManager.js` | **Modify** (update sound paths) |
| `src/js/net/minecraft/client/sound/MusicManager.js` | **Modify** (update music paths) |
| `src/js/net/minecraft/client/network/NetworkManager.js` | **Modify** (import aesjs, remove require) |
| `src/js/net/minecraft/client/network/util/CryptManager.js` | **Modify** (side-effect imports for ASN1, bigint-mod-arith) |
| `src/js/net/minecraft/client/network/util/Authentication.js` | **Modify** (side-effect import for sha1) |
| `.forgejo/workflows/deploy.yml` | **Modify** (build before deploy) |

## Verification

- `npm run dev` starts without errors
- Game loads in browser, textures render, sounds play
- `npm run build` produces `dist/` directory
- `npm run preview` serves the production build successfully
