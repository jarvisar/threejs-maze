import { PAINT_ATLAS_SIZE } from './pipeDreamsTextures.js';

/*
 * The pieces Level 2's meshes are built from (see pipeDreamsGeometry.js and pipeDreamsFurnishings.js): straight pipe,
 * bends, flanges, discs, hoops, things turned on a lathe, pictures from the paint atlas on the walls and the floor, a
 * gauge's face, a box on a wall, and the soft shadow under something on the floor.
 *
 * Pipes are round in 8 or 12 sides, and every ring of one is turned the same way (see ring), so pieces meet without a
 * crack.
 */

/** How far a gauge's face stands off the front of its case. */
export const DIAL_LIFT = 0.0015;
/**
 * The way round a pipe at a point on it: `u` and `v` across it (u × v along it). Along a horizontal pipe `u` is up,
 * along an upright one it's x; every bend keeps its `u` square to the plane it bends in, which is one of those (or
 * the other horizontal), so rings at the ends of pieces that meet line up (their sides being a multiple of four).
 */
export function ringBasis(tx, ty, tz, out, ux = null, uy = 0, uz = 0) {
    if (ux === null) {
        if (Math.abs(ty) < 0.9) {
            ux = 0;
            uy = 1;
            uz = 0;
        } else {
            ux = 1;
            uy = 0;
            uz = 0;
        }
        // (Square to a pipe that slopes: a handwheel's spokes.)
        const along = ux * tx + uy * ty + uz * tz;
        ux -= tx * along;
        uy -= ty * along;
        uz -= tz * along;
        const length = Math.hypot(ux, uy, uz);
        ux /= length;
        uy /= length;
        uz /= length;
    }
    // v = t × u
    out[0] = ux;
    out[1] = uy;
    out[2] = uz;
    out[3] = ty * uz - tz * uy;
    out[4] = tz * ux - tx * uz;
    out[5] = tx * uy - ty * ux;
}

const _basis = new Float64Array(6);

/** @type {Map<number, Float64Array>} */
const circles = new Map();

/** The cosine and sine of each step k = 0..sides round a circle of `sides` steps, as [cos, sin, cos, sin, ...]. */
export function circle(sides) {
    let table = circles.get(sides);
    if (!table) {
        table = new Float64Array((sides + 1) * 2);
        for (let k = 0; k <= sides; k++) {
            const angle = (k / sides) * Math.PI * 2;
            table[k * 2] = Math.cos(angle);
            table[k * 2 + 1] = Math.sin(angle);
        }
        circles.set(sides, table);
    }
    return table;
}

/** One ring of a pipe: `sides` + 1 vertices round (px, py, pz), radius r, `along` its length for the lagging. */
export function ring(b, px, py, pz, tx, ty, tz, r, sides, along, color, ux = null, uy = 0, uz = 0) {
    ringBasis(tx, ty, tz, _basis, ux, uy, uz);
    const [a0, a1, a2, b0, b1, b2] = _basis;
    const round = circle(sides);
    for (let k = 0; k <= sides; k++) {
        const c = round[k * 2];
        const s = round[k * 2 + 1];
        const nx = a0 * c + b0 * s;
        const ny = a1 * c + b1 * s;
        const nz = a2 * c + b2 * s;
        b.vertex(px + nx * r, py + ny * r, pz + nz * r, nx, ny, nz, along, k / sides, color);
    }
}

/** Joins `count` rings of `sides` + 1 vertices, starting at vertex `first`, into a tube facing out. */
export function joinRings(b, first, count, sides) {
    const stride = sides + 1;
    for (let j = 0; j < count - 1; j++) {
        for (let k = 0; k < sides; k++) {
            const a = first + j * stride + k;
            b.triangle(a, a + stride + 1, a + stride);
            b.triangle(a, a + 1, a + stride + 1);
        }
    }
}

export function sidesFor(r) {
    return r >= 0.045 ? 12 : 8;
}

/** A straight pipe from a to b (no ends: they're in something, or meet another piece). */
export function tube(b, ax, ay, az, bx, by, bz, r, color, along = 0, sides = sidesFor(r)) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-4) return;
    const tx = dx / length;
    const ty = dy / length;
    const tz = dz / length;
    const first = b.vertexCount;
    ring(b, ax, ay, az, tx, ty, tz, r, sides, along, color);
    ring(b, bx, by, bz, tx, ty, tz, r, sides, along + length, color);
    joinRings(b, first, 2, sides);
}

/**
 * A bend of a quarter turn: starting at s going along a (unit), turning towards c (unit, square to a), round a
 * radius R.
 */
