import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { PLAIN_U, PLAIN_V } from './ColorBuilder.js';
import { mod } from './grid.js';
import { BAY, STOP_CONCRETE, STOP_RUBBER, STOP_YELLOW, WHEEL_STOP_DEPTH, WHEEL_STOP_HALF, aislesAlongX, isBaySpan, spanOf } from './levelOne.js';
import { GLYPH_PICTURES, GLYPH_TEXTURE, SIGN_PICTURES, SIGN_TEXTURE_HEIGHT, SIGN_TEXTURE_WIDTH } from './levelOneTextures.js';
import { propFootprint } from './props.js';
import { hashFloat, hashInts } from './random.js';

/*
 * The fittings of Level 1's car park (see levelOneGeometry.js, which puts them in each chunk): the wheel stops at the
 * heads of the bays, the stair cores, what hangs over the aisles, the fire points and mirrors on the walls and columns,
 * and the shapes they're built from.
 */

// Wheel stops: how tall, and their colours.
const STOP_HEIGHT = 0.034;
const STOP_TOP = 0.012;
const CONCRETE = 0x8e8d87;
const YELLOW = 0xa8841c;
const RUBBER = 0x1c1c1c;

/**
 * A bay's wheel stop: a kerb of concrete (some painted yellow) or black rubber banded with yellow, square to the bay,
 * its top edges bevelled. Now and then one's been knocked askew.
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 * @param {import('./levelOne.js').Bay} bay
 */
export function wheelStop(b, seed, bay, ox, oz) {
    const knocked = hashFloat(seed, 0x5710, bay.x * 4, bay.z * 4);
    const turn = knocked < 0.08 ? (knocked / 0.08 - 0.5) * 0.5 : 0;
    const slide = knocked < 0.08 ? (hashFloat(seed, 0x5711, bay.x * 4, bay.z * 4) - 0.5) * 0.12 : 0;
    const start = b.vertexCount;
    // Built along z (its length), across x, round its middle; then turned into place.
    const color = bay.stop === STOP_CONCRETE ? CONCRETE : bay.stop === STOP_YELLOW ? YELLOW : RUBBER;
    const bands = bay.stop === STOP_RUBBER ? 3 : 1;
    const step = (WHEEL_STOP_HALF * 2) / bands;
    for (let k = 0; k < bands; k++) {
        const z0 = -WHEEL_STOP_HALF + k * step;
        const z1 = z0 + step;
        const band = bay.stop === STOP_RUBBER && k % 2 === 1 ? YELLOW : color;
        prism(b, z0, z1, k === 0, k === bands - 1, band);
    }
    // Lying across the bay: along z when its car lies along x.
    b.transform(start, bay.alongX ? turn : Math.PI / 2 + turn, bay.x - ox + (bay.alongX ? slide : 0), bay.z - oz + (bay.alongX ? 0 : slide));
}

/** One length of a wheel stop, from z0 to z1 along it, with its ends bevelled where it has them. */
function prism(b, z0, z1, startEnd, finishEnd, color) {
    const d0 = WHEEL_STOP_DEPTH;
    const d1 = STOP_TOP;
    const h = STOP_HEIGHT;
    const bevel = 0.018;
    const a0 = startEnd ? z0 + bevel : z0;
    const a1 = finishEnd ? z1 - bevel : z1;
    // Its sides lean in (normal out and up), its top is flat.
    const lean = Math.hypot(h, d0 - d1);
    const nx = h / lean;
    const ny = (d0 - d1) / lean;
    face(b, [[d0, 0, z0], [d0, 0, z1], [d1, h, a1], [d1, h, a0]], [nx, ny, 0], color);
    face(b, [[-d0, 0, z1], [-d0, 0, z0], [-d1, h, a0], [-d1, h, a1]], [-nx, ny, 0], color);
    face(b, [[-d1, h, a0], [d1, h, a0], [d1, h, a1], [-d1, h, a1]], [0, 1, 0], color);
    const endLean = Math.hypot(h, bevel);
    if (startEnd) face(b, [[-d0, 0, z0], [d0, 0, z0], [d1, h, a0], [-d1, h, a0]], [0, bevel / endLean, -h / endLean], color);
    if (finishEnd) face(b, [[d0, 0, z1], [-d0, 0, z1], [-d1, h, a1], [d1, h, a1]], [0, bevel / endLean, h / endLean], color);
}

