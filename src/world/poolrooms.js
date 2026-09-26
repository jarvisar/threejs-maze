import { CHUNK_SIZE, HALF_CHUNK, STEP_HEIGHT } from '../config.js';
import { Layout, PANELS_PER_SIDE, borderLine, connectAll, generateRooms, removeBuriedPillars, smoothstep } from './generator.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from './grid.js';
import { HEIGHT_STEP } from './ground.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { ZONE_BATHS, ZONE_CHANNELS, ZONE_DEEP, ZONE_FLOODED, zoneAt } from './zones.js';

/*
 * Level 37, "Sublimity": the Poolrooms. White tile on every surface, warm still water over all of it, pools sunk
 * into the floor with steps going down into them, and light coming in through skylights at an angle. Nobody here.
 *
 * It's the same grid of cells as Level 0 (walls on the lines between cells, a light slot over every cell with odd
 * coordinates), so walking, editing and everything else work on it unchanged. What's new is the floor: every cell
 * has a height (see ground.js), the water lies at y = 0 over all of it, and you can walk down the steps into a pool, or
 * fall in, until it's over your head. This works out the layout; poolroomsGeometry.js builds it, and the materials
 * (poolroomsMaterials.js, poolroomsShading.js) do the tile, the water, the sun and the air. levels.js ties it in.
 */

const N = CHUNK_SIZE;

/** A dry walkway, just clear of the water. */
export const DECK = 1;
/** Ankle deep. */
export const FLOODED = -5;
/** Pools: waist deep, chest deep, over your head, far over it, and the pits. */
export const WAIST = -20;
export const CHEST = -26;
export const DEEP = -48;
export const DEEPER = -72;
export const PIT = -112;
/** The most one cell of stairs goes down. Deeper than that, the stairs carry on into the next cell. */
const STAIR_DROP = 64;

/** The water, over the whole level. */
export const WATER_LEVEL = 0;

/** How wide Level 37's columns are to walk into (they're drawn round, a little wider: see poolroomsGeometry.js). */
export const POOLROOMS_PILLAR = 0.27;
/** The tiles on everything: 1/20 of a unit (about 13 cm) square. */
export const TILE = 1 / 20;
/** How near the start everything's lit. */
const LIT_START = 10;

/** What Level 37's regions are made of (see zones.js). Where you start is always a hall of pools. */
export const POOLROOMS_ZONES = Object.freeze({
    weights: [
        [ZONE_BATHS, 44],
        [ZONE_FLOODED, 28],
        [ZONE_CHANNELS, 13],
        [ZONE_DEEP, 15],
    ],
    start: ZONE_BATHS,
    salt: 0x3700,
});

/** A light slot's fourth byte in Level 37 (see ChunkData.lights): what's in it. */
export const SLOT_LAMP = 255; // a round light set into the ceiling
export const SLOT_SKY = 254; // a skylight, with the sun coming through it
export const SLOT_NONE = 253; // bare ceiling

/** The sun, coming in through the skylights: which way it is from anywhere (see SUN in poolroomsShading.js). */
export const SUN = Object.freeze(normalize([0.62, 1, 0.4]));
/** Half the width of a skylight's opening. */
export const SKYLIGHT_HALF = 0.25;

/** A cell's second byte (see ChunkData.cells): its stair (0, or 1 + the way down), and these. */
export const CELL_AQUA = 8; // a pool tiled in pale aqua rather than white
export const CELL_LANE = 16; // a lane line down the middle of the cell, along x
export const CELL_LANE_Z = 32; // ... along z
export const CELL_DRAIN = 64; // a drain grate in the middle of the floor
export const CELL_BAND = 128; // the walls round it have a band of blue tile

/**
 * @typedef {object} PoolroomsData What a Level 37 chunk has that Level 0's don't.
 * @property {Pool[]} pools
 * @property {Lamp[]} lamps The lights under the water.
 * @property {Floater[]} floats What's floating in the pools.
 * @property {Ladder[]} ladders
 */

/**
 * @typedef {object} Pool One sunk into the floor: local cells [i0, i1) × [j0, j1).
 * @property {number} i0
 * @property {number} j0
 * @property {number} i1
 * @property {number} j1
 * @property {number} depth Its floor, in HEIGHT_STEPs.
 */

