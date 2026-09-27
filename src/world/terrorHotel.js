import { CHUNK_SIZE, HALF_CHUNK, WALL_THICKNESS } from '../config.js';
import { Layout, PANELS_PER_SIDE, connectAll, darkLights, placeGridPillars, punchOpenings, removeBuriedPillars, smoothstep } from './generator.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord, mod } from './grid.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { furnish } from './terrorHotelFurniture.js';
import { placeTerrorHotelProps } from './terrorHotelProps.js';
import { ZONE_BALLROOM, ZONE_GUEST, ZONE_LOBBY, ZONE_STAFF, zoneAt } from './zones.js';

/*
 * Level 5, "the Terror Hotel": a grand hotel of the 1920s that goes on for ever, and is nearly empty. Long corridors of
 * numbered doors, none of which open, in the warm light of their sconces; the rooms behind the few that do, made up and
 * waiting; lobbies of red marble columns under painted beams, with lamps left on in the lounges; and the Beverly Room, a
 * ballroom too big to see across, dark but for one chandelier over one small table. Behind it all, the plain passages
 * the staff use. Somewhere a band is playing.
 *
 * It's the same grid of cells as Level 0, so walking, editing and a tape (see footage/) work on it unchanged. As on
 * Level 2, the corridors run on lines of odd cells, the same lines for the whole level (so one can run straight on for
 * a long way, through chunk after chunk), and each stretch of one is there or not by itself, so both chunks it passes
 * through agree. The guest rooms, the staff passages, the lobbies and the ballroom are up to the chunk. This works out
 * the layout, the doors that don't open, the lights (the fittings, and the sconces on the walls, which each go on and
 * off with a light slot), the furniture (terrorHotelFurniture.js) and what's lying about (terrorHotelProps.js);
 * terrorHotelGeometry.js builds the mouldings round the walls, the doors, the fittings and the furniture, and the
 * materials (terrorHotelMaterials.js, terrorHotelShading.js) do the wallpaper, the carpets, the plaster and the light.
 * levels.js ties it in.
 */

const N = CHUNK_SIZE;

/** What Level 5's regions are made of (see zones.js). Where you start is always a guest floor. */
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

/** Whether a zone is one great room over its whole chunk (a lobby, the ballroom), rather than corridors and rooms. */
export function isHall(type) {
    return type === ZONE_LOBBY || type === ZONE_BALLROOM;
}

// ---------------------------------------------------------------------------------------------- the corridors

/** Corridors running along x (on a line z = const), and along z (on a line x = const). */
export const FAMILY_X = 0;
export const FAMILY_Z = 1;
/** Lines of each family come about this far apart (4 to 8), with rooms two or three deep between. */
const LINE_SPACING = 6;
/** The corridor on from the promenade where you start runs at least this far (to z = −48, 130 m). */
const START_CORRIDOR_TO = -48;

/** What's in a cell (see TerrorHotelData.kinds). */
export const CELL_X_CORRIDOR = 1; // on a corridor along x
export const CELL_Z_CORRIDOR = 2; // on a corridor along z
export const CELL_GALLERY = 4; // the promenade where you start
export const CELL_ROOM = 8; // a guest room, or a closet
export const CELL_HALL = 16; // a lobby or a lounge
export const CELL_BALLROOM = 32; // the Beverly Room
export const CELL_STAFF = 64; // a maintenance passage
export const CELL_TAKEN = 128; // furniture stands in it
export const CELL_CORRIDOR = CELL_X_CORRIDOR | CELL_Z_CORRIDOR | CELL_GALLERY;

/** The promenade where you start: three cells wide, from just behind you to the chunk's edge (x 0 to 2, z −8 to 1). */
export const GALLERY = Object.freeze({ x0: 0, x1: 2, z0: -8, z1: 1 });

/**
 * Where the k-th line of a family is: z for corridors along x, x for those along z. Always odd, so every corridor has a
 * light slot over every other cell. (The first line along z is where the corridor on from the promenade runs.)
 * @param {number} seed
 * @param {number} family
 * @param {number} k
 */
