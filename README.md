# Backrooms Simulator

Uses [Three.js](https://threejs.org/) to generate an endless maze inspired by [The Backrooms](https://en.wikipedia.org/wiki/The_Backrooms).

Play it [here](https://jarvisar.github.io/threejs-maze/), or download the [desktop app](https://github.com/jarvisar/threejs-maze/releases). Supports keyboard and mouse, controllers, touch screens and VR through a compatible browser. The website works offline after the first visit and can be installed from your browser.

## Game modes

- **Found Footage:** Collect eight notes and find the exit. Look for the TVs to find notes. Something follows you and gets more aggressive with each one. Keep moving and look away when the static starts. Get out and the tape carries on into Level 1, with eight more notes and the same thing after you.
- **Explore:** Walk around an endless level. Pick it on the title screen: Level 0 (offices, corridors, labyrinths and open halls), Level 1 (a flooded car park with a warehouse and service corridors behind it) or Level 37, the Poolrooms (tiled halls of pools under skylights, flooded rooms and tunnels, and dark water lit from below). In Level 37 you can walk down the steps into the pools, or jump in. In deep water you float and can swim down to go under. Walk into a ladder to climb out, or pull yourself out at the side. Edit mode lets you change walls, put up outlets, place objects from any level and fly around. Your edits are saved locally, for each level.

Both modes use a seed. Enter one in settings or copy a world link to share the same layout. VHS effects, lighting and sound can be adjusted in settings.

## Controls

| Action | Keys |
| --- | --- |
| Move / sprint | WASD or arrow keys / Shift |
| Jump | Space |
| Swim up / down | Space or Q / E in deep water |
| Look / zoom | Mouse / scroll wheel |
| Flashlight | F |
| Save a still | P |
| Edit mode (Explore only) | X |
| Remove / build | Left click / right click in edit mode |
| Choose what to build | Scroll wheel or R in edit mode |
| Each level's objects | Tab in edit mode |
| Fly up / down | Space or Q / E in edit mode |
| Toggle shader effects | 1 |
| Toggle dynamic lights | 2 or G |
| Toggle FPS limit | 3 |
| Toggle resolution | 4 |
| Mute | M |
| Performance stats | F3 or the backtick key |
| Pause / settings | Esc |
| Menus | Arrow keys, Enter to choose, Esc to go back |

With a controller, use the left stick to move, click it to sprint, and use the right stick to look. A jumps (and swims up, B down, in deep water). LT/RT zoom, X toggles the flashlight, View saves a still and Menu pauses. Y toggles edit mode; LT removes, RT builds, LB/RB select objects, the d-pad goes through each level's objects and A/B fly. Use the d-pad and A/B in menus. Press a button for the browser to detect your controller; the controls page shows its button names.

On a touch screen, use the left side to move and the right side to look. Push the movement stick all the way to sprint. Hold the Jump button to jump or swim up.

In VR, use the left stick to move and the right stick to turn. A/X toggles the flashlight. B/Y toggles edit mode, then the trigger builds and the grip removes. Click the right stick to select objects, or push it up/down to fly. In edit mode, clicking the left stick goes through each level's objects. With hand tracking, hold a pinch to walk. Leave VR through the headset menu to pause or change settings. VHS effects are disabled in VR.

## Desktop app

Download from [Releases](https://github.com/jarvisar/threejs-maze/releases):

- Windows: `setup.exe` or `portable.exe`
- Linux / Steam Deck: AppImage
- macOS: `.dmg`

The app uses the same game build. Controllers work without a mouse, stills go to `Pictures/Backrooms Simulator`, and settings and saves are separate from your browser. Use F11 or Alt+Enter (Ctrl+Cmd+F on macOS), or click the right stick, to toggle full screen. Quit is in the pause menu. VR is only available on the website.

The Windows installer and Linux AppImage update automatically when you close the game. Other builds show a link when an update is available.

The downloads aren't code-signed. See [desktop/README.md](desktop/README.md) for first-run instructions on Windows and macOS, Steam Deck setup and troubleshooting.

## Development

Requires [Node.js](https://nodejs.org/) 20.19+ on Node 20, or 22.12+.

```sh
npm install
npm run dev       # start the dev server
npm test          # unit tests
npm run test:e2e   # browser layout and accessibility tests
npm run build     # build into dist/
npm run preview   # serve the build locally
```

For the desktop app, use Node.js 22.12+:

```sh
npm run desktop:install  # install desktop dependencies
npm run desktop          # build and open the app
npm run desktop:dev      # run with hot reload
npm run desktop:test     # build and run the smoke test
npm run desktop:dist     # create installers in desktop/release/
```

The game is in `src/`; the Electron app is in `desktop/`. See [desktop/README.md](desktop/README.md#keeping-the-desktop-app-in-step) when changing the game to check whether the app needs updating too.

Each level is an entry in [src/world/levels.js](src/world/levels.js): how its world is generated, how it's lit, what a tape on it is made of, and where its way out leads. The rest of the game reads from there, so the gameplay (notes, the thing that follows you, the way out) is shared by every level. To add one, write its generator (see `src/world/levelOne.js`), its materials (see `src/world/levelOneMaterials.js`) and its shading (see `src/world/levelShading.js`), then add it to `LEVELS` (and `TAPE_LEVELS` if tapes go through it).

Add `?debug` to the URL to access `window.__backrooms` in the console. `?level=1` opens Explore on Level 1, and `?level=2` on Level 37. To update the app icons, edit `public/icons/backrooms.svg` and run `npm run icons`. This requires Playwright's Chromium (`npx playwright install chromium`) and also updates the desktop icons.

Pushes to `main` deploy to GitHub Pages through [deploy.yml](.github/workflows/deploy.yml). Set Settings → Pages → Source to GitHub Actions when setting up a fork. If hosting elsewhere, update the preview image URLs in `index.html` and `WEB_URL` in `desktop/policy.js`. Desktop builds and release instructions are in [desktop/README.md](desktop/README.md#releasing).

## Credits

- [three.js](https://threejs.org/) (MIT)
- Bad TV, static and RGB shift shaders by [Felix Turner](https://github.com/felixturner/bad-tv-shader) (MIT); film grain/scanline and vignette shaders by alteredq (three.js examples); simplex noise by Ashima Arts (MIT)
- [VCR OSD Mono](https://www.dafont.com/vcr-osd-mono.font) font by Riciery Leal
