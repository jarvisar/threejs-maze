import { CHUNK_SIZE, WALL_THICKNESS } from '../config.js';
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
    FURN_BANQUET,
    FURN_BED,
    FURN_BEVERLY,
    FURN_CENTRE_TABLE,
    FURN_CLOCK,
    FURN_DESK,
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
    F_MARBLE,
    F_PAINT,
    F_WOOD_X,
    F_WOOD_Y,
    F_WOOD_Z,
    GILT,
    WALNUT,
    atlasUv,
    doorIn,
    face4,
    rod,
    turned,
    wallBox,
    wallPicture,
} from './terrorHotelGeometry.js';
import { HOTEL_ATLAS, PORTRAIT_GENTLEMAN } from './terrorHotelTextures.js';

/*
 * Level 5's furniture (see terrorHotelFurniture.js for where it goes) and its paintings, as meshes: most of it in the
 * woodwork (one mesh, one material, finished part by part: see FRAGMENT_FINISH in terrorHotelShading.js), the lamps'
 * shades with the fittings (they glow when they're on), the rugs and the canvases with the paint, a clock's face with
 * the dials. Each piece is built in its own frame (across it to its right, out of its front, and up) and turned to face
 * the way it does.
 */

const N = CHUNK_SIZE;
const FACE = 0.5 - WALL_THICKNESS / 2;

const MAHOGANY = 0x4a2016;
const EBONY = 0x151112;
const LINEN = 0xe8e2d4;
const SHADE = 0xe6c690;
const COVERS = [0x5e1418, 0x6a4a1e, 0x24381e, 0x2a2a44];
const VELVETS = [0x6e1a1a, 0x2a4028, 0x6a5020, 0x3a2030];
const LEATHER = 0x4a1812;
const IVORY = 0xe4dcc4;
const GLASS = 0xb8c4c4;

/** A piece's frame: world (relative to the chunk) from across it (to its right), out of its front, and up. */
function frame(ctx, piece) {
    const rx = -piece.dz;
    const rz = piece.dx;
    const x = piece.x - ctx.ox;
    const z = piece.z - ctx.oz;
    return {
        at: (a, f, y) => [x + rx * a + piece.dx * f, y, z + rz * a + piece.dz * f],
        // A box in the piece's frame (it's square to the axes, turned a quarter at a time).
        box: (b, a0, a1, f0, f1, y0, y1, color) => {
            const xs = [x + rx * a0 + piece.dx * f0, x + rx * a1 + piece.dx * f1];
            const zs = [z + rz * a0 + piece.dz * f0, z + rz * a1 + piece.dz * f1];
            b.box(Math.min(...xs), y0, Math.min(...zs), Math.max(...xs), y1, Math.max(...zs), color);
        },
        // Something turned about an upright through (a, f), from height y.
        turned: (b, a, f, y, profile, sides, color, inward = false) => {
            turned(b, x + rx * a + piece.dx * f, y, z + rz * a + piece.dz * f, 0, 1, 0, profile, sides, color, inward);
        },
        // A rod between two points of the frame.
        rod: (b, p, q, r, color, sides = 6) => {
            const [ax, ay, az] = [x + rx * p[0] + piece.dx * p[1], p[2], z + rz * p[0] + piece.dz * p[1]];
            const [bx, by, bz] = [x + rx * q[0] + piece.dx * q[1], q[2], z + rz * q[0] + piece.dz * q[1]];
            rod(b, ax, ay, az, bx, by, bz, r, color, sides);
        },
        // The grain along the piece's width, or front to back.
        across: rx !== 0 ? F_WOOD_X : F_WOOD_Z,
        along: piece.dx !== 0 ? F_WOOD_X : F_WOOD_Z,
        right: [rx, rz],
    };
}