/**
 * A flat face from four corners in order round it, lit by `normal`, wound to face the way it points.
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 * @param {number[][]} corners
 * @param {number[]} normal
 */
export function face(b, corners, normal, color) {
    const [p0, p1, p2] = corners;
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const facing = (u[1] * w[2] - u[2] * w[1]) * normal[0] + (u[2] * w[0] - u[0] * w[2]) * normal[1] + (u[0] * w[1] - u[1] * w[0]) * normal[2];
    const first = b.vertexCount;
    for (const [x, y, z] of corners) b.vertex(x, y, z, normal[0], normal[1], normal[2], PLAIN_U, PLAIN_V, color);
    if (facing >= 0) {
        b.triangle(first, first + 1, first + 2);
        b.triangle(first, first + 2, first + 3);
    } else {
        b.triangle(first, first + 2, first + 1);
        b.triangle(first, first + 3, first + 2);
    }
}

// ---------------------------------------------------------------------------------------------- stair cores

// The steel round a stair door, the door, and the sign over it.
const DOOR_PAINTS = [0x2f4a3d, 0x4a4f52, 0x6a2a22, 0x2c3e55];
const EXIT_HOUSING = 0xc9cbc4;
// The stairs.
const STEPS = 14;
const STEP_CONCRETE = 0x8d8c86;
const STEP_SIDE = 0x7a7973;
const NOSING = 0xb08a1a;
const RAIL = 0x8f9496;

/**
 * What's round and inside a walled-in bay (see Core in levelOne.js): a steel frame round its door, the door held open
 * flat against the wall inside, the exit sign lit over it (it stays lit when the power goes: it has a battery), a sign
 * beside it, and the flight of stairs inside, going up into the slab.
 * @param {{ services: import('./ColorBuilder.js').ColorBuilder, paint: import('./ColorBuilder.js').ColorBuilder, lamps: import('./ColorBuilder.js').ColorBuilder, exitGlows: import('./ColorBuilder.js').ColorBuilder }} builders
 * @param {import('./levelOne.js').Core} core
 * @param {import('./decorations.js').Prop[]} props
 */
