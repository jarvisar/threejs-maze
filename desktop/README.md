# Desktop app

The game as a desktop app for Windows, Linux (the Steam Deck included) and macOS. It's the web build, `dist/`, the same files that go to GitHub Pages, in an [Electron](https://www.electronjs.org/) window. Nothing is rewritten for it. The game notices it's in the app in a handful of places, all of which start from `src/desktop.js`.

## Commands

From the repository root:

```sh
npm run desktop:install   # once, and again whenever desktop/package.json changes
npm run desktop           # build the game and open it in the desktop app
npm run desktop:dev       # the same on Vite's dev server: edits to the game reload in the window
npm run desktop:test      # build, then the smoke test (Playwright starts the app and plays it briefly)
npm run desktop:dist      # build, then make this computer's installers in desktop/release/
```

`npm run desktop` builds the game first; `npm --prefix desktop start` skips that and opens whatever is in `dist/`. Options go after `--`, as in `npm --prefix desktop start -- --windowed`:

- `--fullscreen`, `--windowed` start that way (otherwise it opens the way it was when last closed).
- `--devtools` opens Chromium's developer tools. They're always there when running from the repository (Ctrl+Shift+I); in a packaged build only with this option, which works on the installed game too.

On one computer, `desktop:dist` builds that computer's installers only. The Linux AppImage and .deb need Linux, and the Mac build needs a Mac, so those come from GitHub Actions (see Releasing).

## What's where

```
desktop/
  main.js              the app: the window, serving the game, permissions, full screen, stills, links, the log
  preload.cjs          window.backroomsDesktop, the few things the page can ask the app to do
  policy.js            which permissions the page gets, its Content-Security-Policy, the website's address
  updates.js           updates from GitHub Releases (electron-updater)
  electron-builder.js  packaging: installers, icons, names; the version comes from the root package.json
  build/               icons (made by `npm run icons` from public/icons/backrooms.svg) and macOS entitlements
  scripts/start.mjs    starts the app from the repository, optionally with Vite's dev server
  scripts/serve-updates.mjs  serves a folder of builds as an update feed, for trying updates out
  test/smoke.spec.js   the smoke test
  test/updates.spec.js update checks against a feed served by the test (packaged builds only)
src/desktop.js         the game's side: `desktop` is the bridge, or null in a browser
tests/desktop.test.js  checks the game against policy.js (part of `npm test`)
```

`desktop/` is its own npm package, so Electron and electron-builder (a few hundred MB) never end up in the website's install or build. Its one runtime dependency is electron-updater, which goes into the packaged app. three.js is already bundled into `dist/`.

## How it works

The app serves `dist/` at `app://backrooms/`. It doesn't use `file://`, because the page needs a real origin: module scripts, `localStorage` (settings, world edits, best times) and the clipboard all work as they do on the website. Every response carries a strict Content-Security-Policy, and the page runs sandboxed with no Node.js access. It can only use the calls in `preload.cjs`.

What's different in the app:

- **No service worker.** Every file is already on disk.
- **Full screen is the window's.** F11 or Alt+Enter (Ctrl+Cmd+F on a Mac), or clicking the right stick. It needs no click after a controller button, and Esc pauses without leaving full screen. The window opens the way it was when closed, and always full screen in Steam Deck Game Mode (or any gamescope session).
- **Sound starts without a click.** A browser holds sound back until a click or a key press; with only a controller there might never be one.
- **A Quit link** in the menu, and no Install link.
- **Stills** (P, or View on a controller) go straight to `Pictures/Backrooms Simulator`, with no save dialog.
- **Copy world link** gives the website's link (from `WEB_URL` in `policy.js`), since the app's own address means nothing to anyone else.
- **Links** (the GitHub one) open in the default browser. The window never leaves the game.
- **Updates.** The installed Windows game and the AppImage update themselves; the other builds show a *New version* link in the menu. See Updates below.
- **No VR.** Electron doesn't do WebXR, so Enter VR never appears. VR is for the website in a headset's browser.
- **Its own saves.** The app keeps its settings and saves apart from any browser's:
  - Windows: `%APPDATA%\Backrooms Simulator`
  - Linux: `~/.config/Backrooms Simulator`
  - macOS: `~/Library/Application Support/Backrooms Simulator`

  The same folder has `desktop.log` (warnings and errors from this run, which helps on a Steam Deck in Game Mode) and `window.json` (window size and position).

