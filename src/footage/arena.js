import { CHUNK_SIZE, HALF_CHUNK, WALL_THICKNESS } from '../config.js';
import { PROP_BOTTLES, PROP_MONITOR, makeProp } from '../world/decorations.js';
import { DIRECTIONS, EDGE_NONE, EDGE_WALL } from '../world/grid.js';
import { levelById } from '../world/levels.js';
import { hashInts, mulberry32 } from '../world/random.js';
import { ZONE_PILLARS } from '../world/zones.js';

/*
 * The Found Footage map: a walled-in square of the normal level with nothing outside it. Same on every level (see
 * levels.js) except for what it's built from.
 *
 * Slender's forest works because it's small enough to learn and every page is at a landmark. So the arena is 4 x 4
 * chunks (64 cells, about 170 m across), has every zone type so areas look different, and each note hangs by a TV
 * someone left on. Nothing else glows or hisses like that, so you can spot it down a corridor and hear it through walls.
 */

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;

/** Arena bounds in chunks. Spawn chunk is (0, 0), off center on purpose. */
export const ARENA = Object.freeze({ cx0: -2, cz0: -2, cx1: 1, cz1: 1 });
/** Arena bounds in cells (inclusive). */
export const CELLS = Object.freeze({
    x0: ARENA.cx0 * N - HALF_CHUNK,
    x1: (ARENA.cx1 + 1) * N - HALF_CHUNK - 1,
    z0: ARENA.cz0 * N - HALF_CHUNK,
    z1: (ARENA.cz1 + 1) * N - HALF_CHUNK - 1,
});
export const NOTE_COUNT = 8;
/** Note size on the wall and the height of its center. */
export const NOTE_WIDTH = 0.13;
export const NOTE_HEIGHT = 0.18;
export const NOTE_EYE = 0.5;
/** Gap between a note and its wall. */
export const NOTE_OFFSET = 0.004;

// On flooded levels, max water depth at a note when no dry cell is found. A puddle, not a pool.
const SHALLOW = 0.1;
// Spawn room bounds (see stampSpawnRoom in generator.js). Nothing gets placed in it.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };

/**
 * @typedef {object} Note
 * @property {number} index 0..7
 * @property {number} x Note position, just in front of the wall.
 * @property {number} y
 * @property {number} z
 * @property {number} nx Wall normal (the way the note faces).
 * @property {number} nz
 * @property {number} tilt Off-straight angle (radians).
 * @property {number} cellX Cell you read it from.
 * @property {number} cellZ
 * @property {{ x: number, y: number, z: number, yaw: number }} tv The monitor prop next to it, standing on the floor at `y`.
 */

/**
 * @typedef {object} Exit
 * @property {number} x Center of the wall opening.
 * @property {number} z
 * @property {number} dx Direction out (axis-aligned unit).
 * @property {number} dz
 * @property {number[][]} cells The two inside cells next to the opening.
 */

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
 * World options for a tape. Every zone type goes inside the walls so areas are easy to tell apart. Nothing outside.
 * @param {number} seed
 * @param {number} [level] Which level (see levels.js).
 * @returns {import('../world/generator.js').WorldOptions}
 */
export function arenaOptions(seed, level = 0) {
    const { zones: tapeZones, start: tapeStart } = levelById(level).tape;
    const random = tapeRandom(seed, 0xa7e0, level);
    const kinds = [...tapeZones];
    shuffle(kinds, random);
    // Spawn chunk is always the same zone type so every run on a level starts the same way. On Level 0 it's the
    // normal starting room.
    const spawnIndex = (0 - ARENA.cx0) * 4 + (0 - ARENA.cz0);
    if (kinds[spawnIndex] !== tapeStart) {
        const swap = kinds.indexOf(tapeStart);
        kinds[swap] = kinds[spawnIndex];
        kinds[spawnIndex] = tapeStart;
    }
    // Pillar halls share one variant so pillars line up where two of them meet.
    const pillarVariant = hashInts(seed, 0x9a11);
    /** @type {Map<string, import('../world/zones.js').Zone>} */
    const zones = new Map();
    for (let cx = ARENA.cx0; cx <= ARENA.cx1; cx++) {
        for (let cz = ARENA.cz0; cz <= ARENA.cz1; cz++) {
            const type = kinds[(cx - ARENA.cx0) * 4 + (cz - ARENA.cz0)];
            zones.set(`${cx},${cz}`, { type, variant: type === ZONE_PILLARS ? pillarVariant : hashInts(seed, 0x5a0, cx, cz) });
        }
    }
    // Outside is void (see isVoid), the zone type doesn't matter.
    const nothing = { type: tapeStart, variant: 0 };
    return {
        level,
        zoneAt: (cx, cz) => zones.get(`${cx},${cz}`) ?? nothing,
        isVoid: (cx, cz) => !inChunkBounds(cx, cz),
        isSealed: (axis, cx, cz) => (axis === 0
            ? (cx === ARENA.cx0 || cx === ARENA.cx1 + 1) && cz >= ARENA.cz0 && cz <= ARENA.cz1
            : (cz === ARENA.cz0 || cz === ARENA.cz1 + 1) && cx >= ARENA.cx0 && cx <= ARENA.cx1),
    };
}