export function corridorLine(seed, family, k) {
    if (family === FAMILY_Z && k === 0) return 1;
    return LINE_SPACING * k + 1 + 2 * (hashInts(seed, 0x5d10, family, k) % 2);
}

/** The last line of a family at or before c: the k with corridorLine(k) ≤ c < corridorLine(k + 1). */
export function lineBefore(seed, family, c) {
    const k = Math.floor((c - 1) / LINE_SPACING);
    return corridorLine(seed, family, k) > c ? k - 1 : k;
}

/** The line of a family at c, if there's one there: its index, or null. */
export function lineAt(seed, family, c) {
    if ((c & 1) === 0) return null;
    const k = lineBefore(seed, family, c);
    return corridorLine(seed, family, k) === c ? k : null;
}

/**
 * Whether the n-th stretch of the k-th line of a family is there: the stretch between where the n-th and (n + 1)-th
 * lines of the other family cross it. Most lines are main corridors, which nearly always are; the rest come and go.
 * There are fewer through the lobbies and none through the ballroom (a hall takes its chunk whole), and more through
 * the staff passages. Only the stretch's own coordinates decide it, so both chunks it runs through agree.
 * @param {number} seed
 * @param {number} family
 * @param {number} k
 * @param {number} n
 * @param {(cx: number, cz: number) => import('./zones.js').Zone} zoneOf
 */
export function stretchPresent(seed, family, k, n, zoneOf) {
    const from = corridorLine(seed, 1 - family, n);
    const to = corridorLine(seed, 1 - family, n + 1);
    // The corridor on from the promenade.
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

/** Whether the edge along a line of `family` (the k-th), between cells c and c + 1 along it, is open corridor. */
function corridorEdge(seed, family, k, c, zoneOf) {
    return stretchPresent(seed, family, k, lineBefore(seed, 1 - family, c), zoneOf);
}

/**
 * What a cell is on, as far as the corridors go (CELL_X_CORRIDOR, CELL_Z_CORRIDOR, CELL_GALLERY), wherever it is:
 * worked out from the lines alone, the same as its chunk carves them (see carveCorridors), so a chunk can tell what's
 * on the far side of its border. Nothing in a hall, nor outside a tape's walls.
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

/** Whether a cell is in the promenade where you start. */
export function inGallery(x, z) {
    return x >= GALLERY.x0 && x <= GALLERY.x1 && z >= GALLERY.z0 && z <= GALLERY.z1;
}

/**
 * The wall line between chunk (cx, cz) and the one before it on an axis (as borderLine in generator.js has it, but
 * Level 5's own): open where a corridor crosses it, and never without a way through; nothing at all between two
 * chunks of one hall, and wide ways through between two halls.
 */
function hotelBorder(seed, axis, cx, cz, options, zoneOf) {
    const line = new Uint8Array(N);
    if (options.isSealed?.(axis, cx, cz)) return line.fill(EDGE_WALL);
    const beforeX = axis === 0 ? cx - 1 : cx;
    const beforeZ = axis === 0 ? cz : cz - 1;
    if (options.isVoid?.(beforeX, beforeZ) && options.isVoid?.(cx, cz)) return line;
    const before = zoneOf(beforeX, beforeZ);
    const after = zoneOf(cx, cz);
    // One hall going on into the next chunk. (Its corners can hold a column: see placeGridPillars.)
    if (isHall(before.type) && before.type === after.type && before.variant === after.variant) return line;
    line.fill(EDGE_WALL);
    const random = mulberry32(hashInts(seed, 0x5db0, axis, cx, cz));
    // Axis 0 is a border along z, crossed by the corridors along x.
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
        // From one hall into another: wide ways through, and doors. (Clear of the corridors' openings.)
        const set = (k, type) => {
            if (line[k] === EDGE_WALL) line[k] = type;
        };
        punchOpenings(N, set, random, 2 + Math.floor(random() * 3), 'edge');
        open++;
    }
    // Never a border with no way through.
    if (open === 0) line[first >= 0 ? first : N >> 1] = EDGE_DOOR;
    return line;
}

