import { CHUNK_SIZE, WALL_THICKNESS } from '../config.js';
import { ColorBuilder } from './ColorBuilder.js';
import { EDGE_WALL } from './grid.js';
import { hashFloat } from './random.js';
import {
    CELL_CORRIDOR,
    CELL_GALLERY,
    CELL_HALL,
    CELL_ROOM,
    CELL_X_CORRIDOR,
    CELL_Z_CORRIDOR,
    GALLERY,
    LAMP_Y,
    SCONCE_WALLS,
} from './terrorHotel.js';
import {
    FURN_ARMCHAIR,
    FURN_BANDSTAND,
    FURN_BANQUET,
    FURN_BED,
    FURN_BEVERLY,
    FURN_BOOKCASE,
    FURN_CENTRE_TABLE,
    FURN_CHALKBOARD,
    FURN_CLOCK,
    FURN_CONSOLE,
    FURN_DESK,
    FURN_FIREPLACE,
    FURN_LONG_TABLE,
    FURN_LOW_TABLE,
    FURN_NIGHTSTAND,
    FURN_PIANO,
    FURN_RUG,
    FURN_SIDE_TABLE,
    FURN_SOFA,
    FURN_WARDROBE,
    FURN_WRITING_DESK,
    furnitureBox,
    furnitureHalf,
} from './terrorHotelFurniture.js';
import {
    BRASS,
    F_FABRIC,
    F_GILT,
    F_GLASS,
    F_LINEN,
    F_PAINT,
    F_VEINED,
    F_WOOD_X,
    F_WOOD_Y,
    F_WOOD_Z,
    GILT,
    IRON,
    WALNUT,
    atlasUv,
    doorIn,
    face4,
    rod,
    turned,
    wallBox,
    wallPicture,
} from './terrorHotelGeometry.js';
import { curve, shapedPanel, softBox, tube } from './terrorHotelShapes.js';
import { HOTEL_ATLAS, HOTEL_BINDINGS as BINDINGS, PORTRAIT_GENTLEMAN } from './terrorHotelTextures.js';

/*
 * Level 5's furniture (see terrorHotelFurniture.js for where it goes) and its paintings, as meshes: most of it in the
 * woodwork (one mesh, one material, finished part by part: see FRAGMENT_FINISH in terrorHotelShading.js), the lamps'
 * shades and the candles with the fittings (they glow when they're on), the rugs, the canvases, the books' spines and
 * the signs with the paint, a clock's face with the dials. Each piece is built in its own frame (across it to its
 * right, out of its front, and up) and turned to face the way it does. The upholstery is rounded over, the legs turned
 * or bent (see terrorHotelShapes.js), and everything keeps inside what the piece takes up.
 */

const N = CHUNK_SIZE;
const FACE = 0.5 - WALL_THICKNESS / 2;

const MAHOGANY = 0x4a2016;
const DARK_WOOD = 0x2e140c;
const EBONY = 0x151112;
const LINEN = 0xe8e2d4;
const SHADE = 0xe6c690;
const COVERS = [0x5e1418, 0x6a4a1e, 0x24381e, 0x2a2a44];
const VELVETS = [0x6e1a1a, 0x2a4028, 0x6a5020, 0x3a2030];
const LEATHER = 0x4a1812;
const IVORY = 0xe4dcc4;
const GLASS = 0xb8c4c4;
const SILVER = 0xc8ccce;
const CANDLE = 0xf0e8d8;
const FLAME = 0xffe0a0;
const WHITE_MARBLE = 0xd8d0c0;
const DARK_MARBLE = 0x2e2a26;
const CHALK_BOARD = 0x1a1c1a;

/** A piece's frame: world (relative to the chunk) from across it (to its right), out of its front, and up. */
function frame(ctx, piece) {
    const rx = -piece.dz;
    const rz = piece.dx;
    const x = piece.x - ctx.ox;
    const z = piece.z - ctx.oz;
    const at = (a, f, y) => [x + rx * a + piece.dx * f, y, z + rz * a + piece.dz * f];
    // What a rectangle of the frame covers, square to the world (it's turned a quarter at a time).
    const cover = (a0, a1, f0, f1) => {
        const xs = [x + rx * a0 + piece.dx * f0, x + rx * a1 + piece.dx * f1];
        const zs = [z + rz * a0 + piece.dz * f0, z + rz * a1 + piece.dz * f1];
        return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    };
    return {
        at,
        box: (b, a0, a1, f0, f1, y0, y1, color, bevel = 0) => {
            const [x0, z0, x1, z1] = cover(a0, a1, f0, f1);
            b.box(x0, y0, z0, x1, y1, z1, color, bevel);
        },
        // The same, rounded over.
        soft: (b, a0, a1, f0, f1, y0, y1, r, color, seg = 1, bottom = true) => {
            const [x0, z0, x1, z1] = cover(a0, a1, f0, f1);
            softBox(b, x0, y0, z0, x1, y1, z1, r, color, seg, bottom);
        },
        // Something turned about an upright through (a, f), from height y.
        turned: (b, a, f, y, profile, sides, color, inward = false) => {
            turned(b, x + rx * a + piece.dx * f, y, z + rz * a + piece.dz * f, 0, 1, 0, profile, sides, color, inward);
        },
        // Something turned about a line out of the front through (a, f, y) (a knob, a drum).
        forward: (b, a, f, y, profile, sides, color, dir = 1) => {
            turned(b, ...at(a, f, y), piece.dx * dir, 0, piece.dz * dir, profile, sides, color);
        },
        // The same, about a line across it.
        sideways: (b, a, f, y, profile, sides, color, dir = 1) => {
            turned(b, ...at(a, f, y), rx * dir, 0, rz * dir, profile, sides, color);
        },
        // A rod between two points of the frame.
        rod: (b, p, q, r, color, sides = 6) => rod(b, ...at(p[0], p[1], p[2]), ...at(q[0], q[1], q[2]), r, color, sides),
        // A tube through points of the frame, [a, f, y] each.
        tube: (b, points, radius, sides, color, caps = true) => tube(b, points.map(([a, f, y]) => at(a, f, y)), radius, sides, color, caps),
        // The grain along the piece's width, or front to back.
        across: rx !== 0 ? F_WOOD_X : F_WOOD_Z,
        along: piece.dx !== 0 ? F_WOOD_X : F_WOOD_Z,
        right: [rx, rz],
        front: [piece.dx, piece.dz],
    };
}

/** A frame for something at (a, f) in another piece's frame, facing (fa, ff) of that frame (a chair at a table). */
function within(ctx, piece, a, f, fa, ff) {
    const [rx, rz] = [-piece.dz, piece.dx];
    return frame(ctx, { x: piece.x + rx * a + piece.dx * f, z: piece.z + rz * a + piece.dz * f, dx: rx * fa + piece.dx * ff, dz: rz * fa + piece.dz * ff });
}

/** A little random stream from a piece's variant (its books, its flowers). */
function stream(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
        return state / 4294967296;
    };
}

/** Every piece of the chunk's furniture. */
export function buildFurniture(ctx) {
    for (const piece of ctx.data.furniture) build(ctx, piece);
}

/**
 * One piece on its own, at the origin and facing +z, for edit mode to put down on any level (see furnitureProps.js): its
 * woodwork, its fittings (a lamp's shade, lit or not), what's painted on it, and its dial, each in the builder of that
 * name. (The glow round a lit lamp is left out.)
 * @param {{ woodwork: ColorBuilder, fittings: ColorBuilder, paint: ColorBuilder, dials: ColorBuilder }} builders
 * @param {number} type FURN_*
 * @param {number} variant
 * @param {boolean} [lit]
 */
export function buildHotelPiece(builders, type, variant, lit = false) {
    build({ ...builders, glows: new ColorBuilder('glow'), ox: 0, oz: 0 }, { type, x: 0, z: 0, dx: 0, dz: 1, variant, lit });
}

function build(ctx, piece) {
    switch (piece.type) {
        case FURN_BED: return bed(ctx, piece);
        case FURN_NIGHTSTAND: return nightstand(ctx, piece);
        case FURN_WARDROBE: return wardrobe(ctx, piece);
        case FURN_ARMCHAIR: return armchair(ctx, piece);
        case FURN_SOFA: return sofa(ctx, piece);
        case FURN_SIDE_TABLE: return sideTable(ctx, piece);
        case FURN_LOW_TABLE: return lowTable(ctx, piece);
        case FURN_RUG: return rug(ctx, piece);
        case FURN_DESK: return reception(ctx, piece);
        case FURN_CLOCK: return clock(ctx, piece);
        case FURN_PIANO: return piano(ctx, piece);
        case FURN_CENTRE_TABLE: return centreTable(ctx, piece);
        case FURN_BANQUET: return banquet(ctx, piece);
        case FURN_BEVERLY: return beverlyTable(ctx, piece);
        case FURN_WRITING_DESK: return writingDesk(ctx, piece);
        case FURN_BOOKCASE: return bookcase(ctx, piece);
        case FURN_FIREPLACE: return fireplace(ctx, piece);
        case FURN_CONSOLE: return consoleTable(ctx, piece);
        case FURN_BANDSTAND: return bandstand(ctx, piece);
        case FURN_LONG_TABLE: return longTable(ctx, piece);
        case FURN_CHALKBOARD: return chalkboard(ctx, piece);
        default: return undefined;
    }
}

// ---------------------------------------------------------------------------------------------- legs

/**
 * A cabriole leg at (a, f) of a frame, from its knee at `top` down to its foot: swelling out at the knee (the way
 * (oa, of) goes, out from the piece's corner), in at the ankle, and out again onto a pad foot.
 */
function cabriole(b, p, a, f, top, oa, of, color, r = 0.011) {
    const length = Math.hypot(oa, of) || 1;
    const [ua, uf] = [oa / length, of / length];
    // (Its height between the knee and the top of the foot.)
    const out = (d, s) => [a + ua * d, f + uf * d, 0.022 + (top - 0.022) * s];
    p.tube(b, [out(0, 1), out(0.01, 0.76), out(0.002, 0.46), out(-0.004, 0.18), out(0, 0)], [r * 1.1, r * 1.2, r * 0.95, r * 0.62, r * 0.7], 5, color);
    p.turned(b, a + ua * 0.002, f + uf * 0.002, 0, [[r * 0.95, 0], [r * 1.05, 0.007], [r * 0.7, 0.022], [0, 0.026]], 5, color);
}

/** A turned leg tapering down from `top` to its foot, at (a, f) of a frame. */
function turnedLeg(b, p, a, f, top, r, color, sides = 5) {
    p.turned(b, a, f, 0, [[r * 0.65, 0], [r * 0.7, 0.008], [r * 0.6, 0.014], [r, top * 0.72], [r * 1.15, top * 0.8], [r * 1.05, top]], sides, color);
}

// ---------------------------------------------------------------------------------------------- chairs

/**
 * How the side chairs are made: the ballroom's gilt ones with a spindle back, and the dining chairs with a splat, in
 * lacquer or wood. (Their finishes by name: this module is loaded before the one they come from.)
 */
const GILT_CHAIR = { wood: 0x8a6a34, pad: 0x6a1216, finish: 'gilt', splat: false };
const LACQUER_CHAIR = { wood: EBONY, pad: 0x3a1a4a, finish: 'lacquer', splat: true };

/** Half a side chair's width and depth: all of what's drawn of one is inside that, round its middle. */
const CHAIR_HALF = 0.078;

/**
 * A side chair, in its own frame (facing its front): turned front legs, the back legs raking back and going on up as
 * the stiles, a curved top rail, a padded seat, and a back of spindles, or a vase-shaped splat.
 */
