import { CHUNK_SIZE, HALF_CHUNK, WALL_THICKNESS } from '../config.js';
import { Layout, PANELS_PER_SIDE, connectAll, darkLights, placeGridPillars, punchOpenings, removeBuriedPillars, smoothstep } from './generator.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord, mod } from './grid.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { furnish } from './terrorHotelFurniture.js';
import { placeTerrorHotelProps } from './terrorHotelProps.js';
import { ZONE_BALLROOM, ZONE_GUEST, ZONE_LOBBY, ZONE_STAFF, zoneAt } from './zones.js';

/*
 * Level 5, the Terror Hotel. Endless 1920s hotel: corridors of numbered doors, guest rooms, marble lobbies, the
 * Beverly Room ballroom and staff passages.
 *
 * Same cell grid as Level 0 so walking, editing and tapes work unchanged. Like Level 2, corridors run on odd lines
 * that are fixed for the whole level so they can run straight across many chunks. Each stretch of a line is decided
 * on its own so both chunks it crosses agree. Everything else is up to the chunk.
 *
 * This file does the layout, locked doors and lights. Furniture and loose props are in terrorHotelFurniture.js and
 * terrorHotelProps.js, mouldings in terrorHotelGeometry.js, materials in terrorHotelMaterials.js and
 * terrorHotelShading.js.
 */

const N = CHUNK_SIZE;

/** Zone weights for Level 5 (see zones.js). The start is always a guest floor. */
export const TERROR_HOTEL_ZONES = Object.freeze({
    weights: [
        [ZONE_GUEST, 47],
        [ZONE_LOBBY, 21],
        [ZONE_BALLROOM, 13],
        [ZONE_STAFF, 19],
    ],
    start: ZONE_GUEST,
    salt: 0x5500,
});

/** True for zones that fill the whole chunk as one room (lobby, ballroom). */
export function isHall(type) {
    return type === ZONE_LOBBY || type === ZONE_BALLROOM;
}

// ---------------------------------------------------------------------------------------------- the corridors

/** Corridor families: along x (line z = const) and along z (line x = const). */
export const FAMILY_X = 0;
export const FAMILY_Z = 1;
/** Rough spacing between lines of a family (4 to 8), leaving rooms two or three deep between. */
const LINE_SPACING = 6;
/** The corridor leading on from the start promenade always reaches at least z = -48 (130 m). */
const START_CORRIDOR_TO = -48;

/** Cell kind bits (see TerrorHotelData.kinds). */
export const CELL_X_CORRIDOR = 1; // corridor along x
export const CELL_Z_CORRIDOR = 2; // corridor along z
export const CELL_GALLERY = 4; // start promenade
export const CELL_ROOM = 8; // guest room or closet
export const CELL_HALL = 16; // lobby or lounge
export const CELL_BALLROOM = 32; // the Beverly Room
export const CELL_STAFF = 64; // maintenance passage
export const CELL_TAKEN = 128; // has furniture
export const CELL_CORRIDOR = CELL_X_CORRIDOR | CELL_Z_CORRIDOR | CELL_GALLERY;

/** Start promenade, three cells wide from just behind the spawn to the chunk edge. */
export const GALLERY = Object.freeze({ x0: 0, x1: 2, z0: -8, z1: 1 });

/**
 * Position of the k-th line of a family (z for x corridors, x for z corridors). Always odd so every corridor gets a
 * light slot over every other cell. Line 0 along z is the corridor leading on from the promenade.
 * @param {number} seed
 * @param {number} family
 * @param {number} k
 */
export function corridorLine(seed, family, k) {
    if (family === FAMILY_Z && k === 0) return 1;
    return LINE_SPACING * k + 1 + 2 * (hashInts(seed, 0x5d10, family, k) % 2);
}

/** Index k of the last line at or before c, so corridorLine(k) ≤ c < corridorLine(k + 1). */
export function lineBefore(seed, family, c) {
    const k = Math.floor((c - 1) / LINE_SPACING);
    return corridorLine(seed, family, k) > c ? k - 1 : k;
}

/** Index of the line at c, or null if there isn't one. */
export function lineAt(seed, family, c) {
    if ((c & 1) === 0) return null;
    const k = lineBefore(seed, family, c);
    return corridorLine(seed, family, k) === c ? k : null;
}

/**
 * Whether stretch n of line k exists (between the n-th and (n + 1)-th crossing lines). Main corridors are nearly
 * always there, the rest come and go. Fewer in lobbies, none in the ballroom, more in staff zones. Only the stretch's
 * own coordinates decide it so both chunks it crosses agree.
 * @param {number} seed
 * @param {number} family
 * @param {number} k
 * @param {number} n
 * @param {(cx: number, cz: number) => import('./zones.js').Zone} zoneOf
 */
export function stretchPresent(seed, family, k, n, zoneOf) {
    const from = corridorLine(seed, 1 - family, n);
    const to = corridorLine(seed, 1 - family, n + 1);
    // corridor leading on from the promenade
    if (family === FAMILY_Z && k === 0 && to > START_CORRIDOR_TO && from < 3) return true;
    const at = corridorLine(seed, family, k);
    const middle = (from + to) >> 1;
    const zone = family === FAMILY_X ? zoneOf(chunkCoord(middle), chunkCoord(at)) : zoneOf(chunkCoord(at), chunkCoord(middle));
    if (zone.type === ZONE_BALLROOM) return false;
    let chance = hashFloat(seed, 0x5d11, family, k) < 0.45 ? 0.94 : 0.6;
    if (zone.type === ZONE_LOBBY) chance *= 0.4;
    else if (zone.type === ZONE_STAFF) chance = Math.min(1, chance + 0.15);
    return hashFloat(seed, 0x5d12, family, k, n) < chance;
}

/** Whether the edge between cells c and c + 1 on line k is open corridor. */
function corridorEdge(seed, family, k, c, zoneOf) {
    return stretchPresent(seed, family, k, lineBefore(seed, 1 - family, c), zoneOf);
}

/**
 * Corridor bits (CELL_X_CORRIDOR, CELL_Z_CORRIDOR, CELL_GALLERY) for any cell, from the lines alone. Matches
 * carveCorridors so a chunk can see past its border. 0 in halls and outside a tape's walls.
 * @param {number} seed
 * @param {number} x
 * @param {number} z
 * @param {(cx: number, cz: number) => import('./zones.js').Zone} zoneOf
 * @param {import('./generator.js').WorldOptions} [options]
 */
export function corridorKind(seed, x, z, zoneOf, options = {}) {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    if (options.isVoid?.(cx, cz) || isHall(zoneOf(cx, cz).type)) return 0;
    let kind = 0;
    const kx = lineAt(seed, FAMILY_X, z);
    if (kx !== null && (corridorEdge(seed, FAMILY_X, kx, x - 1, zoneOf) || corridorEdge(seed, FAMILY_X, kx, x, zoneOf))) kind |= CELL_X_CORRIDOR;
    const kz = lineAt(seed, FAMILY_Z, x);
    if (kz !== null && (corridorEdge(seed, FAMILY_Z, kz, z - 1, zoneOf) || corridorEdge(seed, FAMILY_Z, kz, z, zoneOf))) kind |= CELL_Z_CORRIDOR;
    if (cx === 0 && cz === 0 && inGallery(x, z)) kind |= CELL_Z_CORRIDOR | CELL_GALLERY;
    return kind;
}