export function stairCore({ services, paint, lamps, exitGlows }, seed, core, props, ox, oz) {
    const { dx, dz } = core;
    // Round the middle of the doorway: `a` along the wall (t), `o` out through it (n), relative to the chunk.
    const t = [Math.abs(dz), Math.abs(dx)];
    const n = [dx, dz];
    const cx = core.doorX + dx * 0.5 - ox;
    const cz = core.doorZ + dz * 0.5 - oz;
    const at = (a, o) => [cx + t[0] * a + n[0] * o, cz + t[1] * a + n[1] * o];
    const box = (b, a0, a1, o0, o1, y0, y1, color) => {
        const [x0, z0] = at(a0, o0);
        const [x1, z1] = at(a1, o1);
        b.box(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), color);
    };
    const steel = DOOR_PAINTS[hashInts(seed, 0xd00e, core.x0, core.z0) % DOOR_PAINTS.length];
    const half = DOOR_WIDTH / 2;
    const face = WALL_THICKNESS / 2;
    const frame = DOOR_FRAME;
    doorFrame(services, core.doorX + (dx > 0 ? 0 : dx), core.doorZ + (dz > 0 ? 0 : dz), dx !== 0 ? 0 : 1, ox, oz, steel);

    // The door, folded right back against the wall inside, on whichever side of the doorway is clear.
    const leaf = 0.42;
    const thick = 0.016;
    const clear = (reach) => !props.some((prop) => overlap(propFootprint(prop), reach)) && !(core.stairs && overlap(core.stairs, reach));
    const hinge = [1, -1].find((side) => {
        const [x0, z0] = at(side * (half + frame + 0.004), -face);
        const [x1, z1] = at(side * (half + frame + 0.004 + leaf), -face - thick - 0.03);
        return clear([Math.min(x0, x1) + ox, Math.min(z0, z1) + oz, Math.max(x0, x1) + ox, Math.max(z0, z1) + oz]);
    });
    if (hinge !== undefined) {
        const along = (k) => hinge * (half + frame + 0.004 + leaf * k);
        const span = (k0, k1, inset) => [Math.min(along(k0), along(k1)) + inset, Math.max(along(k0), along(k1)) - inset];
        const o0 = -face - 0.004;
        const o1 = o0 - thick;
        box(services, ...span(0, 1, 0), o1, o0, 0.006, DOOR_HEIGHT - 0.01, steel);
        // Its kick plate, the push bar across it, and the wired glass in it, on the face that's showing.
        const show = o1 - 0.002;
        box(services, ...span(0, 1, 0.02), show, o1, 0.02, 0.11, 0x8a8e90);
        box(services, ...span(0, 1, 0.045), show - 0.012, o1, 0.34, 0.358, 0x9a9ea0);
        box(services, ...span(0.3, 0.7, 0), show, o1, 0.46, 0.63, 0x1c2226);
        // The holder that keeps it open, on the wall above it.
        const [h0, h1] = span(0.8, 0.9, 0);
        box(services, h0, h1, o0, -face, 0.66, 0.69, 0x55585a);
    }

    // The exit sign over the door, outside, and its glow.
    const signY = DOOR_HEIGHT + frame + 0.05;
    box(services, -0.11, 0.11, face, face + 0.03, signY - 0.035, signY + 0.035, EXIT_HOUSING);
    picture(lamps, at(0, face + 0.0315), n, 0.1, 0.031, signY, SIGN_PICTURES.exit, 0xffffff);
    const [gx, gz] = at(0, face + 0.06);
    exitGlows.spot(gx, signY, gz, 0.34, 0, 0.9, 0.6);
    // And beside the door, the way up.
    const side = hinge === undefined ? 1 : -hinge;
    picture(paint, at(side * (half + frame + 0.16), face + 0.002), n, 0.1, 0.033, 0.52, GLYPH_PICTURES.stairs, 0xd8d8d2, GLYPH_SIZE);

    if (core.stairs) stairFlight(services, core, ox, oz);
}

/** The sizes of the textures pictures come from: the signs lit from inside, and the glyphs (and the painted signs). */
const SIGN_SIZE = [SIGN_TEXTURE_WIDTH, SIGN_TEXTURE_HEIGHT];
const GLYPH_SIZE = [GLYPH_TEXTURE, GLYPH_TEXTURE];

/** How wide a steel door frame is round its doorway. */
const DOOR_FRAME = 0.034;

/**
 * A steel frame round the doorway in the edge on cell (x, z)'s +x side (axis 0) or +z side (1): two jambs and a head,
 * lining it and standing a little proud of the wall either side.
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 */
export function doorFrame(b, x, z, axis, ox, oz, color) {
    const half = DOOR_WIDTH / 2;
    const proud = WALL_THICKNESS / 2 + 0.01;
    // Across the wall (a) and along it (s), round the middle of the doorway.
    const a = (axis === 0 ? x : z) + 0.5 - (axis === 0 ? ox : oz);
    const s = (axis === 0 ? z : x) - (axis === 0 ? oz : ox);
    const box = (s0, s1, y0, y1) => {
        if (axis === 0) b.box(a - proud, y0, s + s0, a + proud, y1, s + s1, color);
        else b.box(s + s0, y0, a - proud, s + s1, y1, a + proud, color);
    };
    box(-half - DOOR_FRAME, -half + 0.004, 0, DOOR_HEIGHT + DOOR_FRAME);
    box(half - 0.004, half + DOOR_FRAME, 0, DOOR_HEIGHT + DOOR_FRAME);
    box(-half - DOOR_FRAME, half + DOOR_FRAME, DOOR_HEIGHT - 0.004, DOOR_HEIGHT + DOOR_FRAME);
}

