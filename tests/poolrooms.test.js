import { describe, expect, it } from 'vitest';
import { Ambience } from '../src/audio/Ambience.js';
import { PoolroomsAudio } from '../src/audio/Poolrooms.js';
import { CHUNK_SIZE, EYE_HEIGHT, STEP_HEIGHT, WALL_HEIGHT } from '../src/config.js';
import { Player } from '../src/player/Player.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { EDGE_WALL } from '../src/world/grid.js';
import { HEIGHT_STEP } from '../src/world/ground.js';
import { LEVELS, levelById } from '../src/world/levels.js';
import { CHEST, DECK, POOLROOMS_ZONES, poolroomsOptions } from '../src/world/poolrooms.js';
import { archCurve } from '../src/world/poolroomsGeometry.js';
import { ZONE_BATHS } from '../src/world/zones.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LEVEL = LEVELS.findIndex((level) => level.name === 'Level 37');

function poolrooms(seed) {
    return new ChunkStore(seed, null, poolroomsOptions(seed));
}

/** Each chunk within `reach` of the origin, for a few seeds. */
function* chunks(seeds = 5, reach = 2) {
    for (let seed = 0; seed < seeds; seed++) {
        const store = poolrooms(seed);
        for (let cx = -reach; cx <= reach; cx++) {
            for (let cz = -reach; cz <= reach; cz++) yield { store, chunk: store.getChunk(cx, cz) };
        }
    }
}

/** A cell's floor at its side DIRECTIONS[d], for walking across it (a stair's sides count as its top). */
function edgeHeight(ground, k, d) {
    const stair = ground.stairs[k];
    if (stair === 0 || d === stair - 1) return ground.heights[k];
    return ground.tops[k];
}

