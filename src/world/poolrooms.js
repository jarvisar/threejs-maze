import { CHUNK_SIZE, HALF_CHUNK, STEP_HEIGHT } from '../config.js';
import { PANELS_PER_SIDE, borderedLayout, connectAll, darkLights, generateRooms, placeGridPillars, removeBuriedPillars, smoothstep } from './generator.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL, mod } from './grid.js';
import { HEIGHT_STEP } from './ground.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { ZONE_BATHS, ZONE_CHANNELS, ZONE_DEEP, ZONE_FLOODED, zoneAt } from './zones.js';

/*
 * Level 37, the Poolrooms. White tile everywhere, still water, pools sunk into the floor with steps, and sun
 * through skylights.
 *
 * Same cell grid as Level 0 so walking and editing work unchanged. The difference is the floor: every cell has a
 * height (see ground.js) and the water sits at y = 0 over all of it, so you can walk down into a pool or fall in.
 * This file does the layout. Geometry is in poolroomsGeometry.js, materials in poolroomsMaterials.js and
 * poolroomsShading.js.
 */

const N = CHUNK_SIZE;

/** Dry walkway, just above the water. Floor heights are in HEIGHT_STEPs. */
export const DECK = 1;
/** Ankle deep. */
export const FLOODED = -5;
/** Pool depths: waist, chest, over your head, far over it, pits. */
export const WAIST = -20;
export const CHEST = -26;
export const DEEP = -48;
export const DEEPER = -72;
export const PIT = -112;
/** Max drop for one cell of stairs. Deeper stairs continue into the next cell. */
const STAIR_DROP = 64;

/** Column collision width. They're drawn round and a bit wider (see poolroomsGeometry.js). */
export const POOLROOMS_PILLAR = 0.27;
/** Tile size: 1/20 unit (about 13 cm). */
export const TILE = 1 / 20;
/** Radius around the start that's always lit. */
const LIT_START = 10;

/** Level 37 zone weights (see zones.js). You always start in a hall of pools. */
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

/** Light slot's fourth byte in Level 37 (see ChunkData.lights). */
export const SLOT_LAMP = 255; // round ceiling light
export const SLOT_SKY = 254; // skylight with sun
export const SLOT_NONE = 253; // bare ceiling

/** Direction to the sun (see SUN in poolroomsShading.js). */
export const SUN = Object.freeze(normalize([0.62, 1, 0.4]));
/** Half width of a skylight opening. */
export const SKYLIGHT_HALF = 0.25;

/** Cell's second byte (see ChunkData.cells): stair (0, or 1 + direction down) plus these flags. */
export const CELL_AQUA = 8; // pool tiled pale aqua instead of white
export const CELL_LANE = 16; // lane line down the cell's middle, along x
export const CELL_LANE_Z = 32; // same, along z
export const CELL_DRAIN = 64; // drain grate in the floor
export const CELL_BAND = 128; // band of blue tile on the walls

/**
 * @typedef {object} PoolroomsData Extra chunk data for Level 37.
 * @property {Pool[]} pools
 * @property {Lamp[]} lamps Underwater lights.
 * @property {Floater[]} floats
 */

/**
 * @typedef {object} Pool Local cells [i0, i1) × [j0, j1).
 * @property {number} i0
 * @property {number} j0
 * @property {number} i1
 * @property {number} j1
 * @property {number} depth Floor height, in HEIGHT_STEPs.
 */

/**
 * @typedef {object} Lamp Underwater light in a pool wall, facing in.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} nx
 * @property {number} nz
 */

/**
 * @typedef {object} Floater Drifting object in a pool.
 * @property {number} x
 * @property {number} z
 * @property {number} kind 0 lifebuoy, 1 inflatable ring, 2 beach ball.
 * @property {number} variant 32 bits for color and drift.
 */

/**
 * @typedef {object} Ladder Chrome pool ladder.
 * @property {number} x Where it goes over the edge.
 * @property {number} z
 * @property {number} nx Points into the pool.
 * @property {number} nz
 * @property {number} depth Pool floor, in HEIGHT_STEPs.
 */

/**
 * World options for Level 37 (see WorldOptions in generator.js).
 * @param {number} seed
 * @returns {import('./generator.js').WorldOptions}
 */
export function poolroomsOptions(seed) {
    return { level: 2, zoneAt: (cx, cz) => poolroomsZoneAt(seed, cx, cz) };
}

/**
 * Zone of a Level 37 chunk. Clumps into regions like Level 0.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @returns {import('./zones.js').Zone}
 */
export function poolroomsZoneAt(seed, cx, cz) {
    return zoneAt(seed, cx, cz, POOLROOMS_ZONES);
}

