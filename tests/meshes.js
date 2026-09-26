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
 * don't. The meshes are where their positions put them; where each is found goes into `where`, if given.
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