/**
 * Places the notes, one per chunk in a checkerboard so no two are neighbors. Each goes on the wall of an empty cell
 * (or a pillar if the level allows it) with a monitor and some bottles next to it. On flooded levels we pick a dry
 * cell if we can, at worst a puddle, so you never swim for a note. Call before meshing since it adds props.
 *
 * @param {import('../world/ChunkStore.js').ChunkStore} store
 * @param {number} seed
 * @returns {Note[]}
 */
export function placeNotes(store, seed) {
    const level = store.level;
    const { tape: { pillarNotes }, water } = levelById(level);
    const random = tapeRandom(seed, 0x0e75, level);
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
        // Also skip cells a level solid (bed, machine) reaches into.
        const taken = (x, z) => chunk.props.some((p) => Math.round(p.x) === x && Math.round(p.z) === z)
            || chunk.leaks.some((l) => Math.round(l.floorX) === x && Math.round(l.floorZ) === z)
            || (chunk.solids?.some(([minX, minZ, maxX, maxZ]) => maxX > x - 0.5 && minX < x + 0.5 && maxZ > z - 0.5 && minZ < z + 0.5) ?? false);
        const wallsOf = (x, z) => DIRECTIONS.filter(([dx, dz]) => store.edgeBetween(x, z, dx, dz) === EDGE_WALL);
        // Allowed water depth. Stairs down into water never count as dry.
        let wet = 0;
        const dry = (x, z) => !water || (store.flatFloor(x, z) ?? -1) >= -wet;
        const free = (x, z) => !inSpawnRoom(x, z) && !taken(x, z) && dry(x, z);

        /** @type {Mount | null} */
        let mount = null;
        for (let attempt = 0; attempt < 80 && !mount; attempt++) {
            if (attempt === 50) wet = SHALLOW;
            if (pillarNotes && random() < 0.5) {
                mount = pillarMount(store, x0, z0, random, free);
                continue;
            }
            const x = x0 + Math.floor(random() * N);
            const z = z0 + Math.floor(random() * N);
            if (!free(x, z)) continue;
            const walls = wallsOf(x, z);
            if (walls.length === 0) continue;
            mount = wallMount(x, z, walls[Math.floor(random() * walls.length)]);
        }
        if (!mount) {
            // Every chunk has a wall or pillar somewhere. Take the first empty cell by a wall, else the first one.
            for (const clear of [free, (x, z) => !inSpawnRoom(x, z)]) {
                for (let i = 0; i < N && !mount; i++) {
                    for (let j = 0; j < N && !mount; j++) {
                        const walls = wallsOf(x0 + i, z0 + j);
                        if (walls.length > 0 && clear(x0 + i, z0 + j)) mount = wallMount(x0 + i, z0 + j, walls[0]);
                    }
                }
            }
            for (let attempt = 0; attempt < 200 && !mount; attempt++) mount = pillarMount(store, x0, z0, random, free);
        }
        if (!mount) continue;
        const { x, z, dx, dz, depth } = mount;
        const nx = -dx;
        const nz = -dz;
        // `out` is toward the surface from the read point, `a` is along the surface (z for an x-facing surface,
        // x for a z-facing one).
        const at = (out, a) => [x + dx * out + (dz !== 0 ? a : 0), z + dz * out + (dx !== 0 ? a : 0)];
        const along = (random() - 0.5) * 0.12;
        const [px, pz] = at(depth - NOTE_OFFSET, along);
        const note = {
            index: notes.length,
            x: px,
            y: NOTE_EYE + (random() - 0.5) * 0.08,
            z: pz,
            nx,
            nz,
            tilt: (random() - 0.5) * 0.16,
            cellX: mount.cellX,
            cellZ: mount.cellZ,
            tv: { x: 0, y: 0, z: 0, yaw: 0 },
        };
        notes.push(note);

        // Monitor on one side of the note, bottles on the other, facing into the room.
        const side = random() < 0.5 ? 1 : -1;
        const yaw = Math.atan2(nx, nz);
        // Used to pick chair vs monitor. Keep the draw so existing tapes keep their note positions.
        random();
        const [tx, tz] = at(0.22, side * 0.27);
        const tvYaw = yaw + (random() - 0.5) * 0.3;
        const monitor = makeProp(PROP_MONITOR, tx, tz, tvYaw, variant());
        const bottles = makeProp(PROP_BOTTLES, ...at(0.2, -side * 0.27), random() * Math.PI * 2, variant());
        // Drop onto the floor in case it isn't flat.
        store.settle(monitor);
        store.settle(bottles);
        chunk.props.push(monitor, bottles);
        note.tv = { x: tx, y: monitor.y ?? 0, z: tz, yaw: tvYaw };
    }
    return notes;
}

