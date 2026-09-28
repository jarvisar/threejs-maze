import { CHUNK_SIZE, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { EDGE_NONE, EDGE_WALL } from './grid.js';
import {
    CELL_HALL,
    CELL_MACHINE,
    CELL_MAZE,
    CELL_ROOM,
    CELL_TAKEN,
    FINISH_BRASS,
    FINISH_CLAD,
    FINISH_ENAMEL,
    FINISH_GALVANISED,
    FINISH_IRON,
    FINISH_LAGGED,
    FINISH_PAINT,
    FINISH_RUST,
    FINISH_WOOD,
    MACHINE_BOILER,
    machineBox,
} from './pipeDreams.js';
import { atlasUv, band, bend, disc, hoop, orientedBox, pathTube, polygon, rod, tube, turned, wallPicture } from './pipeDreamsShapes.js';
import { PAINT_ATLAS } from './pipeDreamsTextures.js';
import { hashFloat, hashInts, mulberry32 } from './random.js';

/*
 * Level 2 set dressing beyond the pipes, lamps, machines and furniture (see pipeDreamsGeometry.js and
 * pipeDreamsFurnishings.js): overhead pipe racks and ducts in plant halls, wall equipment, floor markings,
 * debris, columns and the concrete haunches along wall tops.
 *
 * Racks and ducts in a chunk all run the same direction so they never cross. Each sits on a cell line midway
 * between the lamps where nothing stands underneath for a few cells, and turns up into the ceiling short of
 * the walls and openings.
 */

const N = CHUNK_SIZE;
/** Rack pipe center height, and duct bottom and top. */
const RACK_Y = 0.9;
const DUCT_Y = [0.82, 0.97];
/** How far in from the end of its run a rack turns up into the ceiling. */
const RISE_IN = 0.24;
const STRUT = 0x5f6466;
const ROD = 0x4c5052;
const BRASS = 0xb08d3c;
/** Rack pipe options as [finish, color, radius]. */
const RACK_PIPES = [
    [FINISH_LAGGED, 0xd2c7ad, 0.048],
    [FINISH_LAGGED, 0xc9bda0, 0.038],
    [FINISH_CLAD, 0xb4b8ba, 0.045],
    [FINISH_PAINT, 0x2f4a37, 0.03],
    [FINISH_PAINT, 0x74291e, 0.026],
    [FINISH_PAINT, 0x2e4b6c, 0.03],
    [FINISH_RUST, 0x6b3923, 0.038],
    [FINISH_GALVANISED, 0x9ea4a5, 0.022],
    [FINISH_PAINT, 0x9b9e9f, 0.034],
];

/**
 * Racks and ducts over a chunk's plant halls.
 * @param {object} ctx See buildPipeDreamsGeometry.
 */
export function hallRacks(ctx) {
    const { seed, data, chunk, x0, z0 } = ctx;
    // one direction for the whole chunk
    const alongX = hashFloat(seed, 0x7ac0, chunk.cx, chunk.cz) < 0.5;
    const cellOf = (a, b) => (alongX ? b * N + a : a * N + b);
    const free = (a, b) => {
        const kind = data.kinds[cellOf(a, b)];
        return (kind & CELL_HALL) !== 0 && (kind & (CELL_MACHINE | CELL_TAKEN)) === 0;
    };
    const open = (a, b) => (alongX ? ctx.store.edge(x0 + b, z0 + a, 0) : ctx.store.edge(x0 + a, z0 + b, 1)) === EDGE_NONE;
    // Even cells only. Lamps hang over odd ones.
    for (let a = (alongX ? z0 : x0) & 1 ? 1 : 0; a < N; a += 2) {
        const line = (alongX ? z0 : x0) + a;
        if (hashFloat(seed, 0x7ac1, chunk.cx, chunk.cz, line) >= 0.4) continue;
        let b = 0;
        while (b < N) {
            if (!free(a, b)) {
                b++;
                continue;
            }
            let e = b;
            while (e + 1 < N && free(a, e + 1) && open(a, e)) e++;
            if (e - b >= 3) {
                const space = hashInts(seed, 0x7ac2, chunk.cx, chunk.cz, line, b);
                const from = (alongX ? x0 : z0) + b - 0.5 + RISE_IN;
                const to = (alongX ? x0 : z0) + e + 0.5 - RISE_IN;
                if (hashFloat(space, 0x7ac3) < 0.35) duct(ctx, alongX, line, from, to, space);
                else rack(ctx, alongX, line, from, to, space);
            }
            b = e + 1;
        }
    }
}

/** Chunk-relative point on a cell line along x or z: `s` along it, `o` across it, `y` up. */
function on(ctx, alongX, line, s, o, y) {
    return alongX ? [s - ctx.ox, y, line + o - ctx.oz] : [line + o - ctx.ox, y, s - ctx.oz];
}

/** Pipe rack from `from` to `to`. Pipes bend up into the ceiling at both ends, with trapezes every other cell. */
function rack(ctx, alongX, line, from, to, space) {
    const b = ctx.pipes;
    const random = mulberry32(space);
    const count = 2 + Math.floor(random() * 4);
    const pipes = [];
    let o = -0.3 + random() * 0.08;
    for (let n = 0; n < count; n++) {
        const [finish, color, r] = RACK_PIPES[Math.floor(random() * RACK_PIPES.length)];
        if (o + 2 * r > 0.32) break;
        pipes.push({ o: o + r, r, finish, color });
        o += 2 * r + 0.016 + random() * 0.02;
    }
    const [dx, , dz] = alongX ? [1, 0, 0] : [0, 0, 1];
    const R = WALL_HEIGHT - RACK_Y;
    let lowest = 1;
    for (let n = 0; n < pipes.length; n++) {
        const pipe = pipes[n];
        b.finish(pipe.finish, random());
        const [ax, ay, az] = on(ctx, alongX, line, from + R, pipe.o, RACK_Y);
        const [bx, by, bz] = on(ctx, alongX, line, to - R, pipe.o, RACK_Y);
        tube(b, ax, ay, az, bx, by, bz, pipe.r, pipe.color, from + R);
        bend(b, ax, ay, az, -dx, 0, -dz, 0, 1, 0, R, pipe.r, pipe.color, from + R, 4);
        bend(b, bx, by, bz, dx, 0, dz, 0, 1, 0, R, pipe.r, pipe.color, to - R, 4);
        // Flanged joints, not on lagged pipes. Staggered so they don't line up with the next pipe's.
        if (pipe.finish !== FINISH_LAGGED && pipe.finish !== FINISH_CLAD) {
            for (let s = Math.ceil(from + R + 0.3); s < to - R - 0.3; s += 2) {
                const [px, py, pz] = on(ctx, alongX, line, s + 0.2 + (n % 3) * 0.14, pipe.o, RACK_Y);
                band(b, px, py, pz, dx, 0, dz, pipe.r * 1.3, 0.014, pipe.color);
            }
        }
        lowest = Math.min(lowest, RACK_Y - pipe.r);
    }
    // Trapezes on every other cell edge: a bar under all the pipes and a rod up from each end.
    const lo = Math.min(...pipes.map((pipe) => pipe.o - pipe.r)) - 0.02;
    const hi = Math.max(...pipes.map((pipe) => pipe.o + pipe.r)) + 0.02;
    b.finish(FINISH_GALVANISED, 0.5);
    for (let s = Math.floor(from) + 0.5; s < to; s += 1) {
        if (((Math.floor(s) & 1) !== 0) || s < from + R + 0.05 || s > to - R - 0.05) continue;
        const [ax, , az] = on(ctx, alongX, line, s - 0.008, lo, 0);
        const [bx, , bz] = on(ctx, alongX, line, s + 0.008, hi, 0);
        b.box(Math.min(ax, bx), lowest - 0.016, Math.min(az, bz), Math.max(ax, bx), lowest - 0.002, Math.max(az, bz), STRUT);
        for (const edge of [lo, hi]) {
            const [rx, , rz] = on(ctx, alongX, line, s, edge, 0);
            b.box(rx - 0.0025, lowest - 0.002, rz - 0.0025, rx + 0.0025, WALL_HEIGHT, rz + 0.0025, ROD);
        }
    }
}

/**
 * Galvanized duct from `from` to `to`, turning up into the ceiling at both ends. Flanged joints, the odd grille
 * underneath, hung on rods.
 */
function duct(ctx, alongX, line, from, to, space) {
    const b = ctx.pipes;
    const random = mulberry32(space);
    const half = 0.15 + random() * 0.05;
    const [y0, y1] = DUCT_Y;
    const depth = y1 - y0;
    const box = (s0, s1, o0, o1, a0, a1, color) => {
        const [ax, , az] = on(ctx, alongX, line, s0, o0, 0);
        const [bx, , bz] = on(ctx, alongX, line, s1, o1, 0);
        b.box(Math.min(ax, bx), a0, Math.min(az, bz), Math.max(ax, bx), a1, Math.max(az, bz), color);
    };
    const wear = random();
    b.finish(FINISH_GALVANISED, wear);
    // main run plus the risers at each end
    box(from + depth, to - depth, -half, half, y0, y1, 0xa2a8a9);
    box(from, from + depth, -half, half, y0, WALL_HEIGHT, 0xa2a8a9);
    box(to - depth, to, -half, half, y0, WALL_HEIGHT, 0xa2a8a9);
    // joint flanges, with a grille underneath every third
    b.finish(FINISH_GALVANISED, Math.min(1, wear + 0.2));
    let joint = 0;
    for (let s = from + depth + 0.45; s < to - depth - 0.1; s += 0.45) {
        box(s - 0.005, s + 0.005, -half - 0.006, half + 0.006, y0 - 0.006, y1 + 0.006, 0x8e9496);
        if (joint++ % 3 === 1) {
            b.finish(FINISH_IRON, 0.3);
            box(s + 0.08, s + 0.3, -half + 0.04, half - 0.04, y0 - 0.004, y0, 0x2a2a2a);
            b.finish(FINISH_GALVANISED, 0.3);
            for (let k = 0; k < 4; k++) {
                const at = s + 0.1 + k * 0.05;
                box(at - 0.006, at + 0.006, -half + 0.045, half - 0.045, y0 - 0.008, y0 - 0.004, 0xb4b8ba);
            }
            b.finish(FINISH_GALVANISED, Math.min(1, wear + 0.2));
        }
    }
    // hangers on every other cell edge: a bar underneath and two rods
    b.finish(FINISH_GALVANISED, 0.5);
    for (let s = Math.floor(from) + 0.5; s < to; s += 1) {
        if ((Math.floor(s) & 1) !== 0 || s < from + depth + 0.05 || s > to - depth - 0.05) continue;
        box(s - 0.01, s + 0.01, -half - 0.03, half + 0.03, y0 - 0.02, y0 - 0.008, STRUT);
        for (const edge of [-half - 0.022, half + 0.022]) {
            const [rx, , rz] = on(ctx, alongX, line, s, edge, 0);
            b.box(rx - 0.0025, y0 - 0.008, rz - 0.0025, rx + 0.0025, WALL_HEIGHT, rz + 0.0025, ROD);
        }
    }
}

// ---------------------------------------------------------------------------------------------- on the walls

export const EQUIP_BOX = 0; // junction box with conduit up the wall behind the pipes
export const EQUIP_BELL = 1; // alarm bell
export const EQUIP_FIRE = 2; // fire point: extinguisher on a bracket with a sign above
export const EQUIP_PHONE = 3; // wall telephone
export const EQUIP_REEL = 4; // hose reel
export const EQUIP_SIGN = 5; // no smoking

/** Wall equipment per area as [EQUIP_*, chance], rolled on otherwise empty wall faces. */
export const WALL_EQUIPMENT = {
    tunnel: [[EQUIP_BOX, 0.035], [EQUIP_BELL, 0.012], [EQUIP_FIRE, 0.014], [EQUIP_PHONE, 0.007], [EQUIP_REEL, 0.007], [EQUIP_SIGN, 0.015]],
    hall: [[EQUIP_BOX, 0.04], [EQUIP_FIRE, 0.02], [EQUIP_SIGN, 0.02], [EQUIP_PHONE, 0.01], [EQUIP_BELL, 0.01], [EQUIP_REEL, 0.008]],
    maze: [[EQUIP_BOX, 0.015], [EQUIP_BELL, 0.01]],
    room: [[EQUIP_BOX, 0.02], [EQUIP_SIGN, 0.01]],
};

/**
 * Wall equipment at chunk-relative (x, z) on a wall face facing (nx, nz). Everything fits between the low pipes
 * and the ones by the ceiling, and sticks out no further than they do.
 */
export function wallEquipment(ctx, kind, x, z, nx, nz, roll) {
    const b = ctx.pipes;
    // at(out from wall, along it to the right when facing it, up)
    const [rx, rz] = [nz, -nx];
    const at = (o, a, y) => [x + nx * o + rx * a, y, z + nz * o + rz * a];
    const box = (o0, a0, y0, o1, a1, y1, color) => {
        const [ax, , az] = at(o0, a0, 0);
        const [bx, , bz] = at(o1, a1, 0);
        b.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), color);
    };
    const conduit = (a, from) => {
        b.finish(FINISH_GALVANISED, 0.5);
        const [cx, , cz] = at(0.0065, a, 0);
        tube(b, cx, from, cz, cx, WALL_HEIGHT, cz, 0.0055, 0x8e9496, 0, 6);
    };
    const picture = (y, hw, hh, rect) => {
        const [px, , pz] = at(0.0015, 0, 0);
        wallPicture(ctx.paint, px, y, pz, nx, nz, hw, hh, rect);
    };
    if (kind === EQUIP_BOX) {
        b.finish(FINISH_ENAMEL, 0.3 + roll * 0.6);
        box(0, -0.032, 0.44, 0.026, 0.032, 0.515, roll < 0.5 ? 0x7c7f7a : 0x5d6a61);
        b.finish(FINISH_IRON, 0.4);
        box(0.026, -0.028, 0.444, 0.029, 0.028, 0.511, 0x3a3d40);
        conduit(0.012, 0.515);
        if (roll > 0.6) conduit(-0.014, 0.515);
    } else if (kind === EQUIP_BELL) {
        b.finish(FINISH_ENAMEL, 0.3);
        box(0, -0.024, 0.56, 0.008, 0.024, 0.61, 0x3a3d40);
        const [dx, dy, dz] = at(0.008, 0, 0.585);
        turned(b, dx, dy, dz, nx, 0, nz, [[0.032, 0], [0.032, 0.006], [0.027, 0.018], [0.014, 0.028], [0, 0.031]], 14, 0xb3261e);
        b.finish(FINISH_BRASS, 0.4);
        box(0.008, -0.004, 0.548, 0.022, 0.004, 0.556, BRASS);
        conduit(0, 0.61);
    } else if (kind === EQUIP_FIRE) {
        picture(0.6, 0.06, 0.03, PAINT_ATLAS.firePoint);
        b.finish(FINISH_IRON, 0.5);
        box(0, -0.012, 0.455, 0.014, 0.012, 0.49, 0x2a2a2a);
        const [ex, , ez] = at(0.04, 0, 0);
        b.finish(FINISH_ENAMEL, 0.2 + roll * 0.5);
        turned(b, ex, 0.34, ez, 0, 1, 0, [[0, 0], [0.021, 0], [0.024, 0.008], [0.024, 0.1], [0.02, 0.115], [0.009, 0.124], [0, 0.126]], 12, 0xb3261e);
        // label, valve and lever, and the hose down the side to the clipped nozzle
        b.finish(FINISH_PAINT, 0.3);
        band(b, ex, 0.4, ez, 0, 1, 0, 0.0256, 0.035, 0xe4dcc4, 12);
        b.finish(FINISH_IRON, 0.4);
        band(b, ex, 0.472, ez, 0, 1, 0, 0.009, 0.016, 0x2a2a2a, 8);
        const [lx, , lz] = at(0.04, 0.005, 0);
        const [mx, , mz] = at(0.04, 0.035, 0);
        tube(b, lx, 0.482, lz, mx, 0.476, mz, 0.003, 0x3a3d40, 0, 4);
        const hose = [at(0.04, -0.01, 0.47), at(0.052, -0.03, 0.455), at(0.06, -0.034, 0.41), at(0.06, -0.032, 0.37)];
        b.finish(FINISH_PAINT, 0.2);
        pathTube(b, hose, 0.005, 0x1c1c1c, 5);
    } else if (kind === EQUIP_PHONE) {
        picture(0.61, 0.05, 0.025, PAINT_ATLAS.telephone);
        const color = [0xc9a227, 0x7c7f7a, 0x2f4a37][Math.floor(roll * 3)];
        b.finish(FINISH_ENAMEL, 0.2 + roll * 0.5);
        box(0, -0.032, 0.44, 0.034, 0.032, 0.55, color);
        // handset on the hook and coiled cord down to the box
        b.finish(FINISH_ENAMEL, 0.2);
        box(0.034, 0.012, 0.47, 0.046, 0.026, 0.54, 0x1c1c1c);
        box(0.034, 0.008, 0.525, 0.052, 0.03, 0.545, 0x1c1c1c);
        box(0.034, 0.008, 0.465, 0.052, 0.03, 0.485, 0x1c1c1c);
        const coil = [];
        for (let k = 0; k <= 24; k++) {
            const t = k / 24;
            const angle = t * Math.PI * 2 * 5;
            coil.push(at(0.044 + Math.cos(angle) * 0.004, 0.019 + Math.sin(angle) * 0.004, 0.465 - t * 0.04));
        }
        pathTube(b, coil, 0.0018, 0x1c1c1c, 3);
        b.finish(FINISH_IRON, 0.3);
        const [kx, , kz] = at(0.036, -0.012, 0);
        disc(b, kx, 0.5, kz, nx, 0, nz, 0.012, 0x2a2a2a, 10);
    } else if (kind === EQUIP_REEL) {
        b.finish(FINISH_IRON, 0.5);
        box(0, -0.018, 0.42, 0.012, 0.018, 0.58, 0x3a3a3a);
        const [cx, , cz] = at(0.012, 0, 0);
        b.finish(FINISH_ENAMEL, 0.3 + roll * 0.5);
        band(b, cx + nx * 0.004, 0.5, cz + nz * 0.004, nx, 0, nz, 0.072, 0.008, 0xb3261e, 12);
        band(b, cx + nx * 0.044, 0.5, cz + nz * 0.044, nx, 0, nz, 0.072, 0.008, 0xb3261e, 12);
        b.finish(FINISH_PAINT, 0.4);
        band(b, cx + nx * 0.024, 0.5, cz + nz * 0.024, nx, 0, nz, 0.058, 0.032, 0x2a2a2a, 12);
        for (let k = 0; k < 2; k++) hoop(b, cx + nx * (0.018 + k * 0.014), 0.5, cz + nz * (0.018 + k * 0.014), nx, 0, nz, 0.06, 0.006, 0x3a3a3a, 12);
        // hose end hanging down with its nozzle
        const hang = [at(0.03, 0.055, 0.49), at(0.034, 0.075, 0.46), at(0.036, 0.078, 0.4), at(0.036, 0.074, 0.37)];
        pathTube(b, hang, 0.006, 0x2a2a2a, 5);
        b.finish(FINISH_BRASS, 0.4);
        const [nzx, , nzz] = at(0.036, 0.074, 0);
        rod(b, nzx, 0.37, nzz, nzx, 0.345, nzz, 0.005, BRASS, 6);
    } else if (kind === EQUIP_SIGN) {
        picture(0.6, 0.035, 0.035, PAINT_ATLAS.noSmoking);
    }
}

