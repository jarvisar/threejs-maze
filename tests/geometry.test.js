import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../src/config.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry, createCeilingGeometry, createFixtureGeometry, createFloorGeometry } from '../src/world/chunkGeometry.js';
import { ARENA, arenaOptions, openExit, placeNotes } from '../src/footage/arena.js';
import { chunkCoord } from '../src/world/grid.js';
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
const fixtures = createFixtureGeometry(0xffffff, 0x000000);

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
