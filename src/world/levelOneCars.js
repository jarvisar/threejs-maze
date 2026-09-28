import { PLAIN_U, PLAIN_V } from './ColorBuilder.js';
import { CAR_ESTATE, CAR_HATCHBACK, CAR_SIZES, CAR_VAN, carCovered, carFlat, carStyle } from './levelOne.js';
import { PROP_ATLAS } from './propAtlas.js';

/*
 * Level 1 car meshes: sedans, hatchbacks, wagons and vans, old and dusty. One in four has a cover. Placement is in
 * levelOne.js.
 *
 * Bodies are lofted. Each station from nose to tail uses the same ring of corners (sill, shoulder, waist, glass,
 * roof), so arches, glass rake, cabin taper and rounded corners all come from where those corners sit. Normals are
 * smooth except at the creases (waist, shoulder, and where the glass starts and stops).
 */

// heights shared by every body
const SILL = 0.078;
const WHEEL_Y = 0.083;
const WHEEL_R = 0.083;
const ARCH_R = 0.107;
const ARCH_Y = 0.074;
const CROWN = 0.006;

/**
 * @typedef {object} Body Car shape: side profile, glass extents and wheel positions.
 * @property {number[][]} top Roofline as [z, y] points from the nose (+z) back.
 * @property {number} shoulder Height of the side crease.
 * @property {number} waist Height where the side glass starts.
 * @property {number} tumble How much narrower the cabin is than the body, per side.
 * @property {number} corner Corner radius seen from above.
 * @property {number[]} screen Windshield [bottom, top] (z).
 * @property {number[]} back Rear window [top, bottom] (z).
 * @property {number[]} glass Side windows [front, back] (z).
 * @property {number[]} pillars Pillars between side windows (z).
 * @property {number[]} seams Door edges (z).
 * @property {number[]} axles Front and back (z).
 * @property {boolean} [panelled] Van with no windows behind the front doors.
 */

/** @type {Record<number, Body>} */
const BODIES = {
    // sedan: long hood, cabin, trunk
    0: {
        top: [[0.81, 0.255], [0.79, 0.278], [0.75, 0.29], [0.3, 0.318], [0.09, 0.482], [0.05, 0.49], [-0.26, 0.488], [-0.3, 0.478], [-0.49, 0.345], [-0.53, 0.338], [-0.78, 0.332], [-0.81, 0.3]],
        shoulder: 0.262, waist: 0.318, tumble: 0.06, corner: 0.07,
        screen: [0.3, 0.07], back: [-0.28, -0.49], glass: [0.3, -0.31], pillars: [-0.1], seams: [0.405, -0.1, -0.39], axles: [0.53, -0.51],
    },
    // hatchback: short, steep back
    1: {
        top: [[0.73, 0.255], [0.71, 0.276], [0.67, 0.288], [0.25, 0.315], [0.04, 0.492], [0.0, 0.5], [-0.42, 0.494], [-0.46, 0.484], [-0.66, 0.36], [-0.71, 0.345], [-0.73, 0.315]],
        shoulder: 0.26, waist: 0.315, tumble: 0.055, corner: 0.065,
        screen: [0.25, 0.02], back: [-0.44, -0.66], glass: [0.25, -0.45], pillars: [-0.17], seams: [0.35, -0.17],
        axles: [0.47, -0.49],
    },
    // wagon: sedan front, roof runs back to the tailgate
    2: {
        top: [[0.83, 0.255], [0.81, 0.278], [0.77, 0.29], [0.32, 0.318], [0.11, 0.484], [0.07, 0.492], [-0.66, 0.49], [-0.7, 0.482], [-0.79, 0.38], [-0.82, 0.35], [-0.83, 0.315]],
        shoulder: 0.262, waist: 0.318, tumble: 0.055, corner: 0.07,
        screen: [0.32, 0.09], back: [-0.68, -0.79], glass: [0.32, -0.69], pillars: [-0.08, -0.4], seams: [0.425, -0.08, -0.4],
        axles: [0.55, -0.53],
    },
    // van: short nose, tall box
    3: {
        top: [[0.86, 0.29], [0.84, 0.33], [0.79, 0.36], [0.6, 0.405], [0.38, 0.64], [0.34, 0.652], [-0.82, 0.652], [-0.85, 0.635], [-0.86, 0.6]],
        shoulder: 0.3, waist: 0.405, tumble: 0.022, corner: 0.06,
        screen: [0.6, 0.36], back: [-0.86, -0.86], glass: [0.6, 0.1], pillars: [], seams: [0.64, 0.1, -0.2], axles: [0.6, -0.58],
        panelled: true,
    },
};

