import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Ambience } from '../src/audio/Ambience.js';
import { PipeDreamsAudio } from '../src/audio/PipeDreams.js';
import { CHUNK_SIZE, HALF_CHUNK } from '../src/config.js';
import { arenaOptions, placeNotes } from '../src/footage/arena.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { PROP_SHELF, makeProp } from '../src/world/decorations.js';
import { PANELS_PER_SIDE } from '../src/world/generator.js';
import { EDGE_NONE, EDGE_WALL } from '../src/world/grid.js';
import { LEVELS, LEVELS_IN_ORDER, TAPE_LEVELS, levelById } from '../src/world/levels.js';
import {
    CELL_GALLERY,
    CELL_MACHINE,
    CELL_MAZE,
    CELL_TUNNEL,
    CELL_X_TUNNEL,
    CELL_Z_TUNNEL,
    FAMILY_X,
    FAMILY_Z,
    FIRE_RANGE,
    FIRE_Y,
    FIXTURE_NONE,
    MACHINE_BOILER,
    TRACKS,
    TRACK_GAP,
    faceTracks,
    firePlace,
    lineAt,
    lineSpace,
    pipeDreamsFloorAt,
    pipeDreamsOptions,
    pipeDreamsWetness,
} from '../src/world/pipeDreams.js';
import { propFootprint } from '../src/world/props.js';
import { ZONE_PLANT, ZONE_STEAM, ZONE_TUNNELS } from '../src/world/zones.js';
import { misfacing } from './meshes.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LEVEL = LEVELS.findIndex((level) => level.name === 'Level 2');

function pipeDreams(seed) {
    return new ChunkStore(seed, null, pipeDreamsOptions(seed));
}

/** Each chunk within `reach` of the origin, for a few seeds. */
function* chunks(seeds = 4, reach = 2) {
    for (let seed = 0; seed < seeds; seed++) {
        const store = pipeDreams(seed);
        for (let cx = -reach; cx <= reach; cx++) {
            for (let cz = -reach; cz <= reach; cz++) yield { seed, store, chunk: store.getChunk(cx, cz) };
        }
    }
}

/** The chunk's cells, as [x, z, i, j]. */
function* cellsOf(chunk) {
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) yield [x0 + i, z0 + j, i, j];
}

