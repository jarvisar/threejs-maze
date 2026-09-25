---
name: desktop
description: Work on or around the Electron desktop app in desktop/ (Windows, Linux/Steam Deck, macOS builds of the web game). Use when running, testing, debugging or packaging the desktop app; when adding desktop-only behaviour; and whenever a change to the web game (src/, index.html, public/, vite.config.js) touches browser permissions, remote resources, downloads, full screen, sound start-up, the service worker/PWA, external links or URL parameters, so the desktop app keeps working.
---

# Desktop app

`desktop/` wraps the web build (`dist/`, the same files GitHub Pages serves) in Electron. It is its own npm package (`desktop/package.json`, own lockfile); the web app's dependencies and build are untouched by it. Full documentation: `desktop/README.md` (read it before non-trivial desktop work).

## Map

- `desktop/main.js`: window, `app://backrooms/` protocol serving `dist/` (packaged: `web/` inside app.asar), permission handlers, full screen (F11 / Alt+Enter), stills → `Pictures/Backrooms Simulator` via `will-download`, external links → default browser, IPC, `desktop.log` in userData.
- `desktop/preload.cjs`: `window.backroomsDesktop` (platform, version, webUrl, isFullscreen, setFullscreen, onFullscreenChange, quit). Sandboxed, so CommonJS.
- `desktop/policy.js`: `ALLOWED_PERMISSIONS`, `PERMISSION_APIS`, `CONTENT_SECURITY_POLICY`, `WEB_URL`, `RELEASES_URL`. No Electron imports (the root unit tests import it).
- `desktop/updates.js`: updates via electron-updater from GitHub Releases. `updateMode()` gives 'install' (installed Windows copy, AppImage: silent download, install on quit) or 'notify' (portable, macOS, .deb, .tar.gz: the menu's *New version* link, `data-action="update"` in `index.html` / `src/ui/Menu.js`). electron-updater is imported lazily so the unit tests can import `updateMode`. It's the package's one runtime dependency: keep it in `dependencies`, and never exclude `node_modules` from the packaged files.
- `desktop/electron-builder.js`: packaging. Version/description come from the root `package.json`.
- `src/desktop.js`: the game's side. `desktop` is the bridge or `null`. Every desktop-specific branch in the game starts from it (`grep -rn "desktop" src/`): service worker skipped (`src/main.js`), `WindowFullscreen` (`src/ui/Fullscreen.js`, chosen in `Game.js`), Quit link (`src/ui/Menu.js`, `index.html`), world link uses `desktop.webUrl` (`Game.js`).

## When the web game changes

Most changes need nothing: the app packages whatever `npm run build` makes. Check the table under "Keeping the desktop app in step" in `desktop/README.md` when a change:

- uses a permission-gated API → `ALLOWED_PERMISSIONS` (and `PERMISSION_APIS` if the API isn't listed) in `desktop/policy.js`;
- loads anything from another origin → bundle it (preferred) or widen the CSP in `policy.js`;
- triggers a download other than a still → give it its own handling in `will-download`;
- needs behaviour only the app can provide → add a call in three places: `preload.cjs`, an `ipcMain` handler in `main.js` guarded by `trusted(event)`, and the `DesktopBridge` typedef in `src/desktop.js`. Branch on `desktop` in the game; keep the browser path unchanged.

Keep web-app changes for the desktop small and behind `desktop` checks. Don't restructure the game for it, and don't change its look (lighting, colour, VHS style) or copy style: UI text stays short and plain.

## Checks

1. `npx vitest run --maxWorkers=2` (includes `tests/desktop.test.js`, the permission/CSP guard).
2. `npm run desktop:test`: builds, then Playwright launches the real app (title screen, no page errors, no requests outside `app://`, bridge, Quit, links, full screen, starting play and saving a still). Light (it uses the GPU, one window), but run it once, from the main session, never from parallel agents. Kill leftover `electron.exe` processes if a run is interrupted.
3. For packaging or update changes: `npm run build`, then `cd desktop && npx electron-builder --win --dir --publish never`, then test the packaged exe with `BACKROOMS_APP="<repo>/desktop/release/win-unpacked/Backrooms Simulator.exe" npx playwright test -c desktop` from the root (this also runs `test/updates.spec.js`). Linux AppImage/.deb and the Mac build only build on those OSes: they're checked by `.github/workflows/desktop.yml` (see the `desktop-release` skill for reading CI results).

## Gotchas

- `ELECTRON_RUN_AS_NODE=1` is set in VS Code's (and this agent's) processes, and makes Electron run as plain Node ("bad option: --remote-debugging-port"). `scripts/start.mjs` and the smoke test remove it. When launching Electron any other way, `unset ELECTRON_RUN_AS_NODE` first.
- Never pass an app path with a trailing slash to Electron on Windows: a quoted argument ending in `\` swallows its closing quote. Use `dirname(...)`.
- A window launched by Playwright isn't focused, so pointer lock fails until `BrowserWindow.focus()`.
- On Windows `win.isFullScreen()` still has the old value inside `enter-full-screen`/`leave-full-screen`; send the value the event implies.
- `getRegistrations()` throws on `app://` (the scheme has no service-worker privilege, deliberately).
- `BACKROOMS_USER_DATA=<dir>` points the app at a scratch data folder (settings, saves, log). Use it for any manual run so the user's real saves aren't touched.
- `BACKROOMS_DEV_SERVER=<url>` loads a dev server instead of `dist/` (what `npm run desktop:dev` does). There's no CSP in that mode.
- `BACKROOMS_UPDATE_FEED=<url>|off`: a packaged build checks that feed (generic provider) instead of GitHub, or doesn't check. The smoke test sets `off`; `test/updates.spec.js` serves its own feed. Builds run from the repository never check. To try a real update: "Trying an update before releasing" in `desktop/README.md` (`scripts/serve-updates.mjs`). Installing a test build adds shortcuts and a registry entry. Uninstall it (`Uninstall Backrooms Simulator.exe /S`) and delete `%LOCALAPPDATA%\backrooms-simulator-desktop-updater` afterwards.
- electron-updater adds a query string to feed requests: match feed paths with `new URL(request.url, 'http://localhost').pathname`.
- CI passes absent secrets as empty strings; `electron-builder.js` deletes empty `CSC_*`/`APPLE_*` variables, because electron-builder takes an empty `CSC_LINK` as a certificate path.
- Paths given to Playwright's `executablePath` must be `resolve()`d: a mix of `\` and `/` (as CI produces) fails to start on Windows.

## Debugging a user's build

Ask for `desktop.log` from the data folder (`%APPDATA%\Backrooms Simulator`, `~/.config/Backrooms Simulator`, `~/Library/Application Support/Backrooms Simulator`). It has the versions, page warnings/errors, refused permissions, and crashed processes. `--devtools` opens developer tools in a packaged build (on a Steam Deck: add it to the game's launch options in Steam).
