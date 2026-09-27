import { Sphere, Vector3 } from 'three';
import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import {
    CONVECTOR_DEPTH,
    CONVECTOR_HEIGHT,
    DOOR_LIFT,
    DOOR_OFFICE,
    DOOR_SERVICE,
    DOOR_STAIR,
    FACADE_BOTTOM,
    FACADE_TOP,
    FIXTURE_HANGING,
    FIXTURE_STRIP,
    GLASS_HALF,
    HEAD_Y,
    PIER_HALF,
    SILL_Y,
} from './abandonedOffice.js';
import {
    FURN_CABINET,
    FURN_CHAIR,
    FURN_CLOCK,
    FURN_COPIER,
    FURN_COUNTER,
    FURN_DESK,
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
    workstationOn,
} from './abandonedOfficeFurniture.js';
import { ColorBuilder } from './ColorBuilder.js';
import { PANELS_PER_SIDE } from './generator.js';
import { EDGE_WALL } from './grid.js';
import { mulberry32 } from './random.js';

/*
 * What Level 4 has that Level 0 doesn't, as meshes for one chunk (see abandonedOffice.js for where it all goes):
 *
 * - the windows round the light wells: a concrete pier between each two bays, the sill and the head, the frame and its
 *   mullion, the heating's enclosure along the foot, and the glass (the walls themselves have the glass cut out of them:
 *   see FRAGMENT_WALL in abandonedOfficeShading.js);
 * - the building across each light well, above our floor and below it, and the rain falling in the well;
 * - the fittings in the light slots (troffers, a bare batten in the core, one come down at one end), and the glow round
 *   each light;
 * - the doors that don't open (offices', stairs', lifts', cupboards'), and over the stair doors their EXIT signs;
 * - the cubicles' partitions, and the furniture (see abandonedOfficeFurniture.js).
 *
 * Positions are relative to the chunk's centre.
 */

const N = CHUNK_SIZE;
const HALF_WALL = WALL_THICKNESS / 2;

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

/** What's lit (see FRAGMENT_LIGHT in abandonedOfficeShading.js). */
const L_TROFFER = 1;
const L_TUBE = 2;
const L_VENDING = 3;
const L_SCREEN = 4;
const L_EXIT = 5;
const L_FLOOR = 6;
const L_CLOCK = 7;
const L_BOARD = 8;

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
 */
export function buildAbandonedOfficeGeometry(store, chunk) {
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
    };
    windows(ctx);
    for (const well of data.wells) {
        facade(ctx, well);
        rain(ctx, well);
    }
    fittings(ctx);
    for (const door of data.doors) if (store.edge(door.x, door.z, door.axis) === EDGE_WALL) closedDoor(ctx, door);
    partitions(ctx);
    for (const piece of data.furniture) furniture(ctx, piece);
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
                // The piers (their tops and bottoms are in the wall).
                across(f, -0.052, 0.052, 0.5 - PIER_HALF, after ? 0.5 + PIER_HALF : 0.499, SILL_Y, HEAD_Y, CONCRETE, F_CONCRETE, SIDES);
                if (!before) across(f, -0.052, 0.052, -0.499, -0.5 + PIER_HALF, SILL_Y, HEAD_Y, CONCRETE, F_CONCRETE, SIDES);
                // The sill, its top; and the head, its underside.
                across(f, -0.05, 0.05, -GLASS_HALF, GLASS_HALF, SILL_Y - 0.02, SILL_Y, CONCRETE, F_CONCRETE, TOP | faces);
                across(f, -0.05, 0.05, -GLASS_HALF, GLASS_HALF, HEAD_Y, HEAD_Y + 0.02, CONCRETE, F_CONCRETE, BOTTOM | faces);
                // The frame round the glass, and the mullion down its middle.
                const t = 0.014;
                across(f, -0.012, 0.012, -GLASS_HALF + 0.001, -GLASS_HALF + t, SILL_Y + 0.001, HEAD_Y - 0.001, FRAME, F_METAL, faces | ends);
                across(f, -0.012, 0.012, GLASS_HALF - t, GLASS_HALF - 0.001, SILL_Y + 0.001, HEAD_Y - 0.001, FRAME, F_METAL, faces | ends);
                across(f, -0.012, 0.012, -GLASS_HALF + t, GLASS_HALF - t, SILL_Y + 0.001, SILL_Y + t, FRAME, F_METAL, faces | TOP);
                across(f, -0.012, 0.012, -GLASS_HALF + t, GLASS_HALF - t, HEAD_Y - t, HEAD_Y - 0.001, FRAME, F_METAL, faces | BOTTOM);
                across(f, -0.014, 0.014, -0.009, 0.009, SILL_Y + t, HEAD_Y - t, FRAME, F_METAL, faces | ends);
                // The heating's enclosure along the foot of the wall, the room's side: a grille along its top.
                across(f, HALF_WALL, HALF_WALL + CONVECTOR_DEPTH, -0.5, 0.5, 0, CONVECTOR_HEIGHT, CONVECTOR, F_PAINT, TOP | faces);
                across(f, HALF_WALL + 0.012, HALF_WALL + CONVECTOR_DEPTH - 0.012, -0.47, 0.47, CONVECTOR_HEIGHT, CONVECTOR_HEIGHT + 0.002, 0x3a3c3e, F_METAL, TOP);
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

