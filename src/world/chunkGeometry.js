import { PlaneGeometry } from 'three';
import { CHUNK_SIZE, DOOR_HEIGHT, HALF_CHUNK, PANEL_HALF_X, PANEL_HALF_Z, PILLAR_SIZE, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { buildDecalGeometry } from './decals.js';
import { isPartyProp } from './decorations.js';
import { GeometryBuilder, verticalQuad } from './GeometryBuilder.js';
import { EDGE_WALL } from './grid.js';
import { levelById } from './levels.js';
import { OUTLET_HEIGHT, OUTLET_WIDTH, OUTLET_Y, VENT_HALF, ventAt } from './outlets.js';
import { buildPartyGeometry, partyShadowRadius } from './partyGeometry.js';
import { buildPropGeometry, buildPropGlowGeometry, propShadowBox, propShadowRadius } from './props.js';
import { RegionGrid, intervalStart } from './regionGrid.js';

// Baseboard sizes match the original look: a 0.065 tall box centered on the floor (0.0325 visible) sticking
// out 0.005 from the wall.
const BASEBOARD_HEIGHT = 0.0325;
const BASEBOARD_DEPTH = 0.005;

// Soft shade strips where walls meet the floor, ceiling and each other (see the shade material). Widths, plus how
// far each floats off its surface.
const SHADE_FLOOR = 0.14;
const SHADE_CEILING = 0.11;
const SHADE_CORNER = 0.08;
const SHADE_LIFT = 0.0015;
/** Shade texture columns, one per kind of join. materials.js sets how dark each is. */
export const SHADE_COLUMNS = 4;
const SHADE_FLOOR_U = 0.5 / SHADE_COLUMNS;
const SHADE_CEILING_U = 1.5 / SHADE_COLUMNS;
const SHADE_CORNER_U = 2.5 / SHADE_COLUMNS;
const SHADE_PROP_U = 3.5 / SHADE_COLUMNS;
// Sides of the round shadow under a prop.
const SHADOW_SIDES = 12;

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;
const HALF_PILLAR = PILLAR_SIZE / 2;

// Walls are built in two layers, below and above door height. Splitting every face at the same height keeps
// neighboring faces' vertices lined up so there are no hairline cracks.
const LAYERS = [
    [0, DOOR_HEIGHT],
    [DOOR_HEIGHT, WALL_HEIGHT],
];

/**
 * Builds a chunk's meshes: walls, baseboards, details (outlets, vents), decals (decals.js), props (props.js) and
 * Level Fun's party (partyGeometry.js).
 *
 * Positions are relative to the chunk center to keep float precision far from the origin. Wallpaper UVs come from
 * positions so the pattern runs seamlessly along a wall.
 *
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} cx
 * @param {number} cz
 * @returns {ChunkGeometry}
 */
export function buildChunkGeometry(store, cx, cz) {
    return finish(chunkGeometrySteps(store, cx, cz));
}

/**
 * @typedef {{
 *     walls: import('three').BufferGeometry | null,
 *     baseboards: import('three').BufferGeometry | null,
 *     details: import('three').BufferGeometry | null,
 *     shade: import('three').BufferGeometry | null,
 *     decals: import('three').BufferGeometry | null,
 *     ceilingDecals: import('three').BufferGeometry | null,
 *     props: import('three').BufferGeometry | null,
 *     propGlows: import('three').BufferGeometry | null,
 *     partyThings: import('three').BufferGeometry | null,
 *     partyDecals: import('three').BufferGeometry | null,
 *     balloons: import('three').BufferGeometry | null,
 *     flames: import('three').BufferGeometry | null,
 *     extras: Record<string, import('three').BufferGeometry | null>,
 * }} ChunkGeometry
 */

/**
 * buildChunkGeometry a piece at a time, so WorldView can spread a chunk over several frames: each `next()` does one
 * piece and the last returns the meshes. A level's extras can come in pieces too (see Shape.extras in levels.js).
 * The builders are shared by every chunk, so nothing else can build a chunk until this one is finished or dropped.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} cx
 * @param {number} cz
 * @returns {Generator<void, ChunkGeometry>}
 */
export function* chunkGeometrySteps(store, cx, cz) {
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const ox = cx * N; // chunk center (mesh origin)
    const oz = cz * N;
    const grid = new RegionGrid(store, x0, z0);
    const walls = wallsBuilder.reset();
    const baseboards = baseboardsBuilder.reset();
    const details = detailsBuilder.reset();
    const shade = shadeBuilder.reset();
    // Per-level options like baseboards and own pillars (see levels.js).
    const shape = levelById(store.level).shape;
    const pillars = shape.ownPillars ? pillarsBuilder.reset() : null;
    // Walls extend below the floor where it drops away (Level 37's pools).
    const layers = [[shape.wallBottom, LAYERS[0][1]], LAYERS[1]];
    // Curved coves (Level 37) have no join to shade.
    const joinShaded = !shape.coves;
    const arch = shape.doorArch;

    const rx0 = x0 * 4;
    const rx1 = (x0 + N) * 4;
    const rz0 = z0 * 4;
    const rz1 = (z0 + N) * 4;

    // Vertical faces on region boundaries across x (axis 0) and z (axis 1). Faces along a boundary line merge into
    // runs until something changes.
    for (const axis of [0, 1]) {
        for (let a = axis === 0 ? rx0 : rz0; a < (axis === 0 ? rx1 : rz1); a++) {
            const plane = intervalStart(a + 1) - (axis === 0 ? ox : oz);
            const b0 = axis === 0 ? rz0 : rx0;
            const b1 = axis === 0 ? rz1 : rx1;
            // solid(layer, region on the "a" side, region on the "a + 1" side), for this line.
            const solidAt = axis === 0
                ? (layer, ra, b) => grid.solid(layer, ra, b)
                : (layer, ra, b) => grid.solid(layer, b, ra);
            let runStart = b0;
            let runKey = 0;
            for (let b = b0; b <= b1; b++) {
                let key = 0;
                if (b < b1) {
                    for (let layer = 0; layer < 2; layer++) {
                        const low = solidAt(layer, a, b);
                        const high = solidAt(layer, a + 1, b);
                        if (low !== high) key |= (low ? 1 : 2) << (layer * 2);
                    }
                }
                if (key === runKey) continue;
                if (runKey !== 0) {
                    const s0 = intervalStart(runStart) - (axis === 0 ? oz : ox);
                    const s1 = intervalStart(b) - (axis === 0 ? oz : ox);
                    for (let layer = 0; layer < 2; layer++) {
                        const face = (runKey >> (layer * 2)) & 3;
                        if (face === 0) continue;
                        const normal = face === 1 ? 1 : -1;
                        const [y0, y1] = layers[layer];
                        if (arch !== null && layer === 0) {
                            // Split at the doorway arch's spring line (see Shape.doorArch).
                            wallQuad(walls, axis, normal, plane, s0, s1, y0, arch);
                            wallQuad(walls, axis, normal, plane, s0, s1, arch, y1);
                        } else if (arch !== null && (runStart & 3) === 1 && b === runStart + 1 && (runKey & 3) === 0) {
                            // Above a doorway, split down the middle where the arch's crown meets it.
                            const middle = (s0 + s1) / 2;
                            wallQuad(walls, axis, normal, plane, s0, middle, y0, y1);
                            wallQuad(walls, axis, normal, plane, middle, s1, y0, y1);
                        } else {
                            wallQuad(walls, axis, normal, plane, s0, s1, y0, y1);
                        }
                        const solidSide = face === 1 ? a : a + 1;
                        const openSide = face === 1 ? a + 1 : a;
                        if (layer === 0) {
                            // Extend the baseboard around outside corners.
                            const convex = (bb) => !solidAt(0, solidSide, bb) && !solidAt(0, openSide, bb);
                            const e0 = convex(runStart - 1) ? BASEBOARD_DEPTH : 0;
                            const e1 = convex(b) ? BASEBOARD_DEPTH : 0;
                            if (shape.baseboards && axis === 0) baseboard(baseboards, axis, normal, plane, s0 - e0, s1 + e1);
                            else if (shape.baseboards) {
                                // Where an x and z baseboard meet, the z one owns the shared square. This one stops
                                // at its front (inside corner) and its ledge stops short (outside corner) so the
                                // ledges don't overlap and z-fight.
                                const c0 = solidAt(0, openSide, runStart - 1) ? BASEBOARD_DEPTH : 0;
                                const c1 = solidAt(0, openSide, b) ? BASEBOARD_DEPTH : 0;
                                baseboard(baseboards, axis, normal, plane, s0 - e0 + c0, s1 + e1 - c1, s0 + c0, s1 - c1);
                            }
                            if (shape.floorShade) joinShade(shade, axis, normal, plane, s0, s1, SHADE_LIFT, 1, SHADE_FLOOR, SHADE_FLOOR_U);
                        } else if (joinShaded) {
                            joinShade(shade, axis, normal, plane, s0, s1, WALL_HEIGHT - SHADE_LIFT, -1, SHADE_CEILING, SHADE_CEILING_U);
                        }
                        // Inside corners, where another wall crosses the end of this face.
                        if (joinShaded && solidAt(layer, openSide, runStart - 1)) cornerShade(shade, axis, normal, plane, s0, 1, y0, y1);
                        if (joinShaded && solidAt(layer, openSide, b)) cornerShade(shade, axis, normal, plane, s1, -1, y0, y1);
                    }
                }
                runStart = b;
                runKey = key;
            }
        }
        yield;
    }

    // Horizontal faces: wall tops (visible when flying) and doorway lintel undersides.
    for (let rx = rx0; rx < rx1; rx++) {
        for (let rz = rz0; rz < rz1; rz++) {
            const upper = grid.solid(1, rx, rz);
            if (!upper) continue;
            const ax = intervalStart(rx) - ox;
            const bx = intervalStart(rx + 1) - ox;
            const az = intervalStart(rz) - oz;
            const bz = intervalStart(rz + 1) - oz;
            flatQuad(walls, ax, bx, az, bz, WALL_HEIGHT, 1);
            if (!grid.solid(0, rx, rz)) flatQuad(walls, ax, bx, az, bz, DOOR_HEIGHT, -1);
        }
    }

    // Pillars, plus wall and ceiling details.
    const seed = store.seed;
    const chunk = store.getChunk(cx, cz);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            // Skipped when the level's extras build them (Level 37's round columns).
            if (store.pillar(x, z) && shape.pillarMesh) pillar(pillars ?? walls, shape.baseboards ? baseboards : null, shade, x + 0.5 - ox, z + 0.5 - oz, store.pillarHalf);
            addOutlets(details, store, grid, x, z, ox, oz);
            // Ceiling vents (see ventAt). Flat ceilings only (not Level 37's vaults), and not under a stain since
            // the stain would draw over it.
            if (shape.ceiling && ventAt(seed, x, z) && !chunk.leaks.some((leak) => Math.round(leak.x) === x && Math.round(leak.z) === z)) {
                const s = VENT_HALF;
                const lx = x - ox;
                const lz = z - oz;
                details.quad(
                    lx - s, WALL_HEIGHT - 0.001, lz - s,
                    lx + s, WALL_HEIGHT - 0.001, lz - s,
                    lx + s, WALL_HEIGHT - 0.001, lz + s,
                    lx - s, WALL_HEIGHT - 0.001, lz + s,
                    0, -1, 0,
                    0.5, 0, 1, 1,
                );
            }
        }
    }
    yield;

    if (shape.floorShade) {
        for (const prop of chunk.props) {
            // Props hung on walls get no shadow.
            const box = propShadowBox(prop);
            const radius = propShadowRadius(prop);
            if (box) boxShadow(shade, prop.x - ox, prop.z - oz, prop.yaw, box);
            else if (radius > 0) propShadow(shade, prop.x - ox, prop.z - oz, radius);
        }
    }
    // Party props placed in edit mode are drawn with the party geometry, whether or not the chunk is dressed.
    const party = chunk.party || chunk.props.some((prop) => isPartyProp(prop.type)) ? buildPartyGeometry(chunk.party ?? null, ox, oz, chunk.props) : null;
    for (const thing of chunk.party?.things ?? []) propShadow(shade, thing.x - ox, thing.z - oz, partyShadowRadius(thing));
    yield;
    const decals = shape.wallpaper ? buildDecalGeometry(store, grid, chunk, x0, z0, ox, oz, walls) : { surfaces: null, ceiling: null };
    yield;
    // Level extras. Outside a tape's walls, only what finishes off the walls (see Shape.outside).
    let extras = !store.options.isVoid?.(cx, cz)
        ? shape.extras?.(store, chunk, { pillars: pillars ?? walls, shade, pillarShade: (x, z, half) => pillarShade(shade, x, z, half) }) ?? {}
        : shape.outside?.(store, chunk) ?? {};
    if (typeof extras.next === 'function') extras = yield* extras;
    yield;
    const props = buildPropGeometry(chunk.props, ox, oz);
    yield;
    if (pillars) extras.pillars = pillars.build();
    return {
        walls: walls.build(),
        baseboards: baseboards.build(),
        details: details.build(),
        shade: shade.build(),
        decals: decals.surfaces,
        ceilingDecals: decals.ceiling,
        props,
        propGlows: buildPropGlowGeometry(chunk.props, ox, oz),
        partyThings: party?.things ?? null,
        partyDecals: party?.decals ?? null,
        balloons: party?.balloons ?? null,
        flames: party?.flames ?? null,
        extras,
    };
}