function chair(ctx, p, { wood, pad, finish: kind, splat }) {
    const b = ctx.woodwork;
    const finish = kind === 'gilt' ? F_GILT : kind === 'lacquer' ? F_GLASS : F_WOOD_Y;
    const seat = 0.158;
    b.finish(finish, 0.2);
    for (const e of [-1, 1]) {
        p.tube(b, [[e * 0.06, 0.06, seat], [e * 0.062, 0.063, 0.08], [e * 0.064, 0.066, 0]], [0.0075, 0.0062, 0.0055], 5, wood, false);
        p.tube(b, [[e * 0.064, -0.068, 0], [e * 0.061, -0.062, 0.08], [e * 0.058, -0.06, seat], [e * 0.056, -0.064, 0.3], [e * 0.055, -0.068, 0.403]], [0.0055, 0.0065, 0.0072, 0.0068, 0.0064], 5, wood, false);
        p.tube(b, [[e * 0.062, 0.06, 0.05], [e * 0.061, -0.061, 0.05]], 0.0035, 4, wood);
    }
    p.tube(b, [[-0.061, 0.062, 0.05], [0.061, 0.062, 0.05]], 0.0035, 4, wood);
    // The top rail, bowed back and up.
    const rail = curve([-0.055, -0.068, 0.403], [0, -0.072, 0.43], [0.055, -0.068, 0.403], 5);
    p.tube(b, rail, 0.007, 5, wood);
    // (Where the rail is at a point across it, for what meets it from below.)
    const railAt = (a) => {
        const t = (a / 0.055 + 1) / 2;
        return [-0.068 - 0.008 * t * (1 - t), 0.403 + 0.054 * t * (1 - t)];
    };
    p.tube(b, [[-0.056, -0.063, 0.19], [0, -0.066, 0.192], [0.056, -0.063, 0.19]], 0.0045, 4, wood);
    if (splat) {
        // A splat, vase-shaped: narrow at its foot, swelling, a neck, and flaring out under the rail.
        const width = [[0, 0.012], [0.3, 0.026], [0.55, 0.019], [0.8, 0.011], [1, 0.024]];
        const halfAt = (t) => {
            for (let k = 0; k + 1 < width.length; k++) {
                const [t0, w0] = width[k];
                const [t1, w1] = width[k + 1];
                if (t <= t1) return w0 + (w1 - w0) * (0.5 - 0.5 * Math.cos(Math.PI * (t - t0) / (t1 - t0)));
            }
            return width[width.length - 1][1];
        };
        const steps = 6;
        for (let k = 0; k < steps; k++) {
            const [t0, t1] = [k / steps, (k + 1) / steps];
            const [y0, y1] = [0.192 + t0 * 0.21, 0.192 + t1 * 0.21];
            const [w0, w1] = [halfAt(t0), halfAt(t1)];
            const [f0, f1] = [-0.064 - 0.006 * t0, -0.064 - 0.006 * t1];
            for (const [off, dir] of [[0.003, 1], [-0.003, -1]]) {
                face4(b, [p.at(-w0, f0 + off, y0), p.at(w0, f0 + off, y0), p.at(w1, f1 + off, y1), p.at(-w1, f1 + off, y1)], [p.front[0] * dir, 0, p.front[1] * dir], wood);
            }
            for (const e of [-1, 1]) {
                face4(b, [p.at(e * w0, f0 - 0.003, y0), p.at(e * w0, f0 + 0.003, y0), p.at(e * w1, f1 + 0.003, y1), p.at(e * w1, f1 - 0.003, y1)], [p.right[0] * e, 0, p.right[1] * e], wood);
            }
        }
    } else {
        // Spindles, up from a rail to the top one.
        p.tube(b, [[-0.056, -0.064, 0.3], [0, -0.067, 0.302], [0.056, -0.064, 0.3]], 0.0045, 4, wood);
        for (let k = 0; k < 4; k++) {
            const a = -0.033 + k * 0.022;
            const [f, y] = railAt(a);
            p.tube(b, [[a, -0.065, 0.3], [a, f + 0.002, y]], 0.0032, 4, wood, false);
        }
    }
    // The seat: its frame, and the pad on it.
    b.finish(finish, 0.2);
    p.box(b, -0.07, 0.07, -0.068, 0.07, 0.148, 0.168, wood);
    b.finish(F_FABRIC, 0);
    p.soft(b, -0.065, 0.065, -0.062, 0.072, 0.162, 0.186, 0.012, pad, 1, false);
}

// ---------------------------------------------------------------------------------------------- the guest rooms

/**
 * A bed, its head to the wall: turned posts at its corners with finials, a headboard with an arched top (a raised
 * panel in it), a cover that hangs down its sides, the sheet turned down over it, the pillows, and a lower footboard.
 */
function bed(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    // Half the frame's width: its posts reach a little past it, to the edge of what it takes up.
    const a = furnitureHalf(piece)[0] - 0.02;
    const cover = COVERS[(piece.variant >>> 3) % COVERS.length];
    b.finish(F_WOOD_Y, 0.2);
    const post = (h) => [[0.013, 0], [0.011, 0.03], [0.011, h - 0.07], [0.014, h - 0.055], [0.009, h - 0.035], [0.012, h - 0.018], [0, h]];
    for (const e of [-1, 1]) {
        for (const [f, h] of [[-0.368, 0.46], [0.368, 0.27]]) p.turned(b, e * (a + 0.004), f, 0, post(h), 6, MAHOGANY);
    }
    // The headboard and the footboard, their tops arched, a moulding along each.
    b.finish(p.across, 0.2);
    const head = (s) => 0.33 + 0.08 * (1 - (s / a) ** 2);
    const foot = (s) => 0.2 + 0.035 * (1 - (s / a) ** 2);
    shapedPanel(b, p, -a, a, -0.376, -0.36, 0.06, head, 8, MAHOGANY);
    shapedPanel(b, p, -a, a, 0.36, 0.376, 0.06, foot, 8, MAHOGANY);
    for (const [f, top] of [[-0.368, head], [0.368, foot]]) {
        const points = [];
        for (let k = 0; k <= 6; k++) {
            const s = -a + (2 * a * k) / 6;
            points.push([s, f, top(s) + 0.003]);
        }
        p.tube(b, points, 0.0075, 4, MAHOGANY, false);
    }
    const inner = a * 0.72;
    shapedPanel(b, p, -inner, inner, -0.36, -0.356, 0.16, (s) => 0.29 + 0.07 * (1 - (s / inner) ** 2), 6, 0x3a1810);
    // The rails along its sides, under the cover.
    for (const e of [-1, 1]) p.box(b, e * (a - 0.014), e * (a + 0.002), -0.36, 0.36, 0.055, 0.1, MAHOGANY);
    // The cover over it (down its sides), the sheet turned down over that and up under the pillows, the pillows.
    b.finish(F_FABRIC, 0);
    p.soft(b, -a - 0.008, a + 0.008, -0.2, 0.354, 0.075, 0.178, 0.022, cover, 1, false);
    b.finish(F_LINEN, 0);
    p.soft(b, -a - 0.006, a + 0.006, -0.356, -0.188, 0.082, 0.184, 0.014, LINEN, 1, false);
    const pillows = a > 0.2 ? [-a * 0.5, a * 0.5] : [0];
    const width = a > 0.2 ? a * 0.44 : a * 0.84;
    for (const c of pillows) p.soft(b, c - width, c + width, -0.352, -0.24, 0.166, 0.232, 0.03, LINEN, 1, false);
}

/**
 * A lamp standing on something y high: a turned base, and a pleated shade that glows when it's lit. Its shade's middle
 * is at LAMP_Y; or on something higher than that (the reception's desk), just over its base.
 */
function lamp(ctx, p, a, f, y, lit, base = BRASS, glass = false) {
    const b = ctx.woodwork;
    const middle = y > LAMP_Y ? y + 0.075 : LAMP_Y;
    b.finish(F_GILT, 0.3);
    p.turned(b, a, f, y, [[0, 0], [0.028, 0], [0.03, 0.006], [0.014, 0.014], [0.022, 0.035], [0.026, 0.05], [0.016, 0.062], [0.006, 0.066], [0.004, middle - y - 0.02], [0, middle - y - 0.02]], 8, base);
    const fx = ctx.fittings;
    fx.light(0, 0, lit ? (glass ? 1.2 : 1.35) : 0);
    const color = glass ? 0x2e6a3a : SHADE;
    const bottom = middle - 0.03;
    const shade = glass ? [[0.056, 0], [0.05, 0.02], [0.036, 0.04], [0.02, 0.05]] : [[0.058, 0], [0.052, 0.02], [0.046, 0.04], [0.04, 0.06]];
    p.turned(fx, a, f, bottom, shade, 12, color);
    fx.light(0, 0, lit ? 2.2 : 0);
    p.turned(fx, a, f, bottom, shade.map(([r, t]) => [r - 0.0015, t]), 12, glass ? 0xf0e0b0 : 0xffe8c0, true);
    fx.light(0, 0, 0);
    if (lit) {
        const [gx, gy, gz] = p.at(a, f, middle);
        ctx.glows.spot(gx, gy, gz, 0.34, -20, 0.5, 0.9);
    }
}

/** A knob, turned, on a face that faces out of the frame's front (dir 1) at (a, f, y). */
function knob(b, p, a, f, y, r, color, dir = 1) {
    b.finish(F_GILT, 0.3);
    p.forward(b, a, f, y, [[r * 0.6, 0], [r * 0.45, r * 0.8], [r, r * 1.4], [r * 0.6, r * 2], [0, r * 2.1]], 5, color, dir);
}

/** A moulded frame (four strips) standing off a face at f0 (out to f1), round a rectangle of the frame's front. */
function moulding(b, p, a0, a1, y0, y1, f0, f1, w, color) {
    p.box(b, a0, a1, f0, f1, y0, y0 + w, color);
    p.box(b, a0, a1, f0, f1, y1 - w, y1, color);
    p.box(b, a0, a0 + w, f0, f1, y0 + w, y1 - w, color);
    p.box(b, a1 - w, a1, f0, f1, y0 + w, y1 - w, color);
}

/** A nightstand on tapered legs: a drawer, a cupboard under it, its top moulded; and a lamp on it. */
function nightstand(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.4);
    for (const e of [-1, 1]) for (const g of [-1, 1]) p.turned(b, e * 0.059, g * 0.048 - 0.002, 0, [[0.006, 0], [0.007, 0.014], [0.009, 0.04], [0.0095, 0.05]], 5, MAHOGANY);
    b.finish(p.across, 0.4);
    p.box(b, -0.07, 0.07, -0.062, 0.058, 0.05, 0.188, MAHOGANY);
    p.box(b, -0.079, 0.079, -0.071, 0.07, 0.186, 0.2, MAHOGANY, 0.004);
    p.box(b, -0.062, 0.062, 0.058, 0.06, 0.142, 0.18, 0x3e1a10);
    p.box(b, -0.062, 0.062, 0.058, 0.0595, 0.058, 0.136, 0x3e1a10);
    moulding(b, p, -0.052, 0.052, 0.068, 0.126, 0.0595, 0.0625, 0.006, DARK_WOOD);
    knob(b, p, 0, 0.06, 0.161, 0.005, BRASS);
    knob(b, p, 0.04, 0.0625, 0.097, 0.004, BRASS);
    lamp(ctx, p, 0, -0.005, 0.2, piece.lit === true);
}

/**
 * A wardrobe on bracket feet: two panelled doors between pilasters, under a stepped cornice with an arched pediment
 * and an urn on it.
 */