// ---------------------------------------------------------------------------------------------- on the floor

/**
 * Plant hall floor paint. Yellow lines around machines, hazard stripes around boilers, and a walkway line along
 * the walls that breaks at doorways and wherever something stands against the wall.
 */
export function floorMarkings(ctx) {
    const { data, x0, z0 } = ctx;
    const b = ctx.paint;
    const [wu0, wv0, wu1, wv1] = atlasUv(PAINT_ATLAS.white);
    const [wu, wv] = [(wu0 + wu1) / 2, (wv0 + wv1) / 2];
    // flat strip from a to b (chunk-relative)
    const line = (ax, az, bx, bz, width, color) => {
        const length = Math.hypot(bx - ax, bz - az);
        const px = (-(bz - az) / length) * width / 2;
        const pz = ((bx - ax) / length) * width / 2;
        b.quad(ax + px, 0.0021, az + pz, bx + px, 0.0021, bz + pz, bx - px, 0.0021, bz - pz, ax - px, 0.0021, az - pz, 0, 1, 0, color, wu, wv, wu, wv);
    };
    for (const machine of data.machines) {
        const [minX, minZ, maxX, maxZ] = machineBox(machine);
        const m = 0.1;
        const [ax, az, bx, bz] = [minX - m - ctx.ox, minZ - m - ctx.oz, maxX + m - ctx.ox, maxZ + m - ctx.oz];
        if (machine.type === MACHINE_BOILER) {
            hatchedBand(b, ax, az, bx, az, 0.06);
            hatchedBand(b, bx, az, bx, bz, 0.06);
            hatchedBand(b, bx, bz, ax, bz, 0.06);
            hatchedBand(b, ax, bz, ax, az, 0.06);
        } else {
            line(ax, az, bx, az, 0.022, LINE_YELLOW);
            line(bx, az + 0.011, bx, bz - 0.011, 0.022, LINE_YELLOW);
            line(bx, bz, ax, bz, 0.022, LINE_YELLOW);
            line(ax, bz - 0.011, ax, az + 0.011, 0.022, LINE_YELLOW);
        }
    }
    // walkway line WALKWAY out from every hall wall
    const out = 0.5 - 0.04 - WALKWAY;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const kind = data.kinds[i * N + j];
            if (!(kind & CELL_HALL) || kind & CELL_MACHINE) continue;
            const x = x0 + i;
            const z = z0 + j;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (ctx.store.edgeBetween(x, z, di, dj) !== EDGE_WALL || ctx.against.has(`${x},${z},${di},${dj}`)) continue;
                // Stop where it meets the line along a cross wall.
                const [ai, aj] = [dj !== 0 ? 1 : 0, di !== 0 ? 1 : 0];
                const s0 = ctx.store.edgeBetween(x, z, -ai, -aj) === EDGE_NONE ? -0.5 : -out;
                const s1 = ctx.store.edgeBetween(x, z, ai, aj) === EDGE_NONE ? 0.5 : out;
                const cx = x + di * out - ctx.ox;
                const cz = z + dj * out - ctx.oz;
                line(cx + ai * s0, cz + aj * s0, cx + ai * s1, cz + aj * s1, 0.02, LINE_YELLOW);
            }
        }
    }
}