/** Every piece of the chunk's furniture. */
export function buildFurniture(ctx) {
    for (const piece of ctx.data.furniture) {
        switch (piece.type) {
            case FURN_BED:
                bed(ctx, piece);
                break;
            case FURN_NIGHTSTAND:
                nightstand(ctx, piece);
                break;
            case FURN_WARDROBE:
                wardrobe(ctx, piece);
                break;
            case FURN_ARMCHAIR:
                armchair(ctx, piece);
                break;
            case FURN_SOFA:
                sofa(ctx, piece);
                break;
            case FURN_SIDE_TABLE:
                sideTable(ctx, piece);
                break;
            case FURN_LOW_TABLE:
                lowTable(ctx, piece);
                break;
            case FURN_RUG:
                rug(ctx, piece);
                break;
            case FURN_DESK:
                reception(ctx, piece);
                break;
            case FURN_CLOCK:
                clock(ctx, piece);
                break;
            case FURN_PIANO:
                piano(ctx, piece);
                break;
            case FURN_CENTRE_TABLE:
                centreTable(ctx, piece);
                break;
            case FURN_BANQUET:
                banquet(ctx, piece);
                break;
            case FURN_BEVERLY:
                beverlyTable(ctx, piece);
                break;
            case FURN_WRITING_DESK:
                writingDesk(ctx, piece);
                break;
            default:
        }
    }
}

// ---------------------------------------------------------------------------------------------- the guest rooms

/**
 * A bed, its head to the wall: a carved headboard, the frame, the mattress under a cover turned down at the top, the
 * pillows, and a low footboard.
 */
function bed(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const [a] = furnitureHalf(piece);
    const cover = COVERS[(piece.variant >>> 3) % COVERS.length];
    b.finish(p.across, 0.2);
    for (const e of [-1, 1]) {
        for (const f of [-0.35, 0.35]) p.box(b, e * a - 0.015, e * a + 0.015, f - 0.015, f + 0.015, 0, 0.04, MAHOGANY);
    }
    p.box(b, -a, a, -0.36, 0.37, 0.04, 0.1, MAHOGANY);
    // The headboard: panelled, with a crest.
    p.box(b, -a - 0.01, a + 0.01, -0.38, -0.36, 0.04, 0.4, MAHOGANY);
    p.box(b, -a + 0.04, a - 0.04, -0.36, -0.355, 0.16, 0.34, 0x3a1810);
    p.box(b, -a - 0.02, a + 0.02, -0.385, -0.35, 0.4, 0.42, MAHOGANY);
    p.box(b, -a * 0.4, a * 0.4, -0.38, -0.36, 0.42, 0.45, MAHOGANY);
    p.box(b, -a, a, 0.365, 0.385, 0.04, 0.2, MAHOGANY);
    b.finish(F_LINEN, 0);
    p.box(b, -a + 0.01, a - 0.01, -0.355, 0.36, 0.1, 0.165, LINEN);
    // The pillows, and the sheet turned down over the cover.
    for (const e of a > 0.2 ? [-1, 1] : [0]) p.box(b, e * a * 0.5 - a * (a > 0.2 ? 0.44 : 0.86), e * a * 0.5 + a * (a > 0.2 ? 0.44 : 0.86), -0.35, -0.26, 0.165, 0.2, LINEN);
    p.box(b, -a - 0.006, a + 0.006, -0.21, -0.17, 0.165, 0.178, LINEN);
    b.finish(F_FABRIC, 0);
    p.box(b, -a - 0.008, a + 0.008, -0.17, 0.375, 0.097, 0.176, cover);
    p.box(b, -a - 0.008, a + 0.008, 0.375, 0.378, 0.06, 0.176, cover);
}

