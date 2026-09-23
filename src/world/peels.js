import { CHUNK_SIZE, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { BARE_WALL_DEPTH, DECAL_PICTURES, uvOf } from './decalAtlas.js';
import { EDGE_WALL } from './grid.js';
import { hashFloat, wallpaperOffset } from './random.js';

/*
 * Wallpaper coming away from the walls.
 *
 * Wallpaper is hung in strips (a quarter of a unit wide; the wall shader draws the joins), and it comes away
 * where water has got behind it, from the top. So a peel here is one strip, or a torn part of one, that has
 * let go from the ceiling down to where it tore, and hangs from there: it curls up and out over itself and
 * drops in front of the wall, showing the back of the paper, with the pattern on the inside of the curl.
 * Behind it is the wall it came off, stained and patchy with old paste, and below it, its shadow.
 *
 * The strip is real geometry: its front goes in with the walls (so it has the wallpaper, matched to where it
 * hung, and casts a shadow in the flashlight), the back of the paper and the bare wall go in with the decals.
 *
 * Where: each face of each wall rolls for one, from the seed and its own coordinates, and it's much more
 * likely where the lights have failed, so the two kinds of decay go together. A wall knocked down in edit
 * mode takes its peel with it.
 */

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;
// How far in front of the wall the bare wall is drawn (with a polygon offset in the material too).
const WALL_OFFSET = 0.002;

// Peels per wall face, and how much more likely one is where the nearest light has died or is failing.
const PEEL_CHANCE = 0.003;
const PEEL_CHANCE_FAILING = 0.06;

// The strips the paper was hung in (texture units; the texture repeats once per unit).
const STRIP = 0.25;
// Keep clear of the posts at the ends of a wall.
const END_MARGIN = 0.05;
// How much of the wall has come away, measured down from the ceiling.
const DROP_MIN = 0.17;
const DROP_RANGE = 0.23;
// The curl, and how far from the wall any of it may get (the player's camera comes no nearer than 0.12).
const CURL_MIN = 0.028;
const CURL_RANGE = 0.014;
const MAX_OUT = 0.1;
const MIN_OUT = 0.004;
// How much of the overhead light the upward-facing parts of a strip catch (see addStrip).
const UPWARD_LIGHT = 0.3;
// Mesh resolution of a strip: across it, and along it.
const COLUMNS = 5;
const ROWS = 14;

const BARE_WALL = DECAL_PICTURES.bareWall;
const BARE_WALL_UV = BARE_WALL.map(uvOf);
const PAPER_BACK_UV = uvOf(DECAL_PICTURES.paperBack[0]);

/**
 * Adds the chunk's peeling wallpaper: the bare wall and the back of each strip to `decals`, the front of
 * each strip to `walls`. Positions are relative to the chunk centre (ox, oz).
 *
 * @param {import('./GeometryBuilder.js').GeometryBuilder} decals
 * @param {import('./GeometryBuilder.js').GeometryBuilder} walls
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {{ ex: (x: number, z: number) => number, ez: (x: number, z: number) => number }} grid
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @param {number} ox
 * @param {number} oz
 */
export function addPeels(decals, walls, store, grid, x0, z0, ox, oz) {
    const seed = store.seed;
    const [offsetU] = wallpaperOffset(seed);
    // Decals don't write depth, so within the chunk's one mesh of them, whatever is added later is drawn over
    // whatever was added earlier. The strips go in after every bare wall, so that the paper is drawn over
    // the wall behind it rather than the wall showing through the paper.
    const strips = [];
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            for (let axis = 0; axis < 2; axis++) {
                if ((axis === 0 ? grid.ex(x, z) : grid.ez(x, z)) !== EDGE_WALL) continue;
                for (let side = 1; side >= -1; side -= 2) {
                    const slot = axis * 2 + (side > 0 ? 1 : 0);
                    // The cell this face is seen from.
                    const roomX = axis === 0 && side > 0 ? x + 1 : x;
                    const roomZ = axis === 1 && side > 0 ? z + 1 : z;
                    const chance = PEEL_CHANCE + PEEL_CHANCE_FAILING * failingLightAt(store, roomX, roomZ);
                    if (hashFloat(seed, 0x9ee1, x, z, slot) >= chance) continue;
                    const random = (k) => hashFloat(seed, 0x9ee2 + k, x, z, slot);
                    const peel = choosePeel(random, axis, side, axis === 0 ? z : x, offsetU);
                    const plane = (axis === 0 ? x : z) + 0.5 + side * HALF_THICKNESS - (axis === 0 ? ox : oz);
                    const shift = axis === 0 ? oz : ox;
                    addBareWall(decals, axis, side, plane, peel.a0 - shift, peel.a1 - shift, peel, random(20) < 0.5);
                    strips.push(() => addStrip(walls, decals, axis, side, plane, peel.a0 - shift, peel.a1 - shift, peel, random));
                }
            }
        }
    }
    for (const strip of strips) strip();
}

