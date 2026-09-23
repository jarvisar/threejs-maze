import { CHUNK_SIZE, HALF_CHUNK, WALL_THICKNESS } from '../config.js';
import { PROP_BOTTLES, PROP_MONITOR, makeProp } from '../world/decorations.js';
import { EDGE_NONE, EDGE_WALL } from '../world/grid.js';
import { hashInts, mulberry32 } from '../world/random.js';
import { ZONE_HALLS, ZONE_MAZE, ZONE_OPEN, ZONE_PILLARS, ZONE_ROOMS } from '../world/zones.js';

/*
 * The level for Found Footage: a walled-in square of the endless one, with nothing beyond its walls.
 *
 * Slender's forest works because it's small enough to learn and every page is at something you can
 * recognise from a distance. So: 4 × 4 chunks (64 cells, about 170 m across) rather than infinity, with
 * every kind of zone in it so the parts look different, and each note pinned on a wall where someone
 * camped, next to the TV they left on. Nothing else in the level glows or hisses like that, so it can be
 * seen down a corridor and heard through the walls.
 */

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;

/** The arena, in chunks. The spawn chunk is at (0, 0): not the middle, so you don't start in the centre. */
export const ARENA = Object.freeze({ cx0: -2, cz0: -2, cx1: 1, cz1: 1 });
/** The same in cells (inclusive). */
export const CELLS = Object.freeze({
    x0: ARENA.cx0 * N - HALF_CHUNK,
    x1: (ARENA.cx1 + 1) * N - HALF_CHUNK - 1,
    z0: ARENA.cz0 * N - HALF_CHUNK,
    z1: (ARENA.cz1 + 1) * N - HALF_CHUNK - 1,
});
export const NOTE_COUNT = 8;
/** A note's size on the wall, and where its middle sits. */
export const NOTE_WIDTH = 0.13;
export const NOTE_HEIGHT = 0.18;
export const NOTE_EYE = 0.5;
/** How far a note floats in front of the wall. */
export const NOTE_OFFSET = 0.004;

// Where the spawn room is (see stampSpawnRoom in generator.js): nothing goes in it.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };

const DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/**
 * @typedef {object} Note
 * @property {number} index 0..7
 * @property {number} x Where the note hangs, just in front of the wall.
 * @property {number} y
 * @property {number} z
 * @property {number} nx The wall's normal (which way the note faces).
 * @property {number} nz
 * @property {number} tilt Radians the paper hangs off straight.
 * @property {number} cellX The cell it's read from.
 * @property {number} cellZ
 * @property {{ x: number, z: number, yaw: number }} tv The monitor left on beside it (a prop in its chunk).
 */

/**
 * @typedef {object} Exit
 * @property {number} x Middle of the opening in the wall.
 * @property {number} z
 * @property {number} dx Which way out (unit, along an axis).
 * @property {number} dz
 * @property {number[][]} cells The two inside cells the opening is next to.
 */

/** Whether a cell is inside the arena. */
export function inArena(x, z) {
    return x >= CELLS.x0 && x <= CELLS.x1 && z >= CELLS.z0 && z <= CELLS.z1;
}

function inChunkBounds(cx, cz) {
    return cx >= ARENA.cx0 && cx <= ARENA.cx1 && cz >= ARENA.cz0 && cz <= ARENA.cz1;
}

function inSpawnRoom(x, z) {
    return x >= SPAWN_ROOM.x0 && x <= SPAWN_ROOM.x1 && z >= SPAWN_ROOM.z0 && z <= SPAWN_ROOM.z1;
}

/**
 * How the level is generated for a run: every kind of zone inside the walls (so the parts of the arena look
 * different from each other, which is what lets you learn it), nothing outside them.
 * @param {number} seed
 * @returns {import('../world/generator.js').WorldOptions}
 */