/**
 * Generates one Level 37 chunk. Like Level 0 (see generator.js), chunks only share border walls, and game mode
 * options like a tape's walls (footage/arena.js) work the same. Pools stay a cell away from the chunk edge so the
 * floor always meets the next chunk at a walkable height.
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
    const layout = borderedLayout(seed, cx, cz, options);
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;
    const start = cx === 0 && cz === 0;

    // Empty chunks get the bare floor at y = 0 that WorldView draws.
    const floor = new Floor(empty ? 0 : baseHeight(zone));
    /** @type {PoolroomsData} */
    const data = { pools: [], lamps: [], floats: [] };
    /** @type {Ladder[]} */
    const ladders = [];
    // Keep the spawn area clear (on a tape, the room-sized space you start in too).
    const avoid = (i, j) => Math.abs(x0 + i) <= 4 && z0 + j >= -2 && z0 + j <= 3;

    if (empty) {
        // nothing inside
    } else if (zone.type === ZONE_FLOODED || zone.type === ZONE_CHANNELS) {
        generateRooms(layout, random, zone.type === ZONE_CHANNELS);
        // Only grid columns, like the halls.
        layout.pillars.fill(0);
        if (!start) roomPools(random, layout, floor, data, avoid);
    } else {
        placeColumns(layout, zoneOf, zone, cx, cz);
        if (start) startPool(layout, floor, data, x0, z0);
        if (zone.type === ZONE_DEEP) deepWater(random, layout, floor, data, avoid);
        else hallPools(random, layout, floor, data, avoid, start ? 2 : 1 + Math.floor(random() * 3));
    }
    removeBuriedPillars(layout);
    connectAll(layout, random);
    if (!empty) {
        noTraps(layout, floor, data);
        clearPoolEdges(layout, data);
        dress(random, layout, floor, data, ladders, zone, x0, z0);
    }

    const { edgesX, edgesZ, pillars } = layout.cellData();
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
        ladders,
        cells,
        poolrooms: data,
    };
}

/** Floor height outside pools: dry walkway or a few inches of water. */
function baseHeight(zone) {
    if (zone.type === ZONE_FLOODED || zone.type === ZONE_CHANNELS) return FLOODED;
    // One hall in four is flooded wall to wall.
    if (zone.type === ZONE_BATHS && (zone.variant >>> 12) % 4 === 0) return FLOODED;
    return DECK;
}

/** Chunk floor during generation (see Ground in ground.js), plus each cell's flag byte for the shaders. */
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
 * Column grid for halls and deep water. Spacing and offset come from the region so it lines up across chunks.
 * Columns on the east or north border only go in if the same hall continues past it. A few are left out.
 */
function placeColumns(layout, zoneOf, zone, cx, cz) {
    const spacing = columnSpacing(zone);
    const offset = (zone.variant >>> 8) % spacing;
    const sameHall = (ncx, ncz) => {
        const other = zoneOf(ncx, ncz);
        return other.type === zone.type && other.variant === zone.variant;
    };
    placeGridPillars(layout, cx, cz, sameHall, (x, z) => mod(x - offset, spacing) === 0 && mod(z - offset, spacing) === 0
        && hashFloat(zone.variant, 0x37c0, x + 1, z + 1) >= 0.04);
}

/** Column spacing in cells. Wider in deep water. */
export function columnSpacing(zone) {
    return zone.type === ZONE_DEEP ? 3 : 2 + (zone.variant % 2);
}

/**
 * True if cell (x, z) is in a bay that can get sun. Bays alternate like a chessboard. The others are vaulted and a
 * skylight would cut through the vault (see bayStands in poolroomsGeometry.js).
 */
function sunlitBay(zone, x, z) {
    const spacing = columnSpacing(zone);
    const offset = (zone.variant >>> 8) % spacing;
    return ((Math.floor((x - 1 - offset) / spacing) + Math.floor((z - 1 - offset) / spacing)) & 1) === 0;
}

/** Pool in front of the spawn point, with wide steps going down away from you. */
function startPool(layout, floor, data, x0, z0) {
    const i0 = -3 - x0;
    const j0 = -8 - z0 + 1;
    carvePool(layout, floor, data, i0, j0, i0 + 7, j0 + 6, CHEST, false);
    // Steps across the middle three cells of the near side.
    for (let i = i0 + 2; i < i0 + 5; i++) setStair(floor, i, j0 + 5, 3, floor.base, CHEST);
    for (let i = i0 + 2; i < i0 + 5; i++) layout.setH(i, j0 + 6, EDGE_NONE);
    // No columns on the walkway at spawn.
    for (let i = i0; i <= i0 + 7; i++) for (let j = j0 + 6; j <= j0 + 12; j++) layout.setPillar(i, j, false);
}

