import { WALL_HEIGHT } from '../config.js';
import {
    AIR_LENGTH,
    AIR_WIDTH,
    EXCHANGER_LENGTH,
    FINISH_BRASS,
    FINISH_CLAD,
    FINISH_COPPER,
    FINISH_ENAMEL,
    FINISH_GALVANISED,
    FINISH_IRON,
    FINISH_LAGGED,
    FINISH_PAINT,
    FINISH_RUST,
    FINISH_WOOD,
} from './pipeDreams.js';
import { FURN_BENCH, FURN_BOARD, FURN_CART, FURN_DRUM, FURN_LOCKERS, FURN_STOCK, FURN_TROLLEY, furnitureDepth } from './pipeDreamsFurniture.js';
import { DIAL_LIFT, band, bend, dial, disc, extrude, hoop, orientedBox, polygon, rectShadow, rod, stadium, tube, turned, wallPicture } from './pipeDreamsShapes.js';
import { PAINT_ATLAS, stencilRect } from './pipeDreamsTextures.js';
import { mulberry32 } from './random.js';

/*
 * What stands in Level 2 besides its boilers, tanks, pumps and headers (see pipeDreamsGeometry.js), as meshes: the heat
 * exchangers, air compressors and air handling units in the plant halls; and what stands against the walls (see
 * pipeDreamsFurniture.js): switchboards, workbenches, racks of pipe, cable drums, trolleys, and the little electric
 * trucks the maintenance crews drove about in, parked where they were left. All of it goes into the same mesh as the
 * pipes (and is weathered by the same shader), its lamps into the fittings', its dials into the gauges'.
 *
 * Everything's worked out in its own frame: `f` out of its front (away from the wall behind it, or along a machine's
 * length), `l` to the left of that, and up.
 */

const IRON = 0x2b2927;
const STEEL = 0x8e9496;
const RUBBER = 0x171717;
const BRASS = 0xb08d3c;
const TIMBER = 0x8a6a45;
const INK = 0x1c1b1a;
const PANEL_GREYS = [0x7c7f7a, 0x5d6a61, 0xa8a48f, 0x6f7678];
const TRUCK_PAINTS = [0xc9a227, 0xd6d1bf, 0x2f4a37, 0xb8561c, 0x44607c];
const WHEEL_COLORS = [0xa3261c, 0xa3261c, 0x1f1f1f, 0xb8912c];
const CYLINDER_COLORS = [0x2a4e7a, 0x1f1f1f, 0xa3261c, 0x3d6b3a, 0x7c7f7a];
const PIPE_STOCK = [
    [FINISH_GALVANISED, 0x9ea4a5],
    [FINISH_RUST, 0x6a3a24],
    [FINISH_COPPER, 0xb56f40],
    [FINISH_PAINT, 0x2e4b6c],
    [FINISH_PAINT, 0x2f4a37],
    [FINISH_IRON, 0x2b2927],
];

/**
 * A frame for building something in: `f` along its front, `l` to its left, up, round (cx, cz) (relative to the chunk).
 * `sub` makes another, moved, and turned end for end along `l` if `flip` is −1 (everything built in it comes out
 * mirrored, and still facing out).
 */
function makeFrame(cx, cz, fx, fz, lx, lz) {
    const m = {
        fx,
        fz,
        lx,
        lz,
        /** A point `f` along its front, `l` to its left, `y` up. */
        at: (f, l, y) => [cx + fx * f + lx * l, y, cz + fz * f + lz * l],
        /** A direction in its own terms, as [x, y, z]. */
        dir: (f, l, y = 0) => [fx * f + lx * l, y, fz * f + lz * l],
        /** A box from (f0, l0, y0) to (f1, l1, y1) in its own terms. */
        box: (b, f0, l0, y0, f1, l1, y1, color, round = 0) => {
            const xs = [cx + fx * f0 + lx * l0, cx + fx * f1 + lx * l1];
            const zs = [cz + fz * f0 + lz * l0, cz + fz * f1 + lz * l1];
            b.box(Math.min(...xs), y0, Math.min(...zs), Math.max(...xs), y1, Math.max(...zs), color, round);
        },
        /** A pipe from one point to another, open at its ends, in its own terms. */
        tube: (b, f0, l0, y0, f1, l1, y1, r, color, sides) => {
            const [ax, ay, az] = m.at(f0, l0, y0);
            const [bx, by, bz] = m.at(f1, l1, y1);
            tube(b, ax, ay, az, bx, by, bz, r, color, 0, sides);
        },
        /** A rod, closed at both ends, in its own terms. */
        rod: (b, f0, l0, y0, f1, l1, y1, r, color, sides) => {
            const [ax, ay, az] = m.at(f0, l0, y0);
            const [bx, by, bz] = m.at(f1, l1, y1);
            rod(b, ax, ay, az, bx, by, bz, r, color, sides);
        },
        /** A short, wide ring round an axis (af, al, ay) through a point, in its own terms. */
        band: (b, f, l, y, af, al, ay, r, width, color, sides) => {
            const [px, py, pz] = m.at(f, l, y);
            const [tx, ty, tz] = m.dir(af, al, ay);
            band(b, px, py, pz, tx, ty, tz, r, width, color, sides);
        },
        /** Something turned about an axis (af, al, ay) from a point (see turned), in its own terms. */
        turned: (b, f, l, y, af, al, ay, profile, sides, color) => {
            const [px, py, pz] = m.at(f, l, y);
            const [tx, ty, tz] = m.dir(af, al, ay);
            turned(b, px, py, pz, tx, ty, tz, profile, sides, color);
        },
        /** Another frame, its middle at (f, l) in this one's terms, and `l` the other way if `flip` is −1. */
        sub: (f, l, flip = 1) => makeFrame(cx + fx * f + lx * l, cz + fz * f + lz * l, fx, fz, lx * flip, lz * flip),
    };
    return m;
}

/** The frame of a machine or a piece of furniture: `f` its way out, round its middle. */
function frameOf(ctx, thing) {
    return makeFrame(thing.x - ctx.ox, thing.z - ctx.oz, thing.dx, thing.dz, -thing.dz, thing.dx);
}

/** A wheel: its tyre (rounded), its rims and hub, about an axis through (f, l, y) along `l` (or along `f`, `across`). */
function wheel(b, m, f, l, y, r, width, rim, sides = 12, across = false) {
    const [af, al] = across ? [1, 0] : [0, 1];
    const h = width / 2;
    const e = Math.min(0.012, r * 0.25);
    b.finish(FINISH_IRON, 0.3);
    m.turned(b, f - af * h, l - al * h, y, af, al, 0, [[r * 0.55, 0], [r - e, 0], [r, e * 1.5], [r, width - e * 1.5], [r - e, width], [r * 0.55, width]], sides, RUBBER);
    // The rims, just proud of the tyre's walls and closing it, and the hub.
    b.finish(FINISH_PAINT, 0.5);
    for (const side of [-1, 1]) m.band(b, f + af * side * (h - 0.002), l + al * side * (h - 0.002), y, af, al, 0, r * 0.58, 0.006, rim, sides);
    b.finish(FINISH_GALVANISED, 0.5);
    m.band(b, f, l, y, af, al, 0, r * 0.2, width + 0.012, STEEL, 8);
}

/**
 * A number stencilled on a face turned (nx, nz), its middle at (x, y, z) (as tunnelStencil in pipeDreamsGeometry.js
 * does a tunnel's name), each figure `size` high (half).
 */
function stencilNumber(ctx, x, y, z, nx, nz, text, size, color = INK) {
    const width = size;
    for (let n = 0; n < text.length; n++) {
        const along = (n - (text.length - 1) / 2) * width;
        wallPicture(ctx.paint, x + nz * along, y, z - nx * along, nx, nz, size * 0.75, size, stencilRect(text[n]), color);
    }
}

// ---------------------------------------------------------------------------------------------- against the walls

/**
 * One piece of furniture (see pipeDreamsFurniture.js), and its shadow.
 * @param {object} ctx See buildPipeDreamsGeometry.
 * @param {import('./pipeDreamsFurniture.js').Piece} piece
 */
