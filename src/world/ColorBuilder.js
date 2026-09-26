import { BufferAttribute, BufferGeometry } from 'three';
import { GLYPH_TEXTURE } from './levelOneTextures.js';
import { PROP_ATLAS, PROP_ATLAS_HEIGHT, PROP_ATLAS_WIDTH } from './props.js';

/*
 * Coloured triangles for a level's own meshes (Level 1's and Level 37's; see levelOneGeometry.js and
 * poolroomsGeometry.js): boxes, cylinders, pictures from the props texture, stencils, and the glows round lights.
 */

// ---------------------------------------------------------------------------------------------- building

// The plain white corner of the props texture, for parts coloured by their vertices alone.
const PLAIN_U = ((PROP_ATLAS.plain[0] + PROP_ATLAS.plain[2]) / 2) / PROP_ATLAS_WIDTH;
const PLAIN_V = 1 - ((PROP_ATLAS.plain[1] + PROP_ATLAS.plain[3]) / 2) / PROP_ATLAS_HEIGHT;

/** How many numbers each kind of second attribute has per vertex (see ColorBuilder). */
const EXTRA_SIZE = { lamp: 2, glow: 4, drift: 4 };

/**
 * Collects coloured triangles into typed arrays, reused from chunk to chunk (like GeometryBuilder, but with a colour
 * per vertex, and optionally a second attribute: a tube's lamp, a glow's size and source, or how something floating
 * drifts). Like GeometryBuilder, it makes nothing per vertex or per face: the only allocations are the final arrays
 * handed to the GPU.
 */
export class ColorBuilder {
    /** @param {'lamp' | 'glow' | 'drift' | null} extra */
    constructor(extra = null) {
        this.extra = extra;
        this.extraSize = EXTRA_SIZE[extra] ?? 2;
        this.size = 1024;
        this.positions = new Float32Array(this.size * 3);
        this.normals = new Float32Array(this.size * 3);
        this.uvs = new Float32Array(this.size * 2);
        this.colors = new Float32Array(this.size * 3);
        this.extras = new Float32Array(this.size * this.extraSize);
        this.corners = new Float32Array(this.size * 2);
        this.indices = new Uint32Array(this.size * 3);
        this.vertexCount = 0;
        this.indexCount = 0;
        this._lampPattern = 0;
        this._lampBrightness = 1;
        this._drift = [0, 0, 0, 0];
    }

    reset() {
        this.vertexCount = 0;
        this.indexCount = 0;
        return this;
    }

    /** The lamp the tubes added from now on belong to: its flicker pattern (0..1) and brightness. */
    lamp(pattern, brightness) {
        this._lampPattern = pattern;
        this._lampBrightness = brightness;
    }

    /**
     * What the floating thing added from now on is (see the float material in poolroomsMaterials.js): its middle,
     * where it is in its bobbing, and how fast it turns.
     */
    drift(x, z, phase, spin) {
        this._drift[0] = x;
        this._drift[1] = z;
        this._drift[2] = phase;
        this._drift[3] = spin;
    }

    _grow() {
        this.size *= 2;
        const grow = (array, per) => {
            const larger = new Float32Array(this.size * per);
            larger.set(array);
            return larger;
        };
        this.positions = grow(this.positions, 3);
        this.normals = grow(this.normals, 3);
        this.uvs = grow(this.uvs, 2);
        this.colors = grow(this.colors, 3);
        this.extras = grow(this.extras, this.extraSize);
        this.corners = grow(this.corners, 2);
    }

    vertex(x, y, z, nx, ny, nz, u, v, color) {
        if (this.vertexCount === this.size) this._grow();
        const i = this.vertexCount++;
        this.positions[i * 3] = x;
        this.positions[i * 3 + 1] = y;
        this.positions[i * 3 + 2] = z;
        this.normals[i * 3] = nx;
        this.normals[i * 3 + 1] = ny;
        this.normals[i * 3 + 2] = nz;
        this.uvs[i * 2] = u;
        this.uvs[i * 2 + 1] = v;
        this.colors[i * 3] = ((color >> 16) & 255) / 255;
        this.colors[i * 3 + 1] = ((color >> 8) & 255) / 255;
        this.colors[i * 3 + 2] = (color & 255) / 255;
        if (this.extra === 'lamp') {
            this.extras[i * 2] = this._lampPattern;
            this.extras[i * 2 + 1] = this._lampBrightness;
        } else if (this.extra === 'drift') {
            for (let k = 0; k < 4; k++) this.extras[i * 4 + k] = this._drift[k];
        }
        return i;
    }