/** Whether a cell is in the start promenade. */
export function inGallery(x, z) {
    return x >= GALLERY.x0 && x <= GALLERY.x1 && z >= GALLERY.z0 && z <= GALLERY.z1;
}

/**
 * Level 5's version of borderLine in generator.js. Open where corridors cross and never fully closed. No wall
 * between two chunks of the same hall, wide openings between two different halls.
 */
function hotelBorder(seed, axis, cx, cz, options, zoneOf) {
    const line = new Uint8Array(N);
    if (options.isSealed?.(axis, cx, cz)) return line.fill(EDGE_WALL);
    const beforeX = axis === 0 ? cx - 1 : cx;
    const beforeZ = axis === 0 ? cz : cz - 1;
    if (options.isVoid?.(beforeX, beforeZ) && options.isVoid?.(cx, cz)) return line;
    const before = zoneOf(beforeX, beforeZ);
    const after = zoneOf(cx, cz);
    // same hall continues (corners can still get a column, see placeGridPillars)
    if (isHall(before.type) && before.type === after.type && before.variant === after.variant) return line;
    line.fill(EDGE_WALL);
    const random = mulberry32(hashInts(seed, 0x5db0, axis, cx, cz));
    // axis 0 borders run along z and are crossed by x corridors
    const family = axis === 0 ? FAMILY_X : FAMILY_Z;
    const across = (axis === 0 ? cx : cz) * N - HALF_CHUNK;
    const start = (axis === 0 ? cz : cx) * N - HALF_CHUNK;
    let open = 0;
    let first = -1;
    for (let k = 0; k < N; k++) {
        const index = lineAt(seed, family, start + k);
        if (index === null) continue;
        if (first < 0) first = k;
        if (corridorEdge(seed, family, index, across - 1, zoneOf)) {
            line[k] = EDGE_NONE;
            open++;
        }
    }
    if (isHall(before.type) && isHall(after.type)) {
        // hall to hall: wide openings and doors, only where the corridors haven't opened it already
        const set = (k, type) => {
            if (line[k] === EDGE_WALL) line[k] = type;
        };
        punchOpenings(N, set, random, 2 + Math.floor(random() * 3), 'edge');
        open++;
    }
    // always at least one way through
    if (open === 0) line[first >= 0 ? first : N >> 1] = EDGE_DOOR;
    return line;
}

// ---------------------------------------------------------------------------------------------- the doors

/** Locked door types (see HotelDoor). */
export const DOOR_GUEST = 0; // paneled walnut, brass number plate
export const DOOR_STAFF = 1; // plain painted, STAFF ONLY in a few languages
export const DOOR_BALLROOM = 2; // Beverly Room, tall, cream and gold
export const DOOR_ELEVATOR = 3; // brass lift doors with a floor dial above
/** Door states. */
export const DOOR_SHUT = 0;
export const DOOR_AJAR = 1; // open a crack toward you, black behind
export const DOOR_LIT = 2; // shut, light under it, sometimes something moving across it
export const DOOR_SIGN = 3; // shut, sign on the handle

/**
 * @typedef {object} HotelDoor A locked door on the +x (axis 0) or +z (axis 1) edge of cell (x, z). Drawn on both
 *     faces (see terrorHotelGeometry.js).
 * @property {number} x
 * @property {number} z
 * @property {0 | 1} axis
 * @property {number} front Side facing the corridor or hall, 1 (+x or +z) or -1. Number and state show on that side.
 * @property {number} kind DOOR_*.
 * @property {number} state DOOR_SHUT, DOOR_AJAR, DOOR_LIT or DOOR_SIGN.
 * @property {number} number Room number, deliberately out of order (0 for none).
 * @property {number} variant 32 bits for its details.
 */

// ---------------------------------------------------------------------------------------------- the lights

/** Level 5 light color, in a light slot's fourth byte (see ChunkData.lights). */
export const LAMP_WARM = 255; // ordinary warm bulb
export const LAMP_CANDLE = 254; // candle bulbs, deeper and redder
export const LAMP_ALABASTER = 253; // through alabaster, softer and paler
export const LAMP_CRYSTAL = 252; // crystal chandelier, golden
export const LAMP_BARE = 251; // bare bulb in staff passages, yellower

/** Fixture in a light slot (see TerrorHotelData.fixtures). */
export const FIXTURE_NONE = 0;
export const FIXTURE_BOWL = 1; // alabaster bowl flush to the ceiling on a rose
export const FIXTURE_LANTERN = 2; // pendant lantern, iron and amber glass
export const FIXTURE_CHANDELIER = 3; // wrought-iron ring of candle bulbs on chains
export const FIXTURE_CRYSTAL = 4; // big tiered crystal chandelier
export const FIXTURE_BULB = 5; // bulb in a plain shade on a cord

/** Sconce bits for the -x, +x, -z and +z walls (top four bits of the cell's first byte, see cellBytes). */
export const SCONCE_NEG_X = 16;
export const SCONCE_POS_X = 32;
export const SCONCE_NEG_Z = 64;
export const SCONCE_POS_Z = 128;
/** Same bits by wall direction, as [di, dj, bit]. */
export const SCONCE_WALLS = Object.freeze([[-1, 0, SCONCE_NEG_X], [1, 0, SCONCE_POS_X], [0, -1, SCONCE_NEG_Z], [0, 1, SCONCE_POS_Z]]);
/** Sconce bulb height and light range. */
export const SCONCE_Y = 0.6;
export const SCONCE_RANGE = 1.15;
/** Sconce light origin in front of the wall, since the bulbs stand off it on an arm. */
export const SCONCE_OUT = 0.07;

/**
 * The light slot a sconce switches with: the nearest one in the direction it faces. It's always on a slot's line
 * along its wall. The shaders find it the same way.
 * @returns {[number, number]} The slot's cell.
 */
export function sconceSlot(x, z, di, dj) {
    if (di !== 0) return [x & 1 ? x : x - di, z];
    return [x, z & 1 ? z : z - dj];
}

/**
 * Lamp shade height. Every table or floor lamp uses it, and so do candles on tables and the band's desks.
 */
export const LAMP_Y = 0.34;
/** Lamp light range. */
export const LAMP_RANGE = 1.5;
/** Max distance from a cell's middle for a lamp to still light part of it. LAMP_CLEAR is the gap kept from the chunk edge. */
const LAMP_REACH = LAMP_RANGE + 0.5;
const LAMP_CLEAR = LAMP_REACH - 0.5;

/**
 * @typedef {object} Lamp Shade position of a lamp left on (table, nightstand or floor). The shaders work out its light
 *     from the cells around it (see cellBytes).
 * @property {number} x Snapped to 1/8 unit.
 * @property {number} z
 */