export function buildFurniture(ctx, piece) {
    const random = mulberry32(piece.variant);
    const m = frameOf(ctx, piece);
    if (piece.type === FURN_BOARD) switchboard(ctx, m, piece, random);
    else if (piece.type === FURN_BENCH) workbench(ctx, m, piece, random);
    else if (piece.type === FURN_STOCK) pipeRack(ctx, m, piece, random);
    else if (piece.type === FURN_DRUM) cableDrum(ctx, m, piece, random);
    else if (piece.type === FURN_TROLLEY) trolley(ctx, m, piece, random);
    else if (piece.type === FURN_CART) truck(ctx, m, piece, random);
    else if (piece.type === FURN_LOCKERS) lockers(ctx, m, piece, random);
    const depth = furnitureDepth(piece);
    const [x, , z] = m.at(0, 0, 0);
    rectShadow(ctx.shade, x, z, piece.dx !== 0 ? depth : piece.half, piece.dx !== 0 ? piece.half : depth);
}

/**
 * A switchboard: a row of steel cubicles on a plinth, each with its door, handle, hinges, label, now and then a meter,
 * and its lamps (lit like the ceiling's, so they go out with the power); the danger sign; the cables up out of its top
 * into the ceiling in conduit; and a rubber mat on the floor in front.
 */
function switchboard(ctx, m, piece, random) {
    const b = ctx.pipes;
    const d = furnitureDepth(piece);
    const H = piece.half;
    const count = Math.max(1, Math.floor((H * 2) / 0.21));
    const width = (H * 2) / count;
    const height = 0.76;
    // (The low bits are the same all along a row of them: see placePipeDreamsFurniture.)
    const grey = PANEL_GREYS[piece.variant & 3];
    const wear = 0.1 + (((piece.variant >>> 2) & 7) / 7) * 0.6;
    b.finish(FINISH_ENAMEL, wear);
    m.box(b, -d, -H, 0, d - 0.01, H, 0.03, 0x1f1f1f);
    m.box(b, -d, -H, 0.03, d - 0.006, H, height, grey);
    // A lid over the top, a little proud of its front and back.
    m.box(b, -d - 0.004, -H, height, d + 0.004, H, height + 0.012, grey);
    for (let n = 0; n < count; n++) {
        const l = -H + (n + 0.5) * width;
        const hw = width / 2 - 0.007;
        b.finish(FINISH_ENAMEL, wear + random() * 0.08);
        m.box(b, d - 0.006, l - hw, 0.045, d, l + hw, height - 0.015, grey);
        // Its handle and hinges.
        b.finish(FINISH_IRON, 0.4);
        m.box(b, d, l + hw - 0.028, 0.34, d + 0.012, l + hw - 0.018, 0.42, 0x2a2a2a);
        for (const y of [0.1, height - 0.1]) m.box(b, d - 0.004, l - hw - 0.003, y - 0.02, d + 0.004, l - hw + 0.004, y + 0.02, 0x3a3a3a);
        // What it's for, on a plate.
        b.finish(FINISH_PAINT, 0.3);
        m.box(b, d, l - 0.04, height - 0.07, d + 0.002, l + 0.04, height - 0.05, 0xe4e0d0);
        if (random() < 0.55) {
            // A meter, up top.
            b.finish(FINISH_IRON, 0.3);
            m.box(b, d, l - 0.034, height - 0.19, d + 0.006, l + 0.034, height - 0.11, 0x1c1c1c);
            const [gx, , gz] = m.at(d + 0.006 + DIAL_LIFT, l, 0);
            dial(ctx.gauges, gx, height - 0.15, gz, m.fx, m.fz, 0.028, random());
        }
        // Its lamps: red, green, amber; and whether they're still lit.
        const lit = random() < 0.7;
        for (let k = 0; k < 3; k++) {
            const [lx, , lz] = m.at(d + 0.004, l - 0.035 + k * 0.035, 0);
            const color = lit ? [0xff2a1a, 0x3aff5a, 0xffa21a][k] : [0x4a1410, 0x143a1a, 0x4a3410][k];
            ctx.fixtures.box(lx - 0.006, height - 0.235, lz - 0.006, lx + 0.006, height - 0.223, lz + 0.006, color);
        }
        // Louvres low down.
        b.finish(FINISH_PAINT, 0.5);
        for (let k = 0; k < 4; k++) m.box(b, d, l - hw + 0.03, 0.08 + k * 0.022, d + 0.003, l + hw - 0.03, 0.088 + k * 0.022, 0x2a2a2a);
    }
    // The danger sign, on the middle door.
    const [sx, , sz] = m.at(d + 0.0015, -H + (Math.floor(count / 2) + 0.5) * width - width * 0.12, 0);
    wallPicture(ctx.paint, sx, 0.5, sz, m.fx, m.fz, 0.04, 0.04, PAINT_ATLAS.voltage);
    // Cables up out of the top, in conduit, to the ceiling.
    b.finish(FINISH_GALVANISED, 0.5);
    const runs = 2 + Math.floor(random() * 3);
    for (let k = 0; k < runs; k++) {
        const l = -H + 0.05 + (k / (runs - 1)) * (H * 2 - 0.1);
        m.tube(b, -d + 0.03, l, height + 0.01, -d + 0.03, l, WALL_HEIGHT, 0.011 + (k % 2) * 0.004, 0x9ea4a5, 8);
    }
    // The mat in front.
    b.finish(FINISH_IRON, 0.1);
    m.box(b, d + 0.02, -H + 0.02, 0, d + 0.2, H - 0.02, 0.004, 0x1b1b1a);
}

/**
 * A workbench: a thick timber top on a steel frame, a shelf under it with what's kept there, a vice on one end, tools
 * left on top, and a board on the wall over it the tools hang on.
 */
function workbench(ctx, m, piece, random) {
    const b = ctx.pipes;
    const d = furnitureDepth(piece);
    const L = piece.half;
    const top = 0.33;
    const frameColor = [0x2f4a37, 0x44607c, 0x3a3d40][Math.floor(random() * 3)];
    b.finish(FINISH_PAINT, 0.5 + random() * 0.4);
    // Legs, rails, and the shelf.
    for (const l of [-L + 0.02, L - 0.02]) {
        for (const f of [-d + 0.02, d - 0.02]) m.box(b, f - 0.012, l - 0.012, 0, f + 0.012, l + 0.012, top - 0.035, frameColor);
        m.box(b, -d + 0.032, l - 0.01, 0.06, d - 0.032, l + 0.01, 0.075, frameColor);
    }
    m.box(b, -d + 0.032, -L + 0.032, 0.075, d - 0.032, L - 0.032, 0.085, frameColor);
    m.box(b, -d + 0.005, -L + 0.005, top - 0.035, d - 0.005, L - 0.005, top - 0.02, frameColor);
    b.finish(FINISH_WOOD, 0.6);
    m.box(b, -d, -L, top - 0.02, d, L, top, TIMBER);
    // The vice, on the front corner: its body, jaws, screw and bar.
    const side = random() < 0.5 ? -1 : 1;
    const vl = side * (L - 0.07);
    b.finish(FINISH_ENAMEL, 0.7);
    const vice = [0x2a4e7a, 0x3d6b3a, 0x5a5a58][Math.floor(random() * 3)];
    m.box(b, d - 0.06, vl - 0.035, top, d - 0.005, vl + 0.035, top + 0.045, vice);
    m.box(b, d - 0.005, vl - 0.035, top + 0.01, d + 0.012, vl + 0.035, top + 0.055, vice);
    b.finish(FINISH_IRON, 0.5);
    m.rod(b, d + 0.012, vl, top + 0.028, d + 0.06, vl, top + 0.028, 0.006, STEEL, 6);
    m.rod(b, d + 0.06, vl - 0.05, top + 0.028, d + 0.06, vl + 0.05, top + 0.028, 0.004, STEEL, 5);
    // Tools left on top.
    const tools = 1 + Math.floor(random() * 3);
    for (let n = 0; n < tools; n++) {
        const l = -side * (L - 0.1) + side * n * 0.14;
        const f = (random() - 0.5) * d;
        const which = random();
        if (which < 0.35) {
            // A hammer.
            b.finish(FINISH_WOOD, 0.5);
            m.rod(b, f - 0.05, l, top + 0.007, f + 0.045, l + 0.01, top + 0.007, 0.006, 0x9a7a4a, 6);
            b.finish(FINISH_IRON, 0.6);
            m.box(b, f + 0.045, l - 0.02, top, f + 0.062, l + 0.03, top + 0.018, 0x3a3a3a);
        } else if (which < 0.6) {
            // A spanner.
            b.finish(FINISH_GALVANISED, 0.3);
            m.box(b, f - 0.05, l - 0.005, top, f + 0.05, l + 0.005, top + 0.004, 0xa9aeb0);
            m.box(b, f - 0.062, l - 0.012, top, f - 0.05, l + 0.012, top + 0.005, 0xa9aeb0);
        } else if (which < 0.8) {
            // An oil can.
            b.finish(FINISH_PAINT, 0.7);
            const r = 0.022;
            m.turned(b, f, l, top, 0, 0, 1, [[0, 0], [r, 0], [r, 0.035], [r * 0.4, 0.05], [0.004, 0.055], [0.003, 0.09], [0, 0.09]], 8, 0xb3261e);
        } else {
            // A mug.
            b.finish(FINISH_PAINT, 0.3);
            m.turned(b, f, l, top, 0, 0, 1, [[0, 0], [0.013, 0], [0.014, 0.03], [0.011, 0.03], [0.011, 0.005], [0, 0.005]], 8, [0xe8e4d8, 0x2f4a37, 0xa3261c][n % 3]);
        }
    }
    // On the shelf: a box, a drum of something.
    b.finish(FINISH_PAINT, 0.6);
    m.box(b, -0.05, -L * 0.6, 0.085, 0.07, -L * 0.6 + 0.14, 0.16, 0x8a6a3a);
    m.turned(b, 0, L * 0.5, 0.085, 0, 0, 1, [[0, 0], [0.04, 0], [0.04, 0.1], [0, 0.1]], 8, [0x2a4e7a, 0xa3261c, 0x3d6b3a][Math.floor(random() * 3)]);
    // The board on the wall over it, and what hangs on it.
    const back = -d - 0.002;
    b.finish(FINISH_PAINT, 0.4);
    m.box(b, back - 0.008, -L + 0.03, 0.4, back, L - 0.03, 0.66, 0x9a8a68);
    b.finish(FINISH_IRON, 0.5);
    for (let n = 0; n < 6; n++) {
        if (random() < 0.25) continue;
        const l = -L + 0.08 + n * ((2 * L - 0.16) / 5);
        const y = 0.5 + (n % 2) * 0.06;
        if (n % 3 === 0) {
            // A saw.
            m.box(b, back, l - 0.05, y - 0.03, back + 0.003, l + 0.05, y + 0.02, 0xa9aeb0);
            m.box(b, back, l + 0.05, y - 0.02, back + 0.01, l + 0.08, y + 0.03, 0x7a3a28);
        } else if (n % 3 === 1) {
            // Spanners, largest first.
            for (let k = 0; k < 3; k++) m.box(b, back, l - 0.03 + k * 0.022, y - 0.06 + k * 0.012, back + 0.004, l - 0.022 + k * 0.022, y + 0.04, 0xa9aeb0);
        } else {
            // A coil of wire, or of hose.
            const [hx, , hz] = m.at(back + 0.012, l, 0);
            hoop(b, hx, y, hz, m.fx, 0, m.fz, 0.04, 0.007, random() < 0.5 ? 0x1f1f1f : 0xa3261c, 10);
        }
    }
}