/** Vertical wall face at x = plane (axis 0) or z = plane (axis 1), spanning s0..s1 along the other axis. */
function wallQuad(builder, axis, normal, plane, s0, s1, y0, y1, v0 = y0, v1 = y1) {
    // Seen from the front, the face's "right" is +s or −s.
    const right = axis === 0 ? -normal : normal;
    const left = right > 0 ? s0 : s1;
    const rightEnd = right > 0 ? s1 : s0;
    const nx = axis === 0 ? normal : 0;
    const nz = axis === 0 ? 0 : normal;
    verticalQuad(builder, axis, plane, left, rightEnd, y0, y1, nx, nz, left * right, v0, rightEnd * right, v1);
}

/**
 * Baseboard strip from s0 to s1 along a wall face, plus the ledge on top from l0 to l1. The ledge range only
 * differs where x and z baseboards meet.
 */
function baseboard(builder, axis, normal, plane, s0, s1, l0 = s0, l1 = s1) {
    const front = plane + normal * BASEBOARD_DEPTH;
    wallQuad(builder, axis, normal, front, s0, s1, 0, BASEBOARD_HEIGHT, 0.5, 1);
    const a0 = normal > 0 ? plane : front;
    const a1 = normal > 0 ? front : plane;
    // The ledge samples a sliver along the top of the baseboard texture. Its normal points mostly into the room.
    // Facing straight up, the overhead light (which only hits upward faces) made a bright line along every wall.
    if (axis === 0) flatQuad(builder, a0, a1, l0, l1, BASEBOARD_HEIGHT, 1, 0, a0, a1, normal);
    else flatQuad(builder, l0, l1, a0, a1, BASEBOARD_HEIGHT, 1, 1, a0, a1, normal);
}

