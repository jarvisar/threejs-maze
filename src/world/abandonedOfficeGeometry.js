import { Sphere, Vector3 } from 'three';
import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import {
    CELL_CORE,
    CELL_WELL,
    CONVECTOR_DEPTH,
    DETAIL_DETECTOR,
    DETAIL_SPRINKLER,
    CONVECTOR_HEIGHT,
    DOOR_LIFT,
    DOOR_OFFICE,
    DOOR_SERVICE,
    DOOR_STAIR,
    END_ROUND,
    FACADE_BOTTOM,
    FACADE_TOP,
    FIXTURE_HANGING,
    FIXTURE_STRIP,
    GLASS_HALF,
    HEAD_Y,
    LOOK_CORE,
    LOOK_KITCHEN,
    PIER_HALF,
    SILL_Y,
    blindFoot,
    convectorEnd,
    officeHash,
    windowEnd,
} from './abandonedOffice.js';
import {
    DESK_CHAIR,
    DESK_CHAIR_TURN,
    FURN_CABINET,
    FURN_CHAIR,
    FURN_CLOCK,
    FURN_COPIER,
    FURN_COUNTER,
    FURN_DESK,
    FURN_EXTINGUISHER,
    FURN_FOUNTAIN,
    FURN_FRIDGE,
    FURN_ROUND_TABLE,
    FURN_SHELF,
    FURN_SOFA,
    FURN_STACK,
    FURN_TABLE,
    FURN_VENDING,
    FURN_WHITEBOARD,
    FURN_WORKSTATION,
    PARTITION_HALF,
    chairTipped,
    workstationOn,
} from './abandonedOfficeFurniture.js';
import { ColorBuilder, PLAIN_U, PLAIN_V } from './ColorBuilder.js';
import { PANELS_PER_SIDE } from './generator.js';
import { DIRECTIONS, EDGE_DOOR, EDGE_WALL, chunkCoord } from './grid.js';
import { hashInts, mulberry32 } from './random.js';

/*
 * What Level 4 has that Level 0 doesn't, as meshes for one chunk (see abandonedOffice.js for where it all goes):
 *
 * - the windows round the light wells: a concrete pier between each two bays, the sill and the head, the frame and its
 *   mullion, the heating's enclosure along the foot, the glass (the walls themselves have the glass cut out of them:
 *   see FRAGMENT_WALL in abandonedOfficeShading.js), and in some, a blind let down;
 * - the building across each light well, above our floor and below it, and the rain falling in the well;
 * - the fittings in the light slots (troffers, a bare batten in the core, one come down at one end), and the glow round
 *   each light;
 * - the doors that don't open (offices', stairs', lifts', cupboards'), and over the stair doors their EXIT signs;
 * - the steel frames round the doorways, and beside them what's left of the light switches;
 * - the columns, and in the ceiling the sprinklers and the smoke detectors;
 * - the cubicles' partitions, and the furniture (see abandonedOfficeFurniture.js).
 *
 * Most of it is built of slabs (see slab): boxes with their edges rounded and softened, so they catch the light along
 * them the way things made in a factory do, rather than boxes with knife edges.
 *
 * Positions are relative to the chunk's centre.
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;
/** How far a window's piers stand out either side of its wall's middle (a little proud of its faces). */
const PIER_DEPTH = 0.052;
/** How far the rain keeps off the walls of a light well, where it passes our floor (the wind slants it: see rain). */
const RAIN_CLEAR = 0.07;
/** Where the rain splashes on a window's sill outside: how far out from the glass. */
const SPLASH_OUT = 0.03;
/** The furniture that hangs on a wall. */
const HUNG = [FURN_WHITEBOARD, FURN_CLOCK, FURN_FOUNTAIN, FURN_EXTINGUISHER];
const HALF_DOOR = DOOR_WIDTH / 2;
/**
 * A doorway's frame: how wide it is on the face of the wall, how far it stands off it, how far inside the opening its
 * lining is, and the stop down the middle of the lining (how far it reaches either side of the wall's middle, and how
 * far into the opening).
 */
const CASING = 0.028;
const CASING_OUT = 0.007;
const FRAME_INSET = 0.004;
const STOP_HALF = 0.01;
const STOP_OUT = 0.008;
/** The rubber skirting round the columns' feet (as high as the walls' painted one: see FRAGMENT_WALL). */
const SKIRTING = 0.036;

/** How the furnishings' material finishes each part (see FRAGMENT_FINISH in abandonedOfficeShading.js). */
export const F_PAINT = 0;
export const F_FABRIC = 1;
export const F_METAL = 2;
export const F_LAMINATE = 3;
export const F_PLASTIC = 4;
export const F_GLASS = 5;
export const F_VINYL = 6;
export const F_CONCRETE = 7;
export const F_RUBBER = 8;
export const F_TILE = 9;
export const F_BLIND = 10;

/** What's lit (see FRAGMENT_LIGHT in abandonedOfficeShading.js). */
const L_TROFFER = 1;
const L_TUBE = 2;
const L_VENDING = 3;
const L_SCREEN = 4;
const L_EXIT = 5;
const L_FLOOR = 6;
const L_CLOCK = 7;
const L_BOARD = 8;
const L_LED = 9;

const CONCRETE = 0x787874;
const FRAME = 0x2e2f30;
const WHITE_METAL = 0xc8c8c2;
const CONVECTOR = 0x8e8c86;
const STEEL = 0x8e9294;
const LIFT = 0x6a6e72;
const CHARCOAL = 0x2a2c30;
const BEIGE = 0xb8b09a;
const PAPER = 0xe6e4dc;
const BLACK = 0x121314;
const SCREEN_OFF = 0x1a2020;
const BEIGE_DARK = 0xa49c86;
const EDGE_BAND = 0x2e2a26;
const PEDESTAL = 0x5a5c5e;
const RAIL = 0x9ea2a4;
const POST = 0x7e8284;
const PHONE = 0x2c2e31;
const TILE = 0xc8c8c0;
const SPRINKLER = 0xc4c2bc;
const BLINDS = [0xc8c4b8, 0xb4b4ae, 0xbcb6a4];
const THRESHOLD = 0x6a6c6e;
const FRAME_COLOR = 0x4a4e52;
const COLUMN_PAINT = 0xa6a59f;
const SKIRTING_COLOR = 0x1c1d1e;
const FABRICS = [0x5a6470, 0x8a826e, 0x6c6e70, 0x4e5a52];
const LAMINATES = [0xb8ad96, 0x9a9790, 0x7a6450, 0xc4bca8];
const SEATS = [0x2a2c30, 0x28324a, 0x3a2a2a, 0x2e3a34];
const MACHINES = [0x1c1e22, 0x6e1412, 0x16305a, 0x2a2c30];
const BINDERS = [0x1d3a6e, 0x8a1e1e, 0x1e5a2e, 0x2a2a2a, 0xd4c8a0, 0x6a4a8a, 0xd8d8d0];

/** Round everything a chunk's meshes have (the building across a well goes far up and down): see ColorBuilder.build. */
const CHUNK_BOUNDS = new Sphere(new Vector3(0, (FACADE_TOP + FACADE_BOTTOM) / 2, 0), Math.hypot(HALF_CHUNK + 1, HALF_CHUNK + 1, (FACADE_TOP - FACADE_BOTTOM) / 2 + 1));

// One set of builders serves every chunk, as building one runs start to finish.
const furnishingsBuilder = new ColorBuilder('finish');
const displaysBuilder = new ColorBuilder('light');
const glowsBuilder = new ColorBuilder('glow');
const glassBuilder = new ColorBuilder();
const facadeBuilder = new ColorBuilder();
const rainBuilder = new ColorBuilder('glow');

/**
 * Level 4's own meshes for one chunk (its `shape.extras`; see levels.js), by the name of the material that draws each.
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {import('./generator.js').ChunkData} chunk
 * @param {{ pillarShade?: (x: number, z: number, half: number) => void } | null} [builders] What chunkGeometry.js passes
 *     its extras: here, the shade round the foot and the head of a column.
 * @param {{ doorways?: boolean | [number, number, number, number], columns?: boolean }} [parts] Which of what's worked
 *     out from the walls themselves to build: all of it, but a test can look at each on its own (and at one doorway's
 *     frame, [x, z, di, dj]: from cell (x, z) through its side (di, dj)).
 */
export function buildAbandonedOfficeGeometry(store, chunk, builders = null, parts = {}) {
    const data = /** @type {import('./abandonedOffice.js').AbandonedOfficeData} */ (chunk.abandonedOffice);
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    const ctx = {
        store,
        chunk,
        data,
        x0,
        z0,
        ox: chunk.cx * N,
        oz: chunk.cz * N,
        f: furnishingsBuilder.reset(),
        d: displaysBuilder.reset(),
        g: glowsBuilder.reset(),
        glass: glassBuilder.reset(),
        facade: facadeBuilder.reset(),
        rain: rainBuilder.reset(),
        seed: store.seed,
        pillarShade: builders?.pillarShade ?? null,
    };
    windows(ctx);
    for (const well of data.wells) {
        facade(ctx, well);
        rain(ctx, well);
    }
    fittings(ctx);
    ceilingDetails(ctx);
    for (const door of data.doors) if (store.edge(door.x, door.z, door.axis) === EDGE_WALL) closedDoor(ctx, door);
    if (Array.isArray(parts.doorways)) doorFrame(ctx, ...parts.doorways);
    else if (parts.doorways !== false) doorways(ctx);
    if (parts.columns !== false) columns(ctx);
    partitions(ctx);
    for (const piece of data.furniture) {
        // (What hangs on a wall, only while the wall's still there.)
        if (HUNG.includes(piece.type) && store.edgeBetween(Math.round(piece.x), Math.round(piece.z), -Math.round(Math.sin(piece.yaw)), -Math.round(Math.cos(piece.yaw))) !== EDGE_WALL) continue;
        furniture(ctx, piece);
    }
    return {
        furnishings: ctx.f.build(CHUNK_BOUNDS),
        displays: ctx.d.build(CHUNK_BOUNDS),
        glows: ctx.g.build(CHUNK_BOUNDS),
        glass: ctx.glass.build(CHUNK_BOUNDS),
        facade: ctx.facade.build(CHUNK_BOUNDS),
        rain: ctx.rain.build(CHUNK_BOUNDS),
    };
}

// ---------------------------------------------------------------------------------------------- building blocks

/** Which faces of a box to build (see block): all of them, or leaving out its top, its bottom, and so on. */
const TOP = 1;
const BOTTOM = 2;
const PLUS_X = 4;
const MINUS_X = 8;
const PLUS_Z = 16;
const MINUS_Z = 32;
const ALL = 63;
const SIDES = PLUS_X | MINUS_X | PLUS_Z | MINUS_Z;
/** For a slab (see slab): its low face's edges left square (they're underneath, where nobody sees them). */
const SQUARE_BELOW = 64;

/**
 * An axis-aligned box, finished `kind` (F_*), with only the faces in `faces` (by default all but its bottom where it
 * stands on the floor, which can't be seen).
 */
function block(b, x0, y0, z0, x1, y1, z1, color, kind = F_PAINT, faces = ALL, wear = 0) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    if (y0 <= 0.0005) faces &= ~BOTTOM;
    b.finish?.(kind, wear);
    if (faces & TOP) b.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, color);
    if (faces & BOTTOM) b.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, color);
    if (faces & PLUS_Z) b.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, color);
    if (faces & MINUS_Z) b.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, color);
    if (faces & PLUS_X) b.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, color);
    if (faces & MINUS_X) b.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, color);
}

/** A cylinder along an axis (see ColorBuilder.cylinder), finished `kind`. */
function rod(b, axis, a, c, d, to, radius, sides, color, kind = F_METAL) {
    b.finish?.(kind, 0);
    b.cylinder(axis, a, c, d, to, radius, sides, color);
}

/**
 * A flat face (a picture on it: what's lit), centred at (x, y, z), `right` and `up` its axes (unit), half-size hw × hh,
 * facing right × up.
 */
