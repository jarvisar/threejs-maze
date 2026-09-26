import { BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, Matrix3, Matrix4, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { WALL_HEIGHT } from '../config.js';
import {
    BALLOON_HEIGHT,
    BALLOON_RADIUS,
    BANNER_TEXT,
    DISCO_HEIGHT,
    PARTY_CAKE,
    PARTY_COLORS,
    PARTY_HAT,
    PARTY_PALETTE,
    PARTY_PRESENTS,
    PARTY_WEIGHT,
    TABLE_DEPTH,
    TABLE_LENGTH,
} from './party.js';

/*
 * Level Fun's decorations as meshes (see party.js for where they go). Each chunk gets four: the things (tables
 * and cakes, presents, hats, the mirror balls' chains), what's drawn on the walls and the banner's letters, the
 * balloons with everything else that's up by the ceiling (their strings, ribbons, streamers and bunting, which
 * move on the air and let the light through; see the 'balloon' shading in materials.js), and the candle flames.
 * The mirror balls and the guests move on their own, so they're separate meshes made from the shapes at the
 * bottom (see PartyLayer.js).
 *
 * Everything is built from boxes, cylinders and spheres, coloured by its vertices and pictured from one texture
 * (drawn in partyTextures.js), like the level's own props.
 */

/** The party's texture (drawn in partyTextures.js): where each picture is, in pixels. */
export const PARTY_ATLAS_SIZE = 1024;
/** The letters on the banner, in the order they're drawn. */
export const PARTY_LETTERS = [...new Set(BANNER_TEXT.replaceAll(' ', ''))];
export const PARTY_ATLAS = {
    plain: [16, 16, 48, 48],
    crepe: [64, 0, 256, 128],
    fabric: [64, 128, 256, 256],
    stripes: [256, 0, 512, 256],
    dots: [512, 0, 768, 256],
    stars: [768, 0, 1024, 256],
    cakeSide: [0, 256, 1024, 384],
    cakeTop: [0, 384, 256, 640],
    cloth: [256, 384, 512, 640],
    hatStripes: [512, 384, 640, 640],
    hatStars: [640, 384, 768, 640],
    cup: [768, 384, 1024, 512],
    /** @param {number} k */
    letters: (k) => [k * 64, 640, k * 64 + 64, 768],
    /** @param {number} style */
    scrawl: (style) => [style * 256, 768, style * 256 + 256, 1024],
    face: [768, 768, 1024, 1024],
};

const WRAPS = [PARTY_ATLAS.stripes, PARTY_ATLAS.dots, PARTY_ATLAS.stars];
const FROSTING = [0xfbf6ef, 0xf7b6cb, 0xbfe7d0, 0xf6e59a, 0xd9c6f1];
const INKS = [0x1b1918, 0xb8282c, 0xe0508f];
const METAL = 0x8c8f95;
const STRING = 0xe9e6de;
const FLAME = 0xffc766;
const FLAME_TIP = 0xfff3c4;
const SKIN = 0xf2cd3a;
const FACE_INK = 0x141312;

const _matrix = new Matrix4();
const _local = new Matrix4();
const _normalMatrix = new Matrix3();
const _vector = new Vector3();
const _normal = new Vector3();
const _quaternion = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _direction = new Vector3();
const _scale = new Vector3(1, 1, 1);
const _position = new Vector3();

/** Texture coordinates of a picture (canvas textures are flipped on upload: row 0 is v = 1). */
function uvRect([x0, y0, x1, y1]) {
    return { u0: x0 / PARTY_ATLAS_SIZE, u1: x1 / PARTY_ATLAS_SIZE, v0: 1 - y1 / PARTY_ATLAS_SIZE, v1: 1 - y0 / PARTY_ATLAS_SIZE };
}
const PLAIN = uvRect(PARTY_ATLAS.plain);

/**
 * Collects triangles, with a colour and (for what moves) a sway for every vertex, into typed arrays that are
 * reused from chunk to chunk.
 */
class PartyBuilder {
    constructor() {
        this.positions = new Float32Array(3 * 4096);
        this.normals = new Float32Array(3 * 4096);
        this.uvs = new Float32Array(2 * 4096);
        this.colors = new Float32Array(3 * 4096);
        this.sways = new Float32Array(3 * 4096);
        this.indices = new Uint32Array(6 * 4096);
        this.vertexCount = 0;
        this.indexCount = 0;
        this.color = [1, 1, 1];
        this.sway = [0, 0, 0];
    }

    reset() {
        this.vertexCount = 0;
        this.indexCount = 0;
        this.setColor(0xffffff);
        this.setSway(0, 0, 0);
        return this;
    }

    setColor(hex) {
        this.color[0] = ((hex >> 16) & 255) / 255;
        this.color[1] = ((hex >> 8) & 255) / 255;
        this.color[2] = (hex & 255) / 255;
        return this;
    }

    /** @see VERTEX_SWAY in materials.js */
    setSway(phase, drift, swing) {
        this.sway[0] = phase;
        this.sway[1] = drift;
        this.sway[2] = swing;
        return this;
    }

    /** @returns {number} The new vertex's index. */
    vertex(x, y, z, nx, ny, nz, u, v) {
        if (this.vertexCount * 2 === this.uvs.length) this._growVertices();
        const i = this.vertexCount++;
        const j = i * 3;
        this.positions[j] = x;
        this.positions[j + 1] = y;
        this.positions[j + 2] = z;
        this.normals[j] = nx;
        this.normals[j + 1] = ny;
        this.normals[j + 2] = nz;
        this.uvs[i * 2] = u;
        this.uvs[i * 2 + 1] = v;
        this.colors[j] = this.color[0];
        this.colors[j + 1] = this.color[1];
        this.colors[j + 2] = this.color[2];
        this.sways[j] = this.sway[0];
        this.sways[j + 1] = this.sway[1];
        this.sways[j + 2] = this.sway[2];
        return i;
    }

    triangle(a, b, c) {
        if (this.indexCount + 3 > this.indices.length) this.indices = grow(this.indices);
        this.indices[this.indexCount++] = a;
        this.indices[this.indexCount++] = b;
        this.indices[this.indexCount++] = c;
    }

    quad(a, b, c, d) {
        this.triangle(a, b, c);
        this.triangle(a, c, d);
    }

    /**
     * Adds a three.js geometry, placed by `matrix`. Its texture coordinates are put into `rect` of the atlas
     * (or left as they are, with null), and it's the builder's colour, times its own if it has any.
     * @param {BufferGeometry} geometry
     * @param {Matrix4} matrix
     * @param {number[] | null} [rect]
     */
    add(geometry, matrix, rect = PARTY_ATLAS.plain) {
        const position = geometry.attributes.position;
        const normal = geometry.attributes.normal;
        const uv = geometry.attributes.uv;
        const color = geometry.attributes.color;
        const map = rect && uvRect(rect);
        _normalMatrix.getNormalMatrix(matrix);
        const base = this.vertexCount;
        const [r, g, b] = this.color;
        for (let i = 0; i < position.count; i++) {
            _vector.fromBufferAttribute(position, i).applyMatrix4(matrix);
            _normal.fromBufferAttribute(normal, i).applyMatrix3(_normalMatrix).normalize();
            let u = uv ? uv.getX(i) : 0;
            let v = uv ? uv.getY(i) : 0;
            if (map) {
                u = map.u0 + u * (map.u1 - map.u0);
                v = map.v0 + v * (map.v1 - map.v0);
            }
            if (color) {
                this.color[0] = r * color.getX(i);
                this.color[1] = g * color.getY(i);
                this.color[2] = b * color.getZ(i);
            }
            this.vertex(_vector.x, _vector.y, _vector.z, _normal.x, _normal.y, _normal.z, u, v);
        }
        this.color[0] = r;
        this.color[1] = g;
        this.color[2] = b;
        if (geometry.index) {
            const index = geometry.index;
            for (let i = 0; i < index.count; i += 3) this.triangle(base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2));
        } else {
            for (let i = 0; i < position.count; i += 3) this.triangle(base + i, base + i + 1, base + i + 2);
        }
    }

    /**
     * A thin round cord through `points` (three-sided, which is plenty at its size), with each point's sway
     * given by `sway(t)` for t from 0 at the first point to 1 at the last.
     * @param {number[][]} points
     * @param {number} radius
     * @param {(t: number) => number[]} [sway] [drift, swing]
     */
    cord(points, radius, sway) {
        const phase = this.sway[0];
        let previous = -1;
        for (let k = 0; k < points.length; k++) {
            const a = points[Math.max(k - 1, 0)];
            const b = points[Math.min(k + 1, points.length - 1)];
            _direction.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
            const side = Math.abs(_direction.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3().crossVectors(_direction, _up).normalize();
            const other = new Vector3().crossVectors(side, _direction).normalize();
            if (sway) this.setSway(phase, ...sway(k / (points.length - 1)));
            const first = this.vertexCount;
            for (let s = 0; s < 3; s++) {
                const angle = (s / 3) * Math.PI * 2;
                const nx = side.x * Math.cos(angle) + other.x * Math.sin(angle);
                const ny = side.y * Math.cos(angle) + other.y * Math.sin(angle);
                const nz = side.z * Math.cos(angle) + other.z * Math.sin(angle);
                const [x, y, z] = points[k];
                this.vertex(x + nx * radius, y + ny * radius, z + nz * radius, nx, ny, nz, PLAIN.u0, PLAIN.v0);
            }
            if (previous >= 0) {
                for (let s = 0; s < 3; s++) {
                    const s1 = (s + 1) % 3;
                    this.quad(previous + s, first + s, first + s1, previous + s1);
                }
            }
            previous = first;
        }
    }

    /**
     * A flat strip through `points`, `width` across in the direction `across(k)` gives at each (unit), seen from
     * both sides, with the picture `rect` across it and repeated along every segment.
     */
    strip(points, width, across, rect) {
        const map = uvRect(rect);
        let front = -1;
        for (let k = 0; k < points.length; k++) {
            const a = points[Math.max(k - 1, 0)];
            const b = points[Math.min(k + 1, points.length - 1)];
            _direction.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
            const w = across(k);
            _normal.set(w[0], w[1], w[2]).cross(_direction).normalize();
            const [x, y, z] = points[k];
            const v = k % 2 === 0 ? map.v0 : map.v1;
            const h = width / 2;
            const n = [_normal.x, _normal.y, _normal.z];
            const first = this.vertexCount;
            this.vertex(x - w[0] * h, y - w[1] * h, z - w[2] * h, n[0], n[1], n[2], map.u0, v);
            this.vertex(x + w[0] * h, y + w[1] * h, z + w[2] * h, n[0], n[1], n[2], map.u1, v);
            this.vertex(x - w[0] * h, y - w[1] * h, z - w[2] * h, -n[0], -n[1], -n[2], map.u0, v);
            this.vertex(x + w[0] * h, y + w[1] * h, z + w[2] * h, -n[0], -n[1], -n[2], map.u1, v);
            if (front >= 0) {
                orientedQuad(this, front, front + 1, first + 1, first, n);
                orientedQuad(this, front + 2, front + 3, first + 3, first + 2, [-n[0], -n[1], -n[2]]);
            }
            front = first;
        }
    }

    _growVertices() {
        this.positions = grow(this.positions);
        this.normals = grow(this.normals);
        this.uvs = grow(this.uvs);
        this.colors = grow(this.colors);
        this.sways = grow(this.sways);
    }

    /**
     * @param {boolean} [withSway] Whether it moves (the balloons' mesh).
     * @param {boolean} [soften] Tip upward faces away from the light straight down, like the level's props.
     * @returns {BufferGeometry | null}
     */
    build(withSway = false, soften = false) {
        const count = this.vertexCount;
        if (count === 0) return null;
        if (soften) softenTops(this.normals, count);
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(this.positions.slice(0, count * 3), 3));
        geometry.setAttribute('normal', new BufferAttribute(this.normals.slice(0, count * 3), 3));
        geometry.setAttribute('uv', new BufferAttribute(this.uvs.slice(0, count * 2), 2));
        geometry.setAttribute('color', new BufferAttribute(this.colors.slice(0, count * 3), 3));
        if (withSway) geometry.setAttribute('sway', new BufferAttribute(this.sways.slice(0, count * 3), 3));
        const indices = count > 65535 ? new Uint32Array(this.indexCount) : new Uint16Array(this.indexCount);
        indices.set(this.indices.subarray(0, this.indexCount));
        geometry.setIndex(new BufferAttribute(indices, 1));
        geometry.computeBoundingSphere();
        return geometry;
    }
}

