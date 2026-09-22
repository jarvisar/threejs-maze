import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../src/config.js';
import { ChunkStore, cellCoord, chunkCoord, chunkKey } from '../src/world/ChunkStore.js';
import { generateChunkCells } from '../src/world/maze.js';
import { hashInts, mulberry32, parseSeed } from '../src/world/random.js';

const at = (cells, x, z) => cells[x * CHUNK_SIZE + z];

describe('generateChunkCells', () => {
    it('is deterministic for a given random sequence', () => {
        const a = generateChunkCells(CHUNK_SIZE, mulberry32(42));
        const b = generateChunkCells(CHUNK_SIZE, mulberry32(42));
        expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('keeps the chunk-border and centre hallways open', () => {
        for (let seed = 0; seed < 50; seed++) {
            const cells = generateChunkCells(CHUNK_SIZE, mulberry32(seed));
            for (let k = 0; k < CHUNK_SIZE; k++) {
                expect(at(cells, 0, k)).toBe(0);
                expect(at(cells, k, 0)).toBe(0);
                expect(at(cells, CHUNK_SIZE / 2, k)).toBe(0);
                expect(at(cells, k, CHUNK_SIZE / 2)).toBe(0);
            }
        }
    });

    it('never puts a wall under a ceiling light (cells with two even coordinates)', () => {
        for (let seed = 0; seed < 50; seed++) {
            const cells = generateChunkCells(CHUNK_SIZE, mulberry32(seed));
            for (let x = 0; x < CHUNK_SIZE; x += 2) {
                for (let z = 0; z < CHUNK_SIZE; z += 2) expect(at(cells, x, z)).toBe(0);
            }
        }
    });

    it('produces a similar wall density to the original generator', () => {
        let walls = 0;
        const samples = 200;
        for (let seed = 0; seed < samples; seed++) {
            walls += generateChunkCells(CHUNK_SIZE, mulberry32(seed)).reduce((sum, v) => sum + v, 0);
        }
        const density = walls / (samples * CHUNK_SIZE * CHUNK_SIZE);
        expect(density).toBeGreaterThan(0.3);
        expect(density).toBeLessThan(0.45);
    });

    it('leaves every open cell reachable', () => {
        // Pockets can form against a chunk's far edge, but they open onto the neighbouring chunk's
        // border hallway (its row/column 0 is always open), so model that hallway as an extra open ring.
        const N = CHUNK_SIZE + 1;
        for (let seed = 0; seed < 200; seed++) {
            const cells = generateChunkCells(CHUNK_SIZE, mulberry32(seed));
            const open = (x, z) => x === CHUNK_SIZE || z === CHUNK_SIZE || at(cells, x, z) === 0;
            const seen = new Uint8Array(N * N);
            const stack = [[0, 0]];
            seen[0] = 1;
            while (stack.length) {
                const [x, z] = stack.pop();
                for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
                    if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
                    if (!seen[nx * N + nz] && open(nx, nz)) { seen[nx * N + nz] = 1; stack.push([nx, nz]); }
                }
            }
            for (let x = 0; x < CHUNK_SIZE; x++) {
                for (let z = 0; z < CHUNK_SIZE; z++) if (at(cells, x, z) === 0) expect(seen[x * N + z]).toBe(1);
            }
        }
    });

    it('rejects odd sizes', () => {
        expect(() => generateChunkCells(9, mulberry32(1))).toThrow();
    });
});

describe('ChunkStore', () => {
    it('maps cells to chunks the same way the renderer does', () => {
        expect(chunkCoord(-5)).toBe(0);
        expect(chunkCoord(4)).toBe(0);
        expect(chunkCoord(5)).toBe(1);
        expect(chunkCoord(-6)).toBe(-1);
        expect(cellCoord(0.49)).toBe(0);
        expect(cellCoord(0.5)).toBe(1);
        expect(cellCoord(-0.5)).toBe(0);
        expect(cellCoord(-0.51)).toBe(-1);
    });

    it('gives each chunk a unique key', () => {
        const keys = new Set();
        for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) keys.add(chunkKey(x, z));
        expect(keys.size).toBe(41 * 41);
    });

    it('generates the same world for the same seed', () => {
        const a = new ChunkStore(1234);
        const b = new ChunkStore(1234);
        for (let x = -30; x < 30; x++) for (let z = -30; z < 30; z++) expect(a.isWall(x, z)).toBe(b.isWall(x, z));
    });

    it('generates different worlds for different seeds', () => {
        const a = new ChunkStore(1);
        const b = new ChunkStore(2);
        let differences = 0;
        for (let x = -30; x < 30; x++) for (let z = -30; z < 30; z++) if (a.isWall(x, z) !== b.isWall(x, z)) differences++;
        expect(differences).toBeGreaterThan(100);
    });

    it('always spawns the player in open space', () => {
        for (let seed = 0; seed < 100; seed++) {
            const store = new ChunkStore(seed);
            for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) expect(store.isWall(x, z)).toBe(false);
        }
    });

    it('applies edits, including in negative chunks', () => {
        const store = new ChunkStore(7);
        expect(store.setWall(-13, 27, true)).toBe(true);
        expect(store.isWall(-13, 27)).toBe(true);
        expect(store.setWall(-13, 27, true)).toBe(false);
        expect(store.setWall(-13, 27, false)).toBe(true);
        expect(store.isWall(-13, 27)).toBe(false);
    });
});

describe('random helpers', () => {
    it('parses numeric and text seeds', () => {
        expect(parseSeed('12345')).toBe(12345);
        expect(parseSeed('  42 ')).toBe(42);
        expect(parseSeed('')).toBeNull();
        expect(parseSeed(null)).toBeNull();
        expect(parseSeed('hello')).toBe(parseSeed('hello'));
        expect(parseSeed('hello')).not.toBe(parseSeed('world'));
        expect(parseSeed('99999999999')).toBeTypeOf('number');
    });

    it('hashes neighbouring coordinates to unrelated values', () => {
        const values = new Set();
        for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) values.add(hashInts(1, x, z));
        expect(values.size).toBe(121);
    });

    it('mulberry32 stays in [0, 1)', () => {
        const random = mulberry32(99);
        for (let i = 0; i < 10000; i++) {
            const v = random();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});
