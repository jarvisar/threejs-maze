/*
 * The thing on the tape. It works the way Slender Man does in Slender: The Eight Pages.
 *
 * It never walks. Once it's woken it's always somewhere near you, and every few seconds, while you're not
 * looking, it's somewhere else: nearer, more often than not, and more often and nearer with every note. If
 * nothing stops it, each jump lands closer, until it's right behind you. Seeing it is what ruins the tape
 * (the "exposure" here, which the mode turns into static, failing lights and noise), and so is being near
 * it, whichever way you're facing. Let the tape go and it's over; walk into it and it's over. So: keep
 * moving, don't stare, and when the static starts, turn away and get away from it.
 *
 * When you do see it and look away, it's either gone for a moment or already nearer.
 *
 * Nobody ever sees it arrive, move or go. "In sight" is the world's `inSight`: in the game, somewhere the
 * camera's view (made wider, and looking ahead of the way it's turning; see screenGuard.js) takes in and
 * walls don't completely hide. So it can turn up round the corner you're heading for, or behind the wall
 * you're facing, as well as just out of shot or behind you. A new spot also has to stay out of sight for a
 * moment before it's actually there (until then it's nowhere), so a turn towards it calls the jump off
 * rather than catching it arriving. And it only leaves a spot that's out of sight: nothing moves it while
 * any of it could be seen, even where it's too dark to make out.
 *
 * `aggression` (0..1) is how many notes you have: the mode raises it with every one.
 *
 * Pure logic: the world is a few callbacks, so this can be run through in tests.
 */

// How far away it can be seen at all (the far plane).
const VIEW_RANGE = 11;
// Nearer than this, the tape starts to go whichever way you're facing, faster the nearer; nearer than
// CAUGHT_DISTANCE, it has you.
const NEAR = 3;
const CAUGHT_DISTANCE = 0.65;
// Being seen counts once there's this much light to make it out against.
const SEEN_THRESHOLD = 0.12;
// It would rather turn up somewhere with this much light, so that seeing it is possible.
const WELL_LIT = 0.3;
// Seconds without seeing it before it decides what to do next.
const LOOKED_AWAY = 0.5;
// Seconds a new spot has to stay out of sight before it's there.
const ARRIVAL = 0.2;
// Ahead of you: in the picture (but hidden), or no more than this far (radians) past its edge.
const EDGE_BAND = 0.5;
// The nearest it jumps to; any nearer and the next jump would be on top of you.
const CLOSEST = 1.5;
// How far round the level it knows the way (cells either side of you), for telling round-the-corner
// from sealed off.
const FIELD_RADIUS = 12;
// Without the world saying where the picture is, it's the view cone widened by this much (radians).
const SCREEN_MARGIN = 0.25;
// Seconds it keeps looking for a spot with a clear way to you before it settles for anywhere, and how
// often it looks.
const PATIENCE = 2;
const RETRY = 0.5;

const lerp = (a, b, t) => a + (b - a) * t;
const clampUnit = (v) => Math.max(-1, Math.min(1, v));
const FIELD_SIZE = FIELD_RADIUS * 2 + 1;
const DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/**
 * @typedef {object} WatcherWorld
 * @property {(ax: number, az: number, bx: number, bz: number) => boolean} los Whether nothing stands between
 *     two points at eye height.
 * @property {(x: number, z: number) => boolean} free Whether it can stand in a cell.
 * @property {(x: number, z: number) => number} lit How much light there is to see it against, 0..1.
 * @property {(x: number, z: number, dx: number, dz: number) => boolean} [open] Whether you can walk from a
 *     cell to the next one along. Without it, any free cell is open.
 * @property {(x: number, z: number) => boolean} [inSight] Whether any of it, standing at (x, z), is or
 *     could in a moment be seen: in the picture and not completely behind walls. Without it, the viewer's
 *     cone (widened) and a clear line to its middle.
 */

/**
 * @typedef {object} Viewer
 * @property {number} x
 * @property {number} z
 * @property {number} fx Which way you're looking (unit, horizontal).
 * @property {number} fz
 * @property {number} halfFov Half the horizontal field of view, in radians.
 */