/**
 * @typedef {object} Lamp A light set into a pool's wall under the water, facing into it.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} nx
 * @property {number} nz
 */

/**
 * @typedef {object} Floater Something left floating in a pool, drifting.
 * @property {number} x
 * @property {number} z
 * @property {number} kind 0: a lifebuoy, 1: an inflatable ring, 2: a beach ball.
 * @property {number} variant 32 bits for its colour and how it drifts.
 */

/**
 * @typedef {object} Ladder Chrome rails over a pool's edge, down into the water.
 * @property {number} x Where they go over the edge.
 * @property {number} z
 * @property {number} nx Into the pool.
 * @property {number} nz
 * @property {number} depth The pool's floor, in HEIGHT_STEPs.
 */

/**
 * How the endless level is generated for Level 37 (see generator.js's WorldOptions).
 * @param {number} seed
 * @returns {import('./generator.js').WorldOptions}
 */
export function poolroomsOptions(seed) {
    return { level: 2, zoneAt: (cx, cz) => poolroomsZoneAt(seed, cx, cz) };
}

/**
 * The kind of space a chunk of Level 37 is. Like Level 0, it clumps into regions round scattered sites.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @returns {import('./zones.js').Zone}
 */
export function poolroomsZoneAt(seed, cx, cz) {
    return zoneAt(seed, cx, cz, POOLROOMS_ZONES);
}

/**
 * Generates one chunk of Level 37. Like Level 0 (see generator.js), chunks are independent and share only the wall
 * lines on their borders, and a game mode's options (a tape's walls, see footage/arena.js) work the same. Every
 * pool keeps a cell clear of the chunk's edge, so the floor always meets the next chunk's at a height you can walk.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {import('./generator.js').WorldOptions} options
 * @returns {import('./generator.js').ChunkData}
 */
export function generatePoolroomsChunk(seed, cx, cz, options) {
    const zoneOf = (x, z) => options.zoneAt?.(x, z) ?? poolroomsZoneAt(seed, x, z);
    const zone = zoneOf(cx, cz);
    const random = mulberry32(hashInts(seed, 0x3710, cx, cz));
    const layout = new Layout();
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;
    const start = cx === 0 && cz === 0;

    const west = borderLine(seed, 0, cx, cz, options);
    const east = borderLine(seed, 0, cx + 1, cz, options);
    const south = borderLine(seed, 1, cx, cz, options);
    const north = borderLine(seed, 1, cx, cz + 1, options);
    for (let k = 0; k < N; k++) {
        layout.setV(0, k, west[k]);
        layout.setV(N, k, east[k]);
        layout.setH(k, 0, south[k]);
        layout.setH(k, N, north[k]);
    }

    const floor = new Floor(baseHeight(zone));
    /** @type {PoolroomsData} */
    const data = { pools: [], lamps: [], floats: [], ladders: [] };
    // Nothing where you start (on a tape, nothing in the room-sized space you start in either).
    const avoid = (i, j) => Math.abs(x0 + i) <= 4 && z0 + j >= -2 && z0 + j <= 3;

    if (empty) {
        // Nothing inside at all.
    } else if (zone.type === ZONE_FLOODED || zone.type === ZONE_CHANNELS) {
        generateRooms(layout, random, zone.type === ZONE_CHANNELS);
        // Columns only on the one grid, like the halls'.
        layout.pillars.fill(0);
        if (!start) roomPools(random, layout, floor, data, avoid);
    } else {
        placeColumns(layout, zoneOf, zone, cx, cz, x0, z0);
        if (start) startPool(layout, floor, data, x0, z0);
        if (zone.type === ZONE_DEEP) deepWater(random, layout, floor, data, avoid);
        else hallPools(random, layout, floor, data, avoid, start ? 2 : 1 + Math.floor(random() * 3));
    }
    removeBuriedPillars(layout);
    connectAll(layout, random);
    if (!empty) {
        noTraps(layout, floor, data);
        dress(random, layout, floor, data, zone, x0, z0);
    }

    const edgesX = new Uint8Array(N * N);
    const edgesZ = new Uint8Array(N * N);
    const pillars = new Uint8Array(N * N);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            edgesX[i * N + j] = layout.getV(i + 1, j);
            edgesZ[i * N + j] = layout.getH(i, j + 1);
            pillars[i * N + j] = layout.getPillar(i + 1, j + 1);
        }
    }

    const lights = poolroomsLights(seed, x0, z0, zone, layout, floor, empty);
    const cells = cellBytes(floor, data, x0, z0);
    return {
        cx,
        cz,
        zone,
        edgesX,
        edgesZ,
        pillars,
        lights,
        props: [],
        leaks: [],
        solids: [],
        ground: { heights: floor.heights, stairs: floor.stairs, tops: floor.tops },
        cells,
        poolrooms: data,
    };
}