// ---------------------------------------------------------------------------------------------- the doors

/** What a door that doesn't open is (see HotelDoor). */
export const DOOR_GUEST = 0; // a guest room's: panelled walnut, its number on a brass plate
export const DOOR_STAFF = 1; // a plain painted door: STAFF ONLY, in a few languages
export const DOOR_BALLROOM = 2; // one of the Beverly Room's: tall, cream and gold
export const DOOR_ELEVATOR = 3; // a lift's brass doors, with the dial over them
/** How it's left. */
export const DOOR_SHUT = 0;
export const DOOR_AJAR = 1; // open a crack, towards you: nothing but black behind
export const DOOR_LIT = 2; // shut, with light under it, and now and then something passing across the light
export const DOOR_SIGN = 3; // shut, with a sign hung on its handle

/**
 * @typedef {object} HotelDoor A door set in a wall that doesn't open (see terrorHotelGeometry.js): the wall is the +x
 *     edge (axis 0) or +z edge (axis 1) of cell (x, z), and the door is drawn on both of its faces.
 * @property {number} x
 * @property {number} z
 * @property {0 | 1} axis
 * @property {number} front The side it faces into the corridor (or the hall) on: 1 (+x or +z) or −1. Its number, and
 *     how it's left, are on that side.
 * @property {number} kind DOOR_*.
 * @property {number} state DOOR_SHUT, DOOR_AJAR, DOOR_LIT or DOOR_SIGN.
 * @property {number} number Its room number: never in any order (0 for none).
 * @property {number} variant 32 bits for its details.
 */

// ---------------------------------------------------------------------------------------------- the lights

/** A light slot's fourth byte in Level 5 (see ChunkData.lights): the colour of its light. */
export const LAMP_WARM = 255; // an ordinary bulb, warm
export const LAMP_CANDLE = 254; // candle bulbs, deeper and redder
export const LAMP_ALABASTER = 253; // through alabaster, softer and paler
export const LAMP_CRYSTAL = 252; // a chandelier's crystal, golden
export const LAMP_BARE = 251; // a bare bulb in the staff passages, yellower

/** What hangs in a light slot (see TerrorHotelData.fixtures). */
export const FIXTURE_NONE = 0;
export const FIXTURE_BOWL = 1; // an alabaster bowl close under the ceiling, on a rose
export const FIXTURE_LANTERN = 2; // a pendant lantern of iron and amber glass
export const FIXTURE_CHANDELIER = 3; // a wrought-iron ring of candle bulbs on chains
export const FIXTURE_CRYSTAL = 4; // a great tiered chandelier of crystal
export const FIXTURE_BULB = 5; // a bulb in a plain shade on its flex

/** A cell's sconces (the top four bits of its first byte; see cellBytes): on its −x, +x, −z and +z walls. */
export const SCONCE_NEG_X = 16;
export const SCONCE_POS_X = 32;
export const SCONCE_NEG_Z = 64;
export const SCONCE_POS_Z = 128;
/** The same, by the way to the wall: [di, dj, bit]. */
export const SCONCE_WALLS = Object.freeze([[-1, 0, SCONCE_NEG_X], [1, 0, SCONCE_POS_X], [0, -1, SCONCE_NEG_Z], [0, 1, SCONCE_POS_Z]]);
/** How high a sconce's bulbs are, and how far its light reaches. */
export const SCONCE_Y = 0.6;
export const SCONCE_RANGE = 1.15;
/** How far a sconce's light seems to come from out in front of the wall's face (its bulbs stand off it on their arm). */
export const SCONCE_OUT = 0.07;

/**
 * The light slot a sconce goes on and off with, from the cell it's in and the way to its wall: the nearest slot the
 * way it faces (along its wall, it's always on a slot's line). The same as the shaders find it.
 * @returns {[number, number]} The slot's cell.
 */
export function sconceSlot(x, z, di, dj) {
    if (di !== 0) return [x & 1 ? x : x - di, z];
    return [x, z & 1 ? z : z - dj];
}