// ---------------------------------------------------------------------------------------------- cells

/** Cell's first byte (see ChunkData.cells): look, corridor direction and sconces. */
export const LOOK_CORRIDOR = 0;
export const LOOK_ROOM = 1;
export const LOOK_LOBBY = 2;
export const LOOK_BALLROOM = 3;
export const LOOK_STAFF = 4;
export const CELL_ALONG_X = 8; // corridor runs along x (carpet runner follows it)
/** Top two bits of the second byte are a guest room's palette, of the third byte the floor pattern (FLOOR_*). */
export const PALETTE_SHIFT = 6;
export const FLOOR_SHIFT = 6;
export const FLOOR_PLAIN = 0;
export const FLOOR_PARQUET = 1; // ballroom dance floor
export const FLOOR_MARBLE = 2; // lobby marble

/**
 * @typedef {object} TerrorHotelData Level 5 chunk data on top of Level 0's.
 * @property {Uint8Array} kinds CELL_* bits, indexed `i * N + j`.
 * @property {Int16Array} rooms Room index per cell (guest room or hall), or -1.
 * @property {Uint8Array} fixtures FIXTURE_* per light slot, indexed like the lights.
 * @property {Uint8Array} sconces SCONCE_* bits, indexed like the kinds.
 * @property {HotelDoor[]} doors Locked doors in walls the chunk's cells own.
 * @property {import('./terrorHotelFurniture.js').Furniture[]} furniture Solid parts also go in the chunk's `solids`.
 * @property {Lamp[]} lamps
 * @property {number[]} beams Lobby ceiling beams as [x0, z0, x1, z1] runs along a line of corners
 *     (see terrorHotelGeometry.js).
 */

// ---------------------------------------------------------------------------------------------- generating

/**
 * Level 5 world options (see WorldOptions in generator.js).
 * @param {number} seed
 * @returns {import('./generator.js').WorldOptions}
 */
export function terrorHotelOptions(seed) {
    return { level: 4, zoneAt: (cx, cz) => terrorHotelZoneAt(seed, cx, cz) };
}

/** Zone of a Level 5 chunk. */
export function terrorHotelZoneAt(seed, cx, cz) {
    return zoneAt(seed, cx, cz, TERROR_HOTEL_ZONES);
}

/**
 * Generates one Level 5 chunk. As in Level 0 (generator.js), chunks only share their border wall lines, and game mode
 * options like a tape's walls (footage/arena.js) work the same.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {import('./generator.js').WorldOptions} options
 * @returns {import('./generator.js').ChunkData}
 */
export function generateTerrorHotelChunk(seed, cx, cz, options) {
    const zoneOf = (x, z) => options.zoneAt?.(x, z) ?? terrorHotelZoneAt(seed, x, z);
    const zone = zoneOf(cx, cz);
    const random = mulberry32(hashInts(seed, 0x5d30, cx, cz));
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;

    const layout = new Layout();
    const west = hotelBorder(seed, 0, cx, cz, options, zoneOf);
    const east = hotelBorder(seed, 0, cx + 1, cz, options, zoneOf);
    const south = hotelBorder(seed, 1, cx, cz, options, zoneOf);
    const north = hotelBorder(seed, 1, cx, cz + 1, options, zoneOf);
    for (let k = 0; k < N; k++) {
        layout.setV(0, k, west[k]);
        layout.setV(N, k, east[k]);
        layout.setH(k, 0, south[k]);
        layout.setH(k, N, north[k]);
    }

    const kinds = new Uint8Array(N * N);
    const rooms = new Int16Array(N * N).fill(-1);
    if (!empty) {
        if (isHall(zone.type)) {
            hall(layout, kinds, rooms, random, seed, zone, zoneOf, cx, cz);
        } else {
            // inner edges along a corridor are open, the rest around a corridor get walled
            const open = new Uint8Array(2 * N * N);
            carveCorridors(open, kinds, seed, x0, z0, zoneOf);
            if (cx === 0 && cz === 0) carveGallery(open, kinds, x0, z0);
            fillBetween(layout, open, kinds, rooms, random, x0, z0, zone.type);
        }
    }
    removeBuriedPillars(layout);
    connectAll(layout, random);

    const sconces = new Uint8Array(N * N);
    /** @type {HotelDoor[]} */
    const doors = [];
    /** @type {import('./terrorHotelFurniture.js').Furniture[]} */
    const furniture = [];
    /** @type {Lamp[]} */
    const lamps = [];
    /** @type {number[][]} */
    const solids = [];
    /** @type {number[]} */
    const beams = [];
    // floor pattern overrides per cell (ballroom dance floors)
    const floors = new Uint8Array(N * N);
    // keep the spawn clear (promenade aisles, and the room-sized space around the start on a tape)
    const avoid = (x, z) => x >= -3 && x <= 3 && z >= -3 && z <= 2;
    let lit = new Set();
    // Every door in this chunk's walls, including ones earlier chunks own on shared borders, so wall items can avoid
    // them.
    /** @type {HotelDoor[]} */
    let everyDoor = [];
    if (!empty) {
        /** @type {HotelDoor[]} */
        const theirs = [];
        findDoors(layout, kinds, doors, theirs, seed, x0, z0, zone.type, zoneOf, options);
        everyDoor = [...doors, ...theirs];
        placeSconces(layout, kinds, sconces, everyDoor, seed, x0, z0, zone.type);
        lit = furnish({ layout, kinds, rooms, sconces, doors: everyDoor, furniture, lamps, solids, random, seed, x0, z0, zone: zone.type, avoid, lampClear: LAMP_CLEAR, floors });
        if (zone.type === ZONE_LOBBY) findBeams(layout, kinds, beams, x0, z0, zone);
    }
    const props = empty ? [] : placeTerrorHotelProps(random, layout, kinds, sconces, everyDoor, furniture, x0, z0, zone.type, avoid);
    for (let i = 0; i < props.length; i++) props[i].index = i;

    const { edgesX, edgesZ, pillars } = layout.cellData();
    const fixtures = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE);
    const lights = hotelLights(seed, x0, z0, zone.type, kinds, sconces, lit, fixtures, empty);
    const cells = cellBytes(kinds, rooms, sconces, lamps, floors, seed, x0, z0, zone, empty);
    return {
        cx,
        cz,
        zone,
        edgesX,
        edgesZ,
        pillars,
        lights,
        props,
        leaks: [],
        solids,
        cells,
        terrorHotel: { kinds, rooms, fixtures, sconces, doors, furniture, lamps, beams },
    };
}

/**
 * Marks every present corridor stretch in the chunk. `open` gets the edges along them: local cell (i, j)'s +x edge at
 * 2 (i N + j) and its +z edge at the next index.
 */