// paint, cover, underbody, glass and trim colors
const PAINT = [0x6d2420, 0x2b3d5c, 0xb8b6ae, 0x1f2224, 0x7c6f55, 0x2f4a3a, 0x5e6266, 0x7a5a32, 0xa9a59a, 0x3d4a57];
const COVERS = [0x5b6670, 0x6a6c68, 0x4a5561, 0x7a7466];
const UNDER = 0x141515;
const GLASS = 0x151a1d;
// Glass gets lighter toward the top since it faces the slab and lights.
const GLASS_HIGH = 0x3b454b;
const TRIM = 0x232425;
const RUBBER = 0x141414;
const STEEL = 0x8a8d8f;
const LAMP = 0xb4b6ad;
const TAIL = 0x6a1812;
const AMBER = 0x9a5a18;
const DUST = 0x8a8984;

// Corners per half section: underside, sill, side, shoulder, waist, glass, roof edge, roof middle. The other side is
// mirrored. CREASES are the corners where normals aren't smoothed.
const CORNERS = 8;
const CREASES = new Set([1, 3, 4, 5]);

/**
 * Builds a car and its soft shadow.
 * @param {import('./ColorBuilder.js').ColorBuilder} builder
 * @param {import('./GeometryBuilder.js').GeometryBuilder} shade
 * @param {import('./levelOne.js').Car} car
 * @param {(shade: any, x: number, z: number, hx: number, hz: number, yaw: number) => void} shadow
 */
export function buildCar(builder, shade, car, ox, oz, shadow) {
    const v = car.variant;
    const style = carStyle(car);
    const body = BODIES[style];
    const [length, width] = CAR_SIZES[style];
    const L = length / 2;
    const W = width / 2;
    const covered = carCovered(car);
    const start = builder.vertexCount;
    const paint = fade(PAINT[(v >>> 2) % PAINT.length], 0.86 + ((v >>> 16) & 7) * 0.025);
    // some get a darker lower skirt
    const skirt = style !== CAR_VAN && ((v >>> 19) & 7) === 0 ? 0x3a3c3e : paint;
    const cover = COVERS[(v >>> 22) & 3];

    // Flat tire: squashed wheel and that corner of the body drops.
    const flatTyre = carFlat(car) ? [(v >>> 8) & 1 ? 1 : -1, (v >>> 9) & 1 ? 1 : -1] : null;
    wheels(builder, body, W, covered, v, flatTyre);
    const bodyStart = builder.vertexCount;
    if (covered) {
        loft(builder, body, L, W, cover, cover, true, v);
    } else {
        loft(builder, body, L, W, paint, skirt, false, v);
        front(builder, body, L, W, paint, style);
        rear(builder, body, L, W, paint, style);
        sides(builder, body, L, W, paint);
    }
    if (flatTyre) sag(builder, bodyStart, W, L, ...flatTyre);
    builder.transform(start, car.yaw, car.x - ox, car.z - oz);
    shadow(shade, car.x - ox, car.z - oz, W + 0.05, L + 0.05, car.yaw);
}

// ---------------------------------------------------------------------------------------------- the body

/** Roof height at z, linear between the profile points. */
function topAt(body, z) {
    const points = body.top;
    if (z >= points[0][0]) return points[0][1];
    for (let k = 1; k < points.length; k++) {
        const [z1, y1] = points[k];
        const [z0, y0] = points[k - 1];
        if (z >= z1) return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
    }
    return points[points.length - 1][1];
}

/** Bottom of the body at z. Sill height, raised over the wheel arches. */
function bottomAt(body, z) {
    let y = SILL;
    for (const axle of body.axles) {
        const d = z - axle;
        if (Math.abs(d) < ARCH_R) y = Math.max(y, ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - d * d));
    }
    return y;
}