    triangle(a, b, c) {
        if (this.indexCount + 3 > this.indices.length) {
            const larger = new Uint32Array(this.indices.length * 2);
            larger.set(this.indices);
            this.indices = larger;
        }
        const k = this.indexCount;
        this.indices[k] = a;
        this.indices[k + 1] = b;
        this.indices[k + 2] = c;
        this.indexCount = k + 3;
    }

    /**
     * A quad from four corners counter-clockwise as seen from the front, all with the same normal, with the picture
     * (u0, v0) → (u1, v1) across it (by default the plain white, for parts coloured by their vertices alone).
     */
    quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, color, u0 = PLAIN_U, v0 = PLAIN_V, u1 = PLAIN_U, v1 = PLAIN_V) {
        const first = this.vertex(ax, ay, az, nx, ny, nz, u0, v0, color);
        this.vertex(bx, by, bz, nx, ny, nz, u1, v0, color);
        this.vertex(cx, cy, cz, nx, ny, nz, u1, v1, color);
        this.vertex(dx, dy, dz, nx, ny, nz, u0, v1, color);
        this.triangle(first, first + 1, first + 2);
        this.triangle(first, first + 2, first + 3);
    }

    /**
     * An axis-aligned box. `round` bevels its top edges in by that much (a car cover's, a car's glass).
     */
    box(x0, y0, z0, x1, y1, z1, color, round = 0) {
        const t = round;
        // Top (inset by the rounding), then the sides, sloping in to it, then the bottom.
        this.quad(x0 + t, y1, z1 - t, x1 - t, y1, z1 - t, x1 - t, y1, z0 + t, x0 + t, y1, z0 + t, 0, 1, 0, color);
        // A sloping side's normal leans up by half: (out, 0.5), normalised.
        const out = t > 0 ? 1 / Math.hypot(1, 0.5) : 1;
        const up = t > 0 ? 0.5 * out : 0;
        this.quad(x0, y0, z1, x1, y0, z1, x1 - t, y1, z1 - t, x0 + t, y1, z1 - t, 0, up, out, color);
        this.quad(x1, y0, z0, x0, y0, z0, x0 + t, y1, z0 + t, x1 - t, y1, z0 + t, 0, up, -out, color);
        this.quad(x1, y0, z1, x1, y0, z0, x1 - t, y1, z0 + t, x1 - t, y1, z1 - t, out, up, 0, color);
        this.quad(x0, y0, z0, x0, y0, z1, x0 + t, y1, z1 - t, x0 + t, y1, z0 + t, -out, up, 0, color);
        this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0, color);
    }

    /**
     * A cylinder along an axis (0: x, 1: y, 2: z) from `from` to `to`, its middle at (x, y, z) in the other two, with
     * end caps. `squash` flattens it top to bottom (a flat tyre).
     */
    cylinder(axis, a, b, c, to, radius, sides, color, squash = 1) {
        // (a, b, c) is the start: for axis 0 that's (from, y, z); axis 1 (x, from, z); axis 2 (x, y, from).
        const from = axis === 0 ? a : axis === 1 ? b : c;
        const first = this.vertexCount;
        for (let k = 0; k <= sides; k++) {
            const angle = (k / sides) * Math.PI * 2;
            const u = Math.cos(angle);
            const w = Math.sin(angle);
            // Straight out from the axis: (0, w, u) round x, (u, 0, w) round y, (u, w, 0) round z.
            const nx = axis === 0 ? 0 : u;
            const ny = axis === 1 ? 0 : w;
            const nz = axis === 0 ? u : axis === 1 ? w : 0;
            this._around(axis, a, b, c, from, u, w, radius, squash, nx, ny, nz, color);
            this._around(axis, a, b, c, to, u, w, radius, squash, nx, ny, nz, color);
        }
        // Wound so the outside faces out, whichever axis (the angle runs the other way round x and y).
        const flip = axis !== 2;
        for (let k = 0; k < sides; k++) {
            const i = first + k * 2;
            if (flip) {
                this.triangle(i, i + 1, i + 3);
                this.triangle(i, i + 3, i + 2);
            } else {
                this.triangle(i, i + 2, i + 3);
                this.triangle(i, i + 3, i + 1);
            }
        }
        // Caps.
        for (let end = 0; end < 2; end++) {
            const t = end === 0 ? from : to;
            const sign = end === 0 ? -1 : 1;
            const nx = axis === 0 ? sign : 0;
            const ny = axis === 1 ? sign : 0;
            const nz = axis === 2 ? sign : 0;
            const centre = this._around(axis, a, b, c, t, 1, 0, 0, squash, nx, ny, nz, color);
            const ring = this.vertexCount;
            for (let k = 0; k < sides; k++) {
                const angle = (k / sides) * Math.PI * 2;
                this._around(axis, a, b, c, t, Math.cos(angle), Math.sin(angle), radius, squash, nx, ny, nz, color);
            }
            for (let k = 0; k < sides; k++) {
                const p = ring + k;
                const q = ring + ((k + 1) % sides);
                if ((sign > 0) !== flip) this.triangle(centre, p, q);
                else this.triangle(centre, q, p);
            }
        }
    }

    /** A vertex of a cylinder (see cylinder): `t` along its axis, and (u, w) times r round it. */
    _around(axis, a, b, c, t, u, w, r, squash, nx, ny, nz, color) {
        if (axis === 0) return this.vertex(t, b + w * r * squash, c + u * r, nx, ny, nz, PLAIN_U, PLAIN_V, color);
        if (axis === 1) return this.vertex(a + u * r, t, c + w * r, nx, ny, nz, PLAIN_U, PLAIN_V, color);
        return this.vertex(a + u * r, b + w * r * squash, t, nx, ny, nz, PLAIN_U, PLAIN_V, color);
    }

    /** A picture from the props texture, flat on the plane z = `z`, facing +z (normalZ 1) or −z. */
    picture(x0, y0, z, x1, y1, _nx, normalZ, [px0, py0, px1, py1]) {
        const u0 = px0 / PROP_ATLAS_WIDTH;
        const u1 = px1 / PROP_ATLAS_WIDTH;
        const v0 = 1 - py1 / PROP_ATLAS_HEIGHT;
        const v1 = 1 - py0 / PROP_ATLAS_HEIGHT;
        if (normalZ > 0) this.quad(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, 0, 0, 1, 0xffffff, u0, v0, u1, v1);
        else this.quad(x1, y0, z, x0, y0, z, x0, y1, z, x1, y1, z, 0, 0, -1, 0xffffff, u0, v0, u1, v1);
    }

    /** Turns everything added since vertex `start` by yaw about y, then moves it by (dx, dz). */
    transform(start, yaw, dx, dz) {
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        for (let i = start; i < this.vertexCount; i++) {
            const x = this.positions[i * 3];
            const z = this.positions[i * 3 + 2];
            this.positions[i * 3] = x * cos + z * sin + dx;
            this.positions[i * 3 + 2] = z * cos - x * sin + dz;
            const nx = this.normals[i * 3];
            const nz = this.normals[i * 3 + 2];
            this.normals[i * 3] = nx * cos + nz * sin;
            this.normals[i * 3 + 2] = nz * cos - nx * sin;
        }
    }

    /**
     * A stencil on a vertical face whose normal is (nx, 0, nz), centred at (x, y, z), half-size hw × hh, showing
     * `rect` of the glyph texture.
     */
    decal(x, y, z, nx, nz, hw, hh, [gx0, gy0, gx1, gy1], color) {
        // Left to right, looking at it: (nz, −nx).
        const rx = nz * hw;
        const rz = -nx * hw;
        this.quad(
            x - rx, y - hh, z - rz,
            x + rx, y - hh, z + rz,
            x + rx, y + hh, z + rz,
            x - rx, y + hh, z - rz,
            nx, 0, nz, color,
            gx0 / GLYPH_TEXTURE, 1 - gy1 / GLYPH_TEXTURE, gx1 / GLYPH_TEXTURE, 1 - gy0 / GLYPH_TEXTURE,
        );
    }

    /** Paint on the floor, centred at (x, z), half-size hw × hl, turned by `angle`. */
    floorDecal(x, z, hw, hl, angle, [gx0, gy0, gx1, gy1], color) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const y = 0.0025;
        // The corners (∓hw, ±hl), turned: (u cos − v sin, u sin + v cos).
        this.quad(
            x - hw * cos - hl * sin, y, z - hw * sin + hl * cos,
            x + hw * cos - hl * sin, y, z + hw * sin + hl * cos,
            x + hw * cos + hl * sin, y, z + hw * sin - hl * cos,
            x - hw * cos + hl * sin, y, z - hw * sin - hl * cos,
            0, 1, 0, color,
            gx0 / GLYPH_TEXTURE, 1 - gy1 / GLYPH_TEXTURE, gx1 / GLYPH_TEXTURE, 1 - gy0 / GLYPH_TEXTURE,
        );
    }

    /**
     * A glow (see the glow material in materials.js): a quad the vertex shader turns to face the camera.
     * @param {number} size Its radius.
     * @param {number} source Its own flicker pattern (0..1), or −1 to follow its light slot.
     * @param {number} brightness
     * @param {number} stretch How much taller than wide.
     */
    spot(x, y, z, size, source, brightness, stretch) {
        const first = this.vertexCount;
        for (let k = 0; k < 4; k++) {
            const i = this.vertex(x, y, z, 0, 0, 1, 0, 0, 0xffffff);
            this.corners[i * 2] = SPOT_CORNERS[k * 2];
            this.corners[i * 2 + 1] = SPOT_CORNERS[k * 2 + 1];
            this.extras[i * 4] = size;
            this.extras[i * 4 + 1] = source;
            this.extras[i * 4 + 2] = brightness;
            this.extras[i * 4 + 3] = stretch;
        }
        this.triangle(first, first + 1, first + 2);
        this.triangle(first, first + 2, first + 3);
    }

    /** @returns {BufferGeometry | null} */
    build() {
        const count = this.vertexCount;
        if (count === 0) return null;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(this.positions.slice(0, count * 3), 3));
        if (this.extra === 'glow') {
            geometry.setAttribute('corner', new BufferAttribute(this.corners.slice(0, count * 2), 2));
            geometry.setAttribute('glow', new BufferAttribute(this.extras.slice(0, count * 4), 4));
        } else {
            geometry.setAttribute('normal', new BufferAttribute(this.normals.slice(0, count * 3), 3));
            geometry.setAttribute('uv', new BufferAttribute(this.uvs.slice(0, count * 2), 2));
            geometry.setAttribute('color', new BufferAttribute(this.colors.slice(0, count * 3), 3));
            if (this.extra === 'lamp') geometry.setAttribute('lamp', new BufferAttribute(this.extras.slice(0, count * 2), 2));
            if (this.extra === 'drift') geometry.setAttribute('drift', new BufferAttribute(this.extras.slice(0, count * 4), 4));
        }
        const indices = this.indices.subarray(0, this.indexCount);
        geometry.setIndex(new BufferAttribute(count > 65535 ? indices.slice() : Uint16Array.from(indices), 1));
        geometry.computeBoundingSphere();
        // A glow's quad is a point until the shader spreads it out; make room for that.
        if (this.extra === 'glow' && geometry.boundingSphere) geometry.boundingSphere.radius += 0.8;
        // Something floating wanders a little way from where it's built.
        if (this.extra === 'drift' && geometry.boundingSphere) geometry.boundingSphere.radius += 0.3;
        return geometry;
    }
}

// A glow's four corners, counter-clockwise from the bottom left.
const SPOT_CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
