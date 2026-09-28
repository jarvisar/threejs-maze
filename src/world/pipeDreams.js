import { CHUNK_SIZE, HALF_CHUNK, WALL_THICKNESS } from '../config.js';
import { Layout, PANELS_PER_SIDE, connectAll, darkLights, removeBuriedPillars, smoothstep } from './generator.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_NONE, EDGE_WALL, chunkCoord } from './grid.js';
import { backroomsNoise, hash32 } from './panelLights.js';
import { furnitureBox, galleryCart, placePipeDreamsFurniture } from './pipeDreamsFurniture.js';
import { placePipeDreamsProps } from './pipeDreamsProps.js';
import { hashFloat, hashInts, mulberry32, valueNoise } from './random.js';
import { ZONE_PLANT, ZONE_STEAM, ZONE_TUNNELS, zoneAt } from './zones.js';

/*
 * Level 2, "Pipe Dreams": grey concrete service tunnels that go on for miles, every wall of them lined with pipes, hot,
 * and lit here and there by caged bulbs. Between the tunnels are store rooms and closets (most of them dark), old brick
 * passages full of steam, and plant halls where the boilers are, the only light in them when the power goes the glow
 * of their fireboxes. Some of the pipes leak: steam, and a thick black liquid.
 *
 * It's the same grid of cells as Level 0 (walls on the lines between cells, a light slot over every cell with odd
 * coordinates), so walking, editing and a tape (see footage/) work on it unchanged. The tunnels run on lines of odd
 * cells, so every one of them has a lamp over every other cell, and the lines are the same for the whole level, so a
 * tunnel carries on straight from one chunk into the next, sometimes for a long way. Which stretches of them are there
 * is up to each stretch alone, so both chunks it passes through agree on it. What's between the tunnels is up to the
 * chunk. This works out the layout, the lamps, the boilers, the leaks and the props; pipeDreamsGeometry.js builds the
 * pipes (from the walls, so they follow any you build) and everything else, and the materials (pipeDreamsMaterials.js,
 * pipeDreamsShading.js) do the concrete, the brick, the steam and the air. levels.js ties it in.
 */

const N = CHUNK_SIZE;

/** What Level 2's regions are made of (see zones.js). Where you start is always the tunnels. */
export const PIPE_DREAMS_ZONES = Object.freeze({
    weights: [
        [ZONE_TUNNELS, 50],
        [ZONE_PLANT, 22],
        [ZONE_STEAM, 28],
    ],
    start: ZONE_TUNNELS,
    salt: 0x2200,
});

// ---------------------------------------------------------------------------------------------- the tunnels

/** Tunnels running along x (on a line z = const), and along z (on a line x = const). */
export const FAMILY_X = 0;
export const FAMILY_Z = 1;
/** Lines of each family come about this far apart (4 to 12). */
const LINE_SPACING = 8;
/** The tunnel ahead of where you start runs at least this far (to z = −48, 130 m). */
const START_TUNNEL_TO = -48;

/** What's in a cell (see PipeDreamsData.kinds). */
export const CELL_X_TUNNEL = 1; // on a tunnel along x
export const CELL_Z_TUNNEL = 2; // on a tunnel along z
export const CELL_GALLERY = 4; // the wide tunnel where you start
export const CELL_ROOM = 8; // a store room or a closet
export const CELL_HALL = 16; // a plant hall
export const CELL_MAZE = 32; // the brick passages between the steam tunnels
export const CELL_MACHINE = 64; // a machine stands in it
export const CELL_TAKEN = 128; // something stands against a wall in it (see pipeDreamsFurniture.js)
export const CELL_TUNNEL = CELL_X_TUNNEL | CELL_Z_TUNNEL | CELL_GALLERY;

/**
 * Where the k-th line of a family is: z for tunnels along x, x for those along z. Always odd, so every tunnel has a
 * lamp over every other cell. (The first line along z is where the tunnel you start in runs.)
 * @param {number} seed
 * @param {number} family
 * @param {number} k
 */
export function tunnelLine(seed, family, k) {
    if (family === FAMILY_Z && k === 0) return 1;
    return LINE_SPACING * k + 1 + 2 * (hashInts(seed, 0x2d10, family, k) % 3);
}

/** The last line of a family at or before c: the k with tunnelLine(k) ≤ c < tunnelLine(k + 1). */
export function lineBefore(seed, family, c) {
    const k = Math.floor((c - 1) / LINE_SPACING);
    return tunnelLine(seed, family, k) > c ? k - 1 : k;
}

/** The line of a family at c, if there's one there: its index, or null. */
export function lineAt(seed, family, c) {
    if ((c & 1) === 0) return null;
    const k = lineBefore(seed, family, c);
    return tunnelLine(seed, family, k) === c ? k : null;
}

/**
 * Whether the n-th stretch of the k-th line of a family is there: the stretch between where the n-th and (n + 1)-th
 * lines of the other family cross it. Most lines are main tunnels, which are nearly always there; the rest come and
 * go. In the plant halls most aren't, and in the steam tunnels most are. Only the stretch's own coordinates decide it,
 * so both chunks it runs through agree.
 * @param {number} seed
 * @param {number} family
 * @param {number} k
 * @param {number} n
 * @param {(cx: number, cz: number) => import('./zones.js').Zone} zoneOf
 */
export function stretchPresent(seed, family, k, n, zoneOf) {
    const from = tunnelLine(seed, 1 - family, n);
    const to = tunnelLine(seed, 1 - family, n + 1);
    // The long tunnel ahead of where you start.
    if (family === FAMILY_Z && k === 0 && to > START_TUNNEL_TO && from < 3) return true;
    const at = tunnelLine(seed, family, k);
    const middle = (from + to) >> 1;
    const zone = family === FAMILY_X ? zoneOf(chunkCoord(middle), chunkCoord(at)) : zoneOf(chunkCoord(at), chunkCoord(middle));
    let chance = hashFloat(seed, 0x2d11, family, k) < 0.4 ? 0.92 : 0.58;
    if (zone.type === ZONE_PLANT) chance *= 0.4;
    else if (zone.type === ZONE_STEAM) chance = Math.min(1, chance + 0.2);
    return hashFloat(seed, 0x2d12, family, k, n) < chance;
}

/** Whether the edge along a line of `family` at `at`, between cells c and c + 1 along it, is open tunnel. */
function tunnelEdge(seed, family, k, c, zoneOf) {
    return stretchPresent(seed, family, k, lineBefore(seed, 1 - family, c), zoneOf);
}

/** The id of a tunnel line: what its pipes are (see faceTracks), the same all along it. */
export function lineSpace(seed, family, k) {
    return (hashInts(seed, 0x2d13, family, k) | 1) >>> 0;
}

/**
 * The wall line between chunk (cx, cz) and the one before it on an axis (as borderLine in generator.js has it, but
 * Level 2's own): wall, open where a tunnel crosses it, and never without a way through.
 */
function tunnelBorder(seed, axis, cx, cz, options, zoneOf) {
    const line = new Uint8Array(N);
    if (options.isSealed?.(axis, cx, cz)) return line.fill(EDGE_WALL);
    const beforeX = axis === 0 ? cx - 1 : cx;
    const beforeZ = axis === 0 ? cz : cz - 1;
    if (options.isVoid?.(beforeX, beforeZ) && options.isVoid?.(cx, cz)) return line;
    line.fill(EDGE_WALL);
    // Axis 0 is a border along z, crossed by the tunnels along x.
    const family = axis === 0 ? FAMILY_X : FAMILY_Z;
    const across = (axis === 0 ? cx : cz) * N - HALF_CHUNK;
    const start = (axis === 0 ? cz : cx) * N - HALF_CHUNK;
    let open = 0;
    let first = -1;
    for (let k = 0; k < N; k++) {
        const index = lineAt(seed, family, start + k);
        if (index === null) continue;
        if (first < 0) first = k;
        if (tunnelEdge(seed, family, index, across - 1, zoneOf)) {
            line[k] = EDGE_NONE;
            open++;
        }
    }
    // Never a border with no way through.
    if (open === 0) line[first >= 0 ? first : N >> 1] = EDGE_DOOR;
    return line;
}

