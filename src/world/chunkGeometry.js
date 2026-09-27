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
import { buildPropGeometry, propShadowRadius } from './props.js';
import { RegionGrid, intervalStart } from './regionGrid.js';

// The baseboard is a thin strip around the bottom of every wall. These match the original look:
// a 0.065-tall box centred on the floor (so 0.0325 is visible) that sticks out 0.005 from the wall.
const BASEBOARD_HEIGHT = 0.0325;
const BASEBOARD_DEPTH = 0.005;

// Soft shading where the walls meet the floor, the ceiling and each other: strips that fade out from the
// join (see the shade material). How far each reaches, and how far it floats off the surface it's on.
const SHADE_FLOOR = 0.14;
const SHADE_CEILING = 0.11;
const SHADE_CORNER = 0.08;
const SHADE_LIFT = 0.0015;
/** The shade texture's columns, one per kind of join (materials.js sets how dark each is). */
export const SHADE_COLUMNS = 4;
const SHADE_FLOOR_U = 0.5 / SHADE_COLUMNS;
const SHADE_CEILING_U = 1.5 / SHADE_COLUMNS;
const SHADE_CORNER_U = 2.5 / SHADE_COLUMNS;
const SHADE_PROP_U = 3.5 / SHADE_COLUMNS;
// Sides of the soft round shadow under a prop.
const SHADOW_SIDES = 12;

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;
const HALF_PILLAR = PILLAR_SIZE / 2;

// Walls are built in two layers, below and above the top of a doorway. Splitting every wall face at the same
// height keeps all the vertices of neighbouring faces lined up, so there are no hairline cracks.
const LAYERS = [
    [0, DOOR_HEIGHT],
    [DOOR_HEIGHT, WALL_HEIGHT],
];

/**
 * Builds the meshes for one chunk's walls: the wallpapered surfaces, the baseboards along their feet, and
 * small details (outlets, ceiling vents), plus the stains and peeling wallpaper (decals.js), the objects
 * left on the floor (props.js), and in Level Fun, the party (partyGeometry.js).
 *
 * Positions are relative to the chunk centre, which keeps float precision high far from the origin.
 * Wallpaper UVs come from those positions, so the pattern runs on seamlessly along a wall.
 *
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} cx
 * @param {number} cz
 * @returns {{
 *     walls: import('three').BufferGeometry | null,
 *     baseboards: import('three').BufferGeometry | null,
 *     details: import('three').BufferGeometry | null,
 *     shade: import('three').BufferGeometry | null,
 *     decals: import('three').BufferGeometry | null,
 *     ceilingDecals: import('three').BufferGeometry | null,
 *     props: import('three').BufferGeometry | null,
 *     partyThings: import('three').BufferGeometry | null,
 *     partyDecals: import('three').BufferGeometry | null,
 *     balloons: import('three').BufferGeometry | null,
 *     flames: import('three').BufferGeometry | null,
 *     extras: Record<string, import('three').BufferGeometry | null>,
 * }}
 */
