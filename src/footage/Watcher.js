/*
 * The thing on the tape.
 *
 * It never walks, and nobody ever sees it arrive, move or go: all of that happens out of the picture. It
 * turns up just out of shot, somewhere with a clear line to you, so a turn of the head finds it (or walking
 * on brings it into view), and when you see it the tape starts to go (the "exposure" here, which the mode
 * turns into static, failing lights and noise). Look away and the exposure fades; look back and it's gone,
 * or closer. Stare, or let it get close, and the tape ends.
 *
 * "Out of the picture" is the world's `onScreen`, which in the game is the camera's view made wider and
 * looking ahead of the way it's turning (see screenGuard.js). Nothing is decided on a stale view: every
 * check is against the camera as it is this frame, before the frame is drawn. A new spot also has to stay
 * out of the picture for a moment before it's actually there (until then it's nowhere), so a sweep of the
 * camera towards it calls the visit off rather than catching it arriving. And it only leaves a spot when
 * that spot is out of the picture too, even if it's too dark to make out there, or behind a wall.
 *
 * Leave it standing unseen and it doesn't wait for ever: it comes a step nearer, and another, closing in
 * from behind, until it's close enough that the tape goes whichever way you face. Standing still is how it
 * gets you; moving on, with a look back now and then, is how you stay ahead of it.
 *
 * How often it comes, how close, and how quickly it closes in is set by `aggression` (0..1), which the mode
 * raises with every note.
 *
 * Pure logic: the world is a few callbacks, so this can be run through in tests.
 */

// How far away it can be seen at all (the far plane).
const VIEW_RANGE = 11;
// Closer than this and the tape goes whether you're looking or not; closer still, it has you.
const TOO_CLOSE = 1.5;
const CAUGHT_DISTANCE = 0.65;
// Being seen counts once there's this much light to make it out against.
const SEEN_THRESHOLD = 0.12;
// It would rather stand somewhere with this much light, so that turning round shows it.
const WELL_LIT = 0.3;
// Seconds without seeing it before it decides what to do next.
const LOOKED_AWAY = 0.5;
// Seconds a new spot has to stay out of the picture before it's there.
const ARRIVAL = 0.2;
// Just out of shot: no more than this far (radians) past the edge of the picture, so a small turn finds it.
const EDGE_BAND = 0.5;
// Nearer than this, it would rather be behind you: at least this far (radians) off where you're facing.
const CLOSE_BEHIND = 3;
const BEHIND = 1.9;
// Without the world saying where the picture is, it's the view cone widened by this much (radians).
const SCREEN_MARGIN = 0.25;
// Seconds it keeps looking for a spot with a clear line to you before it settles for one round a corner,
// and how often it looks.
const PATIENCE = 3;
const RETRY = 0.75;

const lerp = (a, b, t) => a + (b - a) * t;
const clampUnit = (v) => Math.max(-1, Math.min(1, v));

/**
 * @typedef {object} WatcherWorld
 * @property {(ax: number, az: number, bx: number, bz: number) => boolean} los Whether nothing stands between
 *     two points at eye height.
 * @property {(x: number, z: number) => boolean} free Whether it can stand in a cell.
 * @property {(x: number, z: number) => number} lit How much light there is to see it against, 0..1.
 * @property {(x: number, z: number) => boolean} [onScreen] Whether any of it, standing at (x, z), is or
 *     could in a moment be in the picture, whatever is in the way. Without it, the viewer's cone is used.
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
 * appear: it's there, out of shot. seen: you've just caught sight of it. closer: you looked away and it's
 * nearer. stalk: nobody looked, and it's nearer. vanish: you looked away and it's gone.
 * @typedef {'appear' | 'seen' | 'closer' | 'stalk' | 'vanish'} WatcherEvent
 */

export class Watcher {
    /**
     * @param {WatcherWorld} world
     * @param {() => number} [random]
     */
    constructor(world, random = Math.random) {
        this.world = world;
        this.random = random;
        this.reset();
    }