function wardrobe(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.6);
    for (const e of [-1, 1]) for (const g of [-1, 1]) p.box(b, e * 0.168, e * 0.196, g * 0.072, g * 0.102, 0, 0.036, DARK_WOOD);
    b.finish(p.across, 0.6);
    p.box(b, -0.194, 0.194, -0.1, 0.1, 0.034, 0.06, DARK_WOOD);
    b.finish(F_WOOD_Y, 0.6);
    p.box(b, -0.186, 0.186, -0.098, 0.092, 0.06, 0.72, MAHOGANY);
    for (const e of [-1, 1]) p.box(b, e * 0.176, e * 0.192, 0.092, 0.098, 0.06, 0.72, 0x3a1a10);
    b.finish(p.across, 0.6);
    p.box(b, -0.192, 0.192, -0.1, 0.098, 0.72, 0.73, 0x3a1a10);
    p.box(b, -0.197, 0.197, -0.104, 0.103, 0.728, 0.745, MAHOGANY, 0.005);
    p.box(b, -0.2, 0.2, -0.108, 0.108, 0.745, 0.758, 0x3a1a10);
    shapedPanel(b, p, -0.13, 0.13, 0.084, 0.096, 0.758, (s) => 0.758 + 0.042 * (1 - (s / 0.13) ** 2), 10, MAHOGANY);
    b.finish(F_GILT, 0.3);
    p.turned(b, 0, 0.09, 0.799, [[0, 0], [0.008, 0], [0.014, 0.012], [0.01, 0.024], [0.004, 0.028], [0.006, 0.034], [0, 0.036]], 8, GILT);
    b.finish(F_WOOD_Y, 0.6);
    for (const e of [-1, 1]) {
        const [a0, a1] = e < 0 ? [-0.172, -0.003] : [0.003, 0.172];
        p.box(b, a0, a1, 0.092, 0.096, 0.075, 0.705, MAHOGANY);
        for (const [y0, y1] of [[0.1, 0.37], [0.41, 0.68]]) {
            moulding(b, p, a0 + 0.012, a1 - 0.012, y0, y1, 0.096, 0.1, 0.008, DARK_WOOD);
            p.box(b, a0 + 0.024, a1 - 0.024, 0.096, 0.099, y0 + 0.012, y1 - 0.012, 0x3e1c10);
        }
        knob(b, p, e * 0.016, 0.096, 0.39, 0.006, BRASS);
    }
    b.finish(F_PAINT, 0);
    p.box(b, 0.028, 0.034, 0.096, 0.097, 0.374, 0.386, 0x100806);
}

/**
 * A wingback armchair in velvet: cabriole legs at the front, a seat cushion on the upholstered frame, the back with its
 * top rolled over in a curve, rolled arms, and the wings over them sweeping back into it.
 */
function armchair(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const velvet = VELVETS[(piece.variant >>> 4) % VELVETS.length];
    b.finish(F_WOOD_Y, 0.5);
    for (const e of [-1, 1]) {
        cabriole(b, p, e * 0.108, 0.108, 0.065, e, 1, MAHOGANY);
        p.tube(b, [[e * 0.108, -0.108, 0.065], [e * 0.116, -0.124, 0]], [0.011, 0.008], 5, MAHOGANY);
    }
    b.finish(F_FABRIC, 0);
    p.soft(b, -0.135, 0.135, -0.105, 0.14, 0.06, 0.135, 0.016, velvet);
    p.soft(b, -0.106, 0.106, -0.095, 0.146, 0.128, 0.172, 0.02, velvet, 2, false);
    p.soft(b, -0.12, 0.12, -0.148, -0.095, 0.12, 0.4, 0.022, velvet);
    const crest = [];
    for (let k = 0; k <= 8; k++) {
        const a = -0.112 + (0.224 * k) / 8;
        crest.push([a, -0.121, 0.392 + 0.04 * (1 - (a / 0.112) ** 2)]);
    }
    p.tube(b, crest, 0.026, 8, velvet);
    for (const e of [-1, 1]) {
        p.soft(b, e * 0.104, e * 0.136, -0.1, 0.13, 0.12, 0.226, 0.012, velvet);
        p.tube(b, [[e * 0.124, -0.098, 0.232], [e * 0.125, 0.132, 0.232]], 0.02, 8, velvet);
        p.forward(b, e * 0.125, 0.132, 0.232, [[0, 0], [0.021, 0], [0.021, 0.004], [0.012, 0.007], [0, 0.007]], 10, velvet);
        p.soft(b, e * 0.11, e * 0.134, -0.142, -0.03, 0.22, 0.39, 0.012, velvet);
        p.tube(b, curve([e * 0.122, -0.028, 0.232], [e * 0.123, -0.03, 0.4], [e * 0.116, -0.11, 0.405], 6), 0.014, 6, velvet);
    }
}

/**
 * A chesterfield: buttoned leather, its back and its arms one height and rolled over, loose seat cushions, bun feet.
 */
function sofa(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(p.across, 0.4);
    for (const e of [-1, 1]) for (const f of [-0.11, 0.11]) p.turned(b, e * 0.34, f, 0, [[0, 0], [0.018, 0], [0.022, 0.014], [0.02, 0.028], [0.014, 0.036], [0, 0.036]], 8, DARK_WOOD);
    b.finish(F_FABRIC, 0.3);
    p.soft(b, -0.336, 0.336, -0.14, 0.14, 0.034, 0.15, 0.02, LEATHER);
    for (let k = -1; k <= 1; k++) p.soft(b, k * 0.2 - 0.098, k * 0.2 + 0.098, -0.085, 0.148, 0.145, 0.19, 0.022, 0x541c14, 2, false);
    p.soft(b, -0.336, 0.336, -0.152, -0.085, 0.13, 0.29, 0.02, LEATHER);
    p.tube(b, [[-0.336, -0.117, 0.296], [0.336, -0.117, 0.296]], 0.036, 10, LEATHER);
    for (const e of [-1, 1]) {
        p.soft(b, e * 0.332, e * 0.372, -0.15, 0.14, 0.034, 0.255, 0.018, LEATHER);
        p.tube(b, [[e * 0.368, -0.132, 0.262], [e * 0.368, 0.126, 0.262]], 0.036, 10, LEATHER);
        p.forward(b, e * 0.368, 0.126, 0.262, [[0, 0], [0.037, 0], [0.037, 0.003], [0.026, 0.006], [0, 0.006]], 12, LEATHER);
    }
    // The buttons, deep in the back.
    b.finish(F_FABRIC, 0);
    for (let k = -3; k <= 3; k++) {
        for (const [y, shift] of [[0.2, 0], [0.25, 0.042]]) {
            if (shift && k === 3) continue;
            p.forward(b, k * 0.085 + shift, -0.086, y, [[0, 0], [0.006, 0], [0.004, 0.004], [0, 0.005]], 5, 0x2a0c08);
        }
    }
}

/** A round lamp table on a pedestal and three feet, the lamp on it lit or not. */
function sideTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.7);
    p.turned(b, 0, 0, 0.02, [[0, 0], [0.024, 0], [0.018, 0.02], [0.014, 0.08], [0.02, 0.14], [0.012, 0.18], [0.012, 0.195], [0, 0.195]], 10, MAHOGANY);
    for (let k = 0; k < 3; k++) {
        const angle = (k / 3) * Math.PI * 2 + 0.5;
        const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
        p.tube(b, [[ca * 0.012, sa * 0.012, 0.05], [ca * 0.045, sa * 0.045, 0.02], [ca * 0.07, sa * 0.07, 0.004]], [0.008, 0.007, 0.006], 5, MAHOGANY);
    }
    b.finish(p.across, 0.7);
    p.turned(b, 0, 0, 0.212, [[0, 0], [0.088, 0], [0.09, 0.006], [0.088, 0.012], [0, 0.012]], 16, MAHOGANY);
    lamp(ctx, p, 0, 0, 0.224, piece.lit === true);
}

/** A low table in front of a sofa, on turned legs, a shelf under it; an ashtray and a book on it. */
function lowTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.8);
    for (const e of [-1, 1]) for (const f of [-0.068, 0.068]) turnedLeg(b, p, e * 0.138, f, 0.118, 0.009, MAHOGANY);
    b.finish(p.across, 0.8);
    p.box(b, -0.13, 0.13, -0.06, 0.06, 0.03, 0.036, MAHOGANY);
    p.box(b, -0.145, 0.145, -0.075, 0.075, 0.1, 0.118, DARK_WOOD);
    p.box(b, -0.16, 0.16, -0.09, 0.09, 0.116, 0.132, MAHOGANY, 0.005);
    b.finish(F_GLASS, 0);
    p.turned(b, 0.07, 0.01, 0.132, [[0, 0], [0.028, 0], [0.03, 0.012], [0.022, 0.012], [0.02, 0.006], [0, 0.006]], 10, 0x6a8a84);
    b.finish(F_FABRIC, 0);
    p.box(b, -0.1, -0.02, -0.04, 0.05, 0.132, 0.148, 0x2a1a3a);
    p.box(b, -0.097, -0.023, -0.037, 0.047, 0.148, 0.15, 0xd8cfb0);
}

/** A rug on the floor under a lounge. */
function rug(ctx, piece) {
    const p = frame(ctx, piece);
    const [a, d] = furnitureHalf(piece);
    const rect = HOTEL_ATLAS.rugs[piece.variant % HOTEL_ATLAS.rugs.length];
    // The picture's long way across the rug.
    face4(ctx.paint, [p.at(-a, -d, 0.003), p.at(a, -d, 0.003), p.at(a, d, 0.003), p.at(-a, d, 0.003)], [0, 1, 0], 0xffffff, atlasUv(rect));
}

/**
 * A writing desk against the wall on cabriole legs: a drawer, a gallery of pigeonholes at the back, a blotter, the ink,
 * a crystal vase with one flower in it, gone over; its chair in front.
 */
function writingDesk(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.1);
    for (const e of [-1, 1]) {
        cabriole(b, p, e * 0.19, -0.172, 0.2, e, -1, MAHOGANY, 0.01);
        cabriole(b, p, e * 0.19, -0.078, 0.2, e, 1, MAHOGANY, 0.01);
    }
    b.finish(p.across, 0.1);
    p.box(b, -0.2, 0.2, -0.19, -0.064, 0.2, 0.258, MAHOGANY);
    p.box(b, -0.12, 0.12, -0.064, -0.06, 0.208, 0.25, 0x3e1a10);
    for (const e of [-1, 1]) knob(b, p, e * 0.07, -0.06, 0.229, 0.004, BRASS);
    p.box(b, -0.22, 0.22, -0.2, -0.05, 0.256, 0.27, MAHOGANY, 0.005);
    // The gallery: pigeonholes, dark inside, under a cap.
    p.box(b, -0.2, 0.2, -0.2, -0.166, 0.27, 0.35, 0x1a0c06);
    b.finish(F_WOOD_Y, 0.1);
    for (const a of [-0.192, -0.1, 0, 0.1, 0.192]) p.box(b, a - 0.004, a + 0.004, -0.166, -0.162, 0.27, 0.35, MAHOGANY);
    p.box(b, -0.196, 0.196, -0.166, -0.162, 0.306, 0.312, MAHOGANY);
    p.box(b, -0.206, 0.206, -0.2, -0.158, 0.35, 0.36, MAHOGANY, 0.003);
    // A blotter, a letter on it, the inkwell and its pen.
    b.finish(F_FABRIC, 0);
    p.box(b, -0.08, 0.08, -0.14, -0.07, 0.27, 0.272, 0x1e3020);
    b.finish(F_LINEN, 0);
    p.box(b, -0.04, 0.05, -0.13, -0.08, 0.272, 0.2728, 0xe8e0c8);
    b.finish(F_GLASS, 0);
    p.turned(b, -0.15, -0.12, 0.27, [[0, 0], [0.016, 0], [0.016, 0.014], [0.006, 0.02], [0.006, 0.026], [0, 0.026]], 8, 0x1a1a20);
    b.finish(F_PAINT, 0);
    p.rod(b, [-0.15, -0.12, 0.29], [-0.13, -0.105, 0.33], 0.002, 0x1a1a1a, 4);
    b.finish(F_GLASS, 0);
    p.turned(b, 0.14, -0.12, 0.27, [[0, 0], [0.012, 0], [0.008, 0.02], [0.004, 0.05], [0.007, 0.07], [0, 0.07]], 8, GLASS);
    b.finish(F_PAINT, 0);
    p.rod(b, [0.14, -0.12, 0.33], [0.155, -0.1, 0.38], 0.0015, 0x3a4a22, 4);
    p.rod(b, [0.155, -0.1, 0.38], [0.17, -0.07, 0.35], 0.0015, 0x3a4a22, 4);
    p.turned(b, 0.17, -0.07, 0.338, [[0, 0], [0.01, 0.006], [0.008, 0.012], [0, 0.014]], 5, 0x5a1a20);
    // (Facing the desk, its back to the room.)
    chair(ctx, within(ctx, piece, 0, 0.09, 0, -1), { wood: MAHOGANY, pad: VELVETS[piece.variant % VELVETS.length], finish: 'wood', splat: true });
}