const LINE_YELLOW = 0xc9971c;
/** Walkway line distance from a plant hall wall face. */
const WALKWAY = 0.26;

/** Hazard stripe band on the floor from a to b (chunk-relative), made of whole tiles. */
function hatchedBand(b, ax, az, bx, bz, width) {
    const [u0, v0, u1, v1] = atlasUv(PAINT_ATLAS.hatch);
    const length = Math.hypot(bx - ax, bz - az);
    const [tx, tz] = [(bx - ax) / length, (bz - az) / length];
    const [px, pz] = [(-tz * width) / 2, (tx * width) / 2];
    const count = Math.max(1, Math.round(length / (width * 2)));
    const step = length / count;
    for (let k = 0; k < count; k++) {
        const [sx, sz] = [ax + tx * step * k, az + tz * step * k];
        const [ex, ez] = [sx + tx * step, sz + tz * step];
        b.quad(sx + px, 0.0023, sz + pz, ex + px, 0.0023, ez + pz, ex - px, 0.0023, ez - pz, sx - px, 0.0023, sz - pz, 0, 1, 0, 0xffffff, u0, v0, u1, v1);
    }
}

/**
 * Floor debris: paper, rags, broken glass, cans, pipe offcuts, planks in store rooms, loose bricks in the brick
 * passages. Always at the foot of a wall and never in a cell with anything else.
 */