function face(b, x, y, z, right, up, hw, hh, color) {
    const [rx, ry, rz] = right;
    const [ux, uy, uz] = up;
    const nx = ry * uz - rz * uy;
    const ny = rz * ux - rx * uz;
    const nz = rx * uy - ry * ux;
    b.quad(
        x - rx * hw - ux * hh, y - ry * hw - uy * hh, z - rz * hw - uz * hh,
        x + rx * hw - ux * hh, y + ry * hw - uy * hh, z + rz * hw - uz * hh,
        x + rx * hw + ux * hh, y + ry * hw + uy * hh, z + rz * hw + uz * hh,
        x - rx * hw + ux * hh, y - ry * hw + uy * hh, z - rz * hw + uz * hh,
        nx, ny, nz, color, 0, 0, 1, 1,
    );
}

/** Turns what's been added to a builder since vertex `start` about the x axis through (y, z) by `angle`. */
function tilt(b, start, angle, y, z) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let i = start; i < b.vertexCount; i++) {
        const py = b.positions[i * 3 + 1] - y;
        const pz = b.positions[i * 3 + 2] - z;
        b.positions[i * 3 + 1] = y + py * cos - pz * sin;
        b.positions[i * 3 + 2] = z + py * sin + pz * cos;
        const ny = b.normals[i * 3 + 1];
        const nz = b.normals[i * 3 + 2];
        b.normals[i * 3 + 1] = ny * cos - nz * sin;
        b.normals[i * 3 + 2] = ny * sin + nz * cos;
    }
}

/** Sets what's been added to a builder since vertex `start` down on the floor, and centres it (across) on the origin. */
function settle(b, start) {
    let minY = Infinity;
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = start; i < b.vertexCount; i++) {
        minY = Math.min(minY, b.positions[i * 3 + 1]);
        x0 = Math.min(x0, b.positions[i * 3]);
        x1 = Math.max(x1, b.positions[i * 3]);
        z0 = Math.min(z0, b.positions[i * 3 + 2]);
        z1 = Math.max(z1, b.positions[i * 3 + 2]);
    }
    for (let i = start; i < b.vertexCount; i++) {
        b.positions[i * 3] -= (x0 + x1) / 2;
        b.positions[i * 3 + 1] -= minY;
        b.positions[i * 3 + 2] -= (z0 + z1) / 2;
    }
}

// Scratch for slab: where a vertex is and which way it faces, in the slab's own frame turned back into the world's.
const SLAB_P = [0, 0, 0];
const SLAB_N = [0, 0, 0];
/** A slab's outline, anticlockwise (see slab): each point's u and v, its normal's, and which way it's taken in. */
const SLAB_RING = new Float64Array(6 * 4 * 6);

/** How many straight pieces a slab's rounded corner is made of, by its radius. */
function cornerSteps(r) {
    return r < 0.012 ? 1 : r < 0.045 ? 2 : r < 0.09 ? 3 : 4;
}

/**
 * A slab: a box with its edges along `axis` (0: x, 1: y, 2: z) rounded to radius r (0: square), and `bevel` taken off
 * the edges of its two faces across that axis. A desk's top is a slab along y, rounded at its corners, its top edge
 * softened; a chair's back, one along z. From (x0, y0, z0) to (x1, y1, z1), finished `kind`, its faces `color` and its
 * sides and bevels `edge` (a desk's dark edging). `caps` is which of its two faces to build: TOP the one at the high
 * end of the axis, BOTTOM the low one (never a bottom on the floor); and SQUARE_BELOW leaves the low one's edges square.
 */
function slab(b, axis, x0, y0, z0, x1, y1, z1, r, bevel, color, kind = F_PAINT, edge = color, caps = TOP | BOTTOM, wear = 0) {
    const lo = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)];
    const hi = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    // Its own frame: (u, v) across it, w along the axis, right-handed.
    const [iu, iv, iw] = axis === 0 ? [1, 2, 0] : axis === 1 ? [2, 0, 1] : [0, 1, 2];
    const hu = (hi[iu] - lo[iu]) / 2;
    const hv = (hi[iv] - lo[iv]) / 2;
    const cu = (hi[iu] + lo[iu]) / 2;
    const cv = (hi[iv] + lo[iv]) / 2;
    const w0 = lo[iw];
    const w1 = hi[iw];
    const e = Math.max(0, Math.min(bevel, (w1 - w0) / 2, Math.min(hu, hv) * 0.5));
    // (Rounded no less than the bevel, or its faces' outline would turn inside out at the corners.)
    const round = r > 0 ? Math.min(Math.max(r, e), hu, hv) : 0;
    const steps = round > 0 ? cornerSteps(round) : 1;
    if (axis === 1 && w0 <= 0.0005) caps &= ~BOTTOM;
    // The outline: each corner's arc, or where it's square, the corner twice (once facing each side), taken in along
    // the diagonal for the bevel.
    let count = 0;
    for (let q = 0; q < 4; q++) {
        const su = q === 0 || q === 3 ? 1 : -1;
        const sv = q < 2 ? 1 : -1;
        for (let k = 0; k <= steps; k++) {
            const a = ((q + k / steps) * Math.PI) / 2;
            const nu = Math.cos(a);
            const nv = Math.sin(a);
            const o = count++ * 6;
            SLAB_RING[o] = cu + su * (hu - round) + nu * round;
            SLAB_RING[o + 1] = cv + sv * (hv - round) + nv * round;
            SLAB_RING[o + 2] = nu;
            SLAB_RING[o + 3] = nv;
            SLAB_RING[o + 4] = round > 0 ? nu : su;
            SLAB_RING[o + 5] = round > 0 ? nv : sv;
        }
    }
    const put = (u, v, w, nu, nv, nw, c) => {
        SLAB_P[iu] = u;
        SLAB_P[iv] = v;
        SLAB_P[iw] = w;
        SLAB_N[iu] = nu;
        SLAB_N[iv] = nv;
        SLAB_N[iw] = nw;
        return b.vertex(SLAB_P[0], SLAB_P[1], SLAB_P[2], SLAB_N[0], SLAB_N[1], SLAB_N[2], PLAIN_U, PLAIN_V, c);
    };
    // A band round it from wa to wb along the axis, each end taken in by ia and ib, facing out and nw along the axis.
    const band = (wa, ia, wb, ib, nw, c) => {
        if (wb - wa < 1e-6) return;
        const s = 1 / Math.hypot(1, nw);
        const first = b.vertexCount;
        for (let k = 0; k < count; k++) {
            const o = k * 6;
            put(SLAB_RING[o] - SLAB_RING[o + 4] * ia, SLAB_RING[o + 1] - SLAB_RING[o + 5] * ia, wa, SLAB_RING[o + 2] * s, SLAB_RING[o + 3] * s, nw * s, c);
            put(SLAB_RING[o] - SLAB_RING[o + 4] * ib, SLAB_RING[o + 1] - SLAB_RING[o + 5] * ib, wb, SLAB_RING[o + 2] * s, SLAB_RING[o + 3] * s, nw * s, c);
        }
        for (let k = 0; k < count; k++) {
            const a = first + k * 2;
            const n = first + ((k + 1) % count) * 2;
            b.triangle(a, n, n + 1);
            b.triangle(a, n + 1, a + 1);
        }
    };
    // One of its faces, at w, its outline taken in by `inset`, facing nw along the axis.
    const cap = (w, inset, nw, c) => {
        const centre = put(cu, cv, w, 0, 0, nw, c);
        const first = b.vertexCount;
        for (let k = 0; k < count; k++) {
            const o = k * 6;
            put(SLAB_RING[o] - SLAB_RING[o + 4] * inset, SLAB_RING[o + 1] - SLAB_RING[o + 5] * inset, w, 0, 0, nw, c);
        }
        for (let k = 0; k < count; k++) {
            const p = first + k;
            const q = first + ((k + 1) % count);
            if (nw > 0) b.triangle(centre, p, q);
            else b.triangle(centre, q, p);
        }
    };
    // (No bevel where there's no face.)
    const e0 = caps & BOTTOM && !(caps & SQUARE_BELOW) ? e : 0;
    const e1 = caps & TOP ? e : 0;
    b.finish(kind, wear);
    if (caps & BOTTOM) cap(w0, e0, -1, color);
    if (e0 > 0) band(w0, e0, w0 + e0, 0, -1, edge);
    band(w0 + e0, 0, w1 - e1, 0, 0, edge);
    if (e1 > 0) band(w1 - e1, 0, w1, e1, 1, edge);
    if (caps & TOP) cap(w1, e1, 1, color);
}

/** A box with its edges softened by e all round (a slab along y, its upright edges rounded by as much). */
function soft(b, x0, y0, z0, x1, y1, z1, e, color, kind = F_PAINT, caps = TOP | BOTTOM, wear = 0) {
    slab(b, 1, x0, y0, z0, x1, y1, z1, e, e, color, kind, color, caps, wear);
}

/**
 * Bends what's been added to a builder since vertex `start` along z by k x² (from x = 0): a chair's back, cupped round
 * whoever sat in it.
 */
function cup(b, start, k) {
    for (let i = start; i < b.vertexCount; i++) {
        const x = b.positions[i * 3];
        b.positions[i * 3 + 2] += k * x * x;
        // (Its normals by the inverse transpose of the bend.)
        const nx = b.normals[i * 3] - 2 * k * x * b.normals[i * 3 + 2];
        const ny = b.normals[i * 3 + 1];
        const nz = b.normals[i * 3 + 2];
        const length = Math.hypot(nx, ny, nz);
        b.normals[i * 3] = nx / length;
        b.normals[i * 3 + 1] = ny / length;
        b.normals[i * 3 + 2] = nz / length;
    }
}

/**
 * A flat face through four corners ([x, y, z] each), in order round it either way, facing away from `inside` (a point
 * behind it).
 */
function facet(b, inside, corners, color) {
    const [a, c1, c2, c3] = corners;
    const u = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
    const v = [c3[0] - c1[0], c3[1] - c1[1], c3[2] - c1[2]];
    let nx = u[1] * v[2] - u[2] * v[1];
    let ny = u[2] * v[0] - u[0] * v[2];
    let nz = u[0] * v[1] - u[1] * v[0];
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) return;
    nx /= length;
    ny /= length;
    nz /= length;
    const mid = [0, 1, 2].map((k) => (a[k] + c1[k] + c2[k] + c3[k]) / 4);
    const out = (mid[0] - inside[0]) * nx + (mid[1] - inside[1]) * ny + (mid[2] - inside[2]) * nz;
    if (out < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
    }
    const order = out < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const first = b.vertexCount;
    for (const k of order) b.vertex(corners[k][0], corners[k][1], corners[k][2], nx, ny, nz, PLAIN_U, PLAIN_V, color);
    b.triangle(first, first + 1, first + 2);
    b.triangle(first, first + 2, first + 3);
}

/**
 * A shell tapering back along −z from a rectangle [x0, y0, x1, y1] at z0 to a smaller one at z1 (behind it): its four
 * sides and its end (a monitor's back).
 */
function taper(b, z0, [ax0, ay0, ax1, ay1], z1, [bx0, by0, bx1, by1], color, kind = F_PLASTIC, wear = 0) {
    b.finish(kind, wear);
    const inside = [(ax0 + ax1 + bx0 + bx1) / 4, (ay0 + ay1 + by0 + by1) / 4, (z0 + z1) / 2];
    facet(b, inside, [[ax0, ay1, z0], [ax1, ay1, z0], [bx1, by1, z1], [bx0, by1, z1]], color);
    facet(b, inside, [[ax0, ay0, z0], [ax1, ay0, z0], [bx1, by0, z1], [bx0, by0, z1]], color);
    facet(b, inside, [[ax0, ay0, z0], [ax0, ay1, z0], [bx0, by1, z1], [bx0, by0, z1]], color);
    facet(b, inside, [[ax1, ay0, z0], [ax1, ay1, z0], [bx1, by1, z1], [bx1, by0, z1]], color);
    facet(b, [inside[0], inside[1], z0], [[bx0, by0, z1], [bx1, by0, z1], [bx1, by1, z1], [bx0, by1, z1]], color);
}