export function bend(b, sx, sy, sz, ax, ay, az, cx, cy, cz, R, r, color, along = 0, segments = r < 0.03 ? 2 : 3) {
    const sides = sidesFor(r);
    // The plane it bends in: its normal is u all round.
    const mx = ay * cz - az * cy;
    const my = az * cx - ax * cz;
    const mz = ax * cy - ay * cx;
    const ox = sx + cx * R;
    const oy = sy + cy * R;
    const oz = sz + cz * R;
    const first = b.vertexCount;
    for (let j = 0; j <= segments; j++) {
        const phi = (j / segments) * (Math.PI / 2);
        const co = Math.cos(phi);
        const si = Math.sin(phi);
        ring(
            b,
            ox - cx * R * co + ax * R * si,
            oy - cy * R * co + ay * R * si,
            oz - cz * R * co + az * R * si,
            ax * co + cx * si,
            ay * co + cy * si,
            az * co + cz * si,
            r,
            sides,
            along + R * phi,
            color,
            mx,
            my,
            mz,
        );
    }
    joinRings(b, first, segments + 1, sides);
}

/** A straight pipe from a to b closed at both ends (a bar, a spindle, a lamp's tube): nothing to see into. */
export function rod(b, ax, ay, az, bx, by, bz, r, color, sides = sidesFor(r)) {
    tube(b, ax, ay, az, bx, by, bz, r, color, 0, sides);
    const length = Math.hypot(bx - ax, by - ay, bz - az);
    const [tx, ty, tz] = [(bx - ax) / length, (by - ay) / length, (bz - az) / length];
    disc(b, ax, ay, az, -tx, -ty, -tz, r, color, sides);
    disc(b, bx, by, bz, tx, ty, tz, r, color, sides);
}

/** A flat disc facing (nx, ny, nz) (turned like a ring of the same `u`: see ring). */
export function disc(b, px, py, pz, nx, ny, nz, r, color, sides = sidesFor(r), ux = null, uy = 0, uz = 0) {
    ringBasis(nx, ny, nz, _basis, ux, uy, uz);
    const [a0, a1, a2, b0, b1, b2] = _basis;
    const centre = b.vertex(px, py, pz, nx, ny, nz, 0, 0.5, color);
    const first = b.vertexCount;
    const round = circle(sides);
    for (let k = 0; k < sides; k++) {
        const c = round[k * 2];
        const s = round[k * 2 + 1];
        b.vertex(px + (a0 * c + b0 * s) * r, py + (a1 * c + b1 * s) * r, pz + (a2 * c + b2 * s) * r, nx, ny, nz, 0, 0.5, color);
    }
    for (let k = 0; k < sides; k++) b.triangle(centre, first + k, first + ((k + 1) % sides));
}

/**
 * A short, wider piece round a pipe along (tx, ty, tz), centred at p: a flange, a collar, a blind flange. Closed at both
 * ends (the pipe hides the middle of each), so there's no gap round the pipe to see into.
 * @param {number} [sides]
 */
export function band(b, px, py, pz, tx, ty, tz, r, width, color, sides = sidesFor(r)) {
    const h = width / 2;
    tube(b, px - tx * h, py - ty * h, pz - tz * h, px + tx * h, py + ty * h, pz + tz * h, r, color, 0, sides);
    disc(b, px + tx * h, py + ty * h, pz + tz * h, tx, ty, tz, r, color, sides);
    disc(b, px - tx * h, py - ty * h, pz - tz * h, -tx, -ty, -tz, r, color, sides);
}

/** A ring of pipe round a circle (a handwheel's rim), centre c, in the plane square to n, radius R. */
export function hoop(b, px, py, pz, nx, ny, nz, R, r, color, segments = 12) {
    ringBasis(nx, ny, nz, _basis);
    const [e0, e1, e2, f0, f1, f2] = _basis;
    const sides = 4;
    const first = b.vertexCount;
    for (let j = 0; j <= segments; j++) {
        const phi = (j / segments) * Math.PI * 2;
        const co = Math.cos(phi);
        const si = Math.sin(phi);
        ring(b, px + (e0 * co + f0 * si) * R, py + (e1 * co + f1 * si) * R, pz + (e2 * co + f2 * si) * R, -e0 * si + f0 * co, -e1 * si + f1 * co, -e2 * si + f2 * co, r, sides, 0, color, nx, ny, nz);
    }
    joinRings(b, first, segments + 1, sides);
}

