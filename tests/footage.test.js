import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from '../src/config.js';
import { ARENA, CELLS, NOTE_COUNT, arenaOptions, inArena, openExit, placeNotes } from '../src/footage/arena.js';
import { formatTime } from '../src/footage/records.js';
import { Watcher } from '../src/footage/Watcher.js';
import { moveAndCollide } from '../src/player/collision.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { PROP_BOTTLES, PROP_CHAIR, PROP_MONITOR } from '../src/world/decorations.js';
import { generateChunk } from '../src/world/generator.js';
import { EDGE_NONE, EDGE_WALL } from '../src/world/grid.js';
import { mulberry32 } from '../src/world/random.js';
import { ZONE_HALLS, ZONE_MAZE, ZONE_OPEN, ZONE_PILLARS, ZONE_ROOMS } from '../src/world/zones.js';

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Every cell reachable from (x, z) without crossing a wall, as "x,z" strings. */
function reachable(store, fromX, fromZ, limit = Infinity) {
    const seen = new Set([`${fromX},${fromZ}`]);
    const stack = [[fromX, fromZ]];
    while (stack.length && seen.size < limit) {
        const [x, z] = stack.pop();
        for (const [dx, dz] of DIRECTIONS) {
            const nx = x + dx;
            const nz = z + dz;
            if (seen.has(`${nx},${nz}`) || store.edgeBetween(x, z, dx, dz) === EDGE_WALL) continue;
            seen.add(`${nx},${nz}`);
            stack.push([nx, nz]);
        }
    }
    return seen;
}

function arenaStore(seed) {
    return new ChunkStore(seed, null, arenaOptions(seed));
}

describe('the arena', () => {
    it('is walled in: nothing reachable from spawn lies outside it, and all of it is reachable', () => {
        for (const seed of [1, 2, 3, 77, 1234]) {
            const store = arenaStore(seed);
            const seen = reachable(store, 0, 0);
            const cells = (CELLS.x1 - CELLS.x0 + 1) * (CELLS.z1 - CELLS.z0 + 1);
            expect(seen.size, `seed ${seed}`).toBe(cells);
            for (const key of seen) {
                const [x, z] = key.split(',').map(Number);
                expect(inArena(x, z), `seed ${seed}: ${key} is outside`).toBe(true);
            }
        }
    });

    it('has every kind of zone inside, offices at spawn, and nothing outside', () => {
        const options = arenaOptions(5);
        const kinds = new Set();
        for (let cx = ARENA.cx0; cx <= ARENA.cx1; cx++) {
            for (let cz = ARENA.cz0; cz <= ARENA.cz1; cz++) kinds.add(options.zoneAt(cx, cz).type);
        }
        expect([...kinds].sort()).toEqual([ZONE_ROOMS, ZONE_HALLS, ZONE_MAZE, ZONE_PILLARS, ZONE_OPEN].sort());
        expect(options.zoneAt(0, 0).type).toBe(ZONE_ROOMS);
        expect(options.isVoid(ARENA.cx1 + 1, 0)).toBe(true);
        expect(options.isVoid(0, 0)).toBe(false);
        // An empty chunk: no walls inside, no lights, no props.
        const outside = generateChunk(5, ARENA.cx1 + 2, 0, options);
        expect(outside.edgesX.every((type) => type === EDGE_NONE)).toBe(true);
        expect(outside.props).toEqual([]);
        expect(outside.leaks).toEqual([]);
        for (let k = 0; k < outside.lights.length; k += 4) {
            expect(outside.lights[k]).toBe(0);
            expect(outside.lights[k + 1]).toBe(0);
        }
    });

    it('is the same arena for the same seed, and a different one for another', () => {
        const a = arenaStore(9).getChunk(-1, 1);
        const b = arenaStore(9).getChunk(-1, 1);
        const c = arenaStore(10).getChunk(-1, 1);
        expect(Array.from(a.edgesX)).toEqual(Array.from(b.edgesX));
        expect(Array.from(a.edgesX)).not.toEqual(Array.from(c.edgesX));
    });
});

