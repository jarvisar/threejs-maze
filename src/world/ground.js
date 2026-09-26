import { DIRECTIONS } from './grid.js';

/*
 * A floor that isn't flat: Level 37's (see poolrooms.js), where pools are sunk into it and stairs go down into them.
 * Every other level's floor is flat at y = 0, and has no Ground.
 */

/** Floor heights are kept in steps of 1/64 of a unit (about 4 cm). */
export const HEIGHT_STEP = 1 / 64;

/**
 * @typedef {object} Ground A chunk's floor (see ChunkStore.groundAt).
 * @property {Int8Array} heights Each cell's floor, in HEIGHT_STEPs, indexed like the chunk's edges.
 * @property {Uint8Array} stairs Each cell's stair: 0, or 1 + the index in DIRECTIONS of the way down it. A stair
 *     goes from its top (at the edge it's entered from above) down to the cell's height (at the opposite edge).
 * @property {Int8Array} tops The height at the top of each stair.
 */

/**
 * The height of the floor at a point, in units: flat in each cell, and up and down the stairs as a ramp through the
 * middle of their steps (see poolroomsGeometry.js for the steps themselves).
 * @param {Ground} ground
 * @param {number} k The cell's index in its chunk.
 * @param {number} fx Where in the cell, from its middle: -0.5..0.5.
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

/** How many steps a stair has for its drop (in units): each about 7 cm high (19 cm). */
export function stairSteps(drop) {
    return Math.max(2, Math.round(drop / 0.07));
}
