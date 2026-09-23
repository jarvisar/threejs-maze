import { CHUNK_SIZE } from '../config.js';
import { EDGE_WALL } from './grid.js';

/*
 * The few things that aren't walls: water damage, and objects left behind. Both are placed while a chunk
 * is generated, from the same random stream as its walls (after them, so the layouts of existing worlds
 * are unchanged), and both are rare on purpose. An office chair on its own in the middle of an empty
 * floor is unsettling; a room full of them is furniture.
 *
 * Everything here is positioned so it never gets in the way: props keep to the inside of their cell (the
 * walls, doorways and pillars are all on the cell's border) and the box the player collides with is small
 * enough to walk around in a one-cell maze passage.
 */

const N = CHUNK_SIZE;

export const PROP_CHAIR = 0; // an office chair, sometimes on its side
export const PROP_MONITOR = 1; // a dead CRT monitor on the floor
export const PROP_BOTTLES = 2; // one to three bottles of almond water
export const PROP_SIGN = 3; // a yellow "wet floor" sign
export const PROP_TILE = 4; // a sodden ceiling tile that has fallen and broken, under the hole it left

export const PROP_NAMES = ['chair', 'monitor', 'bottles', 'sign', 'tile'];

/** Half-size of the square the player collides with, per prop type (0: you walk straight through). */
export const PROP_SOLID_HALF = [0.1, 0.08, 0, 0.08, 0];

// How far a prop pushed up against a wall stands from the middle of its cell.
const AGAINST_WALL = 0.22;
// Where the spawn room is (see stampSpawnRoom); nothing is placed in it.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };

const DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/**
 * @typedef {object} Prop
 * @property {number} type One of the PROP_* constants.
 * @property {number} x World position of the prop's centre, on the floor.
 * @property {number} z
 * @property {number} yaw Rotation about y in radians; the prop's front faces +z at 0.
 * @property {number} variant A 32-bit value each kind of prop reads what it likes from (tipped over, how
 *     many bottles, which are lying down...).
 * @property {number[] | null} box What the player collides with, as [minX, minZ, maxX, maxZ]; null for
 *     something you walk straight through.
 */

/**
 * @typedef {object} Leak
 * @property {number} x World position of the stain's centre on the ceiling.
 * @property {number} z
 * @property {number} radius Of the ceiling stain.
 * @property {number} floorX Centre of the wet patch on the carpet under it.
 * @property {number} floorZ
 * @property {number} floorRadius
 * @property {number} variant 32-bit, for picking pictures and rotations.
 */

/**
 * Chooses the props and leaks of one chunk.
 *
 * @param {() => number} random The chunk's random stream.
 * @param {(i: number, j: number, di: number, dj: number) => number} edgeBetween Type of the edge between
 *     local cell (i, j) and its neighbour in direction (di, dj).
 * @param {number} x0 World coordinates of the chunk's first cell.
 * @param {number} z0
 * @returns {{ props: Prop[], leaks: Leak[] }}
 */
