# Desktop app

The game as a desktop app for Windows, Linux (including the Steam Deck) and macOS. It's the same web build that goes to GitHub Pages (`dist/`) running in an [Electron](https://www.electronjs.org/) window. Nothing is rewritten for it. The few places where the game acts differently in the app all start from `src/desktop.js`.

## Commands

From the repo root:

```sh
npm run desktop:install   # once, and again whenever desktop/package.json changes
npm run desktop           # build the game and open it in the app
npm run desktop:dev       # same but on Vite's dev server, game edits reload in the window
npm run desktop:test      # build, then run the smoke test (Playwright starts the app and plays briefly)
npm run desktop:dist      # build, then make this computer's installers in desktop/release/
```

`npm run desktop` builds the game first. `npm --prefix desktop start` skips the build and opens whatever is in `dist/`. Options go after `--`, e.g. `npm --prefix desktop start -- --windowed`:

- `--fullscreen` or `--windowed` to start that way. Otherwise it opens the way it was when last closed.
- `--devtools` opens Chromium's dev tools. They're always available when running from the repo (Ctrl+Shift+I). In a packaged build you need this option, which also works on an installed copy.

`desktop:dist` only builds installers for the computer it runs on. The Linux AppImage and .deb need Linux and the Mac build needs a Mac, so those come from GitHub Actions (see Releasing).

The packaging scripts run electron-builder through Node with publishing turned off. Before reporting success they check the executable, the bundled game, every expected download, and the update feed's version, sizes and checksums. `npm --prefix desktop run pack` builds and checks just the unpacked app. Build `dist/` first if you're running the desktop package's scripts directly.

## What's where

```
desktop/
  main.js              the app: window, serving the game, permissions, full screen, stills, links, log
  preload.cjs          window.backroomsDesktop, the few calls the page can make to the app
  policy.js            permissions the page gets, its Content-Security-Policy, the website's URL
  updates.js           updates from GitHub Releases (electron-updater)
  electron-builder.config.js  packaging: installers, icons, names. Version comes from the root package.json
  build/               icons (made by `npm run icons` from public/icons/backrooms.svg) and macOS entitlements
  scripts/start.mjs    starts the app from the repo, optionally on Vite's dev server
  scripts/package.mjs  builds one platform without publishing, then checks the output
  scripts/verify-package.mjs  checks bundled files, downloads and update metadata
  scripts/serve-updates.mjs  serves a folder of builds as an update feed for testing updates
  test/smoke.spec.js   smoke test
  test/updates.spec.js update checks against a feed served by the test (packaged builds only)
src/desktop.js         the game's side. `desktop` is the bridge, or null in a browser
tests/desktop.test.js  checks the game against policy.js (part of `npm test`)
```

`desktop/` is its own npm package so Electron and electron-builder (a few hundred MB) never end up in the website's install or build. Its only runtime dependency is electron-updater, which goes into the packaged app. three.js is already bundled into `dist/`.

## How it works

The app serves `dist/` at `app://backrooms/`. It doesn't use `file://` because the page needs a real origin for module scripts, `localStorage` (settings, world edits, best times) and the clipboard to work like they do on the website. Every response has a strict Content-Security-Policy, and the page runs sandboxed with no Node.js access. The calls in `preload.cjs` are all it can use.

What's different in the app:

- **No service worker.** Every file is already on disk.
- **Full screen uses the window.** F11 or Alt+Enter (Ctrl+Cmd+F on a Mac), or click the right stick. It doesn't need a click after a controller button, and Esc pauses without leaving full screen. The window opens the way it was when closed, and always full screen in Steam Deck Game Mode (or any gamescope session).
- **Sound starts without a click.** Browsers hold sound back until a click or key press, and with only a controller there might never be one.
- **A Quit link** in the menu, and no Install link.
- **Stills** (P, or View on a controller) are saved straight to `Pictures/Backrooms Simulator` with no save dialog.
- **Copy world link** gives the website's link (`WEB_URL` in `policy.js`) since the app's own address is useless to anyone else.
- **Links** (the GitHub one) open in the default browser. The window never navigates away from the game.
- **Updates.** The installed Windows version and the AppImage update themselves. The other builds show a *New version* link in the menu. See Updates below.
- **No VR.** Electron doesn't support WebXR, so Enter VR never shows up. VR is only on the website in a headset's browser.
- **Separate saves.** Settings and saves are kept apart from any browser's:
  - Windows: `%APPDATA%\Backrooms Simulator`
  - Linux: `~/.config/Backrooms Simulator`
  - macOS: `~/Library/Application Support/Backrooms Simulator`

  The same folder has `desktop.log` (warnings and errors from the current run, useful on a Steam Deck in Game Mode) and `window.json` (window size and position).