describe('Level 2', () => {
    it('is one of the levels, listed by its number, with its own sound; a tape goes down into it from Level 1', () => {
        expect(LEVEL).toBeGreaterThan(0);
        const level = levelById(LEVEL);
        expect(level.number).toBe(2);
        expect(level.options(1).level).toBe(LEVEL);
        expect(typeof level.sound).toBe('function');
        expect(LEVELS_IN_ORDER.map(({ name }) => name)).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 4', 'Level 5', 'Level 37']);
        expect(TAPE_LEVELS.indexOf(LEVEL)).toBe(TAPE_LEVELS.indexOf(1) + 1);
        expect(level.tape.zones).toContain(level.tape.start);
    });

    it('is the same world every time for the same seed, and a different one for another', () => {
        const a = pipeDreams(8).getChunk(1, -2);
        const b = pipeDreams(8).getChunk(1, -2);
        const c = pipeDreams(9).getChunk(1, -2);
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(a.pipeDreams).toEqual(b.pipeDreams);
        expect(a.props).toEqual(b.props);
        expect(Array.from(a.edgesX)).not.toEqual(Array.from(c.edgesX));
    });

    it('has tunnels, plant halls and steam tunnels, and starts in the tunnels', () => {
        const seen = new Set();
        for (const { chunk } of chunks(6, 3)) seen.add(chunk.zone.type);
        expect([...seen].sort()).toEqual([ZONE_TUNNELS, ZONE_PLANT, ZONE_STEAM].sort());
        for (let seed = 0; seed < 5; seed++) expect(pipeDreams(seed).getChunk(0, 0).zone.type).toBe(ZONE_TUNNELS);
    });

    it('starts in a wide tunnel, lit, looking down it: open ahead a long way', () => {
        for (let seed = 0; seed < 8; seed++) {
            const store = pipeDreams(seed);
            for (let x = -1; x <= 1; x++) {
                for (let z = -8; z <= 2; z++) {
                    if (x < 1) expect(store.edgeBetween(x, z, 1, 0), `seed ${seed}: ${x},${z}`).toBe(EDGE_NONE);
                    if (z > -8) expect(store.edgeBetween(x, z, 0, -1), `seed ${seed}: ${x},${z}`).toBe(EDGE_NONE);
                }
            }
            // On down the tunnel at x = 1, into the next chunks.
            for (let z = 2; z > -44; z--) expect(store.edgeBetween(1, z, 0, -1), `seed ${seed}: 1,${z}`).toBe(EDGE_NONE);
            for (const [x, z] of [[-1, -1], [1, -1], [1, -5], [-1, 1]]) {
                const lights = store.panelData(x, z);
                expect(lights[store.panelOffset(x, z)], `seed ${seed}: the lamp at ${x},${z}`).toBe(255);
            }
        }
    });

    it('runs its tunnels on lines of odd cells, the same lines everywhere, with a lamp over every other cell', () => {
        for (const { seed, chunk } of chunks()) {
            const data = chunk.pipeDreams;
            for (const [x, z, i, j] of cellsOf(chunk)) {
                const kind = data.kinds[i * N + j];
                if (kind & CELL_X_TUNNEL) expect(lineAt(seed, FAMILY_X, z), `${x},${z}`).not.toBeNull();
                if (kind & CELL_Z_TUNNEL && !(kind & CELL_GALLERY)) expect(lineAt(seed, FAMILY_Z, x), `${x},${z}`).not.toBeNull();
            }
            for (let pi = 0; pi < PANELS_PER_SIDE; pi++) {
                for (let pj = 0; pj < PANELS_PER_SIDE; pj++) {
                    const kind = data.kinds[(pi * 2 + 1) * N + pj * 2 + 1];
                    if (kind & CELL_TUNNEL && chunk.zone.type !== ZONE_STEAM) expect(data.fixtures[pi * PANELS_PER_SIDE + pj]).not.toBe(FIXTURE_NONE);
                }
            }
        }
    });

    it('carries its tunnels on across the chunk borders', () => {
        let crossings = 0;
        for (const { store, chunk } of chunks()) {
            const x = chunk.cx * N + HALF_CHUNK - 1;
            const data = chunk.pipeDreams;
            // Along x, out of the east side: where the tunnel's on both sides of the border, the way's open.
            for (let j = 0; j < N; j++) {
                const z = chunk.cz * N - HALF_CHUNK + j;
                const next = store.getChunk(chunk.cx + 1, chunk.cz).pipeDreams.kinds[j];
                if (data.kinds[(N - 1) * N + j] & CELL_X_TUNNEL && next & CELL_X_TUNNEL && lineAt(store.seed, FAMILY_X, z) !== null) {
                    expect(store.edgeBetween(x, z, 1, 0), `${x},${z}`).toBe(EDGE_NONE);
                    crossings++;
                }
            }
        }
        expect(crossings).toBeGreaterThan(20);
    });

    it('can be walked all through: every chunk hangs together, and has a way through every border', () => {
        for (const { store, chunk } of chunks(4, 1)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            const seen = new Set(['0,0']);
            const stack = [[0, 0]];
            while (stack.length) {
                const [i, j] = stack.pop();
                for (const [di, dj] of DIRECTIONS) {
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= N || nj >= N || seen.has(`${ni},${nj}`)) continue;
                    if (store.edgeBetween(x0 + i, z0 + j, di, dj) === EDGE_WALL) continue;
                    seen.add(`${ni},${nj}`);
                    stack.push([ni, nj]);
                }
            }
            expect(seen.size, `${chunk.cx},${chunk.cz}`).toBe(N * N);
            let ways = 0;
            for (let k = 0; k < N; k++) if (store.edgeBetween(x0 - 1, z0 + k, 1, 0) !== EDGE_WALL) ways++;
            expect(ways, `${chunk.cx},${chunk.cz}`).toBeGreaterThan(0);
        }
    });

    it('stands its machines in the plant halls: solid, inside their chunk, with nothing walled round them, and their fires lighting only it', () => {
        let boilers = 0;
        for (const { store, chunk } of chunks(6, 2)) {
            const data = chunk.pipeDreams;
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            for (const machine of data.machines) {
                expect(chunk.zone.type).toBe(ZONE_PLANT);
                const [minX, minZ, maxX, maxZ] = chunk.solids.find((box) => box[0] < machine.x && box[2] > machine.x && box[1] < machine.z && box[3] > machine.z);
                expect(minX).toBeGreaterThan(x0 - 0.5);
                expect(minZ).toBeGreaterThan(z0 - 0.5);
                expect(maxX).toBeLessThan(x0 + N - 0.5);
                expect(maxZ).toBeLessThan(z0 + N - 0.5);
                for (let x = Math.round(minX); x <= Math.round(maxX); x++) {
                    for (let z = Math.round(minZ); z <= Math.round(maxZ); z++) {
                        expect(data.kinds[(x - x0) * N + z - z0] & CELL_MACHINE).toBeTruthy();
                        for (const [dx, dz] of DIRECTIONS) expect(store.edgeBetween(x, z, dx, dz)).toBe(EDGE_NONE);
                    }
                }
                if (machine.type !== MACHINE_BOILER) continue;
                boilers++;
                // Every cell its fire lights any of knows where it is, and they're all in the chunk (the next one's cells
                // don't know, so the light would stop dead at the border).
                const [fx, fz] = firePlace(machine);
                const lightX = fx + machine.dx * 0.2;
                const lightZ = fz + machine.dz * 0.2;
                const floor = Math.sqrt(FIRE_RANGE ** 2 - (FIRE_Y + 0.06) ** 2);
                expect(Math.min(lightX - (x0 - 0.5), lightZ - (z0 - 0.5), x0 + N - 0.5 - lightX, z0 + N - 0.5 - lightZ)).toBeGreaterThanOrEqual(floor);
                for (let x = Math.floor(lightX - floor); x <= Math.ceil(lightX + floor); x++) {
                    for (let z = Math.floor(lightZ - floor); z <= Math.ceil(lightZ + floor); z++) {
                        const nearest = Math.hypot(Math.max(0, Math.abs(x - lightX) - 0.5), Math.max(0, Math.abs(z - lightZ) - 0.5));
                        if (nearest >= floor) continue;
                        const k = ((x - x0) * N + z - z0) * 4;
                        expect(chunk.cells[k + 1] + chunk.cells[k + 2], `${x},${z}`).toBeGreaterThan(0);
                    }
                }
                const cellX = Math.round(fx);
                const cellZ = Math.round(fz);
                const k = ((cellX - x0) * N + cellZ - z0) * 4;
                expect(((chunk.cells[k + 1] & 127) - 64) / 16 + cellX).toBeCloseTo(fx, 1);
                expect(((chunk.cells[k + 2] & 127) - 64) / 16 + cellZ).toBeCloseTo(fz, 1);
            }
        }
        expect(boilers).toBeGreaterThan(3);
    });

    it('leaks steam only from pipes that are there: under the ceiling of a tunnel on a line, or on a wall', () => {
        let ceiling = 0;
        let walls = 0;
        for (const { seed, chunk } of chunks(6, 2)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            for (const leak of chunk.pipeDreams.leaks) {
                if (leak.vent) continue;
                const x = Math.round(leak.x);
                const z = Math.round(leak.z);
                const kind = chunk.pipeDreams.kinds[(x - x0) * N + z - z0];
                if (leak.wall) {
                    walls++;
                    expect(kind & (CELL_TUNNEL | CELL_MAZE)).toBeTruthy();
                    continue;
                }
                // (The rusted main blowing in the start gallery: its rack's, not a tunnel's.)
                if (chunk.cx === 0 && chunk.cz === 0 && leak.x === -0.2 && leak.z === -5.6) continue;
                ceiling++;
                expect((kind & CELL_X_TUNNEL) !== 0 || lineAt(seed, FAMILY_Z, x) !== null, `${x},${z}`).toBe(true);
            }
        }
        expect(ceiling).toBeGreaterThan(20);
        expect(walls).toBeGreaterThan(20);
    });

    it('takes the steam and the black stuff off a wall with the wall, in edit mode', () => {
        for (const { store, chunk } of chunks(4, 1)) {
            const drip = chunk.pipeDreams.goo[0];
            const leak = chunk.pipeDreams.leaks.find((l) => l.wall);
            if (!drip || !leak) continue;
            const puffs = (geometry) => geometry.extras.steam?.index.count ?? 0;
            const before = buildChunkGeometry(store, chunk.cx, chunk.cz);
            const edge = (x, z, dx, dz) => (dx !== 0 ? [Math.min(x, x + dx), z, 0] : [x, Math.min(z, z + dz), 1]);
            store.setEdge(...edge(Math.round(drip.x), Math.round(drip.z), -drip.nx, -drip.nz), EDGE_NONE);
            store.setEdge(...edge(Math.round(leak.x), Math.round(leak.z), leak.wall[0], leak.wall[1]), EDGE_NONE);
            const after = buildChunkGeometry(store, chunk.cx, chunk.cz);
            expect(puffs(after)).toBeLessThan(puffs(before));
            expect(after.extras.goo?.index.count ?? 0).toBeLessThan(before.extras.goo.index.count);
            return;
        }
        throw new Error('no chunk with both');
    });

    it('keeps its props inside their cells, the shelves against a wall, and nothing on a machine', () => {
        let shelves = 0;
        for (const { store, chunk } of chunks()) {
            for (const prop of chunk.props) {
                const x = Math.round(prop.x);
                const z = Math.round(prop.z);
                const [minX, minZ, maxX, maxZ] = propFootprint(prop);
                expect(minX).toBeGreaterThan(x - 0.5);
                expect(maxX).toBeLessThan(x + 0.5);
                expect(minZ).toBeGreaterThan(z - 0.5);
                expect(maxZ).toBeLessThan(z + 0.5);
                expect(chunk.pipeDreams.kinds[(x - chunk.cx * N + HALF_CHUNK) * N + z - chunk.cz * N + HALF_CHUNK] & CELL_MACHINE).toBe(0);
                if (prop.type !== PROP_SHELF) continue;
                shelves++;
                const back = [Math.round(-Math.sin(prop.yaw)), Math.round(-Math.cos(prop.yaw))];
                expect(store.edgeBetween(x, z, back[0], back[1])).toBe(EDGE_WALL);
                expect(prop.box).not.toBeNull();
            }
        }
        expect(shelves).toBeGreaterThan(10);
        // (They can be put down in edit mode too, as anything can.)
        expect(makeProp(PROP_SHELF, 0.3, 0, 0, 1).box).not.toBeNull();
    });

    it('gives a wall facing a tunnel the same pipes all along the tunnel, and a room\'s walls none low down', () => {
        const space = lineSpace(5, FAMILY_Z, 3);
        expect(faceTracks(space, 0)).toEqual(faceTracks(space, 0));
        for (let n = 1; n < 200; n++) {
            const room = faceTracks(n * 7919, 1);
            for (const k of [0, 1, 2]) expect(room[k]).toBe(-1);
        }
        // Clear of the middle of the wall, where a tape's notes hang, and of the doorways' heads.
        for (const { y, r, low } of TRACKS) {
            expect(y + r < 0.37 || y - r > 0.72, `${y}`).toBe(true);
            expect(low).toBe(y < 0.5);
        }
    });

    it('builds its own meshes, all of them facing out, near their chunk', () => {
        const seen = new Set();
        for (const { store, chunk } of chunks(3, 1)) {
            const geometry = buildChunkGeometry(store, chunk.cx, chunk.cz);
            seen.add(chunk.zone.type);
            for (const name of ['pipes', 'fixtures', 'glows']) expect(geometry.extras[name], name).toBeTruthy();
            for (const [name, mesh] of Object.entries(geometry.extras)) {
                if (!mesh) continue;
                const p = mesh.attributes.position.array;
                let across = 0;
                let low = Infinity;
                let high = -Infinity;
                for (let i = 0; i < p.length; i += 3) {
                    across = Math.max(across, Math.abs(p[i]), Math.abs(p[i + 2]));
                    low = Math.min(low, p[i + 1]);
                    high = Math.max(high, p[i + 1]);
                }
                expect(across, name).toBeLessThanOrEqual(HALF_CHUNK + 2);
                expect(low, name).toBeGreaterThanOrEqual(-0.05);
                expect(high, name).toBeLessThanOrEqual(1.01);
                if (mesh.attributes.normal) expect(misfacing(mesh), `${name} in ${chunk.cx},${chunk.cz}`).toBe(0);
            }
            // No baseboards, and no wallpaper to peel.
            expect(geometry.baseboards).toBeNull();
            expect(geometry.decals).toBeNull();
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    it('keeps its pipes and fittings clear of a tape\'s notes', () => {
        const material = new MeshBasicMaterial({ side: DoubleSide });
        const raycaster = new Raycaster();
        for (const seed of [1, 2, 3]) {
            const store = new ChunkStore(seed, null, arenaOptions(seed, LEVEL));
            const notes = placeNotes(store, seed);
            /** @type {Map<string, Mesh[]>} */
            const built = new Map();
            const meshesOf = (cx, cz) => {
                const key = `${cx},${cz}`;
                if (!built.has(key)) {
                    const { extras } = buildChunkGeometry(store, cx, cz);
                    built.set(key, ['pipes', 'fixtures', 'paint'].filter((name) => extras[name]).map((name) => {
                        const mesh = new Mesh(extras[name], material);
                        mesh.position.set(cx * N, 0, cz * N);
                        mesh.updateMatrixWorld();
                        return mesh;
                    }));
                }
                return built.get(key);
            };
            for (const note of notes) {
                const cx = Math.floor((note.cellX + HALF_CHUNK) / N);
                const cz = Math.floor((note.cellZ + HALF_CHUNK) / N);
                const meshes = [];
                for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) meshes.push(...meshesOf(cx + dx, cz + dz));
                // From a little way out in front of it, at its corners and middle, to it: nothing in the way.
                const along = new Vector3(note.nz, 0, -note.nx);
                for (const [a, b] of [[0, 0], [-0.05, -0.07], [0.05, -0.07], [-0.05, 0.07], [0.05, 0.07]]) {
                    const at = new Vector3(note.x, note.y + b, note.z).addScaledVector(along, a);
                    const from = at.clone().add(new Vector3(note.nx, 0, note.nz).multiplyScalar(0.3));
                    raycaster.set(from, new Vector3(-note.nx, 0, -note.nz));
                    raycaster.far = 0.3 - 0.001;
                    const hit = raycaster.intersectObjects(meshes, false)[0];
                    expect(hit?.distance, `seed ${seed}, note ${note.index}: something in front of it`).toBeUndefined();
                }
            }
        }
    });

    it('keeps its standing water where the floor shader draws it, and knows the drains\' gratings underfoot', () => {
        let wet = 0;
        let dry = 0;
        for (let x = -40; x < 40; x += 0.7) {
            for (let z = -40; z < 40; z += 0.7) {
                const w = pipeDreamsWetness(x, z, 1 / 3);
                expect(w).toBeGreaterThanOrEqual(0);
                expect(w).toBeLessThanOrEqual(1);
                if (w > 0.6) wet++;
                if (w === 0) dry++;
            }
        }
        const total = Math.ceil(80 / 0.7) ** 2;
        expect(wet / total).toBeGreaterThan(0.04);
        expect(dry / total).toBeGreaterThan(0.4);
        // The gallery's drain runs down its left side, under a grating.
        const store = pipeDreams(4);
        expect(pipeDreamsFloorAt(store, -1.33, -3).grating).toBe(true);
        expect(pipeDreamsFloorAt(store, 0, -3).grating).toBe(false);
    });

    it('stands its wall pipes out from the wall no further than you can get to it (below your eyes)', () => {
        for (const { y, r, low } of TRACKS) {
            if (!low) continue;
            // (Clear of where the camera can be, pressed up to the wall; the big ones are low enough to step over.)
            expect(2 * r + TRACK_GAP).toBeLessThan(0.1);
            expect(y).toBeLessThan(0.35);
        }
    });
});

describe('Level 2 sound', () => {
    it('is safe to use before there is any sound (there is no audio context until the first click)', () => {
        const audio = new PipeDreamsAudio(new Ambience());
        expect(() => {
            audio.setWorld(pipeDreams(3));
            audio.setEnabled(true);
            audio.follow(0, 0, 1, 1, 0.5);
            audio.follow(-1.33, -3, 1, 0, 0.5);
            for (let i = 0; i < 600; i++) audio.update(1 / 60);
            audio.step(1.2, 0, 0);
            audio.step(1.2, -1.33, -3);
            audio.setEnabled(false);
        }).not.toThrow();
        expect(audio.built).toBe(false);
    });
});
