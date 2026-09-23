// Collision against the level's solid boxes (walls, the sides of doorways, pillars). The player is an
// axis-aligned square of half-size `radius` in the XZ plane.

const EPSILON = 1e-6;

/**
 * @callback BoxQuery
 * @param {number} minX
 * @param {number} minZ
 * @param {number} maxX
 * @param {number} maxZ
 * @param {boolean} [doorsSolid] Treat doorways as solid (for when the player's head is above them).
 * @returns {number[][]} Boxes as [minX, minZ, maxX, maxZ] that might overlap the rectangle.
 */

/**
 * Moves `position` by (dx, dz), resolving each axis separately so the player slides along walls instead of
 * stopping dead when brushing one. Each axis is swept, so even a step longer than a wall is thick can't
 * pass through it.
 *
 * @param {{ x: number, z: number }} position Mutated in place.
 * @param {number} dx
 * @param {number} dz
 * @param {number} radius
 * @param {BoxQuery} boxesNear
 * @param {boolean} [doorsSolid]
 * @returns {{ hitX: boolean, hitZ: boolean }}
 */
export function moveAndCollide(position, dx, dz, radius, boxesNear, doorsSolid = false) {
    const boxes = boxesNear(
        Math.min(position.x, position.x + dx) - radius,
        Math.min(position.z, position.z + dz) - radius,
        Math.max(position.x, position.x + dx) + radius,
        Math.max(position.z, position.z + dz) + radius,
        doorsSolid,
    );
    let hitX = false;
    let hitZ = false;

    if (dx !== 0) {
        const start = position.x;
        let x = start + dx;
        for (const [minX, minZ, maxX, maxZ] of boxes) {
            if (position.z + radius <= minZ || position.z - radius >= maxZ) continue;
            // Only boxes ahead of the player block it (one it's somehow already inside shouldn't fling it out).
            if (dx > 0 && minX >= start + radius - EPSILON && minX < x + radius) {
                x = minX - radius - EPSILON;
                hitX = true;
            } else if (dx < 0 && maxX <= start - radius + EPSILON && maxX > x - radius) {
                x = maxX + radius + EPSILON;
                hitX = true;
            }
        }
        position.x = x;
    }

    if (dz !== 0) {
        const start = position.z;
        let z = start + dz;
        for (const [minX, minZ, maxX, maxZ] of boxes) {
            if (position.x + radius <= minX || position.x - radius >= maxX) continue;
            if (dz > 0 && minZ >= start + radius - EPSILON && minZ < z + radius) {
                z = minZ - radius - EPSILON;
                hitZ = true;
            } else if (dz < 0 && maxZ <= start - radius + EPSILON && maxZ > z - radius) {
                z = maxZ + radius + EPSILON;
                hitZ = true;
            }
        }
        position.z = z;
    }

    return { hitX, hitZ };
}

/** Whether a player-sized square at (x, z) overlaps anything solid. */
export function overlapsSolid(x, z, radius, boxesNear, doorsSolid = false) {
    for (const [minX, minZ, maxX, maxZ] of boxesNear(x - radius, z - radius, x + radius, z + radius, doorsSolid)) {
        if (x + radius > minX && x - radius < maxX && z + radius > minZ && z - radius < maxZ) return true;
    }
    return false;
}

/**
 * Somewhere nearby where a player-sized square fits: the position itself if it's clear, otherwise the
 * centre of the cell it's in. Walls only run along cell borders and pillars stand in the corners, so the
 * middle of a cell is clear of those; something left on the floor there sends you to the next cell over.
 * Used when landing on top of a wall after flying in edit mode.
 * @returns {{ x: number, z: number }}
 */
export function findFreeSpot(x, z, radius, boxesNear, doorsSolid = false) {
    if (!overlapsSolid(x, z, radius, boxesNear, doorsSolid)) return { x, z };
    const cx = Math.floor(x + 0.5);
    const cz = Math.floor(z + 0.5);
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!overlapsSolid(cx + dx, cz + dz, radius, boxesNear, doorsSolid)) return { x: cx + dx, z: cz + dz };
    }
    return { x: cx, z: cz };
}