/**
 * How high a lamp's shade is (every lamp standing on a table or on the floor has it at the same height), and where the
 * light of candles on a table, or the band's desks, comes from.
 */
export const LAMP_Y = 0.34;
/** How far a lamp's light reaches. */
export const LAMP_RANGE = 1.5;
/** How far from the middle of a cell a lamp can be and still light any of it; and how far one keeps from the chunk's edge. */
const LAMP_REACH = LAMP_RANGE + 0.5;
const LAMP_CLEAR = LAMP_REACH - 0.5;

/**
 * @typedef {object} Lamp A lamp left on (on a table, a nightstand, or standing on the floor): where its shade is. Its
 *     light is worked out in the shaders, from the cells round it (see cellBytes).
 * @property {number} x On an eighth of a unit.
 * @property {number} z
 */

// ---------------------------------------------------------------------------------------------- cells

/** A cell's first byte (see ChunkData.cells): its look, which way its corridor runs, and its sconces. */
export const LOOK_CORRIDOR = 0;
export const LOOK_ROOM = 1;
export const LOOK_LOBBY = 2;
export const LOOK_BALLROOM = 3;
export const LOOK_STAFF = 4;
export const CELL_ALONG_X = 8; // its corridor runs along x (the carpet's runner follows it)
/** The second byte's top two bits: a guest room's colours. The third's: how its floor's laid (see FLOOR_*). */
export const PALETTE_SHIFT = 6;
export const FLOOR_SHIFT = 6;
export const FLOOR_PLAIN = 0;
export const FLOOR_PARQUET = 1; // a dance floor, in the ballroom
export const FLOOR_MARBLE = 2; // marble, in a lobby

/**
 * @typedef {object} TerrorHotelData What a Level 5 chunk has that Level 0's don't.
 * @property {Uint8Array} kinds What each cell is (CELL_*), indexed `i * N + j`.
 * @property {Int16Array} rooms Which of the chunk's rooms each cell is in (a guest room, a hall), or −1.
 * @property {Uint8Array} fixtures What hangs in each light slot (FIXTURE_*), indexed like the lights.
 * @property {Uint8Array} sconces Each cell's sconces (SCONCE_*), indexed like the kinds.
 * @property {HotelDoor[]} doors The doors that don't open, in the walls the chunk's cells own.
 * @property {import('./terrorHotelFurniture.js').Furniture[]} furniture (What of it is solid is in the chunk's `solids`.)
 * @property {Lamp[]} lamps
 * @property {number[]} beams The lobbies' beams under the ceiling, as [x0, z0, x1, z1] runs along a line of corners
 *     (see terrorHotelGeometry.js).
 */

// ---------------------------------------------------------------------------------------------- generating

/**
 * How the endless level is generated for Level 5 (see generator.js's WorldOptions).
 * @param {number} seed
 * @returns {import('./generator.js').WorldOptions}
 */
export function terrorHotelOptions(seed) {
    return { level: 4, zoneAt: (cx, cz) => terrorHotelZoneAt(seed, cx, cz) };
}

/** The kind of space a chunk of Level 5 is. */
export function terrorHotelZoneAt(seed, cx, cz) {
    return zoneAt(seed, cx, cz, TERROR_HOTEL_ZONES);
}

/**
 * Generates one chunk of Level 5. Like Level 0 (see generator.js), chunks are independent and share only the wall lines
 * on their borders, and a game mode's options (a tape's walls, see footage/arena.js) work the same.
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
            // Which edges inside the chunk run along a corridor: open (the rest round a corridor are walled).
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
    // How each cell's floor is laid, where it isn't as its look has it (the ballroom's dance floors).
    const floors = new Uint8Array(N * N);
    // Nothing where you start (the promenade's aisles, and on a tape, the room-sized space round where you start).
    const avoid = (x, z) => x >= -3 && x <= 3 && z >= -3 && z <= 2;
    let lit = new Set();
    // Every door in its walls, its own and those the chunks before it have in its borders, for what goes along the walls
    // to keep clear of.
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
 * The corridors: every stretch of a line through the chunk that's there. `open` gets the edges along them: the +x edge
 * of local cell (i, j) at 2 (i N + j), its +z edge at the next.
 */