// ---------------------------------------------------------------------------------------------- pipes

/**
 * The runs of pipe along the walls, at fixed heights, from the floor up (see faceTracks): the big ones low down, then
 * smaller ones, then nothing through the middle (where a tape's notes go, and your eyes are), then conduit just over
 * the doorways, a lagged pipe, and the big mains up in the corner by the ceiling. `r` is the pipe's radius; they stand
 * `r + TRACK_GAP` out from the wall to their middles, on brackets.
 */
export const TRACKS = Object.freeze([
    { y: 0.075, r: 0.042, low: true },
    { y: 0.2, r: 0.026, low: true },
    { y: 0.292, r: 0.016, low: true },
    { y: 0.746, r: 0.013, low: false },
    { y: 0.8, r: 0.036, low: false },
    { y: 0.895, r: 0.052, low: false },
]);
export const TRACK_GAP = 0.012;

/** How a pipe is finished (see the pipe shader in pipeDreamsShading.js). */
export const FINISH_PAINT = 0;
export const FINISH_RUST = 1;
export const FINISH_LAGGED = 2;
export const FINISH_COPPER = 3;
export const FINISH_GALVANISED = 4;
export const FINISH_IRON = 5;
export const FINISH_BRASS = 6;
export const FINISH_CLAD = 7;
export const FINISH_WOOD = 8;
export const FINISH_ENAMEL = 9;

/** What each track's pipes can be, as [finish, colour]: whichever one a wall has, it has all along it. */
const TRACK_PALETTES = [
    [[FINISH_PAINT, 0x2f4a37], [FINISH_PAINT, 0x222322], [FINISH_RUST, 0x6e3b22], [FINISH_PAINT, 0x74291e], [FINISH_IRON, 0x2b2927]],
    [[FINISH_PAINT, 0x8a8c86], [FINISH_PAINT, 0x2e4b6c], [FINISH_RUST, 0x6a3a24], [FINISH_PAINT, 0xc6bc9c], [FINISH_PAINT, 0xae8a2c]],
    [[FINISH_COPPER, 0xb56f40], [FINISH_GALVANISED, 0x9ea4a5], [FINISH_PAINT, 0xd4d4cb], [FINISH_RUST, 0x70412a]],
    [[FINISH_GALVANISED, 0x9ea4a5], [FINISH_GALVANISED, 0x8e9496], [FINISH_PAINT, 0x262626], [FINISH_RUST, 0x6a3a24]],
    [[FINISH_LAGGED, 0xd8cdb2], [FINISH_CLAD, 0xb8bcbe], [FINISH_LAGGED, 0xa9a397], [FINISH_PAINT, 0x9b9e9f], [FINISH_RUST, 0x6e3b22]],
    [[FINISH_LAGGED, 0xd6ccb2], [FINISH_LAGGED, 0xb9a887], [FINISH_RUST, 0x6b3923], [FINISH_CLAD, 0xb4b8ba], [FINISH_PAINT, 0x2a2a29]],
];

/** How likely each track is along a wall, by what the wall faces (see FACE_*). */
export const FACE_TUNNEL = 0;
export const FACE_ROOM = 1;
export const FACE_HALL = 2;
export const FACE_MAZE = 3;
const TRACK_CHANCES = [
    [0.62, 0.5, 0.42, 0.55, 0.6, 0.72],
    [0, 0, 0, 0.2, 0.12, 0.18],
    [0.72, 0.52, 0.25, 0.5, 0.45, 0.65],
    [0.3, 0.2, 0.1, 0.12, 0.2, 0.45],
];

/** @type {Map<number, Int16Array>} */
const trackCache = new Map();

/**
 * The pipes along a wall that faces into a space (a tunnel line, a room: see PipeDreamsData.spaces): for each track, its
 * palette entry (finish and colour, as index into the track's palette), or −1 where there's none. Every wall facing the
 * same space has the same, so the pipes carry on along a tunnel, round its corners and over its openings.
 * @param {number} space
 * @param {number} face What it faces (FACE_*).
 * @returns {Int16Array}
 */
export function faceTracks(space, face) {
    const key = space * 4 + face;
    let tracks = trackCache.get(key);
    if (tracks) return tracks;
    tracks = new Int16Array(TRACKS.length);
    const chances = TRACK_CHANCES[face];
    for (let k = 0; k < TRACKS.length; k++) {
        if (hashFloat(space, 0x71, k) >= chances[k]) {
            tracks[k] = -1;
            continue;
        }
        const palette = TRACK_PALETTES[k];
        let pick = hashInts(space, 0x72, k) % palette.length;
        // The brick passages have mostly rusted through.
        if (face === FACE_MAZE && hashFloat(space, 0x73, k) < 0.55) pick = palette.findIndex(([finish]) => finish === FINISH_RUST);
        tracks[k] = pick;
    }
    if (trackCache.size > 4096) trackCache.clear();
    trackCache.set(key, tracks);
    return tracks;
}

/** A track's finish and colour, from its palette entry (see faceTracks). @returns {readonly number[]} */
export function trackFinish(k, entry) {
    return TRACK_PALETTES[k][entry];
}

/**
 * What runs along under the ceiling of a tunnel, on hangers: one to four pipes (or a cable tray), each `o` across from
 * the tunnel's middle line. Along x they hang higher than along z, so where two tunnels cross, theirs pass one over
 * the other.
 * @param {number} space The tunnel line's (see lineSpace).
 * @returns {{ o: number, r: number, finish: number, color: number, tray: boolean }[]}
 */
export function ceilingBundle(space) {
    const random = mulberry32(hashInts(space, 0x74));
    const count = 2 + Math.floor(random() * 3.4);
    const bundle = [];
    const side = random() < 0.5 ? -1 : 1;
    let o = 0.12 + random() * 0.04;
    for (let n = 0; n < count && o < 0.29; n++) {
        const roll = random();
        const tray = roll < 0.16;
        const r = tray ? 0.045 : roll < 0.35 ? 0.024 : roll < 0.6 ? 0.017 : roll < 0.82 ? 0.012 : 0.008;
        // (None so far out that it, or the hangers under it, would meet the mains up by the ceiling along the walls.)
        if (o + 2 * r + (tray ? 0.003 : 0) > BUNDLE_REACH) break;
        const [finish, color] = tray ? [FINISH_GALVANISED, 0x9ea4a5]
            : r > 0.015 ? [[FINISH_LAGGED, 0xd2c7ad], [FINISH_RUST, 0x6b3923], [FINISH_PAINT, 0x9b9e9f]][Math.floor(random() * 3)]
                : [[FINISH_COPPER, 0xb56f40], [FINISH_GALVANISED, 0x9ea4a5], [FINISH_PAINT, 0x2e4b6c], [FINISH_PAINT, 0x74291e]][Math.floor(random() * 4)];
        bundle.push({ o: side * (o + r), r, finish, color, tray });
        o += 2 * r + 0.012;
        // Sometimes a second group on the other side of the lamps.
        if (n === 0 && random() < 0.35) {
            bundle.push({ o: -side * (0.14 + r), r: 0.012, finish: FINISH_GALVANISED, color: 0x8e9496, tray: false });
        }
    }
    return bundle;
}