/** Whether two boxes [minX, minZ, maxX, maxZ] overlap. */
function overlap(a, b) {
    return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/**
 * A picture from the signs texture (or another, `size` [width, height] in pixels), flat on a wall facing `normal` ([x, z])
 * at (x, z) (relative to the chunk), `hw` by `hh` either side of its middle at height y.
 */
export function picture(b, [x, z], normal, hw, hh, y, [px0, py0, px1, py1], color, [width, height] = SIGN_SIZE) {
    const u0 = px0 / width;
    const u1 = px1 / width;
    const v0 = 1 - py1 / height;
    const v1 = 1 - py0 / height;
    // To the right, looking at it: up × normal.
    const rx = normal[1] * hw;
    const rz = -normal[0] * hw;
    b.quad(x - rx, y - hh, z - rz, x + rx, y - hh, z + rz, x + rx, y + hh, z + rz, x - rx, y + hh, z - rz, normal[0], 0, normal[1], color, u0, v0, u1, v1);
}

/**
 * The flight of stairs in a walled-in bay (see Core.stairs): concrete steps up into the slab, a yellow nosing on each,
 * the side of it closed, and a rail up its open side.
 */
function stairFlight(b, core, ox, oz) {
    const [minX, minZ, maxX, maxZ] = core.stairs;
    const alongX = core.stairsAlongX;
    const climb = core.climb;
    // Along the flight (s, up it) and across it (a: from the wall to its open side).
    const s0 = climb > 0 ? (alongX ? minX : minZ) : (alongX ? maxX : maxZ);
    const length = alongX ? maxX - minX : maxZ - minZ;
    const out = alongX ? core.dz : core.dx;
    const wall = out > 0 ? (alongX ? minZ : minX) : (alongX ? maxZ : maxX);
    const open = out > 0 ? (alongX ? maxZ : maxX) : (alongX ? minZ : minX);
    const point = (s, a, y) => (alongX ? [s0 + climb * s - ox, y, a - oz] : [a - ox, y, s0 + climb * s - oz]);
    const up = [0, 1, 0];
    const back = alongX ? [-climb, 0, 0] : [0, 0, -climb];
    const side = alongX ? [0, 0, out] : [out, 0, 0];
    const going = length / STEPS;
    const rise = WALL_HEIGHT / STEPS;
    for (let k = 0; k < STEPS; k++) {
        const s = k * going;
        const y = (k + 1) * rise;
        // The riser, the tread, its nosing, and the side of the step.
        face(b, [point(s, wall, y - rise), point(s, open, y - rise), point(s, open, y), point(s, wall, y)], back, STEP_CONCRETE);
        // (The last tread is the slab's underside.)
        if (k < STEPS - 1) {
            face(b, [point(s, wall, y), point(s, open, y), point(s + going, open, y), point(s + going, wall, y)], up, STEP_CONCRETE);
            const lift = y + 0.0015;
            face(b, [point(s, wall + out * 0.03, lift), point(s, open, lift), point(s + 0.02, open, lift), point(s + 0.02, wall + out * 0.03, lift)], up, NOSING);
        }
        face(b, [point(s, open, 0), point(s + going, open, 0), point(s + going, open, y), point(s, open, y)], side, STEP_SIDE);
    }
    // Its back, where it stops against the slab.
    const end = alongX ? [climb, 0, 0] : [0, 0, climb];
    face(b, [point(length, wall, 0), point(length, open, 0), point(length, open, WALL_HEIGHT), point(length, wall, WALL_HEIGHT)], end, STEP_SIDE);
    // The rail up the open side, on posts.
    const railA = open - out * 0.028;
    const railUp = 0.3;
    for (let k = 1; (k + 1.5) * rise + railUp < WALL_HEIGHT - 0.02; k += 4) {
        const s = (k + 0.5) * going;
        const y = (k + 1) * rise;
        const [x, , z] = point(s, railA, 0);
        b.cylinder(1, x, y, z, y + railUp + rise * 0.5, 0.005, 5, RAIL);
    }
    const from = point(0, railA, railUp + rise);
    const to = point(length * 0.95, railA, Math.min(railUp + WALL_HEIGHT * 0.95 + rise, WALL_HEIGHT - 0.01));
    bar(b, from, to, 0.007, RAIL);
}

/**
 * A bar of square section, `r` either side of the line from p0 to p1 (a sloping rail, a rod at an angle), its sides lit
 * flat, its ends open.
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 */
export function bar(b, p0, p1, r, color) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const length = Math.hypot(...d) || 1;
    const t = d.map((v) => v / length);
    // Two directions square to it, and to each other.
    const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
    const ul = Math.hypot(...u);
    u = u.map((v) => v / ul);
    const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const corner = (p, a, c) => [p[0] + (u[0] * a + w[0] * c) * r, p[1] + (u[1] * a + w[1] * c) * r, p[2] + (u[2] * a + w[2] * c) * r];
    for (const [a0, c0, a1, c1, normal] of [[1, -1, 1, 1, u], [1, 1, -1, 1, w], [-1, 1, -1, -1, u.map((v) => -v)], [-1, -1, 1, -1, w.map((v) => -v)]]) {
        face(b, [corner(p0, a0, c0), corner(p0, a1, c1), corner(p1, a1, c1), corner(p1, a0, c0)], normal, color);
    }
}