/**
 * Something turned on a lathe, standing upright at (x, z): `profile` is [radius, y] from the top down. Faces out, or
 * with `inward` in (the inside of a lamp's shade).
 */
export function lathe(b, x, z, profile, sides, color, inward = false) {
    const first = b.vertexCount;
    for (let j = 0; j < profile.length; j++) {
        const [r, y] = profile[j];
        // The profile's slope here, for the normal.
        const [r0, y0] = profile[Math.max(0, j - 1)];
        const [r1, y1] = profile[Math.min(profile.length - 1, j + 1)];
        // (Down the profile, (dr, dy) turned a quarter, to (−dy, dr), points out.)
        let nr = y0 - y1;
        let ny = r1 - r0;
        const length = Math.hypot(nr, ny) || 1;
        nr /= length;
        ny /= length;
        const flip = inward ? -1 : 1;
        const round = circle(sides);
        for (let k = 0; k <= sides; k++) {
            const c = round[k * 2];
            const s = round[k * 2 + 1];
            b.vertex(x + c * r, y, z + s * r, c * nr * flip, ny * flip, s * nr * flip, 0, 0.5, color);
        }
    }
    const stride = sides + 1;
    for (let j = 0; j < profile.length - 1; j++) {
        for (let k = 0; k < sides; k++) {
            const a = first + j * stride + k;
            if (inward) {
                b.triangle(a, a + stride + 1, a + 1);
                b.triangle(a, a + stride, a + stride + 1);
            } else {
                b.triangle(a, a + 1, a + stride + 1);
                b.triangle(a, a + stride + 1, a + stride);
            }
        }
    }
}

/** A picture from the paint atlas as UVs. @returns {number[]} [u0, v0, u1, v1] */
export function atlasUv([x0, y0, x1, y1]) {
    return [x0 / PAINT_ATLAS_SIZE, 1 - y1 / PAINT_ATLAS_SIZE, x1 / PAINT_ATLAS_SIZE, 1 - y0 / PAINT_ATLAS_SIZE];
}

/**
 * A picture flat on a wall facing (nx, 0, nz), centred at (x, y, z), half-size hw × hh; left to right as you face it.
 */
export function wallPicture(b, x, y, z, nx, nz, hw, hh, rect, color = 0xffffff) {
    const [u0, v0, u1, v1] = atlasUv(rect);
    const rx = nz * hw;
    const rz = -nx * hw;
    b.quad(x - rx, y - hh, z - rz, x + rx, y - hh, z + rz, x + rx, y + hh, z + rz, x - rx, y + hh, z - rz, nx, 0, nz, color, u0, v0, u1, v1);
}

/** A picture flat on the floor, centred at (x, z), half-size hw × hl, turned by `angle`. */
export function floorPicture(b, x, z, hw, hl, angle, rect, y = 0.002, color = 0xffffff) {
    const [u0, v0, u1, v1] = atlasUv(rect);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    b.quad(
        x - hw * cos - hl * sin, y, z - hw * sin + hl * cos,
        x + hw * cos - hl * sin, y, z + hw * sin + hl * cos,
        x + hw * cos + hl * sin, y, z + hw * sin - hl * cos,
        x - hw * cos + hl * sin, y, z - hw * sin - hl * cos,
        0, 1, 0, color, u0, v0, u1, v1,
    );
}

/**
 * A gauge's face, facing (nx, 0, nz): drawn by its own material (see pipeDreamsShading.js), from its texture coordinates
 * (0..1 across it) and its colour, which says where the needle sits and how much it shakes.
 */
export function dial(b, px, py, pz, nx, nz, r, roll) {
    const sides = 12;
    const centre = b.vertex(px, py, pz, nx, 0, nz, 0.5, 0.5, dialColor(roll));
    const first = b.vertexCount;
    const round = circle(sides);
    // Left to right as you face it: (nz, −nx).
    for (let k = 0; k < sides; k++) {
        const c = round[k * 2];
        const s = round[k * 2 + 1];
        b.vertex(px + nz * c * r, py + s * r, pz - nx * c * r, nx, 0, nz, 0.5 + 0.5 * c, 0.5 + 0.5 * s, dialColor(roll));
    }
    for (let k = 0; k < sides; k++) b.triangle(centre, first + k, first + ((k + 1) % sides));
}

/** A gauge's needle, as a colour: where it rests (red), how much it shakes (green), and its own time (blue). */
export function dialColor(roll) {
    const rest = Math.floor(40 + ((roll * 997) % 1) * 200);
    const shake = Math.floor(((roll * 7919) % 1) * 255);
    const phase = Math.floor(roll * 255);
    return (rest << 16) | (shake << 8) | phase;
}