/** How high the pipes under the ceiling hang: along x, and along z (lower, so they pass under). */
export const BUNDLE_Y = [0.972, 0.918];
/** How far across from a tunnel's middle line its pipes under the ceiling reach, at most: clear of track 5's main. */
const BUNDLE_REACH = 0.325;

/**
 * A tunnel line's concrete ledge along one wall (−1 or 1: the side, across the line), or none (0); and its drain,
 * along the other side (or the middle).
 * @param {number} space
 */
export function tunnelFloor(space) {
    const ledge = hashFloat(space, 0x75) < 0.42 ? (hashFloat(space, 0x76) < 0.5 ? -1 : 1) : 0;
    const drain = hashFloat(space, 0x77) < 0.5 ? (ledge !== 0 ? -ledge : hashFloat(space, 0x78) < 0.5 ? -1 : 1) : 0;
    return { ledge, drain };
}

/**
 * Whether the wall along an axis (0: a wall along z, 1: along x) on the `side` of it facing a cell of `kind` has the
 * ledge along its foot: a tunnel's own wall, on its line's ledge side (see tunnelFloor). `space` is what the cell is,
 * facing that wall (see PipeDreamsData.spaces).
 */
export function hasLedge(kind, space, axis, side) {
    const onLine = axis === 0 ? kind & (CELL_Z_TUNNEL | CELL_GALLERY) : kind & CELL_X_TUNNEL;
    return onLine !== 0 && tunnelFloor(space).ledge === -side;
}

// ---------------------------------------------------------------------------------------------- lamps

/** A light slot's fourth byte in Level 2 (see ChunkData.lights): the kind of bulb. */
export const LAMP_WARM = 255; // a plain incandescent bulb
export const LAMP_SODIUM = 254; // an orange sodium lamp
export const LAMP_TUBE = 253; // a fluorescent tube, colder than everything round it
export const LAMP_RED = 252; // a red one

/** What hangs in a light slot (see PipeDreamsData.fixtures). */
export const FIXTURE_NONE = 0;
export const FIXTURE_CAGE = 1; // a bulb in a wire cage on a stub of conduit
export const FIXTURE_SHADE = 2; // an enamel shade on a chain
export const FIXTURE_BULB = 3; // a bare bulb on its flex
export const FIXTURE_BATTEN = 4; // a fluorescent batten

// ---------------------------------------------------------------------------------------------- machines

export const MACHINE_BOILER = 0;
export const MACHINE_TANK = 1;
export const MACHINE_PUMP = 2;
export const MACHINE_HEADER = 3;
export const MACHINE_EXCHANGER = 4;
export const MACHINE_COMPRESSOR = 5;
export const MACHINE_AIR = 6;
export const MACHINE_FORKLIFT = 7;

/** A heat exchanger's shell, end to end (not its heads), and an air handling unit's size. */
export const EXCHANGER_LENGTH = 1.3;
export const AIR_LENGTH = 1.5;
export const AIR_WIDTH = 0.5;
/** A boiler's shell: long, wide, and how high its middle is. */
export const BOILER_LENGTH = 1.66;
export const BOILER_RADIUS = 0.29;
export const BOILER_Y = 0.36;
/** How high the fire in a firebox is, and how far its light reaches. */
export const FIRE_Y = 0.2;
export const FIRE_RANGE = 2.9;
/** How far along x or z from a fire the middle of a cell can be and any of the cell still be lit by it. */
const FIRE_REACH = FIRE_RANGE + 0.2 + 0.5;
/** How far a fire keeps from the middles of its chunk's edge cells, so its light stops before the chunk does. */
const FIRE_CLEAR = FIRE_REACH - 1;

/**
 * @typedef {object} Machine Something standing in a plant hall.
 * @property {number} type MACHINE_*.
 * @property {number} x Its middle.
 * @property {number} z
 * @property {number} dx Which way its front faces (unit, along an axis): a boiler's firebox, a pump's shaft.
 * @property {number} dz
 * @property {number} variant 32 bits for its size and details.
 */

/**
 * @typedef {object} Leak Steam coming out of something (see pipeDreamsGeometry.js, and the sound): where, which way, and
 *     how hard.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} dx Unit.
 * @property {number} dy
 * @property {number} dz
 * @property {number} strength 0.3 to 1.5: a wisp to a roaring jet.
 * @property {boolean} vent Rising from a grate in the floor (a plume, not a jet).
 * @property {number[] | null} [wall] Out of a pipe on a wall: which way the wall is from its cell, as [di, dj] (so it
 *     stops if the wall's taken down).
 */

/**
 * @typedef {object} Goo Where the black stuff drips from a pipe: a streak down the wall under it, and a puddle.
 * @property {number} x Where it drips from.
 * @property {number} y
 * @property {number} z
 * @property {number} nx The wall's normal, into the cell.
 * @property {number} nz
 * @property {number} size
 * @property {number} variant
 */

/**
 * @typedef {object} PipeDreamsData What a Level 2 chunk has that Level 0's don't.
 * @property {Uint8Array} kinds What each cell is (CELL_*), indexed `i * N + j`.
 * @property {Uint32Array} spaces Two per cell: what it is, facing a wall along x and a wall along z (a tunnel line's id,
 *     or its room's), which decides the pipes on the wall (see faceTracks).
 * @property {Uint8Array} fixtures What hangs in each light slot (FIXTURE_*), indexed like the lights.
 * @property {Machine[]} machines (What of them is solid is in the chunk's `solids`.)
 * @property {import('./pipeDreamsFurniture.js').Piece[]} furniture What stands against the walls (solid too).
 * @property {Leak[]} leaks
 * @property {Goo[]} goo
 */

// ---------------------------------------------------------------------------------------------- cells

/** A cell's first byte (see ChunkData.cells): the look of its walls and floor, its drain, a vent and how steamy it is. */
export const LOOK_CONCRETE = 0;
export const LOOK_BRICK = 1;
export const LOOK_BLOCK = 2;
export const CELL_DRAIN_X = 4; // a drain along x (on the side CELL_DRAIN_SIDE says)
export const CELL_DRAIN_Z = 8;
export const CELL_DRAIN_SIDE = 16; // on the +z (or +x) side
export const CELL_VENT = 32; // a grate in the middle of the floor, with steam coming up
export const STEAM_SHIFT = 6; // how steamy: 0 to 3, in the top two bits

// ---------------------------------------------------------------------------------------------- generating

/**
 * How the endless level is generated for Level 2 (see generator.js's WorldOptions).
 * @param {number} seed
 * @returns {import('./generator.js').WorldOptions}
 */
export function pipeDreamsOptions(seed) {
    return { level: 3, zoneAt: (cx, cz) => pipeDreamsZoneAt(seed, cx, cz) };
}

/**
 * The kind of space a chunk of Level 2 is.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 */
export function pipeDreamsZoneAt(seed, cx, cz) {
    return zoneAt(seed, cx, cz, PIPE_DREAMS_ZONES);
}

/**
 * Generates one chunk of Level 2. Like Level 0 (see generator.js), chunks are independent and share only the wall lines
 * on their borders, and a game mode's options (a tape's walls, see footage/arena.js) work the same.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {import('./generator.js').WorldOptions} options
 * @returns {import('./generator.js').ChunkData}
 */