export function debris(ctx) {
    const { data, x0, z0, seed } = ctx;
    const b = ctx.pipes;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const kind = data.kinds[i * N + j];
            const x = x0 + i;
            const z = z0 + j;
            const chance = kind & CELL_MAZE ? 0.16 : kind & CELL_ROOM ? 0.12 : kind & CELL_HALL ? 0.07 : 0.09;
            if (hashFloat(seed, 0xdeb0, x, z) >= chance || (Math.abs(x) <= 3 && z >= -4 && z <= 3)) continue;
            if (kind & (CELL_MACHINE | CELL_TAKEN) || ctx.store.propsAt(x, z).length > 0) continue;
            const random = mulberry32(hashInts(seed, 0xdeb1, x, z));
            const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => ctx.store.edgeBetween(x, z, di, dj) === EDGE_WALL);
            if (walls.length === 0) continue;
            const [di, dj] = walls[Math.floor(random() * walls.length)];
            const [ai, aj] = [dj !== 0 ? 1 : 0, di !== 0 ? 1 : 0];
            const count = 1 + Math.floor(random() * 3);
            for (let n = 0; n < count; n++) {
                // Near the foot of the wall, spaced apart. `out` clears the low pipes and tunnel ledge (store rooms
                // have neither).
                const along = (n - (count - 1) / 2) * 0.24 + (random() - 0.5) * 0.08;
                const out = (kind & CELL_ROOM ? 0.02 : 0.12) + random() * 0.18;
                const px = x + di * (0.46 - out) + ai * along - ctx.ox;
                const pz = z + dj * (0.46 - out) + aj * along - ctx.oz;
                const angle = random() * Math.PI * 2;
                const what = random();
                if (kind & CELL_MAZE && what < 0.7) brick(b, px, pz, angle, random);
                else if (kind & CELL_ROOM && what < 0.3 && n === 0) planks(ctx, x, z, di, dj, random);
                else if (what < 0.5) paper(b, px, pz, angle, random);
                else if (what < 0.65) rag(b, px, pz, angle, random);
                else if (what < 0.8) glass(b, px, pz, random);
                else if (what < 0.9) can(b, px, pz, angle, random);
                else offcut(b, px, pz, angle, random);
            }
        }
    }
}

