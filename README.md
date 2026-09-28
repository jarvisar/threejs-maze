# Backrooms Simulator

Uses [Three.js](https://threejs.org/) to generate an endless maze inspired by [The Backrooms](https://en.wikipedia.org/wiki/The_Backrooms).

Play it [here](https://threejs-maze.jarvisar.com/) or download the [desktop app](https://github.com/jarvisar/threejs-maze/releases). Works with keyboard and mouse, controllers, touch screens, and VR in a browser that supports it. The website works offline after the first visit and can be installed from the browser.

## Game modes

### Found Footage

Collect eight notes and find the exit. Notes are at the TVs. A TV you've seen stays on the map until you take its note. Something follows you and gets more aggressive with each note. Keep moving and look away when the static starts.

Getting out takes the tape down to the next level: Level 1, Level 2, Level 4, Level 5 and then Level 37. Each one has eight more notes and the same thing following you.

### Explore

Walk around an endless level. Pick one from the list on the title screen:

- **Level 0:** offices, corridors, labyrinths and open halls.
- **Level 1:** a flooded car park with a few cars left in the bays, and a warehouse and service corridors behind it. The exit signs over the stair doors stay lit during a power cut.
- **Level 2, Pipe Dreams:** hot service tunnels lined with pipes, store rooms, old brick passages full of steam, and boiler rooms. The boiler fires stay lit when the power goes.
- **Level 4, the Abandoned Office:** empty open-plan floors, cubicles, offices, meeting rooms and a concrete core with lifts and stairs, built around light wells open to the rain. It never stops raining and lightning comes in through the windows.
- **Level 5, the Terror Hotel:** long carpeted corridors of numbered doors, guest rooms, lobbies with marble columns, fireplaces and chandeliers, a ballroom with a bandstand, and staff passages behind it all. A band is still playing somewhere.
- **Level 37, the Poolrooms:** tiled pool halls under skylights, flooded rooms and tunnels, and dark water lit from below. Walk down the steps into the pools or jump in. In deep water you float and can swim down. Walk into a ladder to climb out, or pull yourself out at the side.

### Edit mode

Available in Explore. Change walls, put up outlets, switch lights on, off or flickering, place furniture and objects from any level, hang things on walls and fly around. Once you've found Level Fun, its cakes, balloons and partygoers are in the list too. Edits are saved locally for each level.

### Settings

Both modes use a seed. Enter one in settings or copy a world link to share the same layout. VHS effects, lighting, ambient occlusion and sound can all be changed in settings.

Ambient occlusion is on by default and turns itself off if the frame rate drops below 60. The frame rate is capped at 60 by default, except with a dedicated graphics card.

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
| Remove / build | Left click / right click in edit mode (hold to do a row) |
| Choose what to build | Tab for the list, or the scroll wheel, in edit mode |
| Rotate / change style | R (Shift + R for the other way) / T in edit mode |
| Copy what you aim at | C or middle click in edit mode |
| Undo / redo | Z / Shift + Z in edit mode |
| Fly up / down | Space or Q / E in edit mode |
| Toggle shader effects | 1 |
| Toggle dynamic lights | 2 or G |
| Toggle FPS limit | 3 |
| Toggle resolution | 4 |
| Toggle ambient occlusion | O |
| Mute | M |
| Performance stats | F3 or backtick |
| Pause / settings | Esc |
| Menus | Arrow keys, Enter to choose, Esc to go back |

### Controller

- Left stick moves, click it to sprint. Right stick looks.
- A jumps. In deep water A swims up and B swims down.
- LT/RT zoom, X toggles the flashlight, View saves a still and Menu pauses.
- Y toggles edit mode. In edit mode LT removes, RT builds, clicking the right stick opens the build list, LB/RB step through it, d-pad left/right steps through each level's objects, d-pad up rotates, d-pad down undoes and A/B fly.
- D-pad and A/B for menus.

Press a button so the browser picks up the controller. The controls page shows its button names.

### Touch

Left side of the screen moves, right side looks. Push the stick all the way to sprint. Hold Jump to jump or swim up.

### VR

- Left stick moves, right stick turns. Push the right stick up to jump, or up/down to swim in deep water.
- A/X toggles the flashlight.
- B/Y toggles edit mode. The trigger builds and the grip removes. Click the right stick to pick objects or push it up/down to fly. Clicking the left stick steps through each level's objects.
- With hand tracking, hold a pinch to walk.

Leave VR through the headset menu to pause or change settings. VHS effects are off in VR.

## Desktop app

Download from [Releases](https://github.com/jarvisar/threejs-maze/releases):

- Windows: `setup.exe` or `portable.exe`
- Linux / Steam Deck: AppImage
- macOS: `.dmg`

It's the same game build as the website. Controllers work without a mouse, stills are saved to `Pictures/Backrooms Simulator`, and settings and saves are kept separate from your browser. F11 or Alt+Enter (Ctrl+Cmd+F on macOS), or clicking the right stick, toggles full screen. Quit is in the pause menu. VR only works on the website.

The Windows installer and Linux AppImage update themselves when you close the game. The other builds show a link when there's an update.

The downloads aren't code-signed. See [desktop/README.md](desktop/README.md) for first-run steps on Windows and macOS, Steam Deck setup and troubleshooting.

## Development

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```sh
npm install
npm run dev        # dev server
npm test           # unit tests
npm run test:e2e   # browser layout and accessibility tests
npm run build      # build into dist/
npm run preview    # serve the build locally
```

The desktop app needs Node.js 22.12+:

```sh
npm run desktop:install  # install desktop dependencies
npm run desktop          # build and open the app
npm run desktop:dev      # run with hot reload
npm run desktop:test     # build and run the smoke test
npm run desktop:dist     # make installers in desktop/release/
```

The game is in `src/` and the Electron app is in `desktop/`. When changing the game, check [desktop/README.md](desktop/README.md#keeping-the-desktop-app-in-step) to see if the app needs updating too.

### Levels

Each level is an entry in [src/world/levels.js](src/world/levels.js). The entry covers how the world is generated and lit, what a tape on it is made of, how the thing on the tape behaves there (`tape.watcher`) and where the way out leads. The rest of the game reads from there, so the notes, the thing following you and the way out work the same on every level.

To add a level:

1. Write its generator (see `src/world/levelOne.js`), materials (`src/world/levelOneMaterials.js`) and shading (`src/world/levelShading.js`).
2. Give it an echo (`room`, see `src/audio/Ambience.js`) and its own sound if it has one (`src/audio/LevelAudio.js`).
3. Add it to the end of `LEVELS`. Its position in the list is what saves and links use. Its `number` is what the menus show.
4. Add it to `TAPE_LEVELS` if tapes should go through it. Keep Level 0's `tape.watcher` settings unless the layout needs something different.

### Other notes

- Add `?debug` to the URL to get `window.__backrooms` in the console.
- `?level=N` opens Explore on the level at that position in `LEVELS`. `?level=1` is Level 1, `2` is Level 37, `3` is Level 2, `4` is Level 5 and `5` is Level 4.
- To update the app icons, edit `public/icons/backrooms.svg` and run `npm run icons`. This needs Playwright's Chromium (`npx playwright install chromium`) and updates the desktop icons too.

### Deployment

Pushes to `main` deploy to GitHub Pages through [deploy.yml](.github/workflows/deploy.yml). For a fork, set Settings > Pages > Source to GitHub Actions. If hosting somewhere else, update the preview image URLs in `index.html` and `WEB_URL` in `desktop/policy.js`. Desktop builds and releases are in [desktop/README.md](desktop/README.md#releasing).

## Credits

- [three.js](https://threejs.org/) (MIT)
- [N8AO](https://github.com/N8python/n8ao) ambient occlusion by N8python (CC0)
- Bad TV, static and RGB shift shaders by [Felix Turner](https://github.com/felixturner/bad-tv-shader) (MIT)
- Film grain/scanline and vignette shaders by alteredq (three.js examples)
- Simplex noise by Ashima Arts (MIT)
- [VCR OSD Mono](https://www.dafont.com/vcr-osd-mono.font) font by Riciery Leal