/** The floor of the zone, where there's no pool: dry walkways, or a few inches of water. */
function baseHeight(zone) {
    if (zone.type === ZONE_FLOODED || zone.type === ZONE_CHANNELS) return FLOODED;
    // One hall in four is flooded from wall to wall.
    if (zone.type === ZONE_BATHS && (zone.variant >>> 12) % 4 === 0) return FLOODED;
    return DECK;
}

/** A chunk's floor while it's being generated (see Ground in ground.js). Also each cell's extra byte for the shaders. */
class Floor {
    constructor(base) {
        this.base = base;
        this.heights = new Int8Array(N * N).fill(base);
        this.stairs = new Uint8Array(N * N);
        this.tops = new Int8Array(N * N);
        this.flags = new Uint8Array(N * N);
        this.pool = new Int16Array(N * N).fill(-1);
    }

    height(i, j) {
        return this.heights[i * N + j];
    }

    isPool(i, j) {
        return i >= 0 && j >= 0 && i < N && j < N && this.pool[i * N + j] >= 0;
    }
}

// ---------------------------------------------------------------------------------------------- layout

/**
 * The column grid of a hall (and of the deep water): its spacing and where it starts come from the region, so it
 * lines up across chunk borders. A corner on the chunk's east or north border only gets one if the same hall
 * carries on across it. Now and then one's missing.
 */
function placeColumns(layout, zoneOf, zone, cx, cz, x0, z0) {
    const spacing = columnSpacing(zone);
    const offset = (zone.variant >>> 8) % spacing;
    const sameHall = (ncx, ncz) => {
        const other = zoneOf(ncx, ncz);
        return other.type === zone.type && other.variant === zone.variant;
    };
    const lastI = sameHall(cx + 1, cz) ? N : N - 1;
    const lastJ = sameHall(cx, cz + 1) ? N : N - 1;
    const cornerOk = lastI === N && lastJ === N && sameHall(cx + 1, cz + 1);
    for (let i = 1; i <= lastI; i++) {
        for (let j = 1; j <= lastJ; j++) {
            if (i === N && j === N && !cornerOk) continue;
            if (mod(x0 + i - 1 - offset, spacing) !== 0 || mod(z0 + j - 1 - offset, spacing) !== 0) continue;
            if (hashFloat(zone.variant, 0x37c0, x0 + i, z0 + j) < 0.04) continue;
            layout.setPillar(i, j, true);
        }
    }
}

/** How far apart a hall's columns stand, in cells: the deep water's are further. */
export function columnSpacing(zone) {
    return zone.type === ZONE_DEEP ? 3 : 2 + (zone.variant % 2);
}

/**
 * The first pool, where every world starts: from the walkway you stand on, broad steps go down into it ahead of
 * you, under the skylights.
 */
function startPool(layout, floor, data, x0, z0) {
    const i0 = -3 - x0;
    const j0 = -8 - z0 + 1;
    carvePool(layout, floor, data, i0, j0, i0 + 7, j0 + 6, CHEST, false);
    // The steps: the whole width of the middle, on the near side, going away from you.
    for (let i = i0 + 2; i < i0 + 5; i++) setStair(floor, i, j0 + 5, 3, DECK, CHEST);
    for (let i = i0 + 2; i < i0 + 5; i++) layout.setH(i, j0 + 6, EDGE_NONE);
    // Nothing standing on the walkway where you start.
    for (let i = i0; i <= i0 + 7; i++) for (let j = j0 + 6; j <= j0 + 12; j++) layout.setPillar(i, j, false);
}

/**
 * The pools of a hall: rectangles sunk into the floor, a walkway round each, and steps down into it. The columns
 * stand where they stand, in the water too.
 */
