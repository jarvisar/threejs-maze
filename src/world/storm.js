/*
 * Storm outside Level 4's windows (see abandonedOffice.js). Constant rain with occasional lightning.
 *
 * This only tracks timing: when the next strike comes, its distance and direction, and the current flash
 * brightness. Lighting.update passes that to the shaders (abandonedOfficeShading.js) and audio/AbandonedOffice.js
 * plays thunder for each strike.
 *
 * A strike is one to three flashes, never more than three a second (see PULSE_GAP). With reduced motion (`calm`)
 * it's one soft, dimmer flash that rises and fades slower.
 */

// Seconds before the first strike and between strikes. AGAIN is the quick follow-up gap and AGAIN_CHANCE how
// often one happens.
const FIRST = [4, 9];
const GAP = [9, 30];
const AGAIN = [2.5, 5];
const AGAIN_CHANCE = 0.18;
// Flash rise and fall times (s), and the minimum gap between flashes in one strike.
const RISE = 0.03;
const FALL = 0.2;
const PULSE_GAP = 0.34;
const CALM_RISE = 0.18;
const CALM_FALL = 0.6;

/**
 * @typedef {object} Pulse One flash of a strike.
 * @property {number} at Start time on the storm's clock.
 * @property {number} strength
 */

export class Storm {
    /** @param {() => number} [random] For tests. */
    constructor(random = Math.random) {
        this.random = random;
        /** True when the current level has a storm. */
        this.on = false;
        /** Reduced motion, one soft flash per strike. */
        this.calm = false;
        /** Current lightning brightness, 0 to about 1.3. */
        this.flash = 0;
        /** Direction of the last strike as a unit vector in x and z. */
        this.bearing = [0.6, -0.8];
        /** 0 (far off) to 1 (right overhead). */
        this.near = 0;
        /** Strike count, so listeners can spot new ones. */
        this.strikes = 0;
        /** Picks the shape of the visible bolt for the last strike. 0 when it was too far to see one. */
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
        // Drop pulses once they've faded out.
        if (this._pulses.length > 0 && this.time - this._pulses[this._pulses.length - 1].at > fall * 12) this._pulses.length = 0;
    }

    /** Strikes now, in a random direction and distance. */
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
            // Maybe one or two more flashes, each a little after the last.
            let at = this.time;
            const more = (random() < 0.65 ? 1 : 0) + (random() < 0.3 ? 1 : 0);
            for (let k = 0; k < more; k++) {
                at += PULSE_GAP + random() * 0.25;
                this._pulses.push({ at, strength: strength * (0.4 + 0.5 * random()) });
            }
        }
        this._next = random() < AGAIN_CHANCE ? between(random, AGAIN) : between(random, GAP);
    }

    /** For a new world or when the storm stops. Clears the flash and pushes the next strike back. */
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

/** The one storm, shared by lighting and sound. */
export const storm = new Storm();