/**
 * A rack of pipe stock: steel uprights against the wall with arms out from them, lengths of pipe lying along the arms,
 * and an offcut or two on the floor.
 */
function pipeRack(ctx, m, piece, random) {
    const b = ctx.pipes;
    const d = furnitureDepth(piece);
    const L = piece.half;
    const levels = [0.12, 0.3, 0.48];
    b.finish(FINISH_PAINT, 0.6 + random() * 0.3);
    const rackColor = [0xd6a516, 0x2f4a37, 0x44607c][Math.floor(random() * 3)];
    for (const l of [-L + 0.04, 0, L - 0.04]) {
        m.box(b, -d, l - 0.012, 0.01, -d + 0.02, l + 0.012, 0.6, rackColor);
        m.box(b, -d, l - 0.04, 0, d, l + 0.04, 0.01, rackColor);
        for (const y of levels) m.box(b, -d + 0.02, l - 0.008, y - 0.012, d, l + 0.008, y, rackColor);
    }
    for (const y of levels) {
        if (random() < 0.15) continue;
        const [finish, color] = PIPE_STOCK[Math.floor(random() * PIPE_STOCK.length)];
        const r = 0.008 + random() * 0.018;
        b.finish(finish, random());
        let f = -d + 0.022 + r;
        while (f + r < d - 0.005) {
            const length = L * (1.6 + random() * 0.35);
            const start = -L + random() * (2 * L - length) - 0.02;
            m.rod(b, f, start, y + r, f, start + length, y + r, r, color);
            f += 2 * r + 0.002;
            if (random() < 0.2) break;
        }
    }
    // Offcuts on the floor in front, clear of its feet.
    const [finish, color] = PIPE_STOCK[Math.floor(random() * PIPE_STOCK.length)];
    b.finish(finish, random());
    for (let n = 0; n < 2; n++) {
        const r = 0.012 + random() * 0.012;
        const l = (random() - 0.5) * L;
        const f = d + 0.01 + r + n * 0.05;
        m.rod(b, f, l - 0.08, r, f + 0.012, l + 0.08, r, r, color);
    }
}

/**
 * A cable drum standing on its flanges, its back to the wall: two timber flanges, the cable wound round the barrel
 * between them, its end over the top and trailing out across the floor, and chocks under it.
 */
function cableDrum(ctx, m, piece, random) {
    const b = ctx.pipes;
    const d = furnitureDepth(piece);
    const R = piece.half - 0.005;
    const y = R;
    b.finish(FINISH_WOOD, 0.7);
    for (const f of [-d + 0.008, d - 0.008]) m.band(b, f, 0, y, 1, 0, 0, R, 0.014, 0x7a5a38, 14);
    // The cable, wound on, and some of its turns showing.
    const cable = [0x1c1c1c, 0x1c1c1c, 0x3a3d40, 0xa3261c, 0x2a4e7a][Math.floor(random() * 5)];
    const wound = R * (0.5 + 0.35 * random());
    b.finish(FINISH_PAINT, 0.2);
    m.band(b, 0, 0, y, 1, 0, 0, wound - 0.006, 2 * d - 0.03, cable, 16);
    for (let n = 0; n < 3; n++) {
        const [px, py, pz] = m.at(-d + 0.035 + n * ((2 * d - 0.07) / 2), 0, y);
        hoop(b, px, py, pz, m.fx, 0, m.fz, wound - 0.004, 0.009, cable, 12);
    }
    // Its end: off the top, over the front flange, down to the floor and away.
    const path = [[d - 0.03, 0, y + wound], [d + 0.01, 0.01, y + R + 0.012], [d + 0.07, 0.03, y + R * 0.6], [d + 0.13, 0.05, 0.012], [d + 0.3, 0.12 + random() * 0.12, 0.01]];
    for (let k = 0; k < path.length - 1; k++) m.tube(b, ...path[k], ...path[k + 1], 0.009, cable, 6);
    // Chocks under it, so it doesn't roll.
    b.finish(FINISH_WOOD, 0.8);
    for (const l of [-R * 0.75, R * 0.75]) m.box(b, -d + 0.02, l - 0.02, 0, d - 0.02, l + 0.02, 0.03, 0x6a4a2a);
}

/**
 * A row of steel lockers on a plinth: their doors, louvred top and bottom, a handle and a number on each; now and then
 * one standing open, its shelf and a coat on its hook showing.
 */