/**
 * appear: it's back, out of sight. seen: you've just caught sight of it. stalk: it's jumped, unseen, to
 * somewhere else. closer: you looked away and it's already nearer. vanish: you looked away and it's gone,
 * for a moment.
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
        this._field = new Float32Array(FIELD_SIZE * FIELD_SIZE);
        this._queue = new Int32Array(FIELD_SIZE * FIELD_SIZE);
        this.reset();
    }

    reset() {
        /** It does nothing until this is set. */
        this.active = false;
        /** 0 (the first note: rarely, and far off) to 1 (all of them: every couple of seconds, and close). */
        this.aggression = 0;
        /**
         * hidden: nowhere. arriving: on its way to (x, z), and not there yet (not drawn, not seen). standing:
         * there.
         * @type {'hidden' | 'arriving' | 'standing'}
         */
        this.state = 'hidden';
        this.x = 0;
        this.z = 0;
        /** How far gone the tape is, 0..1. At 1 it has you. */
        this.exposure = 0;
        /** Whether you can see it right now, and how well (0..1). */
        this.seen = false;
        this.visibility = 0;
        this.distance = Infinity;
        /** How far it means to jump to next, closing in with every jump nobody sees. */
        this.reach = Infinity;
        this._timer = 0;
        this._seenFor = 0;
        this._unseenFor = 0;
        this._waited = 0;
        this._angle = 0;
        /** @type {WatcherEvent} What its arrival will be, once it's there. */
        this._arrival = 'appear';
        this._fieldX = NaN;
        this._fieldZ = NaN;
    }

    /** Starts it coming (the first note, or you took too long about it). */
    activate() {
        if (this.active) return;
        this.active = true;
        this._timer = 4 + 4 * this.random();
        this.reach = this._startingReach();
    }

    /**
     * @param {number} dt
     * @param {Viewer} viewer Where you are and which way you're looking this frame.
     * @param {(event: WatcherEvent) => void} [onEvent]
     * @returns {boolean} true the moment it has you.
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
        if (this.seen) {
            if (this._seenFor === 0) onEvent?.('seen');
            this._seenFor += dt;
            this._unseenFor = 0;
            // Faster the closer it is, the nearer the middle of the picture, and the plainer it can be seen.
            const proximity = (1 - distance / VIEW_RANGE) ** 2;
            const centre = 1 - this._angle / viewer.halfFov;
            const rate = (0.12 + 0.6 * proximity) * (0.55 + 0.45 * centre) * (0.75 + 0.5 * a) * (0.5 + 0.5 * this.visibility);
            this.exposure += rate * dt;
        } else {
            this._unseenFor += dt;
            if (distance >= NEAR) this.exposure = Math.max(this.exposure - recovery * dt, 0);
        }
        // Near it, the tape goes whichever way you're facing.
        if (distance < NEAR) this.exposure += (0.05 + 0.7 * (1 - distance / NEAR) ** 2) * dt;
        if (distance < CAUGHT_DISTANCE || this.exposure >= 1) {
            this.exposure = 1;
            return true;
        }
        // Nothing moves it while any of it could be seen: not seen as such (too dark, say, or only an arm
        // past a door frame) is still too close to being seen.
        if (this.seen || this._inSight(this.x, this.z, viewer)) return false;

        if (this._seenFor > 0) {
            if (this._unseenFor < LOOKED_AWAY) return false;
            // You looked away: gone for a moment, or already nearer.
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
            // Time to be somewhere else, and nearer (nearer again than last time, until it's right there).
            this.reach = Math.max(CLOSEST, this.reach * lerp(0.88, 0.76, a));
            if (!this._jump(viewer, 'stalk')) this._timer = RETRY;
        }
        return false;
    }

    /** Seconds between its jumps. */
    _interval() {
        return lerp(9, 3.5, this.aggression) * (0.75 + 0.5 * this.random());
    }

    /** How far off it starts, on waking, or once it's shaken off. */
    _startingReach() {
        return lerp(9, 6, this.aggression);
    }

    /** Where it is from the viewer, and whether they can see it. */
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
     * Jumps to somewhere about `reach` from you, out of sight. If it was nowhere and there's nowhere just
     * now, it stays nowhere and tries again in a moment.
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

    /**
     * On its way to a spot: there once the spot has stayed out of sight for long enough, or back to nowhere
     * if you come round to it first.
     */
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
     * Picks somewhere to go, `min` to `max` from you, out of sight, with a way through to you that isn't
     * much longer than the straight line (so it's round a corner, not sealed off behind a wall), better lit
     * if it can. Some jumps it would rather be ahead of you (round the corner you're heading for, behind the
     * wall you're facing, just past the edge of the picture), the rest behind you.
     * @param {Viewer} viewer
     * @param {number} min
     * @param {number} max
     * @param {boolean} anywhere Settle for somewhere without a good way through to you.
     * @param {WatcherEvent} arrival What its arrival there will be.
     * @returns {boolean} Whether a spot was found (it's on its way).
     */
    _appear(viewer, min, max, anywhere, arrival) {
        this._updateField(viewer);
        const viewerCellX = Math.round(viewer.x);
        const viewerCellZ = Math.round(viewer.z);
        const reach = Math.ceil(max);
        const ahead = this.random() < lerp(0.35, 0.55, this.aggression);
        /** @type {{ x: number, z: number }[][]} Candidates, best first. */
        const ranked = [[], [], [], [], []];
        for (let x = viewerCellX - reach; x <= viewerCellX + reach; x++) {
            for (let z = viewerCellZ - reach; z <= viewerCellZ + reach; z++) {
                if (x === viewerCellX && z === viewerCellZ) continue;
                const d = Math.hypot(x - viewer.x, z - viewer.z);
                if (d < min || d > max || !this.world.free(x, z) || this._inSight(x, z, viewer)) continue;
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
                ranked[rank].push({ x, z });
            }
        }
        const candidates = ranked.find((list) => list.length > 0);
        if (!candidates) return false;
        const spot = candidates[Math.floor(this.random() * candidates.length)];
        this.x = spot.x;
        this.z = spot.z;
        this.state = 'arriving';
        this._arrival = arrival;
        this._timer = ARRIVAL;
        this.seen = false;
        this.visibility = 0;
        this.distance = Infinity;
        return true;
    }

    // ------------------------------------------------------------------ the way round

    /** Steps from each cell around you to you, walking the level (Infinity where there's no way). */
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

    /** Steps from the cell at (x, z) to you. */
    _pathLength(x, z) {
        const i = Math.round(x) - this._fieldX + FIELD_RADIUS;
        const j = Math.round(z) - this._fieldZ + FIELD_RADIUS;
        if (i < 0 || j < 0 || i >= FIELD_SIZE || j >= FIELD_SIZE) return Infinity;
        return this._field[i * FIELD_SIZE + j];
    }

    _open(x, z, dx, dz) {
        return this.world.open ? this.world.open(x, z, dx, dz) : this.world.free(x + dx, z + dz);
    }

    // ------------------------------------------------------------------ being seen

    /** Whether any of it, standing at (x, z), is or could in a moment be seen. */
    _inSight(x, z, viewer) {
        if (this.world.inSight) return this.world.inSight(x, z);
        return this._onScreen(x, z, viewer) && this.world.los(viewer.x, viewer.z, x, z);
    }

    /** The viewer's cone, widened (for worlds that don't say where the picture is). */
    _onScreen(x, z, viewer) {
        const dx = x - viewer.x;
        const dz = z - viewer.z;
        const d = Math.hypot(dx, dz);
        if (d > VIEW_RANGE + 0.5) return false;
        if (d < 1e-6) return true;
        const facing = Math.acos(clampUnit((dx * viewer.fx + dz * viewer.fz) / d));
        // Its own width, as an angle, counts too.
        return facing < viewer.halfFov + SCREEN_MARGIN + Math.atan(0.2 / d);
    }

    /** Gone, for `seconds`. */
    _hide(seconds) {
        this.state = 'hidden';
        this.seen = false;
        this.visibility = 0;
        this._seenFor = 0;
        this._arrival = 'appear';
        this._timer = seconds;
    }
}