/**
 * Horizontal rect at height y, facing up (normalY = 1) or down (−1). UVs come from x and z, except on a baseboard
 * ledge where `ledgeAxis` is the axis of the baseboard's depth, from a0 to a1 (see baseboard).
 */
function flatQuad(builder, x0, x1, z0, z1, y, normalY, ledgeAxis = -1, a0 = 0, a1 = 0, wallNormal = 0) {
    // CCW seen from the side it faces.
    if (normalY > 0) {
        flatCorner(builder, x0, y, z1, normalY, ledgeAxis, a0, a1, wallNormal);
        flatCorner(builder, x1, y, z1, normalY, ledgeAxis, a0, a1, wallNormal);
        flatCorner(builder, x1, y, z0, normalY, ledgeAxis, a0, a1, wallNormal);
        flatCorner(builder, x0, y, z0, normalY, ledgeAxis, a0, a1, wallNormal);
    } else {
        flatCorner(builder, x0, y, z0, normalY, ledgeAxis, a0, a1, wallNormal);
        flatCorner(builder, x1, y, z0, normalY, ledgeAxis, a0, a1, wallNormal);
        flatCorner(builder, x1, y, z1, normalY, ledgeAxis, a0, a1, wallNormal);
        flatCorner(builder, x0, y, z1, normalY, ledgeAxis, a0, a1, wallNormal);
    }
}