// ---------------------------------------------------------------------------------------------- the lobbies

/**
 * The reception: a long desk of panelled walnut between pilasters, under a top of dark marble, a bell and the register
 * on it, a green-shaded lamp at one end; and on the wall behind it, the rack of pigeonholes, a key hung under each.
 */
function reception(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(p.across, 0.3);
    p.box(b, -0.558, 0.558, -0.106, 0.1, 0, 0.032, 0x24130a);
    p.box(b, -0.55, 0.55, -0.1, 0.092, 0.032, 0.4, WALNUT);
    p.box(b, -0.552, 0.552, 0.088, 0.097, 0.378, 0.398, 0x3a1e10);
    b.finish(F_WOOD_Y, 0.3);
    for (let k = -3; k <= 3; k++) {
        const [a0, a1] = [k * 0.15 - 0.058, k * 0.15 + 0.058];
        moulding(b, p, a0, a1, 0.06, 0.35, 0.092, 0.097, 0.009, 0x3a1e10);
        p.soft(b, a0 + 0.018, a1 - 0.018, 0.092, 0.096, 0.078, 0.332, 0.003, 0x4a2412);
    }
    for (let k = -3; k <= 4; k++) {
        const a = k * 0.15 - 0.075;
        p.box(b, a - 0.012, a + 0.012, 0.092, 0.1, 0.032, 0.378, 0x2a160a);
        b.finish(F_GILT, 0.4);
        p.box(b, a - 0.014, a + 0.014, 0.0935, 0.102, 0.358, 0.372, GILT);
        b.finish(F_WOOD_Y, 0.3);
    }
    b.finish(F_VEINED, 0.7);
    p.soft(b, -0.575, 0.575, -0.12, 0.125, 0.4, 0.425, 0.006, DARK_MARBLE);
    // The bell.
    b.finish(F_GILT, 0.8);
    p.turned(b, 0.2, 0.05, 0.425, [[0, 0], [0.022, 0], [0.022, 0.004], [0.02, 0.012], [0.012, 0.022], [0.004, 0.026], [0.003, 0.032], [0, 0.034]], 12, BRASS);
    // The register, open on its cover, and a pen.
    b.finish(F_FABRIC, 0);
    p.box(b, -0.105, 0.105, -0.035, 0.095, 0.425, 0.4275, 0x3a1010);
    b.finish(F_LINEN, 0);
    p.box(b, -0.1, 0.1, -0.03, 0.09, 0.4275, 0.431, 0xe8e0c8);
    b.finish(F_PAINT, 0);
    p.rod(b, [0.02, 0.02, 0.4315], [0.08, 0.05, 0.4325], 0.002, 0x101010, 4);
    lamp(ctx, p, -0.4, -0.02, 0.425, piece.lit === true, BRASS, true);
    // The key rack, on the wall behind, on a ledge, under a cornice.
    const wall = -0.3;
    b.finish(F_WOOD_Y, 0.3);
    p.box(b, -0.42, 0.42, wall, wall + 0.025, 0.46, 0.84, 0x2a170c);
    b.finish(p.across, 0.3);
    p.soft(b, -0.435, 0.435, wall, wall + 0.034, 0.445, 0.462, 0.004, WALNUT);
    p.soft(b, -0.435, 0.435, wall, wall + 0.034, 0.838, 0.856, 0.004, WALNUT);
    const [ax, ay, az] = p.at(-0.4, wall + 0.0255, 0.48);
    const [bx, , bz] = p.at(0.4, wall + 0.0255, 0.48);
    const n = [piece.dx, 0, piece.dz];
    face4(ctx.paint, [[ax, ay, az], [bx, ay, bz], [bx, 0.82, bz], [ax, 0.82, az]], n, 0xffffff, atlasUv(HOTEL_ATLAS.keys));
    // Its plate, on the front of the desk.
    face4(ctx.paint, [p.at(0.09, 0.0975, 0.382), p.at(-0.09, 0.0975, 0.382), p.at(-0.09, 0.0975, 0.396), p.at(0.09, 0.0975, 0.396)], n, 0xffffff, atlasUv(HOTEL_ATLAS.reception));
}

/**
 * A long-case clock: its feet, its base, the trunk with a glass door on the pendulum, its hood between two columns
 * under an arched pediment and finials, and the face (which goes backwards).
 */
function clock(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.9);
    for (const e of [-1, 1]) for (const g of [-1, 1]) p.turned(b, e * 0.085, g * 0.052, 0, [[0, 0], [0.012, 0], [0.015, 0.008], [0.011, 0.016], [0, 0.016]], 6, DARK_WOOD);
    p.box(b, -0.1, 0.1, -0.07, 0.07, 0.016, 0.18, MAHOGANY);
    b.finish(p.across, 0.9);
    p.box(b, -0.106, 0.106, -0.074, 0.074, 0.176, 0.2, MAHOGANY, 0.005);
    b.finish(F_WOOD_Y, 0.9);
    p.box(b, -0.078, 0.078, -0.06, 0.055, 0.2, 0.57, MAHOGANY);
    moulding(b, p, -0.05, 0.05, 0.24, 0.54, 0.055, 0.059, 0.008, 0x3a1810);
    p.box(b, -0.1, 0.1, -0.07, 0.07, 0.566, 0.585, MAHOGANY, 0.004);
    p.box(b, -0.094, 0.094, -0.066, 0.062, 0.585, 0.8, MAHOGANY);
    for (const e of [-1, 1]) {
        b.finish(F_GILT, 0.5);
        p.turned(b, e * 0.085, 0.066, 0.585, [[0.008, 0], [0.008, 0.01], [0.0055, 0.016], [0.0055, 0.194], [0.008, 0.201], [0.008, 0.212], [0, 0.212]], 6, GILT);
    }
    b.finish(p.across, 0.9);
    p.box(b, -0.108, 0.108, -0.074, 0.074, 0.8, 0.816, 0x3a1810, 0.004);
    shapedPanel(b, p, -0.098, 0.098, 0.05, 0.064, 0.816, (s) => 0.816 + 0.04 * Math.sqrt(Math.max(0, 1 - (s / 0.098) ** 2)), 10, MAHOGANY);
    b.finish(F_GILT, 0.6);
    for (const [a, y] of [[-0.09, 0.816], [0.09, 0.816], [0, 0.856]]) p.turned(b, a, 0.057, y, [[0, 0], [0.007, 0], [0.01, 0.01], [0.004, 0.018], [0.006, 0.022], [0, 0.03]], 6, GILT);
    // The pendulum's window, dark glass, and the brass bob showing through it.
    b.finish(F_GLASS, 0);
    p.box(b, -0.04, 0.04, 0.055, 0.058, 0.26, 0.52, 0x14100c);
    b.finish(F_GILT, 0.8);
    const [bx, by, bz] = p.at(0, 0.058, 0.33);
    turned(b, bx, by, bz, piece.dx, 0, piece.dz, [[0, 0], [0.024, 0.0005], [0.024, 0.0025], [0, 0.0035]], 12, BRASS);
    // The face.
    const [fx, fy, fz] = p.at(0, 0.0635, 0.69);
    const r = 0.068;
    const [rx, rz] = p.right;
    const corners = [[fx - rx * r, fy - r, fz - rz * r], [fx + rx * r, fy - r, fz + rz * r], [fx + rx * r, fy + r, fz + rz * r], [fx - rx * r, fy + r, fz - rz * r]];
    const seed = ((piece.variant >>> 7) & 255) / 255;
    face4(ctx.dials, corners, [piece.dx, 0, piece.dz], 0xff0000 | (Math.round(seed * 255) << 8), [0, 0, 1, 1]);
}

/**
 * A grand piano: its case, black and glossy, its lid propped open on its stick, the keyboard and the music desk, on
 * three turned legs; its stool in front.
 */
function piano(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    // The case's outline, from above: keyboard end at the front (+f), curving in to the tail at the back.
    const outline = [[-0.26, 0.2], [0.26, 0.2], [0.26, -0.12], [0.2, -0.26], [0.06, -0.33], [-0.08, -0.33], [-0.14, -0.26], [-0.18, -0.12], [-0.26, -0.02]];
    const y0 = 0.2;
    const y1 = 0.28;
    b.finish(F_GLASS, 0.3);
    prismUp(ctx, p, outline, y0, y1, EBONY);
    // The lid, hinged along its straight side, propped up.
    const angle = 0.55;
    const lift = (a, f) => {
        const d = 0.26 - a;
        return p.at(0.26 - d * Math.cos(angle), f, y1 + 0.004 + d * Math.sin(angle));
    };
    const top = outline.map(([a, f]) => lift(a, f));
    fan(b, top, EBONY, 1);
    fan(b, top, EBONY, -1);
    b.finish(F_PAINT, 0);
    // The stick, up to the lid (its end just under it, where the lid's lowest over it).
    const stick = -0.12;
    p.rod(b, [stick, -0.05, y1], [stick, -0.05, y1 + 0.004 + (0.26 - stick - 0.004) * Math.tan(angle)], 0.004, EBONY, 4);
    // The keyboard: the white keys, the black, the key slip under them.
    b.finish(F_PAINT, 0);
    p.box(b, -0.25, 0.25, 0.2, 0.3, 0.18, 0.24, EBONY);
    p.box(b, -0.24, 0.24, 0.2, 0.29, 0.24, 0.252, IVORY);
    // (A black key after every white one but the third and the seventh of each octave.)
    for (let k = 0; k < 19; k++) {
        if (k % 7 === 2 || k % 7 === 6) continue;
        const a = -0.24 + (k + 1) * 0.024;
        p.box(b, a - 0.005, a + 0.005, 0.2, 0.25, 0.252, 0.262, 0x101010);
    }
    // The music desk, under the lid.
    p.box(b, -0.14, 0.14, 0.17, 0.18, 0.28, 0.35, EBONY);
    // Legs, and the stool.
    b.finish(F_GLASS, 0.3);
    for (const [a, f] of [[-0.22, 0.14], [0.22, 0.14], [0.02, -0.26]]) p.turned(b, a, f, 0, [[0, 0], [0.02, 0], [0.026, 0.012], [0.02, 0.03], [0.016, 0.1], [0.022, 0.15], [0.028, 0.19], [0.028, 0.2], [0, 0.2]], 8, EBONY);
    for (const e of [-1, 1]) for (const f of [0.28, 0.33]) turnedLeg(b, p, e * 0.1, f, 0.15, 0.008, EBONY);
    b.finish(F_FABRIC, 0);
    p.soft(b, -0.115, 0.115, 0.265, 0.34, 0.148, 0.178, 0.01, 0x2a0c0e);
}

/** An outline (in a piece's frame) stood up from y0 to y1: its sides, and its top. Out from (ma, mf). */
function prismUp(ctx, p, outline, y0, y1, color, ma = 0, mf = -0.06) {
    const b = ctx.woodwork;
    for (let k = 0; k < outline.length; k++) {
        const [a0, f0] = outline[k];
        const [a1, f1] = outline[(k + 1) % outline.length];
        const [x0, , z0] = p.at(a0, f0, 0);
        const [x1, , z1] = p.at(a1, f1, 0);
        // Out from the middle of the outline.
        const [mx, , mz] = p.at(ma, mf, 0);
        let nx = z1 - z0;
        let nz = x0 - x1;
        const length = Math.hypot(nx, nz) || 1;
        nx /= length;
        nz /= length;
        if (nx * ((x0 + x1) / 2 - mx) + nz * ((z0 + z1) / 2 - mz) < 0) {
            nx = -nx;
            nz = -nz;
        }
        face4(b, [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], [nx, 0, nz], color);
    }
    fan(b, outline.map(([a, f]) => p.at(a, f, y1)), color, 1);
}