describe('the notes', () => {
    it('hang on walls, one per chunk, spread out, reachable, out of the spawn room, and not twice', () => {
        for (const seed of [1, 4, 9, 16, 25, 36]) {
            const store = arenaStore(seed);
            const notes = placeNotes(store, seed);
            expect(notes.length).toBe(NOTE_COUNT);
            const seen = reachable(store, 0, 0);
            const chunks = new Set();
            for (const note of notes) {
                expect(seen.has(`${note.cellX},${note.cellZ}`), `seed ${seed}: note ${note.index} unreachable`).toBe(true);
                expect(Math.abs(note.cellX) > 3 || note.cellZ < -3 || note.cellZ > 2).toBe(true);
                // On the wall of its cell, facing into it.
                expect(store.edgeBetween(note.cellX, note.cellZ, -note.nx, -note.nz)).toBe(EDGE_WALL);
                expect(Math.abs(note.x - note.cellX) + Math.abs(note.z - note.cellZ)).toBeLessThan(0.6);
                chunks.add(`${Math.floor((note.cellX + 8) / 16)},${Math.floor((note.cellZ + 8) / 16)}`);
            }
            expect(chunks.size).toBe(NOTE_COUNT);
            // No two in neighbouring chunks (a checkerboard).
            const keys = [...chunks].map((key) => key.split(',').map(Number));
            for (const [ax, az] of keys) {
                for (const [bx, bz] of keys) expect(Math.abs(ax - bx) + Math.abs(az - bz)).not.toBe(1);
            }
        }
    });

    it('leave something behind at each note, against the same wall, without blocking it', () => {
        const store = arenaStore(3);
        const notes = placeNotes(store, 3);
        const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors);
        for (const note of notes) {
            const chunk = store.getChunk(Math.floor((note.cellX + 8) / 16), Math.floor((note.cellZ + 8) / 16));
            const here = chunk.props.filter((p) => Math.round(p.x) === note.cellX && Math.round(p.z) === note.cellZ);
            expect(here.map((p) => p.type).sort()).toEqual([PROP_BOTTLES, ...[PROP_CHAIR, PROP_MONITOR].filter((t) => here.some((p) => p.type === t))].sort());
            expect(here.length).toBe(2);
            // Walk up to the note from the middle of its cell: nothing in the way.
            const from = { x: note.cellX, z: note.cellZ };
            moveAndCollide(from, note.nx * -0.3, note.nz * -0.3, PLAYER_RADIUS, boxesNear);
            expect(Math.hypot(from.x - note.x, from.z - note.z)).toBeLessThan(0.62);
        }
    });
});

describe('the way out', () => {
    it('opens a two-cell gap in the wall on the far side, leading out of the arena', () => {
        for (const seed of [2, 8, 21]) {
            const store = arenaStore(seed);
            placeNotes(store, seed);
            const before = reachable(store, 0, 0).size;
            const exit = openExit(store, 0, 0);
            expect(Math.hypot(exit.x, exit.z)).toBeGreaterThan(30);
            expect(exit.cells.length).toBe(2);
            for (const [x, z] of exit.cells) {
                expect(inArena(x, z)).toBe(true);
                expect(inArena(x + exit.dx, z + exit.dz)).toBe(false);
                expect(store.edgeBetween(x, z, exit.dx, exit.dz)).toBe(EDGE_NONE);
            }
            // Now you can get out: the flood fill leaves the arena.
            const after = reachable(store, 0, 0, before + 40);
            expect(after.size).toBeGreaterThan(before);
            expect([...after].some((key) => !inArena(...key.split(',').map(Number)))).toBe(true);
        }
    });
});

