# Backrooms Simulator

An endless, procedurally generated [Backrooms](https://en.wikipedia.org/wiki/The_Backrooms) (Level 0) you can explore in the browser, built with [three.js](https://threejs.org/). Yellow wallpaper, humming fluorescent lights and damp carpet, seen through a worn-out VHS tape.

**[Play it here](https://jarvisar.github.io/threejs-maze/)** (desktop browser with keyboard and mouse).

## Features

- **Infinite, seeded world.** The level is generated in 10×10 chunks as you walk, using a randomized [Prim's algorithm](https://en.wikipedia.org/wiki/Maze_generation_algorithm#Iterative_randomized_Prim's_algorithm_(without_stack,_without_sets)). Every world has a seed, so sharing a link (`?seed=…`) shares the exact same layout.
- **VHS look.** Static, RGB shift, scanlines, tape distortion and vignette in a single post-processing pass, plus optional bloom. Every effect can be tuned or turned off.
- **Lighting.** Toggleable ceiling lights, and a flashlight that casts shadows.
- **Edit mode.** Knock down walls, build new ones, or fly above the level and look down on the maze.
- **Settings.** Resolution, FPS limit, field of view, mouse sensitivity, head bob, volume and more, saved between visits.
- **Ambient hum.** The fluorescent-light buzz, synthesised live with the Web Audio API.

## Controls

| Action | Keys |
| --- | --- |
| Move / sprint | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (or arrow keys) / <kbd>Shift</kbd> |
| Look | Mouse |
| Flashlight | <kbd>F</kbd> |
| Toggle shader effects | <kbd>1</kbd> |
| Toggle dynamic lights | <kbd>2</kbd> or <kbd>G</kbd> |
| Toggle FPS limit | <kbd>3</kbd> |
| Toggle resolution (50% / 100%) | <kbd>4</kbd> |
| Edit mode | <kbd>X</kbd>, then left click to remove a wall, right click to place one, <kbd>Space</kbd>/<kbd>Q</kbd> and <kbd>E</kbd> to fly |
| Mute | <kbd>M</kbd> |
| Performance stats | <kbd>F3</kbd> or <kbd>`</kbd> |
| Pause / settings | <kbd>Esc</kbd> |

## Development

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```sh
npm install
npm run dev       # dev server with hot reload
npm test          # unit tests (maze generation, collision, raycasting, …)
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
  world/               maze generation, chunk data, chunk meshes, materials, lighting
  player/              movement, collision, edit mode
  fx/                  post-processing (VHS shader, bloom)
  input/, ui/, audio/  mouse/keyboard, menus and HUD, ambient sound
tests/                 Vitest unit tests
```

- **Chunks.** `ChunkStore` holds each chunk's walls (100 bytes, derived from the seed). `WorldView` builds one merged mesh per chunk containing only the wall faces that border open space, and streams chunks in and out around the player. Draw calls and memory stay flat however far you walk.
- **No mid-game freezes.** Every texture is uploaded and every shader compiled behind the loading screen, and nothing changes the set of lights afterwards (which would force three.js to recompile shaders).
- **Ceiling lights** are evaluated per pixel from the panels' regular grid, not added as hundreds of real lights. Every panel in the world lights up at a constant cost.
- **Movement** runs in fixed 60 Hz steps with interpolation, so speed doesn't depend on your frame rate. Collision checks only the grid cells around the player, and you slide along walls instead of sticking to them.
- **Classic look.** Colour management, light intensities, light falloff and bump mapping are configured to match how three.js rendered before r152–r155, which is what the scene was designed with.

## Credits

- [three.js](https://threejs.org/) and [lil-gui](https://lil-gui.georgealways.com/) (MIT)
- Bad TV, static and RGB shift shaders by [Felix Turner](https://github.com/felixturner/bad-tv-shader) (MIT); film grain/scanline and vignette shaders by alteredq (three.js examples); simplex noise by Ashima Arts (MIT)
- [VCR OSD Mono](https://www.dafont.com/vcr-osd-mono.font) font by Riciery Leal