/**
 * Builds a piece in its own frame (x across it, y up, its front towards +z, its middle at the origin) with `build`, then
 * turns it by `yaw` and puts it at (x, z), relative to the chunk.
 */
function inFrame(ctx, yaw, x, z, build) {
    const starts = [ctx.f.vertexCount, ctx.d.vertexCount, ctx.g.vertexCount];
    build();
    ctx.f.transform(starts[0], yaw, x - ctx.ox, z - ctx.oz);
    ctx.d.transform(starts[1], yaw, x - ctx.ox, z - ctx.oz);
    ctx.g.transform(starts[2], yaw, x - ctx.ox, z - ctx.oz);
}

// ---------------------------------------------------------------------------------------------- the windows

/**
 * The windows in the walls round each light well (see windows in AbandonedOfficeData): for each bay, its pier at its
 * far end (and at its near end, where there's no bay before it), its sill and head, its frame and mullion, the heating
 * along its foot on the room's side, and its glass. Only while the wall's still there.
 */
function windows(ctx) {
    const { data, store, x0, z0, ox, oz, f, glass } = ctx;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const bits = data.windows[i * N + j];
            if (!bits) continue;
            for (const axis of /** @type {(0 | 1)[]} */ ([0, 1])) {
                if (!(bits & (axis === 0 ? 1 : 2))) continue;
                const x = x0 + i;
                const z = z0 + j;
                if (store.edge(x, z, axis) !== EDGE_WALL) continue;
                // The room's side of the glass: away from the well.
                const ni = i + (axis === 0 ? 1 : 0);
                const nj = j + (axis === 0 ? 0 : 1);
                const wellAhead = ni < N && nj < N && data.kinds[ni * N + nj] & 1;
                const room = wellAhead ? -1 : 1;
                const plane = (axis === 0 ? x : z) + 0.5 - (axis === 0 ? ox : oz);
                const bay = (axis === 0 ? z : x) - (axis === 0 ? oz : ox);
                // Whether the bays before and after this one along the wall are windows too (the pier between is the
                // later one's); at the well's corners, the piers stop at the corner.
                const bit = axis === 0 ? 1 : 2;
                const [pi, pj] = axis === 0 ? [i, j - 1] : [i - 1, j];
                const [qi, qj] = axis === 0 ? [i, j + 1] : [i + 1, j];
                const before = pi >= 0 && pj >= 0 && data.windows[pi * N + pj] & bit;
                const after = qi < N && qj < N && data.windows[qi * N + qj] & bit;
                // A box across the wall from a0 to a1 (from the plane, towards the room: negative is outside), along it
                // from s0 to s1, up from y0 to y1.
                const across = (b, a0, a1, s0, s1, y0, y1, color, kind, faces = ALL) => {
                    const [c0, c1] = [plane + room * a0, plane + room * a1];
                    if (axis === 0) block(b, c0, y0, bay + s0, c1, y1, bay + s1, color, kind, faces);
                    else block(b, bay + s0, y0, c0, bay + s1, y1, c1, color, kind, faces);
                };
                const ends = axis === 0 ? PLUS_Z | MINUS_Z : PLUS_X | MINUS_X;
                const faces = axis === 0 ? PLUS_X | MINUS_X : PLUS_Z | MINUS_Z;
                // How the side ends, where this is its last bay (see windowEnd); −1 where the next bay's a window too.
                const edge = (ex, ez, ea) => store.edge(ex, ez, ea);
                const endBefore = before ? -1 : windowEnd(edge, x, z, axis, room, -1);
                const endAfter = after ? -1 : windowEnd(edge, x, z, axis, room, 1);
                // The piers (their tops and bottoms are in the wall). At a corner the room goes round, the side along z's
                // takes the corner, and the other's stops at it.
                const corner = (end) => (end !== END_ROUND ? 0.499 : axis === 0 ? 0.5 + PIER_DEPTH : 0.5 - PIER_DEPTH);
                across(f, -PIER_DEPTH, PIER_DEPTH, 0.5 - PIER_HALF, after ? 0.5 + PIER_HALF : corner(endAfter), SILL_Y, HEAD_Y, CONCRETE, F_CONCRETE, SIDES);
                if (!before) across(f, -PIER_DEPTH, PIER_DEPTH, -corner(endBefore), -0.5 + PIER_HALF, SILL_Y, HEAD_Y, CONCRETE, F_CONCRETE, SIDES);
                // The sill, its top, down to the heating's; and the head, its underside.
                across(f, -0.05, 0.05, -GLASS_HALF, GLASS_HALF, CONVECTOR_HEIGHT, SILL_Y, CONCRETE, F_CONCRETE, TOP | faces);
                across(f, -0.05, 0.05, -GLASS_HALF, GLASS_HALF, HEAD_Y, HEAD_Y + 0.02, CONCRETE, F_CONCRETE, BOTTOM | faces);
                // The frame round the glass, and the mullion down its middle.
                const t = 0.014;
                across(f, -0.012, 0.012, -GLASS_HALF + 0.001, -GLASS_HALF + t, SILL_Y + 0.001, HEAD_Y - 0.001, FRAME, F_METAL, faces | ends);
                across(f, -0.012, 0.012, GLASS_HALF - t, GLASS_HALF - 0.001, SILL_Y + 0.001, HEAD_Y - 0.001, FRAME, F_METAL, faces | ends);
                across(f, -0.012, 0.012, -GLASS_HALF + t, GLASS_HALF - t, SILL_Y + 0.001, SILL_Y + t, FRAME, F_METAL, faces | TOP);
                across(f, -0.012, 0.012, -GLASS_HALF + t, GLASS_HALF - t, HEAD_Y - t, HEAD_Y - 0.001, FRAME, F_METAL, faces | BOTTOM);
                across(f, -0.014, 0.014, -0.009, 0.009, SILL_Y + t, HEAD_Y - t, FRAME, F_METAL, faces | ends);
                // The heating's enclosure along the foot of the wall, the room's side, on round a corner or closed off
                // at the end of its run (see convectorEnd): a grille along its top.
                const [run0, cap0] = convectorEnd(endBefore, axis);
                const [run1, cap1] = convectorEnd(endAfter, axis);
                const caps = (cap0 ? (axis === 0 ? MINUS_Z : MINUS_X) : 0) | (cap1 ? (axis === 0 ? PLUS_Z : PLUS_X) : 0);
                across(f, HALF_WALL, HALF_WALL + CONVECTOR_DEPTH, -run0, run1, 0, CONVECTOR_HEIGHT, CONVECTOR, F_PAINT, TOP | faces | caps);
                across(f, HALF_WALL + 0.012, HALF_WALL + CONVECTOR_DEPTH - 0.012, -0.47, 0.47, CONVECTOR_HEIGHT, CONVECTOR_HEIGHT + 0.002, 0x3a3c3e, F_METAL, TOP);
                // The rain splashing on its sill outside (see the rain material in abandonedOfficeMaterials.js): a few places
                // along it, each now and then.
                const splashes = mulberry32(hashInts(ctx.seed, 0x4a18, x, z, axis));
                for (let k = 0; k < 5; k++) {
                    const s = ((k + 0.5 + (splashes() - 0.5) * 0.8) / 5 - 0.5) * 2 * (GLASS_HALF - 0.04);
                    const c = plane - room * (SPLASH_OUT + (splashes() - 0.5) * 0.012);
                    const [sx, sz] = axis === 0 ? [c, bay + s] : [bay + s, c];
                    ctx.rain.spot(sx, SILL_Y + 0.0015, sz, 1.2 + splashes() * 1.3, splashes(), 0.01 + splashes() * 0.006, 1);
                }
                // Its blind, where it's down (see blindFoot): the headrail, the slats, the bar along their foot, the wand.
                const foot = blindFoot(x, z, axis);
                if (foot !== null) {
                    const color = BLINDS[Math.floor(officeHash(x * 5 + 3, z * 7 + axis) * BLINDS.length) % BLINDS.length];
                    const [s0, s1] = [-GLASS_HALF + 0.006, GLASS_HALF - 0.006];
                    across(f, 0.016, 0.034, s0, s1, HEAD_Y - 0.016, HEAD_Y, color, F_METAL, ALL & ~TOP);
                    across(f, 0.0235, 0.0265, s0 + 0.002, s1 - 0.002, foot + 0.006, HEAD_Y - 0.016, color, F_BLIND, faces);
                    across(f, 0.019, 0.031, s0 + 0.001, s1 - 0.001, foot, foot + 0.006, color, F_METAL);
                    across(f, 0.031, 0.034, s1 - 0.03, s1 - 0.027, HEAD_Y - 0.36, HEAD_Y - 0.016, 0xd8d6d0, F_PLASTIC, faces | ends | BOTTOM);
                }
                // The glass, facing the room.
                const g1 = GLASS_HALF - t;
                if (axis === 0) {
                    glass.quad(plane, SILL_Y + t, bay + g1 * room, plane, SILL_Y + t, bay - g1 * room, plane, HEAD_Y - t, bay - g1 * room, plane, HEAD_Y - t, bay + g1 * room, room, 0, 0, 0xffffff);
                } else {
                    glass.quad(bay - g1 * room, SILL_Y + t, plane, bay + g1 * room, SILL_Y + t, plane, bay + g1 * room, HEAD_Y - t, plane, bay - g1 * room, HEAD_Y - t, plane, 0, 0, room, 0xffffff);
                }
            }
        }
    }
}

/**
 * The building across a light well, above our floor and below it: the four faces of the well, from its floor's walls'
 * faces up to the top of the building and down into the fog (our floor's own are the walls': see FRAGMENT_WALL).
 */
function facade(ctx, { i0, j0, i1, j1 }) {
    const { x0, z0, ox, oz, facade: b } = ctx;
    // The well's inside, from face to face.
    const ax = x0 + i0 - 0.5 + HALF_WALL - ox;
    const bx = x0 + i1 + 0.5 - HALF_WALL - ox;
    const az = z0 + j0 - 0.5 + HALF_WALL - oz;
    const bz = z0 + j1 + 0.5 - HALF_WALL - oz;
    for (const [y0, y1] of [[WALL_HEIGHT, FACADE_TOP], [FACADE_BOTTOM, 0]]) {
        // Facing into the well: +x on its −x side, and so on.
        b.quad(ax, y0, bz, ax, y0, az, ax, y1, az, ax, y1, bz, 1, 0, 0, 0xffffff);
        b.quad(bx, y0, az, bx, y0, bz, bx, y1, bz, bx, y1, az, -1, 0, 0, 0xffffff);
        b.quad(ax, y0, az, bx, y0, az, bx, y1, az, ax, y1, az, 0, 0, 1, 0xffffff);
        b.quad(bx, y0, bz, ax, y0, bz, ax, y1, bz, bx, y1, bz, 0, 0, -1, 0xffffff);
    }
}

/**
 * The rain falling in a light well: streaks all through it, where each passes our floor (the wind slants them either
 * side of that: see the rain material in abandonedOfficeMaterials.js, which keeps them inside the well at our floor).
 */
function rain(ctx, { i0, j0, i1, j1 }) {
    const { x0, z0, ox, oz, chunk, rain: b } = ctx;
    const random = mulberry32((chunk.cx * 73856093) ^ (chunk.cz * 19349663) ^ 0x4a17);
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    // (Clear of the well's walls by more than the wind moves them across our floor.)
    const inset = 0.5 - HALF_WALL - RAIN_CLEAR;
    const count = Math.round(w * h * 150);
    for (let k = 0; k < count; k++) {
        const x = x0 + i0 - inset + random() * (w - 1 + 2 * inset) - ox;
        const z = z0 + j0 - inset + random() * (h - 1 + 2 * inset) - oz;
        // How fast it falls, where in its fall it starts, how long its streak.
        b.spot(x, 0, z, 2.3 + random() * 0.7, random(), 0.16 + random() * 0.16, 0);
    }
}

// ---------------------------------------------------------------------------------------------- the lights

