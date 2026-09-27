import { describe, expect, it } from 'vitest';
import { Ambience } from '../src/audio/Ambience.js';
import { TerrorHotelAudio } from '../src/audio/TerrorHotel.js';
import { CHUNK_SIZE, DOOR_WIDTH, HALF_CHUNK, WALL_HEIGHT, WALL_THICKNESS } from '../src/config.js';
import { ARENA, arenaOptions, placeNotes } from '../src/footage/arena.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { ColorBuilder } from '../src/world/ColorBuilder.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import { PROP_PALM } from '../src/world/decorations.js';
import { EDGE_NONE, EDGE_WALL, chunkCoord, edgeBoxes, pillarBox } from '../src/world/grid.js';
import { LEVELS, LEVELS_IN_ORDER, TAPE_LEVELS, levelById } from '../src/world/levels.js';
import { PALM_BACK, PALM_WALL, propBounds, propFootprint, templateFor } from '../src/world/props.js';
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
import { buildFurniture } from '../src/world/terrorHotelFurnishings.js';
import { FURN_DESK, FURN_RUG, WALL_CLEAR, furnitureHalf } from '../src/world/terrorHotelFurniture.js';
import { buildTerrorHotelOutside } from '../src/world/terrorHotelGeometry.js';
import { ZONE_BALLROOM, ZONE_GUEST, ZONE_LOBBY, ZONE_STAFF } from '../src/world/zones.js';
import { misfacing } from './meshes.js';

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

/** Whether two boxes overlap by more than a hair, or a point is inside a box by more than a hair. */
function meet(a, b) {
    return a[0] < b[2] - 1e-6 && b[0] < a[2] - 1e-6 && a[1] < b[3] - 1e-6 && b[1] < a[3] - 1e-6;
}
function within(box, x, z) {
    return x > box[0] + 1e-6 && x < box[2] - 1e-6 && z > box[1] + 1e-6 && z < box[3] - 1e-6;
}

/**
 * Round a chunk: its walls (and the posts where they meet), each as far out as the mouldings on them could reach
 * (WALL_CLEAR), and its columns as they're drawn (their capitals are the widest of them).
 */
function wallsRound(store, chunk) {
    const x0 = chunk.cx * N - HALF_CHUNK;
    const z0 = chunk.cz * N - HALF_CHUNK;
    const walls = [];
    const columns = [];
    for (let x = x0 - 1; x <= x0 + N; x++) {
        for (let z = z0 - 1; z <= z0 + N; z++) {
            for (const axis of [0, 1]) edgeBoxes(x, z, axis, store.edge(x, z, axis), walls);
            if (store.pillar(x, z)) columns.push(pillarBox(x, z, 0.18));
        }
    }
    return { walls: walls.map(([a, b, c, d]) => [a - WALL_CLEAR, b - WALL_CLEAR, c + WALL_CLEAR, d + WALL_CLEAR]), columns };
}

/** What a piece of furniture takes up (see furnitureHalf), as [minX, minZ, maxX, maxZ]. */
function footprint(piece) {
    const [a, d] = furnitureHalf(piece);
    const [hx, hz] = piece.dx !== 0 ? [d, a] : [a, d];
    return [piece.x - hx, piece.z - hz, piece.x + hx, piece.z + hz];
}

/** Every corner of what's drawn of a piece of furniture, [x, y, z] each. */
function drawn(chunk, piece) {
    const ctx = {
        ox: chunk.cx * N,
        oz: chunk.cz * N,
        data: { furniture: [piece] },
        woodwork: new ColorBuilder('finish'),
        fittings: new ColorBuilder('light'),
        glows: new ColorBuilder('glow'),
        paint: new ColorBuilder(),
        dials: new ColorBuilder(),
    };
    buildFurniture(ctx);
    const corners = [];
    for (const b of [ctx.woodwork, ctx.fittings, ctx.paint, ctx.dials]) {
        for (let i = 0; i < b.vertexCount; i++) corners.push([b.positions[i * 3] + ctx.ox, b.positions[i * 3 + 1], b.positions[i * 3 + 2] + ctx.oz]);
    }
    return corners;
}

/**
 * How many edges of the triangles of some meshes (where their positions put them) only one triangle has, inside a
 * rectangle [minX, minZ, maxX, maxZ], leaving out those along a wall's face, the floor or the ceiling (where a moulding
 * is open against what it's on).
 */
