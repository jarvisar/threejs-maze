/*
 * The thing on the tape.
 *
 * It never walks. It stands somewhere near you, out of sight, and when you turn and see it the tape
 * starts to go (the "exposure" here, which the mode turns into static, failing lights and noise). Look
 * away and the exposure fades; look back and it's gone, or closer. Stare, or let it get close, and the
 * tape ends. Nothing here moves it while you can see it: everything it does, it does when you're not
 * looking, which is what makes turning around the frightening part.
 *
 * How often it comes and how close is set by `aggression` (0..1), which the mode raises with every note.
 * Until the first note it stays away altogether, so the start of a run is for learning the place.
 *
 * Pure logic: the world is a few callbacks, so this can be run through in tests.
 */

// How far away it can be seen at all (the far plane; the fog has nearly swallowed it by then).
const VIEW_RANGE = 11;
// Closer than this and the tape goes whether you're looking or not; closer still, it has you.
const TOO_CLOSE = 1.4;
const CAUGHT_DISTANCE = 0.65;
// Being seen counts once there's this much light to make it out against.
const SEEN_THRESHOLD = 0.12;
// Seconds without seeing it before it decides what to do next.
const LOOKED_AWAY = 0.5;

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @typedef {object} WatcherWorld
 * @property {(ax: number, az: number, bx: number, bz: number) => boolean} los Whether nothing stands between
 *     two points at eye height.
 * @property {(x: number, z: number) => boolean} free Whether it can stand in a cell.
 * @property {(x: number, z: number) => number} lit How much light there is to see it against, 0..1.
 */

/**
 * @typedef {object} Viewer
 * @property {number} x
 * @property {number} z
 * @property {number} fx Which way you're looking (unit, horizontal).
 * @property {number} fz
 * @property {number} halfFov Half the horizontal field of view, in radians.
 */

/** @typedef {'appear' | 'closer' | 'vanish'} WatcherEvent */

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
        /** It does nothing until this is set (the first note). */
        this.active = false;
        /** 0 (a rare glimpse, far off) to 1 (never far, never gone for long). */
        this.aggression = 0;
        /** @type {'hidden' | 'standing'} */
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
    }

    /** Starts it watching (the first note). */
    activate() {
        if (this.active) return;
        this.active = true;
        this._timer = this._hiddenTime() * 0.7;
    }

    /**
     * @param {number} dt
     * @param {Viewer} viewer
     * @param {(event: WatcherEvent) => void} [onEvent]
     * @returns {boolean} true the moment it has you.
     */
    update(dt, viewer, onEvent) {
        const a = this.aggression;
        if (!this.active || this.state === 'hidden') {
            this.seen = false;
            this.visibility = 0;
            this.distance = Infinity;
            this.exposure = Math.max(this.exposure - lerp(0.22, 0.12, a) * dt, 0);
            if (this.active) {
                this._timer -= dt;
                if (this._timer <= 0) {
                    if (this._appear(viewer, null)) onEvent?.('appear');
                    else this._timer = 1;
                }
            }
            return false;
        }

        const dx = this.x - viewer.x;
        const dz = this.z - viewer.z;
        const distance = Math.hypot(dx, dz);
        this.distance = distance;
        const angle = distance > 0 ? Math.acos(Math.max(-1, Math.min(1, (dx * viewer.fx + dz * viewer.fz) / distance))) : 0;
        const inView = distance < VIEW_RANGE && angle < viewer.halfFov * 0.95;
        const clear = inView && this.world.los(viewer.x, viewer.z, this.x, this.z);
        this.visibility = clear ? this.world.lit(this.x, this.z) : 0;
        const seen = this.visibility > SEEN_THRESHOLD;
        this.seen = seen;

        if (seen) {
            this._seenFor += dt;
            this._unseenFor = 0;
            // Faster the closer it is, the nearer the middle of the picture, and the plainer it can be seen.
            const proximity = (1 - distance / VIEW_RANGE) ** 2;
            const centre = 1 - angle / viewer.halfFov;
            const rate = (0.12 + 0.6 * proximity) * (0.55 + 0.45 * centre) * (0.75 + 0.5 * a) * (0.5 + 0.5 * this.visibility);
            this.exposure += rate * dt;
        } else {
            this._unseenFor += dt;
            this.exposure = Math.max(this.exposure - lerp(0.22, 0.12, a) * dt, 0);
        }
        // Too close to matter which way you're facing.
        if (distance < TOO_CLOSE) this.exposure += (0.5 + 0.8 * (1 - distance / TOO_CLOSE)) * dt;

        if (distance < CAUGHT_DISTANCE || this.exposure >= 1) {
            this.exposure = 1;
            return true;
        }

        this._timer -= dt;
        if (this._seenFor > 0 && !seen && this._unseenFor >= LOOKED_AWAY) {
            // You looked away. Usually it's simply gone; more and more often, it's nearer when you look back.
            this._seenFor = 0;
            if (distance > 2.2 && this.random() < lerp(0.3, 0.75, a) && this._appear(viewer, distance)) {
                onEvent?.('closer');
            } else {
                this._hide();
                onEvent?.('vanish');
            }
        } else if (this._timer <= 0) {
            // Stood there long enough without being found.
            this._hide();
        }
        return false;
    }

    /**
     * Picks somewhere to stand: out of your sight but with a clear line to you (so turning round finds it),
     * or, failing that, round a corner, or far off in plain view where the fog has most of it. Never close
     * in front of you: nothing should pop into the middle of the picture.
     * @param {Viewer} viewer
     * @param {number | null} closerThan Come nearer than this (you looked away), or null for a fresh visit.
     * @returns {boolean} Whether a spot was found.
     */
    _appear(viewer, closerThan) {
        const a = this.aggression;
        const min = closerThan === null ? lerp(7, 4, a) : Math.max(1.8, closerThan * 0.45);
        const max = closerThan === null ? lerp(9.5, 6.5, a) : Math.max(2.6, closerThan * 0.7);
        const viewerCellX = Math.round(viewer.x);
        const viewerCellZ = Math.round(viewer.z);
        let best = null;
        let bestRank = Infinity;
        for (let attempt = 0; attempt < 28; attempt++) {
            const angle = this.random() * 2 * Math.PI;
            const distance = min + this.random() * (max - min);
            const x = Math.round(viewer.x + Math.cos(angle) * distance);
            const z = Math.round(viewer.z + Math.sin(angle) * distance);
            if ((x === viewerCellX && z === viewerCellZ) || !this.world.free(x, z)) continue;
            const dx = x - viewer.x;
            const dz = z - viewer.z;
            const d = Math.hypot(dx, dz);
            if (d < min * 0.8) continue;
            const facing = Math.acos(Math.max(-1, Math.min(1, (dx * viewer.fx + dz * viewer.fz) / d)));
            const inView = facing < viewer.halfFov + 0.15;
            const clear = this.world.los(viewer.x, viewer.z, x, z);
            let rank;
            if (clear && !inView) rank = 0;
            else if (clear && d >= 5.5) rank = 1;
            else if (!clear) rank = 2;
            else continue;
            if (rank < bestRank) {
                bestRank = rank;
                best = { x, z };
                if (rank === 0) break;
            }
        }
        if (!best) return false;
        this.x = best.x;
        this.z = best.z;
        this.state = 'standing';
        this._timer = lerp(14, 8, a);
        this._seenFor = 0;
        this._unseenFor = 0;
        return true;
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
        return lerp(20, 4, this.aggression) * (0.6 + 0.8 * this.random());
    }
}