## Keeping the desktop app in step

Most game changes need nothing here. The app packages whatever `npm run build` makes, and CI builds and smoke-tests it on every push to main that touches the game. When a change does matter, one of these normally catches it:

- **`npm test`** (tests/desktop.test.js) fails if the game starts using a browser API that needs a permission the app doesn't grant (microphone, notifications, a file picker, etc.), or loads something from the internet that the Content-Security-Policy would block.
- **`npm run desktop:test`** starts the real app. It fails on any page error, any request outside the app, a missing bridge, stills or links not working, or ambient occlusion not loading. AO is the one part of the game that only loads when it's turned on.

Things to check when changing the game:

| If the change | Then in the desktop app |
| --- | --- |
| uses a new permission-gated API | add the permission to `ALLOWED_PERMISSIONS` in `policy.js`. If the API isn't in `PERMISSION_APIS` yet, add it there too so the test knows about it. |
| loads anything from another site (a font, script, texture, analytics) | bundle it with the game instead (preferred), or widen `CONTENT_SECURITY_POLICY` in `policy.js`. It also wouldn't work offline. |
| downloads a file that isn't a still | `will-download` in `main.js` puts every download in the stills folder. Give the new kind its own place. |
| needs a click in a browser (full screen, sound, mouse capture) | full screen and sound don't need one in the app. Mouse capture still does. |
| touches the service worker, installing or the manifest | none of it runs in the app. Check the `!desktop` guard in `src/main.js` still makes sense. |
| relies on URL parameters (`?seed=`) | the app always starts at the plain address, and website links don't open in it. |
| should behave differently in the app | `import { desktop } from './desktop.js'` and check it. If it needs something only the app can do, add a call to `preload.cjs`, handle it in `main.js` (with the same `trusted()` check as the others), and add it to the typedef in `src/desktop.js`. |
| changes the website's address | update `WEB_URL` in `policy.js`. |

The version only lives in the root `package.json`. The app takes it from there.

## Updates

Every time a packaged build starts, it asks GitHub Releases if there's a newer version using [electron-updater](https://www.electron.build/auto-update). Only published releases count. Drafts reach nobody, so publishing the release is what sends out the update.

| Build | What happens |
| --- | --- |
| Windows installer (`-setup.exe`) | Downloads the new version in the background and installs it silently when the game is closed. |
| Linux AppImage | Same thing. The new AppImage replaces the old file when the game is closed. |
| Windows portable, macOS, .deb, .tar.gz | Can't replace themselves (the Mac build would need to be signed), so the menu shows *New version 2.1.0*, which opens the releases page. |

`updateMode()` in `updates.js` decides which one applies. The installer leaves `Uninstall Backrooms Simulator.exe` next to the game, the portable .exe sets `PORTABLE_EXECUTABLE_DIR`, and an AppImage sets `APPIMAGE`.

- The AppImage's file name has no version in it (`Backrooms-Simulator-linux-x86_64.AppImage`). If it did, an update would arrive under a new name, the old file would be deleted, and any Steam shortcut pointing at it would break.
- The updater needs the `latest.yml`, `latest-linux.yml` and `latest-mac.yml` files that electron-builder writes next to the builds. The workflow uploads them with each release and checks they're there. The `.blockmap` files let an update download only what changed. Leave old releases up since their blockmaps are what the next update compares against.
- Builds run from the repo never check for updates, and neither does the smoke test. A failed check (no connection, GitHub down, a release missing files) only goes in `desktop.log`.

### Testing an update before releasing

`BACKROOMS_UPDATE_FEED` points a packaged build at a different feed. It takes a URL or `off`. To try a real update on this computer or a Steam Deck:

1. Build and install (or copy over) the current version.
2. Build the next version somewhere else. For example, from `desktop/`: `node node_modules/electron-builder/cli.js --config electron-builder.config.js --win nsis --publish never -c.extraMetadata.version=2.0.6 -c.directories.output=../update-test` (use `--linux AppImage` on Linux). This direct command is only for a test feed. The normal packaging scripts always use the root version and check their output.
3. Serve it with `node desktop/scripts/serve-updates.mjs update-test`. It prints the address to use.
4. Start the installed game with `BACKROOMS_UPDATE_FEED` set to that address and `BACKROOMS_USER_DATA` set to a scratch folder so your own saves aren't touched. Wait for `desktop.log` to say the update is ready, then close the game. The next start is the new version.

`test/updates.spec.js` covers the *New version* link, a feed with nothing newer, and a feed that fails. It runs on every packaged build in CI.

## Releasing