function grow(array) {
    const larger = new /** @type {any} */ (array.constructor)(array.length * 2);
    larger.set(array);
    return larger;
}

// How much of the overhead light the tops of things catch (see softenTops in props.js, which does the same).
const UPWARD_LIGHT = 0.45;

/** Tips upward-facing normals towards the horizontal, so tops don't glare next to the sides around them. */
function softenTops(normals, count) {
    for (let i = 0; i < count; i++) {
        const y = normals[i * 3 + 1];
        if (y <= 0) continue;
        let x = normals[i * 3];
        let z = normals[i * 3 + 2];
        let flat = Math.hypot(x, z);
        if (flat < 1e-4) {
            x = 0.6;
            z = 0.8;
            flat = 1;
        }
        const ny = y * UPWARD_LIGHT;
        const scale = Math.sqrt(1 - ny * ny) / flat;
        normals[i * 3] = x * scale;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = z * scale;
    }
}

/** Two triangles a, b, c, d, wound to face the way `normal` points. */
function orientedQuad(builder, a, b, c, d, normal) {
    const p = builder.positions;
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const facing = (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2];
    if (facing >= 0) builder.quad(a, b, c, d);
    else builder.quad(a, d, c, b);
}

// Meshing one chunk runs start to finish without interruption, so one set of builders serves every chunk.
const thingsBuilder = new PartyBuilder();
const decalsBuilder = new PartyBuilder();
const balloonsBuilder = new PartyBuilder();
const flamesBuilder = new PartyBuilder();