/** Hall pools: sunk rectangles with a walkway around and steps down. Columns stay, even in the water. */
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

/** Pools in flooded rooms, only where an area is clear of walls and columns. Steps lead down from the room. */
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
 * Deep water: the whole chunk is sunk except cell-wide walkways around the edge and across it. Each pool between
 * them gets its own steps and lamps.
 */
function deepWater(random, layout, floor, data, avoid) {
    const cuts = (length) => {
        // Pools 3 to 6 wide with a walkway between each, from 1 to N - 1.
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

/** Pool depth. Small pools are shallower since there's no room for long stairs. */
function pickDepth(random, across) {
    const roll = random();
    if (across <= 2) return roll < 0.6 ? WAIST : CHEST;
    if (roll < 0.28) return WAIST;
    if (roll < 0.5) return CHEST;
    if (roll < 0.8) return DEEP;
    if (across >= 4 && roll < 0.93) return DEEPER;
    return across >= 5 ? PIT : DEEP;
}

/** True if a pool fits on [i0, i1) × [j0, j1) with `gap` cells to any other pool, and clear of spawn. */
function roomFor(floor, i0, j0, i1, j1, avoid, gap = 1) {
    for (let i = i0 - gap; i < i1 + gap; i++) {
        for (let j = j0 - gap; j < j1 + gap; j++) {
            if (floor.isPool(i, j)) return false;
            if (i >= i0 && i < i1 && j >= j0 && j < j1 && avoid(i, j)) return false;
        }
    }
    return true;
}

/** True if no wall or column is inside [i0, i1) × [j0, j1). The boundary doesn't count. */
function clearInside(layout, i0, j0, i1, j1) {
    for (let i = i0 + 1; i < i1; i++) for (let j = j0; j < j1; j++) if (layout.getV(i, j) !== EDGE_NONE) return false;
    for (let j = j0 + 1; j < j1; j++) for (let i = i0; i < i1; i++) if (layout.getH(i, j) !== EDGE_NONE) return false;
    for (let i = i0 + 1; i < i1; i++) for (let j = j0 + 1; j < j1; j++) if (layout.getPillar(i, j)) return false;
    return true;
}

/** Sinks [i0, i1) × [j0, j1) into a pool and clears walls inside. Columns stay. */
function carvePool(layout, floor, data, i0, j0, i1, j1, depth, aqua) {
    const index = data.pools.length;
    data.pools.push({ i0, j0, i1, j1, depth });
    for (let i = i0 + 1; i < i1; i++) layout.vRun(i, j0, j1, EDGE_NONE);
    for (let j = j0 + 1; j < j1; j++) layout.hRun(j, i0, i1, EDGE_NONE);
    // Lane lines along the long axis of swimmable pools, in every other cell across.
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
    // main drain in the middle
    floor.flags[((i0 + i1) >> 1) * N + ((j0 + j1) >> 1)] |= CELL_DRAIN;
}

/**
 * Steps into a pool from one or two sides, 1 to 3 cells wide. They come down from walkway, never another pool,
 * and any wall at the top gets opened. Deeper than STAIR_DROP, the stairs continue into the next cell in.
 */
function stairsInto(random, layout, floor, i0, j0, i1, j1, depth, flights) {
    const rows = Math.ceil((floor.base - depth) / STAIR_DROP);
    // Shuffle with the chunk's own random stream so it's the same in every browser.
    const sides = [0, 1, 2, 3];
    for (let k = 3; k > 0; k--) {
        const swap = Math.floor(random() * (k + 1));
        [sides[k], sides[swap]] = [sides[swap], sides[k]];
    }
    let placed = 0;
    for (const side of sides) {
        if (placed >= flights) break;
        // DIRECTIONS[side] is the direction down. (1, 0) means coming in from the pool's low-x side.
        const [di, dj] = DIRECTIONS[side];
        const alongX = di === 0;
        const length = alongX ? i1 - i0 : j1 - j0;
        const inward = alongX ? j1 - j0 : i1 - i0;
        if (inward < rows + 1) continue;
        const width = Math.min(length, 1 + Math.floor(random() * 3));
        const from = (alongX ? i0 : j0) + Math.floor(random() * (length - width + 1));
        // cell `row` in from the side, `s` along it
        const cell = (s, row) => (alongX ? [s, dj > 0 ? j0 + row : j1 - 1 - row] : [di > 0 ? i0 + row : i1 - 1 - row, s]);
        // Skip if it would overlap stairs from another side at a corner.
        let clear = true;
        for (let s = from; s < from + width; s++) {
            for (let row = 0; row < rows; row++) {
                const [i, j] = cell(s, row);
                clear &&= floor.stairs[i * N + j] === 0;
            }
        }
        for (let s = from; s < from + width && clear; s++) {
            let top = floor.base;
            for (let row = 0; row < rows; row++) {
                const low = row === rows - 1 ? depth : Math.round(floor.base - ((floor.base - depth) * (row + 1)) / rows);
                const [i, j] = cell(s, row);
                setStair(floor, i, j, side, top, low);
                top = low;
            }
            // open the wall at the top
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
 * Makes sure you can always climb out. Every cell needs a path to the chunk edge (always walkway) using stairs or
 * steps no higher than STEP_HEIGHT. Pools you can't get out of are filled back in.
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
    // Pool indices are stale now, but nothing after this uses them.
}

/**
 * A wall that hits a pool edge with no wall along the edge would hang over the water down to the pool floor, so
 * it gets cut a cell short. Runs once pools are final and only removes walls.
 */
function clearPoolEdges(layout, data) {
    for (const { i0, j0, i1, j1 } of data.pools) {
        // For each corner on the pool's boundary, check the four edges meeting there. The last value is true for
        // edges belonging to the pool (along it, or across it and carved away).
        for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
                if (i !== i0 && i !== i1 && j !== j0 && j !== j1) continue;
                const edges = [
                    [true, i, j - 1, j - 1 >= j0 && j - 1 < j1],
                    [true, i, j, j >= j0 && j < j1],
                    [false, i - 1, j, i - 1 >= i0 && i - 1 < i1],
                    [false, i, j, i >= i0 && i < i1],
                ];
                const type = ([vertical, a, b]) => (vertical ? layout.getV(a, b) : layout.getH(a, b));
                if (edges.some((edge) => edge[3] && type(edge) !== EDGE_NONE)) continue;
                for (const [vertical, a, b, pool] of edges) {
                    if (pool) continue;
                    if (vertical) layout.setV(a, b, EDGE_NONE);
                    else layout.setH(a, b, EDGE_NONE);
                }
            }
        }
    }
}

/** Marks cells that can reach the chunk edge (see noTraps). */
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
    // Flood backwards: a neighbor can get out if it can step into a cell that can.
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
            // from (ni, nj) into (i, j), direction (−di, −dj)
            if (!canStep(floor, ni, nj, i, j, (d ^ 1))) continue;
            out[ni * N + nj] = 1;
            queue.push(ni * N + nj);
        }
    }
    return out;
}

