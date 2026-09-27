import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { CEILING_TILES_X, CEILING_TILES_Z, CHUNK_SIZE, PANEL_HALF_X, PANEL_HALF_Z, WALL_HEIGHT } from '../src/config.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry, createCeilingGeometry, createFixtureGeometry, createFloorGeometry } from '../src/world/chunkGeometry.js';
import { ARENA, arenaOptions, openExit, placeNotes } from '../src/footage/arena.js';
import { chunkCoord, edgeBoxes, pillarBox } from '../src/world/grid.js';
import { LEVELS, levelById } from '../src/world/levels.js';
import { PROP_ATLAS, PROP_ATLAS_HEIGHT, PROP_ATLAS_WIDTH } from '../src/world/props.js';
import { coplanarOverlaps, tJunctions } from './meshes.js';

const N = CHUNK_SIZE;

// The meshes drawn over what's under them (decals, with a polygon offset), and the ones that are seen through or
// glow: these are meant to lie on other surfaces.
const OVERLAID = new Set(['shade', 'decals', 'ceilingDecals', 'partyDecals', 'paint', 'goo', 'trim', 'water', 'glows', 'steam']);

const floor = createFloorGeometry();
const ceiling = createCeilingGeometry();
const cellFloor = createFloorGeometry(true);
const cellCeiling = createCeilingGeometry(true);
const fixtures = createFixtureGeometry(0xffffff, 0x808080, 0x000000);

/** Every solid mesh of the chunks from (cx, cz) to (cx + 1, cz + 1), where WorldView puts them, named as it does. */
function solidMeshes(store, cx, cz) {
    const shape = levelById(store.level).shape;
    const meshes = [];
    const add = (name, geometry, x, z) => {
        if (!geometry || OVERLAID.has(name)) return;
        const mesh = new Mesh(geometry);
        mesh.name = name;
        mesh.position.set(x * N, 0, z * N);
        meshes.push(mesh);
    };
    for (let x = cx; x <= cx + 1; x++) {
        for (let z = cz; z <= cz + 1; z++) {
            const empty = store.options.isVoid?.(x, z) === true;
            if (shape.floor || empty) add('floor', shape.floor ? floor : cellFloor, x, z);
            if (shape.ceiling || empty) add('ceiling', shape.ceiling ? ceiling : cellCeiling, x, z);
            if (shape.panels && !empty) add('fixtures', fixtures, x, z);
            const { extras, ...own } = buildChunkGeometry(store, x, z);
            for (const [name, geometry] of [...Object.entries(own), ...Object.entries(extras)]) add(name, geometry, x, z);
        }
    }
    return meshes;
}

// Where a triangle is all one colour, and (on the props' texture) all in its plain white square: what it looks like.
const [plainU0, plainU1] = [PROP_ATLAS.plain[0] / PROP_ATLAS_WIDTH, PROP_ATLAS.plain[2] / PROP_ATLAS_WIDTH];
const [plainV0, plainV1] = [1 - PROP_ATLAS.plain[3] / PROP_ATLAS_HEIGHT, 1 - PROP_ATLAS.plain[1] / PROP_ATLAS_HEIGHT];
function look(mesh, corners) {
    const color = mesh.geometry.attributes.color?.array;
    if (!color) return null;
    const uv = mesh.geometry.attributes.uv?.array;
    const of = (i) => {
        const u = uv?.[i * 2];
        const v = uv?.[i * 2 + 1];
        const plain = !uv || (u >= plainU0 - 1e-3 && u <= plainU1 + 1e-3 && v >= plainV0 - 1e-3 && v <= plainV1 + 1e-3);
        return `${[0, 1, 2].map((k) => color[i * 3 + k].toFixed(3))} ${plain ? 'plain' : `${u},${v}`}`;
    };
    const [a, b, c] = corners.map(of);
    return a === b && b === c ? a : null;
}

describe('the meshes of every level', () => {
    /** Overlaps among the solid meshes of the chunks from (cx, cz) to (cx + 1, cz + 1), the first few of them. */
    const overlaps = (store, cx, cz) => {
        const where = [];
        // (The undersides of things standing on the floor can't be seen.)
        const onFloor = ([x, y, z], normal) => normal[1] < -0.99 && Math.abs(y - store.groundAt(x, z)) < 0.003;
        coplanarOverlaps(solidMeshes(store, cx, cz), { where, skip: onFloor, look });
        return where.slice(0, 3);
    };

    for (const level of LEVELS) {
        it(`${level.name}: no two solid surfaces overlap in one plane`, () => {
            for (const seed of [3, 11]) expect(overlaps(new ChunkStore(seed, null, level.options(seed)), -1, 0), `seed ${seed}`).toEqual([]);
        });

        it(`${level.name}: nor on a tape, where the walls round it meet the nothing outside`, () => {
            for (const seed of [3, 11]) {
                const store = new ChunkStore(seed, null, arenaOptions(seed, level.id));
                placeNotes(store, seed);
                const exit = openExit(store, 0, 0);
                // Its corners on the low sides (where its walls are the empty chunks') and on the high ones, and the way out.
                expect(overlaps(store, ARENA.cx0 - 1, ARENA.cz0 - 1), `seed ${seed}`).toEqual([]);
                expect(overlaps(store, ARENA.cx1, ARENA.cz1), `seed ${seed}`).toEqual([]);
                const [x, z] = exit.cells[0];
                expect(overlaps(store, chunkCoord(x) + Math.min(exit.dx, 0), chunkCoord(z) + Math.min(exit.dz, 0)), `seed ${seed}`).toEqual([]);
            }
        });
    }

    it('Level 1: the beams share their corners where they meet, across chunk borders too', () => {
        const level = LEVELS.findIndex((l) => l.name === 'Level 1');
        for (const seed of [3, 11]) {
            const store = new ChunkStore(seed, null, levelById(level).options(seed));
            const meshes = solidMeshes(store, 0, 0).filter((mesh) => mesh.name === 'pillars');
            expect(tJunctions(meshes), `seed ${seed}`).toBe(0);
        }
    });
});