/** Sheet of paper creased in the middle with one half lifted. */
function paper(b, x, z, angle, random) {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    const w = 0.028 + random() * 0.01;
    const h = 0.038 + random() * 0.01;
    const lift = 0.004 + random() * 0.008;
    const p = (u, v, y) => [x + u * c - v * s, y, z + u * s + v * c];
    b.finish(FINISH_LAGGED, 0.6 + random() * 0.4);
    const color = [0xd8d2c0, 0xcfc8b0, 0xe0dccf, 0xc8b88a][Math.floor(random() * 4)];
    polygon(b, [p(-w, -h, 0.0015), p(w, -h, 0.0015), p(w, 0, 0.0015), p(-w, 0, 0.0015)], 0, 1, 0, color);
    // lifted half, top and underside
    const rise = Math.hypot(h, lift);
    const [ux, uz] = [-s, c];
    polygon(b, [p(-w, 0, 0.0015), p(w, 0, 0.0015), p(w, h, 0.0015 + lift), p(-w, h, 0.0015 + lift)], (-ux * lift) / rise, h / rise, (-uz * lift) / rise, color);
    polygon(b, [p(-w, 0, 0.0012), p(w, 0, 0.0012), p(w, h, 0.0012 + lift), p(-w, h, 0.0012 + lift)], (ux * lift) / rise, -h / rise, (uz * lift) / rise, color);
}