export function buildChunkGeometry(store, cx, cz) {
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const ox = cx * N; // chunk centre (the mesh origin)
    const oz = cz * N;
    const grid = new RegionGrid(store, x0, z0);
    const walls = wallsBuilder.reset();
    const baseboards = baseboardsBuilder.reset();
    const details = detailsBuilder.reset();
    const shade = shadeBuilder.reset();
    // What the level has: baseboards or not, pillars of its own, and so on (see levels.js).
    const shape = levelById(store.level).shape;
    const pillars = shape.ownPillars ? pillarsBuilder.reset() : null;
    // Walls go down past the floor where it drops away (into Level 37's pools).
    const layers = [[shape.wallBottom, LAYERS[0][1]], LAYERS[1]];
    // Where the walls curve into the ceiling and each other (Level 37's), there's no join to shade.
    const joinShaded = !shape.coves;
    const arch = shape.doorArch;

    const rx0 = x0 * 4;
    const rx1 = (x0 + N) * 4;
    const rz0 = z0 * 4;
    const rz1 = (z0 + N) * 4;

    // Vertical faces, on region boundaries across x (axis 0) and across z (axis 1). Faces are merged into runs
    // along each boundary line while nothing about them changes.
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
                            // Cut where the arches in the doorways spring from (see Shape.doorArch).
                            wallQuad(walls, axis, normal, plane, s0, s1, y0, arch);
                            wallQuad(walls, axis, normal, plane, s0, s1, arch, y1);
                        } else if (arch !== null && (runStart & 3) === 1 && b === runStart + 1 && (runKey & 3) === 0) {
                            // Over a doorway: cut down the middle, where the arch's crown meets it.
                            const middle = (s0 + s1) / 2;
                            wallQuad(walls, axis, normal, plane, s0, middle, y0, y1);
                            wallQuad(walls, axis, normal, plane, middle, s1, y0, y1);
                        } else {
                            wallQuad(walls, axis, normal, plane, s0, s1, y0, y1);
                        }
                        const solidSide = face === 1 ? a : a + 1;
                        const openSide = face === 1 ? a + 1 : a;
                        if (layer === 0) {
                            // Wrap the baseboard around outside corners: extend it where the wall turns away.
                            const convex = (bb) => !solidAt(0, solidSide, bb) && !solidAt(0, openSide, bb);
                            const e0 = convex(runStart - 1) ? BASEBOARD_DEPTH : 0;
                            const e1 = convex(b) ? BASEBOARD_DEPTH : 0;
                            if (shape.baseboards && axis === 0) baseboard(baseboards, axis, normal, plane, s0 - e0, s1 + e1);
                            else if (shape.baseboards) {
                                // Where two meet, the square they'd share is the one along z's: this one stops at
                                // its front (an inside corner), and its ledge short of it (an outside one), so the
                                // two ledges don't overlap there and flicker.
                                const c0 = solidAt(0, openSide, runStart - 1) ? BASEBOARD_DEPTH : 0;
                                const c1 = solidAt(0, openSide, b) ? BASEBOARD_DEPTH : 0;
                                baseboard(baseboards, axis, normal, plane, s0 - e0 + c0, s1 + e1 - c1, s0 + c0, s1 - c1);
                            }
                            if (shape.floorShade) joinShade(shade, axis, normal, plane, s0, s1, SHADE_LIFT, 1, SHADE_FLOOR, SHADE_FLOOR_U);
                        } else if (joinShaded) {
                            joinShade(shade, axis, normal, plane, s0, s1, WALL_HEIGHT - SHADE_LIFT, -1, SHADE_CEILING, SHADE_CEILING_U);
                        }
                        // Inside corners: where another wall stands across the end of this face.
                        if (joinShaded && solidAt(layer, openSide, runStart - 1)) cornerShade(shade, axis, normal, plane, s0, 1, y0, y1);
                        if (joinShaded && solidAt(layer, openSide, b)) cornerShade(shade, axis, normal, plane, s1, -1, y0, y1);
                    }
                }
                runStart = b;
                runKey = key;
            }
        }
    }

    // Horizontal faces: wall tops (seen when flying above the level) and the undersides of doorway lintels.
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

    // Pillars, and details on the walls and ceiling.
    const seed = store.seed;
    const chunk = store.getChunk(cx, cz);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            // (Unless the level's extras build them, as Level 37's round columns.)
            if (store.pillar(x, z) && shape.pillarMesh) pillar(pillars ?? walls, shape.baseboards ? baseboards : null, shade, x + 0.5 - ox, z + 0.5 - oz, store.pillarHalf);
            addOutlets(details, store, grid, x, z, ox, oz);
            // Air vents in the ceiling (see ventAt): only in a flat one (not in Level 37's vaults), and not under a
            // stain, which would be drawn over it.
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

    if (shape.floorShade) for (const prop of chunk.props) propShadow(shade, prop.x - ox, prop.z - oz, propShadowRadius(prop));
    // (Level Fun's things put down in edit mode are drawn with the party's, dressed or not.)
    const party = chunk.party || chunk.props.some((prop) => isPartyProp(prop.type)) ? buildPartyGeometry(chunk.party ?? null, ox, oz, chunk.props) : null;
    for (const thing of chunk.party?.things ?? []) propShadow(shade, thing.x - ox, thing.z - oz, partyShadowRadius(thing));
    const decals = shape.wallpaper ? buildDecalGeometry(store, grid, chunk, x0, z0, ox, oz, walls) : { surfaces: null, ceiling: null };
    // The level's own things (outside a tape's walls, only what finishes the walls there: see Shape.outside).
    const extras = !store.options.isVoid?.(cx, cz)
        ? shape.extras?.(store, chunk, { pillars: pillars ?? walls, shade, pillarShade: (x, z, half) => pillarShade(shade, x, z, half) }) ?? {}
        : shape.outside?.(store, chunk) ?? {};
    if (pillars) extras.pillars = pillars.build();
    return {
        walls: walls.build(),
        baseboards: baseboards.build(),
        details: details.build(),
        shade: shade.build(),
        decals: decals.surfaces,
        ceilingDecals: decals.ceiling,
        props: buildPropGeometry(chunk.props, ox, oz),
        partyThings: party?.things ?? null,
        partyDecals: party?.decals ?? null,
        balloons: party?.balloons ?? null,
        flames: party?.flames ?? null,
        extras,
    };
}