    reset() {
        /** It does nothing until this is set. */
        this.active = false;
        /** 0 (a rare glimpse, far off) to 1 (never far, never gone for long). */
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
        this._timer = 0;
        this._seenFor = 0;
        this._unseenFor = 0;
        this._waited = 0;
        /** @type {WatcherEvent} What its arrival will be, once it's there. */
        this._arrival = 'appear';
    }

    /** Starts it coming (the first note, or you took too long about it). */
    activate() {
        if (this.active) return;
        this.active = true;
        this._timer = 4 + 4 * this.random();
    }

    /**
     * @param {number} dt
     * @param {Viewer} viewer Where you are and which way you're looking this frame.
     * @param {(event: WatcherEvent) => void} [onEvent]
     * @returns {boolean} true the moment it has you.
     */
    update(dt, viewer, onEvent) {
        const a = this.aggression;
        const recovery = lerp(0.22, 0.12, a);
        if (!this.active || this.state !== 'standing') {
            this.seen = false;
            this.visibility = 0;
            this.distance = Infinity;
            this.exposure = Math.max(this.exposure - recovery * dt, 0);
            if (this.state === 'arriving') this._arrive(dt, viewer, onEvent);
            else if (this.active) {
                this._timer -= dt;
                if (this._timer <= 0) this._visit(viewer);
            }
            return false;
        }

        const dx = this.x - viewer.x;
        const dz = this.z - viewer.z;
        const distance = Math.hypot(dx, dz);
        this.distance = distance;
        const angle = distance > 0 ? Math.acos(clampUnit((dx * viewer.fx + dz * viewer.fz) / distance)) : 0;
        const inView = distance < VIEW_RANGE && angle < viewer.halfFov * 0.95;
        const clear = inView && this.world.los(viewer.x, viewer.z, this.x, this.z);
        this.visibility = clear ? this.world.lit(this.x, this.z) : 0;
        const seen = this.visibility > SEEN_THRESHOLD;
        this.seen = seen;

        if (seen) {
            if (this._seenFor === 0) onEvent?.('seen');
            this._seenFor += dt;
            this._unseenFor = 0;
            // Faster the closer it is, the nearer the middle of the picture, and the plainer it can be seen.
            const proximity = (1 - distance / VIEW_RANGE) ** 2;
            const centre = 1 - angle / viewer.halfFov;
            const rate = (0.12 + 0.6 * proximity) * (0.55 + 0.45 * centre) * (0.75 + 0.5 * a) * (0.5 + 0.5 * this.visibility);
            this.exposure += rate * dt;
        } else {
            this._unseenFor += dt;
            this.exposure = Math.max(this.exposure - recovery * dt, 0);
        }
        // Too close to matter which way you're facing.
        if (distance < TOO_CLOSE) this.exposure += (0.5 + 0.8 * (1 - distance / TOO_CLOSE)) * dt;

        if (distance < CAUGHT_DISTANCE || this.exposure >= 1) {
            this.exposure = 1;
            return true;
        }
        if (seen) return false;

        if (this._seenFor === 0) this._timer -= dt;
        const deciding = this._seenFor > 0 ? this._unseenFor >= LOOKED_AWAY : this._timer <= 0;
        // Nothing moves it while it's in the picture, even where it's too dark to make out, or behind a
        // wall: it waits (and decides) once it isn't.
        if (!deciding || this._onScreen(this.x, this.z, viewer)) return false;

        if (this._seenFor > 0) {
            // You looked away. Usually it's simply gone; more and more often, it's nearer when you look back.
            this._seenFor = 0;
            if (distance > 2.2 && this.random() < lerp(0.3, 0.75, a)
                && this._appear(viewer, Math.max(1.8, distance * 0.45), Math.max(2.6, distance * 0.7), false, true, 'closer')) return false;
            this._hide();
            onEvent?.('vanish');
        } else if ((distance < CLOSE_BEHIND || this.random() < lerp(0.45, 0.9, a))
            && this._appear(viewer, Math.max(1, distance * 0.5), Math.max(1.6, distance * 0.75), false, true, 'stalk')) {
            // It stood there long enough without being found: a step nearer (once it's this close, it doesn't
            // give up).
        } else {
            this._hide();
        }
        return false;
    }