function hallPools(random, layout, floor, data, avoid, count) {
    for (let attempt = 0; attempt < 40 && count > 0; attempt++) {
        const w = 3 + Math.floor(random() * 5);
        const h = 3 + Math.floor(random() * 5);
        const i0 = 1 + Math.floor(random() * (N - 2 - w + 1));
        const j0 = 1 + Math.floor(random() * (N - 2 - h + 1));
        if (!roomFor(floor, i0, j0, i0 + w, j0 + h, avoid)) continue;
        const depth = pickDepth(random, Math.min(w, h));
        carvePool(layout, floor, data, i0, j0, i0 + w, j0 + h, depth, random() < 0.45);
        stairsInto(random, layout, floor, i0, j0, i0 + w, j0 + h, depth, 1 + (random() < 0.35 ? 1 : 0));
        count--;
    }
}

/**
 * Pools in the flooded rooms: where a room (or part of one) is clear of walls and columns, now and then its floor
 * goes down into a pool, with steps down from a doorway or from the rest of the room.
 */
function roomPools(random, layout, floor, data, avoid) {
    let count = random() < 0.75 ? 1 + Math.floor(random() * 2) : 0;
    for (let attempt = 0; attempt < 60 && count > 0; attempt++) {
        const w = 2 + Math.floor(random() * 4);
        const h = 2 + Math.floor(random() * 4);
        const i0 = 1 + Math.floor(random() * (N - 2 - w + 1));
        const j0 = 1 + Math.floor(random() * (N - 2 - h + 1));
        if (!roomFor(floor, i0, j0, i0 + w, j0 + h, avoid) || !clearInside(layout, i0, j0, i0 + w, j0 + h)) continue;
        const depth = pickDepth(random, Math.min(w, h));
        carvePool(layout, floor, data, i0, j0, i0 + w, j0 + h, depth, random() < 0.3);
        stairsInto(random, layout, floor, i0, j0, i0 + w, j0 + h, depth, 1);
        count--;
    }
}

/**
 * The deep water: the whole chunk sunk out of sight but for walkways, a cell wide, round its edge and across it.
 * Every stretch of water between them has its steps, and its lamps.
 */
function deepWater(random, layout, floor, data, avoid) {
    const cuts = (length) => {
        // Pool widths of 3 to 6 with a walkway between each, from 1 to N - 1.
        const found = [1];
        let at = 1;
        while (N - 1 - at > 6) {
            at += 3 + Math.floor(random() * Math.min(4, N - 1 - at - 3 - 3));
            found.push(at, at + 1);
            at += 1;
        }
        found.push(N - 1);
        return found;
    };
    const xs = cuts(N);
    const zs = cuts(N);
    for (let a = 0; a < xs.length; a += 2) {
        for (let b = 0; b < zs.length; b += 2) {
            const [i0, i1, j0, j1] = [xs[a], xs[a + 1], zs[b], zs[b + 1]];
            if (i1 - i0 < 2 || j1 - j0 < 2 || !roomFor(floor, i0, j0, i1, j1, avoid, 0)) continue;
            const depth = random() < 0.3 ? PIT : random() < 0.6 ? DEEPER : DEEP;
            carvePool(layout, floor, data, i0, j0, i1, j1, depth, random() < 0.5);
            stairsInto(random, layout, floor, i0, j0, i1, j1, depth, 1);
        }
    }
}

/** How deep a pool is: the smaller ones are shallower (and there's no room in them for long stairs). */
function pickDepth(random, across) {
    const roll = random();
    if (across <= 2) return roll < 0.6 ? WAIST : CHEST;
    if (roll < 0.28) return WAIST;
    if (roll < 0.5) return CHEST;
    if (roll < 0.8) return DEEP;
    if (across >= 4 && roll < 0.93) return DEEPER;
    return across >= 5 ? PIT : DEEP;
}

/** Whether a pool fits on [i0, i1) × [j0, j1): a cell of floor between it and any other, and clear of the start. */
function roomFor(floor, i0, j0, i1, j1, avoid, gap = 1) {
    for (let i = i0 - gap; i < i1 + gap; i++) {
        for (let j = j0 - gap; j < j1 + gap; j++) {
            if (floor.isPool(i, j)) return false;
            if (i >= i0 && i < i1 && j >= j0 && j < j1 && avoid(i, j)) return false;
        }
    }
    return true;
}