/**
 * A vertical wall face on the plane `axis` = `plane` (axis 0: x = plane, facing ±x; axis 1: z = plane),
 * spanning s0..s1 along the other horizontal axis.
 */
function wallQuad(builder, axis, normal, plane, s0, s1, y0, y1, v0 = y0, v1 = y1) {
    // The face's "right" direction, looking at it from the front, runs along +s or −s.
    const right = axis === 0 ? -normal : normal;
    const left = right > 0 ? s0 : s1;
    const rightEnd = right > 0 ? s1 : s0;
    const nx = axis === 0 ? normal : 0;
    const nz = axis === 0 ? 0 : normal;
    verticalQuad(builder, axis, plane, left, rightEnd, y0, y1, nx, nz, left * right, v0, rightEnd * right, v1);
}

/**
 * The baseboard strip in front of a wall face, from s0 to s1 along it, and the thin ledge on top of it (from l0 to
 * l1, where that's different: see where a baseboard along x meets one along z).
 */
function baseboard(builder, axis, normal, plane, s0, s1, l0 = s0, l1 = s1) {
    const front = plane + normal * BASEBOARD_DEPTH;
    wallQuad(builder, axis, normal, front, s0, s1, 0, BASEBOARD_HEIGHT, 0.5, 1);
    const a0 = normal > 0 ? plane : front;
    const a1 = normal > 0 ? front : plane;
    // The ledge samples a sliver along the top of the baseboard texture, running the length of the strip.
    // It's lit as if it faced mostly into the room: facing straight up, the overhead light (which only
    // reaches upward faces) made it a bright line along the foot of every wall.
    if (axis === 0) flatQuad(builder, a0, a1, l0, l1, BASEBOARD_HEIGHT, 1, 0, a0, a1, normal);
    else flatQuad(builder, l0, l1, a0, a1, BASEBOARD_HEIGHT, 1, 1, a0, a1, normal);
}

/**
 * A horizontal rectangle at height y, facing up (normalY = 1) or down (−1).
 *
 * Texture coordinates come from x and z, except on a baseboard ledge (`ledgeAxis` 0 or 1, the axis the
 * baseboard's depth runs along, from a0 to a1): see baseboard().
 */