describe('Level 37', () => {
    it('is one of the levels, under water, with its own sound', () => {
        expect(LEVEL).toBeGreaterThan(0);
        const level = levelById(LEVEL);
        expect(level.water).toBe(true);
        expect(level.options(3).level).toBe(LEVEL);
        expect(typeof level.sound).toBe('function');
        for (const other of LEVELS) if (other !== level) expect(other.water).toBe(false);
        // Where every world starts is a hall of pools.
        expect(POOLROOMS_ZONES.start).toBe(ZONE_BATHS);
    });

    it('is the same world every time for the same seed', () => {
        const a = poolrooms(7).getChunk(1, -2);
        const b = poolrooms(7).getChunk(1, -2);
        expect(Array.from(a.ground.heights)).toEqual(Array.from(b.ground.heights));
        expect(Array.from(a.ground.stairs)).toEqual(Array.from(b.ground.stairs));
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(Array.from(a.lights)).toEqual(Array.from(b.lights));
        expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    });

    it('starts on a walkway, looking at steps down into a pool', () => {
        const store = poolrooms(1);
        expect(store.groundAt(0, 0)).toBeCloseTo(DECK * HEIGHT_STEP);
        expect(store.groundAt(0, -5)).toBeCloseTo(CHEST * HEIGHT_STEP);
        // Down the steps ahead, the floor only ever goes down.
        let last = Infinity;
        for (let z = -1.5; z >= -3; z -= 0.05) {
            const here = store.groundAt(0, z);
            expect(here).toBeLessThanOrEqual(last + 1e-9);
            last = here;
        }
    });

    it('keeps its pools a cell clear of every chunk edge, so the floor meets the next chunk at walking height', () => {
        for (const { chunk } of chunks()) {
            const { heights, stairs } = chunk.ground;
            for (let k = 0; k < N; k++) {
                for (const [i, j] of [[0, k], [N - 1, k], [k, 0], [k, N - 1]]) {
                    expect(heights[i * N + j]).toBeGreaterThan(-8);
                    expect(stairs[i * N + j]).toBe(0);
                }
            }
        }
    });

    it('has steps into every pool, from floor you can walk on, with nothing walled across them', () => {
        for (const { chunk } of chunks()) {
            const { heights, stairs, tops } = chunk.ground;
            for (const pool of chunk.poolrooms.pools) {
                let found = false;
                for (let i = pool.i0; i < pool.i1; i++) {
                    for (let j = pool.j0; j < pool.j1; j++) {
                        const k = i * N + j;
                        if (stairs[k] === 0) continue;
                        expect(tops[k]).toBeGreaterThan(heights[k]);
                        // The cell above it: its top is that cell's floor (or the bottom of the stair before it).
                        const [dx, dz] = DIRECTIONS[stairs[k] - 1];
                        const above = (i - dx) * N + (j - dz);
                        expect(heights[above]).toBe(tops[k]);
                        const wall = dx !== 0 ? chunk.edgesX[(dx > 0 ? i - 1 : i) * N + j] : chunk.edgesZ[i * N + (dz > 0 ? j - 1 : j)];
                        expect(wall).not.toBe(EDGE_WALL);
                        if (stairs[above] === 0) found = true;
                    }
                }
                expect(found, `pool at ${pool.i0},${pool.j0} of chunk ${chunk.cx},${chunk.cz}`).toBe(true);
            }
        }
    });

    it('never traps you: from every cell there is a way to the edge of its chunk, down steps and up stairs', () => {
        for (const { chunk } of chunks(4)) {
            const ground = chunk.ground;
            const between = (i, j, d) => {
                const [di, dj] = DIRECTIONS[d];
                if (di === 1) return chunk.edgesX[i * N + j];
                if (di === -1) return chunk.edgesX[(i - 1) * N + j];
                if (dj === 1) return chunk.edgesZ[i * N + j];
                return chunk.edgesZ[i * N + j - 1];
            };
            const out = new Uint8Array(N * N);
            const queue = [];
            for (let i = 0; i < N; i++) {
                for (let j = 0; j < N; j++) {
                    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) {
                        out[i * N + j] = 1;
                        queue.push(i * N + j);
                    }
                }
            }
            while (queue.length > 0) {
                const k = queue.pop();
                const i = Math.floor(k / N);
                const j = k % N;
                for (let d = 0; d < 4; d++) {
                    const [di, dj] = DIRECTIONS[d];
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= N || nj >= N || out[ni * N + nj]) continue;
                    if (between(i, j, d) === EDGE_WALL) continue;
                    // Stepping from the neighbour into this cell, the way (−di, −dj).
                    const leave = edgeHeight(ground, ni * N + nj, d ^ 1);
                    const enter = edgeHeight(ground, k, d);
                    if (enter > leave + STEP_HEIGHT / HEIGHT_STEP) continue;
                    out[ni * N + nj] = 1;
                    queue.push(ni * N + nj);
                }
            }
            expect(out.every((reached) => reached === 1), `chunk ${chunk.cx},${chunk.cz}`).toBe(true);
        }
    });

    it('builds every chunk into meshes with nothing out of place', () => {
        const store = poolrooms(2);
        for (let cx = -1; cx <= 1; cx++) {
            for (let cz = -1; cz <= 1; cz++) {
                const geometry = buildChunkGeometry(store, cx, cz);
                for (const [name, mesh] of Object.entries(geometry.extras)) {
                    if (!mesh) continue;
                    for (const attribute of Object.values(mesh.attributes)) {
                        expect(attribute.array.every(Number.isFinite), `${name}.${attribute.name}`).toBe(true);
                    }
                }
                expect(geometry.extras.tiles).toBeTruthy();
                // Nothing of the ceiling is above the skylights' glass, or of the floor below the deepest pool.
                const heights = geometry.extras.tiles.attributes.position.array.filter((_, k) => k % 3 === 1);
                expect(Math.max(...heights)).toBeLessThanOrEqual(1.31);
                expect(Math.min(...heights)).toBeGreaterThanOrEqual(-1.9);
            }
        }
    });

    it('curves its arches and vaults from low on the columns up to the ceiling, and no higher', () => {
        expect(archCurve(1, 1)[0]).toBeLessThan(0.35);
        expect(archCurve(0, 1)[0]).toBeCloseTo(WALL_HEIGHT);
        for (let u = -1; u <= 1; u += 0.05) expect(archCurve(u, 1)[0]).toBeLessThanOrEqual(WALL_HEIGHT);
    });
});