// Baseboard ledge normal: mostly the wall's, tipped up a bit so it still reads as a ledge.
const LEDGE_OUT = 0.95;
const LEDGE_UP = Math.sqrt(1 - LEDGE_OUT * LEDGE_OUT);

function flatCorner(builder, x, y, z, normalY, ledgeAxis, a0, a1, wallNormal) {
    if (ledgeAxis < 0) {
        builder.vertex(x, y, z, 0, normalY, 0, x, -z);
        return;
    }
    const out = wallNormal * LEDGE_OUT;
    builder.vertex(x, y, z, ledgeAxis === 0 ? out : 0, LEDGE_UP, ledgeAxis === 1 ? out : 0, ledgeAxis === 0 ? z : x, 0.99 + 0.01 * ((ledgeAxis === 0 ? x : z) - a0) / (a1 - a0));
}

/**
 * Shade strip on the floor (facing 1) or ceiling (−1) along a wall. Darkest at the wall, fading out over `width`.
 * v goes from 0 at the wall to 1.
 */
function joinShade(builder, axis, normal, plane, s0, s1, y, facing, width, u) {
    const far = plane + normal * width;
    const at = (a, s, v) => (axis === 0 ? [a, y, s, 0, facing, 0, u, v] : [s, y, a, 0, facing, 0, u, v]);
    builder.orientedQuad(at(plane, s0, 0), at(far, s0, 1), at(far, s1, 1), at(plane, s1, 0));
}