export function placeDecorations(random, edgeBetween, x0, z0) {
    /** @type {Prop[]} */
    const props = [];
    /** @type {Leak[]} */
    const leaks = [];
    // Cells already holding something, plus a ring around them, so things don't crowd together.
    const taken = new Uint8Array(N * N);
    const free = (i, j) => {
        if (taken[i * N + j]) return false;
        const x = x0 + i;
        const z = z0 + j;
        return x < SPAWN_ROOM.x0 || x > SPAWN_ROOM.x1 || z < SPAWN_ROOM.z0 || z > SPAWN_ROOM.z1;
    };
    const take = (i, j) => {
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii >= 0 && jj >= 0 && ii < N && jj < N) taken[ii * N + jj] = 1;
            }
        }
    };
    const variant = () => (random() * 4294967296) >>> 0;

    // Leaks: water has come through the ceiling and soaked the carpet underneath. The stain stays clear of
    // the light panels (above every cell with two odd coordinates) and the wet patch stays inside its cell,
    // so it never runs under a wall.
    const leakRoll = random();
    const leakCount = leakRoll < 0.55 ? 0 : leakRoll < 0.92 ? 1 : 2;
    for (let n = 0; n < leakCount; n++) {
        for (let attempt = 0; attempt < 10; attempt++) {
            const i = 1 + Math.floor(random() * (N - 2));
            const j = 1 + Math.floor(random() * (N - 2));
            const x = x0 + i;
            const z = z0 + j;
            if (((x & 1) && (z & 1)) || !free(i, j)) continue;
            const radius = 0.26 + random() * 0.2;
            const ox = (random() - 0.5) * 0.2;
            const oz = (random() - 0.5) * 0.2;
            // Someone has been by and put a sign next to it, now and then.
            const withSign = random() < 0.3;
            const floorRadius = withSign ? 0.17 + random() * 0.06 : 0.18 + random() * 0.17;
            // The drips land more or less straight down.
            const fx = clamp(ox + (random() - 0.5) * 0.1, floorRadius);
            const fz = clamp(oz + (random() - 0.5) * 0.1, floorRadius);
            const leak = { x: x + ox, z: z + oz, radius, floorX: x + fx, floorZ: z + fz, floorRadius, variant: variant() };
            leaks.push(leak);
            if (tileFell(leak)) {
                // On the wet patch, more or less under the hole (from the leak's own bits, so this adds nothing
                // to the random stream).
                const v = leak.variant;
                const tx = Math.max(-0.26, Math.min(0.26, fx * 0.6 + (((v >>> 23) & 15) / 15 - 0.5) * 0.12));
                const tz = Math.max(-0.26, Math.min(0.26, fz * 0.6 + (((v >>> 27) & 15) / 15 - 0.5) * 0.12));
                props.push(makeProp(PROP_TILE, x + tx, z + tz, ((v >>> 12) & 255) / 256 * 2 * Math.PI, v));
            }
            if (withSign) {
                // On the far side of the cell from the wet patch, so it stands at its edge rather than in it.
                const length = Math.hypot(fx, fz) || 1;
                const sx = (-fx / length) * 0.26 + (random() - 0.5) * 0.06;
                const sz = (-fz / length) * 0.26 + (random() - 0.5) * 0.06;
                props.push(makeProp(PROP_SIGN, x + sx, z + sz, random() * Math.PI * 2, variant()));
            }
            take(i, j);
            break;
        }
    }

    // Loose objects. Most chunks have none.
    const propRoll = random();
    const propCount = propRoll < 0.6 ? 0 : propRoll < 0.92 ? 1 : 2;
    for (let n = 0; n < propCount; n++) {
        const typeRoll = random();
        const type = typeRoll < 0.3 ? PROP_CHAIR : typeRoll < 0.52 ? PROP_MONITOR : typeRoll < 0.8 ? PROP_BOTTLES : PROP_SIGN;
        for (let attempt = 0; attempt < 12; attempt++) {
            const i = Math.floor(random() * N);
            const j = Math.floor(random() * N);
            if (!free(i, j)) continue;
            const x = x0 + i;
            const z = z0 + j;
            const v = variant();
            // A chair on its side takes up most of the cell; it stays in the middle.
            const tipped = type === PROP_CHAIR && (v & 3) === 0;
            const walls = DIRECTIONS.filter(([di, dj]) => edgeBetween(i, j, di, dj) === EDGE_WALL);
            if (walls.length > 0 && !tipped && type !== PROP_SIGN && random() < 0.8) {
                // Pushed up against a wall, facing into the room.
                const [di, dj] = walls[Math.floor(random() * walls.length)];
                const along = (random() - 0.5) * 0.4;
                props.push(makeProp(
                    type,
                    x + di * AGAINST_WALL + (di === 0 ? along : 0),
                    z + dj * AGAINST_WALL + (dj === 0 ? along : 0),
                    Math.atan2(-di, -dj) + (random() - 0.5) * 0.5,
                    v,
                ));
            } else {
                props.push(makeProp(type, x + (random() - 0.5) * 0.2, z + (random() - 0.5) * 0.2, random() * Math.PI * 2, v));
            }
            take(i, j);
            break;
        }
    }

    return { props, leaks };
}

/** Whether a leak has brought its ceiling tile down (decals.js leaves a hole; the tile is on the floor). */
export function tileFell(leak) {
    return ((leak.variant >>> 20) & 7) < 2;
}

/** Keeps a wet patch of the given radius, offset by `offset` from its cell's centre, inside the cell. */
function clamp(offset, radius) {
    const limit = 0.44 - radius;
    return Math.max(-limit, Math.min(limit, offset));
}

/** @returns {Prop} */
export function makeProp(type, x, z, yaw, variant) {
    const half = PROP_SOLID_HALF[type];
    const box = half > 0 ? [x - half, z - half, x + half, z + half] : null;
    return { type, x, z, yaw, variant, box };
}
