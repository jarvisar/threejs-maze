import { face4 } from './terrorHotelGeometry.js';

/*
 * Level 5 furniture shapes that aren't boxes or lathe-turned (see terrorHotelFurnishings.js). Rounded boxes, bent
 * tubes and panels with a shaped top. Round parts get smooth normals.
 */

const HALF_PI = Math.PI / 2;

/**
 * Axis-aligned box from (x0, y0, z0) to (x1, y1, z1) with edges rounded to radius `r` in `seg` steps. For cushions,
 * mattresses, pillows. `bottom` false skips the underside.
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 */
export function softBox(b, x0, y0, z0, x1, y1, z1, r, color, seg = 1, bottom = true) {
    const middle = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const half = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
    const radius = Math.max(1e-5, Math.min(r, half[0], half[1], half[2]));
    const flat = half.map((h) => Math.max(0, h - radius));
    // vertex rows along each axis: low rounded edge, flat part, high rounded edge
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
            // u and v span the face, with u × v along the axis.
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
                    // Clamp to the inner flat box, then push out by radius along the offset. That rounds the edge.
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
 * Tube along a path (rolled arm, bent rail, cabriole leg, iron scroll). A ring of `sides` points at each path point,
 * with as little twist as possible. `radius` is one value or one per point. `caps` closes the ends.
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
        // project the last ring's u onto this ring's plane (any perpendicular for the first ring)
        let ref = u ?? (Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
        const along = ref[0] * t[0] + ref[1] * t[1] + ref[2] * t[2];
        ref = [ref[0] - t[0] * along, ref[1] - t[1] * along, ref[2] - t[2] * along];
        const rl = Math.hypot(...ref) || 1;
        u = ref.map((value) => value / rl);
        // v = t × u so the frame is right-handed
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
            // u × v points along the path, so the start cap winds the other way
            if (dir > 0) b.triangle(centre, centre + 1 + s, centre + 2 + s);
            else b.triangle(centre, centre + 2 + s, centre + 1 + s);
        }
    }
}

/**
 * Like a lathe shape but with `sides` flat faces, lit flat (lantern roof, square base). Upright axis through (x, z),
 * starting at y and going up (dir 1) or down (-1). `profile` is [radius, height] pairs from the base.
 * `turn` is the first corner's angle from +x (pi / 4 for a square aligned to x and z).
 * @param {import('./ColorBuilder.js').ColorBuilder} b
 */
export function faceted(b, x, y, z, profile, sides, color, turn = 0, dir = 1) {
    // Face middles are closer to the axis than the corners, so the normal's slope is scaled down.
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

/** Quadratic bezier points from a to b (inclusive) with control point c, `steps` segments. */
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
 * Upright panel in a frame's space (see frame in terrorHotelFurnishings.js), a0..a1 across and f0..f1 deep, from y0 up
 * to top(a), in `steps`. For headboards and mirror crests. Adds the bottom face only if `foot`.
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
        // top face, normal tilted with the slope
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