export function generatePipeDreamsChunk(seed, cx, cz, options) {
    const zoneOf = (x, z) => options.zoneAt?.(x, z) ?? pipeDreamsZoneAt(seed, x, z);
    const zone = zoneOf(cx, cz);
    const random = mulberry32(hashInts(seed, 0x2d30, cx, cz));
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const empty = options.isVoid?.(cx, cz) === true;

    const layout = new Layout();
    const west = tunnelBorder(seed, 0, cx, cz, options, zoneOf);
    const east = tunnelBorder(seed, 0, cx + 1, cz, options, zoneOf);
    const south = tunnelBorder(seed, 1, cx, cz, options, zoneOf);
    const north = tunnelBorder(seed, 1, cx, cz + 1, options, zoneOf);
    for (let k = 0; k < N; k++) {
        layout.setV(0, k, west[k]);
        layout.setV(N, k, east[k]);
        layout.setH(k, 0, south[k]);
        layout.setH(k, N, north[k]);
    }

    const kinds = new Uint8Array(N * N);
    const spaces = new Uint32Array(N * N * 2);
    /** @type {Machine[]} */
    const machines = [];
    /** @type {number[][]} */
    const solids = [];
    if (!empty) {
        // Which edges inside the chunk run along a tunnel: open (the rest round a tunnel are walled).
        const open = new Uint8Array(2 * N * N);
        carveTunnels(open, kinds, spaces, seed, x0, z0, zoneOf);
        if (cx === 0 && cz === 0) carveGallery(open, kinds, spaces, seed);
        fillBetween(layout, open, kinds, spaces, random, seed, cx, cz, zone.type);
    }
    removeBuriedPillars(layout);
    connectAll(layout, random);
    if (!empty && zone.type === ZONE_PLANT) placeMachines(layout, kinds, random, x0, z0, machines, solids);

    const edgeBetween = (i, j, di, dj) => layout.between(i, j, di, dj);
    // Nothing where you start (on a tape, nothing in the room-sized space you start in either).
    const avoid = (x, z) => Math.abs(x) <= 3 && z >= -4 && z <= 3;
    const furniture = empty ? [] : placePipeDreamsFurniture(random, edgeBetween, kinds, x0, z0, zone.type, avoid, solids);
    if (!empty && cx === 0 && cz === 0) {
        // A truck parked down the side of the gallery, a few steps ahead of where you start (not across a door).
        const cart = [-7, -6, -8, -5].map((z) => galleryCart(hashInts(seed, 0x2d31), z)).find((piece) => layout.between(9, piece.z + HALF_CHUNK, 1, 0) === EDGE_WALL);
        if (cart) {
            furniture.push(cart);
            solids.push(furnitureBox(cart));
            kinds[(Math.round(cart.x) - x0) * N + cart.z - z0] |= CELL_TAKEN;
        }
    }
    if (!empty && zone.type === ZONE_PLANT) standColumns(layout, kinds, x0, z0);
    const props = empty ? [] : placePipeDreamsProps(random, edgeBetween, kinds, x0, z0, zone.type, avoid);
    for (let i = 0; i < props.length; i++) props[i].index = i;

    const { edgesX, edgesZ, pillars } = layout.cellData();
    const fixtures = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE);
    const lights = pipeDreamsLights(seed, x0, z0, zone.type, kinds, fixtures, empty);
    /** @type {Leak[]} */
    const leaks = [];
    /** @type {Goo[]} */
    const goo = [];
    if (!empty) findLeaks(random, seed, layout, kinds, spaces, machines, x0, z0, zone.type, leaks, goo, avoid);
    // A few steps ahead of where you start, the rusted main down the middle of the gallery is blowing steam (see
    // galleryRack in pipeDreamsGeometry.js).
    if (!empty && cx === 0 && cz === 0) leaks.push({ x: -0.2, y: 0.82, z: -5.6, dx: 0.45, dy: -0.8, dz: 0.4, strength: 1.2, vent: false });
    const cells = cellBytes(kinds, spaces, machines, leaks, x0, z0, zone.type, empty);
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
        pipeDreams: { kinds, spaces, fixtures, machines, furniture, leaks, goo },
    };
}

/**
 * The tunnels: every stretch of a line through the chunk that's there. `open` gets the edges along them: the +x edge
 * of local cell (i, j) at 2 (i N + j), its +z edge at the next.
 */
function carveTunnels(open, kinds, spaces, seed, x0, z0, zoneOf) {
    for (const family of [FAMILY_X, FAMILY_Z]) {
        // Across the chunk (j for tunnels along x), and along it.
        const acrossFrom = family === FAMILY_X ? z0 : x0;
        const alongFrom = family === FAMILY_X ? x0 : z0;
        for (let a = 0; a < N; a++) {
            const k = lineAt(seed, family, acrossFrom + a);
            if (k === null) continue;
            const id = lineSpace(seed, family, k);
            // Stretch by stretch: cache the last one's answer, since every edge of a stretch has it.
            let stretch = null;
            let present = false;
            for (let b = -1; b < N; b++) {
                const c = alongFrom + b;
                const n = lineBefore(seed, 1 - family, c);
                if (n !== stretch) {
                    stretch = n;
                    present = stretchPresent(seed, family, k, n, zoneOf);
                }
                if (!present) continue;
                for (const s of [b, b + 1]) {
                    if (s < 0 || s >= N) continue;
                    const cell = family === FAMILY_X ? s * N + a : a * N + s;
                    kinds[cell] |= family === FAMILY_X ? CELL_X_TUNNEL : CELL_Z_TUNNEL;
                    spaces[cell * 2 + family] = id;
                }
                if (b < 0 || b + 1 >= N) continue;
                if (family === FAMILY_X) open[(b * N + a) * 2] = 1;
                else open[(a * N + b) * 2 + 1] = 1;
            }
        }
    }
    // A cell on one tunnel faces its end walls with that tunnel's pipes too.
    for (let cell = 0; cell < N * N; cell++) {
        if ((kinds[cell] & CELL_TUNNEL) === CELL_X_TUNNEL) spaces[cell * 2 + 1] = spaces[cell * 2];
        else if ((kinds[cell] & CELL_TUNNEL) === CELL_Z_TUNNEL) spaces[cell * 2] = spaces[cell * 2 + 1];
    }
}

/**
 * Where you start: a wide tunnel, three cells across, from just behind you to the far edge of the chunk, where it
 * narrows into the tunnel along x = 1, which runs on a long way. Local cell (8, 8) is world cell (0, 0), and you look
 * towards −z.
 */
function carveGallery(open, kinds, spaces, seed) {
    const id = lineSpace(seed, FAMILY_Z, 0);
    const [i0, i1, j0, j1] = [7, 9, 0, 10];
    for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
            const cell = i * N + j;
            kinds[cell] |= CELL_Z_TUNNEL | CELL_GALLERY;
            spaces[cell * 2 + 1] = id;
            if (!(kinds[cell] & CELL_X_TUNNEL)) spaces[cell * 2] = id;
            if (i < i1) open[cell * 2] = 1;
            if (j < j1) open[cell * 2 + 1] = 1;
        }
    }
}

/**
 * Everything between the tunnels, walled off from them: store rooms and closets, the brick maze of the steam tunnels,
 * or plant halls, depending on the chunk. Each piece gets a way into the tunnels next to it.
 */