function carveCorridors(open, kinds, seed, x0, z0, zoneOf) {
    for (const family of [FAMILY_X, FAMILY_Z]) {
        // across the chunk (j for x corridors) and along it
        const acrossFrom = family === FAMILY_X ? z0 : x0;
        const alongFrom = family === FAMILY_X ? x0 : z0;
        for (let a = 0; a < N; a++) {
            const k = lineAt(seed, family, acrossFrom + a);
            if (k === null) continue;
            // only look up stretchPresent once per stretch
            let stretch = null;
            let present = false;
            for (let b = -1; b < N; b++) {
                const n = lineBefore(seed, 1 - family, alongFrom + b);
                if (n !== stretch) {
                    stretch = n;
                    present = stretchPresent(seed, family, k, n, zoneOf);
                }
                if (!present) continue;
                for (const s of [b, b + 1]) {
                    if (s < 0 || s >= N) continue;
                    kinds[family === FAMILY_X ? s * N + a : a * N + s] |= family === FAMILY_X ? CELL_X_CORRIDOR : CELL_Z_CORRIDOR;
                }
                if (b < 0 || b + 1 >= N) continue;
                if (family === FAMILY_X) open[(b * N + a) * 2] = 1;
                else open[(a * N + b) * 2 + 1] = 1;
            }
        }
    }
}

/**
 * The start promenade (see GALLERY). Three cells wide up to the chunk edge, then it narrows into the long corridor on
 * x = 1. Local cell (8, 8) is world (0, 0). You start in its left aisle facing -z.
 */
function carveGallery(open, kinds, x0, z0) {
    for (let x = GALLERY.x0; x <= GALLERY.x1; x++) {
        for (let z = GALLERY.z0; z <= GALLERY.z1; z++) {
            const i = x - x0;
            const j = z - z0;
            const cell = i * N + j;
            kinds[cell] |= CELL_Z_CORRIDOR | CELL_GALLERY;
            if (x < GALLERY.x1) open[cell * 2] = 1;
            // back wall always shut, the lifts you arrived in are there
            open[cell * 2 + 1] = z < GALLERY.z1 ? 1 : 0;
        }
    }
}

/**
 * Fills the space between corridors with guest rooms, or maintenance passages on a staff floor. Each piece gets a way
 * into a neighboring corridor.
 */
function fillBetween(layout, open, kinds, rooms, random, x0, z0, zone) {
    // Wall corridors off from non-corridor cells, and from parallel corridors they only run alongside.
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const corridor = kinds[cell] & CELL_CORRIDOR;
            if (i + 1 < N && !open[cell * 2] && (corridor || kinds[cell + N] & CELL_CORRIDOR)) layout.setV(i + 1, j, EDGE_WALL);
            if (j + 1 < N && !open[cell * 2 + 1] && (corridor || kinds[cell + 1] & CELL_CORRIDOR)) layout.setH(i, j + 1, EDGE_WALL);
        }
    }
    // then flood fill the pieces in between
    const piece = new Int32Array(N * N).fill(-1);
    let count = 0;
    const counter = { rooms: 0 };
    for (let start = 0; start < N * N; start++) {
        if (kinds[start] & CELL_CORRIDOR || piece[start] >= 0) continue;
        const cells = [start];
        piece[start] = count;
        for (let q = 0; q < cells.length; q++) {
            const i = Math.floor(cells[q] / N);
            const j = cells[q] % N;
            for (const [di, dj] of DIRECTIONS) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
                const next = ni * N + nj;
                if (piece[next] >= 0 || kinds[next] & CELL_CORRIDOR) continue;
                piece[next] = count;
                cells.push(next);
            }
        }
        const id = count++;
        if (zone === ZONE_STAFF && cells.length >= 4) staffPassages(layout, kinds, random, cells);
        else guestRooms(layout, kinds, rooms, random, cells, piece, id, counter, x0, z0, zone === ZONE_STAFF);
    }
}

/**
 * Whether a room-to-corridor edge is a door spot. Doors go in the corridor's side wall at cells without a light
 * overhead, so doors and lights alternate along it.
 */
function doorPlace(kind, x, z, di, dj) {
    const along = kind & CELL_CORRIDOR;
    if (along === CELL_X_CORRIDOR) return dj !== 0 && (x & 1) === 0;
    if (along === CELL_Z_CORRIDOR || along === (CELL_Z_CORRIDOR | CELL_GALLERY)) return di !== 0 && (z & 1) === 0;
    return false;
}

/**
 * Splits a piece into guest rooms (store rooms and closets on a staff floor), 1 to 3 cells across. Rooms connect
 * through a spanning tree of doors with the odd loop. Only one or two open to the corridor, on a door spot when
 * possible. So most corridor doors are locked, and the one that opens leads through a chain of rooms.
 */
function guestRooms(layout, kinds, rooms, random, cells, piece, id, counter, x0, z0, staff) {
    const member = (i, j) => i >= 0 && j >= 0 && i < N && j < N && piece[i * N + j] === id;
    let i0 = N;
    let j0 = N;
    let i1 = 0;
    let j1 = 0;
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        i0 = Math.min(i0, i);
        j0 = Math.min(j0, j);
        i1 = Math.max(i1, i + 1);
        j1 = Math.max(j1, j + 1);
    }
    const maxRoom = 2 + Math.floor(random() * 2);
    const flag = staff ? CELL_STAFF : CELL_ROOM;
    const first = counter.rooms;
    const leaf = (a0, b0, a1, b1) => {
        const room = counter.rooms++;
        for (let i = a0; i < a1; i++) {
            for (let j = b0; j < b1; j++) {
                if (!member(i, j)) continue;
                kinds[i * N + j] |= flag;
                rooms[i * N + j] = room;
            }
        }
    };
    const split = (a0, b0, a1, b1) => {
        const w = a1 - a0;
        const h = b1 - b0;
        const canX = w >= 3;
        const canZ = h >= 3;
        if ((!canX && !canZ) || (w <= maxRoom && h <= maxRoom && random() < 0.8)) {
            leaf(a0, b0, a1, b1);
            return;
        }
        const alongX = canX && (!canZ || random() < w / (w + h));
        if (alongX) {
            const cut = a0 + 1 + Math.floor(random() * (w - 1));
            for (let j = b0; j < b1; j++) if (member(cut - 1, j) && member(cut, j)) layout.setV(cut, j, EDGE_WALL);
            split(a0, b0, cut, b1);
            split(cut, b0, a1, b1);
        } else {
            const cut = b0 + 1 + Math.floor(random() * (h - 1));
            for (let i = a0; i < a1; i++) if (member(i, cut - 1) && member(i, cut)) layout.setH(i, cut, EDGE_WALL);
            split(a0, b0, a1, cut);
            split(a0, cut, a1, b1);
        }
    };
    split(i0, j0, i1, j1);

    // Sort each room's walls: onto another room, onto a corridor door spot, or elsewhere on a corridor.
    const count = counter.rooms - first;
    const between = Array.from({ length: count }, () => []);
    const placed = [];
    const other = [];
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        const room = rooms[cell] - first;
        for (const [di, dj] of DIRECTIONS) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
            const next = kinds[ni * N + nj];
            if (next & CELL_CORRIDOR) {
                // not into a corridor crossing
                if ((next & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) === (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) continue;
                (doorPlace(next, x0 + ni, z0 + nj, di, dj) ? placed : other).push([i, j, di, dj]);
            } else if (member(ni, nj) && rooms[ni * N + nj] - first !== room && layout.between(i, j, di, dj) === EDGE_WALL) {
                between[room].push([i, j, di, dj, rooms[ni * N + nj] - first]);
            }
        }
    }
    // Connecting doors: grow out from a random room into rooms not reached yet.
    const reached = new Uint8Array(count);
    const frontier = [Math.floor(random() * count)];
    reached[frontier[0]] = 1;
    while (frontier.length > 0) {
        const room = frontier.splice(Math.floor(random() * frontier.length), 1)[0];
        for (const k of shuffledIndices(between[room].length, random)) {
            const [i, j, di, dj, next] = between[room][k];
            if (reached[next]) {
                if (random() < 0.04) layout.setBetween(i, j, di, dj, EDGE_DOOR);
                continue;
            }
            // one door per pair of rooms, the rest of the wall stays
            reached[next] = 1;
            layout.setBetween(i, j, di, dj, EDGE_DOOR);
            frontier.push(next);
        }
    }
    // Entrances from the corridor: one, or two for a big piece. Door spots first.
    const ways = placed.length > 0 ? placed : other;
    const wanted = Math.min(ways.length, cells.length > 14 ? 2 : 1);
    for (let n = 0; n < wanted; n++) {
        const [i, j, di, dj] = ways.splice(Math.floor(random() * ways.length), 1)[0];
        layout.setBetween(i, j, di, dj, EDGE_DOOR);
    }
}