/** True if you can walk from cell a into neighbor b (DIRECTIONS[d]), using floor heights at the shared edge. */
function canStep(floor, ai, aj, bi, bj, d) {
    const leave = edgeHeight(floor, ai, aj, d);
    const enter = edgeHeight(floor, bi, bj, d ^ 1);
    return enter <= leave + STEP_HEIGHT / HEIGHT_STEP;
}

/**
 * Floor height of cell (i, j) at side DIRECTIONS[d]. A stair's sides count as its top, so you can step off the
 * side after climbing but can't step on from the side any lower.
 */
function edgeHeight(floor, i, j, d) {
    const k = i * N + j;
    const stair = floor.stairs[k];
    if (stair === 0 || d === stair - 1) return floor.heights[k];
    return floor.tops[k];
}

/** Min distance from a floater to a column center. Column radius + biggest float + max drift (poolroomsShading.js). */
const FLOAT_CLEARANCE = 0.16 + 0.15 + 0.22 * Math.SQRT2;

/**
 * Pool details: underwater lamps (always in deep water since it has no other light), ladders, floaters, drains in
 * flooded floors, and a blue tile band on some rooms' walls.
 */
function dress(random, layout, floor, data, ladders, zone, x0, z0) {
    const deep = zone.type === ZONE_DEEP;
    for (const pool of data.pools) {
        const { i0, j0, i1, j1, depth } = pool;
        const lit = deep || depth <= CHEST ? random() < (deep ? 1 : 0.55) : false;
        // Each side: its non-stair edge cells and the outward direction.
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
                    // Skip walled sides, the lamp would end up inside the wall.
                    if (layout.between(i, j, dx, dz) === EDGE_WALL) continue;
                    // On the pool wall, half a cell out from the cell center, just under the surface.
                    data.lamps.push({ x: x0 + i + dx * 0.5, y: Math.max(depth * HEIGHT_STEP * 0.5, -0.22), z: z0 + j + dz * 0.5, nx: -dx, nz: -dz });
                }
            }
        }
        if (depth <= WAIST && random() < 0.6) {
            // Ladder on a non-stair cell whose outside edge is open floor.
            for (let attempt = 0; attempt < 6; attempt++) {
                const side = Math.floor(random() * 4);
                const [dx, dz] = DIRECTIONS[side];
                const alongX = dx === 0;
                const s = (alongX ? i0 : j0) + 1 + Math.floor(random() * Math.max(1, (alongX ? i1 - i0 : j1 - j0) - 2));
                const i = alongX ? s : dx > 0 ? i1 - 1 : i0;
                const j = alongX ? (dz > 0 ? j1 - 1 : j0) : s;
                if (i < i0 || i >= i1 || j < j0 || j >= j1 || floor.stairs[i * N + j] !== 0) continue;
                if (layout.between(i, j, dx, dz) !== EDGE_NONE || floor.isPool(i + dx, j + dz)) continue;
                const ladder = { x: x0 + i + dx * 0.5, z: z0 + j + dz * 0.5, nx: -dx, nz: -dz, depth };
                ladders.push(ladder);
                // Drop any lamp at the same spot.
                const lamp = data.lamps.findIndex((other) => other.x === ladder.x && other.z === ladder.z);
                if (lamp >= 0) data.lamps.splice(lamp, 1);
                break;
            }
        }
        if (random() < (deep ? 0.15 : 0.3)) {
            const w = i1 - i0;
            const h = j1 - j0;
            const floater = {
                x: x0 + i0 + random() * (w - 1),
                z: z0 + j0 + random() * (h - 1),
                kind: random() < 0.55 ? 0 : random() < 0.6 ? 1 : 2,
                variant: (random() * 4294967296) >>> 0,
            };
            // If it's too close to a column, snap it to the cell center, the farthest point from the columns.
            const i = Math.round(floater.x - x0);
            const j = Math.round(floater.z - z0);
            for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
                // corner (ci, cj) is the far corner of cell (ci − 1, cj − 1)
                if (!layout.getPillar(ci, cj) || Math.hypot(x0 + ci - 0.5 - floater.x, z0 + cj - 0.5 - floater.z) >= FLOAT_CLEARANCE) continue;
                floater.x = x0 + i;
                floater.z = z0 + j;
            }
            data.floats.push(floater);
        }
    }
    // Drains in flooded floors, and a blue tile band in some rooms.
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