function fillBetween(layout, open, kinds, spaces, random, seed, cx, cz, zone) {
    // First wall every tunnel off from what isn't tunnel (and from other tunnels it only touches).
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const tunnel = kinds[cell] & CELL_TUNNEL;
            if (i + 1 < N && !open[cell * 2] && (tunnel || kinds[cell + N] & CELL_TUNNEL)) layout.setV(i + 1, j, EDGE_WALL);
            if (j + 1 < N && !open[cell * 2 + 1] && (tunnel || kinds[cell + 1] & CELL_TUNNEL)) layout.setH(i, j + 1, EDGE_WALL);
        }
    }
    // Then the pieces in between.
    const piece = new Int32Array(N * N).fill(-1);
    let count = 0;
    for (let start = 0; start < N * N; start++) {
        if (kinds[start] & CELL_TUNNEL || piece[start] >= 0) continue;
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
                if (piece[next] >= 0 || kinds[next] & CELL_TUNNEL) continue;
                piece[next] = count;
                cells.push(next);
            }
        }
        const id = count++;
        const space = (n) => (hashInts(seed, 0x2d60, cx, cz, id, n) | 1) >>> 0;
        if (zone === ZONE_PLANT && cells.length >= 6) plantHall(layout, kinds, spaces, random, cells, space(0));
        else if (zone === ZONE_STEAM && cells.length >= 4) brickMaze(layout, kinds, spaces, random, cells, space(0));
        else storeRooms(layout, kinds, spaces, random, cells, piece, id, space);
    }
}

/** Store rooms and closets: the piece cut up into small rooms, each with a door into a tunnel beside it if it can. */
function storeRooms(layout, kinds, spaces, random, cells, piece, id, space) {
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
    const maxRoom = 3 + Math.floor(random() * 3);
    let rooms = 0;
    const leaf = (a0, b0, a1, b1) => {
        const room = space(1 + rooms++);
        const doors = [];
        for (let i = a0; i < a1; i++) {
            for (let j = b0; j < b1; j++) {
                if (!member(i, j)) continue;
                const cell = i * N + j;
                kinds[cell] |= CELL_ROOM;
                spaces[cell * 2] = room;
                spaces[cell * 2 + 1] = room;
                for (const [di, dj] of DIRECTIONS) {
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni >= 0 && nj >= 0 && ni < N && nj < N && kinds[ni * N + nj] & CELL_TUNNEL) doors.push([i, j, di, dj]);
                }
            }
        }
        const wanted = doors.length > 0 ? 1 + (random() < 0.3 ? 1 : 0) : 0;
        for (let n = 0; n < wanted && doors.length > 0; n++) {
            const [i, j, di, dj] = doors.splice(Math.floor(random() * doors.length), 1)[0];
            layout.setBetween(i, j, di, dj, EDGE_DOOR);
        }
    };
    const split = (a0, b0, a1, b1) => {
        const w = a1 - a0;
        const h = b1 - b0;
        const canX = w >= 4;
        const canZ = h >= 4;
        if ((!canX && !canZ) || (w <= maxRoom && h <= maxRoom && random() < 0.75)) {
            leaf(a0, b0, a1, b1);
            return;
        }
        const alongX = canX && (!canZ || random() < w / (w + h));
        if (alongX) {
            const cut = a0 + 2 + Math.floor(random() * (w - 3));
            for (let j = b0; j < b1; j++) if (member(cut - 1, j) && member(cut, j)) layout.setV(cut, j, EDGE_WALL);
            split(a0, b0, cut, b1);
            split(cut, b0, a1, b1);
        } else {
            const cut = b0 + 2 + Math.floor(random() * (h - 3));
            for (let i = a0; i < a1; i++) if (member(i, cut - 1) && member(i, cut)) layout.setH(i, cut, EDGE_WALL);
            split(a0, b0, a1, cut);
            split(a0, cut, a1, b1);
        }
    };
    split(i0, j0, i1, j1);
}

/**
 * The passages between the steam tunnels: a tight maze of brick, one cell wide (a spanning tree, with a few loops),
 * opening into the tunnels round it in a few places.
 */
function brickMaze(layout, kinds, spaces, random, cells, space) {
    const inside = new Uint8Array(N * N);
    for (const cell of cells) inside[cell] = 1;
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        kinds[cell] |= CELL_MAZE;
        spaces[cell * 2] = space;
        spaces[cell * 2 + 1] = space;
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
        const d = options.includes(last) && random() < 0.45 ? last : options[Math.floor(random() * options.length)];
        const [di, dj] = DIRECTIONS[d];
        layout.setBetween(i, j, di, dj, EDGE_NONE);
        const next = (i + di) * N + j + dj;
        visited[next] = 1;
        stack.push(next);
        last = d;
    }
    // A few loops, and ways out into the tunnels.
    const ways = [];
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        for (const [di, dj] of DIRECTIONS) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
            if (inside[ni * N + nj] && layout.between(i, j, di, dj) === EDGE_WALL && random() < 0.05) layout.setBetween(i, j, di, dj, EDGE_NONE);
            else if (kinds[ni * N + nj] & CELL_TUNNEL) ways.push([i, j, di, dj]);
        }
    }
    const wanted = Math.min(ways.length, 1 + Math.floor(cells.length / 10));
    for (let n = 0; n < wanted; n++) {
        const [i, j, di, dj] = ways.splice(Math.floor(random() * ways.length), 1)[0];
        layout.setBetween(i, j, di, dj, random() < 0.5 ? EDGE_NONE : EDGE_DOOR);
    }
}

/** A plant hall: the whole piece open, split once if it's huge, with wide ways into the tunnels round it. */
function plantHall(layout, kinds, spaces, random, cells, space) {
    let i0 = N;
    let j0 = N;
    let i1 = 0;
    let j1 = 0;
    for (const cell of cells) {
        kinds[cell] |= CELL_HALL;
        spaces[cell * 2] = space;
        spaces[cell * 2 + 1] = space;
        const i = Math.floor(cell / N);
        const j = cell % N;
        i0 = Math.min(i0, i);
        j0 = Math.min(j0, j);
        i1 = Math.max(i1, i + 1);
        j1 = Math.max(j1, j + 1);
    }
    const inside = new Uint8Array(N * N);
    for (const cell of cells) inside[cell] = 1;
    if (cells.length > 110) {
        // A wall across the middle, with a few doorways and a wide opening.
        const alongX = i1 - i0 < j1 - j0;
        const cut = alongX ? j0 + Math.floor((j1 - j0) / 2) : i0 + Math.floor((i1 - i0) / 2);
        const across = [];
        for (let s = alongX ? i0 : j0; s < (alongX ? i1 : j1); s++) {
            const [a, b] = alongX ? [s * N + cut - 1, s * N + cut] : [(cut - 1) * N + s, cut * N + s];
            if (!inside[a] || !inside[b]) continue;
            across.push(s);
            if (alongX) layout.setH(s, cut, EDGE_WALL);
            else layout.setV(cut, s, EDGE_WALL);
        }
        for (let n = 0; n < 3 && across.length > 0; n++) {
            const s = across.splice(Math.floor(random() * across.length), 1)[0];
            const type = n === 0 ? EDGE_NONE : EDGE_DOOR;
            if (alongX) layout.setH(s, cut, type);
            else layout.setV(cut, s, type);
        }
    }
    const ways = [];
    for (const cell of cells) {
        const i = Math.floor(cell / N);
        const j = cell % N;
        for (const [di, dj] of DIRECTIONS) {
            const ni = i + di;
            const nj = j + dj;
            if (ni >= 0 && nj >= 0 && ni < N && nj < N && kinds[ni * N + nj] & CELL_TUNNEL) ways.push([i, j, di, dj]);
        }
    }
    const wanted = Math.min(ways.length, 2 + Math.floor(ways.length / 10));
    for (let n = 0; n < wanted; n++) {
        const [i, j, di, dj] = ways.splice(Math.floor(random() * ways.length), 1)[0];
        const wide = random() < 0.45;
        layout.setBetween(i, j, di, dj, wide ? EDGE_NONE : EDGE_DOOR);
        if (!wide) continue;
        // And the next one along, for a way two cells wide.
        const ai = i + (di === 0 ? 1 : 0);
        const aj = j + (dj === 0 ? 1 : 0);
        if (ai < N && aj < N && inside[ai * N + aj] && ai + di >= 0 && aj + dj >= 0 && ai + di < N && aj + dj < N && kinds[(ai + di) * N + aj + dj] & CELL_TUNNEL) {
            layout.setBetween(ai, aj, di, dj, EDGE_NONE);
        }
    }
}

