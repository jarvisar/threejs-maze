import { PILLAR_SIZE, WALL_HEIGHT } from '../config.js';
import { EDGE_NONE, edgeSolidAt } from '../world/grid.js';

const HALF_PILLAR = PILLAR_SIZE / 2;

/**
 * @typedef {object} WorldHit
 * @property {'edge' | 'pillar' | 'prop' | 'floor' | 'ceiling'} kind
 * @property {number} x Cell owning the edge or pillar corner, or the cell under the hit point.
 * @property {number} z
 * @property {0 | 1} [axis] For edges (see grid.js).
 * @property {import('../world/decorations.js').Prop} [prop] For props.
 * @property {number} distance
 * @property {[number, number, number]} point Where the ray hit.
 */

/**
 * @typedef {object} WorldQuery
 * @property {(x: number, z: number, axis: 0 | 1) => number} edge
 * @property {(x: number, z: number) => boolean} pillar
 * @property {number} [pillarHalf] Half a pillar's width, if it isn't Level 0's.
 * @property {(x: number, z: number) => readonly import('../world/decorations.js').Prop[]} [propsAt] The props
 *     in cell (x, z); only needed when the ray is to hit props.
 */

/**
 * Casts a ray through the level: thin walls on cell borders (treated as having no thickness, which is
 * plenty for aiming at them), doorway openings, pillars, the floor (y = 0) and the ceiling (y = WALL_HEIGHT,
 * only from below), and optionally the props on the floor. Steps through the grid cell by cell (a 2D DDA), so
 * the cost depends only on the distance travelled, not on how much is in the world.
 *
 * @param {number} ox Ray origin
 * @param {number} oy
 * @param {number} oz
 * @param {number} dx Normalized ray direction
 * @param {number} dy
 * @param {number} dz
 * @param {number} maxDistance
 * @param {WorldQuery} world
 * @param {((prop: import('../world/decorations.js').Prop) => readonly number[]) | null} [pickBox] To hit props
 *     too (edit mode aims at them): the box each is hit as, in its own frame (turned by its yaw about its
 *     position), [minX, minY, minZ, maxX, maxY, maxZ]. Props keep inside their cell, so only the props of the
 *     cells the ray crosses are tried.
 * @returns {WorldHit | null}
 */
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxDistance, world, pickBox = null) {
    const tFloor = dy < 0 && oy > 0 ? -oy / dy : Infinity;
    const tCeiling = dy > 0 && oy < WALL_HEIGHT ? (WALL_HEIGHT - oy) / dy : Infinity;
    const tPlane = Math.min(tFloor, tCeiling);
    const limit = Math.min(maxDistance, tPlane);
    const at = (t) => /** @type {[number, number, number]} */ ([ox + dx * t, oy + dy * t, oz + dz * t]);

    let cellX = Math.floor(ox + 0.5);
    let cellZ = Math.floor(oz + 0.5);
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx > 0 ? (cellX + 0.5 - ox) / dx : dx < 0 ? (cellX - 0.5 - ox) / dx : Infinity;
    let tMaxZ = dz > 0 ? (cellZ + 0.5 - oz) / dz : dz < 0 ? (cellZ - 0.5 - oz) / dz : Infinity;
    let tEnter = 0;

    for (let guard = 0; guard < 1024; guard++) {
        const tExit = Math.min(tMaxX, tMaxZ);
        /** @type {WorldHit | null} */
        let nearest = null;

        // Pillars stand on the cell's corners and poke into it.
        for (let px = cellX - 1; px <= cellX; px++) {
            for (let pz = cellZ - 1; pz <= cellZ; pz++) {
                if (!world.pillar(px, pz)) continue;
                const x = px + 0.5;
                const z = pz + 0.5;
                const half = world.pillarHalf ?? HALF_PILLAR;
                const t = rayBox(ox, oy, oz, dx, dy, dz, x - half, 0, z - half, x + half, WALL_HEIGHT, z + half);
                if (t >= tEnter - 1e-9 && t <= tExit && t <= limit && (!nearest || t < nearest.distance)) {
                    nearest = { kind: 'pillar', x: px, z: pz, distance: t, point: at(t) };
                }
            }
        }

        if (pickBox && world.propsAt) {
            for (const prop of world.propsAt(cellX, cellZ)) {
                // Into the prop's own frame: moved to its position, and turned back by its yaw.
                const cos = Math.cos(prop.yaw);
                const sin = Math.sin(prop.yaw);
                const rx = ox - prop.x;
                const rz = oz - prop.z;
                const [x0, y0, z0, x1, y1, z1] = pickBox(prop);
                const t = rayBox(
                    rx * cos - rz * sin, oy, rx * sin + rz * cos,
                    dx * cos - dz * sin, dy, dx * sin + dz * cos,
                    x0, y0, z0, x1, y1, z1,
                );
                if (t <= tExit && t <= limit && (!nearest || t < nearest.distance)) {
                    nearest = { kind: 'prop', x: cellX, z: cellZ, prop, distance: t, point: at(t) };
                }
            }
        }

        if (nearest) return nearest;
        if (tExit > limit) break;

        if (tMaxX < tMaxZ) {
            const owner = stepX > 0 ? cellX : cellX - 1;
            const t = tMaxX;
            const type = world.edge(owner, cellZ, 0);
            if (type !== EDGE_NONE && edgeSolidAt(type, oz + dz * t - cellZ, oy + dy * t)) {
                return { kind: 'edge', x: owner, z: cellZ, axis: 0, distance: t, point: at(t) };
            }
            cellX += stepX;
            tEnter = t;
            tMaxX += tDeltaX;
        } else {
            const owner = stepZ > 0 ? cellZ : cellZ - 1;
            const t = tMaxZ;
            const type = world.edge(cellX, owner, 1);
            if (type !== EDGE_NONE && edgeSolidAt(type, ox + dx * t - cellX, oy + dy * t)) {
                return { kind: 'edge', x: cellX, z: owner, axis: 1, distance: t, point: at(t) };
            }
            cellZ += stepZ;
            tEnter = t;
            tMaxZ += tDeltaZ;
        }
    }

    if (tPlane <= maxDistance) {
        const point = at(tPlane);
        return {
            kind: tPlane === tFloor ? 'floor' : 'ceiling',
            x: Math.floor(point[0] + 0.5),
            z: Math.floor(point[2] + 0.5),
            distance: tPlane,
            point,
        };
    }

    return null;
}

/** Entry distance of the ray into a box (Infinity if it misses). Slab method. */
function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
    let tNear = -Infinity;
    let tFar = Infinity;
    for (const [o, d, min, max] of [
        [ox, dx, minX, maxX],
        [oy, dy, minY, maxY],
        [oz, dz, minZ, maxZ],
    ]) {
        if (d === 0) {
            if (o < min || o > max) return Infinity;
            continue;
        }
        let t0 = (min - o) / d;
        let t1 = (max - o) / d;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tNear = Math.max(tNear, t0);
        tFar = Math.min(tFar, t1);
    }
    return tNear <= tFar && tFar >= 0 ? Math.max(tNear, 0) : Infinity;
}