/** 0 to count − 1 shuffled with the chunk's own random stream. */
function shuffledIndices(count, random) {
    const order = Array.from({ length: count }, (_, k) => k);
    for (let k = count - 1; k > 0; k--) {
        const r = Math.floor(random() * (k + 1));
        [order[k], order[r]] = [order[r], order[k]];
    }
    return order;
}

/**
 * Maintenance passages on a staff floor. A one-cell-wide maze (spanning tree plus a few loops) with a few openings
 * into the surrounding corridors.
 */
function staffPassages(layout, kinds, random, cells) {
    const inside = new Uint8Array(N * N);
    for (const cell of cells) inside[cell] = 1;
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        kinds[cell] |= CELL_STAFF;
        if (i + 1 < N && inside[cell + N]) layout.setV(i + 1, j, EDGE_WALL);
        if (j + 1 < N && inside[cell + 1]) layout.setH(i, j + 1, EDGE_WALL);
    }
    const visited = new Uint8Array(N * N);
    const start = cells[Math.floor(random() * cells.length)];
    const stack = [start];
    visited[start] = 1;
    let last = -1;
    const options = [];
    while (stack.length > 0) {
        const cell = stack[stack.length - 1];
        const i = Math.floor(cell / N);
        const j = cell % N;
        options.length = 0;
        for (let d = 0; d < 4; d++) {
            const ni = i + DIRECTIONS[d][0];
            const nj = j + DIRECTIONS[d][1];
            if (ni >= 0 && nj >= 0 && ni < N && nj < N && inside[ni * N + nj] && !visited[ni * N + nj]) options.push(d);
        }
        if (options.length === 0) {
            stack.pop();
            last = -1;
            continue;
        }
        // favor going straight so we get long runs
        const d = options.includes(last) && random() < 0.55 ? last : options[Math.floor(random() * options.length)];
        const [di, dj] = DIRECTIONS[d];
        layout.setBetween(i, j, di, dj, EDGE_NONE);
        const next = (i + di) * N + j + dj;
        visited[next] = 1;
        stack.push(next);
        last = d;
    }
    const ways = [];
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        for (const [di, dj] of DIRECTIONS) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
            if (inside[ni * N + nj] && layout.between(i, j, di, dj) === EDGE_WALL && random() < 0.06) layout.setBetween(i, j, di, dj, EDGE_NONE);
            else if (kinds[ni * N + nj] & CELL_CORRIDOR) ways.push([i, j, di, dj]);
        }
    }
    const wanted = Math.min(ways.length, 1 + Math.floor(cells.length / 12));
    for (let n = 0; n < wanted; n++) {
        const [i, j, di, dj] = ways.splice(Math.floor(random() * ways.length), 1)[0];
        layout.setBetween(i, j, di, dj, EDGE_DOOR);
    }
}

/**
 * Lobby or ballroom chunk, one big room open to the rest of its hall. Lobbies get a wall or two splitting off lounges,
 * with wide openings, and columns on a grid shared by the whole hall. The ballroom is left open.
 */
function hall(layout, kinds, rooms, random, seed, zone, zoneOf, cx, cz) {
    const lobby = zone.type === ZONE_LOBBY;
    kinds.fill(lobby ? CELL_HALL : CELL_BALLROOM);
    rooms.fill(0);
    if (!lobby) return;
    const walls = random() < 0.75 ? 1 + (random() < 0.35 ? 1 : 0) : 0;
    let taken = -1;
    for (let n = 0; n < walls; n++) {
        const alongX = n === 0 ? random() < 0.5 : taken === 0;
        const line = 5 + Math.floor(random() * (N - 9));
        const from = random() < 0.4 ? 1 + Math.floor(random() * 4) : 0;
        const to = random() < 0.4 ? N - 1 - Math.floor(random() * 4) : N;
        const set = alongX ? (k, type) => layout.setH(from + k, line, type) : (k, type) => layout.setV(line, from + k, type);
        for (let k = 0; k < to - from; k++) set(k, EDGE_WALL);
        // a three-cell arch, then one or two doorways spaced away from it and each other
        const wide = 1 + Math.floor(random() * (to - from - 4));
        for (let k = 0; k < 3; k++) set(wide + k, EDGE_NONE);
        const used = [wide - 1, wide, wide + 1, wide + 2, wide + 3];
        const doorways = 1 + Math.floor(random() * 2);
        for (let d = 0, attempt = 0; d < doorways && attempt < 10; attempt++) {
            const k = Math.floor(random() * (to - from));
            if (used.some((u) => Math.abs(u - k) < 2)) continue;
            set(k, EDGE_DOOR);
            used.push(k);
            d++;
        }
        taken = alongX ? 1 : 0;
        // the far side becomes its own room (a lounge)
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                if ((alongX ? j >= line : i >= line) && (alongX ? i >= from && i < to : j >= from && j < to)) rooms[i * N + j] = n + 1;
            }
        }
    }
    // columns on a grid shared by the whole hall so they line up across chunks
    const [ox, oz] = columnGrid(zone);
    const sameHall = (ncx, ncz) => {
        const other = zoneOf(ncx, ncz);
        return other.type === ZONE_LOBBY && other.variant === zone.variant;
    };
    placeGridPillars(layout, cx, cz, sameHall, (x, z) => mod(x - ox, COLUMN_SPACING) === 0 && mod(z - oz, COLUMN_SPACING) === 0
        && hashFloat(seed, 0x5c01, x, z) >= 0.04);
}