## Keeping the desktop app in step

Most changes to the game need nothing here. The app packages whatever `npm run build` makes, and CI builds and smoke-tests it on every push to main that touches the game. When a change does matter, one of these usually catches it:

- **`npm test`** (tests/desktop.test.js) fails if the game starts using a browser API that needs a permission the app doesn't grant (the microphone, notifications, a file picker…), or loads something from the internet that the Content-Security-Policy would block.
- **`npm run desktop:test`** starts the real app. It fails on any page error, any request that goes outside the app, a missing bridge, or stills and links not working.

Things to look at when changing the game:

| If the change… | then in the desktop app… |
| --- | --- |
| uses a new permission-gated API | add the permission to `ALLOWED_PERMISSIONS` in `policy.js`. If the API isn't in `PERMISSION_APIS` yet, add it there too, so the test knows about it. |
| loads anything from another site (a font, a script, a texture, analytics) | bundle it with the game instead (preferred), or widen `CONTENT_SECURITY_POLICY` in `policy.js`. It also wouldn't work offline. |
| downloads a file that isn't a still | `will-download` in `main.js` puts every download in the stills folder; give the new kind its own place. |
| needs a click in a browser (full screen, sound, capturing the mouse) | full screen and sound don't need one in the app; capturing the mouse still does. |
| touches the service worker, installing or the manifest | none of it runs in the app; check the `!desktop` guard in `src/main.js` still makes sense. |
| relies on URL parameters (`?seed=`) | the app always starts at the plain address; links from the website don't open in it. |
| should behave differently in the app | `import { desktop } from './desktop.js'` and check it. If it needs something only the app can do, add a call to `preload.cjs`, handle it in `main.js` (with the same `trusted()` check as the others), and describe it in the typedef in `src/desktop.js`. |
| changes the website's address | update `WEB_URL` in `policy.js`. |

The version is only in the root `package.json`; the app takes it from there.

## Updates

Each time it starts, a packaged build asks GitHub Releases whether there's a newer version, using [electron-updater](https://www.electron.build/auto-update). Only published releases count. A draft reaches nobody, so publishing the release is the moment an update goes out.

| Build | What happens |
| --- | --- |
| Windows installer (`…-setup.exe`) | Downloads the new version in the background and installs it, silently, when the game is closed. |
| Linux AppImage | The same: the new AppImage replaces the old file when the game is closed. |
| Windows portable, macOS, .deb, .tar.gz | Can't replace themselves (the Mac build would need to be signed), so the menu shows *New version 2.1.0*, which opens the releases page. |

`updateMode()` in `updates.js` decides which applies. The installer leaves `Uninstall Backrooms Simulator.exe` next to the game, the portable .exe sets `PORTABLE_EXECUTABLE_DIR`, and an AppImage sets `APPIMAGE`.

- The AppImage's file name has no version in it (`Backrooms-Simulator-linux-x86_64.AppImage`). With one, an update would arrive under a new name and the old file would be deleted, and a Steam shortcut pointing at it would break.
- The updater needs the `latest.yml`, `latest-linux.yml` and `latest-mac.yml` files electron-builder writes next to the builds. The workflow uploads them with each release and checks they're there. The `.blockmap` files let an update download only what changed. Leave old releases up: their blockmaps are what the next update compares against.
- A build run from the repository never checks, and neither does the smoke test. A check that fails (no connection, GitHub down, a release missing its files) goes in `desktop.log` and nowhere else.

### Trying an update before releasing

`BACKROOMS_UPDATE_FEED` points a packaged build at another feed: a URL, or `off`. To try a real update on this computer or on the Steam Deck:

1. Build and install (or copy over) the current version.
2. Build the next one somewhere else, for example `npx electron-builder --win nsis --publish never -c.extraMetadata.version=2.0.2 -c.directories.output=../update-test` from `desktop/`. (On Linux, `--linux AppImage`.)
3. Serve it: `node desktop/scripts/serve-updates.mjs update-test`. It prints the address to use.
4. Start the installed game with `BACKROOMS_UPDATE_FEED` set to that address and a scratch `BACKROOMS_USER_DATA` folder, so your own saves stay out of it. Wait for `desktop.log` to say the update is ready, then close the game. The next start is the new version.

`test/updates.spec.js` covers the *New version* link, a feed with nothing newer, and a feed that fails. It runs on every packaged build in CI.

## Releasing

