/**
 * How many of a mesh's triangles face against the normals at their corners (seen from the side their normals point
 * to, they'd be culled). Triangles with no area (where a surface comes to a point) don't count.
 * @param {import('three').BufferGeometry} geometry
 */
export function misfacing(geometry) {
    const p = geometry.attributes.position.array;
    const n = geometry.attributes.normal.array;
    const index = geometry.index.array;
    let wrong = 0;
    for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
        const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
        const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const area = Math.hypot(...cross);
        if (area < 1e-9) continue;
        const along = cross[0] * (n[a] + n[b] + n[c]) + cross[1] * (n[a + 1] + n[b + 1] + n[c + 1]) + cross[2] * (n[a + 2] + n[b + 2] + n[c + 2]);
        if (along <= 0) wrong++;
    }
    return wrong;
}

/**
 * How many corners of the level (flat and horizontal) triangles of some meshes are partway along an edge of another,
 * at the same height: a T-junction, where the two don't share the corner and, drawn, can leave a pinhole between them.
 * Only edges along x or z count, as floors and ceilings are built, and triangles with no area (which draw nothing)
 * don't. The meshes are where their positions put them, and where each is found goes into `where`, if given.
 * @param {import('three').Mesh[]} meshes
 * @param {number[][]} [where]
 */
export function tJunctions(meshes, where = null) {
    const at = (value) => Math.round(value * 1e4);
    // The edges on each line along x (keyed by its y and z) or along z (by its y and x): [from, to] along it.
    const lines = new Map();
    const corners = new Map();
    for (const mesh of meshes) {
        const p = mesh.geometry.attributes.position.array;
        const index = mesh.geometry.index.array;
        const { x: ox, y: oy, z: oz } = mesh.position;
        const corner = (i) => [p[i * 3] + ox, p[i * 3 + 1] + oy, p[i * 3 + 2] + oz];
        for (let t = 0; t < index.length; t += 3) {
            const triangle = [corner(index[t]), corner(index[t + 1]), corner(index[t + 2])];
            if (triangle.some((v) => at(v[1]) !== at(triangle[0][1]))) continue;
            const [a, b, c] = triangle;
            if (Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) < 1e-9) continue;
            for (let k = 0; k < 3; k++) {
                const a = triangle[k];
                const b = triangle[(k + 1) % 3];
                corners.set(a.map(at).join(), a);
                const alongX = at(a[2]) === at(b[2]);
                if (alongX === (at(a[0]) === at(b[0]))) continue;
                const key = alongX ? `x ${at(a[1])} ${at(a[2])}` : `z ${at(a[1])} ${at(a[0])}`;
                const [s0, s1] = alongX ? [a[0], b[0]] : [a[2], b[2]];
                if (!lines.has(key)) lines.set(key, []);
                lines.get(key).push([Math.min(s0, s1), Math.max(s0, s1)]);
            }
        }
    }
    let found = 0;
    for (const [x, y, z] of corners.values()) {
        const inside = (key, s) => lines.get(key)?.some(([s0, s1]) => s > s0 + 1e-4 && s < s1 - 1e-4) ?? false;
        if (inside(`x ${at(y)} ${at(z)}`, x) || inside(`z ${at(y)} ${at(x)}`, z)) {
            found++;
            where?.push([x, y, z]);
        }
    }
    return found;
}

/**
 * Where two of the meshes' triangles lie in one plane, facing the same way, and overlap: drawn, the two fight over
 * every pixel they share and flicker. Only overlaps bigger than `minArea` count (two triangles sharing an edge overlap
 * by nothing). The meshes are where their positions put them, each overlap found goes into `where` as the middle of it
 * and the two meshes' names, if given.
 * @param {import('three').Mesh[]} meshes
 * @param {object} [options]
 * @param {number} [options.minArea]
 * @param {{at: number[], names: string[]}[] | null} [options.where]
 * @param {((at: number[], normal: number[]) => boolean) | null} [options.skip] Leaves out overlaps that can't be seen
 *     (the undersides of things on the floor).
 * @param {((mesh: import('three').Mesh, corners: number[]) => string | null) | null} [options.look] What a triangle (its
 *     three vertex indices) looks like, where it's all one flat colour, else null: two alike draw the same pixels, and
 *     their fighting can't be seen.
 */