/** Lobby column spacing. */
export const COLUMN_SPACING = 4;
/** Half width of a lobby beam. */
export const BEAM_HALF = 0.045;

/**
 * Lobby column grid offset. Columns sit on corners of cells where x − ox and z − oz are multiples of COLUMN_SPACING.
 * Never on a chunk border (those are cells ≡ 3 mod 4), so a beam along a column line always belongs to one chunk.
 * @param {import('./zones.js').Zone} zone
 * @returns {[number, number]}
 */
export function columnGrid(zone) {
    return [zone.variant % 3, (zone.variant >>> 4) % 3];
}

/**
 * Lobby ceiling beams along every column line, wall to wall, as [x0, z0, x1, z1] runs in world coordinates with ends
 * at the wall faces. Never along or through a wall. Beams along x run through, beams along z stop either side of them.
 */
function findBeams(layout, kinds, beams, x0, z0, zone) {
    const [ox, oz] = columnGrid(zone);
    const v = (i, j) => (j >= 0 && j < N ? layout.getV(i, j) : EDGE_NONE);
    const h = (i, j) => (i >= 0 && i < N ? layout.getH(i, j) : EDGE_NONE);
    // whether a wall or wall end touches local corner (i, j), the +x+z corner of cell (i − 1, j − 1)
    const post = (i, j) => v(i, j - 1) !== EDGE_NONE || v(i, j) !== EDGE_NONE || h(i - 1, j) !== EDGE_NONE || h(i, j) !== EDGE_NONE;
    // corners crossed by x beams, where z beams stop
    const crossed = new Uint8Array((N + 1) * (N + 1));
    for (const alongX of [true, false]) {
        for (let a = 1; a < N; a++) {
            // line a runs between local cells a − 1 and a
            if (mod((alongX ? z0 : x0) + a - 1 - (alongX ? oz : ox), COLUMN_SPACING) !== 0) continue;
            const corner = (b) => (alongX ? b * (N + 1) + a : a * (N + 1) + b);
            const walled = (b) => (alongX ? post(b, a) : post(a, b));
            // beam can run from corner b to b + 1 if there's no edge there and hall on both sides
            const usable = (b) => (alongX
                ? h(b, a) === EDGE_NONE && kinds[b * N + a - 1] & CELL_HALL && kinds[b * N + a] & CELL_HALL
                : v(a, b) === EDGE_NONE && kinds[(a - 1) * N + b] & CELL_HALL && kinds[a * N + b] & CELL_HALL);
            const origin = alongX ? x0 : z0;
            const line = (alongX ? z0 : x0) + a - 0.5;
            let start = null;
            let from = 0;
            for (let b = 0; b <= N; b++) {
                const wall = walled(b);
                const split = !alongX && crossed[corner(b)] === 1;
                const inset = wall ? WALL_THICKNESS / 2 : split ? BEAM_HALF : 0;
                const at = origin + b - 0.5;
                if (start !== null && (wall || split || b === N || !usable(b))) {
                    if (at - inset - start > 0.3) {
                        beams.push(...(alongX ? [start, line, at - inset, line] : [line, start, line, at - inset]));
                        if (alongX) for (let c = from; c <= b; c++) crossed[corner(c)] = 1;
                    }
                    start = null;
                }
                if (b < N && start === null && usable(b)) {
                    start = at + inset;
                    from = b;
                }
            }
        }
    }
}


// ---------------------------------------------------------------------------------------------- the doors

/**
 * Locked doors in the walls the chunk's cells own (their +x and +z edges). They go along corridor sides where there's
 * no light, across dead ends, all around the ballroom, sometimes around a lobby (with a lift or two), and now and then
 * in staff corridors. `theirs` gets the doors on the -x and -z borders, which belong to the previous chunks.
 */
function findDoors(layout, kinds, doors, theirs, seed, x0, z0, zone, zoneOf, options) {
    // corridor and hall bits for a cell across the chunk border
    const outside = (x, z) => {
        const ncx = chunkCoord(x);
        const ncz = chunkCoord(z);
        if (options.isVoid?.(ncx, ncz)) return 0;
        const type = zoneOf(ncx, ncz).type;
        if (type === ZONE_LOBBY) return CELL_HALL;
        if (type === ZONE_BALLROOM) return CELL_BALLROOM;
        return corridorKind(seed, x, z, zoneOf, options) | (type === ZONE_STAFF ? CELL_STAFF : 0);
    };
    const staffFloor = zone === ZONE_STAFF;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            for (const axis of /** @type {(0 | 1)[]} */ ([0, 1])) {
                if ((axis === 0 ? layout.getV(i + 1, j) : layout.getH(i, j + 1)) !== EDGE_WALL) continue;
                const x = x0 + i;
                const z = z0 + j;
                const [nx, nz] = axis === 0 ? [x + 1, z] : [x, z + 1];
                const ni = nx - x0;
                const nj = nz - z0;
                const inside = ni < N && nj < N;
                const here = kinds[i * N + j];
                const there = inside ? kinds[ni * N + nj] : outside(nx, nz);
                const door = doorFor(seed, x, z, axis, here, there, staffFloor && !(here & CELL_GALLERY), inside ? staffFloor : (there & CELL_STAFF) !== 0);
                if (door) doors.push(door);
            }
        }
    }
    // Doors on the -x and -z borders belong to the previous chunks. Work them out the same way they do, since doorFor
    // only needs what either side can see, so things along those walls here can keep clear.
    for (let k = 0; k < N; k++) {
        for (const axis of /** @type {(0 | 1)[]} */ ([0, 1])) {
            if ((axis === 0 ? layout.getV(0, k) : layout.getH(k, 0)) !== EDGE_WALL) continue;
            const [x, z] = axis === 0 ? [x0 - 1, z0 + k] : [x0 + k, z0 - 1];
            if (options.isVoid?.(chunkCoord(x), chunkCoord(z))) continue;
            const here = outside(x, z);
            const there = outside(x + 1 - axis, z + axis);
            const door = doorFor(seed, x, z, axis, here, there, (here & CELL_STAFF) !== 0, (there & CELL_STAFF) !== 0);
            if (door) theirs.push(door);
        }
    }
}

/**
 * Door in the wall on the +x (axis 0) or +z (axis 1) side of cell (x, z), or null. `here` and `there` are the cell
 * kinds either side, `hereStaff` and `thereStaff` whether each is on a staff floor.
 * @returns {HotelDoor | null}
 */