/** A lamp: a turned base, and a pleated shade that glows when it's lit. Its shade's middle is at LAMP_Y. */
function lamp(ctx, p, a, f, y, lit, base = BRASS, glass = false) {
    const b = ctx.woodwork;
    b.finish(F_GILT, 0.3);
    p.turned(b, a, f, y, [[0, 0], [0.028, 0], [0.03, 0.006], [0.014, 0.014], [0.022, 0.035], [0.026, 0.05], [0.016, 0.062], [0.006, 0.066], [0.004, LAMP_Y - y - 0.02], [0, LAMP_Y - y - 0.02]], 10, base);
    const fx = ctx.fittings;
    fx.light(0, 0, lit ? (glass ? 1.2 : 1.35) : 0);
    const color = glass ? 0x2e6a3a : SHADE;
    const bottom = LAMP_Y - 0.03;
    const shade = glass ? [[0.056, 0], [0.05, 0.02], [0.036, 0.04], [0.02, 0.05]] : [[0.058, 0], [0.052, 0.02], [0.046, 0.04], [0.04, 0.06]];
    p.turned(fx, a, f, bottom, shade, 14, color);
    fx.light(0, 0, lit ? 2.2 : 0);
    p.turned(fx, a, f, bottom, shade.map(([r, t]) => [r - 0.0015, t]), 14, glass ? 0xf0e0b0 : 0xffe8c0, true);
    fx.light(0, 0, 0);
    if (lit) {
        const [gx, gy, gz] = p.at(a, f, LAMP_Y);
        ctx.glows.spot(gx, gy, gz, 0.34, -20, 0.5, 0.9);
    }
}

/** A nightstand, a drawer in it, and a lamp on it. */
function nightstand(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(p.across, 0.4);
    for (const e of [-1, 1]) for (const f of [-0.055, 0.055]) p.box(b, e * 0.065 - 0.008, e * 0.065 + 0.008, f - 0.008, f + 0.008, 0, 0.03, MAHOGANY);
    p.box(b, -0.072, 0.072, -0.062, 0.062, 0.03, 0.185, MAHOGANY);
    p.box(b, -0.078, 0.078, -0.068, 0.068, 0.185, 0.198, MAHOGANY);
    // The drawer's front, and its brass pull.
    p.box(b, -0.062, 0.062, 0.062, 0.066, 0.13, 0.175, 0x3e1a10);
    b.finish(F_GILT, 0.2);
    p.box(b, -0.012, 0.012, 0.066, 0.072, 0.15, 0.156, BRASS);
    lamp(ctx, p, 0, -0.005, 0.198, piece.lit === true);
}

/** A wardrobe: two doors, panelled, under a cornice, on a plinth. */
function wardrobe(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.6);
    p.box(b, -0.185, 0.185, -0.095, 0.095, 0.03, 0.72, MAHOGANY);
    b.finish(p.across, 0.6);
    p.box(b, -0.19, 0.19, -0.1, 0.1, 0, 0.03, 0x2e140c);
    p.box(b, -0.195, 0.195, -0.105, 0.105, 0.72, 0.74, MAHOGANY);
    p.box(b, -0.2, 0.2, -0.11, 0.11, 0.74, 0.755, 0x3a1a10);
    b.finish(F_WOOD_Y, 0.6);
    for (const e of [-1, 1]) {
        // Each door's two panels.
        for (const [y0, y1] of [[0.08, 0.36], [0.4, 0.68]]) {
            const a0 = e < 0 ? -0.165 : 0.015;
            const a1 = e < 0 ? -0.015 : 0.165;
            p.box(b, a0, a1, 0.095, 0.1, y0, y0 + 0.008, 0x2e140c);
            p.box(b, a0, a1, 0.095, 0.1, y1 - 0.008, y1, 0x2e140c);
            p.box(b, a0, a0 + 0.008, 0.095, 0.1, y0 + 0.008, y1 - 0.008, 0x2e140c);
            p.box(b, a1 - 0.008, a1, 0.095, 0.1, y0 + 0.008, y1 - 0.008, 0x2e140c);
        }
        b.finish(F_GILT, 0.3);
        p.box(b, e * 0.012 - 0.003, e * 0.012 + 0.003, 0.1, 0.108, 0.36, 0.4, BRASS);
        b.finish(F_WOOD_Y, 0.6);
    }
}