/**
 * @typedef {object} Mount A surface to pin a note to, relative to the read point.
 * @property {number} x Read point (center of the cell in front of a wall).
 * @property {number} z
 * @property {number} dx Direction to the surface (axis-aligned unit).
 * @property {number} dz
 * @property {number} depth Distance to the surface.
 * @property {number} cellX Cell you read it from.
 * @property {number} cellZ
 */

/** Wall on side (dx, dz) of cell (x, z). @returns {Mount} */
function wallMount(x, z, [dx, dz]) {
    return { x, z, dx, dz, depth: 0.5 - HALF_THICKNESS, cellX: x, cellZ: z };
}

/**
 * A random pillar face away from the chunk edges so the props stay in the chunk. Read from the same distance as a
 * wall. Uses the drawn face because Level 37's round columns are wider than their square and the note would end up
 * inside. Null if there's no pillar at the picked corner or the cells in front aren't free.
 * @returns {Mount | null}
 */
function pillarMount(store, x0, z0, random, free) {
    // Corner (i, j) is the +x+z corner of the chunk's cell (i − 1, j − 1).
    const x = x0 + 1 + Math.floor(random() * (N - 3));
    const z = z0 + 1 + Math.floor(random() * (N - 3));
    const [dx, dz] = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
    if (!store.pillar(x, z)) return null;
    const depth = 0.5 - HALF_THICKNESS;
    const reach = levelById(store.level).shape.pillarFace + depth;
    const mx = x + 0.5 - dx * reach;
    const mz = z + 0.5 - dz * reach;
    const cellX = Math.round(mx);
    const cellZ = Math.round(mz);
    if (!free(cellX, cellZ)) return null;
    // The read point is on the line between two cells and the props go on either side, so both must be free.
    if (!free(cellX - (dz !== 0 ? 1 : 0), cellZ - (dx !== 0 ? 1 : 0))) return null;
    return { x: mx, z: mz, dx, dz, depth, cellX, cellZ };
}

/**
 * Opens the exit, a two-cell gap in the arena wall as far from you as possible so the last stretch is a real trip.
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
    // Clear the wall between the two cells and the pillar where it meets the outer wall.
    store.setEdge(x, z, dx !== 0 ? 1 : 0, EDGE_NONE);
    store.setPillar(dx === -1 ? x - 1 : x, dz === -1 ? z - 1 : z, false);
    for (const [cx, cz] of cells) {
        // Edge to the void outside. Edges are owned by the cell on the low side.
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

/** Random stream for a tape on a level. Level 0 skips the level in the hash so its old tapes stay the same. */
function tapeRandom(seed, salt, level) {
    return mulberry32(level === 0 ? hashInts(seed, salt) : hashInts(seed, salt, level));
}

function shuffle(array, random) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