describe('walking in Level 37', () => {
    const still = { forward: 0, right: 0, up: 0, sprint: false };
    const ahead = { forward: 1, right: 0, up: 0, sprint: false };

    function world() {
        const store = poolrooms(1);
        return {
            store,
            boxesNear: (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors),
            terrain: { groundAt: (x, z) => store.groundAt(x, z), water: 0 },
        };
    }

    function walk(player, w, input, yaw, steps) {
        for (let k = 0; k < steps; k++) player.step(input, yaw, 1, w.boxesNear, w.terrain);
    }

    it('goes down the steps into the pool, and back up them out of it', () => {
        const w = world();
        const player = new Player();
        player.reset(0, 0);
        walk(player, w, still, 0, 30);
        expect(player.position.y).toBeCloseTo(DECK * HEIGHT_STEP + EYE_HEIGHT, 3);
        // Ahead (−z), down the steps and across the pool to its far side.
        walk(player, w, ahead, 0, 900);
        expect(player.position.z).toBeLessThan(-5);
        expect(player.position.y).toBeCloseTo(CHEST * HEIGHT_STEP + EYE_HEIGHT, 2);
        expect(player.depth).toBeGreaterThan(0.3);
        // Its far wall is too high to climb.
        const z = player.position.z;
        walk(player, w, ahead, 0, 300);
        expect(player.position.z).toBeGreaterThan(-7.5);
        expect(Math.abs(player.position.z - z)).toBeLessThan(1.2);
        // Back the way it came, up the steps (and not on into the pool behind the start).
        walk(player, w, ahead, Math.PI, 520);
        expect(player.position.z).toBeGreaterThan(-1.5);
        expect(player.position.z).toBeLessThan(3);
        expect(player.position.y).toBeCloseTo(DECK * HEIGHT_STEP + EYE_HEIGHT, 3);
    });

    it('falls in off the side, and sinks slowly to the bottom', () => {
        const w = world();
        const player = new Player();
        player.reset(-4, -4.5);
        walk(player, w, still, 0, 30);
        const landings = player.landings;
        // Along +x, off the edge into the pool.
        let lowest = player.position.y;
        let fell = 0;
        for (let k = 0; k < 400; k++) {
            player.step(ahead, -Math.PI / 2, 1, w.boxesNear, w.terrain);
            if (player.position.y < lowest - 1e-6) fell++;
            lowest = Math.min(lowest, player.position.y);
        }
        expect(player.position.y).toBeCloseTo(CHEST * HEIGHT_STEP + EYE_HEIGHT, 2);
        expect(player.landings).toBe(landings + 1);
        // (Not in one go.)
        expect(fell).toBeGreaterThan(8);
        // And can't get back up the side it fell off.
        walk(player, w, ahead, Math.PI / 2, 400);
        expect(player.position.x).toBeGreaterThan(-3.5);
    });

    it('climbs a pool\'s ladder out of the water, by walking into it', () => {
        const store = poolrooms(1);
        const w = {
            boxesNear: (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors),
            terrain: { groundAt: (x, z) => store.groundAt(x, z), water: 0, ladderAt: (x, z, reach) => store.ladderAt(x, z, reach) },
        };
        const ladders = [];
        for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) ladders.push(...store.getChunk(cx, cz).poolrooms.ladders);
        expect(ladders.length).toBeGreaterThan(0);
        for (const ladder of ladders) {
            const player = new Player();
            player.reset(ladder.x + ladder.nx * 0.5, ladder.z + ladder.nz * 0.5);
            walk(player, w, still, 0, 400);
            expect(player.position.y).toBeLessThan(0.2);
            // Facing the ladder: forward is (−sin yaw, −cos yaw).
            const yaw = Math.atan2(ladder.nx, ladder.nz);
            let climbed = 0;
            let off = 0;
            let highest = -Infinity;
            // Up it, and a few steps on.
            for (let k = 0; k < 400 && (off === 0 || k < off + 30); k++) {
                player.step(ahead, yaw, 1, w.boxesNear, w.terrain);
                if (player.climbing && climbed === 0) climbed = k;
                if (climbed > 0 && !player.climbing && off === 0) off = k;
                highest = Math.max(highest, player.position.y);
            }
            expect(climbed).toBeGreaterThan(0);
            const out = (player.position.x - ladder.x) * ladder.nx + (player.position.z - ladder.z) * ladder.nz;
            expect(out).toBeLessThan(0);
            // Not with a bump at the top.
            expect(highest).toBeLessThanOrEqual(player.floor + EYE_HEIGHT + 1e-6);
            expect(player.position.y).toBeCloseTo(player.floor + EYE_HEIGHT, 5);
            expect(player.floor).toBeGreaterThan(-0.1);
        }
    });

    it('moves the same on a flat level as it always has', () => {
        const store = new ChunkStore(1);
        const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors);
        const a = new Player();
        const b = new Player();
        for (let k = 0; k < 200; k++) {
            a.step(ahead, 0.3, 1, boxesNear);
            b.step(ahead, 0.3, 1, boxesNear, null);
        }
        expect(a.position.toArray()).toEqual(b.position.toArray());
        expect(a.position.y).toBe(EYE_HEIGHT);
    });
});

describe('Level 37 sound', () => {
    it('is safe to use before there is any sound (there is no audio context until the first click)', () => {
        const ambience = new Ambience();
        const audio = new PoolroomsAudio(ambience);
        expect(() => {
            audio.setEnabled(true);
            audio.follow(0, 0, 1, 1, 0.5);
            audio.follow(0, 0, 1, 0, -0.3);
            for (let i = 0; i < 600; i++) audio.update(1 / 60);
            audio.step(1.2, 0, 0, 0);
            audio.step(1.2, 0, 0, 0.1);
            audio.step(1.2, 0, 0, 0.5);
            audio.splash(1);
            audio.drip(1, -0.5, true);
            audio.setEnabled(false);
        }).not.toThrow();
        expect(audio.built).toBe(false);
    });
});