/** A wingback armchair, in velvet, on short legs. */
function armchair(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    const velvet = VELVETS[(piece.variant >>> 4) % VELVETS.length];
    b.finish(p.across, 0.5);
    for (const e of [-1, 1]) for (const f of [-0.12, 0.12]) p.box(b, e * 0.115 - 0.012, e * 0.115 + 0.012, f - 0.012, f + 0.012, 0, 0.06, MAHOGANY);
    b.finish(F_FABRIC, 0);
    p.box(b, -0.135, 0.135, -0.1, 0.14, 0.06, 0.15, velvet);
    p.box(b, -0.11, 0.11, -0.1, 0.14, 0.15, 0.18, velvet);
    p.box(b, -0.135, 0.135, -0.15, -0.1, 0.06, 0.44, velvet);
    for (const e of [-1, 1]) {
        // The arms, and the wings over them.
        p.box(b, e * 0.135 - 0.025 * e - 0.0125, e * 0.135 - 0.025 * e + 0.0125, -0.1, 0.13, 0.15, 0.24, velvet);
        p.box(b, e * 0.135 - 0.03 * e - 0.015, e * 0.135 - 0.03 * e + 0.015, -0.12, 0.02, 0.24, 0.42, velvet);
    }
    p.box(b, -0.13, 0.13, -0.145, -0.095, 0.44, 0.46, velvet);
}

/** A chesterfield: buttoned leather, rolled arms, bun feet. */
function sofa(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(p.across, 0.4);
    for (const e of [-1, 1]) for (const f of [-0.11, 0.11]) p.turned(b, e * 0.32, f, 0, [[0, 0], [0.018, 0], [0.022, 0.02], [0.016, 0.04], [0, 0.04]], 8, 0x2e140c);
    b.finish(F_FABRIC, 0.3);
    p.box(b, -0.33, 0.33, -0.14, 0.14, 0.04, 0.15, LEATHER);
    // The seat's three cushions.
    for (let k = -1; k <= 1; k++) p.box(b, k * 0.19 - 0.092, k * 0.19 + 0.092, -0.08, 0.14, 0.15, 0.185, 0x541c14);
    p.box(b, -0.33, 0.33, -0.15, -0.08, 0.15, 0.33, LEATHER);
    // Rolled arms, along its depth.
    for (const e of [-1, 1]) {
        const [x0, , z0] = p.at(e * 0.33, -0.15, 0);
        const [fx, fz] = [piece.dx, piece.dz];
        p.box(b, e * 0.36 - 0.03, e * 0.36 + 0.03, -0.15, 0.14, 0.04, 0.24, LEATHER);
        turned(b, x0 + p.right[0] * e * 0.03 - fx * 0.005, 0.26, z0 + p.right[1] * e * 0.03 - fz * 0.005, fx, 0, fz, [[0, 0], [0.042, 0], [0.042, 0.3], [0, 0.3]], 10, LEATHER);
    }
    // The buttons, down the back.
    b.finish(F_FABRIC, 0);
    for (let k = -3; k <= 3; k++) {
        for (const y of [0.22, 0.28]) p.box(b, k * 0.085 - 0.005 + (y > 0.25 ? 0.042 : 0), k * 0.085 + 0.005 + (y > 0.25 ? 0.042 : 0), -0.081, -0.078, y - 0.005, y + 0.005, 0x2a0c08);
    }
}

/** A round lamp table on a pedestal, the lamp on it lit or not. */
function sideTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.7);
    p.turned(b, 0, 0, 0, [[0, 0], [0.06, 0], [0.06, 0.012], [0.02, 0.03], [0.014, 0.1], [0.02, 0.16], [0.012, 0.2], [0.012, 0.215], [0, 0.215]], 10, MAHOGANY);
    b.finish(p.across, 0.7);
    p.turned(b, 0, 0, 0.212, [[0, 0], [0.088, 0], [0.09, 0.006], [0.088, 0.012], [0, 0.012]], 16, MAHOGANY);
    lamp(ctx, p, 0, 0, 0.224, piece.lit === true);
}

/** A low table in front of a sofa, with an ashtray and a book on it. */
function lowTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(p.across, 0.8);
    for (const e of [-1, 1]) for (const f of [-0.07, 0.07]) p.box(b, e * 0.14 - 0.01, e * 0.14 + 0.01, f - 0.01, f + 0.01, 0, 0.125, MAHOGANY);
    p.box(b, -0.16, 0.16, -0.09, 0.09, 0.125, 0.14, MAHOGANY);
    b.finish(F_GLASS, 0);
    p.turned(b, 0.07, 0.01, 0.14, [[0, 0], [0.028, 0], [0.03, 0.012], [0.022, 0.012], [0.02, 0.006], [0, 0.006]], 10, 0x6a8a84);
    b.finish(F_FABRIC, 0);
    p.box(b, -0.1, -0.02, -0.04, 0.05, 0.14, 0.156, 0x2a1a3a);
    p.box(b, -0.097, -0.023, -0.037, 0.047, 0.156, 0.158, 0xd8cfb0);
}

