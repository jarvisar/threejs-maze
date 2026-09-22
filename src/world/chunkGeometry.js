import { BoxGeometry, BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, HALF_CHUNK, WALL_HEIGHT } from '../config.js';

// The baseboard is a thin strip around the bottom of every wall. These match the original look:
// a 0.065-tall box centred on the floor (so 0.0325 is visible) that sticks out 0.005 from the wall.
const BASEBOARD_HEIGHT = 0.0325;
const BASEBOARD_DEPTH = 0.005;

// Outward normals of a cell's four sides.
const SIDES = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/**
 * Builds one merged mesh for all walls in a chunk (plus one for their baseboards), emitting only the faces
 * that border open space. The original project used two meshes per wall cell (roughly 200 draw calls per
 * chunk, times the shadow pass); this is two draw calls per chunk with a fraction of the triangles.
 *
 * Positions are relative to the chunk centre, which keeps float precision high far from the origin.
 *
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} cx
 * @param {number} cz
 * @returns {{ walls: BufferGeometry | null, baseboards: BufferGeometry | null }}
 */
export function buildChunkWalls(store, cx, cz) {
    const walls = new GeometryBuilder();
    const baseboards = new GeometryBuilder();
    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;

    for (let i = 0; i < CHUNK_SIZE; i++) {
        for (let j = 0; j < CHUNK_SIZE; j++) {
            const x = originX + i - HALF_CHUNK; // world cell
            const z = originZ + j - HALF_CHUNK;
            if (!store.isWall(x, z)) continue;
            const lx = i - HALF_CHUNK; // chunk-local centre
            const lz = j - HALF_CHUNK;

            for (const [nx, nz] of SIDES) {
                if (store.isWall(x + nx, z + nz)) continue;
                // "Right" when looking at this face from outside: cross(up, normal).
                const rx = nz;
                const rz = -nx;

                const fx = lx + nx * 0.5;
                const fz = lz + nz * 0.5;
                walls.quad(
                    fx - rx * 0.5, 0, fz - rz * 0.5,
                    fx + rx * 0.5, 0, fz + rz * 0.5,
                    fx + rx * 0.5, WALL_HEIGHT, fz + rz * 0.5,
                    fx - rx * 0.5, WALL_HEIGHT, fz - rz * 0.5,
                    nx, 0, nz,
                    0, 0, 1, 1,
                );

                // Extend the baseboard past the wall's edge only at outside corners, so straight runs don't
                // overlap themselves and the strips of two perpendicular faces close the corner.
                const extendLeft = !store.isWall(x - rx, z - rz) ? BASEBOARD_DEPTH : 0;
                const extendRight = !store.isWall(x + rx, z + rz) ? BASEBOARD_DEPTH : 0;
                const left = -0.5 - extendLeft;
                const right = 0.5 + extendRight;
                const uLeft = (left + 0.5 + BASEBOARD_DEPTH) / (1 + 2 * BASEBOARD_DEPTH);
                const uRight = (right + 0.5 + BASEBOARD_DEPTH) / (1 + 2 * BASEBOARD_DEPTH);

                const bx = lx + nx * (0.5 + BASEBOARD_DEPTH);
                const bz = lz + nz * (0.5 + BASEBOARD_DEPTH);
                baseboards.quad(
                    bx + rx * left, 0, bz + rz * left,
                    bx + rx * right, 0, bz + rz * right,
                    bx + rx * right, BASEBOARD_HEIGHT, bz + rz * right,
                    bx + rx * left, BASEBOARD_HEIGHT, bz + rz * left,
                    nx, 0, nz,
                    uLeft, 0.5, uRight, 1,
                );
                // Thin ledge on top of the strip.
                baseboards.quad(
                    bx + rx * left, BASEBOARD_HEIGHT, bz + rz * left,
                    bx + rx * right, BASEBOARD_HEIGHT, bz + rz * right,
                    fx + rx * right, BASEBOARD_HEIGHT, fz + rz * right,
                    fx + rx * left, BASEBOARD_HEIGHT, fz + rz * left,
                    0, 1, 0,
                    uLeft, 0.99, uRight, 1,
                );
            }

            // Top face: hidden behind the ceiling from inside, but it's what you see when flying above.
            walls.quad(
                lx - 0.5, WALL_HEIGHT, lz + 0.5,
                lx + 0.5, WALL_HEIGHT, lz + 0.5,
                lx + 0.5, WALL_HEIGHT, lz - 0.5,
                lx - 0.5, WALL_HEIGHT, lz - 0.5,
                0, 1, 0,
                0, 0, 1, 1,
            );
        }
    }

    return { walls: walls.build(), baseboards: baseboards.build() };
}

/** The floor of one chunk (shared by every chunk; they're all identical). */
export function createFloorGeometry() {
    return new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(-Math.PI / 2);
}

/** The ceiling of one chunk, facing down. */
export function createCeilingGeometry() {
    return new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE).rotateX(Math.PI / 2).translate(0, WALL_HEIGHT, 0);
}

/**
 * The ceiling light panels of one chunk: a panel on every cell whose world coordinates are both odd,
 * i.e. every other cell. Walls never generate there, so a panel is never embedded in a wall.
 * Each panel is a bright box with a slightly larger dark frame behind it; colours are baked in as vertex
 * colours so the whole chunk's panels are one draw call.
 * @param {number} panelColor
 * @param {number} frameColor
 */
export function createFixtureGeometry(panelColor, frameColor) {
    const parts = [];
    for (let i = 0; i < CHUNK_SIZE; i += 2) {
        for (let j = 0; j < CHUNK_SIZE; j += 2) {
            const x = i - HALF_CHUNK;
            const z = j - HALF_CHUNK;
            parts.push(coloredBox(0.15, 0.01, 0.15, x, WALL_HEIGHT - 0.01, z, panelColor));
            parts.push(coloredBox(0.17, 0.01, 0.17, x, WALL_HEIGHT - 0.001, z, frameColor));
        }
    }
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    return merged;
}

function coloredBox(width, height, depth, x, y, z, hex) {
    const box = new BoxGeometry(width, height, depth).translate(x, y, z);
    box.deleteAttribute('uv');
    box.deleteAttribute('normal');
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    const colors = new Float32Array(box.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
        colors[i] = r;
        colors[i + 1] = g;
        colors[i + 2] = b;
    }
    box.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return box;
}

class GeometryBuilder {
    constructor() {
        this.positions = [];
        this.normals = [];
        this.uvs = [];
        this.indices = [];
    }

    /**
     * Adds a quad given its corners counter-clockwise from bottom-left (as seen from the front),
     * a shared normal, and the UV rectangle (u0, v0) → (u1, v1).
     */
    quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, u0, v0, u1, v1) {
        const base = this.positions.length / 3;
        this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
        this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
        this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    /** @returns {BufferGeometry | null} */
    build() {
        if (this.indices.length === 0) return null;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
        geometry.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
        geometry.setIndex(this.indices);
        geometry.computeBoundingSphere();
        return geometry;
    }
}