/** Darkness around a point, 0 to 1. Mostly bright with some unlit stretches. The start is always lit. */
export function poolroomsDarkness(seed, x, z) {
    const n = 0.62 * valueNoise(seed ^ 0x37da, x / 28, z / 28) + 0.38 * valueNoise(seed ^ 0x37db, x / 10, z / 10);
    let darkness = smoothstep(0.56, 0.72, n);
    const distance = Math.hypot(x, z);
    if (distance < LIT_START + 12) darkness *= smoothstep(LIT_START, LIT_START + 12, distance);
    return darkness;
}

/** Noise that clumps skylights into sunny stretches. */
function sunnyAt(seed, x, z) {
    return valueNoise(seed ^ 0x3750, x / 14, z / 14);
}

/**
 * Level 37 lights. Halls only have skylights, in alternating bays (see sunlitBay). Rooms and corridors have round
 * ceiling lights, some broken, and a few skylights. Deep water has almost nothing besides the pool lamps. Empty
 * chunks (outside a tape's walls) get none.
 */
function poolroomsLights(seed, x0, z0, zone, layout, floor, empty) {
    if (empty) return darkLights(SLOT_NONE);
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
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
            // Mostly sun through skylights. Hall vaults get no other lights, rooms get a few ceiling lights.
            if (type === ZONE_BATHS) {
                if (sunny > 0.42 && darkness < 0.5 && sunlitBay(zone, x, z) && sunCanReach(layout, floor, i, j)) slot = SLOT_SKY;
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
            // Ambient light level. The halls are the brightest place in the Backrooms.
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
 * True if sun through a skylight over cell (i, j) lands clear of walls. The patch shifts toward +x and +z, more
 * on lower floors, so the edges it crosses must be open.
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
 * Per-cell shader bytes (see ChunkData.cells and PanelLightMap): floor height, stair and tile flags, and
 * underwater lamp glow. The fourth byte (walls) is filled in when it's sent.
 */
function cellBytes(floor, data, x0, z0) {
    const cells = new Uint8Array(N * N * 4);
    const glow = new Float32Array(N * N);
    for (const lamp of data.lamps) {
        // lamps are in world coords, cells are chunk-local
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