describe('Watcher', () => {
    /** A world with nothing in the way, lit everywhere. */
    function openWorld(los = () => true) {
        return { los, free: (x, z) => Math.abs(x) < 40 && Math.abs(z) < 40, lit: () => 1 };
    }

    const looking = (x, z, fx, fz) => ({ x, z, fx, fz, halfFov: 0.8 });

    it('does nothing until activated', () => {
        const w = new Watcher(openWorld(), mulberry32(1));
        for (let t = 0; t < 120; t += 1 / 60) expect(w.update(1 / 60, looking(0, 0, 0, -1))).toBe(false);
        expect(w.state).toBe('hidden');
        expect(w.exposure).toBe(0);
    });

    it('appears out of view (or far off), never close in front of you', () => {
        for (let seed = 0; seed < 20; seed++) {
            const w = new Watcher(openWorld(), mulberry32(seed));
            w.activate();
            w.aggression = 0.3;
            const viewer = looking(0, 0, 0, -1);
            const events = [];
            for (let t = 0; t < 40 && events.length === 0; t += 1 / 60) w.update(1 / 60, viewer, (e) => events.push(e));
            expect(events).toEqual(['appear']);
            const d = Math.hypot(w.x, w.z);
            const angle = Math.acos((w.x * 0 + w.z * -1) / d);
            expect(d).toBeGreaterThan(3);
            expect(angle > viewer.halfFov + 0.15 || d >= 5.5).toBe(true);
        }
    });

    it('lets the tape go while you look at it, and has you if you keep looking', () => {
        const w = new Watcher(openWorld(), mulberry32(2));
        w.activate();
        w.aggression = 0.5;
        w.state = 'standing';
        w.x = 0;
        w.z = -4;
        w._timer = 100;
        const viewer = looking(0, 0, 0, -1);
        let caught = false;
        let seconds = 0;
        while (!caught && seconds < 30) {
            caught = w.update(1 / 60, viewer);
            seconds += 1 / 60;
            if (seconds > 0.5 && !caught) expect(w.seen).toBe(true);
        }
        expect(caught).toBe(true);
        expect(seconds).toBeGreaterThan(1.5);
        expect(seconds).toBeLessThan(8);
    });

    it('lets the tape recover when you look away, and then moves: gone, or closer', () => {
        for (let seed = 0; seed < 12; seed++) {
            const w = new Watcher(openWorld(), mulberry32(seed));
            w.activate();
            w.aggression = 0.6;
            w.state = 'standing';
            w.x = 0;
            w.z = -6;
            w._timer = 100;
            for (let t = 0; t < 1; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, -1));
            const exposed = w.exposure;
            expect(exposed).toBeGreaterThan(0.05);
            const events = [];
            for (let t = 0; t < 1.5; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, 1), (e) => events.push(e));
            expect(w.exposure).toBeLessThan(exposed);
            expect(events.length).toBe(1);
            if (events[0] === 'closer') {
                expect(w.state).toBe('standing');
                expect(Math.hypot(w.x, w.z)).toBeLessThan(6);
            } else {
                expect(events[0]).toBe('vanish');
                expect(w.state).toBe('hidden');
            }
        }
    });

    it('has you when it is right on top of you, whichever way you face', () => {
        const w = new Watcher(openWorld(), mulberry32(3));
        w.activate();
        w.state = 'standing';
        w.x = 0.4;
        w.z = 0;
        expect(w.update(1 / 60, looking(0, 0, 0, 1))).toBe(true);
    });

    it('cannot be seen through a wall', () => {
        const w = new Watcher(openWorld(() => false), mulberry32(4));
        w.activate();
        w.state = 'standing';
        w.x = 0;
        w.z = -3;
        w._timer = 100;
        for (let t = 0; t < 5; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, -1));
        expect(w.seen).toBe(false);
        expect(w.exposure).toBe(0);
    });

    it('comes more often the more aggressive it is', () => {
        const visits = (aggression) => {
            let count = 0;
            for (let seed = 0; seed < 6; seed++) {
                const w = new Watcher(openWorld(), mulberry32(seed));
                w.activate();
                w.aggression = aggression;
                // Always looking away from wherever it is, so it's never seen and keeps relocating.
                for (let t = 0; t < 180; t += 1 / 30) {
                    const away = w.state === 'standing' ? looking(0, 0, -Math.sign(w.x) || 1, 0) : looking(0, 0, 0, -1);
                    w.update(1 / 30, away, (e) => {
                        if (e === 'appear') count++;
                    });
                }
            }
            return count;
        };
        expect(visits(1)).toBeGreaterThan(visits(0) * 1.8);
    });
});

describe('formatTime', () => {
    it('reads like a clock', () => {
        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(67.9)).toBe('1:07');
        expect(formatTime(3725)).toBe('1:02:05');
    });
});
