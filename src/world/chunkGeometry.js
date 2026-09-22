import { BoxGeometry, BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, DOOR_HEIGHT, DOOR_WIDTH, HALF_CHUNK, PILLAR_SIZE, WALL_HEIGHT, WALL_THICKNESS } from '../config.js';
import { EDGE_DOOR, EDGE_WALL } from './grid.js';
import { hashFloat } from './random.js';

// The baseboard is a thin strip around the bottom of every wall. These match the original look:
// a 0.065-tall box centred on the floor (so 0.0325 is visible) that sticks out 0.005 from the wall.
const BASEBOARD_HEIGHT = 0.0325;
const BASEBOARD_DEPTH = 0.005;

const N = CHUNK_SIZE;
const HALF_THICKNESS = WALL_THICKNESS / 2;
const HALF_DOOR = DOOR_WIDTH / 2;
const HALF_PILLAR = PILLAR_SIZE / 2;

// Walls are built in two layers, below and above the top of a doorway. Splitting every wall face at the same
// height keeps all the vertices of neighbouring faces lined up, so there are no hairline cracks.
const LAYERS = [
    [0, DOOR_HEIGHT],
    [DOOR_HEIGHT, WALL_HEIGHT],
];

/*
 * Walls are meshed on a "region grid". Along each axis, every cell is cut into four intervals:
 *
 *   A: from the cell's low wall to the doorway        (r & 3 == 0)
 *   D: the width of a doorway, centred on the cell    (r & 3 == 1)
 *   B: from the doorway to the cell's high wall       (r & 3 == 2)
 *   W: the thickness of the wall on the high side     (r & 3 == 3)
 *
 * Every piece of wall is then a region of that grid: a W×W region is the post where edges meet, a W band
 * crossed with A/D/B is the body of an edge, and A/D/B × A/D/B is open floor. A region is solid or not
 * (per layer), and the wall surface is simply every boundary between a solid and an empty region, the same
 * way the old block maze was meshed, just on an uneven grid. Corners, wall ends, T-junctions and doorways
 * (including the sides and underside of their openings) all fall out of that without special cases.
 *
 * Region index r = 4k + interval, for cell k. Each chunk meshes the boundaries between regions r and r + 1
 * for the r in its own cells, so every face is built by exactly one chunk.
 */
const INTERVAL_OFFSET = [-0.5 + HALF_THICKNESS, -HALF_DOOR, HALF_DOOR, 0.5 - HALF_THICKNESS];

/** World coordinate where region interval r starts. */
function intervalStart(r) {
    return (r >> 2) + INTERVAL_OFFSET[r & 3];
}

/** A copy of the edges around one chunk, so meshing doesn't go through the store for every lookup. */
class RegionGrid {
    constructor(store, x0, z0) {
        this.x0 = x0 - 2;
        this.z0 = z0 - 2;
        this.size = N + 4;
        const count = this.size * this.size;
        this.edgesX = new Uint8Array(count);
        this.edgesZ = new Uint8Array(count);
        for (let i = 0; i < this.size; i++) {
            for (let j = 0; j < this.size; j++) {
                this.edgesX[i * this.size + j] = store.edge(this.x0 + i, this.z0 + j, 0);
                this.edgesZ[i * this.size + j] = store.edge(this.x0 + i, this.z0 + j, 1);
            }
        }
    }

    ex(x, z) {
        return this.edgesX[(x - this.x0) * this.size + (z - this.z0)];
    }

    ez(x, z) {
        return this.edgesZ[(x - this.x0) * this.size + (z - this.z0)];
    }

    /** Whether region (rx, rz) is solid in the given layer (0 = below doorway height, 1 = above). */
    solid(layer, rx, rz) {
        const tx = rx & 3;
        const tz = rz & 3;
        if (tx !== 3 && tz !== 3) return false;
        const kx = rx >> 2;
        const kz = rz >> 2;
        if (tx === 3 && tz === 3) {
            return (this.ex(kx, kz) | this.ex(kx, kz + 1) | this.ez(kx, kz) | this.ez(kx + 1, kz)) !== 0;
        }
        const type = tx === 3 ? this.ex(kx, kz) : this.ez(kx, kz);
        const along = tx === 3 ? tz : tx;
        return type === EDGE_WALL || (type === EDGE_DOOR && (along !== 1 || layer === 1));
    }
}