/**
 * One chunk's party meshes, positioned relative to its centre (ox, oz).
 * @param {import('./party.js').PartyDressing} dressing
 * @param {number} ox
 * @param {number} oz
 */
export function buildPartyGeometry(dressing, ox, oz) {
    const things = thingsBuilder.reset();
    const decals = decalsBuilder.reset();
    const balloons = balloonsBuilder.reset();
    const flames = flamesBuilder.reset();

    for (const thing of dressing.things) addThing(things, flames, thing, ox, oz);
    // Paper and cloth up by the ceiling, above the lights: they go in with the balloons, which let the light
    // through (and the flags can flutter).
    for (const streamer of dressing.streamers) addStreamer(balloons, streamer, ox, oz);
    for (const bunting of dressing.bunting) addBunting(balloons, decals, bunting, ox, oz);
    for (const disco of dressing.discos) addDiscoMount(things, disco, ox, oz);
    for (const scrawl of dressing.scrawls) addScrawl(decals, scrawl, ox, oz);
    for (const balloon of dressing.balloons) addBalloon(balloons, balloon, ox, oz);
    for (const ribbon of dressing.ribbons) addRibbon(balloons, ribbon, ox, oz);

    return { things: things.build(false, true), decals: decals.build(), balloons: balloons.build(true), flames: flames.build() };
}

/** Radius of the soft shadow on the carpet under a thing (see chunkGeometry.js). */
export function partyShadowRadius(thing) {
    return [0.2, 0.1, 0.045, 0.03][thing.kind];
}

// ---------------------------------------------------------------------------------------------- things

/** A thing's matrix: stood at (x, 0, z) relative to the chunk, turned by its yaw. */
function placed(thing, ox, oz) {
    return new Matrix4().makeRotationY(thing.yaw).setPosition(thing.x - ox, 0, thing.z - oz);
}

function addThing(builder, flames, thing, ox, oz) {
    const place = placed(thing, ox, oz);
    switch (thing.kind) {
        case PARTY_CAKE:
            addCakeTable(builder, flames, place, thing.variant);
            break;
        case PARTY_PRESENTS:
            addPresents(builder, place, thing.variant);
            break;
        case PARTY_HAT:
            builder.setColor(0xffffff);
            builder.add(hatLying(thing.variant), place, null);
            break;
        case PARTY_WEIGHT:
            builder.setColor(PARTY_PALETTE[thing.variant % PARTY_COLORS]);
            builder.add(cached('weight', () => new CylinderGeometry(0.014, 0.016, 0.022, 10).translate(0, 0.011, 0)), place);
            break;
        default:
    }
}