function flatQuad(builder, x0, x1, z0, z1, y, normalY, ledgeAxis = -1, a0 = 0, a1 = 0, wallNormal = 0) {
    // Counter-clockwise as seen from the side the quad faces.
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

// A baseboard ledge's shading normal: mostly the wall's, tipped a little up so it still reads as a ledge.
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
 * A strip on the floor (facing 1) or ceiling (−1) along the foot or top of a wall face, darkest against
 * the wall and fading out `width` into the room. The texture's v runs from 0 at the wall to 1.
 */
function joinShade(builder, axis, normal, plane, s0, s1, y, facing, width, u) {
    const far = plane + normal * width;
    const at = (a, s, v) => (axis === 0 ? [a, y, s, 0, facing, 0, u, v] : [s, y, a, 0, facing, 0, u, v]);
    builder.orientedQuad(at(plane, s0, 0), at(far, s0, 1), at(far, s1, 1), at(plane, s1, 0));
}

/** A strip up a wall face from an inside corner at `s`, fading out along the face in direction `dir`. */
function cornerShade(builder, axis, normal, plane, s, dir, y0, y1) {
    const p = plane + normal * SHADE_LIFT;
    const far = s + dir * SHADE_CORNER;
    const nx = axis === 0 ? normal : 0;
    const nz = axis === 0 ? 0 : normal;
    const at = (along, y, v) => (axis === 0 ? [p, y, along, nx, 0, nz, SHADE_CORNER_U, v] : [along, y, p, nx, 0, nz, SHADE_CORNER_U, v]);
    builder.orientedQuad(at(s, y0, 0), at(far, y0, 1), at(far, y1, 1), at(s, y1, 0));
}

/**
 * The soft shadow on the carpet under a prop: a fan round its middle, darkest in the middle (v = 0) and
 * gone at its rim (v = 1). Each piece is a quad with two corners at the middle.
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

/** A pillar standing on a corner (Level 1's columns, `half` across, have no baseboards). */
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
        // (Round the corners as round a wall's: the ledges along z have the corners.)
        const d = BASEBOARD_DEPTH;
        baseboard(baseboards, 0, 1, x1, z0 - d, z1 + d);
        baseboard(baseboards, 0, -1, x0, z0 - d, z1 + d);
        baseboard(baseboards, 1, 1, z1, x0 - d, x1 + d, x0, x1);
        baseboard(baseboards, 1, -1, z0, x0 - d, x1 + d, x0, x1);
    }
    pillarShade(shade, x, z, half);
}