export function arenaOptions(seed) {
    const random = mulberry32(hashInts(seed, 0xa7e0));
    const kinds = [
        ...Array(5).fill(ZONE_ROOMS),
        ...Array(3).fill(ZONE_HALLS),
        ...Array(3).fill(ZONE_MAZE),
        ...Array(3).fill(ZONE_PILLARS),
        ...Array(2).fill(ZONE_OPEN),
    ];
    shuffle(kinds, random);
    // The spawn chunk is offices, so every run starts in the room every world starts in.
    const spawnIndex = (0 - ARENA.cx0) * 4 + (0 - ARENA.cz0);
    if (kinds[spawnIndex] !== ZONE_ROOMS) {
        const swap = kinds.indexOf(ZONE_ROOMS);
        kinds[swap] = kinds[spawnIndex];
        kinds[spawnIndex] = ZONE_ROOMS;
    }
    // Pillar halls share one grid, so their pillars line up where two of them meet.
    const pillarVariant = hashInts(seed, 0x9a11);
    /** @type {Map<string, import('../world/zones.js').Zone>} */
    const zones = new Map();
    for (let cx = ARENA.cx0; cx <= ARENA.cx1; cx++) {
        for (let cz = ARENA.cz0; cz <= ARENA.cz1; cz++) {
            const type = kinds[(cx - ARENA.cx0) * 4 + (cz - ARENA.cz0)];
            zones.set(`${cx},${cz}`, { type, variant: type === ZONE_PILLARS ? pillarVariant : hashInts(seed, 0x5a0, cx, cz) });
        }
    }
    const nothing = { type: ZONE_OPEN, variant: 0 };
    return {
        zoneAt: (cx, cz) => zones.get(`${cx},${cz}`) ?? nothing,
        isVoid: (cx, cz) => !inChunkBounds(cx, cz),
        isSealed: (axis, cx, cz) => (axis === 0
            ? (cx === ARENA.cx0 || cx === ARENA.cx1 + 1) && cz >= ARENA.cz0 && cz <= ARENA.cz1
            : (cz === ARENA.cz0 || cz === ARENA.cz1 + 1) && cx >= ARENA.cx0 && cx <= ARENA.cx1),
    };
}

/**
 * Chooses where the notes hang: one in each of eight chunks in a checkerboard (so they're spread out and
 * no two are next door), on a wall of a cell with nothing else in it, and leaves a monitor (the one that's
 * left on) and a few bottles against the same wall. Call before the chunks are meshed, since it adds to
 * their props.
 *
 * @param {import('../world/ChunkStore.js').ChunkStore} store
 * @param {number} seed
 * @returns {Note[]}
 */