/** Oily rag: a lumpy flat shape with a fold on top. */
function rag(b, x, z, angle, random) {
    b.finish(FINISH_LAGGED, 0.9);
    const color = [0x3a3530, 0x5a4a3a, 0x2a2826, 0x6a5a48][Math.floor(random() * 4)];
    const points = [];
    for (let k = 0; k < 7; k++) {
        const a = angle + (k / 7) * Math.PI * 2;
        const r = 0.025 + random() * 0.02;
        points.push([x + Math.cos(a) * r, 0.002, z + Math.sin(a) * r]);
    }
    // Not always convex, so draw it as wedges from the center.
    for (let k = 0; k < points.length; k++) polygon(b, [[x, 0.002, z], points[k], points[(k + 1) % points.length]], 0, 1, 0, color);
    const fold = points.slice(0, 3).map(([px, , pz]) => [x + (px - x) * 0.6, 0.009, z + (pz - z) * 0.6]);
    for (let k = 0; k < fold.length - 1; k++) polygon(b, [[x, 0.009, z], fold[k], fold[k + 1]], 0, 1, 0, color);
}

/** Broken glass shards. */
function glass(b, x, z, random) {
    b.finish(FINISH_BRASS, 0.2);
    const count = 3 + Math.floor(random() * 5);
    for (let k = 0; k < count; k++) {
        const cx = x + (random() - 0.5) * 0.08;
        const cz = z + (random() - 0.5) * 0.08;
        const r = 0.004 + random() * 0.01;
        const a = random() * Math.PI * 2;
        // Each shard slightly higher than the last so overlapping ones aren't coplanar.
        const y = 0.0015 + k * 0.0007;
        const corners = [0, 1, 2].map((n) => {
            const t = a + n * 2.1 + random() * 0.5;
            return [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r];
        });
        polygon(b, corners, 0, 1, 0, 0x8a9a94);
    }
}

/** Tin can on its side. */
function can(b, x, z, angle, random) {
    b.finish(FINISH_ENAMEL, 0.8);
    const color = [0xa3261c, 0x2a4e7a, 0x3d6b3a, 0xb8b0a0][Math.floor(random() * 4)];
    const r = 0.011;
    turned(b, x, r, z, Math.cos(angle), 0, Math.sin(angle), [[0, -0.018], [r, -0.018], [r, 0.018], [0, 0.018]], 8, color);
}

/** Short pipe offcut. */
function offcut(b, x, z, angle, random) {
    const r = 0.008 + random() * 0.014;
    const length = 0.06 + random() * 0.12;
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    const [dx, dz] = [(c * length) / 2, (s * length) / 2];
    const [finish, color] = [[FINISH_RUST, 0x6b3923], [FINISH_GALVANISED, 0x9ea4a5], [FINISH_PAINT, 0x2f4a37]][Math.floor(random() * 3)];
    b.finish(finish, random());
    tube(b, x - dx, r, z - dz, x + dx, r, z + dz, r, color, 0, 8);
    b.finish(FINISH_IRON, 0.3);
    disc(b, x - dx, r, z - dz, -c, 0, -s, r * 0.7, 0x141312, 8);
    disc(b, x + dx, r, z + dz, c, 0, s, r * 0.7, 0x141312, 8);
}