describe('the things left about on every level', () => {
    /** Whether two boxes [minX, minZ, maxX, maxZ] overlap by more than a hair. */
    const overlap = (a, b) => a[0] < b[2] - 0.001 && b[0] < a[2] - 0.001 && a[1] < b[3] - 0.001 && b[1] < a[3] - 0.001;

    for (const level of LEVELS) {
        it(`${level.name}: stand clear of the walls, the pillars, the level's own furniture and each other`, () => {
            for (const seed of [0, 1, 2, 3]) {
                const store = new ChunkStore(seed, null, level.options(seed));
                for (let cx = -2; cx <= 1; cx++) {
                    for (let cz = -2; cz <= 1; cz++) {
                        const chunk = store.getChunk(cx, cz);
                        const x0 = cx * N - N / 2;
                        const z0 = cz * N - N / 2;
                        const walls = [];
                        for (let x = x0 - 1; x <= x0 + N; x++) {
                            for (let z = z0 - 1; z <= z0 + N; z++) {
                                for (const axis of [0, 1]) edgeBoxes(x, z, axis, store.edge(x, z, axis), walls);
                                if (store.pillar(x, z)) walls.push(pillarBox(x, z, store.pillarHalf));
                            }
                        }
                        const props = chunk.props.filter((prop) => prop.box);
                        for (const prop of props) {
                            const where = `seed ${seed}: prop ${prop.type} at ${prop.x.toFixed(2)},${prop.z.toFixed(2)}`;
                            expect(walls.some((box) => overlap(prop.box, box)), `${where}, in a wall`).toBe(false);
                            expect((chunk.solids ?? []).some((box) => overlap(prop.box, box)), `${where}, in the furniture`).toBe(false);
                            expect(props.some((other) => other !== prop && overlap(prop.box, other.box)), `${where}, in another`).toBe(false);
                        }
                    }
                }
            }
        });
    }
});

describe("Level 0's light panels", () => {
    it('each take the place of one ceiling tile, in the middle of its cell, a little below the ceiling', () => {
        const position = fixtures.attributes.position;
        const color = fixtures.attributes.color;
        const lenses = new Set();
        for (let i = 0; i < position.count; i++) {
            const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
            // Its cell, the one with odd world coordinates in the chunk (the mesh is centred on it, an even number of cells
            // from the origin), and where in it.
            const [cx, cz] = [2 * Math.round((x - 1) / 2) + 1, 2 * Math.round((z - 1) / 2) + 1];
            expect(Math.abs(x - cx)).toBeLessThanOrEqual(PANEL_HALF_X + 1e-6);
            expect(Math.abs(z - cz)).toBeLessThanOrEqual(PANEL_HALF_Z + 1e-6);
            expect(y).toBeGreaterThan(WALL_HEIGHT - 0.005);
            expect(y).toBeLessThanOrEqual(WALL_HEIGHT + 1e-6);
            // The lens is the only part with a blue of 1 (see the panel surface in levelShading.js), and lies inside the rest.
            if (color.getZ(i) > 0.99) {
                lenses.add(`${cx},${cz}`);
                expect(Math.abs(x - cx)).toBeLessThan(PANEL_HALF_X);
                expect(Math.abs(z - cz)).toBeLessThan(PANEL_HALF_Z);
            }
        }
        expect(lenses.size).toBe((N / 2) ** 2);
        // One tile: the tiles are centred on the cells.
        expect(PANEL_HALF_X * 2).toBeCloseTo(1 / CEILING_TILES_X);
        expect(PANEL_HALF_Z * 2).toBeCloseTo(1 / CEILING_TILES_Z);
    });

    it('leave a hole where a sodden tile fell that is one tile, in the grid', () => {
        let holes = 0;
        for (let seed = 0; seed < 12; seed++) {
            const store = new ChunkStore(seed);
            for (let cx = -2; cx <= 2; cx++) {
                for (let cz = -2; cz <= 2; cz++) {
                    const { ceilingDecals } = buildChunkGeometry(store, cx, cz);
                    if (!ceilingDecals) continue;
                    const position = ceilingDecals.attributes.position;
                    // The holes are the quads nearest the ceiling (the stains are a little further below it).
                    const top = Math.max(...Array.from({ length: position.count }, (_, i) => position.getY(i)));
                    for (let i = 0; i < position.count; i += 4) {
                        if (position.getY(i) !== top) continue;
                        const xs = [0, 1, 2, 3].map((k) => position.getX(i + k) + cx * N);
                        const zs = [0, 1, 2, 3].map((k) => position.getZ(i + k) + cz * N);
                        const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
                        // (Where there's no hole, the ones nearest the ceiling are stains, far bigger than a tile.)
                        if (Math.abs(x1 - x0 - 1 / CEILING_TILES_X) > 0.02) continue;
                        holes++;
                        expect(((x0 + x1) / 2) * CEILING_TILES_X).toBeCloseTo(Math.round(((x0 + x1) / 2) * CEILING_TILES_X), 5);
                        expect(((z0 + z1) / 2) * CEILING_TILES_Z).toBeCloseTo(Math.round(((z0 + z1) / 2) * CEILING_TILES_Z), 5);
                        expect(z1 - z0).toBeCloseTo(1 / CEILING_TILES_Z - 0.008, 5);
                    }
                }
            }
        }
        expect(holes).toBeGreaterThan(3);
    });
});