/** A rug on the floor under a lounge. */
function rug(ctx, piece) {
    const p = frame(ctx, piece);
    const [a, d] = furnitureHalf(piece);
    const rect = HOTEL_ATLAS.rugs[piece.variant % HOTEL_ATLAS.rugs.length];
    // The picture's long way across the rug.
    face4(ctx.paint, [p.at(-a, -d, 0.003), p.at(a, -d, 0.003), p.at(a, d, 0.003), p.at(-a, d, 0.003)], [0, 1, 0], 0xffffff, atlasUv(rect));
}

/** A writing desk against the wall, its chair in front, and on it a crystal vase with one flower, gone over. */
function writingDesk(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(p.across, 0.1);
    for (const e of [-1, 1]) for (const f of [-0.185, -0.065]) p.box(b, e * 0.2 - 0.01, e * 0.2 + 0.01, f - 0.01, f + 0.01, 0, 0.26, MAHOGANY);
    p.box(b, -0.195, 0.195, -0.19, -0.06, 0.2, 0.26, MAHOGANY);
    p.box(b, -0.22, 0.22, -0.2, -0.05, 0.26, 0.274, MAHOGANY);
    // Its gallery at the back, with pigeonholes.
    p.box(b, -0.2, 0.2, -0.2, -0.16, 0.274, 0.36, 0x3e1a10);
    b.finish(F_LINEN, 0);
    p.box(b, -0.06, 0.08, -0.12, -0.02, 0.274, 0.277, 0xe8e0c8);
    b.finish(F_GLASS, 0);
    p.turned(b, 0.14, -0.12, 0.274, [[0, 0], [0.012, 0], [0.008, 0.02], [0.004, 0.05], [0.007, 0.07], [0, 0.07]], 8, GLASS);
    b.finish(F_PAINT, 0);
    p.rod(b, [0.14, -0.12, 0.33], [0.155, -0.1, 0.38], 0.0015, 0x3a4a22, 4);
    p.rod(b, [0.155, -0.1, 0.38], [0.17, -0.07, 0.35], 0.0015, 0x3a4a22, 4);
    p.box(b, 0.162, 0.18, -0.08, -0.06, 0.33, 0.35, 0x5a1a20);
    chair(ctx, piece, p, 0, 0.09, 1, VELVETS[piece.variant % VELVETS.length], MAHOGANY);
}

/**
 * A side chair at (a, f) in a piece's frame, facing back towards it (dir −1) or along its front (1): a padded seat,
 * four legs, a back with a splat.
 */
function chair(ctx, piece, p, a, f, dir, pad, wood, askew = 0) {
    const b = ctx.woodwork;
    const s = -dir;
    const box = (a0, a1, f0, f1, y0, y1, color) => p.box(b, a + a0, a + a1, f + s * f0, f + s * f1, y0, y1, color);
    b.finish(F_WOOD_Y, 0.2);
    for (const e of [-1, 1]) for (const g of [-0.065, 0.065]) box(e * 0.065 - 0.009, e * 0.065 + 0.009, g - 0.009, g + 0.009, 0, 0.16 + askew * 0, wood);
    b.finish(p.across, 0.2);
    box(-0.078, 0.078, -0.078, 0.078, 0.155, 0.17, wood);
    b.finish(F_FABRIC, 0);
    box(-0.07, 0.07, -0.07, 0.07, 0.17, 0.185, pad);
    b.finish(F_WOOD_Y, 0.2);
    for (const e of [-1, 1]) box(e * 0.065 - 0.009, e * 0.065 + 0.009, 0.056, 0.074, 0.155, 0.39, wood);
    box(-0.078, 0.078, 0.052, 0.078, 0.39, 0.425, wood);
    box(-0.022, 0.022, 0.06, 0.07, 0.19, 0.39, wood);
}