    /** A fresh visit, once it's been gone long enough: somewhere just out of shot. */
    _visit(viewer) {
        const a = this.aggression;
        if (this._appear(viewer, lerp(5, 3.2, a), lerp(7.2, 5, a), true, this._waited >= PATIENCE, 'appear')) {
            this._waited = 0;
        } else {
            // Nowhere with a clear line to you just now: try again in a moment, from wherever you've got to.
            this._waited += RETRY;
            this._timer = RETRY;
        }
    }

    /**
     * On its way to a spot: there once the spot has stayed out of the picture for long enough, or off to
     * somewhere else if the picture comes round to it first.
     */
    _arrive(dt, viewer, onEvent) {
        if (this._onScreen(this.x, this.z, viewer)) {
            this.state = 'hidden';
            this._timer = RETRY;
            return;
        }
        this._timer -= dt;
        if (this._timer > 0) return;
        this.state = 'standing';
        this._timer = lerp(9, 5, this.aggression);
        this._seenFor = 0;
        this._unseenFor = 0;
        onEvent?.(this._arrival);
    }

    /**
     * Picks somewhere to go, `min` to `max` from you, out of the picture. Best is somewhere with a clear line
     * to you (lit, if it can, and behind you if it's close), so that turning round finds it, and with
     * `edge`, just past the edge of the picture. Then close beside you, and with `anywhere`, round a corner.
     * @param {Viewer} viewer
     * @param {number} min
     * @param {number} max
     * @param {boolean} edge Rather be just out of shot.
     * @param {boolean} anywhere Settle for somewhere without a clear line to you.
     * @param {WatcherEvent} arrival What its arrival there will be.
     * @returns {boolean} Whether a spot was found (it's on its way).
     */
    _appear(viewer, min, max, edge, anywhere, arrival) {
        const viewerCellX = Math.round(viewer.x);
        const viewerCellZ = Math.round(viewer.z);
        const reach = Math.ceil(max);
        /** @type {{ x: number, z: number }[][]} Candidates, best first. */
        const ranked = [[], [], [], [], []];
        for (let x = viewerCellX - reach; x <= viewerCellX + reach; x++) {
            for (let z = viewerCellZ - reach; z <= viewerCellZ + reach; z++) {
                if (x === viewerCellX && z === viewerCellZ) continue;
                const dx = x - viewer.x;
                const dz = z - viewer.z;
                const d = Math.hypot(dx, dz);
                if (d < min || d > max || !this.world.free(x, z) || this._onScreen(x, z, viewer)) continue;
                const facing = Math.acos(clampUnit((dx * viewer.fx + dz * viewer.fz) / d));
                let rank;
                if (!this.world.los(viewer.x, viewer.z, x, z)) {
                    if (!anywhere) continue;
                    rank = 4;
                } else if (d < CLOSE_BEHIND && facing < BEHIND) {
                    // Close beside you, where the next turn would walk you straight into it.
                    rank = 3;
                } else {
                    const lit = this.world.lit(x, z) >= WELL_LIT;
                    if (edge && lit && facing < viewer.halfFov + EDGE_BAND) rank = 0;
                    else rank = lit ? 1 : 2;
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

    /** Whether any of it, standing at (x, z), is or could in a moment be in the picture. */
    _onScreen(x, z, viewer) {
        if (this.world.onScreen) return this.world.onScreen(x, z);
        const dx = x - viewer.x;
        const dz = z - viewer.z;
        const d = Math.hypot(dx, dz);
        if (d > VIEW_RANGE + 0.5) return false;
        if (d < 1e-6) return true;
        const facing = Math.acos(clampUnit((dx * viewer.fx + dz * viewer.fz) / d));
        // Its own width, as an angle, counts too.
        return facing < viewer.halfFov + SCREEN_MARGIN + Math.atan(0.2 / d);
    }

    _hide() {
        this.state = 'hidden';
        this.seen = false;
        this.visibility = 0;
        this._seenFor = 0;
        this._timer = this._hiddenTime();
    }

    /** Seconds out of the world before the next visit. */
    _hiddenTime() {
        return lerp(14, 3, this.aggression) * (0.7 + 0.6 * this.random());
    }
}