/** Half width at z, with rounded corners seen from above. */
function halfWidthAt(W, L, corner, z) {
    const d = Math.max(0, Math.abs(z) - (L - corner));
    return W - corner + Math.sqrt(Math.max(0, corner * corner - d * d));
}

/** Loft stations (z). Profile points, around the arches, both sides of each seam and pillar, and glass edges. */
function stations(body, L) {
    const found = new Set();
    const add = (z) => {
        if (z <= L + 1e-6 && z >= -L - 1e-6) found.add(Math.round(z * 10000) / 10000);
    };
    for (const [z] of body.top) add(z);
    for (const axle of body.axles) for (const k of [-1, -0.9, -0.65, -0.3, 0, 0.3, 0.65, 0.9, 1]) add(axle + k * ARCH_R);
    for (const seam of body.seams) {
        add(seam + 0.003);
        add(seam - 0.003);
    }
    for (const pillar of body.pillars) {
        add(pillar + 0.022);
        add(pillar - 0.022);
    }
    for (const z of [...body.screen, ...body.back, ...body.glass]) add(z);
    // rounded corners
    for (const k of [0.3, 0.6, 0.85]) {
        add(L - body.corner * (1 - k));
        add(-L + body.corner * (1 - k));
    }
    const list = [...found].sort((a, b) => b - a);
    // Max gap 0.12 between stations so the roof follows the profile.
    const filled = [];
    for (let k = 0; k < list.length; k++) {
        filled.push(list[k]);
        const gap = k + 1 < list.length ? list[k] - list[k + 1] : 0;
        const steps = Math.ceil(gap / 0.12);
        for (let s = 1; s < steps; s++) filled.push(list[k] - (gap * s) / steps);
    }
    return filled;
}

/**
 * Half section at z, from the underside to the roof middle, as CORNERS [x, y] points. `puff` > 0 makes it a cover
 * that stands off the body and hangs straight down to a hem.
 */
function section(body, L, W, z, puff) {
    const t = topAt(body, z) + puff;
    const b = puff > 0 ? 0.11 : bottomAt(body, z);
    const w = halfWidthAt(W, L, body.corner, z) + puff;
    const waist = Math.min(body.waist + puff, t - 0.014);
    const glazed = t > body.waist + puff + 0.03;
    const roof = w - 0.012 - (glazed ? body.tumble : 0.012);
    // Kept under the waist where the nose and tail drop below the shoulder.
    const shoulder = Math.min(Math.max(body.shoulder, b + 0.045), waist - 0.004);
    return [
        [0, b + 0.012],
        [w - (puff > 0 ? -0.008 : 0.035), b],
        [w - 0.004, Math.min(b + 0.035, shoulder - 0.006)],
        [w, shoulder],
        [w - 0.012, waist],
        [roof, Math.max(waist, t - 0.03)],
        [Math.max(roof - 0.04, 0.02), t],
        [0, t + CROWN],
    ];
}

/**
 * Lofts the body with glass, pillars and seams. `skirt` is used below the rubbing strip. With `covered` it builds a
 * cover over the same shape instead.
 */