/**
 * The soft shade round a pillar `half` across standing at (x, z), where it meets the floor and the ceiling (a level that
 * builds its own pillars has this for them: see Shape.extras).
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

/** Wall outlets: small plates just above the baseboard, on a few walls (see outlets.js). */
function addOutlets(details, store, grid, x, z, ox, oz) {
    for (let axis = 0; axis < 2; axis++) {
        if ((axis === 0 ? grid.ex(x, z) : grid.ez(x, z)) !== EDGE_WALL) continue;
        for (let side = 1; side >= -1; side -= 2) {
            const along = store.outlet(x, z, axis, side);
            if (along === null) continue;
            const plane = (axis === 0 ? x : z) + 0.5 + side * (HALF_THICKNESS + 0.0015) - (axis === 0 ? ox : oz);
            const centre = (axis === 0 ? z : x) + along - (axis === 0 ? oz : ox);
            // Atlas: the outlet is the left half of the details texture.
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
 * The floor of one chunk (shared by every chunk; they're all identical). It's half a cell off the chunk's cells, which
 * doesn't matter where every chunk has one; `onCells` puts it over them exactly, for an empty chunk beside a level's
 * own floor (Level 37's), which it has to meet.
 */
export function createFloorGeometry(onCells = false) {
    const floor = new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(-Math.PI / 2);
    return onCells ? floor.translate(-0.5, 0, -0.5) : floor;
}

/** The ceiling of one chunk, facing down (see createFloorGeometry). */
export function createCeilingGeometry(onCells = false) {
    const ceiling = new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(Math.PI / 2).translate(0, WALL_HEIGHT, 0);
    return onCells ? ceiling.translate(-0.5, 0, -0.5) : ceiling;
}

// A light panel (see createFixtureGeometry): how wide its painted flange is, how far below the ceiling it is, and how
// far up inside it the lens is.
const FLANGE = 0.008;
const FLANGE_Y = WALL_HEIGHT - 0.0025;
const LENS_Y = WALL_HEIGHT - 0.0012;

/**
 * Level 0's ceiling light panels, the same in every chunk: one on every cell whose world coordinates are both odd,
 * i.e. every other cell. Walls run between cells, so a panel never ends up inside one.
 *
 * Each is a troffer laid into the grid in place of one ceiling tile: a painted flange round the edge, and inside it,
 * a little further up, the lens, which is what lights up (see the panel surface in levelShading.js; it's the one
 * vertex colour with a blue channel of 1). Colours are baked in as vertex colours so the whole chunk's panels are
 * one draw call.
 * @param {number} lensColor
 * @param {number} flangeColor
 * @param {number} edgeColor The flange's edges.
 */
export function createFixtureGeometry(lensColor, flangeColor, edgeColor) {
    const b = new ColorBuilder();
    for (let i = 1; i < CHUNK_SIZE; i += 2) {
        for (let j = 1; j < CHUNK_SIZE; j += 2) troffer(b, i - HALF_CHUNK, j - HALF_CHUNK, lensColor, flangeColor, edgeColor);
    }
    return b.build();
}

/** One light panel (see createFixtureGeometry), in the middle of cell (x, z). */
function troffer(b, x, z, lens, flange, edge) {
    const [x0, x1, z0, z1] = [x - PANEL_HALF_X, x + PANEL_HALF_X, z - PANEL_HALF_Z, z + PANEL_HALF_Z];
    const [i0, i1, k0, k1] = [x0 + FLANGE, x1 - FLANGE, z0 + FLANGE, z1 - FLANGE];
    const down = [0, -1, 0];
    face(b, [[i0, LENS_Y, k0], [i1, LENS_Y, k0], [i1, LENS_Y, k1], [i0, LENS_Y, k1]], down, lens);
    // The flange: its long sides, then its ends between them.
    face(b, [[x0, FLANGE_Y, z0], [i0, FLANGE_Y, z0], [i0, FLANGE_Y, z1], [x0, FLANGE_Y, z1]], down, flange);
    face(b, [[i1, FLANGE_Y, z0], [x1, FLANGE_Y, z0], [x1, FLANGE_Y, z1], [i1, FLANGE_Y, z1]], down, flange);
    face(b, [[i0, FLANGE_Y, z0], [i1, FLANGE_Y, z0], [i1, FLANGE_Y, k0], [i0, FLANGE_Y, k0]], down, flange);
    face(b, [[i0, FLANGE_Y, k1], [i1, FLANGE_Y, k1], [i1, FLANGE_Y, z1], [i0, FLANGE_Y, z1]], down, flange);
    // Its edges: outside, up to the ceiling; inside, up to the lens.
    for (const [a0, a1, top, out] of [[x0, z0, WALL_HEIGHT, -1], [i0, k0, LENS_Y, 1]]) {
        const [a2, a3] = out < 0 ? [x1, z1] : [i1, k1];
        face(b, [[a0, FLANGE_Y, a1], [a0, FLANGE_Y, a3], [a0, top, a3], [a0, top, a1]], [out, 0, 0], edge);
        face(b, [[a2, FLANGE_Y, a1], [a2, FLANGE_Y, a3], [a2, top, a3], [a2, top, a1]], [-out, 0, 0], edge);
        face(b, [[a0, FLANGE_Y, a1], [a2, FLANGE_Y, a1], [a2, top, a1], [a0, top, a1]], [0, 0, out], edge);
        face(b, [[a0, FLANGE_Y, a3], [a2, FLANGE_Y, a3], [a2, top, a3], [a0, top, a3]], [0, 0, -out], edge);
    }
}

/** A quad from four corners in order round it, wound to face along `normal`. */
function face(b, corners, [nx, ny, nz], color) {
    const [a, p, q] = corners;
    const u = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const v = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const facing = (u[1] * v[2] - u[2] * v[1]) * nx + (u[2] * v[0] - u[0] * v[2]) * ny + (u[0] * v[1] - u[1] * v[0]) * nz;
    const [c0, c1, c2, c3] = facing >= 0 ? corners : [corners[0], corners[3], corners[2], corners[1]];
    b.quad(...c0, ...c1, ...c2, ...c3, nx, ny, nz, color);
}

/**
 * The glow in the air round each of Level 0's light panels (see createFixtureGeometry), the same in every chunk: a
 * soft spot just under each (see the panel glow material in materials.js).
 */
export function createPanelGlowGeometry() {
    const b = new ColorBuilder('glow');
    for (let i = 1; i < CHUNK_SIZE; i += 2) {
        for (let j = 1; j < CHUNK_SIZE; j += 2) b.spot(i - HALF_CHUNK, WALL_HEIGHT - 0.06, j - HALF_CHUNK, 0.36, -1, 0.3, 1);
    }
    return b.build();
}

// Meshing one chunk runs start to finish without interruption, so one set of builders serves every chunk.
const wallsBuilder = new GeometryBuilder();
const baseboardsBuilder = new GeometryBuilder();
const detailsBuilder = new GeometryBuilder();
const shadeBuilder = new GeometryBuilder();
const pillarsBuilder = new GeometryBuilder();
