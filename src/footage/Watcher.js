import { DIRECTIONS } from '../world/grid.js';

/*
 * The thing on the tape. Works like Slender Man in Slender: The Eight Pages.
 *
 * It never walks. Once woken it jumps somewhere else every few seconds while you're not looking, usually
 * closer, and more often and closer with each note, until it's right behind you. Seeing it raises `exposure`
 * (the mode turns that into static, failing lights and noise). So does being near it, whichever way you
 * face. Exposure reaching 1 or walking into it ends the tape. The player's way out is to keep moving, not
 * stare, and turn away and get clear when the static starts. After you see it and look away, it either
 * vanishes for a bit or jumps closer.
 *
 * Nobody should ever see it arrive, move or leave. "In sight" is the world's `inSight`, which means inside
 * the camera's widened view that also looks ahead of the turn (see screenGuard.js) and not fully hidden by
 * walls. So it can show up around the corner you're heading for or behind the wall you're facing. A new spot
 * has to stay out of sight for ARRIVAL seconds before it's there (until then it's nowhere), so turning toward
 * it cancels the jump. It also never leaves while any of it could be seen, even if it's too dark to make out.
 *
 * `aggression` (0..1) goes up with each note. `balance` is the per-level tuning (see WatcherBalance).
 *
 * Pure logic. The world is a few callbacks so tests can drive it.
 */

// Max distance it can be seen from (far plane).
const VIEW_RANGE = 11;
// Closer than this and it has you. Where exposure starts rising is per level (WatcherBalance.near).
const CAUGHT_DISTANCE = 0.65;
// Min light level for it to count as seen.
const SEEN_THRESHOLD = 0.12;
// Prefers spots at least this lit so it's possible to see it.
const WELL_LIT = 0.3;
// Seconds without seeing it before it decides what to do next.
const LOOKED_AWAY = 0.5;
// Seconds a new spot has to stay out of sight before it's there.
const ARRIVAL = 0.2;
// "Ahead" means in view (but hidden) or up to this far past the edge of the view (radians).
const EDGE_BAND = 0.5;
// Closest it jumps to. Any closer and the next jump would land on top of you.
const CLOSEST = 1.5;
// Pathfinding radius (cells each side of you), used to tell around-the-corner from sealed off.
const FIELD_RADIUS = 12;
// Fallback when the world has no inSight: view cone widened by this much (radians).
const SCREEN_MARGIN = 0.25;
// Seconds to look for a spot with a walkable path to you before settling for anywhere, and the retry interval.
const PATIENCE = 2;
const RETRY = 0.5;

const lerp = (a, b, t) => a + (b - a) * t;
const clampUnit = (v) => Math.max(-1, Math.min(1, v));
const FIELD_SIZE = FIELD_RADIUS * 2 + 1;

/**
 * @typedef {object} WatcherBalance Per-level tuning (a tape's `watcher`, see levels.js). Level 0 uses
 *     WATCHER_BALANCE. Other levels only change what their layout needs: more reach in open areas where it can't
 *     come around a corner at you, less in tight passages where it's often just behind a wall.
 * @property {number} pace Multiplier on the time between jumps, relative to Level 0.
 * @property {number} reach Multiplier on how far off it shows up when it starts over (woken or after vanishing).
 * @property {number} near Within this distance (through walls or not) exposure rises whichever way you face,
 *     faster the closer.
 */

/** @type {Readonly<WatcherBalance>} */
export const WATCHER_BALANCE = Object.freeze({ pace: 1, reach: 1, near: 3 });

/**
 * @typedef {object} WatcherWorld
 * @property {(ax: number, az: number, bx: number, bz: number) => boolean} los True if nothing blocks the line
 *     between two points at eye height.
 * @property {(x: number, z: number) => boolean} free True if it can stand in the cell.
 * @property {(x: number, z: number) => number} lit Light to see it against, 0..1.
 * @property {(x: number, z: number, dx: number, dz: number) => boolean} [open] True if you can walk from a
 *     cell to its neighbor. Defaults to the neighbor being free.
 * @property {(x: number, z: number) => boolean} [inSight] True if any of it at (x, z) is or could soon be on
 *     screen and not fully behind walls. Defaults to the widened view cone plus a clear line to its center.
 */

/**
 * @typedef {object} Viewer
 * @property {number} x
 * @property {number} z
 * @property {number} fx Facing direction (unit, horizontal).
 * @property {number} fz
 * @property {number} halfFov Half the horizontal FOV (radians).
 */