function lockers(ctx, m, piece, random) {
    const b = ctx.pipes;
    const d = furnitureDepth(piece);
    const H = piece.half;
    const count = Math.max(2, Math.min(4, Math.round((H * 2) / 0.11)));
    const w = (H * 2) / count;
    const height = 0.66;
    const t = 0.004;
    const paint = [0x7c8082, 0x4d6b5a, 0x44607c, 0x8a7a58][Math.floor(random() * 4)];
    const wear = 0.2 + random() * 0.6;
    const open = random() < 0.35 ? Math.floor(random() * count) : -1;
    b.finish(FINISH_IRON, 0.5);
    m.box(b, -d, -H, 0, d - t, H, 0.03, 0x1e1e1e);
    b.finish(FINISH_ENAMEL, wear);
    // The carcass: its back, top, and the sides between them (shared by the lockers either side).
    m.box(b, -d, -H, 0.03, -d + t, H, height, paint);
    m.box(b, -d + t, -H, height - t, d - t, H, height, paint);
    for (let n = 0; n <= count; n++) {
        const l = -H + n * w;
        m.box(b, -d + t, Math.max(-H, l - t / 2), 0.03, d - t, Math.min(H, l + t / 2), height - t, paint);
    }
    for (let n = 0; n < count; n++) {
        const l0 = -H + n * w + t / 2 + 0.002;
        const l1 = -H + (n + 1) * w - t / 2 - 0.002;
        if (n === open) {
            // Inside: dark, a shelf near the top, a coat on the hook under it.
            b.finish(FINISH_IRON, 0.3);
            m.box(b, -d + t, l0, 0.03, -d + t + 0.002, l1, height - t, 0x2c2e30);
            m.box(b, -d + t + 0.002, l0, height - 0.12, d - t - 0.01, l1, height - 0.116, 0x2c2e30);
            b.finish(FINISH_LAGGED, 0.8);
            m.box(b, -d + 0.02, (l0 + l1) / 2 - 0.03, height - 0.42, -d + 0.05, (l0 + l1) / 2 + 0.03, height - 0.14, [0x2f3a4a, 0x3a3228, 0x5a4a2a][Math.floor(random() * 3)], 0.01);
            // Its door, swung out on its hinge.
            const swing = 1.7 + random() * 0.3;
            const hinge = m.at(d - t / 2, l0, 0);
            const across = m.dir(Math.sin(swing), Math.cos(swing));
            const out = m.dir(Math.cos(swing), -Math.sin(swing));
            const half = (l1 - l0) / 2;
            b.finish(FINISH_ENAMEL, wear);
            orientedBox(b, [hinge[0] + across[0] * half, 0.345, hinge[2] + across[2] * half], across, [0, 1, 0], out, half, (height - 0.05) / 2, 0.0025, paint);
            continue;
        }
        b.finish(FINISH_ENAMEL, wear);
        m.box(b, d - t, l0, 0.035, d, l1, height - t - 0.003, paint);
        // Louvres top and bottom, the handle, the number.
        b.finish(FINISH_IRON, 0.3);
        for (const y of [0.09, 0.105, 0.12, height - 0.12, height - 0.105, height - 0.09]) m.box(b, d, l0 + 0.02, y, d + 0.002, l1 - 0.02, y + 0.005, 0x2a2c2e);
        m.box(b, d, l1 - 0.018, 0.33, d + 0.008, l1 - 0.01, 0.37, 0x2a2a2a);
        b.finish(FINISH_PAINT, 0.2);
        m.box(b, d, (l0 + l1) / 2 - 0.012, height - 0.06, d + 0.0015, (l0 + l1) / 2 + 0.012, height - 0.045, 0xe0ddd2);
    }
}

/** A platform trolley: its deck and rim, four castors, the handle at one end, and what's been left on it. */
function trolley(ctx, m, piece, random) {
    const b = ctx.pipes;
    const d = furnitureDepth(piece) - 0.01;
    const L = piece.half - 0.01;
    const deck = 0.075;
    const handleEnd = random() < 0.5 ? -1 : 1;
    const color = [0x2a4e7a, 0x3d6b3a, 0xb3261e, 0x5a5a58][Math.floor(random() * 4)];
    b.finish(FINISH_PAINT, 0.5 + random() * 0.4);
    m.box(b, -d, -L, deck - 0.012, d, L, deck, 0x5a5a58);
    for (const f of [-d, d - 0.008]) m.box(b, f, -L, deck, f + 0.008, L, deck + 0.012, color);
    for (const l of [-L + 0.008, L - 0.016]) m.box(b, -d + 0.008, l, deck, d - 0.008, l + 0.008, deck + 0.012, color);
    // Castors: a fork and a wheel.
    for (const f of [-d + 0.04, d - 0.04]) {
        for (const l of [-L + 0.05, L - 0.05]) {
            b.finish(FINISH_GALVANISED, 0.6);
            m.box(b, f - 0.014, l - 0.018, 0.035, f + 0.014, l + 0.018, deck - 0.012, 0x7c8082);
            b.finish(FINISH_IRON, 0.3);
            m.band(b, f, l, 0.028, 1, 0, 0, 0.028, 0.018, RUBBER, 8);
        }
    }
    // The handle: up from the end, and across.
    b.finish(FINISH_PAINT, 0.6);
    const hl = handleEnd * (L - 0.012);
    const top = 0.4;
    const R = 0.02;
    for (const f of [-d + 0.02, d - 0.02]) {
        m.tube(b, f, hl, deck, f, hl, top - R, 0.009, color, 8);
        const [sx, sy, sz] = m.at(f, hl, top - R);
        const [cx, , cz] = m.dir(f < 0 ? 1 : -1, 0);
        bend(b, sx, sy, sz, 0, 1, 0, cx, 0, cz, R, 0.009, color);
    }
    m.tube(b, -d + 0.02 + R, hl, top, d - 0.02 - R, hl, top, 0.009, color, 8);
    // What's on it.
    load(ctx, m, deck, d - 0.01, L - 0.03, random);
}

/** Something left on a deck at height `y`, `d` deep and `L` long (half): gas cylinders, boxes, sacks or pipe. */
function load(ctx, m, y, d, L, random) {
    const b = ctx.pipes;
    const kind = random();
    if (kind < 0.3) {
        // Gas cylinders, lying down.
        const color = CYLINDER_COLORS[Math.floor(random() * CYLINDER_COLORS.length)];
        const count = d > 0.09 ? 1 + Math.floor(random() * 2) : 1;
        const r = 0.04;
        for (let n = 0; n < count; n++) {
            const f = count === 1 ? 0 : (n - 0.5) * 0.09;
            const length = 2 * L - 0.02;
            b.finish(FINISH_ENAMEL, 0.4 + random() * 0.4);
            m.turned(b, f, -L, y + r, 0, 1, 0, [[0, 0], [r * 0.85, 0], [r, 0.012], [r, length * 0.78], [r * 0.6, length * 0.9], [0.012, length * 0.93], [0.012, length], [0, length]], 10, color);
        }
    } else if (kind < 0.6) {
        // Boxes, stacked.
        b.finish(FINISH_WOOD, 0.9);
        let top = y;
        const count = 1 + Math.floor(random() * 3);
        for (let n = 0; n < count; n++) {
            const h = 0.06 + random() * 0.05;
            const half = Math.min(L - 0.02, 0.07 + random() * 0.06);
            const l = (random() - 0.5) * (L - half);
            const hd = Math.min(d, 0.06 + random() * 0.04);
            m.box(b, -hd, l - half, top, hd, l + half, top + h, [0x9a7a4a, 0x8a6a3a, 0xa88a5a][n % 3], 0.003);
            // The tape over it.
            m.box(b, -hd - 0.001, l - 0.012, top + h - 0.002, hd + 0.001, l + 0.012, top + h + 0.001, 0xc8b88a);
            top += h;
        }
    } else if (kind < 0.8) {
        // Sacks of something, slumped.
        b.finish(FINISH_LAGGED, 0.8);
        const count = 1 + Math.floor(random() * 3);
        for (let n = 0; n < count; n++) {
            const l = count === 1 ? 0 : -L * 0.5 + (n / (count - 1)) * L;
            const lift = n % 2 === 1 ? 0.02 : 0;
            m.box(b, -d * 0.8, l - L * 0.3, y + lift, d * 0.8, l + L * 0.3, y + lift + 0.07, 0xb8ab88, 0.02);
        }
    } else {
        // A bundle of pipe, longer than the deck.
        const [finish, color] = [[FINISH_GALVANISED, 0x9ea4a5], [FINISH_RUST, 0x6a3a24], [FINISH_COPPER, 0xb56f40]][Math.floor(random() * 3)];
        b.finish(finish, random());
        const r = 0.012;
        for (let n = 0; n < 5; n++) {
            const f = -0.026 + (n % 3) * 0.026 + (n >= 3 ? 0.013 : 0);
            const up = n >= 3 ? 0.022 : 0;
            m.rod(b, f, -L * 1.15, y + r + up, f, L * 1.15, y + r + up, r, color, 8);
        }
    }
}

/**
 * A little electric utility truck, parked along the wall: its wheels, the bonnet over the front ones, lamps, grille and
 * bumper, the dashboard and steering wheel, the bench seat, a canopy on four posts with a beacon on it, the flatbed on
 * the back with what it was carrying still on it, and its fleet number.
 */
