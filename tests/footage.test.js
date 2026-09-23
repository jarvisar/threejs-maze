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

    /** Standing at (x, z), with a visit that has a long way to run. */
    function standingAt(w, x, z, aggression = 0.5) {
        w.activate();
        w.aggression = aggression;
        w.state = 'standing';
        w.x = x;
        w.z = z;
        w._timer = 100;
        return w;
    }

    /** Always facing away from wherever it is (or is going), so it's never seen. */
    const lookingAway = (w, x = 0, z = 0) => {
        if (w.state === 'hidden') return looking(x, z, 0, -1);
        const d = Math.hypot(w.x - x, w.z - z) || 1;
        return looking(x, z, -(w.x - x) / d, -(w.z - z) / d);
    };

    it('does nothing until activated', () => {
        const w = new Watcher(openWorld(), mulberry32(1));
        for (let t = 0; t < 120; t += 1 / 60) expect(w.update(1 / 60, looking(0, 0, 0, -1))).toBe(false);
        expect(w.state).toBe('hidden');
        expect(w.exposure).toBe(0);
    });

    it('turns up out of sight, about as far off as it means to be, with a way round to you', () => {
        for (let seed = 0; seed < 20; seed++) {
            for (const aggression of [0, 0.5, 1]) {
                const w = new Watcher(openWorld(), mulberry32(seed));
                w.activate();
                w.aggression = aggression;
                const viewer = looking(0, 0, 0, -1);
                expect(untilItAppears(w, viewer)).toEqual(['appear']);
                const { d } = whereFrom(w, viewer);
                expect(w._inSight(w.x, w.z, viewer)).toBe(false);
                expect(d).toBeGreaterThanOrEqual(w.reach - 1);
                expect(d).toBeLessThanOrEqual(w.reach + 1.2);
                expect(w._pathLength(w.x, w.z)).toBeLessThanOrEqual(d * 1.6 + 1);
            }
        }
    });

    it('can turn up behind a wall you are facing', () => {
        // A wall across the room two cells ahead, with a doorway through it at x = 4.
        const beyond = (z) => z < -2;
        const world = {
            ...openWorld((ax, az, bx, bz) => beyond(az) === beyond(bz)),
            open: (x, z, dx, dz) => Math.abs(x + dx) < 40 && Math.abs(z + dz) < 40 && (beyond(z) === beyond(z + dz) || x === 4),
        };
        let inFront = 0;
        for (let seed = 0; seed < 30; seed++) {
            const w = new Watcher(world, mulberry32(seed));
            w.activate();
            const viewer = looking(0, 0, 0, -1);
            expect(untilItAppears(w, viewer)).toEqual(['appear']);
            expect(w._inSight(w.x, w.z, viewer)).toBe(false);
            if (whereFrom(w, viewer).angle < viewer.halfFov) {
                expect(beyond(w.z)).toBe(true);
                inFront++;
            }
        }
        expect(inFront).toBeGreaterThan(3);
    });

    it('never turns up anywhere it could be seen: with nowhere out of sight, it waits', () => {
        const w = new Watcher({ ...openWorld(), inSight: () => true }, mulberry32(9));
        w.activate();
        w.aggression = 1;
        expect(untilItAppears(w, looking(0, 0, 0, -1), 60)).toEqual([]);
        expect(w.state).toBe('hidden');
    });

    it('calls off an arrival if you come round to it first', () => {
        const w = new Watcher(openWorld(), mulberry32(3));
        w.activate();
        w.aggression = 0.5;
        const viewer = looking(0, 0, 0, -1);
        for (let t = 0; t < 20 && w.state !== 'arriving'; t += 1 / 60) w.update(1 / 60, viewer);
        expect(w.state).toBe('arriving');
        const d = Math.hypot(w.x, w.z);
        const events = [];
        w.update(1 / 60, looking(0, 0, w.x / d, w.z / d), (e) => events.push(e));
        expect(w.state).toBe('hidden');
        expect(events).toEqual([]);
    });

    it('closes in, jump by jump, while nobody looks, and has you if you stand there', () => {
        for (let seed = 0; seed < 8; seed++) {
            const w = new Watcher(openWorld(), mulberry32(seed));
            w.activate();
            w.aggression = 0.3;
            const reaches = [];
            let caught = false;
            for (let t = 0; t < 120 && !caught; t += 1 / 60) {
                caught = w.update(1 / 60, lookingAway(w), (e) => {
                    if (e === 'stalk') reaches.push(Math.hypot(w.x, w.z));
                });
            }
            expect(caught, `seed ${seed}`).toBe(true);
            expect(reaches.length).toBeGreaterThan(3);
            expect(reaches.at(-1)).toBeLessThan(reaches[0]);
        }
    });

    it('stays put while any of it could be seen, even where it is too dark to make out', () => {
        const w = standingAt(new Watcher({ ...openWorld(), lit: () => 0 }, mulberry32(5)), 0, -6);
        w._timer = 0;
        for (let t = 0; t < 5; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, -1));
        expect(w.seen).toBe(false);
        expect([w.state, w.x, w.z]).toEqual(['standing', 0, -6]);
        // Look away, and it's somewhere else.
        for (let t = 0; t < 1; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, 1));
        expect(w.x === 0 && w.z === -6).toBe(false);
    });

    it('ruins the tape just by being near, whichever way you face', () => {
        const near = standingAt(new Watcher(openWorld(), mulberry32(6)), 0, 2);
        const far = standingAt(new Watcher(openWorld(), mulberry32(6)), 0, 6);
        for (const w of [near, far]) {
            w.exposure = 0.3;
            for (let t = 0; t < 1; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, -1));
        }
        expect(near.exposure).toBeGreaterThan(0.4);
        expect(far.exposure).toBeLessThan(0.3);
    });

    it('never arrives, moves or goes where it could be seen, however the camera turns', () => {
        for (let seed = 0; seed < 12; seed++) {
            const random = mulberry32(1000 + seed);
            // Dark in places, and walls in places, so it's often in the picture without being seen.
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
                // before, was out of sight in this frame.
                if (was.state === 'standing' && (now.state !== 'standing' || moved)) {
                    expect(w._inSight(was.x, was.z, viewer), `seed ${seed} at ${t.toFixed(2)}: left in sight`).toBe(false);
                    checked++;
                }
                if (now.state === 'standing' && (was.state !== 'standing' || moved)) {
                    expect(w._inSight(now.x, now.z, viewer), `seed ${seed} at ${t.toFixed(2)}: arrived in sight`).toBe(false);
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

    it('lets the tape go while you look at it, and has you if you keep looking', () => {
        const w = standingAt(new Watcher(openWorld(), mulberry32(2)), 0, -4);
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

    it('never moves while you can see it, even when it is time to', () => {
        // Far off and only just made out, so looking at it for a while is survivable.
        const w = standingAt(new Watcher({ ...openWorld(), lit: () => 0.14 }, mulberry32(8)), 0, -10, 0.3);
        w._timer = 0.1;
        const events = [];
        for (let t = 0; t < 8; t += 1 / 60) expect(w.update(1 / 60, looking(0, 0, 0, -1), (e) => events.push(e))).toBe(false);
        expect(events).toEqual(['seen']);
        expect([w.state, w.x, w.z]).toEqual(['standing', 0, -10]);
    });

    it('lets the tape recover when you look away; then it is gone for a moment, or nearer', () => {
        const outcomes = new Set();
        for (let seed = 0; seed < 30; seed++) {
            const w = standingAt(new Watcher(openWorld(), mulberry32(seed)), 0, -7, 0.6);
            w.reach = 7;
            for (let t = 0; t < 1; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, -1));
            const exposed = w.exposure;
            expect(exposed).toBeGreaterThan(0.05);
            const events = [];
            for (let t = 0; t < 1; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, 1), (e) => events.push(e));
            expect(w.exposure).toBeLessThan(exposed);
            if (events.includes('vanish')) {
                expect(w.state).toBe('hidden');
                outcomes.add('gone');
            } else {
                expect(events).toEqual(['closer']);
                expect(Math.hypot(w.x, w.z)).toBeLessThan(7);
                outcomes.add('nearer');
            }
        }
        expect([...outcomes].sort()).toEqual(['gone', 'nearer']);
    });

    it('has you when it is right on top of you, whichever way you face', () => {
        const w = standingAt(new Watcher(openWorld(), mulberry32(3)), 0.4, 0);
        expect(w.update(1 / 60, looking(0, 0, 0, 1))).toBe(true);
    });

    it('cannot be seen through a wall', () => {
        const w = standingAt(new Watcher(openWorld(() => false), mulberry32(4)), 0, -3);
        w.activate();
        for (let t = 0; t < 1; t += 1 / 60) w.update(1 / 60, looking(0, 0, 0, -1));
        expect(w.seen).toBe(false);
    });

    it('is kept off better by moving on than by standing still', () => {
        const survived = (moving) => {
            let seconds = 0;
            for (let seed = 0; seed < 6; seed++) {
                const w = new Watcher(openWorld(), mulberry32(seed));
                w.activate();
                w.aggression = 0.5;
                let t = 0;
                for (; t < 120; t += 1 / 60) {
                    // Up and down the room at a walk, looking where you're going and never back.
                    const along = (1.2 * t) % 60;
                    const out = along < 30;
                    const x = moving ? (out ? -15 + along : 45 - along) : 0;
                    if (w.update(1 / 60, looking(x, 0, out || !moving ? 1 : -1, 0))) break;
                }
                seconds += t;
            }
            return seconds;
        };
        expect(survived(true)).toBeGreaterThan(survived(false) * 1.5);
    });

    it('jumps more often, and nearer, the more aggressive it is', () => {
        const jumps = (aggression) => {
            let count = 0;
            let near = 0;
            for (let seed = 0; seed < 6; seed++) {
                const w = new Watcher(openWorld(), mulberry32(seed));
                w.activate();
                w.aggression = aggression;
                for (let t = 0; t < 30; t += 1 / 30) {
                    w.update(1 / 30, lookingAway(w), (e) => {
                        if (e === 'stalk') {
                            count++;
                            near += Math.hypot(w.x, w.z);
                        }
                    });
                    w.exposure = 0;
                }
            }
            return { count, mean: near / count };
        };
        const calm = jumps(0);
        const wild = jumps(1);
        expect(wild.count).toBeGreaterThan(calm.count * 1.8);
        expect(wild.mean).toBeLessThan(calm.mean);
    });
});

describe('formatTime', () => {
    it('reads like a clock', () => {
        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(67.9)).toBe('1:07');
        expect(formatTime(3725)).toBe('1:02:05');
    });
});