/** Loose brick (sometimes half, sometimes on its side) with some grit around it. */
function brick(b, x, z, angle, random) {
    const half = random() < 0.4;
    const [hu, hv, hw] = [half ? 0.02 : 0.042, 0.016, 0.02];
    const tip = random() < 0.3 ? Math.PI / 2 : 0;
    const u = [Math.cos(angle), 0, Math.sin(angle)];
    const w = [-Math.sin(angle), 0, Math.cos(angle)];
    // rolled about its length when on its side
    const v = [w[0] * Math.sin(tip), Math.cos(tip), w[2] * Math.sin(tip)];
    const ww = [w[0] * Math.cos(tip), -Math.sin(tip), w[2] * Math.cos(tip)];
    const lift = tip > 0 ? hw : hv;
    b.finish(FINISH_IRON, 0.9);
    const color = [0x5a3222, 0x4a2a1c, 0x2a2420, 0x6a3a26][Math.floor(random() * 4)];
    orientedBox(b, [x, lift, z], u, v, ww, hu, hv, hw, color);
    for (let k = 0; k < 4; k++) {
        const gx = x + (random() - 0.5) * 0.1;
        const gz = z + (random() - 0.5) * 0.1;
        const g = 0.003 + random() * 0.005;
        b.box(gx - g, 0, gz - g, gx + g, g * 1.2, gz + g, color);
    }
}

/** A few planks, either leaning on the wall or stacked along its foot. */
function planks(ctx, x, z, di, dj, random) {
    const b = ctx.pipes;
    const [ai, aj] = [dj !== 0 ? 1 : 0, di !== 0 ? 1 : 0];
    b.finish(FINISH_WOOD, 0.4 + random() * 0.5);
    const color = [0x8a6a45, 0x9a7a52, 0x6a5238][Math.floor(random() * 3)];
    const count = 2 + Math.floor(random() * 3);
    const face = 0.46;
    if (random() < 0.5) {
        // leaning side by side, feet out a bit and tops on the wall
        for (let n = 0; n < count; n++) {
            const along = -0.25 + n * 0.1 + random() * 0.02;
            const length = 0.45 + random() * 0.2;
            const foot = 0.1 + random() * 0.06;
            const lean = Math.asin(foot / length);
            const thick = 0.006;
            // plank axes: up it (toward the wall), across it (along the wall), out of its face
            const up = [di * Math.sin(lean), Math.cos(lean), dj * Math.sin(lean)];
            const across = [ai, 0, aj];
            const face2 = [-di * Math.cos(lean), Math.sin(lean), -dj * Math.cos(lean)];
            // Center is halfway up, offset from where the top touches the wall by half the thickness.
            const top = face - thick / Math.cos(lean);
            const cx = x + di * (top - (foot / 2)) + ai * along - ctx.ox;
            const cz = z + dj * (top - (foot / 2)) + aj * along - ctx.oz;
            orientedBox(b, [cx, (length / 2) * Math.cos(lean), cz], up, across, face2, length / 2, 0.035 + random() * 0.01, thick, color);
        }
    } else {
        // stacked along the foot of the wall
        const out = face - 0.06;
        for (let n = 0; n < count; n++) {
            const length = 0.5 + random() * 0.3;
            const shift = (random() - 0.5) * 0.12;
            const cx = x + di * (out - (n % 2) * 0.006) + ai * shift - ctx.ox;
            const cz = z + dj * (out - (n % 2) * 0.006) + aj * shift - ctx.oz;
            const y = 0.006 + n * 0.012;
            const [hx, hz] = ai !== 0 ? [length / 2, 0.04] : [0.04, length / 2];
            b.box(cx - hx, y - 0.006, cz - hz, cx + hx, y + 0.006, cz + hz, color);
        }
    }
}

// ---------------------------------------------------------------------------------------------- columns

/** Column chamfer width and hazard stripe height at the foot. */
const CHAMFER = 0.026;
const STRIPES = 0.13;

/**
 * Level 2 pillars (plant halls and edit mode). Chamfered square concrete with hazard stripes at the foot. Built
 * into the wall mesh so they get the same wall shading as their surroundings.
 * @param {object} ctx
 * @param {(x: number, z: number, half: number) => void} shade Soft shading at the pillar's foot and head.
 */
export function columns(ctx, shade) {
    const { store, x0, z0 } = ctx;
    const half = store.pillarHalf;
    const c = CHAMFER;
    // outline from +x, counterclockwise from above
    const outline = [[half, -half + c], [half, half - c], [half - c, half], [-half + c, half], [-half, half - c], [-half, -half + c], [-half + c, -half], [half - c, -half]];
    const [hu0, hv0, hu1, hv1] = atlasUv(PAINT_ATLAS.hatch);
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (!store.pillar(x, z)) continue;
            const cx = x + 0.5 - ctx.ox;
            const cz = z + 0.5 - ctx.oz;
            for (let k = 0; k < outline.length; k++) {
                const [ax, az] = outline[k];
                const [bx, bz] = outline[(k + 1) % outline.length];
                // normal through the middle of the face
                const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
                const length = Math.hypot(mx, mz);
                const [nx, nz] = [mx / length, mz / length];
                wallFace(ctx.walls, cx + ax, cz + az, cx + bx, cz + bz, 0, WALL_HEIGHT, nx, nz);
                // Two rows of stripe tiles. A tile spans a flat face, chamfers get a partial tile.
                const reach = Math.min(1, Math.hypot(bx - ax, bz - az) / (half * 2 - 2 * c));
                const [px, pz] = [cx + ax + nx * 0.0015, cz + az + nz * 0.0015];
                const [qx, qz] = [cx + bx + nx * 0.0015, cz + bz + nz * 0.0015];
                for (let t = 0; t < 2; t++) {
                    const y0 = 0.002 + (t * STRIPES) / 2;
                    const y1 = y0 + STRIPES / 2;
                    const u1 = hu0 + (hu1 - hu0) * reach;
                    polygon(ctx.paint, [[px, y0, pz], [qx, y0, qz], [qx, y1, qz], [px, y1, pz]], nx, 0, nz, 0xffffff, [hu0, u1, u1, hu0], [hv0, hv0, hv1, hv1]);
                }
            }
            // top face, only visible from above the ceiling when flying in edit mode
            const top = outline.map(([ox, oz]) => [cx + ox, WALL_HEIGHT, cz + oz]);
            for (const quad of [[0, 1, 2, 3], [0, 3, 4, 7], [4, 5, 6, 7]]) wallTop(ctx.walls, ...quad.map((n) => top[n]));
            shade(cx, cz, half);
        }
    }
}