/** Whether no wall and no column stands inside [i0, i1) × [j0, j1) (on its edges is fine). */
function clearInside(layout, i0, j0, i1, j1) {
    for (let i = i0 + 1; i < i1; i++) for (let j = j0; j < j1; j++) if (layout.getV(i, j) !== EDGE_NONE) return false;
    for (let j = j0 + 1; j < j1; j++) for (let i = i0; i < i1; i++) if (layout.getH(i, j) !== EDGE_NONE) return false;
    for (let i = i0 + 1; i < i1; i++) for (let j = j0 + 1; j < j1; j++) if (layout.getPillar(i, j)) return false;
    return true;
}

/** Sinks [i0, i1) × [j0, j1) into a pool: no walls inside it (the columns stay, standing in the water). */
function carvePool(layout, floor, data, i0, j0, i1, j1, depth, aqua) {
    const index = data.pools.length;
    data.pools.push({ i0, j0, i1, j1, depth });
    for (let i = i0 + 1; i < i1; i++) layout.vRun(i, j0, j1, EDGE_NONE);
    for (let j = j0 + 1; j < j1; j++) layout.hRun(j, i0, i1, EDGE_NONE);
    // Lane lines down the long way of a pool big enough to swim in, in every other cell across.
    const lanes = depth <= CHEST && Math.max(i1 - i0, j1 - j0) >= 5 && Math.min(i1 - i0, j1 - j0) >= 3;
    const alongX = i1 - i0 >= j1 - j0;
    for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
            const k = i * N + j;
            floor.heights[k] = depth;
            floor.pool[k] = index;
            if (aqua) floor.flags[k] |= CELL_AQUA;
            const across = alongX ? j - j0 : i - i0;
            const along = alongX ? i - i0 : j - j0;
            const length = alongX ? i1 - i0 : j1 - j0;
            if (lanes && across % 2 === 1 && along > 0 && along < length - 1) floor.flags[k] |= alongX ? CELL_LANE : CELL_LANE_Z;
        }
    }
    // The main drain, in the middle of the floor.
    floor.flags[((i0 + i1) >> 1) * N + ((j0 + j1) >> 1)] |= CELL_DRAIN;
}

/**
 * Steps down into a pool, from one of its sides (or two), across one to three cells of it. The floor they come down
 * from has to be walkway, not another pool, and the way onto them is opened up if it was walled. Deeper than one
 * cell of stairs can go, they carry on into the next.
 */
function stairsInto(random, layout, floor, i0, j0, i1, j1, depth, flights) {
    const rows = Math.ceil((floor.base - depth) / STAIR_DROP);
    // (Shuffled with the chunk's own random stream, the same in every browser.)
    const sides = [0, 1, 2, 3];
    for (let k = 3; k > 0; k--) {
        const swap = Math.floor(random() * (k + 1));
        [sides[k], sides[swap]] = [sides[swap], sides[k]];
    }
    let placed = 0;
    for (const side of sides) {
        if (placed >= flights) break;
        // DIRECTIONS[side] is the way down: (1, 0) means coming in from the pool's low-x side.
        const [di, dj] = DIRECTIONS[side];
        const alongX = di === 0;
        const length = alongX ? i1 - i0 : j1 - j0;
        const inward = alongX ? j1 - j0 : i1 - i0;
        if (inward < rows + 1) continue;
        const width = Math.min(length, 1 + Math.floor(random() * 3));
        const from = (alongX ? i0 : j0) + Math.floor(random() * (length - width + 1));
        for (let s = from; s < from + width; s++) {
            let top = floor.base;
            for (let row = 0; row < rows; row++) {
                const low = row === rows - 1 ? depth : Math.round(floor.base - ((floor.base - depth) * (row + 1)) / rows);
                // The cell `row` in from the side.
                const i = alongX ? s : di > 0 ? i0 + row : i1 - 1 - row;
                const j = alongX ? (dj > 0 ? j0 + row : j1 - 1 - row) : s;
                setStair(floor, i, j, side, top, low);
                top = low;
            }
            // Open the way onto them from above.
            if (alongX) layout.setH(s, dj > 0 ? j0 : j1, EDGE_NONE);
            else layout.setV(di > 0 ? i0 : i1, s, EDGE_NONE);
        }
        placed++;
    }
}

function setStair(floor, i, j, side, top, low) {
    const k = i * N + j;
    floor.stairs[k] = side + 1;
    floor.tops[k] = top;
    floor.heights[k] = low;
}