function truck(ctx, m, piece, random) {
    const b = ctx.pipes;
    // Along the wall, `l` towards its nose (it's parked facing either way), `f` across it towards the room.
    const t = m.sub(0, 0, piece.variant & 1 ? 1 : -1);
    const W = furnitureDepth(piece) - 0.005;
    const L = piece.half - 0.005;
    const paint = TRUCK_PAINTS[Math.floor(random() * TRUCK_PAINTS.length)];
    const wear = 0.1 + random() * 0.7;
    const wr = 0.068;
    const axles = [L - 0.2, -L + 0.19];
    const track = W - 0.035;
    for (const a of axles) for (const f of [-track, track]) wheel(b, t, f, a, wr, wr, 0.048, 0x8e9496, 10, true);
    // The chassis, low between the wheels, and the axles.
    b.finish(FINISH_IRON, 0.6);
    t.box(b, -track + 0.035, -L + 0.03, 0.055, track - 0.035, L - 0.05, 0.1, 0x1f1f1f);
    for (const a of axles) t.rod(b, -track + 0.02, a, wr, track - 0.02, a, wr, 0.012, 0x2a2a2a, 6);
    // The floor of the cab.
    t.box(b, -W + 0.02, axles[1] + 0.1, 0.1, W - 0.02, axles[0] - 0.09, 0.12, 0x2a2a2a);
    // The bonnet over the front wheels, as a shape across the truck pushed forward to the nose.
    const bonnetBack = axles[0] - 0.12;
    const noseAt = L - 0.06;
    b.finish(FINISH_ENAMEL, wear);
    const across = t.dir(1, 0);
    const up = [0, 1, 0];
    const forward = t.dir(0, 1);
    // (Its outline's pushed along across × up: across flipped, if that points backwards.)
    const pushed = [across[1] * up[2] - across[2] * up[1], across[2] * up[0] - across[0] * up[2], across[0] * up[1] - across[1] * up[0]];
    const u = pushed[0] * forward[0] + pushed[2] * forward[2] > 0 ? across : across.map((c) => -c);
    const bonnet = [[-W, 0.15], [W, 0.15], [W, 0.24], [W - 0.03, 0.27], [-W + 0.03, 0.27], [-W, 0.24]];
    extrude(b, t.at(0, bonnetBack, 0), u, up, bonnet, noseAt - bonnetBack, paint);
    // Under the bonnet between the wheels, and the nose: grille, lamps and bumper.
    t.box(b, -track + 0.04, bonnetBack, 0.1, track - 0.04, noseAt, 0.15, 0x2a2a2a);
    t.box(b, -W + 0.02, noseAt, 0.1, W - 0.02, noseAt + 0.03, 0.25, paint, 0.012);
    b.finish(FINISH_IRON, 0.4);
    for (let k = 0; k < 4; k++) t.box(b, -0.08, noseAt + 0.03, 0.13 + k * 0.02, 0.08, noseAt + 0.034, 0.14 + k * 0.02, 0x1c1c1c);
    b.finish(FINISH_GALVANISED, 0.5);
    t.box(b, -W - 0.01, L - 0.03, 0.07, W + 0.01, L, 0.1, 0x3a3a3a, 0.005);
    for (const f of [-W + 0.06, W - 0.06]) {
        t.band(b, f, noseAt + 0.033, 0.2, 0, 1, 0, 0.026, 0.01, 0xb8bcbe, 12);
        const [hx, hy, hz] = t.at(f, noseAt + 0.0395, 0.2);
        disc(ctx.fixtures, hx, hy, hz, forward[0], 0, forward[2], 0.021, 0x6a6458, 12);
    }
    // The dashboard, and the steering column up out of it with the wheel.
    b.finish(FINISH_ENAMEL, wear);
    t.box(b, -W + 0.01, bonnetBack - 0.02, 0.24, W - 0.01, bonnetBack + 0.01, 0.33, 0x2a2a2a, 0.008);
    b.finish(FINISH_IRON, 0.4);
    const column = [t.at(0.09, bonnetBack - 0.02, 0.3), t.at(0.09, bonnetBack - 0.085, 0.37)];
    rod(b, ...column[0], ...column[1], 0.008, 0x2a2a2a, 6);
    const lean = Math.hypot(0.065, 0.07);
    hoop(b, ...column[1], -forward[0] * 0.065 / lean, 0.07 / lean, -forward[2] * 0.065 / lean, 0.05, 0.006, 0x1f1f1f, 14);
    // The seat: a bench across the truck, its cushion and back.
    const seatBack = axles[1] + 0.14;
    const seatFront = seatBack + 0.14;
    t.box(b, -W + 0.03, seatBack, 0.12, W - 0.03, seatFront, 0.2, 0x2a2a2a);
    b.finish(FINISH_PAINT, 0.2 + wear * 0.5);
    const vinyl = random() < 0.6 ? 0x1f1d1b : 0x5a2a1e;
    t.box(b, -W + 0.03, seatBack, 0.2, W - 0.03, seatFront, 0.235, vinyl, 0.012);
    t.box(b, -W + 0.03, seatBack - 0.035, 0.22, W - 0.03, seatBack, 0.36, vinyl, 0.01);
    // A panel behind the seat, between it and the bed.
    b.finish(FINISH_ENAMEL, wear);
    t.box(b, -W, seatBack - 0.05, 0.12, W, seatBack - 0.035, 0.38, paint);
    // The canopy: four posts, the roof, and the beacon on it.
    const roof = 0.62;
    b.finish(FINISH_GALVANISED, 0.5);
    for (const [a, from] of [[bonnetBack - 0.005, 0.33], [seatBack - 0.045, 0.38]]) {
        for (const f of [-W + 0.015, W - 0.015]) t.rod(b, f, a, from, f, a, roof, 0.009, 0x2a2a2a, 6);
    }
    b.finish(FINISH_ENAMEL, wear);
    t.box(b, -W - 0.01, seatBack - 0.07, roof, W + 0.01, bonnetBack + 0.03, roof + 0.02, paint, 0.008);
    const middle = (seatBack + bonnetBack) / 2;
    b.finish(FINISH_IRON, 0.3);
    t.box(b, -0.02, middle - 0.02, roof + 0.02, 0.02, middle + 0.02, roof + 0.03, 0x1c1c1c);
    b.finish(FINISH_PAINT, 0.2);
    t.turned(b, 0, middle, roof + 0.03, 0, 0, 1, [[0.017, 0], [0.017, 0.022], [0.012, 0.03], [0, 0.034]], 10, 0xd8701c);
    // The flatbed on the back: its deck, sides and tailboard, its lamps, and what's on it.
    const bedFront = seatBack - 0.05;
    const bed = 0.16;
    b.finish(FINISH_ENAMEL, wear);
    t.box(b, -W, -L, bed - 0.02, W, bedFront, bed, 0x3a3a3a);
    for (const f of [-W, W - 0.01]) t.box(b, f, -L, bed, f + 0.01, bedFront, bed + 0.06, paint);
    t.box(b, -W + 0.01, -L, bed, W - 0.01, -L + 0.01, bed + 0.06, paint);
    for (const f of [-W + 0.04, W - 0.04]) {
        const [lx, , lz] = t.at(f, -L - 0.004, 0);
        ctx.fixtures.box(lx - 0.012, bed - 0.035, lz - 0.012, lx + 0.012, bed - 0.015, lz + 0.012, 0x5a1410);
    }
    if (random() < 0.8) load(ctx, t.sub(0, (bedFront - L) / 2), bed, W - 0.02, (bedFront + L) / 2 - 0.02, random);
    // Its fleet number, on the side towards the room.
    const [px, , pz] = t.at(W + 0.0015, (bonnetBack + noseAt) / 2, 0);
    stencilNumber(ctx, px, 0.205, pz, m.fx, m.fz, String(10 + (piece.variant >>> 8) % 40), 0.024);
}

// ---------------------------------------------------------------------------------------------- the plant

/**
 * A heat exchanger: a long shell on two saddles, dished at one end and bolted to its channel head at the other, the
 * pipes in and out of the head's side (up into the ceiling and down into the floor), a branch up off the shell with its
 * valve, a relief valve, a gauge, a drain under it, and its maker's plate.
 * @param {object} ctx
 * @param {import('./pipeDreams.js').Machine} machine
 * @param {(x: number, z: number, r: number) => boolean} clear Whether an upright of radius r at (x, z) (relative to the
 *     chunk) keeps clear of the lamp over it (see clearOfLamp in pipeDreamsGeometry.js).
 */
