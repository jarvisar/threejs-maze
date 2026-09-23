# Backrooms Simulator

An endless, procedurally generated [Backrooms](https://en.wikipedia.org/wiki/The_Backrooms) (Level 0) you can explore in the browser, built with [three.js](https://threejs.org/). Yellow wallpaper, humming fluorescent lights and damp carpet, seen through a worn-out VHS tape.

**[Play it here](https://jarvisar.github.io/threejs-maze/)**. Works with a keyboard and mouse, a controller, on a phone or tablet, or in a VR headset. You can also install it (Add to Home Screen on a phone, the install button in the address bar on desktop), and after the first visit it runs without a connection.

## What's in it

- **An infinite level that isn't a grid of blocks.** Walls are thin partitions between rooms, with doorways, pillars and walls that stop halfway across a room. The level is laid out in regions that each feel different: offices cut into rooms of every size, long corridors lined with doors, tight labyrinths, huge pillared halls, and empty floors that seem to go on forever.
- **Seeded worlds.** Every world has a seed, and sharing a link (`?seed=…`) shares the exact same layout. You can also type a seed (a number or a word) in the settings.
- **Lights that fail.** Some panels are dead, dim or flickering, and here and there a whole area has gone dark. The hum fades in the dark, and you'll want the flashlight. Every so often the power goes altogether: the lights stutter, drop out for a few seconds and strike back on a bank at a time. (It can be turned off in Settings → World.)
- **Water damage.** Stains spread across the ceiling tiles, with the carpet soaked underneath, and the wallpaper has come away from the wall where the lights have failed. Now and then someone has left a wet-floor sign.
- **Things left behind.** An office chair, sometimes on its side. A dead monitor. A few bottles of almond water. Rarely, and with a lot of empty floor between them.
- **A camcorder.** REC counter, date stamp, a battery that runs down over a long session, and zoom on the scroll wheel. Press <kbd>P</kbd> to save a still with the date burned in.
- **VHS look.** Static, colour bleed, scanlines, bad tracking and vignette in a single post-processing pass, plus optional bloom. All of it can be tuned or turned off.
- **Sound.** The fluorescent hum, footsteps on carpet, buzzing tubes, and the occasional noise from somewhere far away. All synthesised live with the Web Audio API; there are no audio files.
- **Edit mode.** Knock down walls, build walls, doorways and pillars, or fly above the level and look down on the floor plan. Your changes to a world are saved in your browser.
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
| Edit mode | <kbd>X</kbd>, then left click to remove, right click to build, scroll or <kbd>R</kbd> to choose wall / doorway / pillar, <kbd>Space</kbd>/<kbd>Q</kbd> and <kbd>E</kbd> to fly |
| Mute | <kbd>M</kbd> |
| Performance stats | <kbd>F3</kbd> or <kbd>`</kbd> |
| Pause / settings | <kbd>Esc</kbd> |

With a controller (Xbox, PlayStation, Switch Pro and most others, wired or Bluetooth), use the left stick to move (click it to run) and the right stick to look. RT and LT zoom, X is the flashlight, View saves a still and Menu pauses. Y switches to edit mode, where LT removes, RT builds, LB and RB pick what to build, and A and B fly. The menus work with the d-pad, A and B. Browsers only see a controller once you press one of its buttons, and the controls page uses your controller's own button names.

On a touch screen, put your left thumb down anywhere to walk (push all the way to run), drag on the right half to look around, and use the buttons for the flashlight and pause.

In VR, the left stick walks (click it to run) and the right stick turns, in 30° steps by default (smooth turning is in Settings → Camera). A or X turns the flashlight on in that hand. B or Y is edit mode: point with either controller, the trigger builds and the grip removes, clicking the right stick picks what to build, and pushing it up or down flies. With hand tracking, pinch and hold to walk where you're looking. There's no pause menu in the headset; leave VR with the headset's menu button to pause or change settings. The VHS effects are off in VR: they're drawn over a flat picture, and a picture that wobbles and rolls right in front of your eyes makes people feel sick.

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

Add `?debug` to the URL to expose the game object as `window.__backrooms` in the console.

### Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) tests and builds every push and pull request, and deploys `main` to GitHub Pages. One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

The build uses relative paths, so it works from any sub-path (like `/threejs-maze/`) without configuration.

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
  xr/                  VR headsets (WebXR): session, controllers, the message card shown in the headset
tests/                 Vitest unit tests
```

- **Walls live on the grid lines.** The level is a grid of cells, and each cell owns the wall line on two of its sides (open, wall, or wall with a doorway) and a corner that can hold a pillar (`world/grid.js`).
- **Chunks and zones.** The world is generated in 16×16-cell chunks, each from the seed and its own coordinates, in any order (`world/generator.js`). Chunks take their character from the nearest of a scattering of zone "sites", so similar chunks clump into regions (`world/zones.js`). Offices and corridors are made by recursively cutting the chunk into rooms (binary space partitioning); labyrinths by a randomized depth-first search with some walls knocked through afterwards.
- **Everything is reachable.** Neighbouring chunks only share the wall on their common border, which is derived from the border's own coordinates so both sides agree. Every border has a way through, and every chunk checks that all of its own cells connect (punching a doorway through if not), so the whole infinite level is connected. The tests check this.
- **Meshing.** Each cell is divided into bands (wall thickness, the doorway, the space either side of it), and the wall surface is every boundary between a solid and an empty band. Corners, wall ends, T-junctions and doorways all come out of that without special cases (`world/chunkGeometry.js`). One merged mesh per chunk for walls, one for baseboards, one for small details; chunks stream in and out around the player, so draw calls and memory stay flat however far you walk.
- **Stains and props** are decided with the chunk, after its walls, from the same random stream, so worlds shared before they existed look the same apart from them (`world/decorations.js`). Stains are pictures laid a hair over the surfaces (`world/decals.js`), drawn with the 2D canvas when the game loads rather than shipped as files (`world/decorationTextures.js`); the peeling wallpaper is worked out when a chunk is meshed, from the walls as they are now and the state of the light over each one. Props are boxes and cylinders coloured by their vertices, merged into one mesh per chunk, and the ones you can't walk through are boxes in the same collision query as the walls (`world/props.js`).
- **Power cuts** are a single uniform the lighting shaders multiply the panels and the area light by, with the timing and the stutter worked out on the CPU (`world/blackouts.js`), so a cut costs nothing to draw and never touches the panel texture.
- **Ceiling lights** are evaluated per pixel from the panels' regular grid rather than added as hundreds of real lights. Each panel's state (dead, dim, flickering, how dark the area around it is) is copied into a small texture around the player, which every material reads. Where the lights are fine, all of that multiplies by one and the scene looks exactly as before.
- **No mid-game freezes.** Every texture is uploaded and every shader compiled behind the loading screen, and nothing changes the set of lights afterwards (which would force three.js to recompile shaders).
- **Movement** runs in fixed 60 Hz steps with interpolation, so speed doesn't depend on your frame rate. Collision sweeps the player's box against the nearby walls one axis at a time, so you slide along walls instead of sticking to them.
- **VR scale.** One world unit is 2.7 m in a headset. The tracking space is scaled down to fit, but the scale is taken back out of the eyes' view matrices afterwards, so view space stays in world units and the fog, far plane and ceiling lights (all worked out in view space) look the same as on a screen.
- **Classic look.** Colour management, light intensities, light falloff and bump mapping are configured to match how three.js rendered before r152–r155, which is what the scene was designed with.

## Credits

- [three.js](https://threejs.org/) (MIT)
- Bad TV, static and RGB shift shaders by [Felix Turner](https://github.com/felixturner/bad-tv-shader) (MIT); film grain/scanline and vignette shaders by alteredq (three.js examples); simplex noise by Ashima Arts (MIT)
- [VCR OSD Mono](https://www.dafont.com/vcr-osd-mono.font) font by Riciery Leal
