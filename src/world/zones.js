import { hashFloat, hashInts } from './random.js';

/*
 * Every chunk is laid out as one kind of space ("zone"). Zones are chosen per region rather than per chunk:
 * sites are scattered one per SITE_SPACING × SITE_SPACING chunks and each chunk takes the zone of the
 * nearest site, so the level clumps into irregular patches of offices, corridors, pillar halls and so on
 * instead of changing character every few steps.
 */

export const ZONE_ROOMS = 0; // offices: rooms of all sizes opening into each other
export const ZONE_HALLS = 1; // long corridors with small rooms off them
export const ZONE_MAZE = 2; // a tight labyrinth of one-cell passages
export const ZONE_PILLARS = 3; // a huge hall held up by a grid of pillars
export const ZONE_OPEN = 4; // a vast, nearly empty floor with the odd stray wall

export const ZONE_NAMES = ['rooms', 'halls', 'maze', 'pillars', 'open'];

const SITE_SPACING = 3;

// Relative frequency of each zone.
const ZONE_WEIGHTS = [
    [ZONE_ROOMS, 38],
    [ZONE_HALLS, 20],
    [ZONE_MAZE, 11],
    [ZONE_PILLARS, 17],
    [ZONE_OPEN, 14],
];
const TOTAL_WEIGHT = ZONE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);

/**
 * @typedef {object} Zone
 * @property {number} type One of the ZONE_* constants.
 * @property {number} variant A 32-bit value shared by every chunk of the region, for region-wide choices
 *     (such as the spacing of a pillar hall's grid, which has to line up across chunk borders).
 */

/**
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @returns {Zone}
 */
export function zoneAt(seed, cx, cz) {
    // The spawn chunk is always offices, so every world starts the same way.
    if (cx === 0 && cz === 0) return { type: ZONE_ROOMS, variant: hashInts(seed, 0x5a0) };

    const sx = Math.floor(cx / SITE_SPACING);
    const sz = Math.floor(cz / SITE_SPACING);
    let bestX = 0;
    let bestZ = 0;
    let bestDistance = Infinity;
    for (let ix = sx - 1; ix <= sx + 1; ix++) {
        for (let iz = sz - 1; iz <= sz + 1; iz++) {
            const px = (ix + hashFloat(seed, 0x51e, ix, iz)) * SITE_SPACING;
            const pz = (iz + hashFloat(seed, 0x51f, ix, iz)) * SITE_SPACING;
            const distance = (cx + 0.5 - px) ** 2 + (cz + 0.5 - pz) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestX = ix;
                bestZ = iz;
            }
        }
    }

    let pick = hashFloat(seed, 0x20e, bestX, bestZ) * TOTAL_WEIGHT;
    let type = ZONE_ROOMS;
    for (const [zone, weight] of ZONE_WEIGHTS) {
        if (pick < weight) {
            type = zone;
            break;
        }
        pick -= weight;
    }
    return { type, variant: hashInts(seed, 0x7a7, bestX, bestZ) };
}

/** Whether a zone is mostly walled in (as opposed to open floor). */
export function isEnclosed(type) {
    return type === ZONE_ROOMS || type === ZONE_HALLS || type === ZONE_MAZE;
}
