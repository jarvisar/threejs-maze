import { describe, expect, it } from 'vitest';
import { Ambience } from '../src/audio/Ambience.js';
import { TerrorHotelAudio } from '../src/audio/TerrorHotel.js';
import { CHUNK_SIZE, DOOR_WIDTH, HALF_CHUNK } from '../src/config.js';
import { arenaOptions, placeNotes } from '../src/footage/arena.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { EDGE_NONE, EDGE_WALL, chunkCoord } from '../src/world/grid.js';
import { LEVELS, LEVELS_IN_ORDER, TAPE_LEVELS, levelById } from '../src/world/levels.js';
import {
    CELL_BALLROOM,
    CELL_CORRIDOR,
    CELL_HALL,
    DOOR_ELEVATOR,
    GALLERY,
    SCONCE_WALLS,
    isHall,
    terrorHotelOptions,
} from '../src/world/terrorHotel.js';
import { ZONE_BALLROOM, ZONE_GUEST, ZONE_LOBBY, ZONE_STAFF } from '../src/world/zones.js';

const N = CHUNK_SIZE;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LEVEL = LEVELS.findIndex((level) => level.name === 'Level 5');

function hotel(seed) {
    return new ChunkStore(seed, null, terrorHotelOptions(seed));
}

/** Each chunk within `reach` of the origin, for a few seeds. */
function* chunks(seeds = 4, reach = 2) {
    for (let seed = 0; seed < seeds; seed++) {
        const store = hotel(seed);
        for (let cx = -reach; cx <= reach; cx++) {
            for (let cz = -reach; cz <= reach; cz++) yield { seed, store, chunk: store.getChunk(cx, cz) };
        }
    }
}

/** What cell (x, z) is (CELL_*), wherever it is. */
function kindAt(store, x, z) {
    const chunk = store.getChunk(chunkCoord(x), chunkCoord(z));
    return chunk.terrorHotel.kinds[(x - chunk.cx * N + HALF_CHUNK) * N + (z - chunk.cz * N + HALF_CHUNK)];
}