// ---------------------------------------------------------------------------------------------- over the aisles

const FAN = 0x7b8581;
const FAN_DARK = 0x2a2d2e;
const HANGER = 0x4c5052;
const SIGN_BOARD = 0x2a2c2e;
const BAR_YELLOW = 0xb8901c;
const BAR_BLACK = 0x1e1e1c;

/**
 * What hangs over the middle of the car park's aisles, now and then, on fixed lines so it's never in a batten's way: a
 * jet fan along the aisle (they push the fumes along to the shafts), a sign across it (the level one way, the way out
 * the other), and at the odd one, a bar across it at the headroom there is.
 * @param {{ services: import('./ColorBuilder.js').ColorBuilder, paint: import('./ColorBuilder.js').ColorBuilder, lightboxes: import('./ColorBuilder.js').ColorBuilder }} builders
 * @param {(x: number, z: number) => boolean} open Whether cell (x, z) is open car park (not in the walled-in bay).
 */
export function aisleFittings({ services, paint, lightboxes }, seed, x0, z0, ox, oz, open) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
        for (let j = 0; j < CHUNK_SIZE; j++) {
            const x = x0 + i;
            const z = z0 + j;
            const alongX = aislesAlongX(seed, x, z);
            const across = alongX ? z : x;
            const along = alongX ? x : z;
            const s = spanOf(across);
            if (isBaySpan(s) || across !== s * BAY + 3 || !open(x, z)) continue;
            const lx = x - ox;
            const lz = z - oz;
            const h = hashFloat(seed, 0xa151e, x, z);
            if (mod(along, 12) === 10 && h < 0.55) jetFan(services, lx, lz, alongX);
            else if (mod(along, 12) === 5 && h < 0.45) hangingSign(services, lightboxes, lx, lz, alongX);
            else if (mod(along, 24) === 1 && h < 0.3) headroomBar(services, paint, lx, lz, alongX);
        }
    }
}

