import { it } from 'vitest';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { LEVELS } from '../src/world/levels.js';

// Scratch benchmark (deleted afterwards): chunk generation and geometry per level.
it('bench', () => {
    const rows = [];
    for (const level of LEVELS) {
        const tris = {};
        let genMs = 0;
        let buildMs = 0;
        let count = 0;
        for (const seed of [1, 2, 3]) {
            const store = new ChunkStore(seed, null, level.options(seed));
            const t0 = performance.now();
            for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) store.getChunk(cx, cz);
            // Neighbours, for the builds.
            for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) store.getChunk(cx, cz);
            genMs += performance.now() - t0;
            for (let cx = -3; cx <= 3; cx++) {
                for (let cz = -3; cz <= 3; cz++) {
                    const t1 = performance.now();
                    const g = buildChunkGeometry(store, cx, cz);
                    buildMs += performance.now() - t1;
                    count++;
                    const add = (name, geo) => {
                        if (!geo) return;
                        const n = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
                        tris[name] = (tris[name] ?? 0) + n;
                    };
                    for (const [name, geo] of Object.entries(g)) if (geo && geo.isBufferGeometry) add(name, geo);
                    for (const [name, geo] of Object.entries(g.extras ?? {})) add(`x.${name}`, geo);
                }
            }
        }
        const per = Object.fromEntries(Object.entries(tris).map(([k, v]) => [k, Math.round(v / count)]));
        const total = Object.values(per).reduce((a, b) => a + b, 0);
        rows.push(`${level.name}: gen ${(genMs / (3 * 81)).toFixed(2)} ms/chunk, build ${(buildMs / count).toFixed(2)} ms/chunk, tris/chunk ${total} ${JSON.stringify(per)}`);
    }
    console.log(rows.join('\n'));
}, 120_000);