/**
 * The fittings in the light slots: a recessed troffer (a white rim round its louvre), a bare batten on the core's
 * concrete, or a troffer come down at one end, hanging on its wire, the black of the ceiling void where it was; and a
 * glow round each that's lit.
 */
function fittings(ctx) {
    const { data, x0, z0, ox, oz, f, d, g } = ctx;
    for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
        for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
            const fixture = data.fixtures[pi * PANELS_PER_SIDE + pj];
            if (!fixture) continue;
            const x = x0 + pi * 2 + 1;
            const z = z0 + pj * 2 + 1;
            const lx = x - ox;
            const lz = z - oz;
            const top = WALL_HEIGHT;
            if (fixture === FIXTURE_STRIP) {
                block(f, lx - 0.022, top - 0.03, lz - 0.26, lx + 0.022, top, lz + 0.26, WHITE_METAL, F_METAL, ALL & ~TOP);
                d.light(x, z, 1, L_TUBE);
                d.finish?.(0, 0);
                d.cylinder(2, lx, top - 0.04, lz - 0.24, lz + 0.24, 0.01, 8, 0xffffff);
                g.spot(lx, top - 0.05, lz, 0.28, -1, 0.3, 1);
                continue;
            }
            const hanging = fixture === FIXTURE_HANGING;
            // Where one's come down, the dark of the void over the ceiling it came out of.
            if (hanging) block(f, lx - 0.125, top - 0.0025, lz - 0.25, lx + 0.125, top - 0.002, lz + 0.25, 0x060606, F_PAINT, BOTTOM);
            const fStart = f.vertexCount;
            const dStart = d.vertexCount;
            // Its housing, out of the ceiling now; or its rim, flush with it; and the louvre, facing down.
            const rim = 0.012;
            const lens = hanging ? top - 0.052 : top - 0.004;
            if (hanging) block(f, lx - 0.125, top - 0.05, lz - 0.25, lx + 0.125, top - 0.004, lz + 0.25, WHITE_METAL, F_METAL, ALL);
            block(f, lx - 0.125, lens - 0.003, lz - 0.25, lx - 0.125 + rim, top - 0.001, lz + 0.25, WHITE_METAL, F_METAL, ALL & ~TOP);
            block(f, lx + 0.125 - rim, lens - 0.003, lz - 0.25, lx + 0.125, top - 0.001, lz + 0.25, WHITE_METAL, F_METAL, ALL & ~TOP);
            block(f, lx - 0.125 + rim, lens - 0.003, lz - 0.25, lx + 0.125 - rim, top - 0.001, lz - 0.25 + rim, WHITE_METAL, F_METAL, ALL & ~TOP);
            block(f, lx - 0.125 + rim, lens - 0.003, lz + 0.25 - rim, lx + 0.125 - rim, top - 0.001, lz + 0.25, WHITE_METAL, F_METAL, ALL & ~TOP);
            d.light(x, z, hanging ? 0 : 1, L_TROFFER);
            face(d, lx, lens, lz, [1, 0, 0], [0, 0, 1], 0.125 - rim, 0.25 - rim, 0xffffff);
            if (hanging) {
                // Still up at its +z end; down at its −z end, hanging on its wire from the ceiling.
                const angle = 0.95 + (((x * 31 + z * 17) & 7) / 7) * 0.3;
                tilt(f, fStart, -angle, top, lz + 0.25);
                tilt(d, dStart, -angle, top, lz + 0.25);
                const wy = top - 0.004 * Math.cos(angle) - 0.5 * Math.sin(angle);
                const wz = lz + 0.25 + 0.004 * Math.sin(angle) - 0.5 * Math.cos(angle);
                rod(f, 1, lx, wy, wz, top, 0.002, 4, 0x1a1a1a, F_RUBBER);
            } else {
                g.spot(lx, top - 0.03, lz, 0.34, -1, 0.34, 1);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------- the doors

/**
 * A door that doesn't open, on both faces of its wall: an office's (veneer, a light of glass, a lever), a stair door
 * (steel, a push bar, wired glass, the EXIT sign over it on its front), a lift's (steel doors, its buttons, the 4 over
 * them), a cupboard's (painted steel).
 */
function closedDoor(ctx, door) {
    const { ox, oz, f, d, g } = ctx;
    const plane = (door.axis === 0 ? door.x : door.z) + 0.5 - (door.axis === 0 ? ox : oz);
    const mid = (door.axis === 0 ? door.z : door.x) - (door.axis === 0 ? oz : ox);
    const v = door.variant;
    for (const side of [1, -1]) {
        const front = side === door.front;
        // A box out from the wall's face on this side (from o0 to o1), along it from s0 to s1, up from y0 to y1.
        const out = (b, o0, o1, s0, s1, y0, y1, color, kind, faces = ALL) => {
            const [c0, c1] = [plane + side * (HALF_WALL + o0), plane + side * (HALF_WALL + o1)];
            const flip = side < 0;
            // (Not the face against the wall.)
            let mask = faces;
            if (door.axis === 0) mask &= flip ? ~PLUS_X : ~MINUS_X;
            else mask &= flip ? ~PLUS_Z : ~MINUS_Z;
            if (door.axis === 0) block(b, c0, y0, mid + s0, c1, y1, mid + s1, color, kind, mask);
            else block(b, mid + s0, y0, c0, mid + s1, y1, c1, color, kind, mask);
        };
        // A lit face on this side, out from the wall, centred along it at s and up it at y.
        const lit = (o, s, y, hw, hh, light, glow = 1) => {
            d.light(0, 0, glow, light);
            const n = side;
            const right = door.axis === 0 ? [0, 0, -n] : [n, 0, 0];
            const at = plane + side * (HALF_WALL + o);
            if (door.axis === 0) face(d, at, y, mid + s, right, [0, 1, 0], hw, hh, 0xffffff);
            else face(d, mid + s, y, at, right, [0, 1, 0], hw, hh, 0xffffff);
        };
        // The way out of the wall on this side, in chunk coordinates, at a height (for a glow).
        const point = (o, s, y) => (door.axis === 0 ? [plane + side * (HALF_WALL + o), y, mid + s] : [mid + s, y, plane + side * (HALF_WALL + o)]);
        if (door.kind === DOOR_LIFT) {
            const color = LIFT;
            out(f, 0, 0.016, -0.24, -0.2, 0, 0.8, 0x6a6c6e, F_METAL);
            out(f, 0, 0.016, 0.2, 0.24, 0, 0.8, 0x6a6c6e, F_METAL);
            out(f, 0, 0.016, -0.24, 0.24, 0.8, 0.84, 0x6a6c6e, F_METAL);
            out(f, 0, 0.006, -0.2, -0.002, 0, 0.8, color, F_METAL);
            out(f, 0, 0.006, 0.002, 0.2, 0, 0.8, color, F_METAL);
            out(f, 0, 0.003, -0.002, 0.002, 0, 0.8, 0x111111, F_PAINT);
            if (front) {
                // The sill in front of the doors; the buttons, and the floor it's on.
                out(f, 0, 0.032, -0.23, 0.23, 0, 0.003, 0x7a7e80, F_METAL);
                out(f, 0, 0.008, 0.29, 0.33, 0.33, 0.43, 0x7a7c7e, F_METAL);
                lit(0.0095, 0.31, 0.4, 0.008, 0.008, L_FLOOR, 1);
                lit(0.0095, 0.31, 0.36, 0.008, 0.008, L_FLOOR, 0.3);
                out(f, 0, 0.01, -0.07, 0.07, 0.86, 0.92, 0x1a1a1a, F_PLASTIC);
                lit(0.0115, 0, 0.89, 0.02, 0.024, L_FLOOR);
            }
            continue;
        }
        const width = 0.17;
        const height = 0.78;
        const paint = door.kind === DOOR_STAIR ? ((v >>> 3) & 1 ? 0x6a2a22 : 0x5a5e5a) : door.kind === DOOR_SERVICE ? 0x8a8a84 : 0x7a5a3e;
        const kind = door.kind === DOOR_OFFICE ? F_LAMINATE : F_PAINT;
        // The frame (as round the doorways), and the leaf, set back in it.
        out(f, 0, CASING_OUT, -width - CASING, -width, 0, height, FRAME_COLOR, F_PAINT);
        out(f, 0, CASING_OUT, width, width + CASING, 0, height, FRAME_COLOR, F_PAINT);
        out(f, 0, CASING_OUT, -width - CASING, width + CASING, height, height + CASING, FRAME_COLOR, F_PAINT);
        out(f, 0, 0.005, -width, width, 0, height, paint, kind);
        // Its lever on its rose (on the side it opens from, away from its hinges); and the hinges.
        const handle = (v & 1 ? 1 : -1) * (width - 0.035);
        out(f, 0.005, 0.008, handle - 0.011, handle + 0.011, 0.357, 0.388, STEEL, F_METAL);
        out(f, 0.008, 0.02, handle - 0.004, handle + 0.004, 0.368, 0.377, STEEL, F_METAL);
        out(f, 0.02, 0.026, handle - (v & 1 ? 0.05 : 0), handle + (v & 1 ? 0 : 0.05), 0.368, 0.377, STEEL, F_METAL);
        const hinge = -(v & 1 ? 1 : -1) * (width + 0.001);
        for (const y of [0.08, 0.4, 0.7]) out(f, 0, 0.009, hinge - 0.003, hinge + 0.003, y, y + 0.035, 0x6a6c6e, F_METAL);
        if (door.kind === DOOR_OFFICE) {
            // A narrow light of glass on its lever side, and a plate for a name that's gone.
            const s = handle - (v & 1 ? 0.06 : -0.06);
            out(f, 0.005, 0.0065, s - 0.02, s + 0.02, 0.42, 0.7, 0x141818, F_GLASS);
            if (front) out(f, 0, 0.004, width + 0.04, width + 0.12, 0.5, 0.54, 0x9a9690, F_METAL);
        } else if (door.kind === DOOR_STAIR) {
            // Wired glass, up high; the push bar on its front.
            out(f, 0.005, 0.0065, -0.06, 0.06, 0.52, 0.68, 0x1a2020, F_GLASS);
            if (front) {
                out(f, 0.005, 0.03, -width + 0.03, width - 0.03, 0.35, 0.37, STEEL, F_METAL);
                // The EXIT sign over it, lit on its battery: its box, its face, its glow.
                out(f, 0, 0.03, -0.1, 0.1, 0.86, 0.94, 0xd8d8d0, F_PLASTIC);
                lit(0.0315, 0, 0.9, 0.085, 0.032, L_EXIT);
                const [gx, gy, gz] = point(0.06, 0, 0.9);
                g.spot(gx, gy, gz, 0.22, -22, 0.5, 0.6);
            }
        } else if (front) {
            // A round sign, blank: the toilets, or the plant.
            out(f, 0.005, 0.007, -0.04, 0.04, 0.52, 0.6, (v >>> 5) & 1 ? 0x2a4a8a : 0x3a3a3a, F_PLASTIC);
        }
        // A kick plate.
        out(f, 0.005, 0.0065, -width + 0.01, width - 0.01, 0.01, 0.06, STEEL, F_METAL);
    }
}

// ---------------------------------------------------------------------------------------------- doorways

/**
 * The frames round the doorways (the openings in the walls, with no door in them), painted steel: on the face of the
 * wall towards each of the chunk's cells a doorway opens from, the frame's face round the opening; its lining through
 * the wall as far as the wall's middle (the rest is the cell's on the other side), with half the stop down the middle;
 * and now and then beside it, where the light switch was, its plate, or only the box in the wall.
 */
function doorways(ctx) {
    const { store, data, x0, z0 } = ctx;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            if (data.kinds[i * N + j] & CELL_WELL) continue;
            for (const [di, dj] of DIRECTIONS) {
                if (store.edgeBetween(x0 + i, z0 + j, di, dj) === EDGE_DOOR) doorFrame(ctx, x0 + i, z0 + j, di, dj);
            }
        }
    }
}

/**
 * A box against a wall (along z for axis 0, along x for axis 1), from a0 to a1 across it (world; the face at a0, on the
 * wall, isn't built), s0 to s1 along it and y0 to y1 up, relative to the chunk.
 */