/** A jet fan, hung along the aisle: a drum with a bell mouth and a grille at each end, on a plate and two rods. */
function jetFan(b, x, z, alongX) {
    const y = 0.78;
    const r = 0.06;
    // From a0 to a1 along the aisle, out from the middle (each end the same, one way and the other).
    const along = (end, a0, a1, radius, sides, color) => {
        const [s0, s1] = [Math.min(end * a0, end * a1), Math.max(end * a0, end * a1)];
        if (alongX) b.cylinder(0, x + s0, y, z, x + s1, radius, sides, color);
        else b.cylinder(2, x, y, z + s0, z + s1, radius, sides, color);
    };
    along(1, -0.19, 0.19, r, 12, FAN);
    for (const end of [-1, 1]) {
        // The bell mouth, the dark inside of it, the grille's two bars across it and the hub, each just in front of the
        // last.
        along(end, 0.19, 0.215, r + 0.009, 12, FAN);
        along(end, 0.215, 0.2165, r + 0.003, 12, FAN_DARK);
        for (const [a0, a1, w, h] of [[0.2167, 0.2177, r + 0.004, 0.0025], [0.2179, 0.2189, 0.0025, r + 0.004]]) {
            const [s0, s1] = [Math.min(end * a0, end * a1), Math.max(end * a0, end * a1)];
            if (alongX) b.box(x + s0, y - h, z - w, x + s1, y + h, z + w, 0x5a605e);
            else b.box(x - w, y - h, z + s0, x + w, y + h, z + s1, 0x5a605e);
        }
        along(end, 0.2191, 0.2205, 0.018, 6, 0x5a605e);
    }
    // The plate it hangs from, and the rods up to the slab.
    const [hx, hz] = alongX ? [0.14, 0.03] : [0.03, 0.14];
    b.box(x - hx, y + r - 0.004, z - hz, x + hx, y + r + 0.012, z + hz, 0x62696a);
    for (const end of [-1, 1]) {
        const rx = alongX ? x + end * 0.11 : x;
        const rz = alongX ? z : z + end * 0.11;
        b.box(rx - 0.0025, y + r + 0.012, rz - 0.0025, rx + 0.0025, WALL_HEIGHT, rz + 0.0025, HANGER);
    }
    // A box of electrics on its side.
    const [ex, ez] = alongX ? [0, r + 0.012] : [r + 0.012, 0];
    b.box(x + ex - 0.025, y - 0.03, z + ez - 0.025, x + ex + 0.025, y + 0.03, z + ez + 0.025, 0x8e9294);
}

/**
 * A sign hung across the aisle on two rods, lit from inside: the level on the face one way down it, the way out on the
 * other.
 */
function hangingSign(b, faces, x, z, alongX) {
    const y = 0.765;
    const hw = 0.18;
    const hh = 0.06;
    const t = 0.008;
    // Its board spans across the aisle: along z when the aisle runs along x.
    if (alongX) b.box(x - t, y - hh, z - hw, x + t, y + hh, z + hw, SIGN_BOARD);
    else b.box(x - hw, y - hh, z - t, x + hw, y + hh, z + t, SIGN_BOARD);
    for (const end of [-1, 1]) {
        const normal = alongX ? [end, 0] : [0, end];
        picture(faces, [x + normal[0] * (t + 0.0015), z + normal[1] * (t + 0.0015)], normal, hw - 0.006, hh - 0.006, y, end > 0 ? SIGN_PICTURES.level : SIGN_PICTURES.way, 0x9a9c9a);
        const rx = alongX ? x : x + end * (hw - 0.03);
        const rz = alongX ? z + end * (hw - 0.03) : z;
        b.box(rx - 0.002, y + hh, rz - 0.002, rx + 0.002, WALL_HEIGHT, rz + 0.002, HANGER);
    }
}