/** A flat polygon (convex, its corners in order round it) facing up (1) or down (−1), as it's tilted. */
function fan(b, corners, color, up) {
    const [a, c1, c2] = corners;
    const u = [c1[0] - a[0], c1[1] - a[1], c1[2] - a[2]];
    const v = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n) || 1;
    n = n.map((c) => c / length);
    const flip = (n[1] >= 0) === (up > 0) ? 1 : -1;
    const normal = n.map((c) => c * flip);
    const first = b.vertexCount;
    for (const [x, y, z] of corners) b.vertex(x, y, z, normal[0], normal[1], normal[2], 0, 0, color);
    for (let k = 1; k + 1 < corners.length; k++) {
        if (flip > 0) b.triangle(first, first + k, first + k + 1);
        else b.triangle(first, first + k + 1, first + k);
    }
}

/**
 * Branches of blossom standing up out of a vase at (a, f), from height y, `reach` long at most, arching out: all of one
 * colour, white or pink, from the variant, the flowers in twos and threes along them. `spread` keeps them nearer upright
 * front to back (against a wall).
 */
function blossom(b, p, a, f, y, variant, reach, count, spread = 1) {
    b.finish(F_PAINT, 0);
    const next = stream(variant);
    const color = (variant >>> 5) & 1 ? 0xe8e0e8 : 0xc86a8a;
    for (let k = 0; k < count; k++) {
        const angle = next() * Math.PI * 2;
        const lean = 0.25 + next() * 0.3;
        const length = reach * (0.6 + next() * 0.4);
        const [ox, oz] = [Math.cos(angle) * lean * length, Math.sin(angle) * lean * length * spread];
        // (Bowed: out more in the middle than a straight line would be.)
        const bend = [a + ox * 0.3, f + oz * 0.3, y + length * 0.55];
        const tip = [a + ox, f + oz, y + length];
        const points = curve([a, f, y], bend, tip, 3);
        p.tube(b, points, [0.0028, 0.0024, 0.002, 0.0014], 3, 0x3a2a1c, false);
        for (let t = 0.35; t <= 1; t += 0.16) {
            const at = [0, 1, 2].map((i) => (1 - t) * (1 - t) * [a, f, y][i] + 2 * (1 - t) * t * bend[i] + t * t * tip[i]);
            for (let c = 0; c < 2; c++) {
                const s = 0.008 + next() * 0.007;
                const around = next() * Math.PI * 2;
                p.turned(b, at[0] + Math.cos(around) * s * 0.7, at[1] + Math.sin(around) * s * 0.7, at[2] - s * 0.6, [[0, 0], [s, s * 0.8], [0, s * 1.7]], 5, color);
            }
        }
    }
}

/** A round table on a pedestal and splayed feet, with a tall vase on it, branches and blossom standing up out of it. */
function centreTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.5);
    p.turned(b, 0, 0, 0, [[0, 0], [0.06, 0], [0.06, 0.016], [0.04, 0.03], [0.03, 0.08], [0.04, 0.16], [0.028, 0.228], [0, 0.228]], 12, MAHOGANY);
    for (let k = 0; k < 4; k++) {
        const angle = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
        p.tube(b, [[ca * 0.04, sa * 0.04, 0.05], [ca * 0.09, sa * 0.09, 0.03], [ca * 0.125, sa * 0.125, 0.008]], [0.013, 0.011, 0.009], 6, MAHOGANY);
    }
    b.finish(F_WOOD_X, 0.5);
    p.turned(b, 0, 0, 0.226, [[0, 0], [0.19, 0], [0.195, 0.008], [0.195, 0.014], [0.19, 0.022], [0, 0.022]], 24, MAHOGANY);
    b.finish(F_GLASS, 0.2);
    p.turned(b, 0, 0, 0.248, [[0, 0], [0.04, 0], [0.058, 0.03], [0.06, 0.07], [0.045, 0.11], [0.03, 0.13], [0.034, 0.145], [0, 0.145]], 14, 0x2e3a5a);
    blossom(b, p, 0, 0, 0.39, piece.variant, 0.29, 9);
}

// ---------------------------------------------------------------------------------------------- the ballroom

/** A place laid on a table at (a, f): a plate, a napkin folded up on it, a glass beside, turned to face out (oa, of). */
function place(b, p, a, f, oa, of) {
    b.finish(F_LINEN, 0);
    p.turned(b, a, f, 0.278, [[0, 0], [0.035, 0], [0.036, 0.004], [0, 0.004]], 12, 0xf2eee4);
    p.turned(b, a, f, 0.282, [[0.012, 0], [0.008, 0.012], [0.002, 0.03], [0, 0.03]], 4, LINEN);
    b.finish(F_GLASS, 0);
    p.turned(b, a - of * 0.045 - oa * 0.02, f + oa * 0.045 - of * 0.02, 0.278, [[0, 0], [0.012, 0], [0.002, 0.004], [0.002, 0.024], [0.012, 0.03], [0.014, 0.05], [0, 0.05]], 8, GLASS);
}

/**
 * A round table laid for dinner: its cloth to the floor, the places set, a candelabra in the middle never lit; its gilt
 * chairs round it, one or two pushed back as if someone had just stood up.
 */
function banquet(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const cloth = 0.29;
    b.finish(F_LINEN, 0);
    p.turned(b, 0, 0, 0, [[cloth, 0], [0.285, 0.1], [0.272, 0.24], [0.268, 0.27], [0.255, 0.278], [0, 0.278]], 24, LINEN);
    const places = 6;
    for (let k = 0; k < places; k++) {
        const angle = (k / places) * Math.PI * 2 + 0.3;
        const [ca, cf] = [Math.cos(angle), Math.sin(angle)];
        place(b, p, ca * 0.2, cf * 0.2, ca, cf);
        // A chair facing in (turned to the nearest quarter), its back to the room, its front clear of the cloth; now and
        // then one pushed back.
        const r = 0.37 + (((piece.variant >>> (k * 3)) & 7) === 0 ? 0.05 : 0);
        const alongA = Math.abs(ca) > Math.abs(cf);
        const out = Math.max(r * Math.max(Math.abs(ca), Math.abs(cf)), cloth + CHAIR_HALF + 0.004);
        const [a, f] = alongA ? [Math.sign(ca) * out, cf * r] : [ca * r, Math.sign(cf) * out];
        chair(ctx, within(ctx, piece, a, f, alongA ? -Math.sign(ca) : 0, alongA ? 0 : -Math.sign(cf)), GILT_CHAIR);
    }
    candelabra(ctx, p, 0, 0, 0.278, 3, false);
}

/**
 * A candelabra of silver standing at (a, f) on a table y high: its stem, and `arms` arms curving out and up round it to
 * a candle each (and one in the middle), their flames lit if `lit`.
 */
function candelabra(ctx, p, a, f, y, arms, lit) {
    const b = ctx.woodwork;
    b.finish(F_GILT, 0.6);
    p.turned(b, a, f, y, [[0, 0], [0.04, 0], [0.036, 0.008], [0.014, 0.018], [0.008, 0.04], [0.012, 0.07], [0.007, 0.1], [0.007, 0.16], [0, 0.16]], 10, SILVER);
    const tips = [[a, f, y + 0.16]];
    for (let k = 0; k < arms; k++) {
        const angle = (k / arms) * Math.PI * 2;
        const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
        const tip = [a + ca * 0.06, f + sa * 0.06, y + 0.14];
        p.tube(b, curve([a + ca * 0.004, f + sa * 0.004, y + 0.11], [a + ca * 0.06, f + sa * 0.06, y + 0.09], tip, 5), 0.003, 4, SILVER);
        tips.push(tip);
    }
    for (const [ta, tf, ty] of tips) {
        b.finish(F_GILT, 0.6);
        p.turned(b, ta, tf, ty, [[0, 0], [0.008, 0], [0.01, 0.006], [0.006, 0.01], [0, 0.01]], 6, SILVER);
        b.finish(F_PAINT, 0);
        p.turned(b, ta, tf, ty + 0.01, [[0.0055, 0], [0.0055, 0.055], [0, 0.056]], 6, CANDLE);
        if (!lit) continue;
        const fx = ctx.fittings;
        fx.light(0, 0, 2.4);
        p.turned(fx, ta, tf, ty + 0.066, [[0, 0], [0.005, 0.006], [0.004, 0.014], [0, 0.022]], 5, FLAME);
        fx.light(0, 0, 0);
        const [gx, gy, gz] = p.at(ta, tf, ty + 0.078);
        ctx.glows.spot(gx, gy, gz, 0.1, -20, 0.45, 1.2);
    }
}

/**
 * The Beverly Room's table: small, black lacquer and gilt; on it the drinks nobody finished, and the game of mahjong,
 * its walls of tiles and a hand laid out; four chairs round it.
 */
function beverlyTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_GLASS, 0.4);
    p.turned(b, 0, 0, 0, [[0, 0], [0.09, 0], [0.09, 0.012], [0.03, 0.03], [0.022, 0.24], [0, 0.24]], 12, EBONY);
    p.turned(b, 0, 0, 0.24, [[0, 0], [0.16, 0], [0.162, 0.018], [0, 0.018]], 24, EBONY);
    b.finish(F_GILT, 0.6);
    p.turned(b, 0, 0, 0.24, [[0.163, 0], [0.165, 0.009], [0.163, 0.018]], 24, GILT);
    // The walls of tiles, a square of them, and the tiles laid face up.
    b.finish(F_PAINT, 0);
    const top = 0.258;
    for (let side = 0; side < 4; side++) {
        for (let k = -4; k <= 4; k++) {
            const [a, f] = side === 0 ? [k * 0.011, -0.07] : side === 1 ? [0.07, k * 0.011] : side === 2 ? [-k * 0.011, 0.07] : [-0.07, -k * 0.011];
            const along = side % 2 === 0;
            const [ha, hf] = along ? [0.0048, 0.0036] : [0.0036, 0.0048];
            p.box(b, a - ha, a + ha, f - hf, f + hf, top, top + 0.012, IVORY);
            p.box(b, a - ha, a + ha, f - hf, f + hf, top + 0.012, top + 0.014, 0x2e5a3a);
            if ((k + side) % 3 === 0) p.box(b, a - ha, a + ha, f - hf, f + hf, top + 0.014, top + 0.026, IVORY);
        }
    }
    for (let k = -3; k <= 3; k++) p.box(b, k * 0.012 - 0.005, k * 0.012 + 0.005, 0.1, 0.108, top, top + 0.004, IVORY);
    // The drinks: two coupes, a tumbler, the bottle.
    b.finish(F_GLASS, 0);
    for (const [a, f] of [[0.1, -0.1], [-0.11, 0.08]]) {
        p.turned(b, a, f, top, [[0, 0], [0.012, 0], [0.002, 0.004], [0.002, 0.03], [0.018, 0.034], [0.022, 0.044], [0, 0.044]], 10, GLASS);
        p.turned(b, a, f, top + 0.034, [[0, 0], [0.016, 0], [0.019, 0.007], [0, 0.007]], 10, 0xb8742a);
    }
    p.turned(b, -0.1, -0.1, top, [[0, 0], [0.014, 0], [0.015, 0.03], [0, 0.03]], 10, GLASS);
    p.turned(b, -0.12, 0.02, top, [[0, 0], [0.018, 0], [0.018, 0.07], [0.008, 0.09], [0.006, 0.11], [0, 0.11]], 10, 0x2a1a10);
    for (const [a, f, fa, ff] of [[0, -0.27, 0, 1], [0, 0.27, 0, -1], [-0.27, 0, 1, 0], [0.27, 0, -1, 0]]) chair(ctx, within(ctx, piece, a, f, fa, ff), LACQUER_CHAIR);
}

