import { describe, expect, it } from 'vitest';
import { HALF_CHUNK, WALL_HEIGHT } from '../src/config.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { EDGE_WALL } from '../src/world/grid.js';
import { tileFell } from '../src/world/decorations.js';

// Parts built from quads by the GeometryBuilder (props are merged from three.js primitives; see below).
const PARTS = ['walls', 'baseboards', 'details', 'shade', 'decals', 'ceilingDecals'];

/** Copies of every array in a chunk's geometry, to compare against later. */
function snapshot(geometry) {
    return PARTS.map((part) => {
        const g = geometry[part];
        return g && [g.attributes.position.array, g.attributes.normal.array, g.attributes.uv.array, g.index.array].map((a) => Array.from(a));
    });
}

/**
 * Smallest and largest of every `stride`th value from `offset` (one coordinate of a vertex attribute). A NaN comes
 * through as NaN. Checked once per mesh rather than once per value: an expect() per vertex makes these tests slow
 * enough to time out on CI.
 */
function range(array, offset = 0, stride = 1) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = offset; i < array.length; i += stride) {
        min = Math.min(min, array[i]);
        max = Math.max(max, array[i]);
    }
    return { min, max };
}

/** Checks every vertex of a mesh is inside the chunk, between `floor` and the ceiling. */
function expectInsideChunk(position, floor) {
    const [x, y, z] = [0, 1, 2].map((axis) => range(position, axis, 3));
    expect(Math.max(-x.min, x.max)).toBeLessThanOrEqual(HALF_CHUNK + 1);
    expect(y.min).toBeGreaterThanOrEqual(floor);
    expect(y.max).toBeLessThanOrEqual(WALL_HEIGHT);
    expect(Math.max(-z.min, z.max)).toBeLessThanOrEqual(HALF_CHUNK + 1);
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
                expectInsideChunk(g.attributes.position.array, 0);
                const n = g.attributes.normal.array;
                let worstNormal = 0;
                for (let i = 0; i < n.length; i += 3) worstNormal = Math.max(worstNormal, Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1));
                // As toBeCloseTo(1, 6) would allow.
                expect(worstNormal).toBeLessThan(5e-7);
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

describe('decals and props', () => {
    it('are built for chunks that have them, inside the chunk and between floor and ceiling', () => {
        let decals = 0;
        let ceilingDecals = 0;
        let props = 0;
        for (let seed = 0; seed < 12; seed++) {
            const store = new ChunkStore(seed);
            for (let cx = -2; cx <= 2; cx++) {
                const geometry = buildChunkGeometry(store, cx, seed % 3);
                const chunk = store.getChunk(cx, seed % 3);
                if (chunk.leaks.length > 0) {
                    expect(geometry.ceilingDecals).not.toBeNull();
                    expect(geometry.decals).not.toBeNull();
                    ceilingDecals++;
                }
                expect(geometry.props !== null).toBe(chunk.props.length > 0);
                for (const part of ['decals', 'ceilingDecals', 'props']) {
                    const g = geometry[part];
                    if (!g) continue;
                    if (part === 'decals') decals++;
                    if (part === 'props') props++;
                    const count = g.attributes.position.count;
                    expect(g.attributes.normal.count).toBe(count);
                    expect(g.attributes.uv.count).toBe(count);
                    if (part === 'props') expect(g.attributes.color.count).toBe(count);
                    expect(g.index).not.toBeNull();
                    expect(Math.max(...g.index.array)).toBe(count - 1);
                    expectInsideChunk(g.attributes.position.array, -0.001);
                    const uv = range(g.attributes.uv.array);
                    expect(uv.min).toBeGreaterThanOrEqual(0);
                    expect(uv.max).toBeLessThanOrEqual(1);
                    expect(g.boundingSphere).not.toBeNull();
                }
            }
        }
        expect(decals).toBeGreaterThan(10);
        expect(ceilingDecals).toBeGreaterThan(5);
        expect(props).toBeGreaterThan(5);
    });

    it('makes a hole in the ceiling where a tile fell, and a shadow under every prop', () => {
        let holes = 0;
        for (let seed = 0; seed < 20; seed++) {
            const store = new ChunkStore(seed);
            for (let cx = -2; cx <= 2; cx++) {
                const chunk = store.getChunk(cx, 1);
                const geometry = buildChunkGeometry(store, cx, 1);
                const fell = chunk.leaks.filter(tileFell).length;
                holes += fell;
                // A stain for every leak, and a hole for every fallen tile.
                expect((geometry.ceilingDecals?.attributes.position.count ?? 0) / 4).toBe(chunk.leaks.length + fell);
                // The middle of the shadow is right under the prop.
                const p = geometry.shade.attributes.position.array;
                for (const prop of chunk.props) {
                    let found = false;
                    for (let i = 0; i < p.length && !found; i += 3) {
                        found = Math.abs(p[i] - (prop.x - cx * 16)) < 1e-4 && Math.abs(p[i + 2] - (prop.z - 16)) < 1e-4 && p[i + 1] < 0.01;
                    }
                    expect(found).toBe(true);
                }
            }
        }
        expect(holes).toBeGreaterThan(3);
    });

    it('keeps peeling wallpaper close enough to its wall that the camera never goes through it', () => {
        // The camera stays 0.12 from a wall's face; a strip's front is part of the walls mesh, lifting off a
        // face by at most 0.1. Everything in the walls mesh is on a wall face, or within that of one.
        let checked = 0;
        for (let seed = 0; seed < 30 && checked < 3; seed++) {
            const store = new ChunkStore(seed);
            const plain = buildChunkGeometry(store, 2, 2);
            const n = plain.walls.attributes.normal.array;
            const p = plain.walls.attributes.position.array;
            // A strip's vertices are the only ones in the walls with a normal that isn't along an axis.
            for (let i = 0; i < n.length; i += 3) {
                const curved = Math.abs(n[i]) > 1e-3 && Math.abs(n[i]) < 0.999 || Math.abs(n[i + 2]) > 1e-3 && Math.abs(n[i + 2]) < 0.999;
                if (!curved) continue;
                checked++;
                // Distance from the nearest wall face (walls run along whole and half units, 0.04 thick).
                const across = Math.abs(n[i]) > Math.abs(n[i + 2]) ? p[i] : p[i + 2];
                const fromLine = Math.abs(across - Math.round(across - 0.5) - 0.5);
                expect(fromLine - 0.04).toBeLessThanOrEqual(0.101);
                expect(p[i + 1]).toBeGreaterThan(0.2);
            }
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('takes a peel off a wall that is knocked down', () => {
        // Find a chunk with a peel: its decals have more quads than its leaks' wet patches.
        for (let seed = 0; seed < 40; seed++) {
            const store = new ChunkStore(seed);
            const before = buildChunkGeometry(store, 1, 1);
            const chunk = store.getChunk(1, 1);
            const quads = (before.decals?.attributes.position.count ?? 0) / 4;
            if (quads <= chunk.leaks.length) continue;
            // Knock down every wall in the chunk; the wet patches are all that's left.
            for (let i = 0; i < 16; i++) {
                for (let j = 0; j < 16; j++) {
                    store.setEdge(16 - 8 + i, 16 - 8 + j, 0, 0);
                    store.setEdge(16 - 8 + i, 16 - 8 + j, 1, 0);
                }
            }
            const after = buildChunkGeometry(store, 1, 1);
            expect((after.decals?.attributes.position.count ?? 0) / 4).toBe(chunk.leaks.length);
            return;
        }
        throw new Error('no chunk with peeling wallpaper found');
    });
});