export function exchanger(ctx, machine, clear) {
    const b = ctx.pipes;
    const random = mulberry32(machine.variant);
    const m = frameOf(ctx, machine);
    const L = EXCHANGER_LENGTH / 2;
    const R = 0.15;
    const y = 0.27;
    const lagged = random() < 0.55;
    const clad = lagged && random() < 0.5;
    const shell = lagged ? (clad ? 0xb8bcbe : 0xd2c7ad) : [0x2f4a37, 0x7c7f7a, 0x74291e][Math.floor(random() * 3)];
    // The saddles.
    b.finish(FINISH_PAINT, 0.6);
    for (const f of [-L * 0.6, L * 0.6]) {
        m.box(b, f - 0.035, -R * 0.85, 0, f + 0.035, R * 0.85, 0.03, IRON);
        m.box(b, f - 0.02, -R * 0.7, 0.03, f + 0.02, R * 0.7, y - R * 0.6, IRON);
        m.band(b, f, 0, y, 1, 0, 0, R + 0.01, 0.03, IRON, 16);
    }
    // The shell, and its dished end at the back.
    b.finish(lagged ? (clad ? FINISH_CLAD : FINISH_LAGGED) : FINISH_ENAMEL, 0.3 + random() * 0.5);
    m.turned(b, -L, 0, y, 1, 0, 0, [[0, -R * 0.45], [R * 0.6, -R * 0.38], [R * 0.9, -R * 0.2], [R, -0.01], [R, 2 * L]], 16, shell);
    // The flanges where it bolts to the head, their bolts, and the head with its domed cover.
    b.finish(FINISH_IRON, 0.7);
    m.band(b, L, 0, y, 1, 0, 0, R + 0.03, 0.03, IRON, 20);
    m.band(b, L + 0.035, 0, y, 1, 0, 0, R + 0.03, 0.03, IRON, 20);
    for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2 + 0.3;
        const [cl, cy] = [Math.cos(angle) * (R + 0.02), y + Math.sin(angle) * (R + 0.02)];
        m.rod(b, L - 0.022, cl, cy, L + 0.057, cl, cy, 0.004, 0x3a3a3a, 4);
    }
    b.finish(FINISH_ENAMEL, 0.6);
    const headColor = [0x2f4a37, 0x3a3d40, 0x74291e][Math.floor(random() * 3)];
    m.turned(b, L + 0.05, 0, y, 1, 0, 0, [[R * 0.95, 0], [R * 0.95, 0.12], [R * 0.7, 0.16], [0, 0.175]], 16, headColor);
    // In and out of the head's side, a flange on each: the one turned up into the ceiling, the other down to the floor.
    const side = random() < 0.5 ? -1 : 1;
    const pipeColor = [0x2e4b6c, 0x74291e, 0x9b9e9f][Math.floor(random() * 3)];
    const r = 0.026;
    const out = R + 0.1;
    const bendR = 0.05;
    for (const dy of [0.07, -0.07]) {
        const f = L + 0.11;
        b.finish(FINISH_PAINT, 0.5);
        m.tube(b, f, side * R * 0.8, y + dy, f, side * out, y + dy, r, pipeColor);
        m.band(b, f, side * (R + 0.02), y + dy, 0, 1, 0, r * 1.6, 0.012, pipeColor);
        const [bx, , bz] = m.at(f, side * out, 0);
        const [cx, , cz] = m.dir(0, side);
        const [ux, , uz] = m.at(f, side * (out + bendR), 0);
        if (dy > 0 && clear(ux, uz, r)) {
            bend(b, bx, y + dy, bz, cx, 0, cz, 0, 1, 0, bendR, r, pipeColor);
            tube(b, ux, y + dy + bendR, uz, ux, WALL_HEIGHT, uz, r, pipeColor);
        } else if (dy > 0) {
            band(b, bx - cx * 0.004, y + dy, bz - cz * 0.004, cx, 0, cz, r + 0.004, 0.012, pipeColor);
        } else {
            bend(b, bx, y + dy, bz, cx, 0, cz, 0, -1, 0, bendR, r, pipeColor);
            tube(b, ux, y + dy - bendR, uz, ux, -0.01, uz, r, pipeColor);
            b.finish(FINISH_IRON, 0.6);
            band(b, ux, 0.004, uz, 0, 1, 0, r * 1.5, 0.008, IRON);
        }
    }
    // Up off the top of the shell: a branch into the ceiling, with its valve; and the relief valve.
    const [tx, , tz] = m.at(-L * 0.3, 0, 0);
    if (clear(tx, tz, 0.03)) {
        b.finish(FINISH_PAINT, 0.5);
        tube(b, tx, y + R - 0.01, tz, tx, WALL_HEIGHT, tz, 0.03, pipeColor);
        band(b, tx, y + R + 0.03, tz, 0, 1, 0, 0.045, 0.014, pipeColor);
        uprightValve(ctx, tx, y + R + 0.2, tz, 0.03, m.lx * side, m.lz * side, random());
    }
    const [rx, , rz] = m.at(L * 0.35, 0, 0);
    b.finish(FINISH_IRON, 0.5);
    tube(b, rx, y + R - 0.01, rz, rx, y + R + 0.06, rz, 0.018, IRON);
    band(b, rx, y + R + 0.06, rz, 0, 1, 0, 0.028, 0.012, IRON);
    b.finish(FINISH_BRASS, 0.4);
    rod(b, rx, y + R + 0.066, rz, rx, y + R + 0.12, rz, 0.012, BRASS, 8);
    // A gauge on the head's other side.
    const [gx, , gz] = m.at(L + 0.11, -side * (R * 0.95 + 0.008), 0);
    const [nx, , nz] = m.dir(0, -side);
    b.finish(FINISH_IRON, 0.5);
    band(b, gx, y + 0.02, gz, nx, 0, nz, 0.026, 0.016, 0x1f1f1f);
    dial(ctx.gauges, gx + nx * (0.008 + DIAL_LIFT), y + 0.02, gz + nz * (0.008 + DIAL_LIFT), nx, nz, 0.022, random());
    // The drain, under the shell, and its valve.
    const [dx, , dz] = m.at(-L * 0.2, 0, 0);
    b.finish(FINISH_IRON, 0.6);
    tube(b, dx, y - R + 0.01, dz, dx, 0.05, dz, 0.01, IRON, 8);
    band(b, dx, 0.07, dz, 0, 1, 0, 0.018, 0.02, IRON, 8);
    // Its maker's plate.
    const [px, , pz] = m.at(0, side * (R + (lagged ? 0.004 : 0.002)), 0);
    wallPicture(ctx.paint, px, y + 0.04, pz, m.lx * side, m.lz * side, 0.05, 0.02, PAINT_ATLAS.plate);
}

/**
 * An air compressor on its receiver: a painted tank lying on four feet, on top of it the motor and the compressor's
 * finned cylinders, the belt guard between them, the pressure switch and a gauge; a pipe up off it into the ceiling
 * (if there's no lamp there), and its drain under the tank.
 */