/** Shade strip up a wall from an inside corner at `s`, fading out in direction `dir`. */
function cornerShade(builder, axis, normal, plane, s, dir, y0, y1) {
    const p = plane + normal * SHADE_LIFT;
    const far = s + dir * SHADE_CORNER;
    const nx = axis === 0 ? normal : 0;
    const nz = axis === 0 ? 0 : normal;
    const at = (along, y, v) => (axis === 0 ? [p, y, along, nx, 0, nz, SHADE_CORNER_U, v] : [along, y, p, nx, 0, nz, SHADE_CORNER_U, v]);
    builder.orientedQuad(at(s, y0, 0), at(far, y0, 1), at(far, y1, 1), at(s, y1, 0));
}

/**
 * Round shadow under a prop. A fan that's darkest in the middle (v = 0) and gone at the rim (v = 1). Each piece is
 * a quad with two corners at the middle.
 */
function propShadow(builder, x, z, radius) {
    const y = SHADE_LIFT * 0.8;
    const rim = (k) => {
        const a = (k / SHADOW_SIDES) * 2 * Math.PI;
        return [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius, 0, 1, 0, SHADE_PROP_U, 1];
    };
    const middle = [x, y, z, 0, 1, 0, SHADE_PROP_U, 0];
    for (let k = 0; k < SHADOW_SIDES; k++) builder.orientedQuad(middle, rim(k), rim(k + 1), middle);
}

/**
 * Square shadow under a prop (see propShadowBox). Darkest under [x0, z0, x1, z1] in the prop's frame, fading out a
 * bit past the edges. Rotates with the prop.
 */
function boxShadow(builder, x, z, yaw, [x0, z0, x1, z1]) {
    const y = SHADE_LIFT * 0.8;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Same y rotation as the props (see buildPropGeometry).
    const at = ([lx, lz], v) => [x + lx * cos + lz * sin, y, z + lz * cos - lx * sin, 0, 1, 0, SHADE_PROP_U, v];
    const inset = Math.min(0.05, (x1 - x0) / 4, (z1 - z0) / 4);
    const out = 0.07;
    const inner = [[x0 + inset, z0 + inset], [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], [x0 + inset, z1 - inset]];
    const outer = [[x0 - out, z0 - out], [x1 + out, z0 - out], [x1 + out, z1 + out], [x0 - out, z1 + out]];
    builder.orientedQuad(at(inner[0], 0), at(inner[1], 0), at(inner[2], 0), at(inner[3], 0));
    for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        builder.orientedQuad(at(inner[k], 0), at(outer[k], 1), at(outer[n], 1), at(inner[n], 0));
    }
}

/** Pillar on a corner. Level 1's columns (`half` wide) have no baseboards. */
function pillar(walls, baseboards, shade, x, z, half = HALF_PILLAR) {
    const [x0, x1, z0, z1] = [x - half, x + half, z - half, z + half];
    for (const [y0, y1] of LAYERS) {
        wallQuad(walls, 0, 1, x1, z0, z1, y0, y1);
        wallQuad(walls, 0, -1, x0, z0, z1, y0, y1);
        wallQuad(walls, 1, 1, z1, x0, x1, y0, y1);
        wallQuad(walls, 1, -1, z0, x0, x1, y0, y1);
    }
    flatQuad(walls, x0, x1, z0, z1, WALL_HEIGHT, 1);
    if (baseboards) {
        // Corners work like on walls. The z ledges own them.
        const d = BASEBOARD_DEPTH;
        baseboard(baseboards, 0, 1, x1, z0 - d, z1 + d);
        baseboard(baseboards, 0, -1, x0, z0 - d, z1 + d);
        baseboard(baseboards, 1, 1, z1, x0 - d, x1 + d, x0, x1);
        baseboard(baseboards, 1, -1, z0, x0 - d, x1 + d, x0, x1);
    }
    pillarShade(shade, x, z, half);
}