The Actions workflow ([`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)) builds all three platforms on GitHub's machines:

- **Every push to main** that touches the game: installers for all three, in the run's *Artifacts* for two weeks. Handy for trying a change on the Steam Deck before releasing it.
- **A version tag:** the same, attached to a draft GitHub Release.

To release:

1. Bump the version in the root: `npm version minor --no-git-tag-version` (or `patch`, `major`). This changes `package.json` and `package-lock.json`.
2. Commit and push that.
3. Tag the commit and push the tag: `git tag v2.1.0` then `git push origin v2.1.0`. The tag has to match the version, or the workflow stops.
4. When the workflow finishes, the release is waiting as a draft under Releases. Look it over, edit the notes, and publish it. Publishing is what sends the update to everyone's installed copy.

Each build is started and smoke-tested on its own platform before it's uploaded. The Mac's test runs on a virtual machine and doesn't hold the build back if it fails, but the failure shows in the run.

## Platform notes

### Windows

There's an installer (`…-setup.exe`, per user, with a choice of folder), which keeps itself up to date, and a portable `.exe` that runs without installing and only points at new versions. Neither is code-signed, so the first run shows SmartScreen's "Windows protected your PC": click *More info*, then *Run anyway*. Signing needs a code-signing certificate. Give it to electron-builder as `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` in the workflow's Build step, the way the Mac secrets are passed.

### Linux and the Steam Deck

- **AppImage**: one file that runs on most distributions, including SteamOS. This is the one for the Steam Deck. It updates itself.
- **.deb**: Debian, Ubuntu and friends (`sudo apt install ./Backrooms-Simulator-*.deb`). It adds a menu entry, and on Ubuntu 24.04 and later the AppArmor profile Electron needs.
- **.tar.gz**: unpack anywhere and run `backrooms-simulator`.

On a Steam Deck:

1. Switch to Desktop Mode (Steam button → Power → Switch to Desktop).
2. Download the AppImage, for example into `~/Applications`. Right-click it → Properties → Permissions → tick *Is executable*.
3. Open Steam → Games → *Add a Non-Steam Game to My Library…* → Browse, pick the AppImage (set the file type to *All Files* if it isn't listed), and add it.
4. Back in Game Mode it's in the library under Non-Steam. It opens full screen, and the Deck's controls work as a controller. If the sticks move a mouse cursor instead, pick a gamepad layout in the game's controller settings.
5. Quit is in the pause menu (or Steam button → Exit Game). Updates download while you play and are installed when the game closes, in the same file, so the Steam shortcut keeps working.

If an AppImage won't start on a regular Ubuntu 24.04+ desktop and complains about the "SUID sandbox helper", that's Ubuntu's AppArmor restriction on unprivileged user namespaces. Use the .deb, which installs a profile for it, or start the AppImage with `--no-sandbox`.

### macOS

A universal build (Intel and Apple Silicon), as a `.dmg` and a `.zip`. It hasn't been tried on a real Mac; the CI smoke test is the only check it gets. It can't update itself unsigned (macOS only lets signed apps replace themselves), so it shows a *New version* link in the menu instead.

Without an Apple Developer ID it's signed ad hoc and not notarized. macOS blocks it the first time: open it, dismiss the warning, then go to System Settings → Privacy & Security and click *Open Anyway*. (Or, in Terminal: `xattr -dr com.apple.quarantine "/Applications/Backrooms Simulator.app"`.)

To sign and notarize it properly (needs the paid Apple Developer Program), add these repository secrets and the workflow uses them:

| Secret | What |
| --- | --- |
| `MAC_CERTIFICATE` | the "Developer ID Application" certificate as a base64-encoded .p12 |
| `MAC_CERTIFICATE_PASSWORD` | the .p12's password |
| `APPLE_ID` | the Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | the team ID |

## Troubleshooting

- **Something's wrong in a packaged build:** look at `desktop.log` in the data folder above, or start the game with `--devtools`.
- **`npm run desktop` says the web build is missing:** it looks in `dist/`. Run `npm run build`; `npm run desktop` does that for you.
- **Electron starts as plain Node.js from VS Code** ("bad option", or `require('electron')` errors): VS Code sets `ELECTRON_RUN_AS_NODE` in its own processes. The npm scripts clear it. Running `electron .` by hand from a VS Code task doesn't.
- **Permission refused:** the log says which one (`Refused the "…" permission`). See the table above.
