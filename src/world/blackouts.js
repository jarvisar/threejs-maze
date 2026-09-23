/*
 * Power cuts. Every so often the lights around you stutter, drop out for a few seconds, and then strike
 * back on a bank at a time, the way fluorescent tubes do. It happens rarely enough to stay unsettling.
 *
 * This only keeps time and works out how much of the light is gone right now; the lighting reads `level`
 * every frame, and the sounds follow the events it reports.
 */

// Seconds of play before the first cut, and between cuts after that.
const FIRST_MIN = 150;
const FIRST_MAX = 300;
const GAP_MIN = 300;
const GAP_MAX = 660;
// Seconds spent stuttering before the power goes, out, and coming back.
const STUTTER_SECONDS = 0.7;
const OUT_MIN = 3;
const OUT_MAX = 7;
const RESTART_SECONDS = 1.4;
// The stutter and restart are chopped into slots this long, each on or off.
const STUTTER_SLOT = 0.06;
const RESTART_SLOT = 0.09;

/** @typedef {'cut' | 'flash' | 'restored'} BlackoutEvent */

export class Blackouts {
    /** @param {() => number} [random] For tests. */
    constructor(random = Math.random) {
        this.random = random;
        this.enabled = true;
        /** How much of the light is gone right now, 0 (none) to 1 (all of it). */
        this.level = 0;
        /** @type {'idle' | 'stutter' | 'out' | 'restart'} */
        this.phase = 'idle';
        this._remaining = this._between(FIRST_MIN, FIRST_MAX);
        this._elapsed = 0; // seconds into the current phase
        this._lastLit = true;
        this._nonce = 0;
    }

    /**
     * Advances the clock.
     * @param {number} dt Seconds of play since the last frame.
     * @param {(event: BlackoutEvent, strength: number) => void} [onEvent]
     * @returns {number} The new level.
     */
    update(dt, onEvent) {
        if (!this.enabled) return this.level;
        this._remaining -= dt;
        this._elapsed += dt;
        if (this._remaining <= 0) this._next(onEvent);

        switch (this.phase) {
            case 'stutter': {
                // Mostly on, with dips that get longer, and out for good over the last part.
                const slot = Math.floor(this._elapsed / STUTTER_SLOT);
                const progress = this._elapsed / STUTTER_SECONDS;
                const lit = progress < 0.8 && hash(this._nonce, slot) > 0.25 + 0.5 * progress;
                this.level = lit ? 0.15 * hash(this._nonce, slot + 1000) : 0.75 + 0.25 * hash(this._nonce, slot + 2000);
                if (lit && !this._lastLit) onEvent?.('flash', 0.25);
                this._lastLit = lit;
                break;
            }
            case 'out':
                this.level = 1;
                break;
            case 'restart': {
                // Two quick flashes, a stretch of stuttering that leans more and more towards on, then on.
                const slot = Math.floor(this._elapsed / RESTART_SLOT);
                const progress = this._elapsed / RESTART_SECONDS;
                let lit;
                if (slot === 1 || slot === 4) lit = true;
                else if (slot < 6) lit = false;
                else if (progress < 0.75) lit = hash(this._nonce, slot + 3000) < (progress - 0.35) * 2;
                else lit = true;
                this.level = lit ? 0.3 * (1 - progress) : 1;
                if (lit && !this._lastLit) onEvent?.('flash', 0.4 + 0.6 * (1 - progress));
                this._lastLit = lit;
                break;
            }
            default:
                this.level = 0;
        }
        return this.level;
    }

    /** Brings the lights straight back (e.g. when power cuts are switched off during one). */
    cancel() {
        this.phase = 'idle';
        this.level = 0;
        this._remaining = this._between(GAP_MIN, GAP_MAX);
    }

    _next(onEvent) {
        this._elapsed = 0;
        switch (this.phase) {
            case 'idle':
                this.phase = 'stutter';
                this._nonce = Math.floor(this.random() * 1e9);
                this._remaining = STUTTER_SECONDS;
                this._lastLit = true;
                break;
            case 'stutter':
                this.phase = 'out';
                this._remaining = this._between(OUT_MIN, OUT_MAX);
                onEvent?.('cut', 1);
                break;
            case 'out':
                this.phase = 'restart';
                this._remaining = RESTART_SECONDS;
                this._lastLit = false;
                break;
            default:
                this.phase = 'idle';
                this._remaining = this._between(GAP_MIN, GAP_MAX);
                onEvent?.('restored', 1);
        }
    }

    _between(min, max) {
        return min + this.random() * (max - min);
    }
}

/** A float in [0, 1) from two integers; the same pattern every time for the same inputs. */
function hash(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
}
