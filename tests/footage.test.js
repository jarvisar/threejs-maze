import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from '../src/config.js';
import { ARENA, CELLS, NOTE_COUNT, arenaOptions, inArena, openExit, placeNotes } from '../src/footage/arena.js';
import { formatTime } from '../src/footage/records.js';
import { Watcher } from '../src/footage/Watcher.js';
import { moveAndCollide } from '../src/player/collision.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { PROP_BOTTLES, PROP_MONITOR } from '../src/world/decorations.js';
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

    it('leave a TV and some bottles at each note, against the same wall, without blocking it', () => {
        const store = arenaStore(3);
        const notes = placeNotes(store, 3);
        const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors);
        for (const note of notes) {
            const chunk = store.getChunk(Math.floor((note.cellX + 8) / 16), Math.floor((note.cellZ + 8) / 16));
            const here = chunk.props.filter((p) => Math.round(p.x) === note.cellX && Math.round(p.z) === note.cellZ);
            expect(here.map((p) => p.type).sort()).toEqual([PROP_MONITOR, PROP_BOTTLES].sort());
            // The TV the note knows about is that monitor, turned to face into the room.
            const monitor = here.find((p) => p.type === PROP_MONITOR);
            expect([monitor.x, monitor.z, monitor.yaw]).toEqual([note.tv.x, note.tv.z, note.tv.yaw]);
            expect(Math.cos(note.tv.yaw - Math.atan2(note.nx, note.nz))).toBeGreaterThan(0.95);
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
            // One gap, not two: nothing between its two cells.
            const [[ax, az], [bx, bz]] = exit.cells;
            expect(store.edgeBetween(ax, az, bx - ax, bz - az)).toBe(EDGE_NONE);
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

    /** Runs it until its next visit (or `seconds`), and returns the events on the way. */
    function untilItAppears(w, viewer, seconds = 40) {
        const events = [];
        for (let t = 0; t < seconds && !events.includes('appear'); t += 1 / 60) w.update(1 / 60, viewer, (e) => events.push(e));
        return events;
    }

    /** Where it is from the viewer: how far, and how far off the middle of the picture. */
    function whereFrom(w, viewer) {
        const d = Math.hypot(w.x - viewer.x, w.z - viewer.z);
        return { d, angle: Math.acos(((w.x - viewer.x) * viewer.fx + (w.z - viewer.z) * viewer.fz) / d) };
    }

    it('turns up just out of shot, with a clear line to you, so a small turn finds it', () => {
        for (let seed = 0; seed < 20; seed++) {
            for (const aggression of [0, 0.3, 1]) {
                const world = openWorld();
                const w = new Watcher(world, mulberry32(seed));
                w.activate();
                w.aggression = aggression;
                const viewer = looking(0, 0, 0, -1);
                expect(untilItAppears(w, viewer)).toEqual(['appear']);
                const { d, angle } = whereFrom(w, viewer);
                expect(w._onScreen(w.x, w.z, viewer)).toBe(false);
                expect(angle).toBeGreaterThan(viewer.halfFov);
                expect(angle).toBeLessThan(viewer.halfFov + 0.5);
                expect(d).toBeGreaterThan(3);
                expect(world.los(0, 0, w.x, w.z)).toBe(true);
            }
        }
    });

    it('only stands where it could be seen: a clear line to you', () => {
        // Corridors along the axes through (0, 0): it can only be seen from along one of them.
        const corridors = (ax, az, bx, bz) => Math.abs(ax - bx) < 1e-9 || Math.abs(az - bz) < 1e-9;
        for (let seed = 0; seed < 20; seed++) {
            const world = openWorld(corridors);
            const w = new Watcher(world, mulberry32(seed));
            w.activate();
            w.aggression = 0.4;
            const viewer = looking(0, 0, 0, -1);
            expect(untilItAppears(w, viewer)).toEqual(['appear']);
            expect(world.los(0, 0, w.x, w.z), `seed ${seed}: (${w.x}, ${w.z})`).toBe(true);
            // Behind or beside you, down a corridor, so that turning round finds it.
            expect(whereFrom(w, viewer).angle).toBeGreaterThan(viewer.halfFov);
        }
    });

    it('settles for round a corner if there is nowhere in sight to stand', () => {
        const w = new Watcher(openWorld(() => false), mulberry32(6));
        w.activate();
        w.aggression = 0.5;
        const events = untilItAppears(w, looking(0, 0, 0, -1), 20);
        expect(events).toEqual(['appear']);
        expect(w.state).toBe('standing');
    });

    it('never turns up anywhere in the picture: with nowhere out of it, it waits', () => {
        const w = new Watcher({ ...openWorld(), onScreen: () => true }, mulberry32(9));
        w.activate();
        w.aggression = 1;
        expect(untilItAppears(w, looking(0, 0, 0, -1), 60)).toEqual([]);
        expect(w.state).toBe('hidden');
    });

    it('calls off an arrival if the picture comes round to it first', () => {
        const w = new Watcher(openWorld(), mulberry32(3));
        w.activate();
        w.aggression = 0.5;
        const viewer = looking(0, 0, 0, -1);
        for (let t = 0; t < 20 && w.state !== 'arriving'; t += 1 / 60) w.update(1 / 60, viewer);
        expect(w.state).toBe('arriving');
        // Turn straight to where it was going to be.
        const d = Math.hypot(w.x, w.z);
        const events = [];
        w.update(1 / 60, looking(0, 0, w.x / d, w.z / d), (e) => events.push(e));
        expect(w.state).toBe('hidden');
        expect(events).toEqual([]);
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

    it('never moves while you can see it', () => {
        // Far off and only just made out, so looking at it for a while is survivable.
        const w = new Watcher({ ...openWorld(), lit: () => 0.14 }, mulberry32(8));
        w.activate();
        w.aggression = 0.3;
        w.state = 'standing';
        w.x = 0;
        w.z = -10;
        w._timer = 0.1;
        const events = [];
        for (let t = 0; t < 8; t += 1 / 60) expect(w.update(1 / 60, looking(0, 0, 0, -1), (e) => events.push(e))).toBe(false);
        expect(events).toEqual(['seen']);
        expect([w.state, w.x, w.z]).toEqual(['standing', 0, -10]);
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

    it('stays put while it is in the picture, even where it is too dark to make out, and goes once it is not', () => {
        for (const world of [{ ...openWorld(), lit: () => 0 }, openWorld(() => false)]) {
            const w = new Watcher(world, mulberry32(5));
            w.activate();
            w.aggression = 0.5;
            w.state = 'standing';
            w.x = 0;
            w.z = -4;
            w._timer = 0;
            for (let t = 0; t < 10; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, -1));
            expect([w.state, w.x, w.z]).toEqual(['standing', 0, -4]);
            // Looking away, it's gone (or on its way nearer) straight off.
            w.update(1 / 60, looking(0, 0, 0, 1));
            expect(w.state === 'standing' && w.x === 0 && w.z === -4).toBe(false);
        }
    });

    it('never arrives, moves or goes in the picture, however the camera turns', () => {
        for (let seed = 0; seed < 12; seed++) {
            const random = mulberry32(1000 + seed);
            // Dark in places, and walls in places, so there are times it's in the picture without being seen.
            const world = {
                los: (ax, az, bx, bz) => Math.abs(Math.round(bx) + Math.round(bz)) % 3 !== 0,
                free: (x, z) => Math.abs(x) < 40 && Math.abs(z) < 40,
                lit: (x, z) => (Math.abs(x * 7 + z * 13) % 5 === 0 ? 0 : 1),
            };
            const w = new Watcher(world, mulberry32(seed));
            w.activate();
            w.aggression = 0.8;
            let yaw = 0;
            let rate = 0;
            let x = 0;
            let z = 0;
            let was = { state: w.state, x: w.x, z: w.z };
            let checked = 0;
            for (let t = 0; t < 150; t += 1 / 60) {
                // Turning at all sorts of speeds, changing its mind often, now and then snapping round, and
                // wandering about.
                if (random() < 0.05) rate = (random() - 0.5) * 16;
                if (random() < 0.01) yaw += (random() - 0.5) * Math.PI;
                yaw += rate / 60;
                x += (random() - 0.5) * 0.05;
                z += (random() - 0.5) * 0.05;
                const viewer = looking(x, z, -Math.sin(yaw), -Math.cos(yaw));
                const caught = w.update(1 / 60, viewer);
                const now = { state: w.state, x: w.x, z: w.z };
                const moved = now.x !== was.x || now.z !== was.z;
                // Wherever it stood before this frame and has left, and wherever it stands now having not
                // before, was out of this frame's picture.
                if (was.state === 'standing' && (now.state !== 'standing' || moved)) {
                    expect(w._onScreen(was.x, was.z, viewer), `seed ${seed} at ${t.toFixed(2)}: left in the picture`).toBe(false);
                    checked++;
                }
                if (now.state === 'standing' && (was.state !== 'standing' || moved)) {
                    expect(w._onScreen(now.x, now.z, viewer), `seed ${seed} at ${t.toFixed(2)}: arrived in the picture`).toBe(false);
                    checked++;
                }
                was = now;
                if (caught) {
                    w.reset();
                    w.activate();
                    w.aggression = 0.8;
                    was = { state: w.state, x: w.x, z: w.z };
                }
            }
            expect(checked, `seed ${seed}`).toBeGreaterThan(10);
        }
    });

    /** Always facing away from wherever it is (or is going), so it's never seen. */
    const lookingAway = (w) => (w.state !== 'hidden' ? looking(0, 0, -Math.sign(w.x) || 1, 0) : looking(0, 0, 0, -1));

    it('comes nearer, a step at a time, while nobody looks', () => {
        for (let seed = 0; seed < 10; seed++) {
            const w = new Watcher(openWorld(), mulberry32(seed));
            w.activate();
            w._introduced = true;
            w.aggression = 0.6;
            let last = Infinity;
            let steps = 0;
            for (let t = 0; t < 120 && steps < 2; t += 1 / 30) {
                w.update(1 / 30, lookingAway(w), (e) => {
                    const d = Math.hypot(w.x, w.z);
                    if (e === 'appear') last = d;
                    if (e === 'stalk') {
                        expect(d).toBeLessThan(last);
                        last = d;
                        steps++;
                    }
                });
            }
            expect(steps, `seed ${seed}`).toBe(2);
        }
    });

    it('has you in the end if you stand there and never look', () => {
        for (let seed = 0; seed < 8; seed++) {
            const w = new Watcher(openWorld(), mulberry32(seed));
            w.activate();
            w.aggression = 0.5;
            let caught = false;
            for (let t = 0; t < 240 && !caught; t += 1 / 30) caught = w.update(1 / 30, lookingAway(w));
            expect(caught, `seed ${seed}`).toBe(true);
        }
    });

    it('comes more often the more aggressive it is', () => {
        const visits = (aggression) => {
            let count = 0;
            for (let seed = 0; seed < 6; seed++) {
                const w = new Watcher(openWorld(), mulberry32(seed));
                w.activate();
                w.aggression = aggression;
                // Never seen: every visit, and every step nearer, counts. (Moved back each time, so it never
                // gets close enough to end it.)
                for (let t = 0; t < 180; t += 1 / 30) {
                    w.update(1 / 30, lookingAway(w), (e) => {
                        if (e === 'appear' || e === 'stalk') {
                            count++;
                            const d = Math.hypot(w.x, w.z);
                            w.x *= 6 / d;
                            w.z *= 6 / d;
                        }
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
