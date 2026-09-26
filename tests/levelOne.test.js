import { Matrix4, MeshPhongMaterial, ShaderLib } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, HALF_CHUNK, PLAYER_RADIUS } from '../src/config.js';
import { moveAndCollide } from '../src/player/collision.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { PROP_CRATES, PROP_NAMES, PROP_RACK } from '../src/world/decorations.js';
import { EditLog } from '../src/world/edits.js';
import { PANELS_PER_SIDE } from '../src/world/generator.js';
import { EDGE_WALL } from '../src/world/grid.js';
import { BAY, FIXTURE_NONE, LEVEL_ONE_PILLAR, isColumnCorner, levelOneOptions, levelOneZoneAt } from '../src/world/levelOne.js';
import { levelOneWetness } from '../src/world/levelOneWater.js';
import { LEVELS, TAPE_LEVELS, isFirstTapeLevel, levelById, partyLevel } from '../src/world/levels.js';
import { backroomsNoise } from '../src/world/panelLights.js';
import { setShadingLevel, withBackroomsShading } from '../src/world/materials.js';
import { buildPropGeometry, templateFor } from '../src/world/props.js';
import { ZONE_PARKING, ZONE_SERVICE, ZONE_STORAGE } from '../src/world/zones.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function levelOne(seed) {
    return new ChunkStore(seed, null, levelOneOptions(seed));
}

/** Each chunk within `reach` of the origin, for a few seeds. */
function* chunks(seeds = 6, reach = 2) {
    for (let seed = 0; seed < seeds; seed++) {
        const store = levelOne(seed);
        for (let cx = -reach; cx <= reach; cx++) {
            for (let cz = -reach; cz <= reach; cz++) yield { store, chunk: store.getChunk(cx, cz) };
        }
    }
}

describe('the levels', () => {
    it('are numbered in order, each with everything the game needs from one', () => {
        LEVELS.forEach((level, id) => {
            expect(level.id).toBe(id);
            expect(level.name).toMatch(/\S/);
            expect(level.title).toMatch(/\S/);
            expect(level.about).toMatch(/\S/);
            expect(typeof level.generate).toBe('function');
            expect(level.options(1).level ?? 0).toBe(id);
            expect(level.shape.pillarSize).toBeGreaterThan(0);
            expect(typeof level.surfaces).toBe('function');
            expect(level.sound === null || typeof level.sound === 'function').toBe(true);
            expect(typeof level.reflections).toBe('boolean');
            expect(level.tape.zones.length).toBe(16);
            expect(level.tape.zones).toContain(level.tape.start);
            expect(level.tape.notes.length).toBe(8);
        });
        expect(levelById(99)).toBe(LEVELS[0]);
        for (const id of TAPE_LEVELS) expect(LEVELS[id]).toBeDefined();
    });

    it('know which one a tape starts on, and which one Level Fun can dress', () => {
        expect(TAPE_LEVELS.filter(isFirstTapeLevel)).toEqual([TAPE_LEVELS[0]]);
        expect(LEVELS[partyLevel()].dressable).toBe(true);
    });

    it('each put their light and air into the shaders, without any of them branching on which level it is', () => {
        const compile = (material) => {
            const shader = { uniforms: {}, vertexShader: ShaderLib.phong.vertexShader, fragmentShader: ShaderLib.phong.fragmentShader };
            material.onBeforeCompile(shader);
            return shader.fragmentShader;
        };
        for (const level of LEVELS) {
            for (const hook of ['vec3 levelLightTint( float code )', 'vec3 levelAir( vec3 color, vec3 haze, float fogFactor, float area )', 'const vec3 LEVEL_DEAD_LIGHT']) {
                expect(level.shading, `${level.name}: ${hook}`).toContain(hook);
            }
            // A level's own surface is compiled for it, whichever is showing; the party's only where it can be.
            const own = compile(withBackroomsShading(new MeshPhongMaterial(), 'wall', level.id));
            expect(own).toContain(level.shading);
            expect(own.startsWith('#define BACKROOMS_PARTY')).toBe(level.dressable);
            for (const other of LEVELS) if (other !== level) expect(own).not.toContain(other.shading);
        }
        // What shows on every level follows the one that's showing, and is its own program for each.
        const everywhere = withBackroomsShading(new MeshPhongMaterial(), 'fixture');
        const own = withBackroomsShading(new MeshPhongMaterial(), 'wall', 0);
        try {
            setShadingLevel(1);
            expect(compile(everywhere)).toContain(LEVELS[1].shading);
            const key = everywhere.customProgramCacheKey();
            const ownKey = own.customProgramCacheKey();
            const version = everywhere.version;
            setShadingLevel(0);
            expect(compile(everywhere)).toContain(LEVELS[0].shading);
            expect(everywhere.customProgramCacheKey()).not.toBe(key);
            expect(everywhere.version).toBeGreaterThan(version);
            expect(own.customProgramCacheKey()).toBe(ownKey);
        } finally {
            setShadingLevel(0);
        }
    });

    it('share the surfaces every level has where they have nothing of their own', () => {
        const shared = { wall: {}, floor: {}, ceiling: {}, details: {} };
        const surfaces = LEVELS[0].surfaces(shared, 1);
        for (const name of ['wall', 'floor', 'ceiling', 'details']) expect(surfaces[name]).toBe(shared[name]);
        expect(surfaces.extras).toEqual({});
    });

    it('build a store that makes the level\'s own chunks', () => {
        const store = levelOne(3);
        expect(store.level).toBe(1);
        expect(store.pillarHalf).toBe(LEVEL_ONE_PILLAR / 2);
        expect(store.getChunk(0, 0).levelOne).toBeDefined();
        expect(new ChunkStore(3).getChunk(0, 0).levelOne).toBeUndefined();
    });
});