/** `local` (a position and turn within a thing) applied inside the thing's own matrix. */
function within(place, x, y, z, yaw = 0, roll = 0) {
    _quaternion.setFromAxisAngle(_up, yaw);
    _local.compose(_position.set(x, y, z), _quaternion, _scale);
    if (roll) _local.multiply(new Matrix4().makeRotationZ(roll));
    return _matrix.multiplyMatrices(place, _local);
}

/**
 * A folding table with a gingham cloth over it, and on it a two-tier birthday cake with candles, plates and
 * red cups. Its front (+z) faces into the room.
 */
function addCakeTable(builder, flames, place, variant) {
    const L = TABLE_LENGTH;
    const D = TABLE_DEPTH;
    const TOP = 0.27;
    builder.setColor(METAL);
    for (const x of [-L / 2 + 0.018, L / 2 - 0.018]) {
        for (const z of [-D / 2 + 0.018, D / 2 - 0.018]) builder.add(cached('leg', () => new BoxGeometry(0.012, TOP - 0.004, 0.012)), within(place, x, (TOP - 0.004) / 2, z));
    }
    builder.setColor(0xffffff);
    const cloth = PARTY_ATLAS.cloth;
    builder.add(cached('cloth', () => new BoxGeometry(L + 0.012, 0.008, D + 0.012)), within(place, 0, TOP, 0), cloth);
    builder.add(cached('skirt-front', () => new BoxGeometry(L + 0.012, 0.075, 0.004)), within(place, 0, TOP - 0.037, D / 2 + 0.006), cloth);
    for (const side of [-1, 1]) builder.add(cached('skirt-side', () => new BoxGeometry(0.004, 0.075, D + 0.012)), within(place, side * (L / 2 + 0.006), TOP - 0.037, 0), cloth);

    // The cake, on its board.
    const on = TOP + 0.004;
    builder.setColor(0xdcdde0);
    builder.add(cached('board', () => new CylinderGeometry(0.068, 0.068, 0.003, 22)), within(place, 0, on + 0.0015, -0.01));
    builder.setColor(FROSTING[variant % FROSTING.length]);
    builder.add(cached('tier-low', () => cake(0.056, 0.042, 22)), within(place, 0, on + 0.003, -0.01, variant * 0.37), null);
    builder.add(cached('tier-high', () => cake(0.037, 0.032, 18)), within(place, 0, on + 0.045, -0.01, variant * 0.61), null);
    const candleTop = on + 0.077;
    const candles = 5 + ((variant >>> 4) % 3);
    for (let k = 0; k < candles; k++) {
        const a = (k / candles) * Math.PI * 2 + variant * 0.1;
        const cx = Math.cos(a) * 0.024;
        const cz = -0.01 + Math.sin(a) * 0.024;
        builder.setColor(PARTY_PALETTE[(k + variant) % PARTY_COLORS]);
        builder.add(cached('candle', () => new CylinderGeometry(0.003, 0.003, 0.026, 6).translate(0, 0.013, 0)), within(place, cx, candleTop, cz));
        builder.setColor(0x222222);
        builder.add(cached('wick', () => new CylinderGeometry(0.0006, 0.0006, 0.004, 3).translate(0, 0.028, 0)), within(place, cx, candleTop, cz));
        flames.add(cached('flame', flame), within(place, cx, candleTop + 0.03, cz), null);
    }

    // Plates, one with a slice on it, a stack of napkins, and cups (one knocked over).
    builder.setColor(0xf6f4f0);
    for (const [x, z] of [[-0.118, 0.035], [0.12, 0.03], [0.1, -0.048]]) builder.add(cached('plate', () => new CylinderGeometry(0.026, 0.02, 0.003, 16).translate(0, 0.0015, 0)), within(place, x, on, z));
    builder.setColor(FROSTING[(variant + 1) % FROSTING.length]);
    builder.add(cached('slice', slice), within(place, 0.12, on + 0.003, 0.03, 0.8), null);
    builder.setColor(PARTY_PALETTE[(variant >>> 8) % PARTY_COLORS]);
    builder.add(cached('napkins', () => new BoxGeometry(0.032, 0.01, 0.032).translate(0, 0.005, 0)), within(place, -0.1, on, -0.05, 0.3));
    builder.setColor(0xffffff);
    builder.add(cached('cup', cup), within(place, -0.145, on, -0.02, 0.2), null);
    builder.add(cached('cup', cup), within(place, -0.128, on, 0.075, 1.1), null);
    builder.add(cached('cup-down', cupDown), within(place, 0.145, on, -0.055, 2.3), null);
}

/** A tier of cake: frosting round the side and over the top, sat on y = 0. */
function cake(radius, height, segments) {
    const geometry = new CylinderGeometry(radius, radius * 1.02, height, segments, 1).translate(0, height / 2, 0);
    // CylinderGeometry's vertices: the side, then the top cap, then the bottom.
    const side = (segments + 1) * 2;
    const cap = segments * 2 + 1;
    paint(geometry, 0, side, PARTY_ATLAS.cakeSide);
    paint(geometry, side, side + cap, PARTY_ATLAS.cakeTop);
    paint(geometry, side + cap, geometry.attributes.position.count, PARTY_ATLAS.plain);
    return geometry;
}

