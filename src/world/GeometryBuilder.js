import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Collects quads straight into typed arrays. A new chunk is meshed every few frames while you walk, so the
 * builders are reused rather than filling fresh JS arrays each time; the only allocations per chunk are the
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
 * A quad on the vertical plane `axis` = `plane` (axis 0: x = plane; axis 1: z = plane), from `left` to
 * `rightEnd` along the other horizontal axis and y0 to y1 up, with the UV rectangle (u0, v0) → (u1, v1).
 */
export function verticalQuad(builder, axis, plane, left, rightEnd, y0, y1, nx, nz, u0, v0, u1, v1) {
    if (axis === 0) builder.quad(plane, y0, left, plane, y0, rightEnd, plane, y1, rightEnd, plane, y1, left, nx, 0, nz, u0, v0, u1, v1);
    else builder.quad(left, y0, plane, rightEnd, y0, plane, rightEnd, y1, plane, left, y1, plane, nx, 0, nz, u0, v0, u1, v1);
}