function carveCorridors(open, kinds, seed, x0, z0, zoneOf) {
    for (const family of [FAMILY_X, FAMILY_Z]) {
        // Across the chunk (j for corridors along x), and along it.
        const acrossFrom = family === FAMILY_X ? z0 : x0;
        const alongFrom = family === FAMILY_X ? x0 : z0;
        for (let a = 0; a < N; a++) {
            const k = lineAt(seed, family, acrossFrom + a);
            if (k === null) continue;
            // Stretch by stretch: every edge of a stretch has the same answer.
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
 * Where you start: a promenade three cells wide (see GALLERY), from just behind you to the far edge of the chunk, where
 * it narrows into the corridor along x = 1 down its middle, which runs on a long way. Local cell (8, 8) is world cell
 * (0, 0), and you look towards −z, down it, from its left-hand aisle.
 */
function carveGallery(open, kinds, x0, z0) {
    for (let x = GALLERY.x0; x <= GALLERY.x1; x++) {
        for (let z = GALLERY.z0; z <= GALLERY.z1; z++) {
            const i = x - x0;
            const j = z - z0;
            const cell = i * N + j;
            kinds[cell] |= CELL_Z_CORRIDOR | CELL_GALLERY;
            if (x < GALLERY.x1) open[cell * 2] = 1;
            // (Its back wall shut, whatever runs on behind it: the lifts you came up in are in it.)
            open[cell * 2 + 1] = z < GALLERY.z1 ? 1 : 0;
        }
    }
}

/**
 * Everything between the corridors, walled off from them: guest rooms, or on a staff floor the maintenance passages.
 * Each piece gets a way into the corridors next to it.
 */
function fillBetween(layout, open, kinds, rooms, random, x0, z0, zone) {
    // First wall every corridor off from what isn't corridor (and from other corridors it only runs alongside).
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const corridor = kinds[cell] & CELL_CORRIDOR;
            if (i + 1 < N && !open[cell * 2] && (corridor || kinds[cell + N] & CELL_CORRIDOR)) layout.setV(i + 1, j, EDGE_WALL);
            if (j + 1 < N && !open[cell * 2 + 1] && (corridor || kinds[cell + 1] & CELL_CORRIDOR)) layout.setH(i, j + 1, EDGE_WALL);
        }
    }
    // Then the pieces in between.
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
 * Whether the edge from a room cell into the corridor cell next to it is where a corridor's doors go: in its side wall,
 * across from a cell of the corridor without a light over it (the doors and the lights take turns along a corridor).
 */
function doorPlace(kind, x, z, di, dj) {
    const along = kind & CELL_CORRIDOR;
    if (along === CELL_X_CORRIDOR) return dj !== 0 && (x & 1) === 0;
    if (along === CELL_Z_CORRIDOR || along === (CELL_Z_CORRIDOR | CELL_GALLERY)) return di !== 0 && (z & 1) === 0;
    return false;
}

/**
 * Guest rooms (or on a staff floor, store rooms and closets): the piece cut up into rooms one to three cells across.
 * They open into each other, through connecting doors (a spanning tree of them, and a loop now and then), and only one
 * or two of them into a corridor, where the corridor's doors go if they can: so most of a corridor's doors are the
 * ones that don't open, and behind the one that does, one room leads into the next.
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

    // Each room's walls: onto another room of the piece, or a corridor (where its doors go, or elsewhere along it).
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
                // (Not into where two corridors cross.)
                if ((next & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) === (CELL_X_CORRIDOR | CELL_Z_CORRIDOR)) continue;
                (doorPlace(next, x0 + ni, z0 + nj, di, dj) ? placed : other).push([i, j, di, dj]);
            } else if (member(ni, nj) && rooms[ni * N + nj] - first !== room && layout.between(i, j, di, dj) === EDGE_WALL) {
                between[room].push([i, j, di, dj, rooms[ni * N + nj] - first]);
            }
        }
    }
    // The connecting doors: out from a room at random, through a wall into a room not yet reached.
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
            // (One door between two rooms: the rest of the wall between them stays.)
            reached[next] = 1;
            layout.setBetween(i, j, di, dj, EDGE_DOOR);
            frontier.push(next);
        }
    }
    // And the way in from a corridor: one, or two into a big piece, where the corridor's doors go if it can.
    const ways = placed.length > 0 ? placed : other;
    const wanted = Math.min(ways.length, cells.length > 14 ? 2 : 1);
    for (let n = 0; n < wanted; n++) {
        const [i, j, di, dj] = ways.splice(Math.floor(random() * ways.length), 1)[0];
        layout.setBetween(i, j, di, dj, EDGE_DOOR);
    }
}

/** 0 to count − 1, in a random order (from the chunk's own stream). */
function shuffledIndices(count, random) {
    const order = Array.from({ length: count }, (_, k) => k);
    for (let k = count - 1; k > 0; k--) {
        const r = Math.floor(random() * (k + 1));
        [order[k], order[r]] = [order[r], order[k]];
    }
    return order;
}

/**
 * The maintenance passages behind a staff floor's corridors: a tight maze one cell wide (a spanning tree, with a few
 * loops), opening into the corridors round it in a few places.
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
        // Long runs, rather than a turn at every cell.
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
 * A lobby, or the ballroom: the chunk one great room, open to the rest of its hall in the chunks round it. A lobby is
 * split by a wall or two into halls and lounges, with wide ways between, and has columns on a grid that carries on
 * through the whole hall; the ballroom is left open.
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
        // A wide way through (an arch three cells across), and a doorway or two, clear of it and each other.
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
        // The side beyond the wall is a room of its own (a lounge).
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                if ((alongX ? j >= line : i >= line) && (alongX ? i >= from && i < to : j >= from && j < to)) rooms[i * N + j] = n + 1;
            }
        }
    }
    // The columns, on a grid shared by the whole hall (so they line up from chunk to chunk).
    const [ox, oz] = columnGrid(zone);
    const sameHall = (ncx, ncz) => {
        const other = zoneOf(ncx, ncz);
        return other.type === ZONE_LOBBY && other.variant === zone.variant;
    };
    placeGridPillars(layout, cx, cz, sameHall, (x, z) => mod(x - ox, COLUMN_SPACING) === 0 && mod(z - oz, COLUMN_SPACING) === 0
        && hashFloat(seed, 0x5c01, x, z) >= 0.04);
}

/** How far apart a lobby's columns are. */
export const COLUMN_SPACING = 4;
/** Half the width of a lobby's beams. */
export const BEAM_HALF = 0.045;

/**
 * Where a lobby's columns are: on the corners of the cells (x, z) with x − ox and z − oz multiples of COLUMN_SPACING.
 * Never on a line between two chunks (those are on cells ≡ 3 mod 4), so a beam along a line of columns is always a
 * chunk's own.
 * @param {import('./zones.js').Zone} zone
 * @returns {[number, number]}
 */
export function columnGrid(zone) {
    return [zone.variant % 3, (zone.variant >>> 4) % 3];
}

/**
 * The lobbies' beams, under the ceiling along every line of columns, from wall to wall: as runs [x0, z0, x1, z1] (world
 * coordinates of their ends, the ends at a wall's face). Not along a wall, nor through one. The ones along x run
 * straight on; those along z stop either side of them.
 */
function findBeams(layout, kinds, beams, x0, z0, zone) {
    const [ox, oz] = columnGrid(zone);
    const v = (i, j) => (j >= 0 && j < N ? layout.getV(i, j) : EDGE_NONE);
    const h = (i, j) => (i >= 0 && i < N ? layout.getH(i, j) : EDGE_NONE);
    // Where a wall (or its end) is at local corner (i, j), the +x+z corner of cell (i − 1, j − 1).
    const post = (i, j) => v(i, j - 1) !== EDGE_NONE || v(i, j) !== EDGE_NONE || h(i - 1, j) !== EDGE_NONE || h(i, j) !== EDGE_NONE;
    // The corners a beam along x passes through, for those along z to stop at.
    const crossed = new Uint8Array((N + 1) * (N + 1));
    for (const alongX of [true, false]) {
        for (let a = 1; a < N; a++) {
            // Line a: between local cells a − 1 and a, through the corners of cells a − 1.
            if (mod((alongX ? z0 : x0) + a - 1 - (alongX ? oz : ox), COLUMN_SPACING) !== 0) continue;
            const corner = (b) => (alongX ? b * (N + 1) + a : a * (N + 1) + b);
            const walled = (b) => (alongX ? post(b, a) : post(a, b));
            // Whether the beam can run from corner b to b + 1: nothing along the line there, and hall both sides.
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
 * The doors that don't open, in the walls the chunk's cells own (their +x and +z edges): along the sides of every
 * corridor where there's no light over it, and across its end if it stops against a wall; all round the ballroom; now
 * and then round a lobby, with a lift or two among them; and here and there down a staff corridor. `theirs` gets the
 * ones in the walls along its −x and −z borders, which the chunks before it have.
 */
function findDoors(layout, kinds, doors, theirs, seed, x0, z0, zone, zoneOf, options) {
    // What a cell on the far side of the chunk's border is (as far as its corridors and halls go).
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
    // The walls along its −x and −z borders are the chunks' before it, and so are their doors: what those put in them,
    // from what they can tell of this one (all a door goes by, as this one can tell of them), for what stands along
    // those walls here to keep clear of.
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
 * The door (if there's one) in the wall on the +x (axis 0) or +z (axis 1) side of cell (x, z), a cell of kind `here`,
 * with one of kind `there` beyond it; `hereStaff` and `thereStaff` are whether each is on a staff floor.
 * @returns {HotelDoor | null}
 */
function doorFor(seed, x, z, axis, here, there, hereStaff, thereStaff) {
    // The promenade's back wall: the lifts you came up in, and nothing else.
    if (axis === 1 && here & CELL_GALLERY && z === GALLERY.z1) {
        if ((x & 1) !== 0) return null;
        return { x, z, axis, front: -1, kind: DOOR_ELEVATOR, state: DOOR_SHUT, number: 0, variant: hashInts(seed, 0xd00d, x, z, axis) };
    }
    // Whether a door goes on the side of a cell of this kind, and what.
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
    // Not in a wall inside a hall (between its lounges).
    const hallish = CELL_HALL | CELL_BALLROOM;
    if ((here & hallish) && (here & hallish) === (there & hallish)) return null;
    const mine = wanted(here, hereStaff);
    const theirs = wanted(there, thereStaff);
    // It faces the cell whose door it is (a corridor's before a hall's): this one, on the wall's −x/−z side (front −1),
    // or the far one.
    const theirsFirst = theirs >= 0 && (mine < 0 || ((there & CELL_CORRIDOR) !== 0 && (here & CELL_CORRIDOR) === 0));
    if (!theirsFirst && mine < 0) return null;
    const kind = theirsFirst ? theirs : mine;
    const front = theirsFirst ? 1 : -1;
    const variant = hashInts(seed, 0xd00d, x, z, axis);
    return { x, z, axis, front, kind, state: doorState(kind, variant), number: roomNumber(kind, variant), variant };
}

/** How a door's been left, from its variant. */
function doorState(kind, variant) {
    if (kind === DOOR_ELEVATOR) return DOOR_SHUT;
    const roll = (variant >>> 20) & 255;
    if (kind === DOOR_STAFF) return roll < 14 ? DOOR_LIT : DOOR_SHUT;
    if (roll < 12) return DOOR_AJAR;
    if (roll < 30) return DOOR_LIT;
    if (roll < 42 && kind === DOOR_GUEST) return DOOR_SIGN;
    return DOOR_SHUT;
}

/** A room's number: never in any order. Most have three figures, a few four, and a few have lost theirs. */
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
 * The sconces: a pair of candle bulbs on a brass arm, on the walls down both sides of a corridor under each of its
 * lights, along the promenade, and here and there round a lobby and the ballroom. Each goes on and off with its light
 * slot (see sconceSlot), which has to be in the chunk, so its chunk says what it does.
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
                // (Not over a door: the end of a corridor can have one in any cell.)
                const [ex, ez, axis] = di !== 0 ? [di > 0 ? x : x - 1, z, 0] : [x, dj > 0 ? z : z - 1, 1];
                if (doors.some((door) => door.x === ex && door.z === ez && door.axis === axis)) continue;
                const [sx, sz] = sconceSlot(x, z, di, dj);
                if (sx - x0 < 0 || sx - x0 >= N || sz - z0 < 0 || sz - z0 >= N) continue;
                const roll = hashFloat(seed, 0x5c0e, x, z, bit);
                let wanted = false;
                if (kind & CELL_GALLERY) wanted = di !== 0;
                else if (kind & CELL_CORRIDOR) {
                    const run = kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR);
                    // Down both sides, but not where corridors cross; and fewer in the staff passages.
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
 * How dark Level 5 is around a point, 0 to 1: long stretches where the lights have gone, and where you start always
 * lit. (The ballroom is dark whatever this says: see hotelLights.)
 */
export function terrorHotelDarkness(seed, x, z) {
    const n = 0.62 * valueNoise(seed ^ 0x5dac, x / 30, z / 30) + 0.38 * valueNoise(seed ^ 0x5dad, x / 11, z / 11);
    let darkness = smoothstep(0.56, 0.72, n);
    const distance = Math.hypot(x, z + 4);
    if (distance < 24) darkness *= smoothstep(12, 24, distance);
    return darkness;
}

/**
 * Level 5's lights: an alabaster bowl over every other cell of a corridor (a lantern where two cross, and down the
 * promenade), a ring of candle bulbs over the lobbies (every other slot: the rest of the ceiling is dark between), a
 * crystal chandelier every few cells of the ballroom (hardly any of them lit), a bulb in the staff passages, and in the
 * guest rooms a bowl if anything. A slot with sconces on its walls is on, fitting or none (its light is theirs); one
 * over the Beverly Room's table, or the flowers in a lobby (`lit`, as local i * N + j), is always on.
 */
function hotelLights(seed, x0, z0, zone, kinds, sconces, lit, fixtures, empty) {
    if (empty) return darkLights(LAMP_WARM);
    // Which slots have sconces going on and off with them.
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
                // (Down its middle; not in front of the painting between the lifts.)
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
                // Hardly any of them lit.
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
            // (Between a lobby's chandeliers, the light off them, and off its walls, is dimmer.)
            const between = kind & CELL_HALL && fixture === FIXTURE_NONE;
            const on = fixture !== FIXTURE_NONE || powered[k] === 1 || between;
            let brightness = on ? (between && powered[k] !== 1 ? 70 : 255) : 0;
            let flicker = 0;
            const nearStart = x >= -2 && x <= 4 && z >= -12 && z <= 4;
            if ((nearStart && kind & CELL_CORRIDOR) || lit.has(i * N + j)) {
                // Every light down the promenade works, and over what's been left under one.
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
 * Each cell's bytes for Level 5's shaders (see ChunkData.cells): its look, which way its corridor runs and its sconces
 * (the first byte); where the nearest lamp is from it, if there's one near enough to light it (the second and third:
 * how far off along x and z in eighths, plus 32, or 0 for none), and in their top bits, a guest room's colours and how
 * its floor's laid (a lobby's marble, or `floors`: a dance floor).
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
    // The lamps: each cell near enough to one knows where it is (every cell any of its light reaches: a cell reaches half a
    // cell either way of its middle).
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
 * What's underfoot at (x, z), for its footsteps: carpet (0), parquet or marble (1: hard), or the staff passages'
 * linoleum (2). From the cell's bytes (see cellBytes).
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
