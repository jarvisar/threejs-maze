import { DIRECTIONS } from './grid.js';

/*
 * Uneven floor for Level 37 (see poolrooms.js), with sunken pools and stairs down into them. Other levels are flat
 * at y = 0 and have no Ground.
 */

/** Floor heights are stored in 1/64 unit steps (about 4 cm). */
export const HEIGHT_STEP = 1 / 64;

/**
 * @typedef {object} Ground A chunk's floor (see ChunkStore.groundAt).
 * @property {Int8Array} heights Floor height per cell in HEIGHT_STEPs, indexed like the chunk's edges.
 * @property {Uint8Array} stairs 0 for no stair, else 1 + the DIRECTIONS index pointing down. A stair runs from its
 *     top at the entry edge down to the cell's height at the opposite edge.
 * @property {Int8Array} tops Height at the top of each stair.
 */

/**
 * Floor height at a point (units). Flat per cell. Stairs are a ramp through the middle of the steps (the steps
 * themselves are in poolroomsGeometry.js).
 * @param {Ground} ground
 * @param {number} k Cell index in the chunk.
 * @param {number} fx Offset from the cell's middle, -0.5..0.5.
 * @param {number} fz
 */
export function groundIn(ground, k, fx, fz) {
    const low = ground.heights[k] * HEIGHT_STEP;
    const stair = ground.stairs[k];
    if (stair === 0) return low;
    const top = ground.tops[k] * HEIGHT_STEP;
    const [dx, dz] = DIRECTIONS[stair - 1];
    // 0 at the top edge, 1 at the bottom.
    const s = 0.5 + dx * fx + dz * fz;
    const t = Math.min(Math.max(s + 0.5 / stairSteps(top - low), 0), 1);
    return top + (low - top) * t;
}

/** Step count for a stair's drop (units). Each step is about 0.07 units (19 cm) high. */
export function stairSteps(drop) {
    return Math.max(2, Math.round(drop / 0.07));
}