function openEdges(meshes, [minX, minZ, maxX, maxZ]) {
    // (Snapped to a grid that no corner, a whole number of hundred-thousandths, sits halfway between two points of.)
    const snap = (value) => Math.round(value * 1e4 + 0.123);
    const counts = new Map();
    const ends = new Map();
    for (const { geometry, x, z } of meshes) {
        const p = geometry.attributes.position.array;
        const index = geometry.index.array;
        const corner = (i) => [p[i * 3] + x, p[i * 3 + 1], p[i * 3 + 2] + z];
        for (let t = 0; t < index.length; t += 3) {
            for (let k = 0; k < 3; k++) {
                const a = corner(index[t + k]);
                const b = corner(index[t + ((k + 1) % 3)]);
                const [ka, kb] = [a.map(snap).join(), b.map(snap).join()];
                const key = ka < kb ? `${ka} ${kb}` : `${kb} ${ka}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
                ends.set(key, [a, b]);
            }
        }
    }
    const onFace = (value) => Math.abs(Math.abs(value - (Math.round(value - 0.5) + 0.5)) - WALL_THICKNESS / 2) < 2e-4;
    let open = 0;
    for (const [key, count] of counts) {
        if (count !== 1) continue;
        const [a, b] = ends.get(key);
        const middle = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
        if (!(middle[0] > minX && middle[0] < maxX && middle[1] > minZ && middle[1] < maxZ)) continue;
        if ((a[1] < 1e-4 && b[1] < 1e-4) || (a[1] > WALL_HEIGHT - 1e-4 && b[1] > WALL_HEIGHT - 1e-4)) continue;
        if ((onFace(a[0]) && Math.abs(a[0] - b[0]) < 1e-4) || (onFace(a[2]) && Math.abs(a[2] - b[2]) < 1e-4)) continue;
        open++;
    }
    return open;
}

describe('Level 5', () => {
    it('is one of the levels, listed by its number, with its own sound; a tape goes down into it from Level 4', () => {
        expect(LEVEL).toBeGreaterThan(0);
        const level = levelById(LEVEL);
        expect(level.number).toBe(5);
        expect(level.options(1).level).toBe(LEVEL);
        expect(typeof level.sound).toBe('function');
        expect(LEVELS_IN_ORDER.map(({ name }) => name)).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 4', 'Level 5', 'Level 37']);
        expect(TAPE_LEVELS.indexOf(LEVEL)).toBe(TAPE_LEVELS.indexOf(LEVELS.findIndex((l) => l.number === 4)) + 1);
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

    it('keeps all of what\'s drawn of its furniture inside what it takes up, and that clear of the mouldings round the walls, the columns and each other', () => {
        let pieces = 0;
        for (const { seed, store, chunk } of chunks(3, 1)) {
            const { walls, columns } = wallsRound(store, chunk);
            const taken = chunk.terrorHotel.furniture.filter((piece) => piece.type !== FURN_RUG).map(footprint);
            for (const piece of chunk.terrorHotel.furniture) {
                pieces++;
                const where = `seed ${seed}: ${piece.type} at ${piece.x.toFixed(2)},${piece.z.toFixed(2)}`;
                const box = footprint(piece);
                // (The reception's key rack is on the wall behind it, over the skirting.)
                const rack = piece.type === FURN_DESK ? 0.3 - furnitureHalf(piece)[1] : 0;
                const reach = [box[0] + Math.min(0, -piece.dx) * rack, box[1] + Math.min(0, -piece.dz) * rack, box[2] + Math.max(0, -piece.dx) * rack, box[3] + Math.max(0, -piece.dz) * rack];
                const outside = drawn(chunk, piece).find(([x, , z]) => x < reach[0] - 1e-6 || x > reach[2] + 1e-6 || z < reach[1] - 1e-6 || z > reach[3] + 1e-6);
                expect(outside, `${where}: drawn outside it`).toBe(undefined);
                expect(walls.some((wall) => meet(wall, box)), `${where}: by a wall`).toBe(false);
                expect(columns.some((column) => meet(column, box)), `${where}: in a column`).toBe(false);
                if (piece.type !== FURN_RUG) expect(taken.filter((other) => meet(other, box)).length, `${where}: in another`).toBe(1);
            }
        }
        expect(pieces).toBeGreaterThan(300);
    });

    it('keeps its props clear of the mouldings round the walls, the columns, the furniture and each other; a palm against a wall, its fronds off it', () => {
        for (let shape = 0; shape < 16; shape++) expect(propBounds({ type: PROP_PALM, variant: shape | PALM_WALL })[2]).toBeGreaterThanOrEqual(-PALM_BACK);
        let palms = 0;
        const arena = new ChunkStore(3, null, arenaOptions(3, LEVEL));
        placeNotes(arena, 3);
        const tape = [];
        for (let cx = ARENA.cx0; cx <= ARENA.cx1; cx++) for (let cz = ARENA.cz0; cz <= ARENA.cz1; cz++) tape.push({ seed: 'tape 3', store: arena, chunk: arena.getChunk(cx, cz) });
        for (const { seed, store, chunk } of [...chunks(3, 1), ...tape]) {
            const { walls, columns } = wallsRound(store, chunk);
            const taken = chunk.terrorHotel.furniture.filter((piece) => piece.type !== FURN_RUG).map(footprint);
            const props = chunk.props.map(propFootprint);
            chunk.props.forEach((prop, k) => {
                if (prop.type === PROP_PALM) palms++;
                const where = `${seed}: prop ${prop.type} at ${prop.x.toFixed(2)},${prop.z.toFixed(2)}`;
                const p = templateFor(prop).attributes.position.array;
                const [cos, sin] = [Math.cos(prop.yaw), Math.sin(prop.yaw)];
                let wrong = null;
                for (let i = 0; i < p.length && !wrong; i += 3) {
                    const x = cos * p[i] + sin * p[i + 2] + prop.x;
                    const z = cos * p[i + 2] - sin * p[i] + prop.z;
                    if ([...walls, ...columns].some((box) => within(box, x, z))) wrong = `${x.toFixed(3)},${z.toFixed(3)}`;
                }
                expect(wrong, `${where}: by a wall or in a column`).toBe(null);
                expect(taken.some((box) => meet(box, props[k])), `${where}: in the furniture`).toBe(false);
                expect(props.filter((box) => meet(box, props[k])).length, `${where}: in another`).toBe(1);
            });
        }
        expect(palms).toBeGreaterThan(20);
    });

    it('finishes its mouldings wherever they end: round corners, at doorways, where the room changes, and on a tape against the walls round it', () => {
        // (Just the mouldings, as a chunk outside a tape's walls builds them, round every wall of each chunk.)
        const mouldings = (store, cx0, cz0, cx1, cz1) => {
            const meshes = [];
            for (let cx = cx0; cx <= cx1; cx++) {
                for (let cz = cz0; cz <= cz1; cz++) {
                    const { woodwork } = buildTerrorHotelOutside(store, store.getChunk(cx, cz));
                    if (woodwork) meshes.push({ geometry: woodwork, x: cx * N, z: cz * N });
                }
            }
            return meshes;
        };
        const inside = (cx0, cz0, cx1, cz1) => [cx0 * N - HALF_CHUNK - 0.5, cz0 * N - HALF_CHUNK - 0.5, (cx1 + 1) * N - HALF_CHUNK - 0.5, (cz1 + 1) * N - HALF_CHUNK - 0.5];
        for (const seed of [3, 11]) {
            const meshes = mouldings(hotel(seed), -2, -2, 1, 1);
            expect(openEdges(meshes, inside(-1, -1, 0, 0)), `seed ${seed}`).toBe(0);
            // Nothing along the foot of a wall, or its chair rail, stands out further than what stands against it keeps off it.
            const off = (value) => Math.abs(value - (Math.round(value - 0.5) + 0.5)) - WALL_THICKNESS / 2;
            let furthest = 0;
            for (const { geometry, x: ox, z: oz } of meshes) {
                const p = geometry.attributes.position.array;
                for (let i = 0; i < p.length; i += 3) if (p[i + 1] < 0.8) furthest = Math.max(furthest, Math.min(off(p[i] + ox), off(p[i + 2] + oz)));
            }
            expect(furthest, `seed ${seed}`).toBeLessThanOrEqual(WALL_CLEAR + 1e-6);
        }
        const store = new ChunkStore(3, null, arenaOptions(3, LEVEL));
        placeNotes(store, 3);
        expect(openEdges(mouldings(store, ARENA.cx0 - 2, ARENA.cz0 - 2, ARENA.cx1 + 1, ARENA.cz1 + 1), inside(ARENA.cx0 - 1, ARENA.cz0 - 1, ARENA.cx1, ARENA.cz1)), 'on a tape').toBe(0);
        for (let cx = -1; cx <= 0; cx++) {
            for (let cz = -1; cz <= 0; cz++) expect(misfacing(buildChunkGeometry(hotel(11), cx, cz).extras.woodwork), `${cx},${cz}`).toBe(0);
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
