# Backrooms Simulator

An endless, procedurally generated [Backrooms](https://en.wikipedia.org/wiki/The_Backrooms) (Level 0) you can explore in the browser, built with [three.js](https://threejs.org/). Yellow wallpaper, humming fluorescent lights and damp carpet, seen through a worn-out VHS tape.

**[Play it here](https://jarvisar.github.io/threejs-maze/)**. Works with a keyboard and mouse, or on a phone or tablet.

## What's in it

- **An infinite level that isn't a grid of blocks.** Walls are thin partitions between rooms, with doorways, pillars and walls that stop halfway across a room. The level is laid out in regions that each feel different: offices cut into rooms of every size, long corridors lined with doors, tight labyrinths, huge pillared halls, and empty floors that seem to go on forever.
- **Seeded worlds.** Every world has a seed, and sharing a link (`?seed=…`) shares the exact same layout. You can also type a seed (a number or a word) in the settings.
- **Lights that fail.** Some panels are dead, dim or flickering, and here and there a whole area has gone dark. The hum fades in the dark, and you'll want the flashlight.
- **A camcorder.** REC counter, date stamp, a battery that runs down over a long session, and zoom on the scroll wheel. Press <kbd>P</kbd> to save a still with the date burned in.
- **VHS look.** Static, colour bleed, scanlines, bad tracking and vignette in a single post-processing pass, plus optional bloom. All of it can be tuned or turned off.
- **Sound.** The fluorescent hum, footsteps on carpet, buzzing tubes, and the occasional noise from somewhere far away. All synthesised live with the Web Audio API; there are no audio files.
- **Edit mode.** Knock down walls, build walls, doorways and pillars, or fly above the level and look down on the floor plan. Your changes to a world are saved in your browser.

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

On a touch screen, put your left thumb down anywhere to walk (push all the way to run), drag on the right half to look around, and use the buttons for the flashlight and pause.

## Development

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```sh
npm install
npm run dev       # dev server with hot reload
npm test          # unit tests (level generation, collision, raycasting, …)
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
  world/               level generation, chunk data, meshes, materials, lighting
  player/              movement, collision, edit mode
  fx/                  post-processing (VHS shader, bloom)
  input/, ui/, audio/  mouse, keyboard and touch; menus and overlay; sound
tests/                 Vitest unit tests
```

- **Walls live on the grid lines.** The level is a grid of cells, and each cell owns the wall line on two of its sides (open, wall, or wall with a doorway) and a corner that can hold a pillar (`world/grid.js`).
- **Chunks and zones.** The world is generated in 16×16-cell chunks, each from the seed and its own coordinates, in any order (`world/generator.js`). Chunks take their character from the nearest of a scattering of zone "sites", so similar chunks clump into regions (`world/zones.js`). Offices and corridors are made by recursively cutting the chunk into rooms (binary space partitioning); labyrinths by a randomized depth-first search with some walls knocked through afterwards.
- **Everything is reachable.** Neighbouring chunks only share the wall on their common border, which is derived from the border's own coordinates so both sides agree. Every border has a way through, and every chunk checks that all of its own cells connect (punching a doorway through if not), so the whole infinite level is connected. The tests check this.
- **Meshing.** Each cell is divided into bands (wall thickness, the doorway, the space either side of it), and the wall surface is every boundary between a solid and an empty band. Corners, wall ends, T-junctions and doorways all come out of that without special cases (`world/chunkGeometry.js`). One merged mesh per chunk for walls, one for baseboards, one for small details; chunks stream in and out around the player, so draw calls and memory stay flat however far you walk.
- **Ceiling lights** are evaluated per pixel from the panels' regular grid rather than added as hundreds of real lights. Each panel's state (dead, dim, flickering, how dark the area around it is) is copied into a small texture around the player, which every material reads. Where the lights are fine, all of that multiplies by one and the scene looks exactly as before.
- **No mid-game freezes.** Every texture is uploaded and every shader compiled behind the loading screen, and nothing changes the set of lights afterwards (which would force three.js to recompile shaders).
- **Movement** runs in fixed 60 Hz steps with interpolation, so speed doesn't depend on your frame rate. Collision sweeps the player's box against the nearby walls one axis at a time, so you slide along walls instead of sticking to them.
- **Classic look.** Colour management, light intensities, light falloff and bump mapping are configured to match how three.js rendered before r152–r155, which is what the scene was designed with.

## Credits

- [three.js](https://threejs.org/) (MIT)
- Bad TV, static and RGB shift shaders by [Felix Turner](https://github.com/felixturner/bad-tv-shader) (MIT); film grain/scanline and vignette shaders by alteredq (three.js examples); simplex noise by Ashima Arts (MIT)
- [VCR OSD Mono](https://www.dafont.com/vcr-osd-mono.font) font by Riciery Leal