/** Whether two boxes [minX, minZ, maxX, maxZ] overlap. */
function overlap(a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

describe('Level 5', () => {
    it('is one of the levels, listed by its number, with its own sound; no tape goes through it yet', () => {
        expect(LEVEL).toBeGreaterThan(0);
        const level = levelById(LEVEL);
        expect(level.number).toBe(5);
        expect(level.options(1).level).toBe(LEVEL);
        expect(typeof level.sound).toBe('function');
        expect(LEVELS_IN_ORDER.map(({ name }) => name)).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 4', 'Level 5', 'Level 37']);
        expect(TAPE_LEVELS).not.toContain(LEVEL);
        expect(level.tape.zones).toContain(level.tape.start);
    });

    it('is the same hotel every time for the same seed, and a different one for another', () => {
        const a = hotel(8).getChunk(1, -2);
        const b = hotel(8).getChunk(1, -2);
        const c = hotel(9).getChunk(1, -2);
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(a.terrorHotel).toEqual(b.terrorHotel);
        expect(a.props).toEqual(b.props);
        expect(a.solids).toEqual(b.solids);
        expect(Array.from(a.edgesX)).not.toEqual(Array.from(c.edgesX));
    });

    it('has guest floors, lobbies, the ballroom and the staff passages, and starts on a guest floor', () => {
        const seen = new Set();
        for (const { chunk } of chunks(6, 3)) seen.add(chunk.zone.type);
        expect([...seen].sort()).toEqual([ZONE_GUEST, ZONE_LOBBY, ZONE_BALLROOM, ZONE_STAFF].sort());
        for (let seed = 0; seed < 5; seed++) expect(hotel(seed).getChunk(0, 0).zone.type).toBe(ZONE_GUEST);
    });

    it('starts at the lifts, in a lit promenade, looking down it and on down the corridor a long way', () => {
        for (let seed = 0; seed < 8; seed++) {
            const store = hotel(seed);
            for (let x = GALLERY.x0; x <= GALLERY.x1; x++) {
                for (let z = GALLERY.z0; z <= GALLERY.z1; z++) {
                    if (x < GALLERY.x1) expect(store.edgeBetween(x, z, 1, 0), `seed ${seed}: ${x},${z}`).toBe(EDGE_NONE);
                    if (z > GALLERY.z0) expect(store.edgeBetween(x, z, 0, -1), `seed ${seed}: ${x},${z}`).toBe(EDGE_NONE);
                }
                // Behind you, the lifts you came up in.
                expect(store.edgeBetween(x, GALLERY.z1, 0, 1), `seed ${seed}: ${x}`).toBe(EDGE_WALL);
            }
            const lifts = store.getChunk(0, 0).terrorHotel.doors.filter((door) => door.axis === 1 && door.z === GALLERY.z1 && door.x >= GALLERY.x0 && door.x <= GALLERY.x1);
            expect(lifts.map((door) => door.kind), `seed ${seed}`).toEqual([DOOR_ELEVATOR, DOOR_ELEVATOR]);
            // (Into a lobby, it's the lobby's: its walls can be across the way.)
            for (let z = GALLERY.z1; z > -44 && !isHall(store.getChunk(0, chunkCoord(z - 1)).zone.type); z--) {
                expect(store.edgeBetween(1, z, 0, -1), `seed ${seed}: 1,${z}`).toBe(EDGE_NONE);
            }
            expect(store.edgeBetween(1, -HALF_CHUNK, 0, -1), `seed ${seed}: out of the chunk`).toBe(EDGE_NONE);
            const lights = store.panelData(1, -1);
            expect(lights[store.panelOffset(1, -1)], `seed ${seed}`).toBeGreaterThan(0);
        }
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

    it('sets its doors that don\'t open in walls, facing a corridor or a hall, with no sconce over them and nothing solid in front', () => {
        let doors = 0;
        for (const { store, chunk } of chunks(4, 2)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            for (const door of chunk.terrorHotel.doors) {
                doors++;
                const where = `${door.x},${door.z},${door.axis}`;
                expect(door.x - x0, where).toBeGreaterThanOrEqual(0);
                expect(door.z - z0, where).toBeGreaterThanOrEqual(0);
                expect(door.x - x0, where).toBeLessThan(N);
                expect(door.z - z0, where).toBeLessThan(N);
                expect(store.edge(door.x, door.z, door.axis), where).toBe(EDGE_WALL);
                const [fx, fz] = door.axis === 0 ? [door.x + (door.front > 0 ? 1 : 0), door.z] : [door.x, door.z + (door.front > 0 ? 1 : 0)];
                expect(kindAt(store, fx, fz) & (CELL_CORRIDOR | CELL_HALL | CELL_BALLROOM), where).toBeTruthy();
                for (const side of [-1, 1]) {
                    // The cell on this side of it, and the way to its wall from there.
                    const [cx, cz] = door.axis === 0 ? [door.x + (side > 0 ? 1 : 0), door.z] : [door.x, door.z + (side > 0 ? 1 : 0)];
                    const [di, dj] = door.axis === 0 ? [-side, 0] : [0, -side];
                    const cell = store.getChunk(chunkCoord(cx), chunkCoord(cz));
                    const [, , bit] = SCONCE_WALLS.find(([a, b]) => a === di && b === dj);
                    const local = (cx - cell.cx * N + HALF_CHUNK) * N + (cz - cell.cz * N + HALF_CHUNK);
                    expect(cell.terrorHotel.sconces[local] & bit, `${where}: a sconce`).toBe(0);
                    const wall = (door.axis === 0 ? door.x : door.z) + 0.5;
                    const along = door.axis === 0 ? door.z : door.x;
                    const [a0, a1] = [Math.min(wall, wall + side * 0.3), Math.max(wall, wall + side * 0.3)];
                    const front = door.axis === 0 ? [a0, along - DOOR_WIDTH / 2, a1, along + DOOR_WIDTH / 2] : [along - DOOR_WIDTH / 2, a0, along + DOOR_WIDTH / 2, a1];
                    for (const box of cell.solids) expect(overlap(box, front), `${where}: something in front`).toBe(false);
                }
            }
        }
        expect(doors).toBeGreaterThan(500);
    });

    it('keeps its furniture and its lamps inside their chunk, out of the corridors', () => {
        let lamps = 0;
        for (const { chunk } of chunks(4, 2)) {
            const x0 = chunk.cx * N - HALF_CHUNK;
            const z0 = chunk.cz * N - HALF_CHUNK;
            const inside = (x, z) => x > x0 - 0.5 && z > z0 - 0.5 && x < x0 + N - 0.5 && z < z0 + N - 0.5;
            for (const [minX, minZ, maxX, maxZ] of chunk.solids) {
                expect(inside(minX, minZ) && inside(maxX, maxZ), `${chunk.cx},${chunk.cz}`).toBe(true);
            }
            for (const piece of chunk.terrorHotel.furniture) {
                const kind = chunk.terrorHotel.kinds[(Math.round(piece.x) - x0) * N + Math.round(piece.z) - z0];
                expect(kind & CELL_CORRIDOR, `${piece.x},${piece.z}`).toBe(0);
            }
            for (const lamp of chunk.terrorHotel.lamps) {
                lamps++;
                expect(inside(lamp.x, lamp.z), `${lamp.x},${lamp.z}`).toBe(true);
            }
        }
        expect(lamps).toBeGreaterThan(10);
    });

    it('on a tape, leaves its notes (and what was left with them) clear of the furniture', () => {
        for (const seed of [3, 11, 13, 20]) {
            const store = new ChunkStore(seed, null, arenaOptions(seed, LEVEL));
            for (const note of placeNotes(store, seed)) {
                const chunk = store.getChunk(chunkCoord(note.cellX), chunkCoord(note.cellZ));
                const cell = [note.cellX - 0.5, note.cellZ - 0.5, note.cellX + 0.5, note.cellZ + 0.5];
                for (const box of chunk.solids) expect(overlap(box, cell), `seed ${seed}: ${note.cellX},${note.cellZ}`).toBe(false);
            }
        }
    });
});

describe('Level 5 sound', () => {
    it('is safe to use before there is any sound (there is no audio context until the first click)', () => {
        const audio = new TerrorHotelAudio(new Ambience());
        expect(() => {
            audio.setWorld(hotel(3));
            audio.setEnabled(true);
            audio.follow(0, 0, 1, 1, 0.5);
            audio.follow(1, -6, 1, 0, 0.5);
            for (let i = 0; i < 600; i++) audio.update(1 / 60);
            audio.step(1.2, 0, 0);
            audio.step(1.2, 1, -6);
            audio.setEnabled(false);
        }).not.toThrow();
        expect(audio.built).toBe(false);
    });
});