/** A slice of cake on its side on a plate: a wedge of sponge with frosting on top. */
function slice() {
    const geometry = new CylinderGeometry(0.02, 0.02, 0.018, 3, 1, false, 0, Math.PI / 3).translate(0, 0.009, 0);
    paint(geometry, 0, geometry.attributes.position.count, PARTY_ATLAS.cakeSide);
    return geometry;
}

/** A red cup, stood up. */
function cup() {
    const geometry = new CylinderGeometry(0.0115, 0.0085, 0.03, 12, 1, true).translate(0, 0.015, 0);
    paint(geometry, 0, geometry.attributes.position.count, PARTY_ATLAS.cup);
    const bottom = new CylinderGeometry(0.0085, 0.0085, 0.001, 12).translate(0, 0.0005, 0);
    paint(bottom, 0, bottom.attributes.position.count, PARTY_ATLAS.plain, 0xc81f27);
    return mergeInto([geometry, bottom]);
}

/** A red cup, knocked over. */
function cupDown() {
    const geometry = cup().rotateZ(Math.PI / 2);
    geometry.computeBoundingBox();
    return geometry.translate(0, -geometry.boundingBox.min.y, 0);
}

/** A candle flame: a little teardrop, white-yellow at the tip. */
function flame() {
    const geometry = new ConeGeometry(0.0042, 0.013, 7).translate(0, 0.0065, 0);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const base = hexToRgb(FLAME);
    const tip = hexToRgb(FLAME_TIP);
    for (let i = 0; i < position.count; i++) {
        const t = position.getY(i) / 0.013;
        for (let c = 0; c < 3; c++) colors[i * 3 + c] = base[c] + (tip[c] - base[c]) * t;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    return geometry;
}

/**
 * One to three presents: the biggest on the floor, a smaller one on top, maybe a little one beside it. Each
 * is wrapped (stripes, spots or stars), with a ribbon round it and a bow on the one at the top.
 */
function addPresents(builder, place, variant) {
    const count = 1 + (variant % 3);
    const boxes = [];
    const w0 = 0.085 + ((variant >>> 2) & 7) * 0.003;
    const h0 = 0.06 + ((variant >>> 5) & 7) * 0.004;
    boxes.push({ x: 0, y: 0, z: 0, w: w0, h: h0, d: w0 * 0.9, yaw: 0 });
    if (count >= 2) {
        const w1 = w0 * 0.66;
        boxes.push({ x: 0.004, y: h0, z: -0.003, w: w1, h: h0 * 0.8, d: w1, yaw: 0.35 });
    }
    if (count >= 3) boxes.push({ x: 0.052, y: 0, z: 0.046, w: 0.042, h: 0.034, d: 0.04, yaw: -0.4 });
    boxes.forEach((box, k) => {
        const wrap = WRAPS[((variant >>> (8 + k * 2)) & 3) % WRAPS.length];
        const ribbon = PARTY_PALETTE[((variant >>> (14 + k * 3)) & 7) % PARTY_COLORS];
        const at = within(place, box.x, box.y, box.z, box.yaw).clone();
        builder.setColor(0xffffff);
        builder.add(new BoxGeometry(box.w, box.h, box.d).translate(0, box.h / 2, 0), at, wrap);
        builder.setColor(ribbon);
        builder.add(new BoxGeometry(box.w + 0.002, box.h + 0.001, 0.011).translate(0, (box.h + 0.001) / 2, 0), at);
        builder.add(new BoxGeometry(0.011, box.h + 0.001, box.d + 0.002).translate(0, (box.h + 0.001) / 2, 0), at);
        const onTop = k === 1 || (k === 0 && count === 1) || k === 2;
        if (onTop) {
            for (const side of [-1, 1]) {
                const loop = new TorusGeometry(0.011, 0.0032, 5, 10).rotateY(Math.PI / 2).rotateZ(side * 0.75).translate(side * 0.009, box.h + 0.009, 0);
                builder.add(loop, at);
            }
            builder.add(new SphereGeometry(0.005, 6, 4).translate(0, box.h + 0.004, 0), at);
        }
    });
}

/** A party hat on the floor: stood up, or on its side (variant bit 0), in one of two papers. */
function hatLying(variant) {
    const down = (variant & 1) === 1;
    const paper = (variant >>> 1) % 2;
    return cached(`hat-${down}-${paper}`, () => {
        const geometry = hat(0.03, 0.08, paper);
        if (down) {
            // Over until the line from the brim to the point is flat on the floor.
            geometry.rotateZ(Math.atan(0.03 / 0.08) - Math.PI / 2);
            geometry.computeBoundingBox();
            geometry.translate(0, -geometry.boundingBox.min.y, 0);
        }
        return geometry;
    });
}

/**
 * A party hat, its brim on y = 0: a cone of paper (two kinds) with a pompom on top.
 * @param {number} radius
 * @param {number} height
 * @param {number} paper 0 stripes, 1 stars
 */
export function hat(radius, height, paper) {
    const cone = new ConeGeometry(radius, height, 16, 1, false).translate(0, height / 2, 0);
    const side = 17 * 2;
    paint(cone, 0, side, paper === 0 ? PARTY_ATLAS.hatStripes : PARTY_ATLAS.hatStars);
    paint(cone, side, cone.attributes.position.count, PARTY_ATLAS.plain, 0xf2efe8);
    const pompom = new SphereGeometry(radius * 0.3, 8, 6).translate(0, height, 0);
    paint(pompom, 0, pompom.attributes.position.count, PARTY_ATLAS.plain, paper === 0 ? 0xf4cc2e : 0xf0609e);
    return mergeInto([cone, pompom]);
}

// ---------------------------------------------------------------------------------------------- hangings

/** A point on the dip between two ends at height y, sagging by `sag` in the middle: t from 0 to 1. */
function swag(ax, az, bx, bz, y, sag, t) {
    return [ax + (bx - ax) * t, y - sag * 4 * t * (1 - t), az + (bz - az) * t];
}

/** Crêpe paper swagged across a room, two colours twisted round each other. */
function addStreamer(builder, { ax, az, bx, bz, sag, colors }, ox, oz) {
    const length = Math.hypot(bx - ax, bz - az);
    const segments = Math.max(8, Math.ceil(length / 0.04));
    const turns = length / 0.32;
    const y = WALL_HEIGHT - 0.022;
    const dx = (bx - ax) / length;
    const dz = (bz - az) / length;
    colors.forEach((color, strand) => {
        const points = [];
        const across = [];
        for (let k = 0; k <= segments; k++) {
            const t = k / segments;
            const [x, py, z] = swag(ax - ox, az - oz, bx - ox, bz - oz, y, sag, t);
            // Round each other, and each turning on itself as it goes.
            const angle = t * turns * Math.PI * 2 + strand * Math.PI;
            const r = 0.005 * Math.min(1, t * 20, (1 - t) * 20);
            points.push([x - dz * Math.cos(angle) * r, py + Math.sin(angle) * r, z + dx * Math.cos(angle) * r]);
            const twist = angle + Math.PI / 2;
            across.push([-dz * Math.cos(twist), Math.sin(twist), dx * Math.cos(twist)]);
        }
        builder.setColor(PARTY_PALETTE[color % PARTY_COLORS]);
        builder.strip(points, 0.019, (k) => across[k], PARTY_ATLAS.crepe);
    });
}

/**
 * Bunting along a wall: a cord just off it, dipping in the middle, with cloth flags hanging from it in turn
 * round the colours. The banner is bunting too, with a letter on each flag (and a gap for each space).
 */
function addBunting(builder, decals, bunting, ox, oz) {
    const { ax, az, bx, bz, nx, nz, y, sag, flag, color, letters } = bunting;
    const length = Math.hypot(bx - ax, bz - az);
    const points = [];
    const segments = Math.max(6, Math.ceil(length / 0.05));
    for (let k = 0; k <= segments; k++) points.push(swag(ax - ox, az - oz, bx - ox, bz - oz, y, sag, k / segments));
    builder.setColor(STRING);
    builder.cord(points, 0.0022);

    // Which way reads left to right, seen from the room.
    const rightX = nz;
    const rightZ = -nx;
    const slots = letters ? [...letters] : Array.from({ length: Math.max(1, Math.floor(length / (flag * 1.3))) }, () => '');
    const reversed = (bx - ax) * rightX + (bz - az) * rightZ < 0;
    const spacing = length / slots.length;
    const width = Math.min(flag, spacing * 0.92);
    const height = width * 1.15;
    const fabric = uvRect(PARTY_ATLAS.fabric);
    let shade = 0;
    slots.forEach((letter, k) => {
        if (letter === ' ') return;
        const t = (reversed ? slots.length - 1 - k + 0.5 : k + 0.5) / slots.length;
        const [px, py, pz] = swag(ax - ox, az - oz, bx - ox, bz - oz, y, sag, t);
        // Hanging a touch out from the wall, and not quite straight.
        const tilt = Math.sin(k * 12.9898 + color) * 0.1;
        const hx = rightX * (width / 2);
        const hz = rightZ * (width / 2);
        const cx = px + nx * 0.004;
        const cz = pz + nz * 0.004;
        const drop = [Math.sin(tilt) * height * rightX, -Math.cos(tilt) * height, Math.sin(tilt) * height * rightZ];
        builder.setColor(PARTY_PALETTE[(color + shade++) % PARTY_COLORS]);
        // Plain flags flutter a little at their points (the banner's stay still, with their letters on).
        const flutter = letters ? 0 : 0.3;
        for (const side of [1, -1]) {
            builder.setSway(k * 0.9 + color, 0, 0);
            const a = builder.vertex(cx - hx, py, cz - hz, nx * side, 0, nz * side, fabric.u0, fabric.v1);
            const b = builder.vertex(cx + hx, py, cz + hz, nx * side, 0, nz * side, fabric.u1, fabric.v1);
            builder.setSway(k * 0.9 + color, 0, flutter);
            const c = builder.vertex(cx + drop[0], py + drop[1], cz + drop[2], nx * side, 0, nz * side, (fabric.u0 + fabric.u1) / 2, fabric.v0);
            if (side > 0) builder.triangle(a, c, b);
            else builder.triangle(a, b, c);
        }
        builder.setSway(0, 0, 0);
        if (!letter) return;
        // The letter, stuck on the front of its flag near the top, where it's widest. (Its picture is twice as
        // tall as it's wide, with the letter in the middle.)
        const across = width * 0.5;
        const lx = cx + nx * 0.002 + drop[0] * 0.28;
        const ly = py + drop[1] * 0.28;
        const lz = cz + nz * 0.002 + drop[2] * 0.28;
        const glyph = uvRect(PARTY_ATLAS.letters(PARTY_LETTERS.indexOf(letter)));
        decals.setColor(0xffffff);
        const rx = rightX * across * 0.5;
        const rz = rightZ * across * 0.5;
        const up = across;
        const v0 = decals.vertex(lx - rx, ly - up, lz - rz, nx, 0, nz, glyph.u0, glyph.v0);
        const v1 = decals.vertex(lx + rx, ly - up, lz + rz, nx, 0, nz, glyph.u1, glyph.v0);
        const v2 = decals.vertex(lx + rx, ly + up, lz + rz, nx, 0, nz, glyph.u1, glyph.v1);
        const v3 = decals.vertex(lx - rx, ly + up, lz - rz, nx, 0, nz, glyph.u0, glyph.v1);
        orientedQuad(decals, v0, v1, v2, v3, [nx, 0, nz]);
    });
}

/** A mirror ball's chain and the plate it hangs from (the ball itself turns, so it's its own mesh). */
function addDiscoMount(builder, disco, ox, oz) {
    const x = disco.x - ox;
    const z = disco.z - oz;
    const top = disco.y + 0.066;
    builder.setColor(METAL);
    builder.add(new CylinderGeometry(0.02, 0.02, 0.006, 12), _matrix.makeTranslation(x, WALL_HEIGHT - 0.003, z));
    builder.cord([[x, WALL_HEIGHT - 0.004, z], [x, top, z]], 0.0022);
    builder.add(cached('disco-cap', () => new CylinderGeometry(0.008, 0.012, 0.01, 8)), _matrix.makeTranslation(x, top - 0.002, z));
}

// ---------------------------------------------------------------------------------------------- on the walls

/** =) drawn on a wall, a little off level. */
function addScrawl(decals, { x, y, z, nx, nz, size, angle, style, ink }, ox, oz) {
    const map = uvRect(PARTY_ATLAS.scrawl(style));
    // Across the wall as it's seen from the room, and up it, turned by the angle.
    const rx = nz;
    const rz = -nx;
    const cos = Math.cos(angle) * (size / 2);
    const sin = Math.sin(angle) * (size / 2);
    const corner = (a, b) => [x - ox + rx * (a * cos - b * sin), y + a * sin + b * cos, z - oz + rz * (a * cos - b * sin)];
    decals.setColor(INKS[ink]);
    const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const uvs = [[map.u0, map.v0], [map.u1, map.v0], [map.u1, map.v1], [map.u0, map.v1]];
    const ids = corners.map(([px, py, pz], k) => decals.vertex(px, py, pz, nx, 0, nz, uvs[k][0], uvs[k][1]));
    orientedQuad(decals, ids[0], ids[1], ids[2], ids[3], [nx, 0, nz]);
}

// ---------------------------------------------------------------------------------------------- balloons

/**
 * A balloon, and its string: down to where it's tied, or for one against the ceiling, trailing below it,
 * curled.
 */
function addBalloon(builder, balloon, ox, oz) {
    const { x, y, z, color, size, phase, tie, tail } = balloon;
    const bx = x - ox;
    const bz = z - oz;
    // Leaning away from where it's tied (or for one on the ceiling, a little any way).
    _direction.set(0, 1, 0);
    if (tie) _direction.set(bx - (tie.x - ox), (y - tie.y) * 1.6, bz - (tie.z - oz)).normalize();
    else _direction.set(Math.sin(phase) * 0.25, 1, Math.cos(phase) * 0.25).normalize();
    _quaternion.setFromUnitVectors(_up, _direction);
    const matrix = new Matrix4().compose(_position.set(bx, y, bz), _quaternion, _scale.setScalar(size));
    _scale.setScalar(1);
    builder.setSway(phase, 1, 0);
    builder.setColor(PARTY_PALETTE[color % PARTY_COLORS]);
    builder.add(cached('balloon', balloonShape), matrix);
    // Where the string starts: just under the knot.
    const knot = new Vector3(0, -(BALLOON_HEIGHT + 0.012), 0).multiplyScalar(size).applyQuaternion(_quaternion);
    const kx = bx + knot.x;
    const ky = y + knot.y;
    const kz = bz + knot.z;
    builder.setColor(STRING);
    const points = [];
    if (tie) {
        // Taut, from the knot to where it's tied, with a slight bow.
        const tx = tie.x - ox;
        const tz = tie.z - oz;
        for (let k = 0; k <= 6; k++) {
            const t = k / 6;
            const bow = Math.sin(t * Math.PI) * 0.012;
            points.push([tx + (kx - tx) * t + Math.sin(phase) * bow, tie.y + (ky - tie.y) * t, tz + (kz - tz) * t + Math.cos(phase) * bow]);
        }
        // Drifts with the balloon the nearer it is to it.
        builder.cord(points, 0.0014, (t) => [t, 0]);
    } else {
        for (let k = 0; k <= 12; k++) {
            const t = k / 12;
            const curl = t * tail * 28 + phase;
            const r = 0.006 * Math.min(1, t * 6);
            points.push([kx + Math.cos(curl) * r, ky - t * tail, kz + Math.sin(curl) * r]);
        }
        // Drifts with the balloon, and swings more the further down.
        builder.cord(points, 0.0016, (t) => [1, t * t]);
    }
    builder.setSway(0, 0, 0);
}

/** A curly ribbon hanging from the ceiling, swinging a little. */
function addRibbon(builder, { x, z, length, color, phase }, ox, oz) {
    const points = [];
    for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const curl = t * length * 34 + phase;
        const r = 0.009 * Math.min(1, t * 5);
        points.push([x - ox + Math.cos(curl) * r, WALL_HEIGHT - 0.002 - t * length, z - oz + Math.sin(curl) * r]);
    }
    builder.setColor(PARTY_PALETTE[color % PARTY_COLORS]);
    builder.setSway(phase, 0, 0);
    builder.cord(points, 0.0028, (t) => [0, t * t]);
    builder.setSway(0, 0, 0);
}