function loft(b, body, L, W, paint, skirt, covered, v) {
    const zs = stations(body, L);
    const puff = covered ? 0.014 : 0;
    // Full ring per station: up the +x side, over the roof, down the -x side.
    const ringSize = CORNERS * 2 - 1;
    const grid = zs.map((z, i) => {
        // covers get a little slack that varies along the car
        const loose = covered ? 0.0025 * Math.sin(zs[i] * 7 + (v & 255)) : 0;
        const half = section(body, L, W, z, puff + loose);
        const ring = [];
        for (let k = 0; k < CORNERS; k++) ring.push([half[k][0], half[k][1], z]);
        for (let k = CORNERS - 2; k >= 0; k--) ring.push([-half[k][0], half[k][1], z]);
        return ring;
    });
    // Hard creases at the windshield and rear window stations, and at CREASES around the ring.
    const S = zs.length;
    const stationCrease = new Uint8Array(S);
    for (const z of covered ? [] : [...body.screen, ...body.back]) {
        const k = zs.findIndex((s) => Math.abs(s - z) < 1e-4);
        if (k >= 0) stationCrease[k] = 1;
    }
    const ringCrease = new Uint8Array(ringSize);
    for (let j = 0; j < ringSize; j++) ringCrease[j] = !covered && CREASES.has(j < CORNERS ? j : ringSize - 1 - j) ? 1 : 0;
    // strip index between ring points j and j + 1, same on both sides
    const stripOf = (j) => (j < CORNERS - 1 ? j : ringSize - 2 - j);

    // Area-weighted face normals from the diagonals. Works on faces that collapse to a triangle.
    const faces = new Float64Array(S * ringSize * 3);
    for (let i = 0; i + 1 < S; i++) {
        for (let j = 0; j + 1 < ringSize; j++) {
            const a = grid[i][j];
            const bI = grid[i + 1][j];
            const d = grid[i][j + 1];
            const c = grid[i + 1][j + 1];
            const ux = c[0] - a[0];
            const uy = c[1] - a[1];
            const uz = c[2] - a[2];
            const wx = d[0] - bI[0];
            const wy = d[1] - bI[1];
            const wz = d[2] - bI[2];
            const k = (i * ringSize + j) * 3;
            faces[k] = uy * wz - uz * wy;
            faces[k + 1] = uz * wx - ux * wz;
            faces[k + 2] = ux * wy - uy * wx;
        }
    }
    const faceCount = ringSize - 1;
    // Vertex normal for a corner of face (fi, fj), written into `normal`. Averages neighbors without crossing creases.
    const normal = new Float64Array(3);
    const normalAt = (fi, fj, i, j) => {
        let x = 0;
        let y = 0;
        let z = 0;
        for (let qi = i - 1; qi <= i; qi++) {
            if (qi < 0 || qi > S - 2 || (qi !== fi && stationCrease[i])) continue;
            for (let dj = -1; dj <= 0; dj++) {
                const qj = (j + dj + faceCount) % faceCount;
                if (qj !== fj && ringCrease[j]) continue;
                const k = (qi * ringSize + qj) * 3;
                x += faces[k];
                y += faces[k + 1];
                z += faces[k + 2];
            }
        }
        const length = Math.hypot(x, y, z) || 1;
        normal[0] = x / length;
        normal[1] = y / length;
        normal[2] = z / length;
    };

    const within = (z, [z0, z1]) => z <= Math.max(z0, z1) + 1e-4 && z >= Math.min(z0, z1) - 1e-4;
    for (let i = 0; i + 1 < S; i++) {
        const mid = (zs[i] + zs[i + 1]) / 2;
        const onScreen = within(mid, body.screen);
        const onBack = body.back[0] !== body.back[1] && within(mid, body.back);
        const pillar = body.pillars.some((p) => Math.abs(mid - p) < 0.022);
        const glazedSide = within(mid, body.glass) && !pillar;
        const seam = body.seams.some((s) => Math.abs(mid - s) < 0.003);
        for (let j = 0; j + 1 < ringSize; j++) {
            const strip = stripOf(j);
            let color = paint;
            let glass = false;
            if (covered) {
                color = strip <= 1 ? fade(paint, 0.8) : paint;
            } else if (strip === 0) {
                color = UNDER;
            } else if (strip === 4) {
                // Behind the side windows this is the pillar around the rear window.
                glass = glazedSide || onScreen;
                color = glass ? GLASS : pillar ? TRIM : seam ? fade(paint, 0.5) : paint;
            } else if (strip === 6 && (onScreen || onBack)) {
                glass = true;
                color = GLASS;
            } else if (strip === 5 && (onScreen || onBack)) {
                // pillars beside the windshield and rear window
                color = paint;
            } else if (strip <= 3) {
                color = strip <= 2 ? skirt : paint;
                if (seam) color = fade(color, 0.5);
                if (strip === 1) color = fade(color, 0.72);
            }
            const first = b.vertexCount;
            for (let k = 0; k < 4; k++) {
                // (i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)
                const ci = k === 1 || k === 2 ? i + 1 : i;
                const cj = k >= 2 ? j + 1 : j;
                const p = grid[ci][cj];
                normalAt(i, j, ci, cj);
                const tint = glass ? blend(GLASS, GLASS_HIGH, Math.min(1, Math.max(0, (p[1] - body.waist) / 0.2))) : color;
                b.vertex(p[0], p[1], p[2], normal[0], normal[1], normal[2], PLAIN_U, PLAIN_V, dusty(tint, normal[1], glass ? 0.42 : covered ? 0.3 : 0.26));
            }
            b.triangle(first, first + 1, first + 2);
            b.triangle(first, first + 2, first + 3);
        }
    }
    // flat caps on the nose and tail
    for (const [ring, facing] of [[grid[0], 1], [grid[S - 1], -1]]) {
        let cy = 0;
        for (const p of ring) cy += p[1];
        cy /= ring.length;
        const z = ring[0][2];
        const centre = b.vertex(0, cy, z, 0, 0, facing, PLAIN_U, PLAIN_V, dusty(paint, 0, 0));
        for (let j = 0; j + 1 < ringSize; j++) {
            const p = ring[j];
            const q = ring[j + 1];
            const color = paint;
            const a = b.vertex(p[0], p[1], z, 0, 0, facing, PLAIN_U, PLAIN_V, color);
            const c = b.vertex(q[0], q[1], z, 0, 0, facing, PLAIN_U, PLAIN_V, color);
            // CCW from outside. The ring runs CCW seen from the front.
            if (facing > 0) b.triangle(centre, a, c);
            else b.triangle(centre, c, a);
        }
    }
}