function onWall(ctx, b, axis, a0, a1, s0, s1, y0, y1, color, kind, faces = ALL) {
    const back = axis === 0 ? (a1 > a0 ? MINUS_X : PLUS_X) : a1 > a0 ? MINUS_Z : PLUS_Z;
    if (axis === 0) block(b, a0 - ctx.ox, y0, s0 - ctx.oz, a1 - ctx.ox, y1, s1 - ctx.oz, color, kind, faces & ~back);
    else block(b, s0 - ctx.ox, y0, a0 - ctx.oz, s1 - ctx.ox, y1, a1 - ctx.oz, color, kind, faces & ~back);
}

/** The face of a box against a wall (see onWall) that faces `sign` along the wall. */
function alongFace(axis, sign) {
    return axis === 0 ? (sign > 0 ? PLUS_Z : MINUS_Z) : sign > 0 ? PLUS_X : MINUS_X;
}

/** The face of a box against a wall that faces `sign` across it (away from it, or back towards it). */
function acrossFace(axis, sign) {
    return axis === 0 ? (sign > 0 ? PLUS_X : MINUS_X) : sign > 0 ? PLUS_Z : MINUS_Z;
}

/** Whether cell (x, z) is floored with vinyl (the core's, a kitchen's) rather than carpet; null outside a tape's walls. */
function vinylAt(ctx, x, z) {
    const cx = chunkCoord(x);
    const cz = chunkCoord(z);
    if (ctx.store.options.isVoid?.(cx, cz)) return null;
    const look = ctx.store.getChunk(cx, cz).cells[((x - cx * N + HALF_CHUNK) * N + (z - cz * N + HALF_CHUNK)) * 4] & 7;
    return look === LOOK_CORE || look === LOOK_KITCHEN;
}

/** The frame of the doorway in the wall on side (di, dj) of cell (x, z), as seen from the cell (see doorways). */
function doorFrame(ctx, x, z, di, dj) {
    const { f } = ctx;
    const axis = di !== 0 ? 0 : 1;
    const toWall = di + dj;
    const wall = (axis === 0 ? x : z) + toWall * 0.5;
    const middle = axis === 0 ? z : x;
    // The wall's face on the cell's side, and out from it; its middle (a hair short of it: the rest is the next cell's).
    const face = wall - toWall * HALF_WALL;
    const out = (d) => face - toWall * d;
    const inner = wall - toWall * 0.0005;
    const lining = HALF_DOOR - FRAME_INSET;
    const top = DOOR_HEIGHT - FRAME_INSET;
    const room = acrossFace(axis, -toWall);
    for (const e of [-1, 1]) {
        // The frame's face beside the opening; its lining through the wall; and the stop down the middle.
        onWall(ctx, f, axis, face, out(CASING_OUT), middle + e * lining, middle + e * (HALF_DOOR + CASING), 0, top, FRAME_COLOR, F_PAINT);
        onWall(ctx, f, axis, inner, face, middle + e * lining, middle + e * (lining + 0.001), 0, top, FRAME_COLOR, F_PAINT, alongFace(axis, -e));
        onWall(ctx, f, axis, inner, wall - toWall * STOP_HALF, middle + e * (lining - STOP_OUT), middle + e * lining, 0, top, FRAME_COLOR, F_PAINT, alongFace(axis, -e) | room);
    }
    onWall(ctx, f, axis, face, out(CASING_OUT), middle - HALF_DOOR - CASING, middle + HALF_DOOR + CASING, top, DOOR_HEIGHT + CASING, FRAME_COLOR, F_PAINT);
    onWall(ctx, f, axis, inner, face, middle - lining, middle + lining, top - 0.001, top, FRAME_COLOR, F_PAINT, BOTTOM);
    onWall(ctx, f, axis, inner, wall - toWall * STOP_HALF, middle - lining + STOP_OUT, middle + lining - STOP_OUT, top - STOP_OUT, top, FRAME_COLOR, F_PAINT, BOTTOM | room);
    // Where the carpet meets the vinyl, the strip across the floor.
    const here = vinylAt(ctx, x, z);
    const there = vinylAt(ctx, x + di, z + dj);
    if (there !== null && there !== here) onWall(ctx, f, axis, inner, face, middle - lining + STOP_OUT, middle + lining - STOP_OUT, 0, 0.0025, THRESHOLD, F_METAL, TOP | room);
    // The light switch, on one side of it or the other.
    const v = hashInts(ctx.seed, 0x4d50, x, z, di * 3 + dj);
    if ((v & 3) === 0) return;
    const s = middle + ((v >>> 2) & 1 ? 1 : -1) * (HALF_DOOR + CASING + 0.045);
    const state = (v >>> 3) & 3;
    if (state === 3) {
        // Only the box, the plate gone, and the ends of its wires.
        onWall(ctx, f, axis, face, out(0.0008), s - 0.01, s + 0.01, 0.34, 0.378, 0x121212, F_PAINT);
        onWall(ctx, f, axis, face, out(0.004), s - 0.002, s + 0.001, 0.352, 0.36, 0x8a2a1a, F_PLASTIC);
        onWall(ctx, f, axis, face, out(0.003), s + 0.002, s + 0.005, 0.35, 0.357, 0x2a3a6a, F_PLASTIC);
        return;
    }
    onWall(ctx, f, axis, face, out(0.003), s - 0.012, s + 0.012, 0.338, 0.38, state === 2 ? 0xc4bca4 : 0xdad6cc, F_PLASTIC);
    // (Its rocker, unless the plate's a blank.)
    if (state !== 1) onWall(ctx, f, axis, out(0.003), out(0.006), s - 0.005, s + 0.005, 0.35, 0.368, state === 2 ? 0xb8b09a : 0xe2ded4, F_PLASTIC);
}

// ---------------------------------------------------------------------------------------------- columns

/**
 * The columns (the level's pillars, on the corners of the chunk's cells): cased and painted, their corners rounded, a
 * rubber skirting round the foot; in the core, bare concrete. And the shade round them on the floor and the ceiling.
 */
function columns(ctx) {
    const { chunk, data, store, x0, z0, ox, oz, f } = ctx;
    const half = store.pillarHalf;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            if (!chunk.pillars[i * N + j]) continue;
            const x = x0 + i + 0.5 - ox;
            const z = z0 + j + 0.5 - oz;
            if (data.kinds[i * N + j] & CELL_CORE) {
                slab(f, 1, x - half, 0, z - half, x + half, WALL_HEIGHT, z + half, 0.008, 0, CONCRETE, F_CONCRETE, CONCRETE, 0);
            } else {
                const lip = half + 0.003;
                slab(f, 1, x - lip, 0, z - lip, x + lip, SKIRTING, z + lip, 0.017, 0.001, SKIRTING_COLOR, F_RUBBER, SKIRTING_COLOR, TOP);
                slab(f, 1, x - half, SKIRTING, z - half, x + half, WALL_HEIGHT, z + half, 0.014, 0, COLUMN_PAINT, F_PAINT, COLUMN_PAINT, 0);
            }
            ctx.pillarShade?.(x, z, half);
        }
    }
}

// ---------------------------------------------------------------------------------------------- the ceiling

/**
 * What's in the ceiling besides the lights (see AbandonedOfficeData.details): the sprinklers, and the smoke detectors,
 * their lights still blinking.
 */
function ceilingDetails(ctx) {
    const { data, ox, oz, f, d } = ctx;
    const top = WALL_HEIGHT;
    for (const detail of data.details) {
        const x = detail.x - ox;
        const z = detail.z - oz;
        if (detail.type === DETAIL_SPRINKLER) {
            // Its plate, its body, the bulb, and the deflector under it (painted to go with the ceiling).
            rod(f, 1, x, top - 0.003, z, top - 0.0004, 0.012, 8, SPRINKLER, F_PAINT);
            rod(f, 1, x, top - 0.01, z, top - 0.003, 0.0038, 4, SPRINKLER, F_PAINT);
            rod(f, 1, x, top - 0.0172, z, top - 0.01, 0.0018, 4, 0x9a1a10, F_GLASS);
            rod(f, 1, x, top - 0.019, z, top - 0.0172, 0.0105, 6, SPRINKLER, F_PAINT);
        } else if (detail.type === DETAIL_DETECTOR) {
            rod(f, 1, x, top - 0.012, z, top - 0.0004, 0.026, 10, 0xd8d6ce, F_PLASTIC);
            rod(f, 1, x, top - 0.016, z, top - 0.012, 0.018, 8, 0xcecbc2, F_PLASTIC);
            d.light(0, 0, (detail.variant % 997) / 997, L_LED);
            face(d, x + 0.008, top - 0.0168, z, [1, 0, 0], [0, 0, 1], 0.0022, 0.0022, 0xffffff);
        }
    }
}

// ---------------------------------------------------------------------------------------------- cubicles

/** The rail along the top of a partition: how far it reaches either side of the partition's line, and how deep it is. */
const RAIL_HALF = 0.031;
const RAIL_DEEP = 0.016;
/** How far the post at a partition's end reaches either way along it from the end. */
const POST_HALF = 0.012;

/**
 * The cubicles' partitions (see AbandonedOfficeData.partitions): fabric panels on a dark plinth, a rounded aluminium
 * rail along their tops, and where a row of them ends in the aisle, an aluminium post. The spine between two rows is in
 * pieces from one partition across it to the next, its panels' ends against their faces and its rail's against their
 * rails.
 */
function partitions(ctx) {
    const { data, ox, oz, f, chunk } = ctx;
    const fabric = FABRICS[(chunk.zone.variant >>> 3) % FABRICS.length];
    const p = data.partitions;
    const t = PARTITION_HALF;
    for (let k = 0; k < p.length; k += 5) {
        const [ax, az, bx, bz, height] = [p[k] - ox, p[k + 1] - oz, p[k + 2] - ox, p[k + 3] - oz, p[k + 4]];
        const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
        const s0 = alongX ? Math.min(ax, bx) : Math.min(az, bz);
        const s1 = alongX ? Math.max(ax, bx) : Math.max(az, bz);
        const line = alongX ? az : ax;
        // (A piece of a spine: less than a cell long, between two partitions across it.)
        const spine = s1 - s0 < 1.5;
        // A length of it from `from` to `to`, `half` either side of its line, from y0 to y1, its edges along it rounded
        // by r; with its ends, or not.
        const run = (from, to, half, y0, y1, r, color, kind, ends) => {
            const caps = ends ? TOP | BOTTOM : 0;
            if (alongX) slab(f, 0, from, y0, line - half, to, y1, line + half, r, 0, color, kind, color, caps);
            else slab(f, 2, line - half, y0, from, line + half, y1, to, r, 0, color, kind, color, caps);
        };
        run(s0, s1, t - 0.005, 0, 0.04, 0, 0x26282a, F_PLASTIC, false);
        run(s0, s1, t, 0.04, height - RAIL_DEEP, 0, fabric, F_FABRIC, false);
        if (spine) {
            run(s0 + RAIL_HALF - t, s1 - RAIL_HALF + t, RAIL_HALF, height - RAIL_DEEP, height, RAIL_DEEP / 2, RAIL, F_METAL, false);
            continue;
        }
        run(s0 - POST_HALF, s1 + POST_HALF, RAIL_HALF, height - RAIL_DEEP, height, RAIL_DEEP / 2, RAIL, F_METAL, true);
        // Its posts, capping its ends in the aisle.
        const across = t + 0.003;
        for (const s of [s0, s1]) {
            if (alongX) slab(f, 1, s - POST_HALF, 0, line - across, s + POST_HALF, height - RAIL_DEEP, line + across, 0.006, 0, POST, F_METAL, POST, 0);
            else slab(f, 1, line - across, 0, s - POST_HALF, line + across, height - RAIL_DEEP, s + POST_HALF, 0.006, 0, POST, F_METAL, POST, 0);
        }
    }
}

// ---------------------------------------------------------------------------------------------- furniture

