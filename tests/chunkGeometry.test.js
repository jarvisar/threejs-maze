import { describe, expect, it } from 'vitest';
import { HALF_CHUNK, WALL_HEIGHT } from '../src/config.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { EDGE_WALL } from '../src/world/grid.js';

const PARTS = ['walls', 'baseboards', 'details'];

/** Copies of every array in a chunk's geometry, to compare against later. */
function snapshot(geometry) {
    return PARTS.map((part) => {
        const g = geometry[part];
        return g && [g.attributes.position.array, g.attributes.normal.array, g.attributes.uv.array, g.index.array].map((a) => Array.from(a));
    });
}

describe('buildChunkGeometry', () => {
    it('gives the same meshes every time', () => {
        const store = new ChunkStore(31);
        expect(snapshot(buildChunkGeometry(store, 2, -1))).toEqual(snapshot(buildChunkGeometry(store, 2, -1)));
    });

    it('keeps each chunk\'s meshes separate from the next one built', () => {
        // The builders are reused from chunk to chunk; a finished mesh must not change afterwards.
        const store = new ChunkStore(5);
        const first = buildChunkGeometry(store, 0, 0);
        const before = snapshot(first);
        for (let i = 1; i <= 4; i++) buildChunkGeometry(store, i, -i);
        expect(snapshot(first)).toEqual(before);
    });

    it('makes well-formed meshes inside the chunk', () => {
        let largest = 0;
        for (let seed = 0; seed < 12; seed++) {
            const store = new ChunkStore(seed);
            const geometry = buildChunkGeometry(store, seed % 3, -(seed % 4));
            for (const part of PARTS) {
                const g = geometry[part];
                if (!g) continue;
                const count = g.attributes.position.count;
                largest = Math.max(largest, count);
                expect(g.attributes.normal.count).toBe(count);
                expect(g.attributes.uv.count).toBe(count);
                expect(count % 4).toBe(0);
                expect(g.index.count).toBe((count / 4) * 6);
                expect(g.index.array).toBeInstanceOf(count > 65535 ? Uint32Array : Uint16Array);
                expect(Math.max(...g.index.array)).toBe(count - 1);
                const p = g.attributes.position.array;
                for (let i = 0; i < p.length; i += 3) {
                    expect(Math.abs(p[i])).toBeLessThanOrEqual(HALF_CHUNK + 1);
                    expect(p[i + 1]).toBeGreaterThanOrEqual(0);
                    expect(p[i + 1]).toBeLessThanOrEqual(WALL_HEIGHT);
                    expect(Math.abs(p[i + 2])).toBeLessThanOrEqual(HALF_CHUNK + 1);
                }
                const n = g.attributes.normal.array;
                for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 6);
                expect(g.boundingSphere).not.toBeNull();
            }
        }
        // Big enough that the builders had to grow past their starting size.
        expect(largest).toBeGreaterThan(1024);
    });

    it('meshes a chunk full of walls', () => {
        const store = new ChunkStore(9);
        for (let x = -HALF_CHUNK; x < HALF_CHUNK; x++) {
            for (let z = -HALF_CHUNK; z < HALF_CHUNK; z++) {
                store.setEdge(x, z, 0, EDGE_WALL);
                store.setEdge(x, z, 1, EDGE_WALL);
            }
        }
        const { walls, baseboards } = buildChunkGeometry(store, 0, 0);
        expect(walls.attributes.position.count).toBeGreaterThan(4096);
        expect(baseboards.attributes.position.count).toBeGreaterThan(4096);
    });
});