/**
 * appear: back, out of sight. seen: you just spotted it. stalk: jumped somewhere else unseen.
 * closer: you looked away and it's already closer. vanish: you looked away and it's gone for a bit.
 * @typedef {'appear' | 'seen' | 'stalk' | 'closer' | 'vanish'} WatcherEvent
 */

export class Watcher {
    /**
     * @param {WatcherWorld} world
     * @param {() => number} [random]
     */
    constructor(world, random = Math.random) {
        this.world = world;
        this.random = random;
        /** @type {Readonly<WatcherBalance>} Tuning for the current level. */
        this.balance = WATCHER_BALANCE;
        this._field = new Float32Array(FIELD_SIZE * FIELD_SIZE);
        this._queue = new Int32Array(FIELD_SIZE * FIELD_SIZE);
        /** @type {number[][]} Candidate spots for _appear by rank, as x, z pairs. */
        this._ranked = [[], [], [], [], []];
        /** @type {number[]} The ones of a rank out of sight. */
        this._clear = [];
        this.reset();
    }

    reset() {
        /** Does nothing until set. */
        this.active = false;
        /** 0 at the first note (rare, far off) up to 1 with all notes (every couple of seconds, close). */
        this.aggression = 0;
        /**
         * hidden: nowhere. arriving: headed to (x, z) but not there yet, so not drawn or seen. standing: there.
         * @type {'hidden' | 'arriving' | 'standing'}
         */
        this.state = 'hidden';
        this.x = 0;
        this.z = 0;
        /** How ruined the tape is, 0..1. At 1 it has you. */
        this.exposure = 0;
        /** Whether you can see it this frame, and how well (0..1). */
        this.seen = false;
        this.visibility = 0;
        this.distance = Infinity;
        /** Target distance for the next jump. Shrinks with each unseen jump. */
        this.reach = Infinity;
        this._timer = 0;
        this._seenFor = 0;
        this._unseenFor = 0;
        this._waited = 0;
        this._angle = 0;
        /** @type {WatcherEvent} Event to fire once it arrives. */
        this._arrival = 'appear';
        this._fieldX = NaN;
        this._fieldZ = NaN;
    }

    /** Wakes it up (first note, or you took too long). */
    activate() {
        if (this.active) return;
        this.active = true;
        this._timer = 4 + 4 * this.random();
        this.reach = this._startingReach();
    }

    /**
     * @param {number} dt
     * @param {Viewer} viewer Player position and facing this frame.
     * @param {(event: WatcherEvent) => void} [onEvent]
     * @returns {boolean} True on the frame it catches you.
     */
    update(dt, viewer, onEvent) {
        const a = this.aggression;
        const recovery = lerp(0.2, 0.1, a);
        if (!this.active || this.state !== 'standing') {
            this.seen = false;
            this.visibility = 0;
            this.distance = Infinity;
            this.exposure = Math.max(this.exposure - recovery * dt, 0);
            if (this.state === 'arriving') this._arrive(dt, viewer, onEvent);
            else if (this.active) {
                this._timer -= dt;
                if (this._timer <= 0) this._jump(viewer, 'appear');
            }
            return false;
        }

        this._look(viewer);
        const distance = this.distance;
        const near = this.balance.near;
        if (this.seen) {
            if (this._seenFor === 0) onEvent?.('seen');
            this._seenFor += dt;
            this._unseenFor = 0;
            // Rises faster when it's closer, nearer the center of the view, and better lit.
            const proximity = (1 - distance / VIEW_RANGE) ** 2;
            const centre = 1 - this._angle / viewer.halfFov;
            const rate = (0.12 + 0.6 * proximity) * (0.55 + 0.45 * centre) * (0.75 + 0.5 * a) * (0.5 + 0.5 * this.visibility);
            this.exposure += rate * dt;
        } else {
            this._unseenFor += dt;
            if (distance >= near) this.exposure = Math.max(this.exposure - recovery * dt, 0);
        }
        // Being near it raises exposure even when you're not looking at it.
        if (distance < near) this.exposure += (0.05 + 0.7 * (1 - distance / near) ** 2) * dt;
        if (distance < CAUGHT_DISTANCE || this.exposure >= 1) {
            this.exposure = 1;
            return true;
        }
        // Never move while any of it could be seen. Too dark to count, or just an arm past a door frame, is
        // still too close to being seen.
        if (this.seen || this._inSight(this.x, this.z, viewer)) return false;

        if (this._seenFor > 0) {
            if (this._unseenFor < LOOKED_AWAY) return false;
            // You looked away. Either vanish for a bit or jump closer.
            this._seenFor = 0;
            if (this.random() < lerp(0.6, 0.35, a)) {
                this._hide(lerp(4, 1.5, a));
                this.reach = this._startingReach();
                onEvent?.('vanish');
                return false;
            }
            this.reach = Math.max(CLOSEST, Math.min(this.reach, distance) * 0.6);
            this._jump(viewer, 'closer');
            return false;
        }

        this._timer -= dt;
        if (this._timer <= 0) {
            // Jump again, closer each time, down to CLOSEST.
            this.reach = Math.max(CLOSEST, this.reach * lerp(0.88, 0.76, a));
            if (!this._jump(viewer, 'stalk')) this._timer = RETRY;
        }
        return false;
    }