/**
 * Builds the meshes for one chunk's walls: the wallpapered surfaces, the baseboards along their feet, and
 * small details (outlets, ceiling vents).
 *
 * Positions are relative to the chunk centre, which keeps float precision high far from the origin.
 * Wallpaper UVs come from those positions, so the pattern runs on seamlessly along a wall.
 *
 * @param {import('./ChunkStore.js').ChunkStore} store
 * @param {number} cx
 * @param {number} cz
 * @returns {{ walls: BufferGeometry | null, baseboards: BufferGeometry | null, details: BufferGeometry | null }}
 */
export function buildChunkGeometry(store, cx, cz) {
    const x0 = cx * N - HALF_CHUNK;
    const z0 = cz * N - HALF_CHUNK;
    const ox = cx * N; // chunk centre (the mesh origin)
    const oz = cz * N;
    const grid = new RegionGrid(store, x0, z0);
    const walls = new GeometryBuilder();
    const baseboards = new GeometryBuilder();
    const details = new GeometryBuilder();

    const rx0 = x0 * 4;
    const rx1 = (x0 + N) * 4;
    const rz0 = z0 * 4;
    const rz1 = (z0 + N) * 4;

    // Vertical faces, on region boundaries across x (axis 0) and across z (axis 1). Faces are merged into runs
    // along each boundary line while nothing about them changes.
    for (const axis of [0, 1]) {
        for (let a = axis === 0 ? rx0 : rz0; a < (axis === 0 ? rx1 : rz1); a++) {
            const plane = intervalStart(a + 1) - (axis === 0 ? ox : oz);
            const b0 = axis === 0 ? rz0 : rx0;
            const b1 = axis === 0 ? rz1 : rx1;
            // solid(layer, region on the "a" side, region on the "a + 1" side), for this line.
            const solidAt = axis === 0
                ? (layer, ra, b) => grid.solid(layer, ra, b)
                : (layer, ra, b) => grid.solid(layer, b, ra);
            let runStart = b0;
            let runKey = 0;
            for (let b = b0; b <= b1; b++) {
                let key = 0;
                if (b < b1) {
                    for (let layer = 0; layer < 2; layer++) {
                        const low = solidAt(layer, a, b);
                        const high = solidAt(layer, a + 1, b);
                        if (low !== high) key |= (low ? 1 : 2) << (layer * 2);
                    }
                }
                if (key === runKey) continue;
                if (runKey !== 0) {
                    const s0 = intervalStart(runStart) - (axis === 0 ? oz : ox);
                    const s1 = intervalStart(b) - (axis === 0 ? oz : ox);
                    for (let layer = 0; layer < 2; layer++) {
                        const face = (runKey >> (layer * 2)) & 3;
                        if (face === 0) continue;
                        const normal = face === 1 ? 1 : -1;
                        const [y0, y1] = LAYERS[layer];
                        wallQuad(walls, axis, normal, plane, s0, s1, y0, y1);
                        if (layer === 0) {
                            // Wrap the baseboard around outside corners: extend it where the wall turns away.
                            const solidSide = face === 1 ? a : a + 1;
                            const openSide = face === 1 ? a + 1 : a;
                            const convex = (bb) => !solidAt(0, solidSide, bb) && !solidAt(0, openSide, bb);
                            const e0 = convex(runStart - 1) ? BASEBOARD_DEPTH : 0;
                            const e1 = convex(b) ? BASEBOARD_DEPTH : 0;
                            baseboard(baseboards, axis, normal, plane, s0 - e0, s1 + e1);
                        }
                    }
                }
                runStart = b;
                runKey = key;
            }
        }
    }

    // Horizontal faces: wall tops (seen when flying above the level) and the undersides of doorway lintels.
    for (let rx = rx0; rx < rx1; rx++) {
        for (let rz = rz0; rz < rz1; rz++) {
            const upper = grid.solid(1, rx, rz);
            if (!upper) continue;
            const ax = intervalStart(rx) - ox;
            const bx = intervalStart(rx + 1) - ox;
            const az = intervalStart(rz) - oz;
            const bz = intervalStart(rz + 1) - oz;
            flatQuad(walls, ax, bx, az, bz, WALL_HEIGHT, 1);
            if (!grid.solid(0, rx, rz)) flatQuad(walls, ax, bx, az, bz, DOOR_HEIGHT, -1);
        }
    }

    // Pillars, and details on the walls and ceiling.
    const seed = store.seed;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = x0 + i;
            const z = z0 + j;
            if (store.pillar(x, z)) pillar(walls, baseboards, x + 0.5 - ox, z + 0.5 - oz);
            addOutlets(details, seed, grid, x, z, ox, oz);
            // Air vents in the ceiling, only where there's no light panel.
            if (!((x & 1) && (z & 1)) && hashFloat(seed, 0x7e47, x, z) < 0.012) {
                const s = 0.11;
                const lx = x - ox;
                const lz = z - oz;
                details.quad(
                    lx - s, WALL_HEIGHT - 0.001, lz - s,
                    lx + s, WALL_HEIGHT - 0.001, lz - s,
                    lx + s, WALL_HEIGHT - 0.001, lz + s,
                    lx - s, WALL_HEIGHT - 0.001, lz + s,
                    0, -1, 0,
                    0.5, 0, 1, 1,
                );
            }
        }
    }

    return { walls: walls.build(), baseboards: baseboards.build(), details: details.build() };
}