function doorFor(seed, x, z, axis, here, there, hereStaff, thereStaff) {
    // promenade back wall: only the lifts you arrived in
    if (axis === 1 && here & CELL_GALLERY && z === GALLERY.z1) {
        if ((x & 1) !== 0) return null;
        return { x, z, axis, front: -1, kind: DOOR_ELEVATOR, state: DOOR_SHUT, number: 0, variant: hashInts(seed, 0xd00d, x, z, axis) };
    }
    // door type this side of the wall wants, or -1
    const wanted = (kind, staff) => {
        const corridor = kind & CELL_CORRIDOR;
        if (corridor && (kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) !== (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) {
            const alongX = (kind & CELL_X_CORRIDOR) !== 0;
            const side = alongX ? axis === 1 : axis === 0;
            const along = axis === 0 ? z : x;
            if (side && (along & 1) !== 0) return -1;
            const kindOf = staff ? DOOR_STAFF : DOOR_GUEST;
            if (side) return staff && hashFloat(seed, 0xd00a, x, z, axis) >= 0.45 ? -1 : kindOf;
            return hashFloat(seed, 0xd00b, x, z, axis) < 0.75 ? kindOf : -1;
        }
        const along = axis === 0 ? z : x;
        if ((along & 1) !== 0) return -1;
        const roll = hashFloat(seed, 0xd00c, x, z, axis);
        if (kind & CELL_BALLROOM) return roll < 0.65 ? DOOR_BALLROOM : -1;
        if (kind & CELL_HALL) return roll < 0.2 ? DOOR_GUEST : roll < 0.3 ? DOOR_ELEVATOR : -1;
        return -1;
    };
    // none in walls inside a hall (between lounges)
    const hallish = CELL_HALL | CELL_BALLROOM;
    if ((here & hallish) && (here & hallish) === (there & hallish)) return null;
    const mine = wanted(here, hereStaff);
    const theirs = wanted(there, thereStaff);
    // Faces the side it belongs to, corridor winning over hall. front -1 is this cell (the wall's -x/-z side), 1 is the
    // far one.
    const theirsFirst = theirs >= 0 && (mine < 0 || ((there & CELL_CORRIDOR) !== 0 && (here & CELL_CORRIDOR) === 0));
    if (!theirsFirst && mine < 0) return null;
    const kind = theirsFirst ? theirs : mine;
    const front = theirsFirst ? 1 : -1;
    const variant = hashInts(seed, 0xd00d, x, z, axis);
    return { x, z, axis, front, kind, state: doorState(kind, variant), number: roomNumber(kind, variant), variant };
}

/** Door state from its variant. */
function doorState(kind, variant) {
    if (kind === DOOR_ELEVATOR) return DOOR_SHUT;
    const roll = (variant >>> 20) & 255;
    if (kind === DOOR_STAFF) return roll < 14 ? DOOR_LIT : DOOR_SHUT;
    if (roll < 12) return DOOR_AJAR;
    if (roll < 30) return DOOR_LIT;
    if (roll < 42 && kind === DOOR_GUEST) return DOOR_SIGN;
    return DOOR_SHUT;
}

/** Random room number. Mostly three digits, some four, a few missing (0). */
function roomNumber(kind, variant) {
    if (kind !== DOOR_GUEST) return 0;
    const roll = variant & 255;
    if (roll < 8) return 0;
    const h = hashInts(variant, 0x4e0);
    if (roll < 36) return 1000 + (h % 9000);
    return 100 + (h % 900);
}

// ---------------------------------------------------------------------------------------------- the sconces

/**
 * Sconces (two candle bulbs on a brass arm). Both sides of a corridor under each light, along the promenade, and some
 * around lobbies and the ballroom. Each switches with its light slot (see sconceSlot), which must be in the same chunk
 * so that chunk controls it.
 */
function placeSconces(layout, kinds, sconces, doors, seed, x0, z0, zone) {
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const kind = kinds[i * N + j];
            const x = x0 + i;
            const z = z0 + j;
            for (const [di, dj, bit] of SCONCE_WALLS) {
                if (layout.between(i, j, di, dj) !== EDGE_WALL) continue;
                const along = di !== 0 ? z : x;
                if ((along & 1) === 0) continue;
                // not over a door, corridor ends can have one in any cell
                const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
                if (doors.some((door) => door.x === ex && door.z === ez && door.axis === axis)) continue;
                const [sx, sz] = sconceSlot(x, z, di, dj);
                if (sx - x0 < 0 || sx - x0 >= N || sz - z0 < 0 || sz - z0 >= N) continue;
                const roll = hashFloat(seed, 0x5c0e, x, z, bit);
                let wanted = false;
                if (kind & CELL_GALLERY) wanted = di !== 0;
                else if (kind & CELL_CORRIDOR) {
                    const run = kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR);
                    // both sides, not at crossings, fewer in staff zones
                    wanted = (run === CELL_X_CORRIDOR ? dj !== 0 : run === CELL_Z_CORRIDOR && di !== 0) && (zone !== ZONE_STAFF || roll < 0.25);
                } else if (kind & CELL_HALL) wanted = roll < 0.55;
                else if (kind & CELL_BALLROOM) wanted = roll < 0.5;
                if (wanted) sconces[i * N + j] |= bit;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- the lights

/**
 * Level 5 darkness at a point, 0 to 1. Long dead stretches, but the start is always lit. The ballroom is dark
 * regardless (see hotelLights).
 */
export function terrorHotelDarkness(seed, x, z) {
    const n = 0.62 * valueNoise(seed ^ 0x5dac, x / 30, z / 30) + 0.38 * valueNoise(seed ^ 0x5dad, x / 11, z / 11);
    let darkness = smoothstep(0.56, 0.72, n);
    const distance = Math.hypot(x, z + 4);
    if (distance < 24) darkness *= smoothstep(12, 24, distance);
    return darkness;
}

/**
 * Level 5 light slots. Corridors get alabaster bowls (lanterns at crossings and on the promenade), lobbies a candle
 * ring on every other slot, the ballroom a crystal chandelier every few cells (rarely lit), staff areas bare bulbs,
 * guest rooms maybe a bowl. Slots with sconces are on even without a fitting, since the light is theirs. Slots in
 * `lit` (local i * N + j, over the Beverly Room table or lobby flowers) are always on.
 */
function hotelLights(seed, x0, z0, zone, kinds, sconces, lit, fixtures, empty) {
    if (empty) return darkLights(LAMP_WARM);
    // slots that have sconces switching with them
    const powered = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const bits = sconces[i * N + j];
            if (bits === 0) continue;
            for (const [di, dj, bit] of SCONCE_WALLS) {
                if (!(bits & bit)) continue;
                const [sx, sz] = sconceSlot(x0 + i, z0 + j, di, dj);
                powered[((sx - x0 - 1) >> 1) * PANELS_PER_SIDE + ((sz - z0 - 1) >> 1)] = 1;
            }
        }
    }
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const i = pi * 2 + 1;
            const j = pj * 2 + 1;
            const x = x0 + i;
            const z = z0 + j;
            const k = pi * PANELS_PER_SIDE + pj;
            const kind = kinds[i * N + j];
            const darkness = terrorHotelDarkness(seed, x, z);
            const roll = (salt) => hashFloat(seed, salt, x, z);
            let fixture = FIXTURE_NONE;
            let dead = 0.08 + 0.85 * darkness;
            let area = 0.5;
            let tint = LAMP_WARM;
            if (kind & CELL_GALLERY) {
                // down the middle, but not in front of the painting between the lifts
                fixture = x === 1 && z < GALLERY.z1 ? FIXTURE_LANTERN : FIXTURE_NONE;
                tint = LAMP_CANDLE;
                area = 0.56;
            } else if (kind & CELL_CORRIDOR) {
                const junction = (kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) === (CELL_X_CORRIDOR | CELL_Z_CORRIDOR);
                if (zone === ZONE_STAFF) {
                    fixture = FIXTURE_BULB;
                    tint = LAMP_BARE;
                    area = 0.36;
                    dead = 0.25 + 0.75 * darkness;
                } else {
                    fixture = junction ? FIXTURE_LANTERN : FIXTURE_BOWL;
                    tint = junction ? LAMP_CANDLE : LAMP_ALABASTER;
                }
            } else if (kind & CELL_HALL) {
                fixture = (((x - 1) >> 1) + ((z - 1) >> 1)) % 2 === 0 ? FIXTURE_CHANDELIER : FIXTURE_NONE;
                tint = LAMP_CANDLE;
                area = 0.56;
            } else if (kind & CELL_BALLROOM) {
                fixture = mod((x - 1) >> 1, 2) === 0 && mod((z - 1) >> 1, 2) === 0 ? FIXTURE_CRYSTAL : FIXTURE_NONE;
                tint = LAMP_CRYSTAL;
                area = 0.25;
                // hardly any lit
                dead = 0.84 + 0.16 * darkness;
            } else if (kind & CELL_STAFF) {
                fixture = roll(0x5e1f) < 0.5 ? FIXTURE_BULB : FIXTURE_NONE;
                tint = LAMP_BARE;
                area = 0.3;
                dead = 0.3 + 0.7 * darkness;
            } else if (kind & CELL_ROOM) {
                fixture = roll(0x5e1f) < 0.55 ? FIXTURE_BOWL : FIXTURE_NONE;
                tint = LAMP_ALABASTER;
                area = 0.34;
                dead = 0.3 + 0.7 * darkness;
            }
            // lobby slots between chandeliers get dimmer spill light from them and the walls
            const between = kind & CELL_HALL && fixture === FIXTURE_NONE;
            const on = fixture !== FIXTURE_NONE || powered[k] === 1 || between;
            let brightness = on ? (between && powered[k] !== 1 ? 70 : 255) : 0;
            let flicker = 0;
            const nearStart = x >= -2 && x <= 4 && z >= -12 && z <= 4;
            if ((nearStart && kind & CELL_CORRIDOR) || lit.has(i * N + j)) {
                // always working near the start and over anything in `lit`
                brightness = 255;
            } else if (brightness > 0) {
                if (roll(0x5e19) < dead) {
                    brightness = 0;
                } else {
                    if (roll(0x5e1a) < 0.16) brightness = 120 + Math.floor(roll(0x5e1b) * 100);
                    if (roll(0x5e1c) < 0.04 + 1.2 * darkness * (1 - darkness)) flicker = 1 + (hashInts(seed, 0x5e1d, x, z) % 255);
                }
            }
            fixtures[k] = fixture;
            lights[k * 4] = brightness;
            lights[k * 4 + 1] = Math.round(255 * area * (1 - 0.86 * darkness));
            lights[k * 4 + 2] = flicker;
            lights[k * 4 + 3] = tint;
        }
    }
    return lights;
}