// ---------------------------------------------------------------------------------------------- the rest

/**
 * Tires and hubcaps (no hubcaps under a cover). flatTyre is [side, end] and that tire is squashed to 0.8 height.
 */
function wheels(b, body, W, covered, v, flatTyre) {
    const hub = ((v >>> 12) & 3) === 0 ? 0x2c2d2e : STEEL;
    body.axles.forEach((axle, k) => {
        for (const side of [-1, 1]) {
            const flat = flatTyre !== null && flatTyre[0] === side && flatTyre[1] === (k === 0 ? 1 : -1);
            const squash = flat ? 0.8 : 1;
            const y = WHEEL_Y - WHEEL_R * (1 - squash);
            const x0 = side * (W - 0.078);
            const x1 = side * (W - 0.008);
            b.cylinder(0, Math.min(x0, x1), y, axle, Math.max(x0, x1), WHEEL_R, 12, RUBBER, squash);
            if (covered) continue;
            // just outside the tire wall
            const face = side * (W - 0.006);
            b.cylinder(0, Math.min(face, face + side * 0.004), y, axle, Math.max(face, face + side * 0.004), 0.052, 10, hub, squash);
            b.cylinder(0, Math.min(face + side * 0.002, face + side * 0.007), y, axle, Math.max(face + side * 0.002, face + side * 0.007), 0.014, 6, TRIM, squash);
        }
    });
}

/** Front end: grille, lights, bumper with plate, and wipers. */
function front(b, body, L, W, paint, style) {
    const z = L + 0.0012;
    const van = style === CAR_VAN;
    const y0 = van ? 0.2 : 0.175;
    const y1 = van ? 0.255 : 0.232;
    const inner = van ? 0.11 : 0.1;
    const outer = halfWidthAt(W, L, body.corner, L) - 0.02;
    // grille, headlights in trim surrounds, turn signals outside them
    b.picture(-inner + 0.01, y0 + 0.004, z, inner - 0.01, y1 - 0.004, 0, 1, PROP_ATLAS.grille);
    for (const side of [-1, 1]) {
        const a = side * (inner + 0.012);
        const c = side * (outer - 0.035);
        flat(b, Math.min(a, c) - 0.004, y0 - 0.004, Math.max(a, c) + 0.004, y1 + 0.004, z, 1, TRIM);
        flat(b, Math.min(a, c), y0, Math.max(a, c), y1, z + 0.0015, 1, LAMP);
        const e = side * (outer - 0.026);
        const f = side * outer;
        flat(b, Math.min(e, f), y0, Math.max(e, f), y1, z, 1, AMBER);
    }
    bumper(b, L, W, body, 1, paint, style);
    // parked wipers
    const foot = body.screen[0] - 0.012;
    const y = topAt(body, foot) + CROWN + 0.004;
    for (const side of [-1, 1]) {
        const a = side * 0.02;
        const c = side * (W - body.tumble - 0.04);
        b.box(Math.min(a, c), y - 0.003, foot - 0.004, Math.max(a, c), y + 0.003, foot + 0.004, TRIM);
    }
}