/**
 * Makes sure you can always climb out: from every cell there has to be a way, over steps no higher than STEP_UP or
 * up stairs, to the chunk's edge (which is always walkway, like the next chunk's). A pool you couldn't get out of is
 * filled in again.
 */
function noTraps(layout, floor, data) {
    for (let pass = 0; pass < 8; pass++) {
        const out = canReachEdge(layout, floor);
        let changed = false;
        for (let index = 0; index < data.pools.length; index++) {
            const pool = data.pools[index];
            if (!pool) continue;
            let trapped = false;
            for (let i = pool.i0; i < pool.i1 && !trapped; i++) for (let j = pool.j0; j < pool.j1 && !trapped; j++) trapped = !out[i * N + j];
            if (!trapped) continue;
            for (let i = pool.i0; i < pool.i1; i++) {
                for (let j = pool.j0; j < pool.j1; j++) {
                    const k = i * N + j;
                    floor.heights[k] = floor.base;
                    floor.stairs[k] = 0;
                    floor.tops[k] = 0;
                    floor.pool[k] = -1;
                    floor.flags[k] = 0;
                }
            }
            data.pools[index] = null;
            changed = true;
        }
        if (!changed) break;
    }
    data.pools = data.pools.filter((pool) => pool);
    // (Their indices have moved; nothing after this needs them.)
}

/** Which cells there's a way out of, to the chunk's edge (see noTraps). */
function canReachEdge(layout, floor) {
    const out = new Uint8Array(N * N);
    const queue = [];
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
                out[i * N + j] = 1;
                queue.push(i * N + j);
            }
        }
    }
    // Backwards: a neighbour can get out if it can step into a cell that can.
    while (queue.length > 0) {
        const k = queue.pop();
        const i = Math.floor(k / N);
        const j = k % N;
        for (let d = 0; d < 4; d++) {
            const [di, dj] = DIRECTIONS[d];
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= N || nj >= N || out[ni * N + nj]) continue;
            if (layout.between(i, j, di, dj) === EDGE_WALL) continue;
            // From (ni, nj) into (i, j), which is the way (−di, −dj).
            if (!canStep(floor, ni, nj, i, j, (d ^ 1))) continue;
            out[ni * N + nj] = 1;
            queue.push(ni * N + nj);
        }
    }
    return out;
}

/**
 * Whether you can walk from cell a into its neighbour b, the way DIRECTIONS[d]: you leave a at the height of its
 * floor where you leave it (the top or bottom of a stair, or anywhere on it for its sides), and come into b at the
 * height of b's floor where you come in.
 */
function canStep(floor, ai, aj, bi, bj, d) {
    const leave = edgeHeight(floor, ai, aj, d);
    const enter = edgeHeight(floor, bi, bj, d ^ 1);
    return enter <= leave + STEP_HEIGHT / HEIGHT_STEP;
}

/**
 * The height of cell (i, j)'s floor at its side DIRECTIONS[d]. A stair's sides count as its top: you can climb it
 * and step off the side, but not step onto it from the side any lower than that.
 */
function edgeHeight(floor, i, j, d) {
    const k = i * N + j;
    const stair = floor.stairs[k];
    if (stair === 0 || d === stair - 1) return floor.heights[k];
    return floor.tops[k];
}

/**
 * Everything else in the water: lamps in the pools' walls (always in the deep water, where there's no other light),
 * a ladder over the edge, the odd thing floating, drains in the flooded floors, and the band of blue tile round the
 * walls of some rooms.
 */
