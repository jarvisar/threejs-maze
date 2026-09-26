import { hashFloat } from './random.js';

/*
 * Wall outlets: small plates just above the floor, on a few walls. Each side of each wall can have one, somewhere
 * along it. Where a level has them (see `outlets` in levels.js), the seed puts them on a few walls; edit mode puts
 * them up and takes them down anywhere, and those changes are kept per chunk (ChunkData.outlets).
 */

export const OUTLET_WIDTH = 0.034;
export const OUTLET_HEIGHT = 0.052;
export const OUTLET_Y = 0.085;
// How far one the seed puts up can be from the middle of its wall.
const SEEDED_ALONG = 0.3;

/**
 * Which of a cell's four outlet places this is: its +x wall (axis 0) or +z wall (axis 1), on the side facing +
 * (side 1) or − (side −1). Along with the cell's index in its chunk, it addresses the outlet (see outletSlot).
 * @param {0 | 1} axis
 * @param {number} side
 */
export function outletSlot(index, axis, side) {
    return index * 4 + axis * 2 + (side > 0 ? 1 : 0);
}

/**
 * Where the seed puts an outlet on that side of the wall: how far along it from its middle, or null for none.
 * @param {number} seed
 */
export function seededOutlet(seed, x, z, axis, side) {
    if (hashFloat(seed, 0x0071, x, z, axis * 2 + (side > 0 ? 1 : 0)) >= 0.045) return null;
    return (hashFloat(seed, 0x0072, x, z, axis) - 0.5) * 2 * SEEDED_ALONG;
}

/** How far from the middle of a wall an outlet can go, clear of the pillars that could be at its ends. */
export function outletReach(pillarHalf) {
    return Math.min(SEEDED_ALONG, 0.5 - pillarHalf - OUTLET_WIDTH / 2 - 0.01);
}

// Edits are kept as whole numbers (see edits.js): 0 for none, else where along the wall to a thousandth.
export function encodeOutlet(along) {
    return along === null ? 0 : 1 + Math.round((Math.min(Math.max(along, -0.5), 0.5) + 0.5) * 1000);
}

export function decodeOutlet(value) {
    return value <= 0 ? null : Math.min(value - 1, 1000) / 1000 - 0.5;
}