/** Rear end: tail lights, bumper with plate, and van rear doors. */
function rear(b, body, L, W, paint, style) {
    const z = -L - 0.0012;
    const outer = halfWidthAt(W, L, body.corner, -L) - 0.012;
    const van = style === CAR_VAN;
    const [y0, y1] = van ? [0.2, 0.36] : style === CAR_HATCHBACK || style === CAR_ESTATE ? [0.19, 0.25] : [0.2, 0.268];
    for (const side of [-1, 1]) {
        const a = side * (van ? outer - 0.05 : 0.11);
        const c = side * outer;
        flat(b, Math.min(a, c), y0, Math.max(a, c), y1, z, -1, TAIL);
        // turn signal and reverse light at the inner end
        const e = side * (van ? outer - 0.05 : 0.11);
        const f = e + side * 0.03;
        flat(b, Math.min(e, f), y0, Math.max(e, f), (y0 + y1) / 2, z - 0.0015, -1, AMBER);
        flat(b, Math.min(e, f), (y0 + y1) / 2, Math.max(e, f), y1, z - 0.0015, -1, LAMP);
    }
    if (van) {
        // two doors with a window each, split down the middle
        for (const side of [-1, 1]) flat(b, side > 0 ? 0.012 : -outer + 0.06, 0.42, side > 0 ? outer - 0.06 : -0.012, 0.58, z, -1, GLASS);
        flat(b, -0.003, 0.1, 0.003, topAt(body, -L) - 0.02, z - 0.0015, -1, TRIM);
    }
    bumper(b, L, W, body, -1, paint, style);
}

/**
 * Bumper on the nose (end 1) or tail (-1). Wraps around the corners a little way down the sides, with the license
 * plate on it.
 */
function bumper(b, L, W, body, end, paint, style) {
    const color = style === CAR_VAN ? 0x2e3031 : TRIM;
    const y0 = 0.088;
    const y1 = 0.145;
    const out = 0.014;
    const r = body.corner;
    // outline seen from above as [x, z, outward nx, nz]
    const path = [];
    const side = (sx) => [sx * (W + out), end * (L - 0.13), sx, 0];
    path.push(side(1));
    for (let k = 0; k <= 4; k++) {
        const a = (k / 4) * (Math.PI / 2);
        path.push([W - r + (r + out) * Math.cos(a), end * (L - r + (r + out) * Math.sin(a)), Math.cos(a), end * Math.sin(a)]);
    }
    for (let k = 4; k >= 0; k--) {
        const a = (k / 4) * (Math.PI / 2);
        path.push([-(W - r + (r + out) * Math.cos(a)), end * (L - r + (r + out) * Math.sin(a)), -Math.cos(a), end * Math.sin(a)]);
    }
    path.push(side(-1));
    const depth = 0.03;
    for (let k = 0; k + 1 < path.length; k++) {
        const [ax, az, anx, anz] = path[k];
        const [bx, bz, bnx, bnz] = path[k + 1];
        // front, top, bottom
        quad4(b, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [[anx, 0, anz], [bnx, 0, bnz], [bnx, 0, bnz], [anx, 0, anz]], color);
        const inA = [ax - anx * depth, az - anz * depth];
        const inB = [bx - bnx * depth, bz - bnz * depth];
        const up = [0, 1, 0];
        const down = [0, -1, 0];
        quad4(b, [[ax, y1, az], [bx, y1, bz], [inB[0], y1, inB[1]], [inA[0], y1, inA[1]]], [up, up, up, up], dusty(color, 1, 0.3));
        quad4(b, [[ax, y0, az], [bx, y0, bz], [inB[0], y0, inB[1]], [inA[0], y0, inA[1]]], [down, down, down, down], color);
    }
    // end caps on the sides
    for (const k of [0, path.length - 1]) {
        const [x, z, nx] = path[k];
        const n = [0, 0, -end];
        quad4(b, [[x, y0, z], [x - nx * depth, y0, z], [x - nx * depth, y1, z], [x, y1, z]], [n, n, n, n], color);
    }
    b.picture(-0.085, y0 + 0.006, end * (L + out + 0.002), 0.085, y1 - 0.006, 0, end, PROP_ATLAS.plate);
}