export function placeNotes(store, seed) {
    const random = mulberry32(hashInts(seed, 0x0e75));
    const parity = random() < 0.5 ? 0 : 1;
    const chunks = [];
    for (let cx = ARENA.cx0; cx <= ARENA.cx1; cx++) {
        for (let cz = ARENA.cz0; cz <= ARENA.cz1; cz++) if (((cx + cz) & 1) === parity) chunks.push([cx, cz]);
    }
    shuffle(chunks, random);
    const variant = () => (random() * 4294967296) >>> 0;

    /** @type {Note[]} */
    const notes = [];
    for (const [cx, cz] of chunks.slice(0, NOTE_COUNT)) {
        const chunk = store.getChunk(cx, cz);
        const x0 = cx * N - HALF_CHUNK;
        const z0 = cz * N - HALF_CHUNK;
        const taken = (x, z) => chunk.props.some((p) => Math.round(p.x) === x && Math.round(p.z) === z)
            || chunk.leaks.some((l) => Math.round(l.floorX) === x && Math.round(l.floorZ) === z);
        const wallsOf = (x, z) => DIRECTIONS.filter(([dx, dz]) => store.edgeBetween(x, z, dx, dz) === EDGE_WALL);

        let spot = null;
        for (let attempt = 0; attempt < 80 && !spot; attempt++) {
            const x = x0 + Math.floor(random() * N);
            const z = z0 + Math.floor(random() * N);
            if (inSpawnRoom(x, z) || taken(x, z)) continue;
            const walls = wallsOf(x, z);
            if (walls.length === 0) continue;
            spot = { x, z, wall: walls[Math.floor(random() * walls.length)] };
        }
        if (!spot) {
            // Every chunk has walls somewhere; take the first cell with one.
            for (let i = 0; i < N && !spot; i++) {
                for (let j = 0; j < N && !spot; j++) {
                    const walls = wallsOf(x0 + i, z0 + j);
                    if (walls.length > 0 && !inSpawnRoom(x0 + i, z0 + j)) spot = { x: x0 + i, z: z0 + j, wall: walls[0] };
                }
            }
        }
        const { x, z, wall: [dx, dz] } = spot;
        const nx = -dx;
        const nz = -dz;
        // Along the wall: `a` runs along z for a wall across x, and along x for one across z.
        const at = (out, a) => [x + dx * out + (dz !== 0 ? a : 0), z + dz * out + (dx !== 0 ? a : 0)];
        const along = (random() - 0.5) * 0.12;
        const [px, pz] = at(0.5 - HALF_THICKNESS - NOTE_OFFSET, along);
        const note = {
            index: notes.length,
            x: px,
            y: NOTE_EYE + (random() - 0.5) * 0.08,
            z: pz,
            nx,
            nz,
            tilt: (random() - 0.5) * 0.16,
            cellX: x,
            cellZ: z,
            tv: { x: 0, z: 0, yaw: 0 },
        };
        notes.push(note);

        // What they left: the monitor on one side of the note, bottles on the other, facing into the room.
        const side = random() < 0.5 ? 1 : -1;
        const yaw = Math.atan2(nx, nz);
        // (This used to choose between a chair and the monitor. The draw stays, so every tape's notes are
        // where they always were.)
        random();
        const [tx, tz] = at(0.22, side * 0.27);
        note.tv = { x: tx, z: tz, yaw: yaw + (random() - 0.5) * 0.3 };
        chunk.props.push(makeProp(PROP_MONITOR, tx, tz, note.tv.yaw, variant()));
        chunk.props.push(makeProp(PROP_BOTTLES, ...at(0.2, -side * 0.27), random() * Math.PI * 2, variant()));
    }
    return notes;
}

/**
 * Opens the way out: a two-cell gap in the arena's wall, on the side furthest from where you are, so the
 * last stretch is a proper journey.
 *
 * @param {import('../world/ChunkStore.js').ChunkStore} store
 * @param {number} fromX
 * @param {number} fromZ
 * @returns {Exit}
 */
export function openExit(store, fromX, fromZ) {
    const { x0, x1, z0, z1 } = CELLS;
    let best = null;
    const consider = (x, z, dx, dz) => {
        const d = Math.hypot(x - fromX, z - fromZ);
        if (!best || d > best.d) best = { x, z, dx, dz, d };
    };
    for (let z = z0 + 1; z < z1 - 1; z += 2) {
        consider(x0, z, -1, 0);
        consider(x1, z, 1, 0);
    }
    for (let x = x0 + 1; x < x1 - 1; x += 2) {
        consider(x, z0, 0, -1);
        consider(x, z1, 0, 1);
    }
    const { x, z, dx, dz } = best;
    const cells = dx !== 0 ? [[x, z], [x, z + 1]] : [[x, z], [x + 1, z]];
    // Nothing splitting the gap down the middle: no wall between the two cells, no pillar where it meets the
    // outer wall.
    store.setEdge(x, z, dx !== 0 ? 1 : 0, EDGE_NONE);
    store.setPillar(dx === -1 ? x - 1 : x, dz === -1 ? z - 1 : z, false);
    for (const [cx, cz] of cells) {
        // The edge between the inside cell and the emptiness beyond (owned by whichever cell is on its low side).
        if (dx === 1) store.setEdge(cx, cz, 0, EDGE_NONE);
        else if (dx === -1) store.setEdge(cx - 1, cz, 0, EDGE_NONE);
        else if (dz === 1) store.setEdge(cx, cz, 1, EDGE_NONE);
        else store.setEdge(cx, cz - 1, 1, EDGE_NONE);
    }
    return {
        x: x + dx * 0.5 + (dz !== 0 ? 0.5 : 0),
        z: z + dz * 0.5 + (dx !== 0 ? 0.5 : 0),
        dx,
        dz,
        cells,
    };
}

function shuffle(array, random) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