/**
 * The boilers, tanks, pumps and valve headers in a plant hall: each on cells with nothing walled round them (so a
 * note's never behind one, and there's always a way round), and never next to another.
 */
function placeMachines(layout, kinds, random, x0, z0, machines, solids) {
    const clear = (i, j) => {
        if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) return false;
        const cell = i * N + j;
        if (!(kinds[cell] & CELL_HALL) || kinds[cell] & CELL_MACHINE) return false;
        for (const [di, dj] of DIRECTIONS) {
            if (layout.between(i, j, di, dj) !== EDGE_NONE) return false;
            if (!(kinds[(i + di) * N + j + dj] & CELL_HALL)) return false;
        }
        // Nothing standing round it either.
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (kinds[(i + di) * N + j + dj] & CELL_MACHINE) return false;
        return true;
    };
    let room = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (clear(i, j)) room++;
    const take = (i, j) => {
        kinds[i * N + j] |= CELL_MACHINE;
    };
    const variant = () => (random() * 4294967296) >>> 0;
    const tryPlace = (type, cells, attempts) => {
        for (let attempt = 0; attempt < attempts; attempt++) {
            const i = 1 + Math.floor(random() * (N - 2));
            const j = 1 + Math.floor(random() * (N - 2));
            const alongX = random() < 0.5;
            const [di, dj] = alongX ? [1, 0] : [0, 1];
            if (!clear(i, j) || (cells === 2 && !clear(i + di, j + dj))) continue;
            // It faces one way along its length (or across, for a pump).
            const sign = random() < 0.5 ? -1 : 1;
            const x = x0 + i + (cells === 2 ? di * 0.5 : 0);
            const z = z0 + j + (cells === 2 ? dj * 0.5 : 0);
            const machine = { type, x, z, dx: alongX ? sign : 0, dz: alongX ? 0 : sign, variant: variant() };
            if (type === MACHINE_BOILER) {
                // Room in front of the firebox to stand.
                const fi = i + (sign > 0 ? 2 * di : -di);
                const fj = j + (sign > 0 ? 2 * dj : -dj);
                if (fi < 0 || fj < 0 || fi >= N || fj >= N || !(kinds[fi * N + fj] & CELL_HALL) || kinds[fi * N + fj] & CELL_MACHINE) continue;
                // And its fire's light all inside the chunk: only the chunk's own cells know where it is (see cellBytes).
                const [fx, fz] = firePlace(machine);
                if (Math.min(fx - x0, fz - z0, x0 + N - 1 - fx, z0 + N - 1 - fz) < FIRE_CLEAR) continue;
            }
            machines.push(machine);
            solids.push(machineBox(machine));
            take(i, j);
            if (cells === 2) take(i + di, j + dj);
            return true;
        }
        return false;
    };
    const boilers = room >= 30 ? 2 : room >= 10 ? 1 : 0;
    for (let n = 0; n < boilers; n++) tryPlace(MACHINE_BOILER, 2, 30);
    const headers = room >= 24 && random() < 0.7 ? 1 : 0;
    for (let n = 0; n < headers; n++) tryPlace(MACHINE_HEADER, 2, 20);
    const tanks = Math.min(4, Math.floor(room / 9) + (random() < 0.5 ? 1 : 0));
    for (let n = 0; n < tanks; n++) tryPlace(MACHINE_TANK, 1, 20);
    const pumps = Math.min(3, Math.floor(room / 12) + (random() < 0.4 ? 1 : 0));
    for (let n = 0; n < pumps; n++) tryPlace(MACHINE_PUMP, 1, 20);
    // (After the rest, so the halls' boilers, tanks and pumps stayed where they were.)
    if (room >= 20 && random() < 0.6) tryPlace(MACHINE_EXCHANGER, 2, 20);
    if (room >= 12 && random() < 0.55) tryPlace(MACHINE_COMPRESSOR, 1, 20);
    if (room >= 26 && random() < 0.55) tryPlace(MACHINE_AIR, 2, 20);
    if (room >= 16 && random() < 0.4) tryPlace(MACHINE_FORKLIFT, 1, 20);
}

/**
 * The columns holding up the plant halls' roofs: on a grid every four cells, wherever the four cells round a corner of
 * it are all open hall with nothing standing in them (see columns in pipeDreamsDressing.js, which builds them).
 */
function standColumns(layout, kinds, x0, z0) {
    const on = (v) => ((v % COLUMN_SPACING) + COLUMN_SPACING) % COLUMN_SPACING === 0;
    for (let i = 1; i < N; i++) {
        for (let j = 1; j < N; j++) {
            if (!on(x0 + i) || !on(z0 + j)) continue;
            const cells = [(i - 1) * N + j - 1, i * N + j - 1, (i - 1) * N + j, i * N + j];
            if (cells.some((cell) => !(kinds[cell] & CELL_HALL) || kinds[cell] & CELL_MACHINE)) continue;
            if (layout.getV(i, j - 1) || layout.getV(i, j) || layout.getH(i - 1, j) || layout.getH(i, j)) continue;
            layout.setPillar(i, j, true);
        }
    }
}

/** How far apart the plant halls' columns are. */
const COLUMN_SPACING = 4;

/** What of a machine is solid, as [minX, minZ, maxX, maxZ], inside its cells. @param {Machine} machine */
export function machineBox(machine) {
    const { type, x, z, dx } = machine;
    const alongX = dx !== 0;
    let [along, across] = [0.2, 0.2];
    if (type === MACHINE_BOILER) [along, across] = [BOILER_LENGTH / 2 + 0.06, BOILER_RADIUS + 0.06];
    else if (type === MACHINE_HEADER) [along, across] = [0.88, 0.14];
    else if (type === MACHINE_TANK) [along, across] = [tankRadius(machine) + 0.04, tankRadius(machine) + 0.04];
    else if (type === MACHINE_EXCHANGER) [along, across] = [EXCHANGER_LENGTH / 2 + 0.2, 0.3];
    else if (type === MACHINE_COMPRESSOR) [along, across] = [0.4, 0.17];
    else if (type === MACHINE_AIR) [along, across] = [AIR_LENGTH / 2 + 0.03, AIR_WIDTH / 2 + 0.04];
    else if (type === MACHINE_FORKLIFT) [along, across] = [0.35, 0.17];
    else [along, across] = [0.3, 0.16];
    const hx = alongX ? along : across;
    const hz = alongX ? across : along;
    return [x - hx, z - hz, x + hx, z + hz];
}

/** Where a boiler's fire is (in the middle of its firebox door), as [x, z]. @param {Machine} machine */
export function firePlace(machine) {
    const out = BOILER_LENGTH / 2 + 0.03;
    return [machine.x + machine.dx * out, machine.z + machine.dz * out];
}

/**
 * A fire's own flicker (see pipeFire in pipeDreamsShading.js), 0..1, from where it is: the same as the shaders work it
 * out from the cells round it (pipeFirePhase), so its light, its glow and what's seen through the door flicker together.
 */
export function firePhase(x, z) {
    const ix = Math.round(x * 16);
    const iz = Math.round(z * 16);
    return (hash32((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) >>> 0) & 255) / 255;
}

/** A tank's radius (see pipeDreamsGeometry.js). @param {Machine} machine */
export function tankRadius(machine) {
    return 0.17 + 0.07 * ((machine.variant & 255) / 255);
}