/** A box standing out `depth` from a wall facing (nx, nz), `half` either side of (x, z) along it, from y0 to y1. */
export function boxAround(b, x, z, nx, nz, half, depth, y0, y1, color) {
    const [rx, rz] = [Math.abs(nz), Math.abs(nx)];
    const ax = x - rx * half;
    const bx = x + rx * half + nx * depth;
    const az = z - rz * half;
    const bz = z + rz * half + nz * depth;
    b.box(Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), color);
}

/** A soft shadow under something rectangular: dark under it, fading out past its edges (see chunkGeometry.js). */
export function rectShadow(shade, x, z, hx, hz) {
    const y = 0.0012;
    const u = 3.5 / 4;
    const at = (lx, lz, v) => [x + lx, y, z + lz, 0, 1, 0, u, v];
    const inner = [[-hx + 0.08, -hz + 0.08], [hx - 0.08, -hz + 0.08], [hx - 0.08, hz - 0.08], [-hx + 0.08, hz - 0.08]];
    const outer = [[-hx - 0.12, -hz - 0.12], [hx + 0.12, -hz - 0.12], [hx + 0.12, hz + 0.12], [-hx - 0.12, hz + 0.12]];
    shade.orientedQuad(at(...inner[0], 0), at(...inner[1], 0), at(...inner[2], 0), at(...inner[3], 0));
    for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        shade.orientedQuad(at(...inner[k], 0), at(...outer[k], 1), at(...outer[n], 1), at(...inner[n], 0));
    }
}

/**
 * Something turned on a lathe about any axis: from p along (tx, ty, tz) (unit), `profile` is [radius, distance along]
 * from one end to the other. Its rings turn like a pipe's (see ring). Where the profile turns sharply (a shoulder, a
 * flat end) the edge is hard; elsewhere (a dome) it's smooth.
 */
export function turned(b, px, py, pz, tx, ty, tz, profile, sides, color) {
    ringBasis(tx, ty, tz, _basis);
    const [a0, a1, a2, b0, b1, b2] = _basis;
    const round = circle(sides);
    // Each segment's normal, in the plane of the axis: (out, along).
    const normals = [];
    for (let j = 0; j < profile.length - 1; j++) {
        const dr = profile[j + 1][0] - profile[j][0];
        const dt = profile[j + 1][1] - profile[j][1];
        const length = Math.hypot(dr, dt) || 1;
        normals.push([dt / length, -dr / length]);
    }
    const blend = (j, k) => {
        // The normal at the end of segment j nearest segment k: shared with k where the two meet gently.
        const [o, a] = normals[j];
        if (k < 0 || k >= normals.length) return [o, a];
        const [ok, ak] = normals[k];
        if (o * ok + a * ak < 0.82) return [o, a];
        const length = Math.hypot(o + ok, a + ak) || 1;
        return [(o + ok) / length, (a + ak) / length];
    };
    for (let j = 0; j < normals.length; j++) {
        const first = b.vertexCount;
        for (const [end, [out, along]] of [[j, blend(j, j - 1)], [j + 1, blend(j, j + 1)]]) {
            const [r, t] = profile[end];
            for (let k = 0; k <= sides; k++) {
                const c = round[k * 2];
                const s = round[k * 2 + 1];
                const rx = a0 * c + b0 * s;
                const ry = a1 * c + b1 * s;
                const rz = a2 * c + b2 * s;
                b.vertex(px + tx * t + rx * r, py + ty * t + ry * r, pz + tz * t + rz * r, rx * out + tx * along, ry * out + ty * along, rz * out + tz * along, t, k / sides, color);
            }
        }
        joinRings(b, first, 2, sides);
    }
}

/**
 * A flat convex polygon, its corners in order round it (either way), facing (nx, ny, nz): wound to face that way.
 * `u` and `v`, if given, are each corner's texture coordinates.
 * @param {number[][]} points [x, y, z] each.
 */
export function polygon(b, points, nx, ny, nz, color, u = null, v = null) {
    const [p0, p1, p2] = points;
    const cross = [
        (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]),
        (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]),
        (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]),
    ];
    const flip = cross[0] * nx + cross[1] * ny + cross[2] * nz < 0;
    const first = b.vertexCount;
    for (let n = 0; n < points.length; n++) {
        const k = flip ? points.length - 1 - n : n;
        const [x, y, z] = points[k];
        b.vertex(x, y, z, nx, ny, nz, u?.[k] ?? 0, v?.[k] ?? 0.5, color);
    }
    for (let k = 1; k < points.length - 1; k++) b.triangle(first, first + k, first + k + 1);
}