// ---------------------------------------------------------------------------------------------- the lobbies

/**
 * The reception: a long desk of panelled walnut under a marble top, a bell and the register on it, a green-shaded
 * lamp at one end; and on the wall behind it, the rack of pigeonholes, a key hung under each.
 */
function reception(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(p.across, 0.3);
    p.box(b, -0.55, 0.55, -0.1, 0.1, 0, 0.4, WALNUT);
    b.finish(F_WOOD_Y, 0.3);
    for (let k = -3; k <= 3; k++) p.box(b, k * 0.15 - 0.055, k * 0.15 + 0.055, 0.1, 0.106, 0.06, 0.34, 0x3a1e10);
    b.finish(F_MARBLE, 0.7);
    p.box(b, -0.575, 0.575, -0.12, 0.125, 0.4, 0.425, 0xffffff);
    // The bell.
    b.finish(F_GILT, 0.8);
    p.turned(b, 0.2, 0.05, 0.425, [[0, 0], [0.022, 0], [0.022, 0.004], [0.02, 0.012], [0.012, 0.022], [0.004, 0.026], [0.003, 0.032], [0, 0.034]], 12, BRASS);
    // The register, open on its cover.
    b.finish(F_FABRIC, 0);
    p.box(b, -0.105, 0.105, -0.035, 0.095, 0.425, 0.4275, 0x3a1010);
    b.finish(F_LINEN, 0);
    p.box(b, -0.1, 0.1, -0.03, 0.09, 0.4275, 0.431, 0xe8e0c8);
    lamp(ctx, p, -0.4, -0.02, 0.425, piece.lit === true, BRASS, true);
    // The key rack, on the wall behind.
    const wall = -0.3;
    b.finish(F_WOOD_Y, 0.3);
    p.box(b, -0.42, 0.42, wall, wall + 0.025, 0.46, 0.84, 0x2a170c);
    const [ax, ay, az] = p.at(-0.4, wall + 0.0255, 0.48);
    const [bx, , bz] = p.at(0.4, wall + 0.0255, 0.48);
    const n = [piece.dx, 0, piece.dz];
    face4(ctx.paint, [[ax, ay, az], [bx, ay, bz], [bx, 0.82, bz], [ax, 0.82, az]], n, 0xffffff, atlasUv(HOTEL_ATLAS.keys));
}

/** A long-case clock: its trunk with a glass door on the pendulum, its hood, and the face (which goes backwards). */
function clock(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.9);
    p.box(b, -0.1, 0.1, -0.07, 0.07, 0, 0.2, MAHOGANY);
    p.box(b, -0.078, 0.078, -0.06, 0.055, 0.2, 0.57, MAHOGANY);
    p.box(b, -0.1, 0.1, -0.07, 0.07, 0.57, 0.8, MAHOGANY);
    b.finish(p.across, 0.9);
    p.box(b, -0.11, 0.11, -0.075, 0.075, 0.8, 0.815, 0x3a1810);
    p.box(b, -0.06, 0.06, -0.06, 0.06, 0.815, 0.845, MAHOGANY);
    // The pendulum's window, dark glass, and the brass bob behind.
    b.finish(F_GLASS, 0);
    p.box(b, -0.04, 0.04, 0.055, 0.058, 0.26, 0.52, 0x14100c);
    b.finish(F_GILT, 0.8);
    p.turned(b, 0, 0.051, 0.3, [[0, 0], [0.024, 0.002], [0.024, 0.006], [0, 0.008]], 12, BRASS);
    // The face.
    const [fx, fy, fz] = p.at(0, 0.0715, 0.69);
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
    p.rod(b, [-0.12, -0.05, y1], [-0.12, -0.05, y1 + 0.38 * Math.sin(angle) * 0.78], 0.004, EBONY, 4);
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
    // The music desk.
    p.box(b, -0.14, 0.14, 0.17, 0.18, 0.28, 0.36, EBONY);
    // Legs, and the stool.
    for (const [a, f] of [[-0.22, 0.14], [0.22, 0.14], [0.02, -0.26]]) p.turned(b, a, f, 0, [[0, 0], [0.02, 0], [0.026, 0.03], [0.018, 0.12], [0.028, 0.2], [0, 0.2]], 8, EBONY);
    for (const e of [-1, 1]) for (const f of [0.28, 0.33]) p.box(b, e * 0.1 - 0.008, e * 0.1 + 0.008, f - 0.008, f + 0.008, 0, 0.15, EBONY);
    b.finish(F_FABRIC, 0);
    p.box(b, -0.115, 0.115, 0.265, 0.34, 0.15, 0.175, 0x2a0c0e);
}

