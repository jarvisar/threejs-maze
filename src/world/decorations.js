import { CHUNK_SIZE } from '../config.js';
import { DIRECTIONS, EDGE_WALL } from './grid.js';

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
// Level 1's (see levelOneProps.js).
export const PROP_CRATES = 5; // one to three wooden supply crates
export const PROP_BOXES = 6; // a pile of cardboard boxes
export const PROP_PALLET = 7; // a wooden pallet, empty or loaded
export const PROP_BARREL = 8; // one or two steel drums, sometimes knocked over
export const PROP_CONE = 9; // a traffic cone or two
export const PROP_RACK = 10; // a bay of pallet racking with things on its shelves
// Level 37's, only put down in edit mode (the pools' own float about; see poolrooms.js).
export const PROP_LIFEBUOY = 11; // a red and white lifebuoy
export const PROP_RING = 12; // an inflatable ring
export const PROP_BALL = 13; // a beach ball
// Level Fun's, only put down in edit mode, once it's been found: the same things its party has (in the same order as
// PARTY_CAKE...; see party.js), drawn by its own meshes (partyGeometry.js).
export const PROP_CAKE = 14; // a table with a birthday cake on it
export const PROP_PRESENTS = 15; // one to three wrapped presents
export const PROP_HAT = 16; // a party hat
export const PROP_BALLOONS = 17; // a bunch of balloons tied down to a weight

export const PROP_NAMES = [
    'chair', 'monitor', 'bottles', 'sign', 'tile', 'crates', 'boxes', 'pallet', 'barrel', 'cone', 'rack', 'lifebuoy', 'ring', 'ball',
    'cake', 'presents', 'hat', 'balloons',
];

/** Whether a prop is one of Level Fun's, drawn with the party (see partyGeometry.js) rather than with the rest. */
export function isPartyProp(type) {
    return type >= PROP_CAKE;
}

/**
 * How far each kind of prop that floats sits down in water: in a pool it floats at the surface rather than lying on
 * the bottom (see restingHeight).
 */
const PROP_DRAFT = new Map([[PROP_LIFEBUOY, 0.018], [PROP_RING, 0.028], [PROP_BALL, 0.013]]);
// Under deeper water than this you swim over a prop, not into it (you float once it's past your chin).
const SWIM_OVER = 0.43;

/**
 * Half-size of the square the player collides with, per prop type (0: you walk straight through). Level 1's props
 * come in shapes that aren't square; theirs is worked out from the variant (see solidHalfSize).
 */
export const PROP_SOLID_HALF = [0.1, 0.08, 0, 0.08, 0, 0.13, 0.1, 0.15, 0.08, 0.04, 0.3];

// How far a prop pushed up against a wall stands from the middle of its cell.
const AGAINST_WALL = 0.22;
// Where the spawn room is (see stampSpawnRoom); nothing is placed in it.
const SPAWN_ROOM = { x0: -3, x1: 3, z0: -3, z1: 2 };

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
 * @property {number} [index] Where it comes in the list of props its chunk was generated with, which is how
 *     a removed one is remembered (see edits.js). Props put down in edit mode have none.
 * @property {number} [y] How high it stands: the floor under it, on a level whose floor isn't flat (see
 *     settleProp). Left out, 0.
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

/**
 * Stands a prop on the floor at `ground` (Level 37's goes down into pools): on it, or floating at the surface if it
 * floats and the water's deep enough. Down where you'd swim over it, nothing stops you.
 * @param {Prop} prop
 * @param {number} ground
 */
export function settleProp(prop, ground) {
    const draft = PROP_DRAFT.get(prop.type);
    prop.y = draft === undefined ? ground : Math.max(ground, -draft);
    if (prop.y < -SWIM_OVER) prop.box = null;
}

/** @returns {Prop} */
export function makeProp(type, x, z, yaw, variant) {
    if (type >= PROP_CRATES) return { type, x, z, yaw, variant, box: turnedBox(x, z, yaw, solidHalfSize(type, variant)) };
    const half = PROP_SOLID_HALF[type];
    const box = half > 0 ? [x - half, z - half, x + half, z + half] : null;
    return { type, x, z, yaw, variant, box };
}

/**
 * What of one of Level 1's props is solid, as half its size across (its own x) and front to back (its own z),
 * a little inside what's drawn (see props.js for the shapes); null for something you walk through.
 * @param {number} type
 * @param {number} variant
 * @returns {[number, number] | null}
 */
export function solidHalfSize(type, variant) {
    switch (type) {
        case PROP_CRATES: {
            const arrangement = variant & 3;
            return arrangement === 1 || arrangement === 3 ? [0.22, 0.095] : [0.11, 0.095];
        }
        case PROP_BOXES:
            return [0.14, 0.11];
        case PROP_PALLET:
            return [0.2, 0.17];
        case PROP_BARREL:
            // Two, or one lying on its side, take up more.
            return (variant & 1) === 1 ? [0.2, 0.1] : ((variant >>> 1) & 3) === 0 ? [0.16, 0.1] : [0.1, 0.1];
        case PROP_CONE:
            // Standing: small, and solid enough to walk round. Knocked over: kicked out of the way.
            return ((variant >>> 2) & 3) === 0 ? null : [0.045, 0.045];
        case PROP_RACK:
            return [0.45, 0.16];
        // The same as the party's own (see TABLE_LENGTH and PRESENTS_HALF in party.js).
        case PROP_CAKE:
            return [0.17, 0.09];
        case PROP_PRESENTS:
            return [0.075, 0.075];
        default:
            return null;
    }
}

/** The axis-aligned box round a rectangle of half-size [hx, hz], turned by yaw, at (x, z). */
function turnedBox(x, z, yaw, half) {
    if (!half) return null;
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    const hx = half[0] * cos + half[1] * sin;
    const hz = half[0] * sin + half[1] * cos;
    return [x - hx, z - hz, x + hx, z + hz];
}