/**
 * Floor and ceiling shade around a pillar at (x, z). Also used by levels that build their own pillars (see
 * Shape.extras).
 */
function pillarShade(shade, x, z, half) {
    const [x0, x1, z0, z1] = [x - half, x + half, z - half, z + half];
    for (const [y, facing, width, u] of [[SHADE_LIFT, 1, SHADE_FLOOR, SHADE_FLOOR_U], [WALL_HEIGHT - SHADE_LIFT, -1, SHADE_CEILING, SHADE_CEILING_U]]) {
        joinShade(shade, 0, 1, x1, z0, z1, y, facing, width, u);
        joinShade(shade, 0, -1, x0, z0, z1, y, facing, width, u);
        joinShade(shade, 1, 1, z1, x0, x1, y, facing, width, u);
        joinShade(shade, 1, -1, z0, x0, x1, y, facing, width, u);
    }
}

/** Wall outlets just above the baseboard (see outlets.js). */
function addOutlets(details, store, grid, x, z, ox, oz) {
    for (let axis = 0; axis < 2; axis++) {
        if ((axis === 0 ? grid.ex(x, z) : grid.ez(x, z)) !== EDGE_WALL) continue;
        for (let side = 1; side >= -1; side -= 2) {
            const along = store.outlet(x, z, axis, side);
            if (along === null) continue;
            const plane = (axis === 0 ? x : z) + 0.5 + side * (HALF_THICKNESS + 0.0015) - (axis === 0 ? ox : oz);
            const centre = (axis === 0 ? z : x) + along - (axis === 0 ? oz : ox);
            // Outlet is the left half of the details atlas.
            const right = axis === 0 ? -side : side;
            const s0 = centre - OUTLET_WIDTH / 2;
            const s1 = centre + OUTLET_WIDTH / 2;
            const nx = axis === 0 ? side : 0;
            const nz = axis === 0 ? 0 : side;
            const left = right > 0 ? s0 : s1;
            const rightEnd = right > 0 ? s1 : s0;
            const y0 = OUTLET_Y - OUTLET_HEIGHT / 2;
            const y1 = OUTLET_Y + OUTLET_HEIGHT / 2;
            verticalQuad(details, axis, plane, left, rightEnd, y0, y1, nx, nz, 0, 0, 0.5, 1);
        }
    }
}

/**
 * Chunk floor, shared by every chunk. It's half a cell off the chunk's cells, which is fine when every chunk has
 * one. `onCells` lines it up with the cells, for empty chunks that have to meet a level's own floor (Level 37).
 */
export function createFloorGeometry(onCells = false) {
    const floor = new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(-Math.PI / 2);
    return onCells ? floor.translate(-0.5, 0, -0.5) : floor;
}

/** Chunk ceiling, facing down (see createFloorGeometry). */
export function createCeilingGeometry(onCells = false) {
    const ceiling = new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(Math.PI / 2).translate(0, WALL_HEIGHT, 0);
    return onCells ? ceiling.translate(-0.5, 0, -0.5) : ceiling;
}

// Light panel sizes (see createFixtureGeometry): flange width, flange height below the ceiling, lens height.
const FLANGE = 0.008;
const FLANGE_Y = WALL_HEIGHT - 0.0025;
const LENS_Y = WALL_HEIGHT - 0.0012;

/**
 * Level 0's ceiling light panels, same in every chunk. One on every cell with both world coords odd. Walls run
 * between cells so a panel never ends up inside one.
 *
 * Each is a troffer in place of a ceiling tile: a painted flange around the edge with the lens recessed inside.
 * levelShading.js finds the lens by its vertex color's blue channel being 1 and lights it. Colors are baked into
 * vertex colors so all of a chunk's panels are one draw call.
 * @param {number} lensColor
 * @param {number} flangeColor
 * @param {number} edgeColor Flange edges.
 */
export function createFixtureGeometry(lensColor, flangeColor, edgeColor) {
    const b = new ColorBuilder();
    for (let i = 1; i < CHUNK_SIZE; i += 2) {
        for (let j = 1; j < CHUNK_SIZE; j += 2) troffer(b, i - HALF_CHUNK, j - HALF_CHUNK, lensColor, flangeColor, edgeColor);
    }
    return b.build();
}