/** A bar across the aisle, striped yellow and black, hung on chains at the headroom there is, with its plate. */
function headroomBar(b, paint, x, z, alongX) {
    const y = 0.79;
    const r = 0.018;
    const half = BAY / 2 - 0.26;
    const stripes = 12;
    for (let k = 0; k < stripes; k++) {
        const a0 = -half + (k * 2 * half) / stripes;
        const a1 = a0 + (2 * half) / stripes;
        const color = k % 2 === 0 ? BAR_YELLOW : BAR_BLACK;
        // Across the aisle: along z when it runs along x.
        if (alongX) b.cylinder(2, x, y, z + a0, z + a1, r, 8, color);
        else b.cylinder(0, x + a0, y, z, x + a1, r, 8, color);
    }
    for (const end of [-1, 1]) {
        const cx = alongX ? x : x + end * (half - 0.05);
        const cz = alongX ? z + end * (half - 0.05) : z;
        // A chain up to the slab: links, turned alternately.
        for (let yy = y + r; yy < WALL_HEIGHT - 0.01; yy += 0.024) {
            const turn = Math.round((yy - y) / 0.024) % 2 === 0;
            const [w, d] = turn ? [0.006, 0.0015] : [0.0015, 0.006];
            b.box(cx - w, yy, cz - d, cx + w, Math.min(yy + 0.02, WALL_HEIGHT), cz + d, 0x6a6e70);
        }
    }
    // The plate on it, the same each side.
    const t = 0.005;
    if (alongX) b.box(x - t, y - 0.05, z - 0.1, x + t, y + 0.05, z + 0.1, BAR_YELLOW);
    else b.box(x - 0.1, y - 0.05, z - t, x + 0.1, y + 0.05, z + t, BAR_YELLOW);
    for (const end of [-1, 1]) {
        const normal = alongX ? [end, 0] : [0, end];
        picture(paint, [x + normal[0] * (t + 0.0015), z + normal[1] * (t + 0.0015)], normal, 0.095, 0.046, y, GLYPH_PICTURES.headroom, 0xdadad2, GLYPH_SIZE);
    }
}

// ---------------------------------------------------------------------------------------------- on walls and columns

const EXTINGUISHER = 0xa4231b;

/**
 * A fire point: an extinguisher on its bracket and a sign over it, on a wall or a column's face at (x, z) (relative to
 * the chunk), facing `normal` ([x, z]).
 */
export function firePoint({ services, paint }, x, z, normal) {
    const [nx, nz] = normal;
    const out = (d) => [x + nx * d, z + nz * d];
    // The bracket, and the extinguisher standing off it: its body, its black head, and the hose down its side.
    const [bx, bz] = out(0.008);
    const across = [Math.abs(nz), Math.abs(nx)];
    services.box(bx - across[0] * 0.018 - Math.abs(nx) * 0.008, 0.262, bz - across[1] * 0.018 - Math.abs(nz) * 0.008, bx + across[0] * 0.018 + Math.abs(nx) * 0.008, 0.281, bz + across[1] * 0.018 + Math.abs(nz) * 0.008, 0x3a3c3e);
    const [cx, cz] = out(0.034);
    services.cylinder(1, cx, 0.13, cz, 0.29, 0.024, 8, EXTINGUISHER);
    services.cylinder(1, cx, 0.29, cz, 0.305, 0.012, 6, 0x1e1e1e);
    services.box(cx - 0.004 - across[0] * 0.016, 0.3, cz - 0.004 - across[1] * 0.016, cx + 0.004 + across[0] * 0.016, 0.31, cz + 0.004 + across[1] * 0.016, 0x8a8e90);
    const [hx, hz] = out(0.034 + 0.026);
    bar(services, [cx + across[0] * 0.01, 0.3, cz + across[1] * 0.01], [hx + across[0] * 0.012, 0.18, hz + across[1] * 0.012], 0.004, 0x1a1a1a);
    // A pale label round its body.
    services.cylinder(1, cx, 0.19, cz, 0.23, 0.0258, 8, 0xd4cfc0);
    picture(paint, out(0.002), normal, 0.056, 0.028, 0.43, GLYPH_PICTURES.fire, 0xd4d4cc, GLYPH_SIZE);
}

