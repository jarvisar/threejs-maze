import { BufferAttribute, BufferGeometry } from 'three';

// The corners of the patch being added (see GeometryBuilder.patch), and the one being worked out.
let patchGrid = new Float32Array(8 * 64);
const patchCorner = new Float32Array(8);

/**
 * Collects quads straight into typed arrays. A new chunk is meshed every few frames while you walk, so the
 * builders are reused rather than filling fresh JS arrays each time. The only allocations per chunk are the
 * final, exactly sized arrays handed to the GPU. (Meshing used to make thousands of small temporary arrays,
 * and on phones the time spent on those, and collecting them afterwards, showed up as stutter.)
 */
export class GeometryBuilder {
    constructor() {
        this.positions = new Float32Array(3 * 1024);
        this.normals = new Float32Array(3 * 1024);
        this.uvs = new Float32Array(2 * 1024);
        this.vertexCount = 0;
    }

    /** Empties the builder for the next chunk. */
    reset() {
        this.vertexCount = 0;
        return this;
    }

    /** Adds one corner of a quad. Every quad is four of these, counter-clockwise as seen from the front. */
    vertex(x, y, z, nx, ny, nz, u, v) {
        if (this.vertexCount === this.uvs.length / 2) this._grow();
        const i = this.vertexCount++;
        this.positions[i * 3] = x;
        this.positions[i * 3 + 1] = y;
        this.positions[i * 3 + 2] = z;
        this.normals[i * 3] = nx;
        this.normals[i * 3 + 1] = ny;
        this.normals[i * 3 + 2] = nz;
        this.uvs[i * 2] = u;
        this.uvs[i * 2 + 1] = v;
    }