/**
 * Where along the wall a peel is (a0..a1, world coordinates along it), how far down it has come, and the
 * shape of its curl. It starts at a join between strips, and is the whole strip or a torn part of it.
 */
function choosePeel(random, axis, side, cell, offsetU) {
    const lo = cell - 0.5 + HALF_THICKNESS + END_MARGIN;
    const hi = cell + 0.5 - HALF_THICKNESS - END_MARGIN;
    // Texture u runs along the wall as (position × right + offset), so the joins are at these positions.
    const right = axis === 0 ? -side : side;
    const phase = ((((-right * offsetU) / STRIP) % 1) + 1) % 1;
    const joins = [];
    for (let k = Math.ceil(lo / STRIP - phase); (k + phase) * STRIP <= hi; k++) joins.push((k + phase) * STRIP);
    const join = joins[Math.floor(random(1) * joins.length)] ?? cell;
    const width = random(2) < 0.55 ? STRIP : 0.08 + random(3) * 0.12;
    let dir = random(4) < 0.5 ? 1 : -1;
    if ((dir > 0 ? join + width : join - width) > hi || (dir > 0 ? join + width : join - width) < lo) dir = -dir;
    let a0 = Math.min(join, join + dir * width);
    let a1 = Math.max(join, join + dir * width);
    a0 = Math.max(a0, lo);
    a1 = Math.min(a1, hi);
    const drop = DROP_MIN + DROP_RANGE * random(5);
    return {
        a0,
        a1,
        drop,
        curl: CURL_MIN + CURL_RANGE * random(6),
        // One side curls tighter than the other, so the strip hangs a little twisted.
        twist: (random(7) - 0.5) * 0.7,
        // How far round it has come by the time it hangs: just short of straight down, to resting on the wall.
        turn: Math.PI - 0.1 + 0.32 * random(8),
    };
}

/**
 * The strip itself: hinged along the tear, it rises off the wall, curls over and hangs down in front of it.
 * Traced along its length with the angle it's turned through (0: up the wall, π/2: straight out, π: straight
 * down), curving at 1 / curl until it has turned far enough, and flicking out a little at its torn end.
 */