    /** Seconds until the next jump. */
    _interval() {
        return lerp(9, 3.5, this.aggression) * this.balance.pace * (0.75 + 0.5 * this.random());
    }

    /** Distance it starts at when woken or after vanishing. */
    _startingReach() {
        return lerp(9, 6, this.aggression) * this.balance.reach;
    }

    /** Updates distance, angle and visibility from the viewer. */
    _look(viewer) {
        const dx = this.x - viewer.x;
        const dz = this.z - viewer.z;
        const distance = Math.hypot(dx, dz);
        this.distance = distance;
        this._angle = distance > 0 ? Math.acos(clampUnit((dx * viewer.fx + dz * viewer.fz) / distance)) : 0;
        const inView = distance < VIEW_RANGE && this._angle < viewer.halfFov * 0.95;
        const clear = inView && this.world.los(viewer.x, viewer.z, this.x, this.z);
        this.visibility = clear ? this.world.lit(this.x, this.z) : 0;
        this.seen = this.visibility > SEEN_THRESHOLD;
    }

    /**
     * Jumps to a spot about `reach` from you, out of sight. If it was hidden and no spot fits, it stays
     * hidden and retries shortly.
     * @returns {boolean} Whether it's on its way.
     */
    _jump(viewer, arrival) {
        const reach = this.reach;
        const min = Math.max(CLOSEST, reach - 1);
        const max = reach + 1.2;
        if (this._appear(viewer, min, max, this._waited >= PATIENCE, arrival)) {
            this._waited = 0;
            return true;
        }
        this._waited += RETRY;
        if (this.state === 'standing') return false;
        this.state = 'hidden';
        this._timer = RETRY;
        return false;
    }

    /** Mid-jump. Arrives once the spot stays out of sight long enough, or cancels if you turn toward it first. */
    _arrive(dt, viewer, onEvent) {
        if (this._inSight(this.x, this.z, viewer)) {
            this.state = 'hidden';
            this._arrival = 'appear';
            this._timer = RETRY;
            return;
        }
        this._timer -= dt;
        if (this._timer > 0) return;
        this.state = 'standing';
        this._timer = this._interval();
        this._seenFor = 0;
        this._unseenFor = 0;
        onEvent?.(this._arrival);
    }