/**
 * Vertical quad in the wall mesh from a to b, y0 to y1, facing (nx, nz). UVs in world units like the walls,
 * wound to face out.
 */
function wallFace(b, ax, az, bx, bz, y0, y1, nx, nz) {
    // Left to right from the front is (nz, −nx). Swap ends if it runs the other way.
    if ((bx - ax) * nz - (bz - az) * nx < 0) [ax, az, bx, bz] = [bx, bz, ax, az];
    const u0 = ax * nz - az * nx;
    const u1 = bx * nz - bz * nx;
    b.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, nx, 0, nz, u0, y0, u1, y1);
}

/** Upward-facing quad in the wall mesh. Corners in order, either direction. */
function wallTop(b, p, q, r, s) {
    // counterclockwise from above means (q − p) × (r − p) points up
    const up = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
    const [a, bb, c, d] = up >= 0 ? [p, q, r, s] : [s, r, q, p];
    b.quad(a[0], a[1], a[2], bb[0], bb[1], bb[2], c[0], c[1], c[2], d[0], d[1], d[2], 0, 1, 0, a[0], a[2], c[0], c[2]);
}

// ---------------------------------------------------------------------------------------------- haunches

/** Size of the 45 degree haunch along wall tops, both out from the wall and down it. */
export const HAUNCH = 0.05;

/**
 * 45 degree concrete fillet where every wall meets the ceiling slab, like a poured tunnel. Mitered at corners,
 * continuous along straight runs, capped square where the wall ends. Built from the wall faces so it follows
 * walls placed in edit mode too.
 */
export function haunches(ctx) {
    const { store, x0, z0 } = ctx;
    const b = ctx.walls;
    const face = 0.5 - WALL_THICKNESS / 2;
    const [top, low] = [WALL_HEIGHT, WALL_HEIGHT - HAUNCH];
    const s = Math.SQRT1_2;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (store.edgeBetween(x, z, di, dj) === EDGE_NONE) continue;
                const [ai, aj] = [dj !== 0 ? 1 : 0, di !== 0 ? 1 : 0];
                // chunk-relative point `along` the wall, `out` from its face, `y` up
                const at = (along, out, y) => [x - ctx.ox + di * (face - out) + ai * along, y, z - ctx.oz + dj * (face - out) + aj * along];
                // Extent each way for the foot (on the wall) and the edge (on the slab).
                const reach = [-1, 1].map((dir) => {
                    if (store.edgeBetween(x, z, ai * dir, aj * dir) !== EDGE_NONE) return [face, face - HAUNCH, false];
                    if (store.edgeBetween(x + ai * dir, z + aj * dir, di, dj) !== EDGE_NONE) return [0.5, 0.5, false];
                    return [0.5 + WALL_THICKNESS / 2, 0.5 + WALL_THICKNESS / 2, true];
                });
                const [[foot0, edge0, cap0], [foot1, edge1, cap1]] = reach;
                flat(b, [at(-foot0, 0, low), at(foot1, 0, low), at(edge1, HAUNCH, top), at(-edge0, HAUNCH, top)], -di * s, -s, -dj * s);
                if (cap0) flat(b, [at(-foot0, 0, low), at(-foot0, HAUNCH, top), at(-foot0, 0, top), at(-foot0, 0, top)], -ai, 0, -aj);
                if (cap1) flat(b, [at(foot1, 0, low), at(foot1, HAUNCH, top), at(foot1, 0, top), at(foot1, 0, top)], ai, 0, aj);
            }
        }
    }
}

/** Flat quad in the wall mesh facing n, wound to match. Repeat the last corner for a triangle. */
function flat(b, corners, nx, ny, nz) {
    const [p, q, r] = corners;
    const cross = [
        (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
        (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]),
    ];
    const [a, bb, c, d] = cross[0] * nx + cross[1] * ny + cross[2] * nz >= 0 ? corners : [...corners].reverse();
    // World-unit UVs like the walls. x + z works for u since one of them is constant along the face.
    const u = (point) => point[0] + point[2];
    b.quad(a[0], a[1], a[2], bb[0], bb[1], bb[2], c[0], c[1], c[2], d[0], d[1], d[2], nx, ny, nz, u(a), a[1], u(c), c[1]);
}