export function compressor(ctx, machine, clear) {
    const b = ctx.pipes;
    const random = mulberry32(machine.variant);
    const m = frameOf(ctx, machine);
    const r = 0.1;
    const L = 0.34;
    const y = 0.13;
    const tankColor = [0xa3261c, 0x7c7f7a, 0x2a4e7a, 0x3d6b3a][Math.floor(random() * 4)];
    b.finish(FINISH_IRON, 0.6);
    for (const f of [-L * 0.65, L * 0.65]) {
        for (const l of [-r * 0.6, r * 0.6]) m.box(b, f - 0.012, l - 0.012, 0, f + 0.012, l + 0.012, y - r * 0.6, IRON);
    }
    b.finish(FINISH_ENAMEL, 0.1 + random() * 0.25);
    m.turned(b, -L, 0, y, 1, 0, 0, [[0, -r * 0.5], [r * 0.55, -r * 0.42], [r * 0.87, -r * 0.24], [r, -0.005], [r, 2 * L], [r * 0.87, 2 * L + r * 0.24], [r * 0.55, 2 * L + r * 0.42], [0, 2 * L + r * 0.5]], 16, tankColor);
    // The deck on top.
    const deck = y + r;
    b.finish(FINISH_IRON, 0.5);
    m.box(b, -L * 0.85, -0.085, deck - 0.012, L * 0.85, 0.085, deck + 0.004, 0x2a2a2a);
    // The motor: a finned drum, and its feet.
    b.finish(FINISH_ENAMEL, 0.4);
    const motorColor = [0x2e4b6c, 0x3a5a3a, 0x5a5a58][Math.floor(random() * 3)];
    const my = deck + 0.06;
    const mf = -L * 0.8;
    m.turned(b, mf, -0.02, my, 1, 0, 0, [[0, 0], [0.04, 0], [0.052, 0.015], [0.052, 0.17], [0.04, 0.185], [0.012, 0.185], [0.012, 0.21], [0, 0.21]], 12, motorColor);
    for (let k = 0; k < 4; k++) m.band(b, mf + 0.035 + k * 0.035, -0.02, my, 1, 0, 0, 0.058, 0.008, motorColor, 10);
    m.box(b, mf + 0.03, -0.06, deck + 0.004, mf + 0.16, 0.02, my - 0.035, motorColor);
    // The compressor: its crankcase, and two finned cylinders up in a V.
    const pf = L * 0.35;
    b.finish(FINISH_IRON, 0.5);
    m.box(b, pf - 0.06, -0.06, deck + 0.004, pf + 0.06, 0.03, deck + 0.07, 0x3a3d40, 0.01);
    for (const lean of [-0.45, 0.45]) {
        const af = Math.sin(lean);
        const ay = Math.cos(lean);
        const fins = [];
        for (let k = 0; k < 3; k++) fins.push([0.042, k * 0.026], [0.042, k * 0.026 + 0.008], [0.03, k * 0.026 + 0.009], [0.03, k * 0.026 + 0.025]);
        m.turned(b, pf + af * 0.03, -0.015, deck + 0.06, af, 0, ay, [[0, 0], [0.03, 0], ...fins, [0.036, 0.085], [0.036, 0.1], [0, 0.1]], 8, 0x3a3d40);
    }
    // The guard over the belt between the motor's pulley and the compressor's flywheel.
    b.finish(FINISH_ENAMEL, 0.5);
    const guard = [0xd6a516, 0xd6a516, 0xb3261e][Math.floor(random() * 3)];
    extrude(b, m.at(-0.03, 0.055, deck + 0.075), m.dir(1, 0), [0, 1, 0], stadium(0.17, 0.06, 5), 0.03, guard);
    // The pressure switch, and a gauge on it.
    b.finish(FINISH_ENAMEL, 0.4);
    m.box(b, L * 0.72, -0.03, deck + 0.004, L * 0.9, 0.03, deck + 0.07, 0x5a5a58);
    const [gx, , gz] = m.at(L * 0.81, -0.03 - 0.008, 0);
    b.finish(FINISH_IRON, 0.5);
    band(b, gx, deck + 0.04, gz, -m.lx, 0, -m.lz, 0.02, 0.014, 0x1f1f1f);
    dial(ctx.gauges, gx - m.lx * (0.007 + DIAL_LIFT), deck + 0.04, gz - m.lz * (0.007 + DIAL_LIFT), -m.lx, -m.lz, 0.017, random());
    // A pipe up to the ceiling, off the end of the tank, if there's room.
    const [ux, , uz] = m.at(L + 0.02, 0.04, 0);
    if (clear(ux, uz, 0.014)) {
        b.finish(FINISH_GALVANISED, 0.5);
        m.tube(b, L - 0.02, 0.04, y + r * 0.5, L + 0.02, 0.04, y + r * 0.5, 0.014, 0x9ea4a5, 8);
        tube(b, ux, y + r * 0.5 - 0.014, uz, ux, WALL_HEIGHT, uz, 0.014, 0x9ea4a5, 0, 8);
        band(b, ux, deck + 0.18, uz, 0, 1, 0, 0.022, 0.03, 0x2a2a2a, 8);
    }
    // The drain under the tank.
    const [ox, , oz] = m.at(0, 0, 0);
    b.finish(FINISH_IRON, 0.6);
    tube(b, ox, y - r + 0.005, oz, ox, 0.025, oz, 0.006, IRON, 6);
}

/**
 * An air handling unit: a long casing in sections, each with its access doors, hinges and handles, on base rails; a
 * louvred intake across one end; the canvas boot on top and the duct up out of it into the ceiling; its condensate
 * drain to the floor, and its plate.
 */
export function airHandler(ctx, machine, clear) {
    const b = ctx.pipes;
    const random = mulberry32(machine.variant);
    const m = frameOf(ctx, machine);
    const L = AIR_LENGTH / 2 - 0.02;
    const W = AIR_WIDTH / 2 - 0.02;
    const H = 0.6;
    const painted = random() < 0.45;
    const casing = painted ? [0x9a9e8a, 0x5d6a61, 0xb9b39c][Math.floor(random() * 3)] : 0xa2a8a9;
    const finish = painted ? FINISH_ENAMEL : FINISH_GALVANISED;
    const wear = painted ? random() * 0.3 : 0.1 + random() * 0.25;
    b.finish(FINISH_IRON, 0.5);
    for (const l of [-W + 0.03, W - 0.03]) m.box(b, -L, l - 0.02, 0, L, l + 0.02, 0.04, IRON);
    b.finish(finish, wear);
    m.box(b, -L, -W, 0.04, L, W, H, casing);
    // Its sections: the seams between them, and on each side a door with its handles and hinges.
    const sections = 3;
    for (let n = 0; n < sections; n++) {
        const f0 = -L + (n / sections) * 2 * L;
        const f1 = -L + ((n + 1) / sections) * 2 * L;
        b.finish(FINISH_IRON, 0.4);
        if (n > 0) m.box(b, f0 - 0.006, -W - 0.004, 0.045, f0 + 0.006, W + 0.004, H + 0.004, 0x5a5e60);
        for (const side of [-1, 1]) {
            const face = side * W;
            b.finish(finish, wear);
            m.box(b, f0 + 0.04, face, 0.09, f1 - 0.04, face + side * 0.003, H - 0.05, casing);
            b.finish(FINISH_IRON, 0.4);
            for (const y of [0.2, H - 0.16]) m.box(b, f1 - 0.07, face + side * 0.003, y, f1 - 0.055, face + side * 0.015, y + 0.05, 0x2a2a2a);
            for (const y of [0.13, H - 0.1]) m.box(b, f0 + 0.03, face + side * 0.001, y, f0 + 0.045, face + side * 0.007, y + 0.04, 0x3a3a3a);
        }
    }
    // The intake: a louvred grille across the back end, in its frame.
    b.finish(FINISH_GALVANISED, 0.6);
    const [nx, , nz] = m.dir(-0.6, 0);
    for (let k = 0; k < 8; k++) {
        const y0 = 0.1 + k * 0.058;
        polygon(b, [m.at(-L - 0.004, -W + 0.03, y0 + 0.045), m.at(-L - 0.004, W - 0.03, y0 + 0.045), m.at(-L - 0.04, W - 0.03, y0), m.at(-L - 0.04, -W + 0.03, y0)], nx, 0.8, nz, 0x7c8082);
    }
    for (const l of [-W + 0.02, W - 0.02]) m.box(b, -L - 0.045, l - 0.01, 0.09, -L, l + 0.01, H - 0.03, 0x7c8082);
    m.box(b, -L - 0.045, -W + 0.01, 0.07, -L, W - 0.01, 0.09, 0x7c8082);
    m.box(b, -L - 0.045, -W + 0.01, H - 0.03, -L, W - 0.01, H - 0.01, 0x7c8082);
    // The duct up: out of the fan's section at the front, or elsewhere along it if a lamp's over that.
    const f = [L * 0.55, -L * 0.3, L * 0.1].find((s) => clear(...m.at(s, 0, 0).filter((_, k) => k !== 1), 0.2));
    if (f !== undefined) {
        const [hf, hl] = [0.13, 0.17];
        b.finish(FINISH_LAGGED, 0.7);
        m.box(b, f - hf, -hl, H, f + hf, hl, H + 0.06, 0x3a3d40);
        b.finish(FINISH_GALVANISED, 0.4);
        m.box(b, f - hf + 0.005, -hl + 0.005, H + 0.06, f + hf - 0.005, hl - 0.005, WALL_HEIGHT, 0xa2a8a9);
        for (const y of [H + 0.08, H + 0.3]) m.box(b, f - hf - 0.004, -hl - 0.004, y, f + hf + 0.004, hl + 0.004, y + 0.014, 0x8e9496);
    }
    // The condensate drain, out of the side and down to the floor.
    const side = random() < 0.5 ? -1 : 1;
    b.finish(FINISH_PAINT, 0.6);
    m.tube(b, 0, side * W, 0.09, 0, side * (W + 0.05), 0.09, 0.01, 0xd4d4cb, 8);
    m.tube(b, 0, side * (W + 0.05), 0.1, 0, side * (W + 0.05), -0.01, 0.01, 0xd4d4cb, 8);
    m.band(b, 0, side * (W + 0.05), 0.09, 0, 0, 1, 0.013, 0.02, 0xd4d4cb, 8);
    // Its plate.
    const [px, , pz] = m.at(L * 0.6, side * (W + 0.0045), 0);
    wallPicture(ctx.paint, px, H - 0.1, pz, m.lx * side, m.lz * side, 0.06, 0.024, PAINT_ATLAS.plate);
}