/**
 * A vertical wall face on the plane `axis` = `plane` (axis 0: x = plane, facing ±x; axis 1: z = plane),
 * spanning s0..s1 along the other horizontal axis.
 */
function wallQuad(builder, axis, normal, plane, s0, s1, y0, y1, v0 = y0, v1 = y1) {
    // The face's "right" direction, looking at it from the front, runs along +s or −s.
    const right = axis === 0 ? -normal : normal;
    const left = right > 0 ? s0 : s1;
    const rightEnd = right > 0 ? s1 : s0;
    const nx = axis === 0 ? normal : 0;
    const nz = axis === 0 ? 0 : normal;
    const p = (s, y) => (axis === 0 ? [plane, y, s] : [s, y, plane]);
    builder.quad(...p(left, y0), ...p(rightEnd, y0), ...p(rightEnd, y1), ...p(left, y1), nx, 0, nz,
        left * right, v0, rightEnd * right, v1);
}

/** The baseboard strip in front of a wall face, and the thin ledge on top of it. */
function baseboard(builder, axis, normal, plane, s0, s1) {
    const front = plane + normal * BASEBOARD_DEPTH;
    wallQuad(builder, axis, normal, front, s0, s1, 0, BASEBOARD_HEIGHT, 0.5, 1);
    const [a0, a1] = normal > 0 ? [plane, front] : [front, plane];
    // The ledge samples a sliver along the top of the baseboard texture, running the length of the strip.
    const uv = (x, z) => [axis === 0 ? z : x, 0.99 + 0.01 * ((axis === 0 ? x : z) - a0) / (a1 - a0)];
    if (axis === 0) flatQuad(builder, a0, a1, s0, s1, BASEBOARD_HEIGHT, 1, uv);
    else flatQuad(builder, s0, s1, a0, a1, BASEBOARD_HEIGHT, 1, uv);
}

/**
 * A horizontal rectangle at height y, facing up (normalY = 1) or down (−1).
 * @param {(x: number, z: number) => number[]} [uv] Texture coordinates of a corner (default: from x and z).
 */