function dress(random, layout, floor, data, zone, x0, z0) {
    const deep = zone.type === ZONE_DEEP;
    for (const pool of data.pools) {
        const { i0, j0, i1, j1, depth } = pool;
        const lit = deep || depth <= CHEST ? random() < (deep ? 1 : 0.55) : false;
        // Each side: its cells, the way out of the pool across it, and where its wall is.
        for (let side = 0; side < 4; side++) {
            const [dx, dz] = DIRECTIONS[side];
            const alongX = dx === 0;
            const length = alongX ? i1 - i0 : j1 - j0;
            const cells = [];
            for (let s = 0; s < length; s++) {
                const i = alongX ? i0 + s : dx > 0 ? i1 - 1 : i0;
                const j = alongX ? (dz > 0 ? j1 - 1 : j0) : j0 + s;
                if (floor.stairs[i * N + j] === 0) cells.push([i, j]);
            }
            if (lit) {
                for (let n = 1; n < cells.length; n += 2) {
                    const [i, j] = cells[n];
                    // On the pool's wall, half a cell out from the cell's middle, a little under the surface.
                    data.lamps.push({ x: x0 + i + dx * 0.5, y: Math.max(depth * HEIGHT_STEP * 0.5, -0.22), z: z0 + j + dz * 0.5, nx: -dx, nz: -dz });
                }
            }
        }
        if (depth <= WAIST && random() < 0.6) {
            // A ladder on a side without steps: at a cell whose edge out of the pool is open floor.
            for (let attempt = 0; attempt < 6; attempt++) {
                const side = Math.floor(random() * 4);
                const [dx, dz] = DIRECTIONS[side];
                const alongX = dx === 0;
                const s = (alongX ? i0 : j0) + 1 + Math.floor(random() * Math.max(1, (alongX ? i1 - i0 : j1 - j0) - 2));
                const i = alongX ? s : dx > 0 ? i1 - 1 : i0;
                const j = alongX ? (dz > 0 ? j1 - 1 : j0) : s;
                if (i < i0 || i >= i1 || j < j0 || j >= j1 || floor.stairs[i * N + j] !== 0) continue;
                if (layout.between(i, j, dx, dz) !== EDGE_NONE || floor.isPool(i + dx, j + dz)) continue;
                data.ladders.push({ x: x0 + i + dx * 0.5, z: z0 + j + dz * 0.5, nx: -dx, nz: -dz, depth });
                break;
            }
        }
        if (random() < (deep ? 0.15 : 0.3)) {
            const w = i1 - i0;
            const h = j1 - j0;
            data.floats.push({
                x: x0 + i0 + random() * (w - 1),
                z: z0 + j0 + random() * (h - 1),
                kind: random() < 0.55 ? 0 : random() < 0.6 ? 1 : 2,
                variant: (random() * 4294967296) >>> 0,
            });
        }
    }
    // Drains in the flooded floors, and in some rooms a band of blue tile round the walls.
    const band = zone.type === ZONE_BATHS ? (zone.variant >>> 16) % 3 === 0 : random() < 0.35;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const k = i * N + j;
            if (band) floor.flags[k] |= CELL_BAND;
            if (floor.heights[k] === FLOODED && floor.stairs[k] === 0 && random() < 0.02) floor.flags[k] |= CELL_DRAIN;
        }
    }
}

// ---------------------------------------------------------------------------------------------- lights

/**
 * How dark Level 37 is round a point, 0 to 1: most of it is bright, but whole stretches have no light of their own,
 * and the start is always lit.
 */
export function poolroomsDarkness(seed, x, z) {
    const n = 0.62 * valueNoise(seed ^ 0x37da, x / 28, z / 28) + 0.38 * valueNoise(seed ^ 0x37db, x / 10, z / 10);
    let darkness = smoothstep(0.56, 0.72, n);
    const distance = Math.hypot(x, z);
    if (distance < LIT_START + 12) darkness *= smoothstep(LIT_START, LIT_START + 12, distance);
    return darkness;
}

/** Where the sun comes in: the halls are full of skylights, clumped into sunny stretches. */
function sunnyAt(seed, x, z) {
    return valueNoise(seed ^ 0x3750, x / 14, z / 14);
}

/**
 * Level 37's lights. The halls have skylights over most of their slots and round lights set into the ceiling over
 * the rest; the rooms and corridors have the round lights, fewer of them working; the deep water has hardly any
 * light at all but the lamps in the pools. An empty chunk (outside a tape's walls) has none.
 */