/** A balloon at size 1, its middle at the origin: rounder at the top, narrowing to the knot at the bottom. */
function balloonShape() {
    const sphere = new SphereGeometry(1, 11, 8);
    const position = sphere.attributes.position;
    const normal = sphere.attributes.normal;
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const pinch = y < 0 ? 1 + y * 0.3 : 1 + y * 0.03;
        const rx = BALLOON_RADIUS * pinch;
        position.setXYZ(i, x * rx, y * BALLOON_HEIGHT, z * rx);
        _normal.set(x / rx, y / BALLOON_HEIGHT, z / rx).normalize();
        normal.setXYZ(i, _normal.x, _normal.y, _normal.z);
    }
    const knot = new ConeGeometry(0.008, 0.012, 7).rotateX(Math.PI).translate(0, -BALLOON_HEIGHT - 0.004, 0);
    return mergeInto([sphere, knot]);
}

// ---------------------------------------------------------------------------------------------- the moving parts

/** A mirror ball (turned by PartyLayer.js; its tiles come from flat shading). */
export function createDiscoGeometry() {
    return new SphereGeometry(0.066, 20, 14);
}

/**
 * One of the guests: yellow, smooth, a little taller than you, arms at its sides, in a party hat, standing on
 * y = 0 and facing +z. Its face is separate (see createFaceGeometry).
 */