    /**
     * Picks a spot `min` to `max` from you, out of sight, with a walking path not much longer than the straight
     * line. That keeps it around a corner instead of sealed off behind a wall. Prefers lit spots. Some jumps favor
     * spots ahead of you (the next corner, behind the wall you face, just off screen), the rest behind you.
     * @param {Viewer} viewer
     * @param {number} min
     * @param {number} max
     * @param {boolean} anywhere Accept spots without a good path to you.
     * @param {WatcherEvent} arrival Event to fire once it's there.
     * @returns {boolean} Whether a spot was found.
     */
    _appear(viewer, min, max, anywhere, arrival) {
        this._updateField(viewer);
        const viewerCellX = Math.round(viewer.x);
        const viewerCellZ = Math.round(viewer.z);
        const reach = Math.ceil(max);
        const ahead = this.random() < lerp(0.35, 0.55, this.aggression);
        // Candidate buckets, best first.
        const ranked = this._ranked;
        for (const list of ranked) list.length = 0;
        for (let x = viewerCellX - reach; x <= viewerCellX + reach; x++) {
            for (let z = viewerCellZ - reach; z <= viewerCellZ + reach; z++) {
                if (x === viewerCellX && z === viewerCellZ) continue;
                const d = Math.hypot(x - viewer.x, z - viewer.z);
                if (d < min || d > max || !this.world.free(x, z)) continue;
                let rank;
                if (this._pathLength(x, z) <= d * 1.6 + 1) {
                    const facing = Math.acos(clampUnit(((x - viewer.x) * viewer.fx + (z - viewer.z) * viewer.fz) / d));
                    const wanted = (facing < viewer.halfFov + EDGE_BAND) === ahead;
                    rank = (wanted ? 0 : 2) + (this.world.lit(x, z) >= WELL_LIT ? 0 : 1);
                } else if (anywhere) {
                    rank = 4;
                } else {
                    continue;
                }
                ranked[rank].push(x, z);
            }
        }
        // A spot at random from the best bucket with any out of sight. That check is by far the slowest (up to 30
        // rays a spot), so it's only done for the buckets up to that one. Checking every spot first took up to a
        // couple of thousand rays a jump.
        const clear = this._clear;
        for (const list of ranked) {
            clear.length = 0;
            for (let k = 0; k < list.length; k += 2) {
                if (!this._inSight(list[k], list[k + 1], viewer)) clear.push(list[k], list[k + 1]);
            }
            if (clear.length === 0) continue;
            const pick = Math.floor(this.random() * (clear.length / 2)) * 2;
            this.x = clear[pick];
            this.z = clear[pick + 1];
            this.state = 'arriving';
            this._arrival = arrival;
            this._timer = ARRIVAL;
            this.seen = false;
            this.visibility = 0;
            this.distance = Infinity;
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ pathfinding

    /** BFS walking distance (steps) from each nearby cell to you. Infinity where unreachable. */
    _updateField(viewer) {
        const cx = Math.round(viewer.x);
        const cz = Math.round(viewer.z);
        if (cx === this._fieldX && cz === this._fieldZ) return;
        this._fieldX = cx;
        this._fieldZ = cz;
        const field = this._field;
        const queue = this._queue;
        field.fill(Infinity);
        const index = (x, z) => (x - cx + FIELD_RADIUS) * FIELD_SIZE + (z - cz + FIELD_RADIUS);
        field[index(cx, cz)] = 0;
        queue[0] = index(cx, cz);
        let head = 0;
        let tail = 1;
        while (head < tail) {
            const i = queue[head++];
            const x = Math.floor(i / FIELD_SIZE) - FIELD_RADIUS + cx;
            const z = (i % FIELD_SIZE) - FIELD_RADIUS + cz;
            for (const [dx, dz] of DIRECTIONS) {
                const nx = x + dx;
                const nz = z + dz;
                if (Math.abs(nx - cx) > FIELD_RADIUS || Math.abs(nz - cz) > FIELD_RADIUS) continue;
                const j = index(nx, nz);
                if (field[j] !== Infinity || !this._open(x, z, dx, dz)) continue;
                field[j] = field[i] + 1;
                queue[tail++] = j;
            }
        }
    }

    /** Walking steps from (x, z) to you. Infinity outside the field. */
    _pathLength(x, z) {
        const i = Math.round(x) - this._fieldX + FIELD_RADIUS;
        const j = Math.round(z) - this._fieldZ + FIELD_RADIUS;
        if (i < 0 || j < 0 || i >= FIELD_SIZE || j >= FIELD_SIZE) return Infinity;
        return this._field[i * FIELD_SIZE + j];
    }

    _open(x, z, dx, dz) {
        return this.world.open ? this.world.open(x, z, dx, dz) : this.world.free(x + dx, z + dz);
    }

    // ------------------------------------------------------------------ visibility

    /** True if any of it at (x, z) is or could soon be seen. */
    _inSight(x, z, viewer) {
        if (this.world.inSight) return this.world.inSight(x, z);
        return this._onScreen(x, z, viewer) && this.world.los(viewer.x, viewer.z, x, z);
    }

    /** Widened view cone check, for worlds without inSight. */
    _onScreen(x, z, viewer) {
        const dx = x - viewer.x;
        const dz = z - viewer.z;
        const d = Math.hypot(dx, dz);
        if (d > VIEW_RANGE + 0.5) return false;
        if (d < 1e-6) return true;
        const facing = Math.acos(clampUnit((dx * viewer.fx + dz * viewer.fz) / d));
        // Add its own width as an angle.
        return facing < viewer.halfFov + SCREEN_MARGIN + Math.atan(0.2 / d);
    }

    /** Hides it for `seconds`. */
    _hide(seconds) {
        this.state = 'hidden';
        this.seen = false;
        this.visibility = 0;
        this._seenFor = 0;
        this._arrival = 'appear';
        this._timer = seconds;
    }
}