// ---------------------------------------------------------------------------------------------- lights

/**
 * How dark Level 2 is around a point, 0 to 1: bigger dead stretches than Level 0's, and where you start always lit.
 */
export function pipeDreamsDarkness(seed, x, z) {
    const n = 0.6 * valueNoise(seed ^ 0x2dac, x / 28, z / 28) + 0.4 * valueNoise(seed ^ 0x2dad, x / 10, z / 10);
    let darkness = smoothstep(0.5, 0.68, n);
    const distance = Math.hypot(x, z);
    if (distance < 22) darkness *= smoothstep(10, 22, distance);
    return darkness;
}

/**
 * Level 2's lamps: a caged bulb over every other cell of every tunnel, a shade in the plant halls, a bare bulb (or
 * nothing) in the store rooms. Plenty of them are dead, most in the steam tunnels and the dark stretches, and some of
 * those left burn red.
 */
function pipeDreamsLights(seed, x0, z0, zone, kinds, fixtures, empty) {
    if (empty) return darkLights(LAMP_WARM);
    const lights = new Uint8Array(PANELS_PER_SIDE * PANELS_PER_SIDE * 4);
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const i = pi * 2 + 1;
            const j = pj * 2 + 1;
            const x = x0 + i;
            const z = z0 + j;
            const k = pi * PANELS_PER_SIDE + pj;
            const kind = kinds[i * N + j];
            const darkness = pipeDreamsDarkness(seed, x, z);
            const roll = (salt) => hashFloat(seed, salt, x, z);
            let fixture = FIXTURE_CAGE;
            let dead = 0.2 + 0.8 * darkness;
            let area = 0.5;
            let tube = LAMP_WARM;
            if (kind & CELL_TUNNEL) {
                if (zone === ZONE_STEAM) {
                    dead = 0.38 + 0.62 * darkness;
                    area = 0.36;
                    if (roll(0x211e) < 0.22) tube = LAMP_RED;
                } else if (roll(0x211e) < 0.05) tube = LAMP_TUBE;
                else if (roll(0x211e) > 0.97) tube = LAMP_SODIUM;
                if (tube === LAMP_TUBE) fixture = FIXTURE_BATTEN;
            } else if (kind & CELL_HALL) {
                fixture = FIXTURE_SHADE;
                dead = 0.08 + 0.7 * darkness;
                area = 0.55;
                const t = roll(0x211e);
                tube = t < 0.55 ? LAMP_SODIUM : t < 0.68 ? LAMP_TUBE : LAMP_WARM;
                if (tube === LAMP_TUBE) fixture = FIXTURE_BATTEN;
            } else if (kind & CELL_MAZE) {
                // Only here and there, down the passages.
                fixture = roll(0x211f) < 0.45 ? FIXTURE_CAGE : FIXTURE_NONE;
                dead = 0.4 + 0.6 * darkness;
                area = 0.3;
                if (roll(0x211e) < 0.3) tube = LAMP_RED;
            } else {
                // A store room: a bare bulb, if anyone ever put one in.
                fixture = roll(0x211f) < 0.62 ? FIXTURE_BULB : FIXTURE_NONE;
                dead = 0.4 + 0.6 * darkness;
                area = 0.35;
            }
            let brightness = fixture === FIXTURE_NONE ? 0 : 255;
            let flicker = 0;
            const nearStart = Math.abs(x) < 8 && z > -12 && z < 6;
            if (nearStart && kind & CELL_TUNNEL) {
                tube = LAMP_WARM;
                fixture = FIXTURE_CAGE;
            } else if (brightness > 0) {
                if (roll(0x2119) < dead) {
                    brightness = 0;
                } else {
                    if (roll(0x211a) < 0.14) brightness = 130 + Math.floor(roll(0x211b) * 90);
                    if (roll(0x211c) < 0.06 + 1.3 * darkness * (1 - darkness) + (zone === ZONE_STEAM ? 0.08 : 0)) flicker = 1 + (hashInts(seed, 0x211d, x, z) % 255);
                }
            }
            fixtures[k] = fixture;
            lights[k * 4] = brightness;
            lights[k * 4 + 1] = Math.round(255 * area * (1 - 0.88 * darkness));
            lights[k * 4 + 2] = flicker;
            lights[k * 4 + 3] = tube;
        }
    }
    return lights;
}

// ---------------------------------------------------------------------------------------------- leaks

/**
 * Where the pipes leak: steam from the pipes under the ceiling and along the walls (a lot more of it in the steam
 * tunnels), plumes up through the grates in their floors, a boiler's safety valve; and the black stuff dripping from
 * the pipes low on the walls.
 */
function findLeaks(random, seed, layout, kinds, spaces, machines, x0, z0, zone, leaks, goo, avoid) {
    const steamChance = zone === ZONE_STEAM ? 0.13 : zone === ZONE_PLANT ? 0.05 : 0.035;
    const gooChance = zone === ZONE_STEAM ? 0.05 : 0.025;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const kind = kinds[cell];
            const x = x0 + i;
            const z = z0 + j;
            if (!(kind & (CELL_TUNNEL | CELL_MAZE)) || avoid(x, z)) continue;
            // (Nothing out of the wall behind something standing against it, nor running down it.)
            const taken = (kind & CELL_TAKEN) !== 0;
            const walls = DIRECTIONS.filter(([di, dj]) => layout.between(i, j, di, dj) === EDGE_WALL);
            if (random() < steamChance) {
                const alongX = (kind & CELL_X_TUNNEL) !== 0;
                // (Only a tunnel on a line has pipes under its ceiling: not the start gallery off its line, which has its
                // own rack.)
                const bundled = alongX || lineAt(seed, FAMILY_Z, x) !== null;
                if (kind & (CELL_X_TUNNEL | CELL_Z_TUNNEL) && bundled && random() < 0.6) {
                    // Out of a pipe under the ceiling.
                    const bundle = ceilingBundle(spaces[cell * 2 + (alongX ? 0 : 1)]);
                    const pipe = bundle[Math.floor(random() * bundle.length)];
                    if (!pipe.tray) {
                        // (Not near the end of the cell, where the pipe might be blanked off short of a wall: see
                        // bundleEnd in pipeDreamsGeometry.js.)
                        const along = (random() - 0.5) * 0.6;
                        const y = BUNDLE_Y[alongX ? 0 : 1] - pipe.r;
                        const out = pipe.o > 0 ? 1 : -1;
                        const [dx, dy, dz] = normalize(alongX ? [(random() - 0.5) * 0.8, -0.8, out * 0.5] : [out * 0.5, -0.8, (random() - 0.5) * 0.8]);
                        leaks.push({ x: x + (alongX ? along : pipe.o), y, z: z + (alongX ? pipe.o : along), dx, dy, dz, strength: 0.5 + random() * 0.8, vent: false });
                    }
                } else if (walls.length > 0 && !taken) {
                    // Out of a pipe on the wall.
                    const [di, dj] = walls[Math.floor(random() * walls.length)];
                    const tracks = faceTracks(spaces[cell * 2 + (di === 0 ? 0 : 1)], faceOf(kind));
                    const high = [3, 4, 5].filter((k) => tracks[k] >= 0);
                    if (high.length > 0) {
                        const k = high[Math.floor(random() * high.length)];
                        const out = wallPipeOut(k);
                        const along = (random() - 0.5) * 0.7;
                        const [dx, dy, dz] = normalize([-di + (di === 0 ? (random() - 0.5) * 0.6 : 0), -0.25 - random() * 0.4, -dj + (dj === 0 ? (random() - 0.5) * 0.6 : 0)]);
                        leaks.push({ x: x + di * out + (di === 0 ? along : 0), y: TRACKS[k].y, z: z + dj * out + (dj === 0 ? along : 0), dx, dy, dz, strength: 0.4 + random() * 0.9, vent: false, wall: [di, dj] });
                    }
                }
            }
            if (zone === ZONE_STEAM && random() < 0.06) {
                leaks.push({ x, y: 0.005, z, dx: 0, dy: 1, dz: 0, strength: 0.8 + random() * 0.6, vent: true });
            }
            if (walls.length > 0 && random() < gooChance && !taken) {
                // Out of one of the pipes up high, so it runs all the way down the wall.
                const [di, dj] = walls[Math.floor(random() * walls.length)];
                const tracks = faceTracks(spaces[cell * 2 + (di === 0 ? 0 : 1)], faceOf(kind));
                const high = [3, 4, 5].filter((k) => tracks[k] >= 0);
                if (high.length > 0) {
                    const k = high[Math.floor(random() * high.length)];
                    const out = wallPipeOut(k);
                    const along = (random() - 0.5) * 0.6;
                    const drip = {
                        x: x + di * out + (di === 0 ? along : 0),
                        y: TRACKS[k].y - TRACKS[k].r,
                        z: z + dj * out + (dj === 0 ? along : 0),
                        nx: -di,
                        nz: -dj,
                        size: 0.6 + random() * 0.6,
                        variant: (random() * 4294967296) >>> 0,
                    };
                    // (Not over a ledge along the foot of the wall, which would catch it.)
                    if (!hasLedge(kind, spaces[cell * 2 + (di === 0 ? 0 : 1)], di === 0 ? 1 : 0, -(di + dj))) goo.push(drip);
                }
            }
        }
    }
    for (const machine of machines) {
        if (machine.type !== MACHINE_BOILER) continue;
        // The safety valve on top lifts now and then.
        leaks.push({ x: machine.x - machine.dx * 0.35, y: BOILER_Y + BOILER_RADIUS + 0.14, z: machine.z - machine.dz * 0.35, dx: 0, dy: 1, dz: 0, strength: 0.9, vent: true });
    }
}