function poolroomsLights(seed, x0, z0, zone, layout, floor, empty) {
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    if (empty) {
        for (let k = 3; k < lights.length; k += 4) lights[k] = SLOT_NONE;
        return lights;
    }
    const type = zone.type;
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const i = pi * 2 + 1;
            const j = pj * 2 + 1;
            const x = x0 + i;
            const z = z0 + j;
            const k = (pi * PANELS_PER_SIDE + pj) * 4;
            const nearStart = Math.abs(x) < 9 && z > -10 && z < 6;
            let darkness = poolroomsDarkness(seed, x, z);
            if (type === ZONE_DEEP) darkness = Math.max(darkness, 0.85);
            const sunny = nearStart ? 1 : sunnyAt(seed, x, z);
            let slot = SLOT_LAMP;
            // Most of the light is the sun's, through the skylights; the halls' vaults have no other lights, the rooms a
            // few set in the ceiling, and the rest is shadow.
            if (type === ZONE_BATHS) {
                if (sunny > 0.42 && darkness < 0.5 && sunCanReach(layout, floor, i, j)) slot = SLOT_SKY;
                else slot = SLOT_NONE;
            } else if (type === ZONE_DEEP) {
                slot = SLOT_NONE;
            } else if (sunny > 0.58 && darkness < 0.3 && sunCanReach(layout, floor, i, j) && hashFloat(seed, 0x37a2, x, z) < 0.55) {
                slot = SLOT_SKY;
            } else {
                slot = hashFloat(seed, 0x37a6, x, z) < 0.45 ? SLOT_LAMP : SLOT_NONE;
            }
            let brightness = slot === SLOT_NONE ? 0 : 255;
            let flicker = 0;
            if (slot === SLOT_LAMP && !nearStart) {
                if (hashFloat(seed, 0x37a3, x, z) < 0.08 + 0.92 * darkness) brightness = 0;
                else if (hashFloat(seed, 0x37a4, x, z) < 0.02 + 0.6 * darkness * (1 - darkness)) flicker = 1 + (hashInts(seed, 0x37a5, x, z) % 255);
            }
            // The light around here: the halls are the brightest place in the Backrooms.
            const bright = type === ZONE_BATHS ? 0.85 : type === ZONE_DEEP ? 0.55 : 0.85;
            lights[k] = brightness;
            lights[k + 1] = Math.round(255 * bright * (1 - 0.85 * darkness));
            lights[k + 2] = flicker;
            lights[k + 3] = slot;
        }
    }
    return lights;
}

/**
 * Whether the sun through a skylight over cell (i, j) lands clear of walls: its patch leans off towards +x and +z,
 * further the lower the floor, so the edges it falls across have to be open.
 */
function sunCanReach(layout, floor, i, j) {
    if (i >= N - 1 || j >= N - 1) return layout.getV(Math.min(i + 1, N), j) === EDGE_NONE && layout.getH(i, Math.min(j + 1, N)) === EDGE_NONE;
    const reach = floor.height(i, j) < -20 || floor.height(i + 1, j + 1) < -20 ? 3 : 2;
    for (let a = 0; a <= reach; a++) {
        for (let b = 0; b <= reach; b++) {
            const ii = i + a;
            const jj = j + b;
            if (ii >= N || jj >= N) continue;
            if (a < reach && ii + 1 <= N && layout.getV(ii + 1, jj) !== EDGE_NONE) return false;
            if (b < reach && jj + 1 <= N && layout.getH(ii, jj + 1) !== EDGE_NONE) return false;
        }
    }
    return true;
}

/**
 * Each cell's bytes for the shaders (see ChunkData.cells and PanelLightMap): its floor, its stair and how it's
 * tiled, and how much light the lamps in the water put into it. (The fourth byte, what walls it has, is filled in
 * as it's sent.)
 */
function cellBytes(floor, data, x0, z0) {
    const cells = new Uint8Array(N * N * 4);
    const glow = new Float32Array(N * N);
    for (const lamp of data.lamps) {
        // (Lamps are where they are in the world; the cells here are the chunk's.)
        const lx = lamp.x - x0;
        const lz = lamp.z - z0;
        for (let i = Math.max(0, Math.floor(lx - 3)); i <= Math.min(N - 1, Math.ceil(lx + 3)); i++) {
            for (let j = Math.max(0, Math.floor(lz - 3)); j <= Math.min(N - 1, Math.ceil(lz + 3)); j++) {
                const d = Math.hypot(i - lx, j - lz);
                glow[i * N + j] += Math.max(0, 1 - d / 3.2) ** 2 * 0.8;
            }
        }
    }
    for (let k = 0; k < N * N; k++) {
        cells[k * 4] = floor.heights[k] + 128;
        cells[k * 4 + 1] = floor.stairs[k] | floor.flags[k];
        cells[k * 4 + 2] = Math.round(255 * Math.min(glow[k], 1));
    }
    return cells;
}

function normalize([x, y, z]) {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
}

function mod(a, b) {
    return ((a % b) + b) % b;
}
