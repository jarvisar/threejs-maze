# Backrooms Simulator

An endless, procedurally generated [Backrooms](https://en.wikipedia.org/wiki/The_Backrooms) (Level 0) you can explore in the browser, built with [three.js](https://threejs.org/). Yellow wallpaper, humming fluorescent lights and damp carpet, seen through a worn-out VHS tape.

**[Play it here](https://jarvisar.github.io/threejs-maze/)**. Works with a keyboard and mouse, a controller, on a phone or tablet, or in a VR headset. You can also install it (Add to Home Screen on a phone, the install button in the address bar on desktop), and after the first visit it runs without a connection. There's also a [desktop app](#desktop-app) for Windows, Linux (the Steam Deck too) and macOS.

Two modes, picked on the title screen: **Found Footage**, a game in a walled-in part of the level, and **Explore**, the endless level. Found Footage is picked the first time you play; after that, whichever you picked last. Title in the pause menu goes back to the title screen.

## Found Footage

- **Eight notes** are pinned to walls, each where someone camped and left the TV on. The screen shows a dead channel and lights up the wall and carpet around it, so you can spot it down a corridor, and you can hear its hiss and hum from the direction it's in (muffled if there's a wall in the way). Walk up to a note to take it, and its TV goes off.
- **Something is in there with you.** It behaves like Slender Man. It wakes with the first note, or on its own if you haven't found one after a minute and a half. From then on it's always somewhere near you, and every few seconds, while you're not looking, it's somewhere else and usually nearer: out of shot, behind you, round the corner you're heading for, or behind the wall you're facing. You never see it arrive or leave, and nothing moves it while any of it could be seen. Seeing it ruins the tape (static, the lights failing, the sound rising, and a sting when you catch sight of it), and so does being near it, whichever way you're facing. Let the tape go, or walk into it, and it's over. Look away and it's either gone for a moment or already nearer. Stand still and each jump lands closer until it's on you, so keep moving, don't stare, and when the static starts, get away from it. It jumps more often, and closer, with every note, and the music adds a layer as you go.
- **The way out** opens in the arena's wall with the eighth note, on the far side from you, lit. It can be heard from a distance. By then the level is dark.
- **Stamina.** About seven seconds of sprinting, and a while to get it back.
- The arena is 4 × 4 chunks (about 170 m across) with every kind of zone in it and nothing beyond its walls. It comes from the seed, so a link to it (`?seed=…&mode=footage`) shares the same tape. The fastest escape is kept in the browser. Power cuts, the flashlight, zoom and stills work in the mode; edit mode doesn't.

## What's in it

- **An infinite level that isn't a grid of blocks.** Walls are thin partitions between rooms, with doorways, pillars and walls that stop halfway across a room. The level is laid out in regions that each feel different: offices cut into rooms of every size, long corridors lined with doors, tight labyrinths, huge pillared halls, and empty floors that seem to go on forever.
- **Seeded worlds.** Every world has a seed, and sharing a link (`?seed=…&mode=explore`) shares the exact same layout. You can also type a seed (a number or a word) in the settings.
- **Lights that fail.** Some panels are dead, dim or flickering, and here and there a whole area has gone dark. The hum fades in the dark, and you'll want the flashlight. Every so often the power goes altogether: the lights stutter, drop out for a few seconds and strike back on a bank at a time. (It can be turned off in Settings → World.)
- **Water damage.** Stains spread across the ceiling tiles, with the carpet soaked and shining underneath. Sometimes a sodden tile has come down and broken on the floor, leaving a hole. Where the lights have failed, strips of wallpaper have peeled off the wall and hang curled from where they tore. Now and then someone has left a wet-floor sign.
- **Things left behind.** An office chair, sometimes on its side. A dead monitor. A few bottles of almond water. Rarely, and with a lot of empty floor between them.
- **A camcorder.** REC counter, date stamp, a battery that runs down over a long session, and zoom on the scroll wheel. Press <kbd>P</kbd> to save a still with the date burned in.
- **VHS look.** Static, colour bleed, scanlines, bad tracking and vignette in a single post-processing pass, plus optional bloom. All of it can be tuned or turned off.
- **Sound.** The fluorescent hum, footsteps on carpet, buzzing tubes, and the occasional noise from somewhere far away. All synthesised live with the Web Audio API; there are no audio files.
- **Edit mode.** Knock down walls, build walls, doorways and pillars, put down or clear away chairs, monitors, bottles and wet-floor signs, or fly above the level and look down on the floor plan. Your changes to a world are saved in your browser.
- **VR.** With a headset (a Quest in its browser, or a PC headset with a browser that supports WebXR), an Enter VR button appears on the menu. The rooms are full size, you can walk around your own room as well as with the stick (the walls still stop you), and the flashlight is in your hand.

## Controls

| Action | Keys |
| --- | --- |
| Move / sprint | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (or arrow keys) / <kbd>Shift</kbd> |
| Look / zoom | Mouse / scroll wheel |
| Flashlight | <kbd>F</kbd> |
| Save a still | <kbd>P</kbd> |
| Toggle shader effects | <kbd>1</kbd> |
| Toggle dynamic lights | <kbd>2</kbd> or <kbd>G</kbd> |
| Toggle FPS limit | <kbd>3</kbd> |
| Toggle resolution (50% / 100%) | <kbd>4</kbd> |
| Edit mode | <kbd>X</kbd>, then left click to remove, right click to build, scroll or <kbd>R</kbd> to choose wall / doorway / pillar / chair / monitor / bottles / sign, <kbd>Space</kbd>/<kbd>Q</kbd> and <kbd>E</kbd> to fly |
| Mute | <kbd>M</kbd> |
| Performance stats | <kbd>F3</kbd> or <kbd>`</kbd> |
| Pause / settings | <kbd>Esc</kbd> |

With a controller (Xbox, PlayStation, Switch Pro and most others, wired or Bluetooth), use the left stick to move (click it to run) and the right stick to look. RT and LT zoom, X is the flashlight, View saves a still and Menu pauses. Y switches to edit mode, where LT removes, RT builds, LB and RB pick what to build, and A and B fly. The menus work with the d-pad, A and B. Clicking the right stick goes full screen (or back); browsers won't do that for a controller alone, so the game then asks for a click or a key press. Browsers only see a controller once you press one of its buttons, and the controls page uses your controller's own button names.

On a touch screen, put your left thumb down anywhere to walk (push all the way to run), drag on the right half to look around, and use the buttons for the flashlight and pause.

In VR, the left stick walks (click it to run) and the right stick turns, in 30° steps by default (smooth turning is in Settings → Camera). A or X turns the flashlight on in that hand. B or Y is edit mode: point with either controller, the trigger builds and the grip removes, clicking the right stick picks what to build, and pushing it up or down flies. With hand tracking, pinch and hold to walk where you're looking. There's no pause menu in the headset; leave VR with the headset's menu button to pause or change settings. The VHS effects are off in VR: they're drawn over a flat picture, and a picture that wobbles and rolls right in front of your eyes makes people feel sick.

## Desktop app

The same game as a desktop app, from the [Releases](https://github.com/jarvisar/threejs-maze/releases) page: the `setup.exe` (or the `portable.exe`, which doesn't install) on Windows, the AppImage on Linux and the Steam Deck, the `.dmg` on a Mac. It runs full screen (<kbd>F11</kbd> or <kbd>Alt</kbd>+<kbd>Enter</kbd>, or click the right stick), a controller works from the title screen on without the mouse, stills go to `Pictures/Backrooms Simulator`, and Quit is in the menu. Its settings and saves are its own, separate from the browser's. There's no VR in it.

The downloads aren't code-signed, so Windows and macOS warn about them the first time. [desktop/README.md](desktop/README.md) explains how to get past that, and how to add the game to Steam on a Steam Deck.

## Development

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```sh
npm install
npm run dev       # dev server with hot reload
npm test          # unit tests (level generation, collision, raycasting, …)
npm run test:e2e  # layout and accessibility checks at phone, tablet and desktop sizes
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

The desktop app lives in `desktop/`, with its own dependencies (Node.js 22.12+). It wraps the same build:

```sh
npm run desktop:install  # once
npm run desktop          # build and open the game in the desktop app
npm run desktop:dev      # the desktop app on the dev server, with hot reload
npm run desktop:test     # smoke test of the desktop app
npm run desktop:dist     # installers for this computer's platform, into desktop/release/
```

See [desktop/README.md](desktop/README.md) for how it works, what to watch for when changing the game, and releasing.

Add `?debug` to the URL to expose the game object as `window.__backrooms` in the console.

### App artwork

The favicon, install icons, Apple touch icon, Safari pinned tab and link previews use a custom yellow Backrooms corridor. Edit `public/icons/backrooms.svg`, then run `npm run icons` to regenerate the PNG sizes, padded maskable icons, multi-size ICO and VHS-style share card. This uses the existing Playwright dependency; install its browser with `npx playwright install chromium` if needed. The desktop app's icons in `desktop/build/` come from the same run. Generated assets are checked in, so regular builds need no artwork tooling. The monochrome pinned-tab SVG is maintained separately.

Maskable artwork stays inside the [manifest safe zone](https://www.w3.org/TR/appmanifest/#icon-masks). The [Open Graph](https://ogp.me/) and Twitter image URLs in `index.html` point at the GitHub Pages deployment; update those absolute URLs if moving to another host.

### Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) tests and builds every push and pull request, and deploys `main` to GitHub Pages. One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

The build uses relative paths, so it works from any sub-path (like `/threejs-maze/`) without configuration.

[`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) smoke-tests the desktop app on every change to the game, builds it for Windows, Linux and macOS on every push to `main`, and drafts a GitHub Release with the builds for a version tag (`v2.1.0`).

## How it works

```
src/
  main.js, Game.js     startup, game loop, states (loading → title → playing ⇄ paused)
  config.js            world and movement constants
  settings.js          user settings and persistence
  sw.js                service worker (offline play, installing); the build fills in the file list
  world/               level generation, chunk data, meshes, materials, lighting, stains and props
  player/              movement, collision, edit mode
  fx/                  post-processing (VHS shader, bloom)
  input/, ui/, audio/  mouse, keyboard, touch and controllers; menus and overlay; sound
  footage/             the Found Footage mode: the arena, the notes, the thing on the tape
  xr/                  VR headsets (WebXR): session, controllers, the message card shown in the headset
  desktop.js           what the desktop app adds to the page (null in a browser)
tests/                 Vitest unit tests
desktop/               the desktop app: Electron around the web build, packaging, its smoke test
```

- **Walls live on the grid lines.** The level is a grid of cells, and each cell owns the wall line on two of its sides (open, wall, or wall with a doorway) and a corner that can hold a pillar (`world/grid.js`).
- **Chunks and zones.** The world is generated in 16×16-cell chunks, each from the seed and its own coordinates, in any order (`world/generator.js`). Chunks take their character from the nearest of a scattering of zone "sites", so similar chunks clump into regions (`world/zones.js`). Offices and corridors are made by recursively cutting the chunk into rooms (binary space partitioning); labyrinths by a randomized depth-first search with some walls knocked through afterwards.
- **Everything is reachable.** Neighbouring chunks only share the wall on their common border, which is derived from the border's own coordinates so both sides agree. Every border has a way through, and every chunk checks that all of its own cells connect (punching a doorway through if not), so the whole infinite level is connected. The tests check this.
- **Meshing.** Each cell is divided into bands (wall thickness, the doorway, the space either side of it), and the wall surface is every boundary between a solid and an empty band. Corners, wall ends, T-junctions and doorways all come out of that without special cases (`world/chunkGeometry.js`). One merged mesh per chunk for walls, one for baseboards, one for small details; chunks stream in and out around the player, so draw calls and memory stay flat however far you walk.
- **Stains and props** are decided with the chunk, after its walls, from the same random stream, so worlds shared before they existed look the same apart from them (`world/decorations.js`). Stains are pictures laid a hair over the surfaces (`world/decals.js`), drawn with the 2D canvas when the game loads rather than shipped as files (`world/decorationTextures.js`). Wet carpet shines at a glancing angle, and reflects a lit panel where the view would bounce up to one. The peeling wallpaper is worked out when a chunk is meshed, from the walls as they are now and the state of the light over each one: each strip starts at a join in the paper and is a curled mesh, wallpaper on the front and the back of the paper behind (`world/peels.js`). Props are boxes and cylinders coloured by their vertices, merged into one mesh per chunk, and the ones you can't walk through are boxes in the same collision query as the walls (`world/props.js`).
- **Soft shading** where the walls meet the floor, the ceiling and each other, and under every prop, is a strip that fades out from the join, built with the walls (`world/chunkGeometry.js`). The wallpaper shader adds the joins between strips of paper, uneven yellowing and grime along the bottom, and the ceiling takes a little light around each lit panel.
- **Power cuts** are a single uniform the lighting shaders multiply the panels and the area light by, with the timing and the stutter worked out on the CPU (`world/blackouts.js`), so a cut costs nothing to draw and never touches the panel texture. Found Footage drives the same uniform to darken the level with each note and when it's close.
- **Found Footage** (`footage/`) is its own `ChunkStore` with options the generator understands (`WorldOptions`: which zone each chunk gets, which borders are solid from end to end, which chunks are nothing at all), so the walled arena is made by the same code as the endless level. The notes and their TVs are placed once per seed (`footage/arena.js`) and drawn on a canvas (`footage/noteTextures.js`). The figure is pure logic (`footage/Watcher.js`): each time it moves it checks every cell at the distance it wants for a clear line to you (a raycast through the level, the same one edit mode aims with) and picks the best one, and its exposure is turned into the picture and the sound by `footage/FoundFootage.js` and `audio/Dread.js`. It only arrives, moves or leaves out of sight: out of the picture, or completely behind walls (rays from the eye to its whole silhouette, from where you are and where you're about to be). `footage/screenGuard.js` decides where the picture is. It uses the camera's real frustum, widened by a margin and always at the widest zoom. It also checks where the camera will point a moment later from how fast it's turning, and one snap turn either way in VR. While the camera is being whipped round, nowhere counts as out of the picture. A new spot also has to stay out of the picture for a fifth of a second before the figure is there, so turning towards it calls the visit off.
- **Ceiling lights** are evaluated per pixel from the panels' regular grid rather than added as hundreds of real lights. Each panel's state (dead, dim, flickering, how dark the area around it is) is copied into a small texture around the player, which every material reads. Where the lights are fine, all of that multiplies by one and the scene looks exactly as before. These "dynamic lights" are on by default, but they're the most expensive thing to draw, so if the frame rate stays below 40 fps (or three quarters of the FPS limit) for five seconds while playing, they're switched off and the game says so. They can be turned back on in Settings, and then they stay on.
- **No mid-game freezes.** Every texture is uploaded and every shader compiled behind the loading screen, and nothing changes the set of lights afterwards (which would force three.js to recompile shaders).
- **Movement** runs in fixed 60 Hz steps with interpolation, so speed doesn't depend on your frame rate. Collision sweeps the player's box against the nearby walls one axis at a time, so you slide along walls instead of sticking to them.
- **VR scale.** One world unit is 2.7 m in a headset. The tracking space is scaled down to fit, but the scale is taken back out of the eyes' view matrices afterwards, so view space stays in world units and the fog, far plane and ceiling lights (all worked out in view space) look the same as on a screen.
- **Classic look.** Colour management, light intensities, light falloff and bump mapping are configured to match how three.js rendered before r152–r155, which is what the scene was designed with.

## Credits

- [three.js](https://threejs.org/) (MIT)
- Bad TV, static and RGB shift shaders by [Felix Turner](https://github.com/felixturner/bad-tv-shader) (MIT); film grain/scanline and vignette shaders by alteredq (three.js examples); simplex noise by Ashima Arts (MIT)
- [VCR OSD Mono](https://www.dafont.com/vcr-osd-mono.font) font by Riciery Leal
