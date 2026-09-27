/*
 * The storm outside Level 4's windows (see abandonedOffice.js): the rain never stops, and now and then there's
 * lightning. This only keeps time: when the next strike comes, how near it is, which way, and how bright the flash is
 * right now. The lighting puts that into the shaders every frame (see Lighting.update and abandonedOfficeShading.js),
 * and the level's sound listens for each strike, for its thunder (see audio/AbandonedOffice.js).
 *
 * A strike is one flash, or two or three a little apart, never more than three a second (see PULSE_GAP). With reduced
 * motion asked for (`calm`), it's one soft flash, slower to come and go, and dimmer.
 */

// Seconds before the first strike, and between strikes; and how often one comes hard on another's heels.
const FIRST = [4, 9];
const GAP = [9, 30];
const AGAIN = [2.5, 5];
const AGAIN_CHANCE = 0.18;
// How quickly a flash comes up and dies away, and the least time between two in one strike.
const RISE = 0.03;
const FALL = 0.2;
const PULSE_GAP = 0.34;
const CALM_RISE = 0.18;
const CALM_FALL = 0.6;

/**
 * @typedef {object} Pulse One flash of a strike.
 * @property {number} at When it comes, on the storm's clock.
 * @property {number} strength
 */

export class Storm {
    /** @param {() => number} [random] For tests. */
    constructor(random = Math.random) {
        this.random = random;
        /** Whether the level that's showing has one. */
        this.on = false;
        /** Reduced motion: one soft flash to a strike. */
        this.calm = false;
        /** How bright the lightning is right now, 0 to about 1.3. */
        this.flash = 0;
        /** Which way the last strike was, across the sky: a unit vector in x and z. */
        this.bearing = [0.6, -0.8];
        /** How near it was, 0 (far off) to 1 (right overhead). */
        this.near = 0;
        /** How many strikes there have been, for whoever's listening. */
        this.strikes = 0;
        /** The bolt the last strike drew in the sky, if it was near enough to see: a number that picks its shape. */
        this.bolt = 0;
        /** Seconds since the last strike. */
        this.since = Infinity;
        this.time = 0;
        this._next = between(random, FIRST);
        /** @type {Pulse[]} */
        this._pulses = [];
    }

    /**
     * Advances the clock.
     * @param {number} dt
     */
    update(dt) {
        if (!this.on) {
            this.flash = 0;
            return;
        }
        this.time += dt;
        this.since += dt;
        this._next -= dt;
        if (this._next <= 0) this.strike();
        const rise = this.calm ? CALM_RISE : RISE;
        const fall = this.calm ? CALM_FALL : FALL;
        let flash = 0;
        for (const pulse of this._pulses) {
            const t = this.time - pulse.at;
            if (t < 0) continue;
            flash += pulse.strength * (t < rise ? t / rise : Math.exp(-(t - rise) / fall));
        }
        this.flash = flash;
        // (Forget the ones long gone.)
        if (this._pulses.length > 0 && this.time - this._pulses[this._pulses.length - 1].at > fall * 12) this._pulses.length = 0;
    }

    /** A strike, now: somewhere across the sky, near or far. */
    strike() {
        const random = this.random;
        const angle = random() * Math.PI * 2;
        this.bearing = [Math.cos(angle), Math.sin(angle)];
        // Mostly far off.
        this.near = random() ** 1.7;
        this.strikes++;
        this.since = 0;
        this.bolt = this.near > 0.3 ? 1 + Math.floor(random() * 1000) : 0;
        const strength = 0.45 + 0.75 * this.near;
        this._pulses = [{ at: this.time, strength: this.calm ? strength * 0.4 : strength }];
        if (!this.calm) {
            // The flicker of a strike: another flash or two, each a little after the last.
            let at = this.time;
            const more = (random() < 0.65 ? 1 : 0) + (random() < 0.3 ? 1 : 0);
            for (let k = 0; k < more; k++) {
                at += PULSE_GAP + random() * 0.25;
                this._pulses.push({ at, strength: strength * (0.4 + 0.5 * random()) });
            }
        }
        this._next = random() < AGAIN_CHANCE ? between(random, AGAIN) : between(random, GAP);
    }

    /** A different world, or the storm going: the sky dark, and the next strike a little way off. */
    reset() {
        this._pulses.length = 0;
        this.flash = 0;
        this.since = Infinity;
        this._next = between(this.random, FIRST);
    }
}

function between(random, [min, max]) {
    return min + random() * (max - min);
}

/** The storm (there's only ever one, over whichever level has it): the lighting and the sound share it. */
export const storm = new Storm();