export function createGuestGeometry() {
    const parts = [];
    const skin = (geometry) => {
        paint(geometry, 0, geometry.attributes.position.count, PARTY_ATLAS.plain, SKIN);
        parts.push(geometry);
    };
    for (const side of [-1, 1]) {
        skin(limb([side * 0.036, 0.01, 0], [side * 0.031, 0.28, 0], 0.024, 0.029));
        skin(new SphereGeometry(1, 8, 6).scale(0.027, 0.014, 0.038).translate(side * 0.036, 0.012, 0.012));
        skin(limb([side * 0.078, 0.465, 0], [side * 0.096, 0.345, 0.008], 0.02, 0.017));
        skin(limb([side * 0.096, 0.345, 0.008], [side * 0.1, 0.235, 0.026], 0.017, 0.015));
        skin(new SphereGeometry(0.02, 8, 6).translate(side * 0.1, 0.225, 0.028));
    }
    skin(new CylinderGeometry(0.07, 0.079, 0.2, 16).scale(1, 1, 0.74).translate(0, 0.37, 0));
    skin(new SphereGeometry(1, 16, 8).scale(0.079, 0.045, 0.058).translate(0, 0.27, 0));
    skin(new SphereGeometry(1, 16, 8).scale(0.08, 0.04, 0.056).translate(0, 0.468, 0));
    skin(new CylinderGeometry(0.022, 0.025, 0.05, 10).translate(0, 0.5, 0));
    skin(new SphereGeometry(1, 18, 12).scale(0.058, 0.063, 0.058).translate(0, 0.565, 0));
    parts.push(hat(0.03, 0.078, 0).rotateZ(0.22).translate(0.012, 0.618, 0));
    return mergeInto(parts, true);
}