/** One light panel centered in cell (x, z) (see createFixtureGeometry). */
function troffer(b, x, z, lens, flange, edge) {
    const [x0, x1, z0, z1] = [x - PANEL_HALF_X, x + PANEL_HALF_X, z - PANEL_HALF_Z, z + PANEL_HALF_Z];
    const [i0, i1, k0, k1] = [x0 + FLANGE, x1 - FLANGE, z0 + FLANGE, z1 - FLANGE];
    const down = [0, -1, 0];
    face(b, [[i0, LENS_Y, k0], [i1, LENS_Y, k0], [i1, LENS_Y, k1], [i0, LENS_Y, k1]], down, lens);
    // Flange: long sides, then the ends between them.
    face(b, [[x0, FLANGE_Y, z0], [i0, FLANGE_Y, z0], [i0, FLANGE_Y, z1], [x0, FLANGE_Y, z1]], down, flange);
    face(b, [[i1, FLANGE_Y, z0], [x1, FLANGE_Y, z0], [x1, FLANGE_Y, z1], [i1, FLANGE_Y, z1]], down, flange);
    face(b, [[i0, FLANGE_Y, z0], [i1, FLANGE_Y, z0], [i1, FLANGE_Y, k0], [i0, FLANGE_Y, k0]], down, flange);
    face(b, [[i0, FLANGE_Y, k1], [i1, FLANGE_Y, k1], [i1, FLANGE_Y, z1], [i0, FLANGE_Y, z1]], down, flange);
    // Flange edges. Outer ones go up to the ceiling, inner ones up to the lens.
    for (const [a0, a1, top, out] of [[x0, z0, WALL_HEIGHT, -1], [i0, k0, LENS_Y, 1]]) {
        const [a2, a3] = out < 0 ? [x1, z1] : [i1, k1];
        face(b, [[a0, FLANGE_Y, a1], [a0, FLANGE_Y, a3], [a0, top, a3], [a0, top, a1]], [out, 0, 0], edge);
        face(b, [[a2, FLANGE_Y, a1], [a2, FLANGE_Y, a3], [a2, top, a3], [a2, top, a1]], [-out, 0, 0], edge);
        face(b, [[a0, FLANGE_Y, a1], [a2, FLANGE_Y, a1], [a2, top, a1], [a0, top, a1]], [0, 0, out], edge);
        face(b, [[a0, FLANGE_Y, a3], [a2, FLANGE_Y, a3], [a2, top, a3], [a0, top, a3]], [0, 0, -out], edge);
    }
}

/** Quad from 4 corners in order, wound to face along `normal`. */
function face(b, corners, [nx, ny, nz], color) {
    const [a, p, q] = corners;
    const u = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const v = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const facing = (u[1] * v[2] - u[2] * v[1]) * nx + (u[2] * v[0] - u[0] * v[2]) * ny + (u[0] * v[1] - u[1] * v[0]) * nz;
    const [c0, c1, c2, c3] = facing >= 0 ? corners : [corners[0], corners[3], corners[2], corners[1]];
    b.quad(...c0, ...c1, ...c2, ...c3, nx, ny, nz, color);
}

/** Soft glow spot just under each Level 0 light panel, same in every chunk (see panel glow in materials.js). */
export function createPanelGlowGeometry() {
    const b = new ColorBuilder('glow');
    for (let i = 1; i < CHUNK_SIZE; i += 2) {
        for (let j = 1; j < CHUNK_SIZE; j += 2) b.spot(i - HALF_CHUNK, WALL_HEIGHT - 0.06, j - HALF_CHUNK, 0.36, -1, 0.3, 1);
    }
    return b.build();
}

/**
 * Runs steps (see chunkGeometrySteps) to the end.
 * @template T
 * @param {Generator<void, T>} steps
 * @returns {T}
 */
export function finish(steps) {
    for (;;) {
        const { done, value } = steps.next();
        if (done) return value;
    }
}

// One set of builders serves every chunk, since only one chunk is built at a time, even in steps.
const wallsBuilder = new GeometryBuilder();
const baseboardsBuilder = new GeometryBuilder();
const detailsBuilder = new GeometryBuilder();
const shadeBuilder = new GeometryBuilder();
const pillarsBuilder = new GeometryBuilder();