function addStrip(walls, decals, axis, side, plane, a0, a1, peel, random) {
    const tearY = WALL_HEIGHT - peel.drop;
    const right = axis === 0 ? -side : side;
    // [out, y, angle] for every row of every column.
    const profiles = [];
    for (let c = 0; c <= COLUMNS; c++) {
        const t = c / COLUMNS;
        const radius = peel.curl * (1 + peel.twist * (t - 0.5));
        const turn = peel.turn + peel.twist * (t - 0.5) * 0.5;
        // A ragged torn end.
        const length = peel.drop * (1 - 0.07 * random(10 + c));
        const ds = length / ROWS / 4;
        let out = MIN_OUT;
        let y = tearY;
        let angle = 0;
        const profile = [[out, y, angle]];
        for (let row = 1; row <= ROWS; row++) {
            for (let step = 0; step < 4; step++) {
                const s = ((row - 1) * 4 + step + 0.5) / (ROWS * 4);
                if (s > 0.86) angle -= (0.7 / radius) * ds;
                else if (angle < turn) angle = Math.min(turn, angle + ds / radius);
                out += Math.sin(angle) * ds;
                y += Math.cos(angle) * ds;
            }
            profile.push([Math.min(Math.max(out, MIN_OUT), MAX_OUT), y, angle]);
        }
        profiles.push(profile);
    }

    const middle = (a0 + a1) / 2;
    const vertex = (c, row, back) => {
        const [out, y, angle] = profiles[c][row];
        const t = c / COLUMNS;
        const along = row / ROWS;
        // Narrower towards its torn end.
        const a = middle + (a0 + (a1 - a0) * t - middle) * (1 - 0.08 * along);
        const p = plane + side * out;
        // Its normal, turned with it. Upward-facing parts are only let catch a little of the overhead
        // light (which lights nothing else on a wall), or the top of the curl glares.
        const facing = back ? -1 : 1;
        let n = side * Math.cos(angle) * facing;
        let ny = -Math.sin(angle) * facing;
        if (ny > 0) ny *= UPWARD_LIGHT;
        const length = Math.hypot(n, ny) || 1;
        n /= length;
        ny /= length;
        const u = back ? PAPER_BACK_UV.u0 + t * (PAPER_BACK_UV.u1 - PAPER_BACK_UV.u0) : a * right;
        // The front shows the wallpaper where it hung (it came from tear + distance along it); the back of
        // the paper's picture runs from the tear (top) to the end that was up at the ceiling (bottom).
        const v = back ? PAPER_BACK_UV.v1 - along * (PAPER_BACK_UV.v1 - PAPER_BACK_UV.v0) : tearY + along * peel.drop;
        return axis === 0 ? [p, y, a, n, ny, 0, u, v] : [a, y, p, 0, ny, n, u, v];
    };
    for (let c = 0; c < COLUMNS; c++) {
        for (let row = 0; row < ROWS; row++) {
            walls.orientedQuad(vertex(c, row, false), vertex(c + 1, row, false), vertex(c + 1, row + 1, false), vertex(c, row + 1, false));
            decals.orientedQuad(vertex(c, row, true), vertex(c + 1, row, true), vertex(c + 1, row + 1, true), vertex(c, row + 1, true));
        }
    }
}

/**
 * The wall where the strip was, from the ceiling down past the tear (the picture has the strip's shadow
 * below the tear), using whichever picture's proportions are nearest.
 */
function addBareWall(decals, axis, side, plane, a0, a1, peel, mirror) {
    const height = peel.drop * BARE_WALL_DEPTH;
    const ratio = (a1 - a0) / height;
    let best = 0;
    for (let k = 1; k < BARE_WALL.length; k++) {
        if (Math.abs(BARE_WALL[k].aspect - ratio) < Math.abs(BARE_WALL[best].aspect - ratio)) best = k;
    }
    const uv = BARE_WALL_UV[best];
    const p = plane + side * WALL_OFFSET;
    const nx = axis === 0 ? side : 0;
    const nz = axis === 0 ? 0 : side;
    const y0 = WALL_HEIGHT - height;
    const y1 = WALL_HEIGHT;
    // Looking at the wall, u runs left to right; which end of a0..a1 is on the left depends on the side.
    const right = axis === 0 ? -side : side;
    const [left, rightEnd] = right > 0 ? [a0, a1] : [a1, a0];
    const [uLeft, uRight] = mirror ? [uv.u1, uv.u0] : [uv.u0, uv.u1];
    const at = (s, y, u, v) => (axis === 0 ? [p, y, s, nx, 0, nz, u, v] : [s, y, p, nx, 0, nz, u, v]);
    decals.orientedQuad(at(left, y0, uLeft, uv.v0), at(rightEnd, y0, uRight, uv.v0), at(rightEnd, y1, uRight, uv.v1), at(left, y1, uLeft, uv.v1));
}

/**
 * How badly the light over a cell has failed, 0 (fine) to 1 (dead or in the dark): the worst of the
 * panels nearest the cell (one if the cell is under a panel, otherwise the two or four around it).
 */
export function failingLightAt(store, x, z) {
    let worst = 0;
    for (const px of (x & 1) ? [x] : [x - 1, x + 1]) {
        for (const pz of (z & 1) ? [z] : [z - 1, z + 1]) {
            const data = store.panelData(px, pz);
            const k = store.panelOffset(px, pz);
            const brightness = data[k];
            const area = data[k + 1] / 255;
            const flicker = data[k + 2];
            const failing = brightness === 0 ? 1 : flicker !== 0 ? 0.85 : brightness < 255 ? 0.45 : 0;
            worst = Math.max(worst, failing, 1 - area);
        }
    }
    return worst;
}