/** The rain falling in a light well: streaks all through it (see the rain material in abandonedOfficeMaterials.js). */
function rain(ctx, { i0, j0, i1, j1 }) {
    const { x0, z0, ox, oz, chunk, rain: b } = ctx;
    const random = mulberry32((chunk.cx * 73856093) ^ (chunk.cz * 19349663) ^ 0x4a17);
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    const count = Math.round(w * h * 90);
    for (let k = 0; k < count; k++) {
        const x = x0 + i0 - 0.44 + random() * (w - 0.12) - ox;
        const z = z0 + j0 - 0.44 + random() * (h - 0.12) - oz;
        // How fast it falls, where in its fall it starts, how long its streak.
        b.spot(x, 0, z, 3.4 + random() * 1.4, random(), 0.07 + random() * 0.07, 0);
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
                d.cylinder(2, lx, top - 0.042, lz - 0.24, lz + 0.24, 0.01, 8, 0xffffff);
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
                // Down at its −z end, on the wire at its +z end.
                const angle = 0.95 + (((x * 31 + z * 17) & 7) / 7) * 0.3;
                tilt(f, fStart, angle, top, lz + 0.25);
                tilt(d, dStart, angle, top, lz + 0.25);
                rod(f, 1, lx, top - 0.3, lz + 0.25, top, 0.002, 4, 0x1a1a1a, F_RUBBER);
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
                // The buttons, and the floor it's on.
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
        // The frame, and the leaf.
        out(f, 0, 0.012, -width - 0.025, -width, 0, height, 0x4a4c4e, F_METAL);
        out(f, 0, 0.012, width, width + 0.025, 0, height, 0x4a4c4e, F_METAL);
        out(f, 0, 0.012, -width - 0.025, width + 0.025, height, height + 0.025, 0x4a4c4e, F_METAL);
        out(f, 0, 0.006, -width, width, 0, height, paint, kind);
        // Its lever (on the side it opens from, away from its hinges).
        const handle = (v & 1 ? 1 : -1) * (width - 0.035);
        out(f, 0.006, 0.02, handle - 0.004, handle + 0.004, 0.36, 0.385, STEEL, F_METAL);
        out(f, 0.02, 0.026, handle - (v & 1 ? 0.05 : 0), handle + (v & 1 ? 0 : 0.05), 0.368, 0.377, STEEL, F_METAL);
        if (door.kind === DOOR_OFFICE) {
            // A narrow light of glass on its lever side, and a plate for a name that's gone.
            const s = handle - (v & 1 ? 0.06 : -0.06);
            out(f, 0.006, 0.0075, s - 0.02, s + 0.02, 0.42, 0.7, 0x141818, F_GLASS);
            if (front) out(f, 0, 0.004, width + 0.04, width + 0.12, 0.5, 0.54, 0x9a9690, F_METAL);
        } else if (door.kind === DOOR_STAIR) {
            // Wired glass, up high; the push bar on its front.
            out(f, 0.006, 0.0075, -0.06, 0.06, 0.52, 0.68, 0x1a2020, F_GLASS);
            if (front) {
                out(f, 0.006, 0.03, -width + 0.03, width - 0.03, 0.35, 0.37, STEEL, F_METAL);
                // The EXIT sign over it, lit on its battery: its box, its face, its glow.
                out(f, 0, 0.03, -0.1, 0.1, 0.86, 0.94, 0xd8d8d0, F_PLASTIC);
                lit(0.0315, 0, 0.9, 0.085, 0.032, L_EXIT);
                const [gx, gy, gz] = point(0.06, 0, 0.9);
                g.spot(gx, gy, gz, 0.22, -22, 0.5, 0.6);
            }
        } else if (front) {
            // A round sign, blank: the toilets, or the plant.
            out(f, 0.006, 0.008, -0.04, 0.04, 0.52, 0.6, (v >>> 5) & 1 ? 0x2a4a8a : 0x3a3a3a, F_PLASTIC);
        }
        // A kick plate.
        out(f, 0.006, 0.0075, -width + 0.01, width - 0.01, 0.01, 0.06, STEEL, F_METAL);
    }
}