/**
 * The long table the lore has in the Beverly Room: its cloth to the floor, a red runner down it, places laid all the
 * way along, two candelabras, lit if its lamp is; gilt chairs down both sides and at the ends, some pushed back.
 */
function longTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.4);
    for (const e of [-1, 1]) for (const f of [-0.76, 0, 0.76]) p.turned(b, e * 0.13, f, 0, [[0, 0], [0.012, 0], [0.016, 0.02], [0.013, 0.05], [0.016, 0.08], [0, 0.08]], 6, MAHOGANY);
    b.finish(F_LINEN, 0);
    p.soft(b, -0.165, 0.165, -0.82, 0.82, 0.07, 0.278, 0.012, LINEN, 1, false);
    b.finish(F_FABRIC, 0);
    p.box(b, -0.05, 0.05, -0.66, 0.66, 0.278, 0.2795, 0x6a1216);
    for (const e of [-1, 1]) {
        for (let k = -2; k <= 2; k++) {
            const f = k * 0.32;
            place(b, p, e * 0.105, f, e, 0);
            const back = ((piece.variant >>> ((k + 2) * 2 + (e > 0 ? 10 : 0))) & 3) === 0 ? 0.03 : 0;
            chair(ctx, within(ctx, piece, e * (0.247 + back), f, -e, 0), GILT_CHAIR);
        }
        place(b, p, 0, e * 0.76, 0, e);
        chair(ctx, within(ctx, piece, 0, e * 0.902, 0, -e), GILT_CHAIR);
    }
    for (const f of [-0.4, 0.4]) candelabra(ctx, p, 0, f, 0.2795, 4, piece.lit === true);
}

/** A music desk on the bandstand at (a, f), facing out: its front with the band's monogram, the music, its lamp. */
function musicDesk(ctx, p, a, f, lit) {
    const b = ctx.woodwork;
    b.finish(F_GLASS, 0.3);
    p.box(b, a - 0.075, a + 0.075, f - 0.008, f, 0.06, 0.27, EBONY);
    b.finish(F_GILT, 0.4);
    moulding(b, p, a - 0.075, a + 0.075, 0.06, 0.27, f, f + 0.003, 0.006, GILT);
    wallPictureOn(ctx, p, a, f + 0.0032, 0.165, 0.058, 0.08, HOTEL_ATLAS.orchestra);
    // The desk on top, tilted back, and the music on it.
    b.finish(F_GLASS, 0.3);
    const [y0, y1] = [0.27, 0.31];
    face4(b, [p.at(a - 0.075, f, y0), p.at(a + 0.075, f, y0), p.at(a + 0.075, f - 0.05, y1), p.at(a - 0.075, f - 0.05, y1)], normalIn(p, 0.05, 0.04), EBONY);
    b.finish(F_LINEN, 0);
    face4(b, [p.at(a - 0.05, f - 0.012, y0 + 0.012), p.at(a + 0.05, f - 0.012, y0 + 0.012), p.at(a + 0.05, f - 0.046, y1 + 0.004), p.at(a - 0.05, f - 0.046, y1 + 0.004)], normalIn(p, 0.05, 0.04), 0xe8e0c8);
    // Its lamp: a brass hood on a stalk from the back of the desk, over the music, lit underneath.
    b.finish(F_GILT, 0.4);
    const hood = [f - 0.028, y1 + 0.05];
    p.rod(b, [a, f - 0.05, y1], [a, hood[0] - 0.01, hood[1]], 0.0025, BRASS, 4);
    p.sideways(b, a - 0.042, hood[0], hood[1], [[0, 0], [0.013, 0], [0.013, 0.084], [0, 0.084]], 8, BRASS);
    const fx = ctx.fittings;
    fx.light(0, 0, lit ? 2.4 : 0);
    face4(fx, [p.at(a - 0.04, hood[0] - 0.009, hood[1] - 0.0132), p.at(a + 0.04, hood[0] - 0.009, hood[1] - 0.0132), p.at(a + 0.04, hood[0] + 0.009, hood[1] - 0.0132), p.at(a - 0.04, hood[0] + 0.009, hood[1] - 0.0132)], [0, -1, 0], FLAME);
    fx.light(0, 0, 0);
    if (lit) {
        const [gx, gy, gz] = p.at(a, hood[0], hood[1] - 0.02);
        ctx.glows.spot(gx, gy, gz, 0.16, -20, 0.5, 1.3);
    }
}

/** The way a face leaning back from a frame's front faces, going `back` for every `rise` up: turned into the world. */
function normalIn(p, back, rise) {
    const length = Math.hypot(back, rise);
    return [p.front[0] * (rise / length), back / length, p.front[1] * (rise / length)];
}

/** A picture from the paint atlas flat on a face out of a frame's front at f, centred on (a, y), half-size hw × hh. */
function wallPictureOn(ctx, p, a, f, y, hw, hh, rect) {
    const [u0, v0, u1, v1] = atlasUv(rect);
    // Left to right as you face it: along the frame's −a.
    face4(ctx.paint, [p.at(a + hw, f, y - hh), p.at(a - hw, f, y - hh), p.at(a - hw, f, y + hh), p.at(a + hw, f, y + hh)], [p.front[0], 0, p.front[1]], 0xffffff, [u0, v0, u1, v1]);
}

/**
 * The bandstand: a low stage, gilt along its edge and velvet down its front; the band's desks in two rows with their
 * lamps on and their chairs behind them, empty; the drums at the back, a double bass laid down, and the microphone at
 * the front. Its lamp (the light over it all) is its desks' lamps.
 */