/** Quad with per-corner normals. Winding is picked to match them. */
function quad4(b, corners, normals, color) {
    const [p0, p1, p2] = corners;
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const facing = n[0] * (normals[0][0] + normals[2][0]) + n[1] * (normals[0][1] + normals[2][1]) + n[2] * (normals[0][2] + normals[2][2]);
    const first = b.vertexCount;
    for (let k = 0; k < 4; k++) b.vertex(...corners[k], ...normals[k], PLAIN_U, PLAIN_V, color);
    if (facing >= 0) {
        b.triangle(first, first + 1, first + 2);
        b.triangle(first, first + 2, first + 3);
    } else {
        b.triangle(first, first + 2, first + 1);
        b.triangle(first, first + 3, first + 2);
    }
}

/** Side mirrors, door handles, rubbing strips, and an antenna. */
function sides(b, body, L, W, paint) {
    const foot = body.screen[0];
    const [front, back] = body.axles;
    for (const side of [-1, 1]) {
        // mirror just behind the bottom of the windshield
        const mz = foot - 0.035;
        const my = body.waist + 0.035;
        const x0 = side * (W - 0.02);
        const x1 = side * (W + 0.03);
        b.box(Math.min(x0, x1), my - 0.02, mz - 0.022, Math.max(x0, x1), my + 0.018, mz + 0.022, TRIM);
        // handles at the back edge of each door
        for (const seam of body.seams.slice(1)) {
            const hz = seam + 0.04;
            const hx0 = side * (W - 0.002);
            const hx1 = side * (W + 0.006);
            b.box(Math.min(hx0, hx1), body.waist - 0.03, hz - 0.018, Math.max(hx0, hx1), body.waist - 0.02, hz + 0.018, TRIM);
        }
        // rubbing strip between the arches
        const s0 = front - ARCH_R - 0.01;
        const s1 = back + ARCH_R + 0.01;
        const rx0 = side * (W - 0.002);
        const rx1 = side * (W + 0.005);
        b.box(Math.min(rx0, rx1), 0.19, s1, Math.max(rx0, rx1), 0.206, s0, TRIM);
    }
    // antenna
    const ax = W - 0.04;
    const az = foot + 0.05;
    const ay = topAt(body, az);
    b.cylinder(1, ax, ay, az, ay + 0.17, 0.0016, 4, TRIM);
}

/** Flat rectangle on plane z, facing +z (facing 1) or -z. */
function flat(b, x0, y0, x1, y1, z, facing, color) {
    if (facing > 0) b.quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, 0, 0, 1, color);
    else b.quad(x1, y0, z, x0, y0, z, x0, y1, z, x1, y1, z, 0, 0, -1, color);
}

/**
 * Drops the body toward the flat tire's corner (sx, sz). Applies to vertices added since `start`, before the car is
 * rotated into place.
 */
function sag(b, start, W, L, sx, sz) {
    const drop = 0.02;
    const p = b.positions;
    for (let i = start; i < b.vertexCount; i++) {
        const along = (v, half) => 0.5 + 0.5 * Math.max(-1, Math.min(1, v / half));
        p[i * 3 + 1] -= drop * along(sx * p[i * 3], W) * along(sz * p[i * 3 + 2], L);
    }
}

// ---------------------------------------------------------------------------------------------- color

/** Scales a color by k (over 1 lightens). */
function fade(color, k) {
    const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
    const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
    const b = Math.min(255, Math.round((color & 255) * k));
    return (r << 16) | (g << 8) | b;
}

/** Lerp between two colors. */
function blend(a, b, t) {
    const mix = (shift) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** Mixes in dust on upward faces. `up` is the normal's y, `amount` the max mix. */
function dusty(color, up, amount) {
    const t = amount * Math.max(0, up) ** 1.5;
    if (t <= 0) return color;
    const mix = (shift) => Math.round(((color >> shift) & 255) * (1 - t) + ((DUST >> shift) & 255) * t);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
