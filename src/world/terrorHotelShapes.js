import { face4 } from './terrorHotelGeometry.js';

/*
 * The shapes Level 5's furniture is made of that aren't boxes or turned (see terrorHotelFurnishings.js): upholstery with
 * its edges rounded over, tubes bent along a path (a rolled arm, a chair's top rail, a cabriole leg, a scroll of iron),
 * and panels with a shaped top (a headboard's arch, a mirror's crest). All of it lit smooth where it's round.
 */

const HALF_PI = Math.PI / 2;

/**
 * A box with its edges rounded over (a cushion, a mattress, a pillow, an upholstered arm): flat in the middle of each
 * face, and round every edge a quarter circle of radius `r`, in `seg` steps. Square to the axes, from (x0, y0, z0) to
 * (x1, y1, z1); `bottom` false leaves out its underside (it stands on something).
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 */
export function softBox(b, x0, y0, z0, x1, y1, z1, r, color, seg = 1, bottom = true) {
    const middle = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const half = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
    const radius = Math.max(1e-5, Math.min(r, half[0], half[1], half[2]));
    const flat = half.map((h) => Math.max(0, h - radius));
    // Where the rows of corners are across each axis, from the middle: round the low edge, the flat, round the high one.
    const knots = flat.map((m) => {
        const list = [];
        for (let k = seg; k >= 1; k--) list.push(-m - radius * Math.sin((k / seg) * HALF_PI));
        if (m > 1e-6) list.push(-m, m);
        else list.push(0);
        for (let k = 1; k <= seg; k++) list.push(m + radius * Math.sin((k / seg) * HALF_PI));
        return list;
    });
    const p = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
        for (const sign of [-1, 1]) {
            if (axis === 1 && sign < 0 && !bottom) continue;
            // Across the face: u and v, with u × v along the axis.
            const u = (axis + 1) % 3;
            const v = (axis + 2) % 3;
            const us = knots[u];
            const vs = knots[v];
            const first = b.vertexCount;
            for (let j = 0; j < vs.length; j++) {
                for (let i = 0; i < us.length; i++) {
                    p[axis] = sign * half[axis];
                    p[u] = us[i];
                    p[v] = vs[j];
                    // In from it to the flat box inside, and out again along the way from that: round over the edges.
                    const dx = p[0] - clamp(p[0], flat[0]);
                    const dy = p[1] - clamp(p[1], flat[1]);
                    const dz = p[2] - clamp(p[2], flat[2]);
                    const length = Math.hypot(dx, dy, dz) || 1;
                    const nx = dx / length;
                    const ny = dy / length;
                    const nz = dz / length;
                    b.vertex(
                        middle[0] + clamp(p[0], flat[0]) + nx * radius,
                        middle[1] + clamp(p[1], flat[1]) + ny * radius,
                        middle[2] + clamp(p[2], flat[2]) + nz * radius,
                        nx, ny, nz, 0, 0, color,
                    );
                }
            }
            const row = us.length;
            for (let j = 0; j + 1 < vs.length; j++) {
                for (let i = 0; i + 1 < row; i++) {
                    const a = first + j * row + i;
                    if (sign > 0) {
                        b.triangle(a, a + 1, a + row + 1);
                        b.triangle(a, a + row + 1, a + row);
                    } else {
                        b.triangle(a, a + row + 1, a + 1);
                        b.triangle(a, a + row, a + row + 1);
                    }
                }
            }
        }
    }
}

function clamp(value, limit) {
    return value < -limit ? -limit : value > limit ? limit : value;
}

/**
 * A tube along a path (a rolled arm, a bent rail, a cabriole leg, a scroll of iron): a ring of `sides` corners round each
 * point, square to the path there and turned along it as little as it can be, `radius` for all of them or one each;
 * closed at its ends if `caps`.
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 * @param {number[][]} points [x, y, z] each.
 * @param {number | number[]} radius
 */
export function tube(b, points, radius, sides, color, caps = true) {
    const count = points.length;
    if (count < 2) return;
    const r = (k) => (Array.isArray(radius) ? radius[k] : radius);
    const rings = [];
    let u = null;
    for (let k = 0; k < count; k++) {
        const a = points[Math.max(0, k - 1)];
        const c = points[Math.min(count - 1, k + 1)];
        let t = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const tl = Math.hypot(...t) || 1;
        t = t.map((value) => value / tl);
        // Square to the path: the last ring's way out, straightened onto this one's plane (or, to start, anything square).
        let ref = u ?? (Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
        const along = ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2];
        ref = [ref[0] - t[0] * along, ref[1] - t[1] * along, ref[2] - t[2] * along];
        const rl = Math.hypot(...ref) || 1;
        u = ref.map((value) => value / rl);
        // v = t × u: (t, u, v) turn the right way round.
        const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
        rings.push({ t, u, v });
    }
    const first = b.vertexCount;
    for (let k = 0; k < count; k++) {
        const { u, v } = rings[k];
        const [px, py, pz] = points[k];
        for (let s = 0; s <= sides; s++) {
            const angle = (s / sides) * Math.PI * 2;
            const c = Math.cos(angle);
            const sn = Math.sin(angle);
            const nx = u[0] * c + v[0] * sn;
            const ny = u[1] * c + v[1] * sn;
            const nz = u[2] * c + v[2] * sn;
            b.vertex(px + nx * r(k), py + ny * r(k), pz + nz * r(k), nx, ny, nz, 0, 0, color);
        }
    }
    const stride = sides + 1;
    for (let k = 0; k + 1 < count; k++) {
        for (let s = 0; s < sides; s++) {
            const a = first + k * stride + s;
            b.triangle(a, a + 1, a + stride + 1);
            b.triangle(a, a + stride + 1, a + stride);
        }
    }
    if (!caps) return;
    for (const [k, dir] of [[0, -1], [count - 1, 1]]) {
        const { t, u, v } = rings[k];
        const [px, py, pz] = points[k];
        const n = t.map((value) => value * dir);
        const centre = b.vertex(px, py, pz, n[0], n[1], n[2], 0, 0, color);
        for (let s = 0; s <= sides; s++) {
            const angle = (s / sides) * Math.PI * 2;
            const c = Math.cos(angle);
            const sn = Math.sin(angle);
            b.vertex(px + (u[0] * c + v[0] * sn) * r(k), py + (u[1] * c + v[1] * sn) * r(k), pz + (u[2] * c + v[2] * sn) * r(k), n[0], n[1], n[2], 0, 0, color);
        }
        for (let s = 0; s < sides; s++) {
            // (u × v is along the path: wound one way for its end, the other for its start.)
            if (dir > 0) b.triangle(centre, centre + 1 + s, centre + 2 + s);
            else b.triangle(centre, centre + 2 + s, centre + 1 + s);
        }
    }
}