export function coplanarOverlaps(meshes, { minArea = 2e-6, where = null, skip = null, look = null } = {}) {
    // Every triangle: its corners, its plane (unit normal and distance) and its mesh.
    const triangles = [];
    for (const mesh of meshes) {
        const p = mesh.geometry.attributes.position.array;
        const index = mesh.geometry.index?.array;
        const count = index ? index.length : p.length / 3;
        const { x: ox, y: oy, z: oz } = mesh.position;
        for (let t = 0; t < count; t += 3) {
            const ids = [0, 1, 2].map((k) => (index ? index[t + k] : t + k));
            const corners = ids.map((i) => [p[i * 3] + ox, p[i * 3 + 1] + oy, p[i * 3 + 2] + oz]);
            const [a, b, c] = corners;
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const length = Math.hypot(...n);
            if (length < 1e-9) continue;
            const normal = n.map((value) => value / length);
            const box = [0, 1, 2].map((axis) => [Math.min(a[axis], b[axis], c[axis]), Math.max(a[axis], b[axis], c[axis])]);
            const alike = look?.(mesh, ids) ?? null;
            triangles.push({ corners, normal, d: normal[0] * a[0] + normal[1] * a[1] + normal[2] * a[2], box, name: mesh.name, look: alike === null ? null : `${mesh.name} ${alike}` });
        }
    }
    // Grouped by plane, with a little slack for rounding (a neighbouring group is looked in too).
    const planes = new Map();
    const key = (tri) => `${tri.normal.map((value) => Math.round(value * 500)).join()} ${Math.floor(tri.d / 0.002)}`;
    for (const tri of triangles) {
        const k = key(tri);
        if (!planes.has(k)) planes.set(k, []);
        planes.get(k).push(tri);
    }
    let found = 0;
    const test = (a, b) => {
        if (a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2] < 0.99999) return;
        // How far b is off a's plane, measured from a's own corner (its distance from the origin, for a thin triangle far
        // out, is only as good as the rounding of its corners allows).
        const [a0] = a.corners;
        const off = (p) => Math.abs(a.normal[0] * (p[0] - a0[0]) + a.normal[1] * (p[1] - a0[1]) + a.normal[2] * (p[2] - a0[2]));
        if (Math.max(...b.corners.map(off)) > 5e-4) return;
        if (a.look !== null && a.look === b.look) return;
        // In the plane, as seen from the side it faces (the axis it faces most along dropped).
        const [nx, ny, nz] = a.normal.map(Math.abs);
        const drop = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
        const flat = (tri) => {
            const points = tri.corners.map((p) => p.filter((_, axis) => axis !== drop));
            return area(points) < 0 ? points.reverse() : points;
        };
        const shared = clip(flat(a), flat(b));
        const size = shared.length < 3 ? 0 : Math.abs(area(shared));
        if (size <= minArea) return;
        const middle = [0, 1].map((axis) => shared.reduce((sum, p) => sum + p[axis], 0) / shared.length);
        // Back into 3D, on a's plane.
        const at = [0, 0, 0];
        const others = [0, 1, 2].filter((axis) => axis !== drop);
        at[others[0]] = middle[0];
        at[others[1]] = middle[1];
        at[drop] = (a.d - a.normal[others[0]] * middle[0] - a.normal[others[1]] * middle[1]) / a.normal[drop];
        if (skip?.(at, a.normal)) return;
        found++;
        where?.push({ at, names: [a.name, b.name] });
    };
    for (const [k, group] of planes) {
        const [normal, bin] = k.split(' ');
        const next = planes.get(`${normal} ${Number(bin) + 1}`) ?? [];
        // Each of the group against the rest of it and the next one along (not those two of the next one's, which are its
        // own to look at): swept along an axis in the plane, so only those that meet along it are compared at all.
        const [nx, ny, nz] = group[0].normal.map(Math.abs);
        const axis = nx >= ny && nx >= nz ? 1 : 0;
        const all = [...group.map((tri) => ({ tri, own: true })), ...next.map((tri) => ({ tri, own: false }))];
        all.sort((a, b) => a.tri.box[axis][0] - b.tri.box[axis][0]);
        for (let i = 0; i < all.length; i++) {
            const a = all[i];
            const end = a.tri.box[axis][1] + 1e-3;
            for (let j = i + 1; j < all.length && all[j].tri.box[axis][0] <= end; j++) {
                const b = all[j];
                if (!a.own && !b.own) continue;
                // (In the order the pairs always were: this group's first.)
                const [first, second] = a.own ? [a.tri, b.tri] : [b.tri, a.tri];
                if (touches(first.box, second.box)) test(first, second);
            }
        }
    }
    return found;
}

function touches(a, b) {
    return a.every(([min, max], axis) => min <= b[axis][1] + 1e-3 && b[axis][0] <= max + 1e-3);
}

/** The signed area of a polygon (anticlockwise positive). */
function area(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        sum += x0 * y1 - x1 * y0;
    }
    return sum / 2;
}

/** The part of polygon `subject` inside convex polygon `window` (both anticlockwise). */
function clip(subject, window) {
    let out = subject;
    for (let i = 0; i < window.length && out.length > 0; i++) {
        const [ax, ay] = window[i];
        const [bx, by] = window[(i + 1) % window.length];
        const side = (p) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
        const input = out;
        out = [];
        for (let j = 0; j < input.length; j++) {
            const current = input[j];
            const previous = input[(j + input.length - 1) % input.length];
            const sc = side(current);
            const sp = side(previous);
            if ((sc >= 0) !== (sp >= 0)) {
                const s = sp / (sp - sc);
                out.push([previous[0] + (current[0] - previous[0]) * s, previous[1] + (current[1] - previous[1]) * s]);
            }
            if (sc >= 0) out.push(current);
        }
    }
    return out;
}