/** How far from the middle of its cell a wall's track-k pipe is (see trackOut in pipeDreamsGeometry.js). */
function wallPipeOut(k) {
    return 0.5 - WALL_THICKNESS / 2 - TRACKS[k].r - TRACK_GAP;
}

/**
 * How much water is standing on the floor at (x, z), 0..1: the same as the floor's shader works it out (pipeWater in
 * pipeDreamsShading.js), so a footstep splashes where you can see water. `steam` is how steamy the cell is (0..1).
 */
export function pipeDreamsWetness(x, z, steam) {
    const n = backroomsNoise(x * 0.27 + 3.3, z * 0.27 + 8.1) * 0.6 + backroomsNoise(x * 0.8 + 9.4, z * 0.8 + 2.2) * 0.3 + backroomsNoise(x * 2.4, z * 2.4) * 0.1;
    return smoothstep(0.6 - 0.1 * steam, 0.72 - 0.1 * steam, n);
}

/**
 * What's underfoot at (x, z), from the cell's first byte (see cellBytes): whether it's the steel grating over a drain,
 * how wet it is, and how steamy it is there (0..1).
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} x
 * @param {number} z
 */
export function pipeDreamsFloorAt(store, x, z) {
    const cellX = Math.floor(x + 0.5);
    const cellZ = Math.floor(z + 0.5);
    const cx = chunkCoord(cellX);
    const cz = chunkCoord(cellZ);
    const cells = store.getChunk(cx, cz).cells;
    const byte = cells ? cells[((cellX - cx * N + HALF_CHUNK) * N + (cellZ - cz * N + HALF_CHUNK)) * 4] : 0;
    const steam = (byte >> STEAM_SHIFT) / 3;
    let grating = false;
    if (byte & (CELL_DRAIN_X | CELL_DRAIN_Z)) {
        const across = byte & CELL_DRAIN_X ? z - cellZ : x - cellX;
        grating = Math.abs(across - (byte & CELL_DRAIN_SIDE ? 0.33 : -0.33)) < 0.075;
    }
    return { grating, wet: grating ? 0 : pipeDreamsWetness(x, z, steam), steam };
}

/** What a cell's walls face, for their pipes (see faceTracks). */
export function faceOf(kind) {
    if (kind & CELL_TUNNEL) return FACE_TUNNEL;
    if (kind & CELL_HALL) return FACE_HALL;
    if (kind & CELL_MAZE) return FACE_MAZE;
    return FACE_ROOM;
}

function normalize([x, y, z]) {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
}

// ---------------------------------------------------------------------------------------------- cells

/**
 * Each cell's bytes for Level 2's shaders (see ChunkData.cells): its look, drain, vent and steam (the first byte), and
 * where the nearest boiler's fire is from it, if there's one near enough to light it (the second and third: how far
 * off along x and z in sixteenths, plus 64, and which way the firebox faces in their top bits).
 */
function cellBytes(kinds, spaces, machines, leaks, x0, z0, zone, empty) {
    const cells = new Uint8Array(N * N * 4);
    if (empty) return cells;
    const look = zone === ZONE_STEAM ? LOOK_BRICK : zone === ZONE_PLANT ? LOOK_BLOCK : LOOK_CONCRETE;
    const steam = zone === ZONE_STEAM ? 2 : 1;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const cell = i * N + j;
            const kind = kinds[cell];
            let byte = look | ((kind & CELL_MAZE ? 3 : steam) << STEAM_SHIFT);
            if (kind & CELL_GALLERY) {
                // The gallery's drain runs down its left side.
                if (i === 7) byte |= CELL_DRAIN_Z;
            } else if (kind & (CELL_X_TUNNEL | CELL_Z_TUNNEL)) {
                for (const family of kind & CELL_X_TUNNEL ? [FAMILY_X, FAMILY_Z] : [FAMILY_Z]) {
                    if (!(kind & (family === FAMILY_X ? CELL_X_TUNNEL : CELL_Z_TUNNEL))) continue;
                    const { drain } = tunnelFloor(spaces[cell * 2 + family]);
                    if (drain === 0) continue;
                    byte |= (family === FAMILY_X ? CELL_DRAIN_X : CELL_DRAIN_Z) | (drain > 0 ? CELL_DRAIN_SIDE : 0);
                    break;
                }
            }
            cells[cell * 4] = byte;
        }
    }
    for (const leak of leaks) {
        if (!leak.vent || leak.y > 0.1) continue;
        const cell = (leak.x - x0) * N + (leak.z - z0);
        cells[cell * 4] |= CELL_VENT | (3 << STEAM_SHIFT);
    }
    // The fires: each cell near enough to one knows where it is (every cell with any of it lit: its light comes from a
    // little out of the door, and a cell reaches half a cell either way of its middle).
    const reach = FIRE_REACH;
    const best = new Float32Array(N * N).fill(Infinity);
    for (const machine of machines) {
        if (machine.type !== MACHINE_BOILER) continue;
        const [fx, fz] = firePlace(machine);
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                const ox = fx - (x0 + i);
                const oz = fz - (z0 + j);
                if (Math.abs(ox) > reach || Math.abs(oz) > reach) continue;
                const d = Math.hypot(ox, oz);
                const cell = i * N + j;
                if (d >= best[cell]) continue;
                best[cell] = d;
                cells[cell * 4 + 1] = Math.round(ox * 16 + 64) | (machine.dx === 0 ? 128 : 0);
                cells[cell * 4 + 2] = Math.round(oz * 16 + 64) | (machine.dx + machine.dz > 0 ? 128 : 0);
            }
        }
    }
    return cells;
}