The Actions workflow ([`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)) builds all three platforms on GitHub's runners:

- **Every push to main or pull request** that touches the game or desktop app builds installers for all three. They're kept in the run's *Artifacts* for two weeks, which is handy for trying a change on the Steam Deck before releasing.
- **A version tag** does the same and publishes them as a GitHub Release.

To release, from a clean main: `npm version patch && git push --follow-tags` (or `minor`, `major`). That bumps `package.json` and `package-lock.json`, commits, tags `vX.Y.Z` and pushes both. The tag has to match the version or the workflow stops.

When the workflow finishes, the release is published under Releases, which sends the update to every installed copy. The workflow uploads everything to a draft first and only publishes once all the files are there.

Each build has to pass the smoke test on its own platform before it's uploaded. Linux CI runs a window manager so full screen and mouse capture get tested too. Failed tests keep the app log and Playwright trace in the run's report artifact. A release needs all three platforms to pass. If a run fails after creating the draft, rerunning the tag finishes it. It can't overwrite a release that's already published.

## Platform notes

### Windows

There's an installer (`-setup.exe`, per user, with a choice of folder) that keeps itself up to date, and a portable `.exe` that runs without installing and only links to new versions. Neither one is code-signed, so the first run shows SmartScreen's "Windows protected your PC". Click *More info*, then *Run anyway*. Signing needs a code-signing certificate, passed to electron-builder as `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` in the workflow's Build step, the same way the Mac secrets are passed.

### Linux and the Steam Deck

- **AppImage:** one file that runs on most distros, including SteamOS. Use this one on the Steam Deck. It updates itself.
- **.deb:** Debian, Ubuntu, etc. (`sudo apt install ./Backrooms-Simulator-*.deb`). It adds a menu entry, and on Ubuntu 24.04+ the AppArmor profile Electron needs.
- **.tar.gz:** unpack anywhere and run `backrooms-simulator`.

On a Steam Deck:

1. Switch to Desktop Mode (Steam button > Power > Switch to Desktop).
2. Download the AppImage, e.g. into `~/Applications`. Right-click it > Properties > Permissions > check *Is executable*.
3. Open Steam > Games > *Add a Non-Steam Game to My Library* > Browse, pick the AppImage (set the file type to *All Files* if it isn't listed) and add it.
4. Back in Game Mode it's in the library under Non-Steam. It opens full screen and the Deck's controls work as a controller. If the sticks move a mouse cursor instead, pick a gamepad layout in the game's controller settings.
5. Quit is in the pause menu (or Steam button > Exit Game). Updates download while you play and install when the game closes, into the same file, so the Steam shortcut keeps working.

If the AppImage won't start on a normal Ubuntu 24.04+ desktop and complains about the "SUID sandbox helper", that's Ubuntu's AppArmor restriction on unprivileged user namespaces. Use the .deb, which installs a profile for it, or start the AppImage with `--no-sandbox`.

### macOS

A universal build (Intel and Apple Silicon) as a `.dmg` and a `.zip`. It hasn't been tested on a real Mac yet. The CI smoke test is the only check it gets. It can't update itself unsigned (macOS only lets signed apps replace themselves), so it shows a *New version* link in the menu instead.

Without an Apple Developer ID it's signed ad hoc and not notarized, so macOS blocks it the first time. Open it, dismiss the warning, then go to System Settings > Privacy & Security and click *Open Anyway*. Or in Terminal: `xattr -dr com.apple.quarantine "/Applications/Backrooms Simulator.app"`.

To sign and notarize it properly (needs the paid Apple Developer Program), add these repo secrets and the workflow will use them:

| Secret | What |
| --- | --- |
| `MAC_CERTIFICATE` | the "Developer ID Application" certificate as a base64-encoded .p12 |
| `MAC_CERTIFICATE_PASSWORD` | the .p12's password |
| `APPLE_ID` | Apple ID of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | team ID |

## Troubleshooting

- **Something's wrong in a packaged build:** check `desktop.log` in the data folder above, or start the game with `--devtools`.
- **`npm run desktop` says the web build is missing:** it looks in `dist/`. Run `npm run build` (`npm run desktop` does this for you).
- **Electron starts as plain Node.js from VS Code** ("bad option", or `require('electron')` errors): VS Code sets `ELECTRON_RUN_AS_NODE` in its own processes. The npm scripts clear it, but running `electron .` by hand from a VS Code task doesn't.
- **Windows packaging exits successfully without building anything:** a file named `electron-builder.js` can shadow the real command. Keep the config named `electron-builder.config.js` and use the npm packaging scripts.
- **Permission refused:** the log says which one (`Refused the "..." permission`). See the table above.