// ---------------------------------------------------------------------------------------------- cells

/**
 * Per-cell bytes for Level 5's shaders (see ChunkData.cells). Byte 0 is look, corridor direction and sconces. Bytes 1
 * and 2 hold the nearest lamp's x and z offset in eighths plus 32 (0 for none). Their top bits hold the guest room
 * palette and the floor pattern (lobby marble, or a dance floor from `floors`).
 */
function cellBytes(kinds, rooms, sconces, lamps, floors, seed, x0, z0, zone, empty) {
    const cells = new Uint8Array(N * N * 4);
    if (empty) return cells;
    const marble = zone.type === ZONE_LOBBY && (zone.variant >>> 9) % 3 === 0;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const kind = kinds[cell];
            let look = LOOK_ROOM;
            if (kind & CELL_CORRIDOR) look = zone.type === ZONE_STAFF && !(kind & CELL_GALLERY) ? LOOK_STAFF : LOOK_CORRIDOR;
            else if (kind & CELL_HALL) look = LOOK_LOBBY;
            else if (kind & CELL_BALLROOM) look = LOOK_BALLROOM;
            else if (kind & CELL_STAFF) look = LOOK_STAFF;
            const alongX = (kind & CELL_CORRIDOR) === CELL_X_CORRIDOR ? CELL_ALONG_X : 0;
            cells[cell * 4] = look | alongX | sconces[cell];
            const palette = rooms[cell] >= 0 ? hashInts(seed, 0x9a1e, x0, z0, rooms[cell]) & 3 : 0;
            cells[cell * 4 + 1] = palette << PALETTE_SHIFT;
            cells[cell * 4 + 2] = (floors[cell] || (marble ? FLOOR_MARBLE : FLOOR_PLAIN)) << FLOOR_SHIFT;
        }
    }
    // Each cell any lamp light can reach (half a cell either way of its middle) stores the nearest lamp.
    const best = new Float32Array(N * N).fill(Infinity);
    for (const lamp of lamps) {
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                const ox = lamp.x - (x0 + i);
                const oz = lamp.z - (z0 + j);
                if (Math.abs(ox) > LAMP_REACH || Math.abs(oz) > LAMP_REACH) continue;
                const d = Math.hypot(ox, oz);
                const cell = i * N + j;
                if (d >= best[cell]) continue;
                best[cell] = d;
                cells[cell * 4 + 1] = (cells[cell * 4 + 1] & ~63) | (Math.round(ox * 8) + 32);
                cells[cell * 4 + 2] = (cells[cell * 4 + 2] & ~63) | (Math.round(oz * 8) + 32);
            }
        }
    }
    return cells;
}

/**
 * Floor type at (x, z) for footstep sounds, from the cell bytes (see cellBytes). 0 carpet, 1 hard (parquet or
 * marble), 2 staff linoleum.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} x
 * @param {number} z
 */
export function terrorHotelFloorAt(store, x, z) {
    const cellX = Math.floor(x + 0.5);
    const cellZ = Math.floor(z + 0.5);
    const cx = chunkCoord(cellX);
    const cz = chunkCoord(cellZ);
    const cells = store.getChunk(cx, cz).cells;
    if (!cells) return 0;
    const k = ((cellX - cx * N + HALF_CHUNK) * N + (cellZ - cz * N + HALF_CHUNK)) * 4;
    const look = cells[k] & 7;
    const floor = cells[k + 2] >> FLOOR_SHIFT;
    if (look === LOOK_STAFF) return 2;
    if (floor === FLOOR_MARBLE || floor === FLOOR_PARQUET) return 1;
    return 0;
}
