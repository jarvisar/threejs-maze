import { CHUNK_SIZE, HALF_CHUNK } from '../config.js';
import { EDIT_EDGE_X, EDIT_EDGE_Z, EDIT_PILLAR } from './edits.js';
import { PANELS_PER_SIDE, generateChunk } from './generator.js';
import { EDGE_NONE, EDGE_WALL, chunkCoord, chunkKey, edgeBoxes, pillarBox } from './grid.js';

/**
 * The world's source of truth: where the walls, doorways and pillars are, and the state of every ceiling
 * light. See grid.js for how edges and corners are addressed.
 *
 * Chunk (cx, cz) covers cells x ∈ [cx·16 − 8, cx·16 + 7] (same for z), so its centre sits near (cx·16, cz·16).
 * Chunk layouts are derived from the world seed and the chunk's coordinates, so the same seed always
 * produces the same world. Generated (and edited) chunks are kept in memory; at about 1 kB each that is
 * negligible even after hours of exploring, and it means edits survive walking away and coming back.
 */
export class ChunkStore {
    /**
     * @param {number} seed
     * @param {import('./edits.js').EditLog | null} [edits] Where changes made in edit mode are kept.
     */
    constructor(seed, edits = null) {
        this.seed = seed >>> 0;
        this.edits = edits;
        /** @type {Map<number, import('./generator.js').ChunkData>} */
        this.chunks = new Map();
        /** @type {number[][]} */
        this._boxes = [];
    }

    /** @returns {import('./generator.js').ChunkData} The chunk (generated on first access). */
    getChunk(cx, cz) {
        const key = chunkKey(cx, cz);
        let chunk = this.chunks.get(key);
        if (chunk === undefined) {
            chunk = generateChunk(this.seed, cx, cz);
            this.edits?.applyTo(chunk);
            this.chunks.set(key, chunk);
        }
        return chunk;
    }

    /**
     * The edge on the +x side (axis 0) or +z side (axis 1) of cell (x, z).
     * @returns {number} EDGE_NONE, EDGE_WALL or EDGE_DOOR.
     */
    edge(x, z, axis) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const i = localIndex(x, z, cx, cz);
        return axis === 0 ? chunk.edgesX[i] : chunk.edgesZ[i];
    }

    /**
     * Changes an edge.
     * @returns {boolean} true if it changed.
     */
    setEdge(x, z, axis, type) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const chunk = this.getChunk(cx, cz);
        const i = localIndex(x, z, cx, cz);
        const edges = axis === 0 ? chunk.edgesX : chunk.edgesZ;
        if (edges[i] === type) return false;
        edges[i] = type;
        this.edits?.record(cx, cz, axis === 0 ? EDIT_EDGE_X : EDIT_EDGE_Z, i, type);
        return true;
    }

    /** The edge between cell (x, z) and its neighbour (x + dx, z + dz), where exactly one of dx, dz is ±1. */
    edgeBetween(x, z, dx, dz) {
        if (dx === 1) return this.edge(x, z, 0);
        if (dx === -1) return this.edge(x - 1, z, 0);
        if (dz === 1) return this.edge(x, z, 1);
        return this.edge(x, z - 1, 1);
    }

    /** Whether the corner at (x + 0.5, z + 0.5) holds a pillar. */
    pillar(x, z) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        return this.getChunk(cx, cz).pillars[localIndex(x, z, cx, cz)] === 1;
    }

    /** @returns {boolean} true if it changed. */
    setPillar(x, z, on) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const pillars = this.getChunk(cx, cz).pillars;
        const i = localIndex(x, z, cx, cz);
        const value = on ? 1 : 0;
        if (pillars[i] === value) return false;
        pillars[i] = value;
        this.edits?.record(cx, cz, EDIT_PILLAR, i, value);
        return true;
    }

    /**
     * The light data of the ceiling panel above cell (x, z), which must have odd coordinates.
     * @returns {Uint8Array} Four bytes starting at `this.panelOffset(x, z)`; see ChunkData.lights.
     */
    panelData(x, z) {
        return this.getChunk(chunkCoord(x), chunkCoord(z)).lights;
    }

    panelOffset(x, z) {
        const lx = x - chunkCoord(x) * CHUNK_SIZE + HALF_CHUNK;
        const lz = z - chunkCoord(z) * CHUNK_SIZE + HALF_CHUNK;
        return (((lx - 1) >> 1) * PANELS_PER_SIDE + ((lz - 1) >> 1)) * 4;
    }

    /**
     * How lit the area around a point is, 0..1: the panels' area light, blended between the four nearest
     * panels. (The shaders do exactly the same with the copy of this data on the GPU.)
     */
    areaLight(x, z) {
        const u = (x - 1) / 2;
        const v = (z - 1) / 2;
        const i = Math.floor(u);
        const j = Math.floor(v);
        const fu = u - i;
        const fv = v - j;
        const px = i * 2 + 1;
        const pz = j * 2 + 1;
        const at = (x0, z0) => this.panelData(x0, z0)[this.panelOffset(x0, z0) + 1] / 255;
        const a = at(px, pz);
        const b = at(px + 2, pz);
        const c = at(px, pz + 2);
        const d = at(px + 2, pz + 2);
        return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
    }

    /**
     * Every solid box (walls, doorway sides, pillars) that might overlap the given rectangle, as
     * [minX, minZ, maxX, maxZ]. The returned array is reused between calls.
     * @param {boolean} [doorsSolid] Treat doorways as solid walls (for someone too tall to fit under them).
     */
    boxesNear(minX, minZ, maxX, maxZ, doorsSolid = false) {
        const boxes = this._boxes;
        boxes.length = 0;
        const x0 = Math.floor(minX) - 1;
        const x1 = Math.ceil(maxX) + 1;
        const z0 = Math.floor(minZ) - 1;
        const z1 = Math.ceil(maxZ) + 1;
        for (let x = x0; x <= x1; x++) {
            for (let z = z0; z <= z1; z++) {
                const ex = this.edge(x, z, 0);
                if (ex !== EDGE_NONE) edgeBoxes(x, z, 0, doorsSolid ? EDGE_WALL : ex, boxes);
                const ez = this.edge(x, z, 1);
                if (ez !== EDGE_NONE) edgeBoxes(x, z, 1, doorsSolid ? EDGE_WALL : ez, boxes);
                if (this.pillar(x, z)) boxes.push(pillarBox(x, z));
            }
        }
        return boxes;
    }
}

function localIndex(x, z, cx, cz) {
    return (x - cx * CHUNK_SIZE + HALF_CHUNK) * CHUNK_SIZE + (z - cz * CHUNK_SIZE + HALF_CHUNK);
}

export { cellCoord, chunkCoord, chunkKey } from './grid.js';