// ---------------------------------------------------------------------------------------------- cubicles

/**
 * The cubicles' partitions (see AbandonedOfficeData.partitions): a fabric panel on a dark base, capped along its top
 * with aluminium, all flush.
 */
function partitions(ctx) {
    const { data, ox, oz, f, chunk } = ctx;
    const fabric = FABRICS[(chunk.zone.variant >>> 3) % FABRICS.length];
    const p = data.partitions;
    const t = 0.025;
    for (let k = 0; k < p.length; k += 5) {
        const [ax, az, bx, bz, height] = [p[k] - ox, p[k + 1] - oz, p[k + 2] - ox, p[k + 3] - oz, p[k + 4]];
        const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
        const box = (y0, y1, color, kind) => {
            if (alongX) block(f, Math.min(ax, bx), y0, az - t, Math.max(ax, bx), y1, az + t, color, kind);
            else block(f, ax - t, y0, Math.min(az, bz), ax + t, y1, Math.max(az, bz), color, kind);
        };
        box(0.004, 0.04, 0x26282a, F_PLASTIC);
        box(0.04, height - 0.014, fabric, F_FABRIC);
        box(height - 0.014, height, 0xa4a8aa, F_METAL);
    }
}

// ---------------------------------------------------------------------------------------------- furniture

/** A task chair, in its own frame (facing +z), `seat` its colour: five spokes on castors, the column, seat and back. */
function chair(ctx, seat, arms) {
    const { f } = ctx;
    for (let k = 0; k < 5; k++) {
        const start = f.vertexCount;
        block(f, -0.006, 0.018, 0, 0.006, 0.03, 0.11, CHARCOAL, F_PLASTIC);
        rod(f, 1, 0, 0.004, 0.105, 0.022, 0.009, 6, BLACK, F_RUBBER);
        f.transform(start, (k / 5) * Math.PI * 2 + 0.3, 0, 0);
    }
    rod(f, 1, 0, 0.03, 0, 0.2, 0.013, 8, 0x4a4c4e, F_METAL);
    block(f, -0.1, 0.2, -0.09, 0.1, 0.235, 0.1, seat, F_VINYL);
    // The back, on its stem, leaning back a little.
    const start = f.vertexCount;
    block(f, -0.012, 0.21, -0.11, 0.012, 0.3, -0.095, CHARCOAL, F_PLASTIC);
    block(f, -0.095, 0.27, -0.13, 0.095, 0.47, -0.105, seat, F_VINYL);
    tilt(f, start, -0.12, 0.22, -0.1);
    if (arms) {
        for (const s of [-1, 1]) {
            block(f, s * 0.105 - 0.008, 0.235, -0.02, s * 0.105 + 0.008, 0.32, 0.0, CHARCOAL, F_PLASTIC);
            block(f, s * 0.105 - 0.015, 0.32, -0.07, s * 0.105 + 0.015, 0.335, 0.06, CHARCOAL, F_PLASTIC);
        }
    }
}