/**
 * Something turned about an upright through (x, z) from height y, up (dir 1) or down (−1), but with flat faces, `sides`
 * of them, lit flat: a lantern's roof, a square base. `profile` is [how far out its corners are, how far along], from its
 * base out; its first corner is `turn` round from +x (π / 4 for a square with its sides along x and z).
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 */
export function faceted(b, x, y, z, profile, sides, color, turn = 0, dir = 1) {
    // (A face's middle is nearer the axis than its corners: its slope across the profile is that much less.)
    const apothem = Math.cos(Math.PI / sides);
    const at = (r, t, a) => [x + Math.cos(a) * r, y + dir * t, z + Math.sin(a) * r];
    for (let k = 0; k < sides; k++) {
        const a0 = turn + (k / sides) * Math.PI * 2;
        const a1 = turn + ((k + 1) / sides) * Math.PI * 2;
        const middle = (a0 + a1) / 2;
        for (let j = 0; j + 1 < profile.length; j++) {
            const [r0, t0] = profile[j];
            const [r1, t1] = profile[j + 1];
            const out = t1 - t0;
            const along = (r0 - r1) * apothem;
            const length = Math.hypot(out, along);
            if (length < 1e-9) continue;
            const n = [(Math.cos(middle) * out) / length, (dir * along) / length, (Math.sin(middle) * out) / length];
            face4(b, [at(r0, t0, a0), at(r0, t0, a1), at(r1, t1, a1), at(r1, t1, a0)], n, color);
        }
    }
}

/** Points along a quadratic curve from a through the pull of c to b (inclusive), `steps` of it. */
export function curve(a, c, b, steps) {
    const points = [];
    for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const s = 1 - t;
        points.push([0, 1, 2].map((axis) => s * s * a[axis] + 2 * s * t * c[axis] + t * t * b[axis]));
    }
    return points;
}

/**
 * A panel standing up, square to a frame's front (see frame in terrorHotelFurnishings.js), from a0 to a1 across and f0
 * to f1 front to back, its foot at y0 and its top shaped: top(a) high at each point across, in `steps`. Its front, back,
 * ends and top; its foot too, if `foot`.
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 * @param {{ at: (a: number, f: number, y: number) => number[], right: number[], front: number[] }} p
 * @param {(a: number) => number} top
 */
export function shapedPanel(b, p, a0, a1, f0, f1, y0, top, steps, color, foot = false) {
    const [rx, rz] = p.right;
    const [fx, fz] = p.front;
    const across = [];
    for (let k = 0; k <= steps; k++) across.push(a0 + ((a1 - a0) * k) / steps);
    for (let k = 0; k < steps; k++) {
        const [s0, s1] = [across[k], across[k + 1]];
        const [t0, t1] = [top(s0), top(s1)];
        for (const [f, dir] of [[f1, 1], [f0, -1]]) {
            face4(b, [p.at(s0, f, y0), p.at(s1, f, y0), p.at(s1, f, t1), p.at(s0, f, t0)], [fx * dir, 0, fz * dir], color);
        }
        // The top: tilted as it slopes.
        const slope = (t1 - t0) / (s1 - s0);
        const length = Math.hypot(slope, 1);
        const [na, ny] = [-slope / length, 1 / length];
        face4(b, [p.at(s0, f0, t0), p.at(s1, f0, t1), p.at(s1, f1, t1), p.at(s0, f1, t0)], [rx * na, ny, rz * na], color);
        if (foot) face4(b, [p.at(s0, f0, y0), p.at(s1, f0, y0), p.at(s1, f1, y0), p.at(s0, f1, y0)], [0, -1, 0], color);
    }
    for (const [a, dir] of [[a0, -1], [a1, 1]]) {
        face4(b, [p.at(a, f0, y0), p.at(a, f1, y0), p.at(a, f1, top(a)), p.at(a, f0, top(a))], [rx * dir, 0, rz * dir], color);
    }
}