/** A gate valve in an upright pipe, its spindle out sideways and the wheel on it (as a pump's is). */
function uprightValve(ctx, x, y, z, r, nx, nz, roll) {
    const b = ctx.pipes;
    b.finish(FINISH_IRON, 0.6);
    band(b, x, y, z, 0, 1, 0, r * 1.5, 0.06, IRON);
    band(b, x, y - 0.034, z, 0, 1, 0, r * 1.8, 0.008, IRON);
    band(b, x, y + 0.034, z, 0, 1, 0, r * 1.8, 0.008, IRON);
    const out = r * 1.5 + 0.03;
    rod(b, x, y, z, x + nx * out, y, z + nz * out, 0.005, STEEL, 4);
    const color = WHEEL_COLORS[Math.floor(roll * WHEEL_COLORS.length)];
    b.finish(FINISH_PAINT, 0.6);
    hoop(b, x + nx * out, y, z + nz * out, nx, 0, nz, 0.034, 0.0045, color);
    for (let n = 0; n < 3; n++) {
        const angle = (n / 3) * Math.PI * 2 + roll * 3;
        const [rx, rz] = [nz, -nx];
        rod(b, x + nx * out, y, z + nz * out, x + nx * out + rx * Math.cos(angle) * 0.034, y + Math.sin(angle) * 0.034, z + nz * out + rz * Math.cos(angle) * 0.034, 0.003, color, 4);
    }
}

/**
 * A forklift, parked: its counterweight and the gas bottle on it, the wheels, seat and steering wheel, the guard over
 * the seat on its four posts, the mast with its cylinder, and the forks, down on the floor or holding a pallet a little
 * off it with a load on it.
 */
export function forklift(ctx, machine) {
    const b = ctx.pipes;
    const random = mulberry32(machine.variant);
    const m = frameOf(ctx, machine);
    const paint = [0xc9a227, 0xb8561c, 0xa3261c, 0xd6d1bf][Math.floor(random() * 4)];
    const wear = 0.2 + random() * 0.7;
    // The wheels: big ones at the front under the mast, small ones at the back under the counterweight.
    for (const l of [-0.13, 0.13]) wheel(b, m, 0.0, l, 0.055, 0.055, 0.042, 0x2a2a2a, 10);
    for (const l of [-0.095, 0.095]) wheel(b, m, -0.26, l, 0.042, 0.042, 0.034, 0x2a2a2a, 8);
    // The chassis between the wheels, the counterweight at the back, and the cowl in front of the seat.
    b.finish(FINISH_IRON, 0.5);
    m.box(b, -0.3, -0.105, 0.035, 0.05, 0.105, 0.12, 0x1f1f1f);
    b.finish(FINISH_ENAMEL, wear);
    m.box(b, -0.35, -0.155, 0.1, -0.2, 0.155, 0.3, paint, 0.02);
    m.box(b, -0.2, -0.155, 0.12, 0.035, 0.155, 0.2, paint);
    m.box(b, -0.02, -0.12, 0.2, 0.035, 0.12, 0.29, paint, 0.01);
    // Over the front wheels.
    for (const side of [-1, 1]) m.box(b, -0.05, side * 0.105, 0.115, 0.06, side * 0.16, 0.125, 0x1f1f1f);
    // The gas bottle on the back, lying across.
    b.finish(FINISH_ENAMEL, 0.5);
    const bottle = [0x7c8082, 0x2a4e7a, 0xd6d1bf][Math.floor(random() * 3)];
    m.turned(b, -0.29, -0.1, 0.345, 0, 1, 0, [[0, 0], [0.036, 0], [0.042, 0.01], [0.042, 0.17], [0.03, 0.19], [0.01, 0.2], [0.01, 0.215], [0, 0.215]], 10, bottle);
    b.finish(FINISH_IRON, 0.4);
    for (const l of [-0.07, 0.07]) m.box(b, -0.33, l - 0.008, 0.3, -0.25, l + 0.008, 0.31, 0x2a2a2a);
    // The seat, and the steering wheel on its column.
    b.finish(FINISH_ENAMEL, 0.6);
    m.box(b, -0.17, -0.07, 0.2, -0.07, 0.07, 0.225, 0x1f1d1b, 0.01);
    m.box(b, -0.19, -0.07, 0.22, -0.165, 0.07, 0.33, 0x1f1d1b, 0.01);
    b.finish(FINISH_IRON, 0.4);
    const [c0x, c0y, c0z] = m.at(0.0, 0, 0.28);
    const [c1x, c1y, c1z] = m.at(-0.035, 0, 0.36);
    rod(b, c0x, c0y, c0z, c1x, c1y, c1z, 0.007, 0x2a2a2a, 6);
    const lean = Math.hypot(0.035, 0.08);
    const [ax, , az] = m.dir(-0.035 / lean, 0);
    hoop(b, c1x, c1y, c1z, ax, 0.08 / lean, az, 0.04, 0.005, 0x1f1f1f, 12);
    // The guard over the seat: four posts and its roof, a lamp on each front post, and a beacon.
    const roof = 0.68;
    b.finish(FINISH_ENAMEL, wear);
    for (const [f, from] of [[0.02, 0.2], [-0.26, 0.3]]) {
        for (const l of [-0.135, 0.135]) m.box(b, f - 0.01, l - 0.01, from, f + 0.01, l + 0.01, roof, 0x2a2a2a);
    }
    m.box(b, -0.28, -0.145, roof, 0.04, -0.125, roof + 0.016, 0x2a2a2a);
    m.box(b, -0.28, 0.125, roof, 0.04, 0.145, roof + 0.016, 0x2a2a2a);
    for (let k = 0; k < 5; k++) {
        const f = -0.27 + k * 0.075;
        m.box(b, f - 0.006, -0.125, roof + 0.003, f + 0.006, 0.125, roof + 0.013, 0x2a2a2a);
    }
    for (const l of [-0.135, 0.135]) {
        const [lx, , lz] = m.at(0.035, l, 0);
        const [nx, , nz] = m.dir(1, 0);
        b.finish(FINISH_IRON, 0.4);
        m.box(b, 0.028, l - 0.014, 0.6, 0.046, l + 0.014, 0.628, 0x1f1f1f);
        disc(ctx.fixtures, lx + nx * 0.0125, 0.614, lz + nz * 0.0125, nx, 0, nz, 0.011, 0x6a6458, 8);
    }
    b.finish(FINISH_PAINT, 0.2);
    m.turned(b, -0.2, 0, roof + 0.016, 0, 0, 1, [[0.016, 0], [0.016, 0.02], [0.011, 0.028], [0, 0.031]], 10, 0xd8701c);
    // The mast: two uprights, their crossbars, and the lifting cylinder between them.
    b.finish(FINISH_IRON, 0.6);
    const mast = 0.72;
    for (const l of [-0.095, 0.095]) m.box(b, 0.045, l - 0.014, 0.03, 0.075, l + 0.014, mast, 0x2a2a28);
    for (const y of [0.3, mast - 0.02]) m.box(b, 0.05, -0.095, y, 0.07, 0.095, y + 0.02, 0x2a2a28);
    b.finish(FINISH_GALVANISED, 0.3);
    m.rod(b, 0.035, 0, 0.05, 0.035, 0, 0.55, 0.013, 0x8e9496, 8);
    // The carriage and the forks: down on the floor, or up a little, under a pallet.
    const laden = random() < 0.5;
    const forkY = laden ? 0.06 : 0.004;
    b.finish(FINISH_IRON, 0.5);
    m.box(b, 0.075, -0.13, forkY + 0.02, 0.09, 0.13, forkY + 0.14, 0x2a2a28);
    for (const l of [-0.065, 0.065]) {
        m.box(b, 0.09, l - 0.017, forkY, 0.104, l + 0.017, forkY + 0.13, 0x3a3a38);
        m.box(b, 0.09, l - 0.017, forkY, 0.35, l + 0.017, forkY + 0.012, 0x3a3a38);
    }
    if (!laden) return;
    // The pallet on the forks, and what's on it.
    const deck = forkY + 0.012;
    b.finish(FINISH_WOOD, 0.6);
    for (const l of [-0.12, 0, 0.12]) m.box(b, 0.11, l - 0.02, deck, 0.345, l + 0.02, deck + 0.025, 0x7a5a38);
    for (const f of [0.12, 0.2, 0.28, 0.335]) m.box(b, f - 0.014, -0.15, deck + 0.025, f + 0.014, 0.15, deck + 0.035, 0x8a6a45);
    load(ctx, m.sub(0.228, 0), deck + 0.035, 0.13, 0.14, random);
}
