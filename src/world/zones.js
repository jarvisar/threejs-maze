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
// Level 1's (see levelOne.js).
export const ZONE_PARKING = 5; // a car park: open floor on a grid of columns
export const ZONE_STORAGE = 6; // the same, full of racking, pallets and crates
export const ZONE_SERVICE = 7; // concrete corridors and plant rooms behind the car park
// Level 37's (see poolrooms.js).
export const ZONE_BATHS = 8; // great tiled halls of pools under skylights, on a grid of columns
export const ZONE_FLOODED = 9; // tiled rooms opening into each other, the floor under water, some of them pools
export const ZONE_CHANNELS = 10; // long flooded corridors with rooms off them
export const ZONE_DEEP = 11; // dark water over your head, narrow walkways across it, lamps under the surface

export const ZONE_NAMES = ['rooms', 'halls', 'maze', 'pillars', 'open', 'parking', 'storage', 'service', 'baths', 'flooded', 'channels', 'deep'];

const SITE_SPACING = 3;

/**
 * @typedef {object} ZoneMix What a level's regions are made of (see zoneAt).
 * @property {readonly (readonly [number, number])[]} weights Each zone it has, and how often it comes up against
 *     the others.
 * @property {number} start The zone of the chunk every world starts in.
 * @property {number} salt Keeps a level's regions apart from another's with the same seed: 0 for Level 0's, which
 *     are where they always were.
 */

/** Level 0's (see levels.js). */
export const LEVEL_ZERO_ZONES = Object.freeze({
    weights: [
        [ZONE_ROOMS, 38],
        [ZONE_HALLS, 20],
        [ZONE_MAZE, 11],
        [ZONE_PILLARS, 17],
        [ZONE_OPEN, 14],
    ],
    // Offices, so every world starts the same way.
    start: ZONE_ROOMS,
    salt: 0,
});

/**
 * @typedef {object} Zone
 * @property {number} type One of the ZONE_* constants.
 * @property {number} variant A 32-bit value shared by every chunk of the region, for region-wide choices
 *     (such as the spacing of a pillar hall's grid, which has to line up across chunk borders).
 */

/**
 * The zone of a chunk, from a level's mix of them.
 * @param {number} seed
 * @param {number} cx
 * @param {number} cz
 * @param {ZoneMix} [mix]
 * @returns {Zone}
 */
export function zoneAt(seed, cx, cz, mix = LEVEL_ZERO_ZONES) {
    const salt = mix.salt;
    // The spawn chunk is always the same kind.
    if (cx === 0 && cz === 0) return { type: mix.start, variant: hashInts(seed, 0x5a0 ^ salt) };

    const sx = Math.floor(cx / SITE_SPACING);
    const sz = Math.floor(cz / SITE_SPACING);
    let bestX = 0;
    let bestZ = 0;
    let bestDistance = Infinity;
    for (let ix = sx - 1; ix <= sx + 1; ix++) {
        for (let iz = sz - 1; iz <= sz + 1; iz++) {
            const px = (ix + hashFloat(seed, 0x51e ^ salt, ix, iz)) * SITE_SPACING;
            const pz = (iz + hashFloat(seed, 0x51f ^ salt, ix, iz)) * SITE_SPACING;
            const distance = (cx + 0.5 - px) ** 2 + (cz + 0.5 - pz) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestX = ix;
                bestZ = iz;
            }
        }
    }

    let total = 0;
    for (const [, weight] of mix.weights) total += weight;
    let pick = hashFloat(seed, 0x20e ^ salt, bestX, bestZ) * total;
    let type = mix.weights[0][0];
    for (const [zone, weight] of mix.weights) {
        if (pick < weight) {
            type = zone;
            break;
        }
        pick -= weight;
    }
    return { type, variant: hashInts(seed, 0x7a7 ^ salt, bestX, bestZ) };
}

/** Whether a zone is mostly walled in (as opposed to open floor). */
export function isEnclosed(type) {
    return type === ZONE_ROOMS || type === ZONE_HALLS || type === ZONE_MAZE || type === ZONE_SERVICE || type === ZONE_FLOODED || type === ZONE_CHANNELS;
}
