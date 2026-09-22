// Collision against the wall grid. Walls are unit cells centred on integer coordinates; the player is an
// axis-aligned square of half-size `radius` in the XZ plane.

const EPSILON = 1e-6;

/**
 * Moves `position` by (dx, dz), resolving each axis separately so the player slides along walls instead of
 * stopping dead when brushing one. Steps are assumed to be smaller than `radius` (no tunnelling).
 *
 * @param {{ x: number, z: number }} position Mutated in place.
 * @param {number} dx
 * @param {number} dz
 * @param {number} radius
 * @param {(x: number, z: number) => boolean} isWall
 * @returns {{ hitX: boolean, hitZ: boolean }}
 */
export function moveAndCollide(position, dx, dz, radius, isWall) {
    let hitX = false;
    let hitZ = false;

    if (dx !== 0) {
        position.x += dx;
        const wallX = firstBlockingCell(position.x, position.z, radius, isWall, dx > 0, 'x');
        if (wallX !== null) {
            position.x = dx > 0 ? wallX - 0.5 - radius - EPSILON : wallX + 0.5 + radius + EPSILON;
            hitX = true;
        }
    }

    if (dz !== 0) {
        position.z += dz;
        const wallZ = firstBlockingCell(position.x, position.z, radius, isWall, dz > 0, 'z');
        if (wallZ !== null) {
            position.z = dz > 0 ? wallZ - 0.5 - radius - EPSILON : wallZ + 0.5 + radius + EPSILON;
            hitZ = true;
        }
    }

    return { hitX, hitZ };
}

/** Whether a player-sized square at (x, z) overlaps any wall. */
export function overlapsWall(x, z, radius, isWall) {
    const x0 = firstCell(x - radius), x1 = lastCell(x + radius);
    const z0 = firstCell(z - radius), z1 = lastCell(z + radius);
    for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
            if (isWall(cx, cz)) return true;
        }
    }
    return false;
}

/**
 * Finds the nearest cell centre where a player-sized square fits, searching outward in rings.
 * Used to rescue the player when they land on top of a wall after flying in edit mode.
 * @returns {{ x: number, z: number }}
 */
export function findFreeSpot(x, z, radius, isWall, maxRing = 12) {
    if (!overlapsWall(x, z, radius, isWall)) return { x, z };
    const ox = Math.floor(x + 0.5);
    const oz = Math.floor(z + 0.5);
    for (let ring = 0; ring <= maxRing; ring++) {
        let best = null;
        let bestDistance = Infinity;
        for (let cx = ox - ring; cx <= ox + ring; cx++) {
            for (let cz = oz - ring; cz <= oz + ring; cz++) {
                if (Math.max(Math.abs(cx - ox), Math.abs(cz - oz)) !== ring) continue;
                if (overlapsWall(cx, cz, radius, isWall)) continue;
                const distance = (cx - x) ** 2 + (cz - z) ** 2;
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = { x: cx, z: cz };
                }
            }
        }
        if (best) return best;
    }
    return { x, z };
}

// Index of the first/last cell overlapped by an interval edge. Cell c spans [c - 0.5, c + 0.5].
function firstCell(min) {
    return Math.floor(min + 0.5);
}

function lastCell(max) {
    return Math.ceil(max + 0.5) - 1;
}

/**
 * Among the walls overlapping the square at (x, z), returns the coordinate (on `axis`) of the one that
 * blocks movement first, i.e. the nearest along the direction of travel. Null if nothing overlaps.
 */
function firstBlockingCell(x, z, radius, isWall, positive, axis) {
    const x0 = firstCell(x - radius), x1 = lastCell(x + radius);
    const z0 = firstCell(z - radius), z1 = lastCell(z + radius);
    let blocking = null;
    for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
            if (!isWall(cx, cz)) continue;
            const c = axis === 'x' ? cx : cz;
            if (blocking === null || (positive ? c < blocking : c > blocking)) blocking = c;
        }
    }
    return blocking;
}
