import { CHUNK_SIZE, HALF_CHUNK } from '../config.js';
import { generateChunkCells } from './maze.js';
import { hashInts, mulberry32 } from './random.js';

/**
 * The world's source of truth: which cells are walls.
 *
 * Cells are unit squares centred on integer (x, z) coordinates. Chunk (cx, cz) covers cells
 * x ∈ [cx·10 − 5, cx·10 + 4] (same for z), so its centre sits at (cx·10, cz·10).
 *
 * Chunk layouts are derived from the world seed and the chunk's coordinates, so the same seed always
 * produces the same world. Generated (and edited) chunks are kept in memory; at 100 bytes each that is
 * negligible even after hours of exploring, and it means edits survive walking away and coming back.
 */
export class ChunkStore {
    /** @param {number} seed */
    constructor(seed) {
        this.seed = seed >>> 0;
        /** @type {Map<number, Uint8Array>} */
        this.chunks = new Map();
    }

    /** @returns {Uint8Array} The chunk's cells (generated on first access). */
    getChunk(cx, cz) {
        const key = chunkKey(cx, cz);
        let cells = this.chunks.get(key);
        if (cells === undefined) {
            cells = generateChunkCells(CHUNK_SIZE, mulberry32(hashInts(this.seed, cx, cz)));
            this.chunks.set(key, cells);
        }
        return cells;
    }

    /** Whether the cell at integer coordinates (x, z) is a wall. */
    isWall(x, z) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const cells = this.getChunk(cx, cz);
        return cells[(x - cx * CHUNK_SIZE + HALF_CHUNK) * CHUNK_SIZE + (z - cz * CHUNK_SIZE + HALF_CHUNK)] === 1;
    }

    /**
     * Adds or removes a wall.
     * @returns {boolean} true if the cell changed.
     */
    setWall(x, z, wall) {
        const cx = chunkCoord(x);
        const cz = chunkCoord(z);
        const cells = this.getChunk(cx, cz);
        const i = (x - cx * CHUNK_SIZE + HALF_CHUNK) * CHUNK_SIZE + (z - cz * CHUNK_SIZE + HALF_CHUNK);
        const value = wall ? 1 : 0;
        if (cells[i] === value) return false;
        cells[i] = value;
        return true;
    }
}

/** The chunk coordinate containing integer cell coordinate `c`. */
export function chunkCoord(c) {
    return Math.floor((c + HALF_CHUNK) / CHUNK_SIZE);
}

/** The cell containing world position `p`. */
export function cellCoord(p) {
    return Math.floor(p + 0.5);
}

/** A unique numeric key for a chunk (exact for |cz| < 2^25). */
export function chunkKey(cx, cz) {
    return cx * 67108864 + cz;
}