/**
 * A convex mirror on a column's corner (x, z) (relative to the chunk, where its chamfer faces `dir`, [x, z] diagonally
 * out), on an arm, tilted down to see round the column and along the floor.
 */
export function convexMirror({ services, paint }, x, z, dir) {
    const [dx, dz] = dir;
    const length = Math.hypot(dx, dz);
    const n0 = [dx / length, dz / length];
    const y = 0.74;
    const arm = 0.08;
    const [mx, mz] = [x + n0[0] * arm, z + n0[1] * arm];
    bar(services, [x, y, z], [mx, y, mz], 0.005, 0x3a3c3e);
    // The disc faces out and down.
    const tilt = 0.45;
    const normal = [n0[0] * Math.cos(tilt), -Math.sin(tilt), n0[1] * Math.cos(tilt)];
    // Across it (level) and up it.
    const right = [n0[1], 0, -n0[0]];
    const up = [normal[1] * right[2] - normal[2] * right[1], normal[2] * right[0] - normal[0] * right[2], normal[0] * right[1] - normal[1] * right[0]];
    const radius = 0.085;
    const bulge = 0.016;
    const centre = [mx + normal[0] * 0.012, y + normal[1] * 0.012, mz + normal[2] * 0.012];
    disc(paint, centre, normal, right, up, radius, bulge, GLYPH_PICTURES.mirror, 0xe0e0da);
    // Its back.
    const back = normal.map((v) => -v);
    disc(services, [centre[0] - normal[0] * 0.004, centre[1] - normal[1] * 0.004, centre[2] - normal[2] * 0.004], back, right.map((v) => -v), up, radius + 0.004, 0.012, null, 0x2a2b2c);
}

/**
 * A disc facing `normal` (right and up across it), its middle `bulge` out (a convex mirror); with a picture from the
 * glyph texture over it, round its middle, or plain.
 */
function disc(b, centre, normal, right, up, radius, bulge, rect, color) {
    const sides = 18;
    const point = (a, r, lift) => [
        centre[0] + (right[0] * Math.cos(a) + up[0] * Math.sin(a)) * r + normal[0] * lift,
        centre[1] + (right[1] * Math.cos(a) + up[1] * Math.sin(a)) * r + normal[1] * lift,
        centre[2] + (right[2] * Math.cos(a) + up[2] * Math.sin(a)) * r + normal[2] * lift,
    ];
    const uv = (a, r) => {
        if (!rect) return [PLAIN_U, PLAIN_V];
        const [px0, py0, px1, py1] = rect;
        const u = (px0 + px1) / 2 + (Math.cos(a) * r * (px1 - px0)) / 2;
        const v = (py0 + py1) / 2 - (Math.sin(a) * r * (py1 - py0)) / 2;
        return [u / GLYPH_TEXTURE, 1 - v / GLYPH_TEXTURE];
    };
    // Lit as the dome it is: the rim leans out.
    const lean = (a) => {
        const n = [0, 1, 2].map((k) => normal[k] + (right[k] * Math.cos(a) + up[k] * Math.sin(a)) * 0.6);
        const l = Math.hypot(...n);
        return n.map((v) => v / l);
    };
    const middle = b.vertex(...point(0, 0, bulge), ...normal, ...uv(0, 0), color);
    const first = b.vertexCount;
    for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        b.vertex(...point(a, radius, 0), ...lean(a), ...uv(a, 1), color);
    }
    for (let k = 0; k < sides; k++) b.triangle(middle, first + k, first + k + 1);
}