function bandstand(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const lit = piece.lit === true;
    b.finish(p.along, 0.2);
    p.box(b, -0.9, 0.9, -0.5, 0.49, 0, 0.06, 0x3a1c10);
    b.finish(F_GILT, 0.5);
    p.soft(b, -0.906, 0.906, 0.482, 0.5, 0.048, 0.066, 0.005, GILT);
    b.finish(F_FABRIC, 0);
    p.box(b, -0.9, 0.9, 0.49, 0.496, 0.004, 0.048, 0x5a0e12);
    b.finish(p.along, 0.2);
    p.box(b, -0.16, 0.16, 0.496, 0.52, 0, 0.03, 0x3a1c10);
    // The desks, and their chairs behind them.
    for (const [a, f] of [[-0.6, 0.3], [-0.2, 0.3], [0.2, 0.3], [0.6, 0.3], [-0.62, -0.1], [-0.22, -0.1]]) {
        musicDesk(ctx, p, a, f, lit);
        chair(ctx, within(ctx, piece, a, f - 0.19, 0, 1), GILT_CHAIR);
    }
    // The drums: the bass drum on its side, a tom on it, the snare on its stand, a cymbal.
    const [da, df] = [0.5, -0.24];
    b.finish(F_GLASS, 0.3);
    p.forward(b, da, df - 0.06, 0.16, [[0, 0], [0.1, 0], [0.1, 0.12], [0, 0.12]], 18, 0x5a0e12);
    b.finish(F_GILT, 0.4);
    for (const d of [-0.06, 0.06]) p.forward(b, da, df + d - (d > 0 ? 0.006 : 0), 0.16, [[0.102, 0], [0.102, 0.006], [0.1, 0.006]], 18, SILVER);
    wallPictureOn(ctx, p, da, df + 0.0605, 0.16, 0.07, 0.07, HOTEL_ATLAS.drum);
    b.finish(F_GLASS, 0.3);
    p.turned(b, da + 0.02, df, 0.26, [[0, 0], [0.05, 0], [0.05, 0.05], [0, 0.05]], 14, 0x5a0e12);
    b.finish(F_GILT, 0.4);
    p.turned(b, da - 0.2, df + 0.1, 0.06, [[0, 0], [0.004, 0], [0.004, 0.16], [0, 0.16]], 5, SILVER);
    for (let k = 0; k < 3; k++) {
        const angle = (k / 3) * Math.PI * 2;
        p.rod(b, [da - 0.2, df + 0.1, 0.12], [da - 0.2 + Math.cos(angle) * 0.05, df + 0.1 + Math.sin(angle) * 0.05, 0.062], 0.003, SILVER, 4);
    }
    b.finish(F_GLASS, 0.3);
    p.turned(b, da - 0.2, df + 0.1, 0.22, [[0, 0], [0.055, 0], [0.055, 0.04], [0, 0.04]], 14, 0xe0dccc);
    b.finish(F_GILT, 0.6);
    p.turned(b, da + 0.2, df + 0.06, 0.06, [[0, 0], [0.004, 0], [0.004, 0.3], [0, 0.3]], 5, SILVER);
    p.turned(b, da + 0.2, df + 0.06, 0.36, [[0, 0], [0.08, 0.008], [0.006, 0.018], [0, 0.02]], 16, BRASS);
    // A double bass, laid down on its side.
    b.finish(F_GLASS, 0.5);
    const [ba, bf] = [-0.8, -0.3];
    p.turned(b, ba, bf, 0.06, [[0, 0], [0.09, 0], [0.09, 0.05], [0, 0.05]], 16, 0x6a2e12);
    p.turned(b, ba, bf + 0.14, 0.06, [[0, 0], [0.07, 0], [0.07, 0.05], [0, 0.05]], 16, 0x6a2e12);
    p.box(b, ba - 0.012, ba + 0.012, bf + 0.2, bf + 0.46, 0.09, 0.105, EBONY);
    p.sideways(b, ba, bf + 0.46, 0.1, [[0, -0.018], [0.014, -0.012], [0.016, 0], [0.014, 0.012], [0, 0.018]], 8, 0x6a2e12);
    // The microphone at the front: a heavy base, the stand, and the mike in its ring.
    b.finish(F_GILT, 0.5);
    const [ma, mf] = [0, 0.42];
    p.turned(b, ma, mf, 0.06, [[0, 0], [0.035, 0], [0.03, 0.01], [0.006, 0.018], [0.004, 0.44], [0, 0.44]], 12, SILVER);
    const ring = [];
    for (let k = 0; k <= 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        ring.push([ma + Math.cos(angle) * 0.045, mf, 0.55 + Math.sin(angle) * 0.045]);
    }
    p.tube(b, ring, 0.004, 5, SILVER, false);
    p.rod(b, [ma, mf, 0.5], [ma, mf, 0.505], 0.004, SILVER, 5);
    b.finish(F_GLASS, 0.4);
    p.soft(b, ma - 0.022, ma + 0.022, mf - 0.012, mf + 0.012, 0.525, 0.575, 0.01, 0x2a2a2a);
    b.finish(F_GILT, 0.5);
    for (const [ra, ry] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p.rod(b, [ma + ra * 0.022, mf, 0.55 + ry * 0.025], [ma + ra * 0.043, mf, 0.55 + ry * 0.043], 0.0012, SILVER, 3);
}

// ---------------------------------------------------------------------------------------------- the rest

/**
 * A bookcase against the wall: a plinth, open shelves full of books (some fallen over, gaps where some were taken), a
 * cornice; now and then a vase on a shelf instead.
 */
function bookcase(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const next = stream(piece.variant);
    b.finish(p.across, 0.5);
    p.box(b, -0.236, 0.236, -0.083, 0.08, 0, 0.04, DARK_WOOD);
    b.finish(F_WOOD_Y, 0.5);
    for (const e of [-1, 1]) p.box(b, e * 0.214, e * 0.232, -0.083, 0.074, 0.04, 0.76, MAHOGANY);
    p.box(b, -0.214, 0.214, -0.083, -0.076, 0.04, 0.748, 0x1c0e08);
    b.finish(p.across, 0.5);
    const shelves = [0.052, 0.227, 0.402, 0.577];
    for (const s of shelves) p.box(b, -0.214, 0.214, -0.076, 0.07, s - 0.012, s, MAHOGANY);
    p.box(b, -0.214, 0.214, -0.083, 0.074, 0.748, 0.76, MAHOGANY);
    p.box(b, -0.24, 0.24, -0.085, 0.085, 0.76, 0.776, MAHOGANY, 0.005);
    p.box(b, -0.236, 0.236, -0.083, 0.08, 0.776, 0.79, DARK_WOOD);
    const spines = HOTEL_ATLAS.spines;
    shelves.forEach((s, row) => {
        const room = (row < 3 ? shelves[row + 1] - 0.012 : 0.748) - s - 0.006;
        let a = -0.212;
        // Now and then a vase, where the books stop.
        const vase = next() < 0.25 ? -0.15 + next() * 0.3 : null;
        while (a < 0.2) {
            if (vase !== null && Math.abs(a + 0.02 - vase) < 0.04) {
                b.finish(F_GLASS, 0.3);
                p.turned(b, vase, -0.02, s, [[0, 0], [0.02, 0], [0.03, 0.03], [0.022, 0.07], [0.014, 0.09], [0.018, 0.1], [0, 0.1]], 10, [0x2e3a5a, 0x5a2a1a, 0x1e3a2a][row % 3]);
                a = vase + 0.04;
                continue;
            }
            if (next() < 0.07) {
                a += 0.02 + next() * 0.04;
                continue;
            }
            // (Its spine's picture is in its binding's colour.)
            const k = Math.floor(next() * spines.length);
            const color = BINDINGS[k % BINDINGS.length];
            if (next() < 0.08 && a + 0.13 < 0.21 && (vase === null || a + 0.13 < vase - 0.035 || a > vase + 0.035)) {
                // A few laid flat, one on another.
                const count = 2 + Math.floor(next() * 3);
                let y = s;
                const width = 0.09 + next() * 0.04;
                for (let k = 0; k < count; k++) {
                    const h = 0.012 + next() * 0.01;
                    b.finish(F_FABRIC, 0.2);
                    p.box(b, a, a + width, -0.074, 0.03 + next() * 0.02, y, y + h, BINDINGS[Math.floor(next() * BINDINGS.length)]);
                    y += h;
                }
                a += width + 0.004;
                continue;
            }
            const w = 0.011 + next() * 0.014;
            if (a + w > 0.212) break;
            const h = Math.min(room, 0.1 + next() * 0.055);
            const d = 0.088 + next() * 0.03;
            b.finish(F_FABRIC, 0.2);
            p.box(b, a, a + w, -0.075, -0.075 + d, s, s + h, color);
            // Its spine: bands and a label, from the picture (left to right as you face it).
            face4(ctx.paint, [p.at(a + w, -0.075 + d, s), p.at(a, -0.075 + d, s), p.at(a, -0.075 + d, s + h), p.at(a + w, -0.075 + d, s + h)], [p.front[0], 0, p.front[1]], 0xffffff, atlasUv(spines[k]));
            a += w + 0.0005;
        }
    });
}

/**
 * A fireplace of white marble: a hearth, the jambs and the frieze with a tablet in it, the mantel shelf; the firebox
 * sooted black, a grate of cold logs and ash, andirons and a brass fender; on the mantel a clock and two candlesticks,
 * and over it a mirror in a gilt frame, dark.
 */
function fireplace(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_VEINED, 0.2);
    p.box(b, -0.33, 0.33, -0.09, 0.09, 0, 0.014, WHITE_MARBLE);
    for (const e of [-1, 1]) {
        p.box(b, e * 0.2, e * 0.29, -0.088, -0.03, 0.014, 0.3, WHITE_MARBLE);
        p.box(b, e * 0.212, e * 0.278, -0.03, -0.022, 0.05, 0.292, WHITE_MARBLE);
        p.box(b, e * 0.205, e * 0.285, -0.03, -0.018, 0.014, 0.05, WHITE_MARBLE);
    }
    p.box(b, -0.29, 0.29, -0.088, -0.03, 0.3, 0.37, WHITE_MARBLE);
    p.box(b, -0.06, 0.06, -0.03, -0.024, 0.312, 0.358, WHITE_MARBLE);
    p.soft(b, -0.31, 0.31, -0.088, -0.02, 0.366, 0.38, 0.004, WHITE_MARBLE);
    p.soft(b, -0.335, 0.335, -0.09, 0.0, 0.378, 0.398, 0.004, WHITE_MARBLE);
    // The firebox: black at the back, its cheeks and its roof sooted.
    b.finish(F_PAINT, 0);
    p.box(b, -0.2, 0.2, -0.088, -0.085, 0.014, 0.3, 0x0a0807);
    for (const e of [-1, 1]) {
        const n = normalAcross(p, -e * 0.055, 0.05);
        face4(b, [p.at(e * 0.2, -0.03, 0.014), p.at(e * 0.15, -0.085, 0.014), p.at(e * 0.15, -0.085, 0.298), p.at(e * 0.2, -0.03, 0.298)], n, 0x17120e);
    }
    face4(b, [p.at(-0.2, -0.03, 0.298), p.at(0.2, -0.03, 0.298), p.at(0.15, -0.085, 0.298), p.at(-0.15, -0.085, 0.298)], [0, -1, 0], 0x100c0a);
    // The grate, the logs on it, the ash under.
    for (const y of [0.035, 0.07]) p.tube(b, [[-0.11, -0.04, y], [0.11, -0.04, y]], 0.004, 4, IRON);
    for (let k = -4; k <= 4; k++) p.rod(b, [k * 0.025, -0.04, 0.02], [k * 0.025, -0.045, 0.085], 0.0035, IRON, 4);
    p.soft(b, -0.12, 0.12, -0.08, -0.03, 0.014, 0.024, 0.006, 0x4a4640, 1, false);
    for (const [a0, a1, f, y, r] of [[-0.1, 0.09, -0.06, 0.05, 0.016], [-0.08, 0.1, -0.05, 0.08, 0.014], [-0.05, 0.06, -0.07, 0.085, 0.012]]) {
        p.tube(b, [[a0, f, y], [a1, f + 0.01, y + 0.005]], r, 7, 0x2a1c14);
    }
    b.finish(F_GILT, 0.3);
    for (const e of [-1, 1]) p.turned(b, e * 0.14, -0.022, 0.014, [[0, 0], [0.012, 0], [0.006, 0.01], [0.005, 0.07], [0.012, 0.08], [0.012, 0.09], [0, 0.096]], 8, BRASS);
    p.tube(b, [[-0.3, 0.078, 0.034], [0.3, 0.078, 0.034]], 0.004, 5, BRASS);
    for (const e of [-1, 1]) {
        p.tube(b, [[e * 0.3, 0.078, 0.034], [e * 0.3, 0.02, 0.034]], 0.004, 5, BRASS);
        p.turned(b, e * 0.3, 0.078, 0.014, [[0, 0], [0.008, 0], [0.006, 0.01], [0.009, 0.02], [0.006, 0.028], [0, 0.03]], 6, BRASS);
    }
    // On the mantel: a clock in the middle, a candlestick at each end, and a vase.
    b.finish(F_GLASS, 0.3);
    p.soft(b, -0.045, 0.045, -0.07, -0.03, 0.398, 0.47, 0.008, EBONY);
    b.finish(F_GILT, 0.6);
    p.forward(b, 0, -0.03, 0.44, [[0, 0], [0.026, 0], [0.026, 0.003], [0, 0.003]], 14, GILT);
    const [fx, fy, fz] = p.at(0, -0.0255, 0.44);
    const r = 0.022;
    const [rx, rz] = p.right;
    face4(ctx.dials, [[fx - rx * r, fy - r, fz - rz * r], [fx + rx * r, fy - r, fz + rz * r], [fx + rx * r, fy + r, fz + rz * r], [fx - rx * r, fy + r, fz - rz * r]], [piece.dx, 0, piece.dz], 0xff0000 | (((piece.variant >>> 9) & 255) << 8), [0, 0, 1, 1]);
    for (const e of [-1, 1]) {
        b.finish(F_GILT, 0.6);
        p.turned(b, e * 0.28, -0.05, 0.398, [[0, 0], [0.022, 0], [0.012, 0.012], [0.006, 0.02], [0.009, 0.06], [0.005, 0.1], [0.012, 0.108], [0, 0.11]], 8, SILVER);
        b.finish(F_PAINT, 0);
        p.turned(b, e * 0.28, -0.05, 0.506, [[0.0055, 0], [0.0055, 0.05], [0, 0.051]], 6, CANDLE);
    }
    b.finish(F_GLASS, 0.3);
    p.turned(b, 0.16, -0.055, 0.398, [[0, 0], [0.016, 0], [0.024, 0.02], [0.02, 0.05], [0.01, 0.062], [0.014, 0.07], [0, 0.07]], 10, 0x2e3a5a);
    // The mirror over it, in its gilt frame, a crest on top.
    b.finish(F_GILT, 0.5);
    p.box(b, -0.25, 0.25, -0.09, -0.076, 0.45, 0.472, GILT);
    p.box(b, -0.25, 0.25, -0.09, -0.076, 0.808, 0.83, GILT);
    for (const e of [-1, 1]) p.box(b, e * 0.228, e * 0.25, -0.09, -0.076, 0.472, 0.808, GILT);
    shapedPanel(b, p, -0.12, 0.12, -0.09, -0.08, 0.83, (s) => 0.83 + 0.035 * (1 - (s / 0.12) ** 2), 10, GILT);
    b.finish(F_GLASS, 0);
    p.box(b, -0.228, 0.228, -0.09, -0.084, 0.472, 0.808, 0x1c1e20);
}

/** The way a face turned across a frame faces: (across, out), turned into the world. */
function normalAcross(p, across, out) {
    const length = Math.hypot(across, out);
    return [(p.right[0] * across + p.front[0] * out) / length, 0, (p.right[1] * across + p.front[1] * out) / length];
}

/**
 * A console table against a corridor's wall, half round: its top and apron on three tapered legs, walnut or gilt with a
 * marble top; on it a vase of flowers, a candlestick telephone, or a pair of candlesticks.
 */
function consoleTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const gilt = (piece.variant & 1) === 1;
    const [wood, woodFinish] = gilt ? [GILT, F_GILT] : [MAHOGANY, F_WOOD_Y];
    const half = (scale, steps = 12) => {
        const points = [];
        for (let k = 0; k <= steps; k++) {
            const angle = (k / steps) * Math.PI;
            points.push([Math.cos(angle) * 0.148 * scale, -0.062 + Math.sin(angle) * 0.122 * scale]);
        }
        return points;
    };
    b.finish(woodFinish, 0.3);
    prismUp(ctx, p, half(0.9), 0.228, 0.262, wood, 0, -0.04);
    for (const angle of [0.45, Math.PI / 2, Math.PI - 0.45]) {
        const a = Math.cos(angle) * 0.148 * 0.8;
        const f = -0.062 + Math.sin(angle) * 0.122 * 0.8;
        turnedLeg(b, p, a, f, 0.23, 0.008, wood);
    }
    b.finish(gilt ? F_VEINED : F_WOOD_Y, 0.3);
    prismUp(ctx, p, half(1, 16), 0.262, 0.274, gilt ? WHITE_MARBLE : MAHOGANY, 0, -0.04);
    const what = (piece.variant >>> 1) % 4;
    if (what <= 1) {
        b.finish(F_GLASS, 0.2);
        p.turned(b, 0, -0.01, 0.274, [[0, 0], [0.02, 0], [0.03, 0.02], [0.03, 0.05], [0.02, 0.075], [0.016, 0.085], [0.02, 0.095], [0, 0.095]], 12, [0x2e3a5a, 0xd8d0c0][what]);
        // (Low, under the sconce over it.)
        blossom(b, p, 0, -0.01, 0.36, piece.variant >>> 3, 0.12, 6, 0.15);
    } else if (what === 2) {
        // A candlestick telephone: its base, the stem, the mouthpiece; the earpiece on its hook.
        b.finish(F_GLASS, 0.4);
        p.turned(b, 0.03, -0.02, 0.274, [[0, 0], [0.024, 0], [0.022, 0.008], [0.008, 0.014], [0.005, 0.02], [0.005, 0.1], [0.008, 0.106], [0, 0.108]], 10, EBONY);
        p.forward(b, 0.03, -0.014, 0.37, [[0.006, 0], [0.012, 0.018], [0.014, 0.022], [0, 0.022]], 10, EBONY);
        b.finish(F_GILT, 0.3);
        p.rod(b, [0.036, -0.02, 0.36], [0.05, -0.02, 0.364], 0.002, BRASS, 4);
        b.finish(F_GLASS, 0.4);
        p.turned(b, 0.052, -0.02, 0.33, [[0, 0], [0.012, 0.002], [0.008, 0.01], [0.004, 0.012], [0.004, 0.034], [0, 0.036]], 8, EBONY);
        p.rod(b, [0.03, -0.02, 0.29], [-0.02, -0.045, 0.276], 0.0015, 0x1a1410, 4);
        b.finish(F_LINEN, 0);
        p.box(b, -0.07, -0.03, -0.04, 0.0, 0.274, 0.2755, 0xe8e0c8);
    } else {
        for (const e of [-1, 1]) {
            b.finish(F_GILT, 0.6);
            p.turned(b, e * 0.07, -0.03, 0.274, [[0, 0], [0.018, 0], [0.01, 0.01], [0.005, 0.016], [0.008, 0.05], [0.005, 0.08], [0.01, 0.086], [0, 0.088]], 8, BRASS);
            b.finish(F_PAINT, 0);
            p.turned(b, e * 0.07, -0.03, 0.362, [[0.005, 0], [0.005, 0.045], [0, 0.046]], 6, CANDLE);
        }
        b.finish(F_GILT, 0.4);
        p.turned(b, 0, -0.01, 0.274, [[0, 0], [0.028, 0], [0.03, 0.006], [0, 0.006]], 12, SILVER);
    }
}

/** A blackboard on an easel, leaning, MENU chalked on it (the lore's sign for the Beverly Room). */
function chalkboard(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const [foot, top] = [0.06, 0.004];
    b.finish(F_WOOD_Y, 0.4);
    for (const e of [-1, 1]) {
        p.tube(b, [[e * 0.092, foot, 0], [e * 0.088, top, 0.4]], 0.006, 5, MAHOGANY);
        p.tube(b, [[e * 0.092, -foot, 0], [e * 0.088, -top, 0.4]], 0.005, 5, MAHOGANY);
    }
    p.rod(b, [-0.09, 0, 0.4], [0.09, 0, 0.4], 0.006, MAHOGANY, 5);
    const n = normalIn(p, foot - top, 0.4);
    const back = n.map((c) => -c);
    const board = (y) => foot - ((foot - top) * y) / 0.4;
    // The board: a slab between the front legs, its face and its back, and its edges; framed along its top, and the
    // ledge for the chalk along its foot.
    const [y0, y1] = [0.13, 0.38];
    const corner = (a, y, off) => p.at(a, board(y) + off, y);
    b.finish(F_PAINT, 0);
    face4(b, [corner(-0.085, y0, 0.003), corner(0.085, y0, 0.003), corner(0.085, y1, 0.003), corner(-0.085, y1, 0.003)], n, CHALK_BOARD);
    b.finish(F_WOOD_Y, 0.4);
    face4(b, [corner(-0.085, y0, -0.003), corner(0.085, y0, -0.003), corner(0.085, y1, -0.003), corner(-0.085, y1, -0.003)], back, MAHOGANY);
    for (const e of [-1, 1]) face4(b, [corner(e * 0.085, y0, -0.003), corner(e * 0.085, y0, 0.003), corner(e * 0.085, y1, 0.003), corner(e * 0.085, y1, -0.003)], [p.right[0] * e, 0, p.right[1] * e], MAHOGANY);
    face4(b, [corner(-0.085, y1, -0.003), corner(0.085, y1, -0.003), corner(0.085, y1, 0.003), corner(-0.085, y1, 0.003)], normalIn(p, -0.4, foot - top), MAHOGANY);
    face4(b, [corner(-0.085, y0, -0.003), corner(0.085, y0, -0.003), corner(0.085, y0, 0.003), corner(-0.085, y0, 0.003)], [0, -1, 0], MAHOGANY);
    p.tube(b, [[-0.088, board(y1), y1 + 0.002], [0.088, board(y1), y1 + 0.002]], 0.005, 5, MAHOGANY);
    p.tube(b, [[-0.086, board(y0) + 0.006, y0], [0.086, board(y0) + 0.006, y0]], 0.006, 5, MAHOGANY);
    const [u0, v0, u1, v1] = atlasUv(HOTEL_ATLAS.menu);
    face4(ctx.paint, [p.at(0.082, board(y0 + 0.012) + 0.0034, y0 + 0.012), p.at(-0.082, board(y0 + 0.012) + 0.0034, y0 + 0.012), p.at(-0.082, board(y1 - 0.006) + 0.0034, y1 - 0.006), p.at(0.082, board(y1 - 0.006) + 0.0034, y1 - 0.006)], n, 0xffffff, [u0, v0, u1, v1]);
}

// ---------------------------------------------------------------------------------------------- paintings

/**
 * The paintings: a portrait at the end of a corridor that stops at a wall, the Gentleman between the lifts you came up
 * in, a landscape over each bed, and here and there on a lobby's walls or a guest room's; each in a gilt frame, on a
 * face with nothing else on it.
 */
export function paintings(ctx) {
    const { data, x0, z0, seed, store } = ctx;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const kind = data.kinds[i * N + j];
            const x = x0 + i;
            const z = z0 + j;
            for (const [di, dj, bit] of SCONCE_WALLS) {
                if (store.edgeBetween(x, z, di, dj) !== EDGE_WALL || data.sconces[i * N + j] & bit || doorIn(ctx, x, z, di, dj)) continue;
                const roll = hashFloat(seed, 0x9a17, x, z, di * 3 + dj);
                const pick = hashFloat(seed, 0x9a18, x, z, di * 3 + dj);
                let size = null;
                let rect = null;
                if (kind & CELL_GALLERY) {
                    if (z === GALLERY.z1 && dj > 0 && x === 1) {
                        size = [0.14, 0.19];
                        rect = HOTEL_ATLAS.portraits[PORTRAIT_GENTLEMAN];
                    }
                } else if (kind & CELL_CORRIDOR) {
                    const run = kind & (CELL_X_CORRIDOR | CELL_Z_CORRIDOR);
                    const end = run === CELL_X_CORRIDOR ? di !== 0 : run === CELL_Z_CORRIDOR && dj !== 0;
                    if (end) {
                        size = [0.14, 0.19];
                        rect = HOTEL_ATLAS.portraits[Math.floor(pick * HOTEL_ATLAS.portraits.length)];
                    }
                } else if (kind & (CELL_ROOM | CELL_HALL)) {
                    const over = overBed(ctx, x, z, di, dj);
                    if (over || roll < (kind & CELL_HALL ? 0.3 : 0.14)) {
                        if (blockedByFurniture(ctx, x, z, di, dj)) continue;
                        const landscape = over || pick < 0.6;
                        size = landscape ? [0.17, 0.13] : [0.12, 0.16];
                        const list = landscape ? HOTEL_ATLAS.landscapes : HOTEL_ATLAS.portraits;
                        rect = list[Math.floor(hashFloat(seed, 0x9a19, x, z, di * 3 + dj) * list.length)];
                        if (rect === HOTEL_ATLAS.portraits[PORTRAIT_GENTLEMAN] && pick > 0.1) rect = HOTEL_ATLAS.portraits[0];
                    }
                }
                if (!rect) continue;
                painting(ctx, x, z, di, dj, size, rect, overBed(ctx, x, z, di, dj) ? 0.65 : 0.6);
            }
        }
    }
}

/** Whether a bed's head is against the wall on side (di, dj) of cell (x, z) (a painting goes over it). */
function overBed(ctx, x, z, di, dj) {
    return ctx.data.furniture.some((piece) => piece.type === FURN_BED && (piece.variant & 1) === 1 && piece.dx === -di && piece.dz === -dj
        && Math.round(piece.x) === x && Math.round(piece.z) === z);
}

/**
 * Whether something tall stands against the wall on side (di, dj) of cell (x, z), anywhere a painting in the middle of
 * it would be: a wardrobe, a clock, the reception (and its key rack), a wingback chair, a bookcase, a fireplace (and its
 * mirror), a single bed's headboard (a double's has its painting higher up: see overBed).
 */
function blockedByFurniture(ctx, x, z, di, dj) {
    const face = (di !== 0 ? x : z) + (di + dj) * FACE;
    const along = di !== 0 ? z : x;
    return ctx.data.furniture.some((piece) => {
        const headboard = piece.type === FURN_BED && (piece.variant & 1) === 0 && piece.dx === -di && piece.dz === -dj;
        if (!headboard && ![FURN_WARDROBE, FURN_CLOCK, FURN_DESK, FURN_ARMCHAIR, FURN_BOOKCASE, FURN_FIREPLACE].includes(piece.type)) return false;
        const box = furnitureBox(piece);
        const [a0, a1, s0, s1] = di !== 0 ? [box[0], box[2], box[1], box[3]] : [box[1], box[3], box[0], box[2]];
        const near = Math.min(Math.abs(a0 - face), Math.abs(a1 - face)) < (piece.type === FURN_DESK ? 0.45 : 0.1);
        return near && s1 > along - 0.3 && s0 < along + 0.3;
    });
}

/** A painting in its gilt frame on the wall on side (di, dj) of cell (x, z), at height y, half-size [hw, hh]. */
function painting(ctx, x, z, di, dj, [hw, hh], rect, y) {
    const b = ctx.woodwork;
    const axis = di !== 0 ? 0 : 1;
    const side = -(di + dj);
    const surface = (axis === 0 ? x : z) + (di + dj) * FACE;
    const along = axis === 0 ? z : x;
    const out = (d) => surface + side * d;
    const w = 0.022;
    const gilt = 0x7e5f2a;
    b.finish(F_GILT, 0.5);
    // The frame: a moulding stepping up to a bead round the outside, and down again to the canvas.
    wallBox(ctx, b, axis, surface, out(0.012), along - hw - w, along + hw + w, y + hh, y + hh + w, gilt);
    wallBox(ctx, b, axis, surface, out(0.012), along - hw - w, along + hw + w, y - hh - w, y - hh, gilt);
    wallBox(ctx, b, axis, surface, out(0.012), along - hw - w, along - hw, y - hh, y + hh, gilt);
    wallBox(ctx, b, axis, surface, out(0.012), along + hw, along + hw + w, y - hh, y + hh, gilt);
    const bead = 0.006;
    const o = out(0.012);
    wallBox(ctx, b, axis, o, out(0.019), along - hw - w, along + hw + w, y + hh + w - bead, y + hh + w, 0xa8843c);
    wallBox(ctx, b, axis, o, out(0.019), along - hw - w, along + hw + w, y - hh - w, y - hh - w + bead, 0xa8843c);
    wallBox(ctx, b, axis, o, out(0.019), along - hw - w, along - hw - w + bead, y - hh - w + bead, y + hh + w - bead, 0xa8843c);
    wallBox(ctx, b, axis, o, out(0.019), along + hw + w - bead, along + hw + w, y - hh - w + bead, y + hh + w - bead, 0xa8843c);
    // The inner edge of the frame, a dark slip, and the canvas.
    b.finish(F_PAINT, 0);
    wallBox(ctx, b, axis, surface, out(0.006), along - hw, along + hw, y - hh, y + hh, 0x1a120a);
    wallPicture(ctx, ctx.paint, axis, out(0.0075), side, along, y, hw, hh, rect);
}