/**
 * A convex outline in the plane through `origin` spanned by unit `u` and `v`, pushed out `depth` along their normal
 * (u × v): both faces and the sides round it. `outline` is [along u, along v] each, in order round it.
 */
export function extrude(b, origin, u, v, outline, depth, color) {
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const at = ([s, t], d) => [origin[0] + u[0] * s + v[0] * t + n[0] * d, origin[1] + u[1] * s + v[1] * t + n[1] * d, origin[2] + u[2] * s + v[2] * t + n[2] * d];
    polygon(b, outline.map((p) => at(p, depth)), n[0], n[1], n[2], color);
    polygon(b, outline.map((p) => at(p, 0)), -n[0], -n[1], -n[2], color);
    // Which way round the outline goes, so each side's normal points out.
    let area = 0;
    for (let k = 0; k < outline.length; k++) {
        const [s0, t0] = outline[k];
        const [s1, t1] = outline[(k + 1) % outline.length];
        area += s0 * t1 - s1 * t0;
    }
    const turn = area >= 0 ? 1 : -1;
    for (let k = 0; k < outline.length; k++) {
        const p = outline[k];
        const q = outline[(k + 1) % outline.length];
        // The edge's outward normal in the plane: (dt, −ds) for an outline going anticlockwise.
        const ds = q[0] - p[0];
        const dt = q[1] - p[1];
        const length = Math.hypot(ds, dt) || 1;
        const os = (dt / length) * turn;
        const ot = (-ds / length) * turn;
        const normal = [u[0] * os + v[0] * ot, u[1] * os + v[1] * ot, u[2] * os + v[2] * ot];
        polygon(b, [at(p, 0), at(q, 0), at(q, depth), at(p, depth)], normal[0], normal[1], normal[2], color);
    }
}

/** The outline of a slot, a stadium: half-length `half` either side of its middle along s, radius r, in `steps` a side. */
export function stadium(half, r, steps = 6) {
    const points = [];
    for (let k = 0; k <= steps; k++) {
        const angle = -Math.PI / 2 + (k / steps) * Math.PI;
        points.push([half + Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    for (let k = 0; k <= steps; k++) {
        const angle = Math.PI / 2 + (k / steps) * Math.PI;
        points.push([-half + Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    return points;
}

/**
 * A pipe along a path (a cable, a hose): a ring at every point, turned along the path there, joined up, so it bends
 * without a crack. Open at its ends.
 * @param {number[][]} points [x, y, z] each.
 */
export function pathTube(b, points, r, color, sides = 4) {
    const first = b.vertexCount;
    let along = 0;
    for (let k = 0; k < points.length; k++) {
        const prev = points[Math.max(0, k - 1)];
        const next = points[Math.min(points.length - 1, k + 1)];
        const dx = next[0] - prev[0];
        const dy = next[1] - prev[1];
        const dz = next[2] - prev[2];
        const length = Math.hypot(dx, dy, dz) || 1;
        if (k > 0) along += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1], points[k][2] - points[k - 1][2]);
        ring(b, points[k][0], points[k][1], points[k][2], dx / length, dy / length, dz / length, r, sides, along, color);
    }
    joinRings(b, first, points.length, sides);
}

/**
 * A box turned any way: its middle `c`, its three axes `u`, `v`, `w` (unit, square to each other) and half its size
 * along each.
 */
export function orientedBox(b, c, u, v, w, hu, hv, hw, color) {
    const at = (su, sv, sw) => [
        c[0] + u[0] * hu * su + v[0] * hv * sv + w[0] * hw * sw,
        c[1] + u[1] * hu * su + v[1] * hv * sv + w[1] * hw * sw,
        c[2] + u[2] * hu * su + v[2] * hv * sv + w[2] * hw * sw,
    ];
    const faces = [
        [u, (s) => [at(s, -1, -1), at(s, 1, -1), at(s, 1, 1), at(s, -1, 1)]],
        [v, (s) => [at(-1, s, -1), at(1, s, -1), at(1, s, 1), at(-1, s, 1)]],
        [w, (s) => [at(-1, -1, s), at(1, -1, s), at(1, 1, s), at(-1, 1, s)]],
    ];
    for (const [axis, corners] of faces) {
        for (const s of [-1, 1]) polygon(b, corners(s), axis[0] * s, axis[1] * s, axis[2] * s, color);
    }
}