/** A stacking chair: a plastic shell on four steel legs. At height y (stacked). */
function stackingChair(ctx, y, color) {
    const { f } = ctx;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rod(f, 1, sx * 0.08, y, sz * 0.08, y + 0.22, 0.005, 5, STEEL);
    block(f, -0.095, y + 0.22, -0.09, 0.095, y + 0.235, 0.1, color, F_PLASTIC);
    block(f, -0.09, y + 0.24, -0.11, 0.09, y + 0.42, -0.095, color, F_PLASTIC);
}

/** An old computer on a desk at y: its monitor facing +z (lit, or dead), the keyboard in front of it. */
function computer(ctx, x, y, z, on, yellow) {
    const { f, d, g } = ctx;
    f.finish(F_PLASTIC, yellow);
    block(f, x - 0.075, y, z - 0.06, x + 0.075, y + 0.014, z + 0.04, BEIGE, F_PLASTIC, ALL, yellow);
    block(f, x - 0.075, y + 0.014, z - 0.02, x + 0.075, y + 0.15, z + 0.03, BEIGE, F_PLASTIC, ALL, yellow);
    block(f, x - 0.055, y + 0.03, z - 0.1, x + 0.055, y + 0.135, z - 0.02, BEIGE, F_PLASTIC, ALL, yellow);
    // The screen, set in its bezel.
    if (on) {
        d.light(0, 0, 1, L_SCREEN);
        face(d, x, y + 0.085, z + 0.0315, [1, 0, 0], [0, 1, 0], 0.058, 0.048, 0xffffff);
        g.spot(x, y + 0.085, z + 0.05, 0.13, -21, 0.35, 0.9);
    } else {
        block(f, x - 0.058, y + 0.037, z + 0.03, x + 0.058, y + 0.133, z + 0.032, SCREEN_OFF, F_GLASS, PLUS_Z);
    }
    // The keyboard, and the mouse.
    block(f, x - 0.075, y, z + 0.08, x + 0.075, y + 0.012, z + 0.13, BEIGE, F_PLASTIC, ALL, yellow);
    block(f, x + 0.1, y, z + 0.1, x + 0.12, y + 0.01, z + 0.13, BEIGE, F_PLASTIC, ALL, yellow);
}

/** Paper on a desk: a few sheets, a pile, a mug. From the bits of `v`. */
function clutter(ctx, x, y, z, v) {
    const { f } = ctx;
    if (v & 1) block(f, x - 0.05, y, z - 0.035, x + 0.05, y + 0.002, z + 0.035, PAPER, F_PAINT);
    if (v & 2) block(f, x + 0.06, y, z - 0.03, x + 0.14, y + 0.03, z + 0.03, PAPER, F_PAINT);
    if (v & 4) rod(f, 1, x - 0.1, y, z + 0.02, y + 0.035, 0.013, 8, (v >>> 3) & 1 ? 0xd8d4c8 : 0x2a3a6a, F_PLASTIC);
    if (v & 8) block(f, x - 0.04, y, z + 0.06, x + 0.02, y + 0.018, z + 0.1, 0x1c1c1c, F_PLASTIC);
}