    /**
     * Adds a quad given its corners counter-clockwise from bottom-left (as seen from the front),
     * a shared normal, and the UV rectangle (u0, v0) → (u1, v1).
     */
    quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, u0, v0, u1, v1) {
        this.vertex(ax, ay, az, nx, ny, nz, u0, v0);
        this.vertex(bx, by, bz, nx, ny, nz, u1, v0);
        this.vertex(cx, cy, cz, nx, ny, nz, u1, v1);
        this.vertex(dx, dy, dz, nx, ny, nz, u0, v1);
    }

    /**
     * Adds a quad from four corners in order around it, each [x, y, z, nx, ny, nz, u, v], facing the way
     * their normals point (the corners are put in the right winding order whichever way round they come).
     * For curved surfaces, where every corner has its own normal.
     * @param {number[]} a
     * @param {number[]} b
     * @param {number[]} c
     * @param {number[]} d
     */
    orientedQuad(a, b, c, d) {
        // Which way (b − a) × (c − a) points, against the corners' normals.
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        const facing = (uy * vz - uz * vy) * (a[3] + b[3] + c[3] + d[3])
            + (uz * vx - ux * vz) * (a[4] + b[4] + c[4] + d[4])
            + (ux * vy - uy * vx) * (a[5] + b[5] + c[5] + d[5]);
        for (const corner of facing >= 0 ? [a, b, c, d] : [a, d, c, b]) this.vertex(...corner);
    }

    /**
     * Adds a curved surface as a grid of quads, `stepsI` by `stepsJ`: `corner(i, j, out)` fills `out` with the grid's
     * corner (i, j), for i from 0 to stepsI and j from 0 to stepsJ, as [x, y, z, nx, ny, nz, u, v]. Like orientedQuad,
     * each quad faces the way its corners' normals point.
     * @param {number} stepsI
     * @param {number} stepsJ
     * @param {(i: number, j: number, out: Float32Array) => void} corner
     */
    patch(stepsI, stepsJ, corner) {
        const stride = stepsJ + 1;
        const size = 8 * (stepsI + 1) * stride;
        if (patchGrid.length < size) patchGrid = new Float32Array(size * 2);
        for (let i = 0; i <= stepsI; i++) {
            for (let j = 0; j <= stepsJ; j++) {
                corner(i, j, patchCorner);
                patchGrid.set(patchCorner, 8 * (i * stride + j));
            }
        }
        for (let i = 0; i < stepsI; i++) {
            for (let j = 0; j < stepsJ; j++) {
                const a = 8 * (i * stride + j);
                const b = a + 8 * stride;
                this._gridQuad(a, b, b + 8, a + 8);
            }
        }
    }

    /**
     * One quad of a patch, from the corners at these offsets in patchGrid, in order round it. Which way it faces is
     * worked out across its diagonals, which still works where two of its corners are one point (a patch that comes to
     * a point, like the top of a dome).
     */
    _gridQuad(a, b, c, d) {
        const g = patchGrid;
        const ux = g[c] - g[a];
        const uy = g[c + 1] - g[a + 1];
        const uz = g[c + 2] - g[a + 2];
        const vx = g[d] - g[b];
        const vy = g[d + 1] - g[b + 1];
        const vz = g[d + 2] - g[b + 2];
        const facing = (uy * vz - uz * vy) * (g[a + 3] + g[b + 3] + g[c + 3] + g[d + 3])
            + (uz * vx - ux * vz) * (g[a + 4] + g[b + 4] + g[c + 4] + g[d + 4])
            + (ux * vy - uy * vx) * (g[a + 5] + g[b + 5] + g[c + 5] + g[d + 5]);
        this._gridVertex(a);
        if (facing >= 0) {
            this._gridVertex(b);
            this._gridVertex(c);
            this._gridVertex(d);
        } else {
            this._gridVertex(d);
            this._gridVertex(c);
            this._gridVertex(b);
        }
    }

    _gridVertex(k) {
        const g = patchGrid;
        this.vertex(g[k], g[k + 1], g[k + 2], g[k + 3], g[k + 4], g[k + 5], g[k + 6], g[k + 7]);
    }

    _grow() {
        const grow = (array) => {
            const larger = new Float32Array(array.length * 2);
            larger.set(array);
            return larger;
        };
        this.positions = grow(this.positions);
        this.normals = grow(this.normals);
        this.uvs = grow(this.uvs);
    }

    /** @returns {BufferGeometry | null} */
    build() {
        const vertices = this.vertexCount;
        if (vertices === 0) return null;
        // Every quad is four vertices and two triangles: (0, 1, 2) and (0, 2, 3).
        const quads = vertices / 4;
        const indices = vertices > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
        for (let q = 0; q < quads; q++) {
            const base = q * 4;
            const i = q * 6;
            indices[i] = base;
            indices[i + 1] = base + 1;
            indices[i + 2] = base + 2;
            indices[i + 3] = base;
            indices[i + 4] = base + 2;
            indices[i + 5] = base + 3;
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(this.positions.slice(0, vertices * 3), 3));
        geometry.setAttribute('normal', new BufferAttribute(this.normals.slice(0, vertices * 3), 3));
        geometry.setAttribute('uv', new BufferAttribute(this.uvs.slice(0, vertices * 2), 2));
        geometry.setIndex(new BufferAttribute(indices, 1));
        geometry.computeBoundingSphere();
        return geometry;
    }
}

/**
 * A quad on the vertical plane `axis` = `plane` (axis 0: x = plane, axis 1: z = plane), from `left` to
 * `rightEnd` along the other horizontal axis and y0 to y1 up, with the UV rectangle (u0, v0) → (u1, v1).
 */
export function verticalQuad(builder, axis, plane, left, rightEnd, y0, y1, nx, nz, u0, v0, u1, v1) {
    if (axis === 0) builder.quad(plane, y0, left, plane, y0, rightEnd, plane, y1, rightEnd, plane, y1, left, nx, 0, nz, u0, v0, u1, v1);
    else builder.quad(left, y0, plane, rightEnd, y0, plane, rightEnd, y1, plane, left, y1, plane, nx, 0, nz, u0, v0, u1, v1);
}

/**
 * A copy of an indexed geometry turned inside out: facing the other way, and lit from that side. For the inside of
 * something open (a bucket), which, drawn from outside only, would be seen straight through from above.
 * @param {BufferGeometry} geometry
 * @returns {BufferGeometry}
 */
export function insideOut(geometry) {
    const flipped = geometry.clone();
    const normals = flipped.attributes.normal;
    for (let i = 0; i < normals.count; i++) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
    const index = flipped.index.array;
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    return flipped;
}