/**
 * A face (see the face in partyTextures.js), `size` across, looking along +z from the origin, tinted `color`
 * (for the guests' dark one; the chalk one takes its colour from its material).
 */
export function createFaceGeometry(size, color = FACE_INK) {
    const geometry = new PlaneGeometry(size, size);
    paint(geometry, 0, geometry.attributes.position.count, PARTY_ATLAS.face, color);
    return geometry;
}

/** Where the guest's face goes on it (see createGuestGeometry). */
export const GUEST_FACE = { y: 0.566, z: 0.0585, size: 0.075 };

// ---------------------------------------------------------------------------------------------- helpers

/** @type {Map<string, BufferGeometry>} */
const templates = new Map();

function cached(key, build) {
    let geometry = templates.get(key);
    if (!geometry) {
        geometry = build();
        templates.set(key, geometry);
    }
    return geometry;
}

/** A tapered cylinder from one point to another. */
function limb(from, to, r0, r1) {
    _direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const length = _direction.length();
    const geometry = new CylinderGeometry(r1, r0, length, 10, 1).translate(0, length / 2, 0);
    _quaternion.setFromUnitVectors(_up, _direction.normalize());
    return geometry.applyMatrix4(new Matrix4().compose(_position.set(from[0], from[1], from[2]), _quaternion, _scale.setScalar(1)));
}

/**
 * Gives vertices from..to a colour and points their texture coordinates into one picture of the atlas.
 * @param {BufferGeometry} geometry
 */
function paint(geometry, from, to, rect, hex = 0xffffff) {
    const count = geometry.attributes.position.count;
    if (!geometry.attributes.color) geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    const colors = geometry.attributes.color;
    const uvs = geometry.attributes.uv;
    const base = geometry.userData.baseUv ??= uvs.clone();
    const { u0, v0, u1, v1 } = uvRect(rect);
    const [r, g, b] = hexToRgb(hex);
    for (let i = from; i < to; i++) {
        colors.setXYZ(i, r, g, b);
        uvs.setXY(i, u0 + base.getX(i) * (u1 - u0), v0 + base.getY(i) * (v1 - v0));
    }
    return geometry;
}

function hexToRgb(hex) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Several geometries as one, for templates (softened, for one that's a mesh of its own). */
function mergeInto(parts, soften = false) {
    const builder = new PartyBuilder();
    const identity = new Matrix4();
    for (const part of parts) {
        if (!part.attributes.color) paint(part, 0, part.attributes.position.count, PARTY_ATLAS.plain);
        builder.add(part, identity, null);
        part.dispose();
    }
    return builder.build(false, soften);
}
