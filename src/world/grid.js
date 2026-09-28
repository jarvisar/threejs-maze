import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, PILLAR_SIZE, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';

/*
 * The level is a grid of unit cells centered on integer (x, z). Walls run along the lines between cells.
 *
 *   - Each cell owns its +x edge (axis 0, line x + 0.5, along z) and its +z edge (axis 1, line z + 0.5, along x).
 *   - Each cell also owns its +x+z corner at (x + 0.5, z + 0.5), which can have a pillar.
 *
 * An edge is open, a wall, or a wall with a doorway.
 */

export const EDGE_NONE = 0;
export const EDGE_WALL = 1;
export const EDGE_DOOR = 2;

/**
 * Steps (dx, dz) to a cell's 4 neighbors. Don't reorder. Random picks use this order, so changing it changes every
 * world.
 */
export const DIRECTIONS = Object.freeze([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
]);

const HALF_THICKNESS = WALL_THICKNESS / 2;
const HALF_DOOR = DOOR_WIDTH / 2;
const HALF_PILLAR = PILLAR_SIZE / 2;

/** Chunk coord for integer cell coord `c`. */
export function chunkCoord(c) {
    return Math.floor((c + HALF_CHUNK) / CHUNK_SIZE);
}

/** Cell containing world position `p`. */
export function cellCoord(p) {
    return Math.floor(p + 0.5);
}

/** `a` mod `b`, never negative, so grid patterns work on both sides of 0. */
export function mod(a, b) {
    return ((a % b) + b) % b;
}

/** Unique numeric chunk key (exact for |cz| < 2^25). */
export function chunkKey(cx, cz) {
    return cx * 67108864 + cz;
}

/**
 * Pushes an edge's solid XZ boxes onto `out` as [minX, minZ, maxX, maxZ]. A wall box extends half a thickness past
 * both ends so walls meeting at a corner overlap with no gap. A doorway is the two wall pieces beside the opening.
 * The lintel is out of reach so it's skipped.
 *
 * @param {number} x Cell owning the edge.
 * @param {number} z
 * @param {0 | 1} axis
 * @param {number} type
 * @param {number[][]} out
 */
export function edgeBoxes(x, z, axis, type, out) {
    if (type === EDGE_NONE) return;
    // "a" is across the wall (thickness), "b" is along it.
    const a = (axis === 0 ? x : z) + 0.5;
    const b = axis === 0 ? z : x;
    const push = (b0, b1) => {
        out.push(axis === 0
            ? [a - HALF_THICKNESS, b0, a + HALF_THICKNESS, b1]
            : [b0, a - HALF_THICKNESS, b1, a + HALF_THICKNESS]);
    };
    if (type === EDGE_DOOR) {
        push(b - 0.5 - HALF_THICKNESS, b - HALF_DOOR);
        push(b + HALF_DOOR, b + 0.5 + HALF_THICKNESS);
    } else {
        push(b - 0.5 - HALF_THICKNESS, b + 0.5 + HALF_THICKNESS);
    }
}

/**
 * Box of the pillar on the corner owned by cell (x, z).
 * @param {number} [half] Half width. Level 1's columns are bigger than Level 0's pillars.
 */
export function pillarBox(x, z, half = HALF_PILLAR) {
    return [x + 0.5 - half, z + 0.5 - half, x + 0.5 + half, z + 0.5 + half];
}

/**
 * True if a point on the edge's line is inside its solid part.
 * @param {number} type
 * @param {number} along Offset along the edge from its midpoint.
 * @param {number} y
 */
export function edgeSolidAt(type, along, y) {
    if (type === EDGE_NONE || y < 0 || y > WALL_HEIGHT) return false;
    if (type === EDGE_DOOR) return y >= DOOR_HEIGHT || Math.abs(along) >= HALF_DOOR;
    return true;
}