describe('Level 1', () => {
    it('is the same place every time for a seed, and a different one for another', () => {
        const a = levelOne(12).getChunk(1, -1);
        const b = levelOne(12).getChunk(1, -1);
        const c = levelOne(13).getChunk(1, -1);
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(Array.from(a.lights)).toEqual(Array.from(b.lights));
        expect(a.props).toEqual(b.props);
        expect(a.levelOne.cars).toEqual(b.levelOne.cars);
        expect([...a.edgesX, ...a.lights]).not.toEqual([...c.edgesX, ...c.lights]);
    });

    it('starts in a car park, and is mostly car park, with a warehouse and service corridors', () => {
        const counts = new Map();
        for (let seed = 0; seed < 4; seed++) {
            expect(levelOneZoneAt(seed, 0, 0).type).toBe(ZONE_PARKING);
            for (let cx = -12; cx < 12; cx++) {
                for (let cz = -12; cz < 12; cz++) {
                    const type = levelOneZoneAt(seed, cx, cz).type;
                    counts.set(type, (counts.get(type) ?? 0) + 1);
                }
            }
        }
        expect([...counts.keys()].sort()).toEqual([ZONE_PARKING, ZONE_STORAGE, ZONE_SERVICE].sort());
        expect(counts.get(ZONE_PARKING)).toBeGreaterThan(counts.get(ZONE_STORAGE));
    });

    it('stands its columns on one grid across the whole level, clear of the walls', () => {
        for (const { store, chunk } of chunks(3)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            for (let i = 0; i < N; i++) {
                for (let j = 0; j < N; j++) {
                    if (!chunk.pillars[i * N + j]) continue;
                    const x = x0 + i;
                    const z = z0 + j;
                    expect(isColumnCorner(x, z)).toBe(true);
                    // Nothing runs into it.
                    expect(store.edge(x, z, 0)).not.toBe(EDGE_WALL);
                    expect(store.edge(x, z, 1)).not.toBe(EDGE_WALL);
                }
            }
        }
        // And there are plenty of them: a car park is columns.
        const parking = [...chunks(3)].filter(({ chunk }) => chunk.zone.type === ZONE_PARKING);
        const columns = parking.reduce((sum, { chunk }) => sum + chunk.pillars.reduce((a, b) => a + b, 0), 0);
        expect(columns / parking.length).toBeGreaterThan(15);
        expect(BAY).toBe(3);
    });

    it('can be walked all through, and from where you start there\'s an aisle ahead', () => {
        for (let seed = 0; seed < 4; seed++) {
            const store = levelOne(seed);
            // Every cell of a chunk reachable from every other, without leaving it.
            for (const [cx, cz] of [[0, 0], [1, 2], [-2, 1]]) {
                const x0 = cx * N - HALF_CHUNK;
                const z0 = cz * N - HALF_CHUNK;
                const seen = new Set([`${x0},${z0}`]);
                const stack = [[x0, z0]];
                while (stack.length) {
                    const [x, z] = stack.pop();
                    for (const [dx, dz] of DIRECTIONS) {
                        const nx = x + dx;
                        const nz = z + dz;
                        if (nx < x0 || nz < z0 || nx >= x0 + N || nz >= z0 + N || seen.has(`${nx},${nz}`)) continue;
                        if (store.edgeBetween(x, z, dx, dz) === EDGE_WALL) continue;
                        seen.add(`${nx},${nz}`);
                        stack.push([nx, nz]);
                    }
                }
                expect(seen.size, `seed ${seed} chunk ${cx},${cz}`).toBe(N * N);
            }
            // Straight ahead from the start (towards −z), a few bays without a wall or a prop in the way.
            const player = { x: 0, z: 0 };
            moveAndCollide(player, 0, -5, PLAYER_RADIUS, (a, b, c, d) => store.boxesNear(a, b, c, d));
            expect(player.z).toBeCloseTo(-5);
            expect(store.propsAt(0, -1)).toEqual([]);
        }
    });

    it('hangs its battens in rows in the car park, and one over every slot in the corridors', () => {
        let rows = 0;
        let slots = 0;
        for (const { chunk } of chunks(4)) {
            const { fixtures } = chunk.levelOne;
            const empty = fixtures.filter((f) => f === FIXTURE_NONE).length;
            if (chunk.zone.type === ZONE_SERVICE) expect(empty).toBe(0);
            else {
                rows += empty;
                slots += fixtures.length;
            }
            // Where there's no batten there's no light.
            for (let k = 0; k < PANELS_PER_SIDE * PANELS_PER_SIDE; k++) if (fixtures[k] === FIXTURE_NONE) expect(chunk.lights[k * 4]).toBe(0);
        }
        expect(rows / slots).toBeCloseTo(0.5, 1);
    });

    it('has supply crates, and racking in the warehouse, all kept inside their cells and solid', () => {
        const seen = new Set();
        for (const { chunk } of chunks(6)) {
            for (const prop of chunk.props) {
                seen.add(PROP_NAMES[prop.type]);
                const cx = Math.round(prop.x);
                const cz = Math.round(prop.z);
                expect(cx).toBeGreaterThanOrEqual(chunk.cx * N - HALF_CHUNK);
                expect(cx).toBeLessThan(chunk.cx * N + HALF_CHUNK);
                expect(cz).toBeGreaterThanOrEqual(chunk.cz * N - HALF_CHUNK);
                expect(cz).toBeLessThan(chunk.cz * N + HALF_CHUNK);
                if (prop.type === PROP_RACK) {
                    // A bay of racking takes its cell's length, and blocks it.
                    expect(prop.box).not.toBeNull();
                    const [x0, z0, x1, z1] = prop.box;
                    expect(Math.max(x1 - x0, z1 - z0)).toBeCloseTo(0.9, 2);
                }
                if (prop.type === PROP_CRATES) expect(prop.box).not.toBeNull();
            }
        }
        for (const name of ['crates', 'boxes', 'pallet', 'barrel', 'cone', 'rack']) expect(seen.has(name), name).toBe(true);
    });

    it('leaves the odd car in the bays, inside its chunk, solid, and never in a wall or a column', () => {
        let cars = 0;
        for (const { store, chunk } of chunks(8)) {
            for (const [k, car] of chunk.levelOne.cars.entries()) {
                cars++;
                const box = chunk.solids[k];
                const [x0, z0, x1, z1] = box;
                expect(x0).toBeGreaterThan(chunk.cx * N - HALF_CHUNK - 0.5);
                expect(x1).toBeLessThan(chunk.cx * N + HALF_CHUNK - 0.5);
                expect(z0).toBeGreaterThan(chunk.cz * N - HALF_CHUNK - 0.5);
                expect(z1).toBeLessThan(chunk.cz * N + HALF_CHUNK - 0.5);
                expect(store.boxesNear(car.x - 0.1, car.z - 0.1, car.x + 0.1, car.z + 0.1)).toContainEqual(box);
                // Nothing else solid overlaps it (walls, columns).
                for (const other of store.boxesNear(x0, z0, x1, z1)) {
                    if (other === box) continue;
                    const overlaps = other[2] > x0 + 0.01 && other[0] < x1 - 0.01 && other[3] > z0 + 0.01 && other[1] < z1 - 0.01;
                    expect(overlaps && chunk.props.every((p) => p.box !== other)).toBe(false);
                }
            }
        }
        expect(cars).toBeGreaterThan(5);
    });

    it('builds its own meshes: columns and beams, battens, pipes, tubes, glows and paint', () => {
        const store = levelOne(7);
        const geometry = buildChunkGeometry(store, 0, 0);
        for (const name of ['pillars', 'fixtures', 'services', 'glows', 'paint']) {
            const mesh = geometry.extras[name];
            expect(mesh, name).toBeTruthy();
            const position = mesh.attributes.position;
            for (let i = 0; i < position.count; i++) {
                expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(HALF_CHUNK + 1);
                expect(position.getY(i)).toBeGreaterThanOrEqual(-0.02);
                expect(position.getY(i)).toBeLessThanOrEqual(1.001);
            }
        }
        // No baseboards, and no wallpaper to peel.
        expect(geometry.baseboards).toBeNull();
        expect(geometry.decals).toBeNull();
        // Level 0 has none of it.
        expect(buildChunkGeometry(new ChunkStore(7), 0, 0).extras).toEqual({});
    });

    it('keeps its puddles where the shader draws them', () => {
        // The same noise as the shaders' backroomsNoise: smooth, 0..1, whole numbers giving a lattice value.
        expect(backroomsNoise(3, 4)).toBeCloseTo(backroomsNoise(3.0000001, 4), 5);
        let wet = 0;
        let dry = 0;
        for (let x = -40; x < 40; x += 0.7) {
            for (let z = -40; z < 40; z += 0.7) {
                const w = levelOneWetness(x, z);
                expect(w).toBeGreaterThanOrEqual(0);
                expect(w).toBeLessThanOrEqual(1);
                if (w > 0.6) wet++;
                if (w === 0) dry++;
            }
        }
        const total = Math.ceil(80 / 0.7) ** 2;
        expect(wet / total).toBeGreaterThan(0.08);
        expect(dry / total).toBeGreaterThan(0.3);
    });

    it('keeps its edits apart from Level 0\'s with the same seed', () => {
        expect(new EditLog(55).world).toBe(55);
        expect(new EditLog(55, 1).world).toBe('1:55');
        expect(new EditLog(55, 2).world).toBe('2:55');
    });

    it('builds its props into one mesh just as their templates look, turned and moved into place', () => {
        const matrix = new Matrix4();
        let racks = 0;
        // Level 1 (and a stretch of it all warehouse, for the racking), and Level 0.
        const warehouse = new ChunkStore(4, null, { level: 1, zoneAt: (cx, cz) => ({ type: ZONE_STORAGE, variant: cx * 31 + cz }) });
        for (const store of [levelOne(4), warehouse, new ChunkStore(4)]) {
            for (const [cx, cz] of [[0, 0], [1, -1], [2, 1], [-2, 0]]) {
                const props = store.getChunk(cx, cz).props;
                if (props.length === 0) continue;
                racks += props.filter((p) => p.type === PROP_RACK).length;
                const ox = cx * N;
                const oz = cz * N;
                const built = buildPropGeometry(props, ox, oz);
                // The slow way: each template copied, moved, and merged.
                const expected = mergeGeometries(props.map((p) => templateFor(p).clone().applyMatrix4(matrix.makeRotationY(p.yaw).setPosition(p.x - ox, 0, p.z - oz))));
                for (const name of ['position', 'normal', 'uv', 'color']) {
                    const a = built.attributes[name].array;
                    const b = expected.attributes[name].array;
                    expect(a.length).toBe(b.length);
                    let worst = 0;
                    for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
                    expect(worst, name).toBeLessThan(1e-5);
                }
                expect(Array.from(built.index.array)).toEqual(Array.from(expected.index.array));
            }
        }
        expect(racks).toBeGreaterThan(0);
    });
});