/** An outline (in a piece's frame) stood up from y0 to y1: its sides, and its top. */
function prismUp(ctx, p, outline, y0, y1, color) {
    const b = ctx.woodwork;
    for (let k = 0; k < outline.length; k++) {
        const [a0, f0] = outline[k];
        const [a1, f1] = outline[(k + 1) % outline.length];
        const [x0, , z0] = p.at(a0, f0, 0);
        const [x1, , z1] = p.at(a1, f1, 0);
        // Out from the middle of the outline.
        const [mx, , mz] = p.at(0, -0.06, 0);
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

/** A round table on a pedestal with a tall vase on it, branches and blossom standing up out of it. */
function centreTable(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_WOOD_Y, 0.5);
    p.turned(b, 0, 0, 0, [[0, 0], [0.12, 0], [0.12, 0.02], [0.05, 0.04], [0.03, 0.08], [0.04, 0.16], [0.028, 0.24], [0, 0.24]], 12, MAHOGANY);
    b.finish(F_WOOD_X, 0.5);
    p.turned(b, 0, 0, 0.24, [[0, 0], [0.19, 0], [0.195, 0.01], [0.19, 0.022], [0, 0.022]], 20, MAHOGANY);
    b.finish(F_GLASS, 0.2);
    p.turned(b, 0, 0, 0.262, [[0, 0], [0.04, 0], [0.058, 0.03], [0.06, 0.07], [0.045, 0.11], [0.03, 0.13], [0.034, 0.145], [0, 0.145]], 14, 0x2e3a5a);
    // Branches, and blossom along them.
    b.finish(F_PAINT, 0);
    let seed = piece.variant;
    const next = () => {
        seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
        return seed / 4294967296;
    };
    // (All of one colour: white, or pink.)
    const blossom = (piece.variant >>> 5) & 1 ? 0xe8e0e8 : 0xc86a8a;
    for (let k = 0; k < 9; k++) {
        const angle = next() * Math.PI * 2;
        const lean = 0.1 + next() * 0.25;
        const length = 0.28 + next() * 0.24;
        const tip = [Math.cos(angle) * lean * length, Math.sin(angle) * lean * length, 0.4 + length];
        p.rod(b, [0, 0, 0.4], tip, 0.003, 0x3a2a1c, 4);
        for (let t = 0.4; t < 1; t += 0.18) {
            const [a, f, y] = [tip[0] * t, tip[1] * t, 0.4 + (tip[2] - 0.4) * t];
            const s = 0.008 + next() * 0.008;
            p.box(b, a - s, a + s, f - s, f + s, y - s, y + s, blossom);
        }
    }
}

// ---------------------------------------------------------------------------------------------- the ballroom

/**
 * A round table laid for dinner: its cloth to the floor, the places set (a plate, a glass), a candelabra in the middle
 * never lit; its chairs round it, gilt and red, one or two pushed back as if someone had just stood up.
 */
function banquet(ctx, piece) {
    const b = ctx.woodwork;
    const p = frame(ctx, piece);
    b.finish(F_LINEN, 0);
    p.turned(b, 0, 0, 0, [[0.29, 0], [0.285, 0.1], [0.272, 0.24], [0.268, 0.27], [0.255, 0.278], [0, 0.278]], 24, LINEN);
    const places = 6;
    for (let k = 0; k < places; k++) {
        const angle = (k / places) * Math.PI * 2 + 0.3;
        const [ca, cf] = [Math.cos(angle), Math.sin(angle)];
        b.finish(F_LINEN, 0);
        p.turned(b, ca * 0.2, cf * 0.2, 0.278, [[0, 0], [0.035, 0], [0.036, 0.004], [0, 0.004]], 12, 0xf2eee4);
        b.finish(F_GLASS, 0);
        p.turned(b, ca * 0.2 + cf * 0.045, cf * 0.2 - ca * 0.045, 0.278, [[0, 0], [0.012, 0], [0.002, 0.004], [0.002, 0.024], [0.012, 0.03], [0.014, 0.05], [0, 0.05]], 8, GLASS);
        // A chair facing in (turned to the nearest quarter), its back to the room; now and then one pushed back.
        const r = 0.37 + (((piece.variant >>> (k * 3)) & 7) === 0 ? 0.05 : 0);
        const [wx, wz] = [p.right[0] * ca + piece.dx * cf, p.right[1] * ca + piece.dz * cf];
        const facing = Math.abs(wx) > Math.abs(wz) ? [-Math.sign(wx), 0] : [0, -Math.sign(wz)];
        const chairPiece = { x: piece.x + wx * r, z: piece.z + wz * r, dx: facing[0], dz: facing[1], variant: 0 };
        chair(ctx, chairPiece, frame(ctx, chairPiece), 0, 0, 1, 0x6a1216, 0x8a6a34);
    }
    // The candelabra.
    b.finish(F_GILT, 0.6);
    p.turned(b, 0, 0, 0.278, [[0, 0], [0.04, 0], [0.03, 0.01], [0.008, 0.03], [0.008, 0.16], [0, 0.16]], 10, 0xc8ccce);
    for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        p.rod(b, [0, 0, 0.4], [Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.43], 0.003, 0xc8ccce, 4);
        b.finish(F_PAINT, 0);
        p.turned(b, Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.43, [[0.006, 0], [0.006, 0.06], [0, 0.061]], 6, 0xf0e8d8);
        b.finish(F_GILT, 0.6);
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
    const chairs = [[0, -0.27, 0, 1], [0, 0.27, 0, -1], [-0.27, 0, 1, 0], [0.27, 0, -1, 0]];
    for (const [a, f, fa, ff] of chairs) {
        const [rx, rz] = p.right;
        const chairPiece = { x: piece.x + rx * a + piece.dx * f, z: piece.z + rz * a + piece.dz * f, dx: rx * fa + piece.dx * ff, dz: rz * fa + piece.dz * ff, variant: 0 };
        chair(ctx, chairPiece, frame(ctx, chairPiece), 0, 0, 1, 0x3a1a4a, EBONY);
    }
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
                painting(ctx, x, z, di, dj, size, rect, overBed(ctx, x, z, di, dj) ? 0.63 : 0.6);
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
 * it would be: a wardrobe, a clock, the reception (and its key rack), a wingback chair.
 */
function blockedByFurniture(ctx, x, z, di, dj) {
    const face = (di !== 0 ? x : z) + (di + dj) * FACE;
    const along = di !== 0 ? z : x;
    return ctx.data.furniture.some((piece) => {
        if (![FURN_WARDROBE, FURN_CLOCK, FURN_DESK, FURN_ARMCHAIR].includes(piece.type)) return false;
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
    wallBox(ctx, b, axis, surface, out(0.018), along - hw - w, along + hw + w, y + hh, y + hh + w, gilt);
    wallBox(ctx, b, axis, surface, out(0.018), along - hw - w, along + hw + w, y - hh - w, y - hh, gilt);
    wallBox(ctx, b, axis, surface, out(0.018), along - hw - w, along - hw, y - hh, y + hh, gilt);
    wallBox(ctx, b, axis, surface, out(0.018), along + hw, along + hw + w, y - hh, y + hh, gilt);
    // The inner edge of the frame, a dark slip, and the canvas.
    b.finish(F_PAINT, 0);
    wallBox(ctx, b, axis, surface, out(0.006), along - hw, along + hw, y - hh, y + hh, 0x1a120a);
    wallPicture(ctx, ctx.paint, axis, out(0.0075), side, along, y, hw, hh, rect);
}