function flatQuad(builder, x0, x1, z0, z1, y, normalY, uv = (x, z) => [x, -z]) {
    // Counter-clockwise as seen from the side the quad faces.
    const corners = normalY > 0 ? [[x0, z1], [x1, z1], [x1, z0], [x0, z0]] : [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    builder.corners(corners.map(([x, z]) => [x, y, z, ...uv(x, z)]), 0, normalY, 0);
}

function pillar(walls, baseboards, x, z) {
    const [x0, x1, z0, z1] = [x - HALF_PILLAR, x + HALF_PILLAR, z - HALF_PILLAR, z + HALF_PILLAR];
    for (const [y0, y1] of LAYERS) {
        wallQuad(walls, 0, 1, x1, z0, z1, y0, y1);
        wallQuad(walls, 0, -1, x0, z0, z1, y0, y1);
        wallQuad(walls, 1, 1, z1, x0, x1, y0, y1);
        wallQuad(walls, 1, -1, z0, x0, x1, y0, y1);
    }
    flatQuad(walls, x0, x1, z0, z1, WALL_HEIGHT, 1);
    const d = BASEBOARD_DEPTH;
    baseboard(baseboards, 0, 1, x1, z0 - d, z1 + d);
    baseboard(baseboards, 0, -1, x0, z0 - d, z1 + d);
    baseboard(baseboards, 1, 1, z1, x0 - d, x1 + d);
    baseboard(baseboards, 1, -1, z0, x0 - d, x1 + d);
}

// Wall outlets: small plates just above the baseboard, on a few walls.
const OUTLET_WIDTH = 0.034;
const OUTLET_HEIGHT = 0.052;
const OUTLET_Y = 0.085;

function addOutlets(details, seed, grid, x, z, ox, oz) {
    for (const axis of [0, 1]) {
        if ((axis === 0 ? grid.ex(x, z) : grid.ez(x, z)) !== EDGE_WALL) continue;
        for (const side of [1, -1]) {
            if (hashFloat(seed, 0x0071, x, z, axis * 2 + (side > 0 ? 1 : 0)) >= 0.045) continue;
            const along = (hashFloat(seed, 0x0072, x, z, axis) - 0.5) * 0.6;
            const plane = (axis === 0 ? x : z) + 0.5 + side * (HALF_THICKNESS + 0.0015) - (axis === 0 ? ox : oz);
            const centre = (axis === 0 ? z : x) + along - (axis === 0 ? oz : ox);
            // Atlas: the outlet is the left half of the details texture.
            const right = axis === 0 ? -side : side;
            const s0 = centre - OUTLET_WIDTH / 2;
            const s1 = centre + OUTLET_WIDTH / 2;
            const nx = axis === 0 ? side : 0;
            const nz = axis === 0 ? 0 : side;
            const p = (s, y) => (axis === 0 ? [plane, y, s] : [s, y, plane]);
            const left = right > 0 ? s0 : s1;
            const rightEnd = right > 0 ? s1 : s0;
            const y0 = OUTLET_Y - OUTLET_HEIGHT / 2;
            const y1 = OUTLET_Y + OUTLET_HEIGHT / 2;
            details.quad(...p(left, y0), ...p(rightEnd, y0), ...p(rightEnd, y1), ...p(left, y1), nx, 0, nz, 0, 0, 0.5, 1);
        }
    }
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
 * i.e. every other cell. Walls run between cells, so a panel never ends up inside one.
 * Each panel is a bright box with a slightly larger dark frame behind it; colours are baked in as vertex
 * colours so the whole chunk's panels are one draw call.
 * @param {number} panelColor
 * @param {number} frameColor
 */
export function createFixtureGeometry(panelColor, frameColor) {
    const parts = [];
    for (let i = 1; i < CHUNK_SIZE; i += 2) {
        for (let j = 1; j < CHUNK_SIZE; j += 2) {
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

    /**
     * Adds a quad from four [x, y, z, u, v] corners, counter-clockwise as seen from the front.
     * @param {number[][]} corners
     */
    corners(corners, nx, ny, nz) {
        const base = this.positions.length / 3;
        for (const [x, y, z, u, v] of corners) {
            this.positions.push(x, y, z);
            this.normals.push(nx, ny, nz);
            this.uvs.push(u, v);
        }
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