/** One piece of furniture (see abandonedOfficeFurniture.js), built in its frame and put where it goes. */
function furniture(ctx, piece) {
    const { f, d, g } = ctx;
    const v = piece.variant;
    const random = mulberry32(v ^ 0x51f7);
    inFrame(ctx, piece.yaw, piece.x, piece.z, () => {
        switch (piece.type) {
            case FURN_WORKSTATION: {
                // Its desk against the spine (+z), and its return along one side; the pedestal under it.
                const top = 0.27;
                const laminate = LAMINATES[(v >>> 20) % LAMINATES.length];
                const side = (v >>> 3) & 1 ? 1 : -1;
                block(f, -0.43, top - 0.014, 0.14, 0.43, top, 0.44, laminate, F_LAMINATE, ALL, (v >>> 8) & 7);
                block(f, side * 0.14, top - 0.014, -0.3, side * 0.43, top, 0.14, laminate, F_LAMINATE, ALL, (v >>> 8) & 7);
                block(f, -side * 0.42, 0, 0.16, -side * 0.4, top - 0.014, 0.42, 0x5a5c5e, F_METAL);
                block(f, side * 0.26, 0, -0.26, side * 0.41, top - 0.016, 0.1, 0x5a5c5e, F_METAL);
                for (let k = 0; k < 3; k++) block(f, side * 0.265, 0.02 + k * 0.08, 0.1, side * 0.405, 0.09 + k * 0.08, 0.104, 0x6a6c6e, F_METAL, PLUS_Z);
                const contents = v & 7;
                if (contents !== 0) {
                    computer(ctx, -side * 0.18, top, 0.3, workstationOn(v), ((v >>> 17) & 3) / 3);
                    clutter(ctx, side * 0.24, top, 0.28, v >>> 24);
                    if (contents > 4) block(f, side * 0.3, top, -0.2, side * 0.4, top + 0.05, -0.1, 0x1c1c1e, F_PLASTIC);
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
                const top = 0.27;
                const laminate = LAMINATES[(v >>> 20) % LAMINATES.length];
                block(f, -0.26, top - 0.016, -0.13, 0.26, top, 0.13, laminate, F_LAMINATE);
                // Its end panels and the modesty panel across its front.
                block(f, -0.255, 0, -0.12, -0.235, top - 0.016, 0.12, laminate, F_LAMINATE);
                block(f, 0.235, 0, -0.12, 0.255, top - 0.016, 0.12, laminate, F_LAMINATE);
                block(f, -0.235, 0.08, 0.1, 0.235, top - 0.016, 0.115, laminate, F_LAMINATE);
                if (v & 7) {
                    // Facing whoever sat behind it.
                    const start = f.vertexCount;
                    computer(ctx, -0.12, top, 0.02, false, ((v >>> 17) & 3) / 3);
                    f.transform(start, Math.PI, 0, 0);
                }
                clutter(ctx, -0.12, top, 0.02, v >>> 24);
                // Its chair, behind it.
                if ((v >>> 4) & 3) {
                    const chairStart = f.vertexCount;
                    chair(ctx, SEATS[(v >>> 26) % SEATS.length], true);
                    f.transform(chairStart, (random() - 0.5) * 0.8, 0, -0.26);
                }
                break;
            }
            case FURN_TABLE: {
                const length = (piece.length ?? 1) * 0.5 - 0.2;
                const top = 0.265;
                block(f, -length, top - 0.018, -0.18, length, top, 0.18, 0x5a4230, F_LAMINATE);
                for (const s of [-1, 1]) block(f, s * (length - 0.12) - 0.02, 0, -0.12, s * (length - 0.12) + 0.02, top - 0.018, 0.12, 0x3a3c3e, F_METAL);
                // Chairs down both sides, a few gone, a few pushed back.
                const seat = SEATS[(v >>> 26) % SEATS.length];
                const each = Math.max(1, Math.floor((length * 2) / 0.3));
                for (const s of [-1, 1]) {
                    for (let k = 0; k < each; k++) {
                        if (random() < 0.2) continue;
                        const at = -length + (k + 0.5) * ((length * 2) / each);
                        const start = f.vertexCount;
                        chair(ctx, seat, true);
                        const back = random() < 0.3 ? 0.08 + random() * 0.06 : 0;
                        f.transform(start, (s > 0 ? Math.PI : 0) + (random() - 0.5) * 0.5, at, s * (0.24 + back));
                    }
                }
                break;
            }
            case FURN_VENDING: {
                const body = MACHINES[v % MACHINES.length];
                block(f, -0.15, 0, -0.15, 0.15, 0.68, 0.15, body, F_PAINT, ALL & ~MINUS_Z);
                // The glass front and its rows, the keypad beside it, the flap below.
                d.light(0, 0, 1, L_VENDING);
                face(d, -0.04, 0.4, 0.1515, [1, 0, 0], [0, 1, 0], 0.095, 0.24, 0xffffff);
                block(f, 0.07, 0.3, 0.15, 0.13, 0.5, 0.155, 0x3a3c3e, F_METAL, PLUS_Z | TOP | BOTTOM | PLUS_X | MINUS_X);
                block(f, 0.085, 0.46, 0.155, 0.115, 0.48, 0.157, 0x301a08, F_GLASS, PLUS_Z);
                block(f, -0.13, 0.05, 0.15, 0.05, 0.12, 0.158, 0x0e0e0e, F_PLASTIC, PLUS_Z | TOP | BOTTOM | PLUS_X | MINUS_X);
                g.spot(-0.04, 0.4, 0.2, 0.36, -20, 0.14, 1.6);
                break;
            }
            case FURN_CHAIR: {
                // Left where it was pushed; now and then, on its back.
                const start = f.vertexCount;
                chair(ctx, SEATS[(v >>> 26) % SEATS.length], (v & 3) !== 0);
                if (((v >>> 8) & 15) === 0) {
                    tilt(f, start, -Math.PI / 2 + 0.25, 0.0, -0.16);
                    for (let i = start; i < f.vertexCount; i++) f.positions[i * 3 + 1] += 0.1;
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
                const color = (v & 1) ? 0x8e8c84 : 0xb4ae9c;
                block(f, -0.075, 0, -0.1, 0.075, 0.48, 0.1, color, F_PAINT, ALL & ~MINUS_Z);
                const open = (v >>> 1) & 3;
                for (let k = 0; k < 4; k++) {
                    const y = 0.015 + k * 0.115;
                    const out = open === 1 && k === 2 ? 0.11 : 0;
                    block(f, -0.07, y, 0.1 + out - (out ? 0.2 : 0), 0.07, y + 0.105, 0.108 + out, color, F_PAINT, out ? ALL : PLUS_Z | TOP | BOTTOM);
                    block(f, -0.025, y + 0.07, 0.108 + out, 0.025, y + 0.08, 0.116 + out, STEEL, F_METAL);
                    if (out) for (let n = 0; n < 5; n++) block(f, -0.06, y + 0.01, 0.0 + n * 0.035, 0.06, y + 0.1, 0.012 + n * 0.035, n & 1 ? 0xd8c890 : 0xc8b070, F_PAINT, TOP | PLUS_Z | MINUS_Z);
                }
                break;
            }
            case FURN_SHELF: {
                const wood = (v & 1) ? 0x6a5040 : 0x8a8a86;
                block(f, -0.17, 0, -0.07, -0.155, 0.66, 0.07, wood, F_LAMINATE);
                block(f, 0.155, 0, -0.07, 0.17, 0.66, 0.07, wood, F_LAMINATE);
                block(f, -0.155, 0, -0.07, 0.155, 0.66, -0.06, wood, F_LAMINATE, PLUS_Z);
                for (let k = 0; k < 5; k++) {
                    const y = k * 0.16;
                    block(f, -0.155, y, -0.06, 0.155, y + 0.015, 0.07, wood, F_LAMINATE, TOP | BOTTOM | PLUS_Z);
                    if (k === 4) continue;
                    // Binders, some gone, the last leaning over.
                    let x = -0.15;
                    while (x < 0.13) {
                        const w = 0.02 + random() * 0.015;
                        if (random() < 0.8) block(f, x, y + 0.015, -0.05, x + w - 0.002, y + 0.13 - random() * 0.02, 0.05, BINDERS[Math.floor(random() * BINDERS.length)], F_PLASTIC, ALL & ~BOTTOM);
                        else x += 0.02;
                        x += w;
                    }
                }
                break;
            }
            case FURN_SOFA: {
                const color = [0x3a4a5a, 0x5a4a3a, 0x3a3a3a, 0x4a3a4a][v & 3];
                block(f, -0.26, 0.03, -0.2, 0.26, 0.13, -0.02, color, F_VINYL);
                block(f, -0.26, 0.13, -0.2, 0.26, 0.3, -0.15, color, F_VINYL);
                for (const s of [-1, 1]) block(f, s * 0.26 - s * 0.04, 0.13, -0.2, s * 0.26, 0.2, -0.02, color, F_VINYL);
                for (const s of [-1, 1]) block(f, s * 0.11 - 0.105, 0.13, -0.15, s * 0.11 + 0.105, 0.16, -0.025, color, F_VINYL);
                // Its low table, and what was on it.
                block(f, -0.15, 0.12, 0.06, 0.15, 0.135, 0.19, 0x5a4230, F_LAMINATE);
                for (const s of [-1, 1]) block(f, s * 0.13 - 0.01, 0, 0.07, s * 0.13 + 0.01, 0.12, 0.18, 0x3a3c3e, F_METAL);
                if (v & 4) block(f, -0.06, 0.135, 0.09, 0.04, 0.139, 0.15, 0xb8a888, F_PAINT);
                break;
            }
            case FURN_COPIER: {
                block(f, -0.16, 0.02, -0.12, 0.16, 0.34, 0.12, 0xc8c4b8, F_PLASTIC, ALL, 0.5);
                block(f, -0.15, 0, -0.11, 0.15, 0.02, 0.11, 0x3a3a3a, F_PLASTIC);
                for (let k = 0; k < 3; k++) block(f, -0.15, 0.04 + k * 0.07, 0.12, 0.15, 0.1 + k * 0.07, 0.125, 0xb8b4a8, F_PLASTIC, PLUS_Z | TOP | BOTTOM, 0.5);
                block(f, -0.16, 0.34, -0.12, 0.12, 0.36, 0.1, 0x6a6a68, F_PLASTIC);
                block(f, 0.12, 0.34, -0.02, 0.16, 0.37, 0.12, 0x2a2a2a, F_PLASTIC);
                block(f, 0.16, 0.25, -0.06, 0.22, 0.26, 0.06, 0xb8b4a8, F_PLASTIC);
                block(f, 0.165, 0.26, -0.05, 0.215, 0.27, 0.05, PAPER, F_PAINT);
                break;
            }
            case FURN_COUNTER: {
                // Its cupboards, the worktop, and over it the wall cupboards; the sink, or the microwave and the coffee.
                const doors = (v >>> 4) & 1 ? 0x8a9a9a : 0xd8d4c8;
                block(f, -0.46, 0.02, -0.11, 0.46, 0.31, 0.1, doors, F_PAINT, ALL & ~MINUS_Z);
                block(f, -0.46, 0, -0.11, 0.46, 0.02, 0.09, 0x1a1a1a, F_RUBBER, PLUS_Z | TOP);
                for (const s of [-0.23, 0.23]) block(f, s - 0.002, 0.04, 0.1, s + 0.002, 0.29, 0.103, 0x333333, F_PAINT, PLUS_Z);
                block(f, -0.46, 0.31, -0.11, 0.46, 0.33, 0.12, 0x6a6a66, F_LAMINATE);
                block(f, -0.46, 0.56, -0.11, 0.46, 0.8, 0.01, doors, F_PAINT, ALL & ~MINUS_Z);
                if ((v & 3) === 1) {
                    block(f, -0.12, 0.3305, -0.06, 0.12, 0.3315, 0.08, 0x3a3c3e, F_METAL, TOP);
                    rod(f, 1, 0, 0.33, -0.08, 0.4, 0.006, 6, STEEL);
                    block(f, -0.006, 0.39, -0.08, 0.006, 0.4, -0.02, STEEL, F_METAL);
                } else {
                    block(f, -0.3, 0.33, -0.09, -0.08, 0.44, 0.06, 0xd8d8d0, F_PLASTIC);
                    block(f, -0.28, 0.345, 0.06, -0.14, 0.425, 0.062, 0x101418, F_GLASS, PLUS_Z);
                    block(f, 0.12, 0.33, -0.08, 0.22, 0.47, 0.0, 0x1c1c1c, F_PLASTIC);
                    rod(f, 1, 0.17, 0.33, 0.03, 0.4, 0.025, 10, 0x2a1a10, F_GLASS);
                }
                break;
            }
            case FURN_FRIDGE: {
                block(f, -0.13, 0, -0.12, 0.13, 0.64, 0.11, (v >>> 4) & 1 ? 0xb0b2b2 : 0xdedad0, F_PAINT, ALL & ~MINUS_Z);
                block(f, -0.13, 0.43, 0.11, 0.13, 0.435, 0.115, 0x6a6a6a, F_PAINT, PLUS_Z);
                block(f, 0.09, 0.3, 0.11, 0.1, 0.55, 0.125, STEEL, F_METAL);
                break;
            }
            case FURN_ROUND_TABLE: {
                rod(f, 1, 0, 0.26, 0, 0.275, 0.16, 16, 0xd8d4c8, F_LAMINATE);
                rod(f, 1, 0, 0, 0, 0.26, 0.018, 8, 0x3a3c3e, F_METAL);
                rod(f, 1, 0, 0, 0, 0.012, 0.1, 12, 0x3a3c3e, F_METAL);
                const chairs = 2 + (v & 1);
                for (let k = 0; k < chairs; k++) {
                    const start = f.vertexCount;
                    stackingChair(ctx, 0, [0x2a3a5a, 0x6a2a24, 0xb0a890][(v >>> 2) % 3]);
                    const a = (k / chairs) * Math.PI * 2 + random() * 0.5;
                    f.transform(start, a + Math.PI, Math.sin(a) * 0.24, Math.cos(a) * 0.24);
                }
                if (v & 8) rod(f, 1, 0.05, 0.275, 0.03, 0.31, 0.013, 8, 0xd8d4c8, F_PLASTIC);
                break;
            }
            case FURN_WHITEBOARD: {
                block(f, -0.3, 0.36, -0.02, 0.3, 0.72, -0.008, 0xb4b8ba, F_METAL, ALL & ~MINUS_Z);
                d.light(0, 0, (v % 997) / 997, L_BOARD);
                face(d, 0, 0.54, -0.0068, [1, 0, 0], [0, 1, 0], 0.29, 0.17, 0xffffff);
                block(f, -0.2, 0.34, -0.02, 0.2, 0.36, 0.01, 0xb4b8ba, F_METAL, ALL & ~MINUS_Z);
                break;
            }
            case FURN_CLOCK: {
                rod(f, 2, 0, 0.8, -0.02, -0.004, 0.062, 20, 0x1c1c1c, F_PLASTIC);
                d.light(0, 0, (v % 991) / 991, L_CLOCK);
                face(d, 0, 0.8, -0.0028, [1, 0, 0], [0, 1, 0], 0.056, 0.056, 0xffffff);
                break;
            }
            case FURN_FOUNTAIN: {
                block(f, -0.07, 0.24, -0.06, 0.07, 0.3, 0.05, 0xa8acae, F_METAL, ALL & ~MINUS_Z);
                block(f, -0.05, 0.3, -0.06, 0.05, 0.305, 0.03, 0x8a8e90, F_METAL, TOP);
                rod(f, 1, 0.02, 0.3, 0.0, 0.325, 0.006, 6, STEEL);
                block(f, -0.02, 0.1, -0.06, 0.02, 0.24, -0.02, 0x8a8e90, F_METAL, ALL & ~MINUS_Z);
                break;
            }
            default:
        }
    });
}