/**
 * A task chair, in its own frame (facing +z), `seat` its colour: five spokes on their castors, the gas lift, the seat
 * cushion, and the back on its stem, cupped round whoever sat in it and leaning back a little; its arms, if it has them.
 */
function chair(ctx, seat, arms) {
    const { f } = ctx;
    for (let k = 0; k < 5; k++) {
        const start = f.vertexCount;
        block(f, -0.0065, 0.02, 0.014, 0.0065, 0.032, 0.102, CHARCOAL, F_PLASTIC, ALL & ~MINUS_Z);
        // (Six-sided, on a flat: its middle as high over the floor as its flats are from it.)
        rod(f, 0, -0.0085, 0.011 * Math.cos(Math.PI / 6), 0.1, 0.0085, 0.011, 6, BLACK, F_RUBBER);
        f.transform(start, (k / 5) * Math.PI * 2 + 0.3, 0, 0);
    }
    rod(f, 1, 0, 0.018, 0, 0.036, 0.02, 8, CHARCOAL, F_PLASTIC);
    rod(f, 1, 0, 0.036, 0, 0.13, 0.0135, 8, 0x1a1b1c, F_PLASTIC);
    rod(f, 1, 0, 0.13, 0, 0.18, 0.008, 6, 0x8a8e90, F_METAL);
    block(f, -0.055, 0.178, -0.06, 0.055, 0.197, 0.05, CHARCOAL, F_PLASTIC, ALL & ~TOP);
    slab(f, 1, -0.1, 0.196, -0.094, 0.1, 0.236, 0.1, 0.04, 0.014, seat, F_VINYL, seat, TOP | BOTTOM | SQUARE_BELOW);
    // The back on its stem, up from under the seat.
    const start = f.vertexCount;
    block(f, -0.012, 0.184, -0.112, 0.012, 0.196, -0.06, CHARCOAL, F_PLASTIC, ALL & ~PLUS_Z);
    block(f, -0.013, 0.184, -0.118, 0.013, 0.31, -0.096, CHARCOAL, F_PLASTIC);
    const cushion = f.vertexCount;
    slab(f, 2, -0.092, 0.265, -0.132, 0.092, 0.465, -0.108, 0.04, 0.009, seat, F_VINYL);
    cup(f, cushion, 1.7);
    tilt(f, start, -0.12, 0.22, -0.1);
    if (arms) {
        for (const s of [-1, 1]) {
            // (Its bracket from under the seat, and its post clear of the seat's side.)
            block(f, s * 0.045, 0.183, -0.032, s * 0.115, 0.195, -0.008, CHARCOAL, F_PLASTIC);
            block(f, s * 0.103, 0.195, -0.032, s * 0.115, 0.323, -0.008, CHARCOAL, F_PLASTIC, ALL & ~(TOP | BOTTOM));
            slab(f, 1, s * 0.108 - 0.012, 0.322, -0.07, s * 0.108 + 0.012, 0.336, 0.058, 0.011, 0.004, 0x1e1f21, F_RUBBER, 0x1e1f21, TOP | BOTTOM | SQUARE_BELOW);
        }
    }
}

/**
 * A stacking chair: a plastic shell on four steel legs, at the corners of the seat and just outside it (so that stacked,
 * each one's legs go down past the seat of the one under it, not through it). At height y (stacked).
 */
function stackingChair(ctx, y, color) {
    const { f } = ctx;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rod(f, 1, sx * 0.104, y, sz * 0.104, y + 0.222, 0.005, 5, STEEL);
    slab(f, 1, -0.1, y + 0.22, -0.1, 0.1, y + 0.235, 0.1, 0.012, 0.004, color, F_PLASTIC, color, TOP | BOTTOM | SQUARE_BELOW);
    // The back, cupped, on the back legs carried on up.
    for (const s of [-1, 1]) rod(f, 1, s * 0.07, y + 0.235, -0.1025, y + 0.28, 0.0045, 5, STEEL);
    const start = f.vertexCount;
    slab(f, 2, -0.09, y + 0.27, -0.11, 0.09, y + 0.42, -0.095, 0.03, 0.004, color, F_PLASTIC);
    cup(f, start, 1.2);
}

/**
 * An old computer on a desk at (x, y, z): its monitor facing +z (lit, or dead), the keyboard in front of it; turned by
 * `yaw` about where it is.
 */
function computer(ctx, x, y, z, on, yellow, yaw = 0) {
    const { f, d, g } = ctx;
    const starts = [f.vertexCount, d.vertexCount, g.vertexCount];
    computerParts(ctx, y, on, yellow);
    f.transform(starts[0], yaw, x, z);
    d.transform(starts[1], yaw, x, z);
    g.transform(starts[2], yaw, x, z);
}

/**
 * The computer's parts (see computer), at the origin, at height y, facing +z: the monitor on its foot, deep at the back
 * round the tube; the keyboard, its keys a shade darker; the mouse.
 */
function computerParts(ctx, y, on, yellow) {
    const { f, d, g } = ctx;
    rod(f, 1, 0, y, -0.025, y + 0.008, 0.048, 10, BEIGE, F_PLASTIC);
    f.finish(F_PLASTIC, yellow);
    soft(f, -0.02, y + 0.008, -0.045, 0.02, y + 0.024, -0.012, 0.004, BEIGE, F_PLASTIC, TOP | BOTTOM, yellow);
    slab(f, 2, -0.076, y + 0.02, -0.022, 0.076, y + 0.152, 0.03, 0.012, 0.005, BEIGE, F_PLASTIC, BEIGE, TOP, yellow);
    taper(f, -0.022, [-0.068, y + 0.03, 0.068, y + 0.145], -0.1, [-0.044, y + 0.05, 0.044, y + 0.128], BEIGE, F_PLASTIC, yellow);
    // The screen, in its bezel.
    slab(f, 2, -0.063, y + 0.033, 0.03, 0.063, y + 0.139, 0.031, 0.006, 0, BEIGE_DARK, F_PLASTIC, BEIGE_DARK, TOP, yellow);
    if (on) {
        d.light(0, 0, 1, L_SCREEN);
        face(d, 0, y + 0.086, 0.032, [1, 0, 0], [0, 1, 0], 0.057, 0.047, 0xffffff);
        g.spot(0, y + 0.086, 0.05, 0.13, -21, 0.35, 0.9);
    } else {
        block(f, -0.057, y + 0.039, 0.031, 0.057, y + 0.133, 0.032, SCREEN_OFF, F_GLASS, PLUS_Z);
    }
    slab(f, 1, -0.075, y, 0.08, 0.075, y + 0.009, 0.13, 0.006, 0.002, BEIGE, F_PLASTIC, BEIGE, TOP, yellow);
    slab(f, 1, -0.067, y + 0.009, 0.087, 0.067, y + 0.012, 0.123, 0.002, 0.001, BEIGE_DARK, F_PLASTIC, BEIGE_DARK, TOP, yellow);
    slab(f, 1, 0.1, y, 0.1, 0.12, y + 0.009, 0.13, 0.009, 0.004, BEIGE, F_PLASTIC, BEIGE, TOP, yellow);
}

/** A desk phone at (x, y, z), facing (sin yaw, cos yaw): its base, the keypad sloping up to the back, the handset. */
function deskPhone(ctx, x, y, z, yaw) {
    const { f } = ctx;
    const start = f.vertexCount;
    soft(f, -0.042, y, -0.04, 0.042, y + 0.016, 0.04, 0.006, PHONE, F_PLASTIC, TOP);
    const deck = f.vertexCount;
    slab(f, 1, -0.018, y + 0.012, -0.032, 0.038, y + 0.018, 0.03, 0.006, 0.002, PHONE, F_PLASTIC, PHONE, TOP);
    slab(f, 1, -0.008, y + 0.018, -0.022, 0.03, y + 0.0195, 0.012, 0.003, 0, 0x8a8c8e, F_PLASTIC, 0x8a8c8e, TOP);
    tilt(f, deck, 0.22, y + 0.016, 0.03);
    slab(f, 2, -0.044, y + 0.016, -0.042, -0.022, y + 0.032, 0.04, 0.007, 0.003, PHONE, F_PLASTIC);
    f.transform(start, yaw, x, z);
}

/** Paper on a desk: a few sheets, a pile, a mug. From the bits of `v`. */
function clutter(ctx, x, y, z, v) {
    const { f } = ctx;
    if (v & 1) block(f, x - 0.05, y, z - 0.035, x + 0.05, y + 0.002, z + 0.035, PAPER, F_PAINT);
    if (v & 2) block(f, x + 0.06, y, z - 0.03, x + 0.14, y + 0.03, z + 0.03, PAPER, F_PAINT);
    if (v & 4) rod(f, 1, x - 0.1, y, z + 0.02, y + 0.035, 0.013, 10, (v >>> 3) & 1 ? 0xd8d4c8 : 0x2a3a6a, F_PLASTIC);
    if (v & 8) slab(f, 1, x - 0.04, y, z + 0.06, x + 0.02, y + 0.018, z + 0.1, 0.004, 0.002, 0x1c1c1c, F_PLASTIC, 0x1c1c1c, TOP);
}

