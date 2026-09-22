import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, PILLAR_SIZE, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';

/*
 * The level is a grid of unit cells centred on integer (x, z) coordinates. Walls don't fill cells; they run
 * along the lines between them:
 *
 *   - Every cell owns the edge on its +x side (axis 0, the line x + 0.5, running along z) and the edge on
 *     its +z side (axis 1, the line z + 0.5, running along x).
 *   - Every cell also owns the corner on its +x+z side, at (x + 0.5, z + 0.5), which can hold a pillar.
 *
 * An edge is open, a solid wall, or a wall with a doorway through it.
 */

export const EDGE_NONE = 0;
export const EDGE_WALL = 1;
export const EDGE_DOOR = 2;

const HALF_THICKNESS = WALL_THICKNESS / 2;
const HALF_DOOR = DOOR_WIDTH / 2;
const HALF_PILLAR = PILLAR_SIZE / 2;

/** The chunk coordinate containing integer cell coordinate `c`. */
export function chunkCoord(c) {
    return Math.floor((c + HALF_CHUNK) / CHUNK_SIZE);
}

/** The cell containing world position `p`. */
export function cellCoord(p) {
    return Math.floor(p + 0.5);
}

/** A unique numeric key for a chunk (exact for |cz| < 2^25). */
export function chunkKey(cx, cz) {
    return cx * 67108864 + cz;
}

/**
 * The solid boxes (in the XZ plane) of one edge, as [minX, minZ, maxX, maxZ] tuples pushed onto `out`.
 * A wall is one box that reaches half a thickness past both ends of the edge, so walls meeting at a corner
 * overlap there and leave no gap. A doorway is the two pieces of wall either side of the opening (the
 * lintel above it is out of reach).
 *
 * @param {number} x Cell owning the edge.
 * @param {number} z
 * @param {0 | 1} axis
 * @param {number} type
 * @param {number[][]} out
 */
export function edgeBoxes(x, z, axis, type, out) {
    if (type === EDGE_NONE) return;
    // "a" runs across the wall (its thickness), "b" along it.
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

/** The box of a pillar standing on the corner owned by cell (x, z). */
export function pillarBox(x, z) {
    return [x + 0.5 - HALF_PILLAR, z + 0.5 - HALF_PILLAR, x + 0.5 + HALF_PILLAR, z + 0.5 + HALF_PILLAR];
}

/**
 * Whether a point on an edge's line is inside the solid part of the edge.
 * @param {number} type
 * @param {number} along Offset from the edge's midpoint, along the edge.
 * @param {number} y Height.
 */
export function edgeSolidAt(type, along, y) {
    if (type === EDGE_NONE || y < 0 || y > WALL_HEIGHT) return false;
    if (type === EDGE_DOOR) return y >= DOOR_HEIGHT || Math.abs(along) >= HALF_DOOR;
    return true;
}