/** One piece of furniture (see abandonedOfficeFurniture.js), built in its frame and put where it goes. */
function furniture(ctx, piece) {
    const { f, d, g } = ctx;
    const v = piece.variant;
    const random = mulberry32(v ^ 0x51f7);
    inFrame(ctx, piece.yaw, piece.x, piece.z, () => {
        switch (piece.type) {
            case FURN_WORKSTATION: {
                // Its top against the spine (+z), and the return along one side (run in under the top, so the two meet
                // flush); the panel leg at the far end, and the pedestal under the return, its drawers towards the chair.
                const top = 0.27;
                const laminate = LAMINATES[(v >>> 20) % LAMINATES.length];
                const wear = (v >>> 8) & 7;
                const side = (v >>> 3) & 1 ? 1 : -1;
                slab(f, 1, -0.43, top - 0.016, 0.14, 0.43, top, 0.44, 0.02, 0.004, laminate, F_LAMINATE, EDGE_BAND, TOP | BOTTOM | SQUARE_BELOW, wear);
                slab(f, 1, side * 0.14, top - 0.016, -0.3, side * 0.43, top, 0.2, 0.02, 0.004, laminate, F_LAMINATE, EDGE_BAND, TOP | BOTTOM | SQUARE_BELOW, wear);
                soft(f, -side * 0.425, 0, 0.16, -side * 0.4, top - 0.016, 0.42, 0.004, PEDESTAL, F_METAL, 0);
                soft(f, side * 0.26, 0, -0.26, side * 0.41, top - 0.016, 0.1, 0.006, PEDESTAL, F_METAL, 0);
                for (let k = 0; k < 3; k++) {
                    const [y0, y1] = k === 0 ? [0.012, 0.118] : k === 1 ? [0.122, 0.186] : [0.19, 0.248];
                    slab(f, 0, side * 0.2555, y0, -0.252, side * 0.26, y1, 0.092, 0.004, 0, 0x686a6c, F_METAL, 0x686a6c, side > 0 ? BOTTOM : TOP);
                    block(f, side * 0.2495, y1 - 0.02, -0.12, side * 0.2555, y1 - 0.012, -0.03, STEEL, F_METAL, ALL & ~(side > 0 ? PLUS_X : MINUS_X));
                }
                const contents = v & 7;
                if (contents !== 0) {
                    // Facing whoever sits at it.
                    computer(ctx, -side * 0.18, top, 0.3, workstationOn(v), ((v >>> 17) & 3) / 3, Math.PI);
                    clutter(ctx, side * 0.24, top, 0.28, v >>> 24);
                    if (contents > 4) deskPhone(ctx, side * 0.34, top, -0.15, Math.atan2(-side, -1));
                }
                // Its chair, if it's still here: in at the desk, pushed back, turned away.
                const chairState = (v >>> 4) & 3;
                if (chairState !== 0) {
                    const start = f.vertexCount;
                    chair(ctx, SEATS[(v >>> 26) % SEATS.length], chairState === 3);
                    const yaw = chairState === 2 ? 2.2 + random() * 1.8 : (random() - 0.5) * 0.6;
                    f.transform(start, yaw, -side * 0.08, chairState === 2 ? -0.14 : 0.0);
                }
                break;
            }
            case FURN_DESK: {
                // Its top, its end panels, and the modesty panel across its front.
                const top = 0.27;
                const laminate = LAMINATES[(v >>> 20) % LAMINATES.length];
                slab(f, 1, -0.26, top - 0.018, -0.13, 0.26, top, 0.13, 0.015, 0.004, laminate, F_LAMINATE, EDGE_BAND, TOP | BOTTOM | SQUARE_BELOW);
                soft(f, -0.255, 0, -0.12, -0.235, top - 0.018, 0.12, 0.004, laminate, F_LAMINATE, 0);
                soft(f, 0.235, 0, -0.12, 0.255, top - 0.018, 0.12, 0.004, laminate, F_LAMINATE, 0);
                slab(f, 2, -0.235, 0.08, 0.098, 0.235, top - 0.018, 0.114, 0, 0.003, laminate, F_LAMINATE);
                // Facing whoever sat behind it (its keyboard on the desk).
                if (v & 7) computer(ctx, 0.12, top, 0.01, false, ((v >>> 17) & 3) / 3, Math.PI);
                clutter(ctx, -0.12, top, 0.02, v >>> 24);
                // Its chair, behind it (its arms clear of the desk, its back of the wall: see DESK_CHAIR).
                if ((v >>> 4) & 3) {
                    const chairStart = f.vertexCount;
                    chair(ctx, SEATS[(v >>> 26) % SEATS.length], true);
                    f.transform(chairStart, (random() * 2 - 1) * DESK_CHAIR_TURN, 0, -DESK_CHAIR);
                }
                break;
            }
            case FURN_TABLE: {
                // Its top, rounded, on two pedestals; what was left on it: the phone in the middle for the calls, papers,
                // a mug.
                const length = (piece.length ?? 1) * 0.5 - 0.2;
                const top = 0.265;
                slab(f, 1, -length, top - 0.02, -0.18, length, top, 0.18, 0.1, 0.005, 0x5a4230, F_LAMINATE, 0x2e2218, TOP | BOTTOM | SQUARE_BELOW);
                for (const s of [-1, 1]) {
                    const lx = s * (length - 0.12);
                    soft(f, lx - 0.03, 0, -0.12, lx + 0.03, 0.014, 0.12, 0.006, 0x3a3c3e, F_METAL, TOP);
                    rod(f, 1, lx, 0.014, 0, top - 0.02, 0.018, 10, 0x3a3c3e, F_METAL);
                }
                if (v & 16) {
                    rod(f, 1, length * 0.35, top, 0, top + 0.008, 0.05, 14, 0x2a2c30, F_PLASTIC);
                    rod(f, 1, length * 0.35, top + 0.008, 0, top + 0.011, 0.034, 14, 0x16171a, F_FABRIC);
                }
                clutter(ctx, -length * 0.55, top, (v >>> 6) & 1 ? 0.06 : -0.1, (v >>> 7) & 15);
                // Chairs down both sides (their arms clear of the top), a few gone, a few pushed back (see TABLE_CHAIRS in
                // abandonedOfficeFurniture.js).
                const seat = SEATS[(v >>> 26) % SEATS.length];
                const each = Math.max(1, Math.floor((length * 2) / 0.3));
                for (const s of [-1, 1]) {
                    for (let k = 0; k < each; k++) {
                        if (random() < 0.2) continue;
                        const at = -length + (k + 0.5) * ((length * 2) / each);
                        const start = f.vertexCount;
                        chair(ctx, seat, true);
                        const back = random() < 0.3 ? 0.08 + random() * 0.06 : 0;
                        f.transform(start, (s > 0 ? Math.PI : 0) + (random() - 0.5) * 0.5, at, s * (0.275 + back));
                    }
                }
                break;
            }
            case FURN_VENDING: {
                // Its cabinet; the glass front in its frame, and the rows behind it; the keypad and the coin slot beside
                // it, the flap below.
                const body = MACHINES[v % MACHINES.length];
                soft(f, -0.15, 0, -0.15, 0.15, 0.68, 0.15, 0.01, body, F_PAINT);
                slab(f, 2, -0.142, 0.148, 0.15, 0.062, 0.652, 0.156, 0.006, 0.002, 0x151618, F_PLASTIC, 0x151618, TOP);
                d.light(0, 0, 1 + (v % 61), L_VENDING);
                face(d, -0.04, 0.4, 0.157, [1, 0, 0], [0, 1, 0], 0.095, 0.24, 0xffffff);
                slab(f, 2, 0.072, 0.3, 0.15, 0.13, 0.52, 0.156, 0.004, 0.0015, 0x3a3c3e, F_METAL, 0x3a3c3e, TOP);
                block(f, 0.085, 0.47, 0.156, 0.115, 0.49, 0.158, 0x301a08, F_GLASS, PLUS_Z | TOP | BOTTOM | PLUS_X | MINUS_X);
                for (let k = 0; k < 3; k++) block(f, 0.086 + k * 0.01, 0.4, 0.156, 0.093 + k * 0.01, 0.44, 0.1575, 0x9a9c9e, F_METAL, PLUS_Z | TOP | BOTTOM | PLUS_X | MINUS_X);
                slab(f, 2, -0.13, 0.04, 0.15, 0.05, 0.125, 0.158, 0.006, 0.002, 0x0e0e0e, F_PLASTIC, 0x0e0e0e, TOP);
                slab(f, 2, -0.12, 0.052, 0.158, 0.04, 0.1, 0.161, 0.004, 0.0015, 0x1c1c1e, F_PLASTIC, 0x1c1c1e, TOP);
                g.spot(-0.04, 0.4, 0.2, 0.36, -20, 0.1, 1.6);
                break;
            }
            case FURN_CHAIR: {
                // Left where it was pushed; now and then, on its back: lying on it and its back castor, set down on
                // the floor where it is (see TIPPED_HALF).
                const start = f.vertexCount;
                chair(ctx, SEATS[(v >>> 26) % SEATS.length], (v & 3) !== 0);
                if (chairTipped(v)) {
                    tilt(f, start, -Math.PI / 2 + 0.11, 0, -0.16);
                    settle(f, start);
                }
                break;
            }
            case FURN_STACK: {
                const color = [0x2a3a5a, 0x3a3a3a, 0x6a2a24, 0xb0a890][v & 3];
                const count = 3 + ((v >>> 2) & 3);
                for (let k = 0; k < count; k++) stackingChair(ctx, k * 0.035, color);
                break;
            }
            case FURN_CABINET: {
                // Four drawers, each with its handle and the holder for its label; one sometimes left open, full of
                // files.
                const color = (v & 1) ? 0x8e8c84 : 0xb4ae9c;
                soft(f, -0.075, 0, -0.1, 0.075, 0.48, 0.1, 0.005, color, F_PAINT);
                const open = (v >>> 1) & 3;
                for (let k = 0; k < 4; k++) {
                    const y = 0.012 + k * 0.117;
                    const out = open === 1 && k === 2 ? 0.11 : 0;
                    if (out) {
                        block(f, -0.066, y + 0.004, -0.09 + out, 0.066, y + 0.1, 0.1 + out, color, F_PAINT, PLUS_X | MINUS_X | BOTTOM);
                        for (let n = 0; n < 5; n++) block(f, -0.06, y + 0.01, 0.0 + n * 0.035, 0.06, y + 0.1, 0.012 + n * 0.035, n & 1 ? 0xd8c890 : 0xc8b070, F_PAINT, TOP | PLUS_Z | MINUS_Z);
                    }
                    slab(f, 2, -0.069, y, 0.1 + out, 0.069, y + 0.108, 0.106 + out, 0.004, 0.0015, color, F_PAINT, color, out ? TOP | BOTTOM : TOP);
                    soft(f, -0.028, y + 0.062, 0.106 + out, 0.028, y + 0.07, 0.114 + out, 0.0025, STEEL, F_METAL);
                    block(f, -0.018, y + 0.078, 0.106 + out, 0.018, y + 0.094, 0.1072 + out, 0xd8d4c4, F_PAINT, PLUS_Z | TOP | BOTTOM | PLUS_X | MINUS_X);
                }
                break;
            }
            case FURN_SHELF: {
                const wood = (v & 1) ? 0x6a5040 : 0x8a8a86;
                // Its sides and back, its top over them, the shelves between.
                soft(f, -0.17, 0, -0.07, -0.155, 0.64, 0.07, 0.003, wood, F_LAMINATE, 0);
                soft(f, 0.155, 0, -0.07, 0.17, 0.64, 0.07, 0.003, wood, F_LAMINATE, 0);
                block(f, -0.155, 0, -0.07, 0.155, 0.64, -0.06, wood, F_LAMINATE, PLUS_Z);
                soft(f, -0.17, 0.64, -0.07, 0.17, 0.66, 0.07, 0.003, wood, F_LAMINATE);
                for (let k = 0; k < 4; k++) {
                    const y = k * 0.16;
                    block(f, -0.155, y, -0.06, 0.155, y + 0.015, 0.07, wood, F_LAMINATE, TOP | BOTTOM | PLUS_Z);
                    // Binders, some gone, the last leaning over.
                    let x = -0.15;
                    while (x < 0.13) {
                        const w = 0.02 + random() * 0.015;
                        // (The last one stops at the side.)
                        const right = Math.min(x + w - 0.002, 0.153);
                        if (random() < 0.8) block(f, x, y + 0.015, -0.05, right, y + 0.13 - random() * 0.02, 0.05, BINDERS[Math.floor(random() * BINDERS.length)], F_PLASTIC, ALL & ~BOTTOM);
                        else x += 0.02;
                        x += w;
                    }
                }
                break;
            }
            case FURN_SOFA: {
                // On its feet: its frame, the seat and back cushions, the arms; its low table, and what was on it.
                const color = [0x3a4a5a, 0x5a4a3a, 0x3a3a3a, 0x4a3a4a][v & 3];
                for (const s of [-1, 1]) for (const z of [-0.185, -0.035]) soft(f, s * 0.235 - 0.01, 0, z - 0.01, s * 0.235 + 0.01, 0.03, z + 0.01, 0.003, 0x1a1a1a, F_PLASTIC, 0);
                soft(f, -0.26, 0.03, -0.2, 0.26, 0.1, -0.02, 0.008, color, F_VINYL);
                soft(f, -0.26, 0.1, -0.2, 0.26, 0.3, -0.165, 0.012, color, F_VINYL);
                for (const s of [-1, 1]) {
                    slab(f, 1, s > 0 ? 0.003 : -0.219, 0.1, -0.165, s > 0 ? 0.219 : -0.003, 0.14, -0.022, 0.02, 0.012, color, F_VINYL, color, TOP);
                    slab(f, 2, s > 0 ? 0.004 : -0.218, 0.14, -0.165, s > 0 ? 0.218 : -0.004, 0.28, -0.13, 0.03, 0.012, color, F_VINYL, color, TOP);
                    soft(f, s * 0.26 - s * 0.04, 0.1, -0.2, s * 0.26, 0.2, -0.02, 0.014, color, F_VINYL, TOP);
                }
                slab(f, 1, -0.15, 0.12, 0.06, 0.15, 0.135, 0.19, 0.012, 0.003, 0x5a4230, F_LAMINATE);
                for (const s of [-1, 1]) soft(f, s * 0.13 - 0.01, 0, 0.07, s * 0.13 + 0.01, 0.12, 0.18, 0.003, 0x3a3c3e, F_METAL, 0);
                if (v & 4) block(f, -0.06, 0.135, 0.09, 0.04, 0.139, 0.15, 0xb8a888, F_PAINT);
                break;
            }
            case FURN_COPIER: {
                // On its castors: the trays down its front, the glass and the lid, the feeder on top, the panel, and
                // the tray it printed into.
                soft(f, -0.16, 0.02, -0.12, 0.16, 0.34, 0.12, 0.008, 0xc8c4b8, F_PLASTIC, TOP | BOTTOM, 0.5);
                soft(f, -0.15, 0, -0.11, 0.15, 0.02, 0.11, 0.004, 0x3a3a3a, F_PLASTIC, TOP);
                for (let k = 0; k < 3; k++) {
                    slab(f, 2, -0.15, 0.04 + k * 0.07, 0.12, 0.15, 0.1 + k * 0.07, 0.126, 0.006, 0.002, 0xb8b4a8, F_PLASTIC, 0xb8b4a8, TOP, 0.5);
                    block(f, -0.05, 0.085 + k * 0.07, 0.126, 0.05, 0.093 + k * 0.07, 0.1275, 0x3a3a38, F_PLASTIC, PLUS_Z | TOP | BOTTOM | PLUS_X | MINUS_X);
                }
                soft(f, -0.16, 0.34, -0.12, 0.12, 0.356, 0.1, 0.004, 0x6a6a68, F_PLASTIC, TOP);
                soft(f, -0.14, 0.356, -0.1, 0.08, 0.368, 0.05, 0.005, 0x8a8a86, F_PLASTIC, TOP);
                const panel = f.vertexCount;
                slab(f, 1, 0.12, 0.34, -0.02, 0.16, 0.356, 0.12, 0.004, 0.002, 0x2a2a2a, F_PLASTIC, 0x2a2a2a, TOP);
                tilt(f, panel, 0.15, 0.34, 0.12);
                slab(f, 1, 0.16, 0.25, -0.06, 0.22, 0.26, 0.06, 0.006, 0.002, 0xb8b4a8, F_PLASTIC);
                block(f, 0.165, 0.26, -0.05, 0.215, 0.27, 0.05, PAPER, F_PAINT);
                break;
            }
            case FURN_COUNTER: {
                // Its cupboards on their plinth, the worktop, the tiles over it, and above, the wall cupboards (the
                // worktop, the tiles and those up to the next in the run, or to the wall at its end: see reach); the
                // sink, or the microwave and the coffee.
                const doors = (v >>> 4) & 1 ? 0x8a9a9a : 0xd8d4c8;
                const [r0, r1] = piece.reach ?? [0.46, 0.46];
                block(f, -r0, 0, -0.11, r1, 0.02, 0.085, 0x1a1a1a, F_RUBBER, PLUS_Z | TOP | PLUS_X | MINUS_X);
                block(f, -r0, 0.02, -0.11, r1, 0.31, 0.098, doors, F_PAINT, ALL & ~MINUS_Z);
                block(f, -r0, 0.56, -0.115, r1, 0.8, 0.006, doors, F_PAINT, ALL & ~MINUS_Z);
                for (const [a, b] of [[-r0 + 0.004, -0.002], [0.002, r1 - 0.004]]) {
                    const pull = a < 0 ? b - 0.03 : a + 0.03;
                    slab(f, 2, a, 0.03, 0.098, b, 0.302, 0.104, 0.004, 0.0015, doors, F_PAINT, doors, TOP);
                    soft(f, pull - 0.004, 0.245, 0.104, pull + 0.004, 0.29, 0.11, 0.002, STEEL, F_METAL);
                    slab(f, 2, a, 0.566, 0.006, b, 0.795, 0.012, 0.004, 0.0015, doors, F_PAINT, doors, TOP);
                    soft(f, pull - 0.004, 0.572, 0.012, pull + 0.004, 0.61, 0.018, 0.002, STEEL, F_METAL);
                }
                slab(f, 1, -r0, 0.31, -0.115, r1, 0.33, 0.12, 0, 0, 0x6a6a66, F_LAMINATE, 0x3e3e3a);
                block(f, -r0, 0.33, -0.115, r1, 0.56, -0.111, TILE, F_TILE, PLUS_Z | PLUS_X | MINUS_X);
                if ((v & 3) === 1) {
                    // The sink: its rim, the bowl in it, and the tap.
                    soft(f, -0.13, 0.33, -0.075, 0.13, 0.3335, 0.09, 0.002, STEEL, F_METAL, TOP);
                    block(f, -0.115, 0.3335, -0.06, 0.115, 0.3345, 0.075, 0x2e3032, F_METAL, TOP);
                    rod(f, 1, 0, 0.33, -0.092, 0.405, 0.0065, 8, STEEL);
                    rod(f, 2, 0, 0.398, -0.092, -0.03, 0.005, 8, STEEL);
                    soft(f, -0.004, 0.37, -0.1, 0.004, 0.378, -0.07, 0.002, STEEL, F_METAL);
                } else {
                    // The microwave, its door's window and its buttons; the coffee maker and its jug.
                    soft(f, -0.3, 0.33, -0.09, -0.08, 0.44, 0.06, 0.006, 0xd8d8d0, F_PLASTIC, TOP);
                    slab(f, 2, -0.29, 0.345, 0.06, -0.15, 0.425, 0.063, 0.006, 0.002, 0x101418, F_GLASS, 0x101418, TOP);
                    slab(f, 2, -0.135, 0.35, 0.06, -0.095, 0.42, 0.0625, 0.003, 0.001, 0x3a3c3e, F_PLASTIC, 0x3a3c3e, TOP);
                    soft(f, 0.12, 0.33, -0.08, 0.22, 0.47, 0.0, 0.008, 0x1c1c1c, F_PLASTIC, TOP);
                    soft(f, 0.13, 0.42, 0.0, 0.21, 0.46, 0.04, 0.008, 0x1c1c1c, F_PLASTIC, TOP | BOTTOM);
                    rod(f, 1, 0.17, 0.33, 0.03, 0.4, 0.025, 12, 0x2a1a10, F_GLASS);
                }
                break;
            }
            case FURN_FRIDGE: {
                // The freezer over the fridge, and their handles.
                soft(f, -0.13, 0, -0.12, 0.13, 0.64, 0.11, 0.008, (v >>> 4) & 1 ? 0xb0b2b2 : 0xdedad0, F_PAINT);
                block(f, -0.124, 0.428, 0.11, 0.124, 0.434, 0.111, 0x5a5a5a, F_PAINT, PLUS_Z);
                soft(f, 0.086, 0.3, 0.11, 0.1, 0.41, 0.125, 0.004, STEEL, F_METAL);
                soft(f, 0.086, 0.45, 0.11, 0.1, 0.55, 0.125, 0.004, STEEL, F_METAL);
                break;
            }
            case FURN_ROUND_TABLE: {
                rod(f, 1, 0, 0.261, 0, 0.275, 0.16, 20, 0xd8d4c8, F_LAMINATE);
                rod(f, 1, 0, 0.255, 0, 0.261, 0.156, 20, 0x5a5850, F_PLASTIC);
                rod(f, 1, 0, 0.012, 0, 0.255, 0.018, 8, 0x3a3c3e, F_METAL);
                rod(f, 1, 0, 0, 0, 0.012, 0.1, 14, 0x3a3c3e, F_METAL);
                const chairs = 2 + (v & 1);
                for (let k = 0; k < chairs; k++) {
                    const start = f.vertexCount;
                    stackingChair(ctx, 0, [0x2a3a5a, 0x6a2a24, 0xb0a890][(v >>> 2) % 3]);
                    const a = (k / chairs) * Math.PI * 2 + random() * 0.5;
                    f.transform(start, a + Math.PI, Math.sin(a) * 0.24, Math.cos(a) * 0.24);
                }
                if (v & 8) rod(f, 1, 0.05, 0.275, 0.03, 0.31, 0.013, 10, 0xd8d4c8, F_PLASTIC);
                break;
            }
            case FURN_WHITEBOARD: {
                // The board in its aluminium frame, and the tray along its foot, a pen left in it.
                block(f, -0.294, 0.366, -0.02, 0.294, 0.714, -0.014, 0xb4b8ba, F_METAL, ALL & ~MINUS_Z);
                d.light(0, 0, (v % 997) / 997, L_BOARD);
                face(d, 0, 0.54, -0.013, [1, 0, 0], [0, 1, 0], 0.288, 0.168, 0xffffff);
                slab(f, 0, -0.3, 0.708, -0.02, 0.3, 0.72, -0.01, 0.004, 0, 0xa4a8aa, F_METAL, 0xa4a8aa);
                slab(f, 0, -0.3, 0.36, -0.02, 0.3, 0.372, -0.01, 0.004, 0, 0xa4a8aa, F_METAL, 0xa4a8aa);
                slab(f, 1, -0.3, 0.372, -0.02, -0.288, 0.708, -0.01, 0.004, 0, 0xa4a8aa, F_METAL, 0xa4a8aa, 0);
                slab(f, 1, 0.288, 0.372, -0.02, 0.3, 0.708, -0.01, 0.004, 0, 0xa4a8aa, F_METAL, 0xa4a8aa, 0);
                slab(f, 0, -0.2, 0.345, -0.02, 0.2, 0.36, 0.012, 0.005, 0.002, 0xa4a8aa, F_METAL);
                if (v & 64) rod(f, 0, -0.1, 0.365, 0.0, -0.035, 0.005, 6, (v >>> 7) & 1 ? 0x1a2a6a : 0x1a1a1a, F_PLASTIC);
                break;
            }
            case FURN_CLOCK: {
                rod(f, 2, 0, 0.8, -0.02, -0.004, 0.062, 24, 0x1c1c1c, F_PLASTIC);
                d.light(0, 0, (v % 991) / 991, L_CLOCK);
                face(d, 0, 0.8, -0.0028, [1, 0, 0], [0, 1, 0], 0.056, 0.056, 0xffffff);
                break;
            }
            case FURN_FOUNTAIN: {
                soft(f, -0.07, 0.24, -0.06, 0.07, 0.3, 0.05, 0.008, 0xa8acae, F_METAL);
                block(f, -0.05, 0.3, -0.05, 0.05, 0.301, 0.03, 0x6a6e70, F_METAL, TOP);
                rod(f, 1, 0.02, 0.3, 0.0, 0.325, 0.006, 6, STEEL);
                soft(f, -0.02, 0.1, -0.06, 0.02, 0.24, -0.02, 0.004, 0x8a8e90, F_METAL, BOTTOM);
                break;
            }
            case FURN_EXTINGUISHER: {
                // Its bracket on the wall, the cylinder in it, its label; the valve, the lever and the hose; and the
                // sign over it.
                soft(f, -0.016, 0.2, -0.035, 0.016, 0.232, -0.029, 0.002, 0x2a2a2a, F_METAL);
                rod(f, 1, 0, 0.16, -0.008, 0.305, 0.021, 12, 0xa3160e, F_PAINT);
                rod(f, 1, 0, 0.215, -0.008, 0.265, 0.022, 12, 0xd8d4c8, F_PAINT);
                rod(f, 1, 0, 0.305, -0.008, 0.318, 0.013, 10, 0xa3160e, F_PAINT);
                rod(f, 1, 0, 0.318, -0.008, 0.338, 0.0055, 6, 0x2a2a2a, F_METAL);
                soft(f, -0.004, 0.334, -0.028, 0.004, 0.342, 0.022, 0.002, 0x1a1a1a, F_METAL);
                rod(f, 1, 0.026, 0.2, -0.008, 0.32, 0.0036, 6, BLACK, F_RUBBER);
                block(f, -0.028, 0.39, -0.035, 0.028, 0.45, -0.032, 0xb01c14, F_PLASTIC, ALL & ~MINUS_Z);
                // A printed extinguisher silhouette: bottle, valve, lever and hose, with a margin on the red plate.
                const symbol = (x0, y0, x1, y1) => block(f, x0, y0, -0.032, x1, y1, -0.031, 0xe8e4dc, F_PLASTIC, PLUS_Z);
                symbol(-0.012, 0.4, 0.002, 0.424);
                symbol(-0.01, 0.424, 0, 0.428);
                symbol(-0.007, 0.428, -0.003, 0.436);
                symbol(-0.012, 0.435, 0.009, 0.438);
                symbol(0.005, 0.429, 0.011, 0.433);
                symbol(0.01, 0.413, 0.014, 0.431);
                symbol(0.009, 0.404, 0.016, 0.414);
                break;
            }
            default:
        }
    });
}
