/*
 * The sound of Level 37, the Poolrooms: water and tile, and a very long way for every sound to go. It takes the place
 * of Level 0's office hum, on top of the rest of the ambience:
 *
 * - the water, never quite still: lapping at the pools' edges, and the fine chatter of ripples against the tile;
 * - a pump somewhere under the floor, turning over slowly, and the air;
 * - everything in a hall of glazed tile: a long, bright echo;
 * - drops falling from the ceiling into the water, near and far, each with its own echo;
 * - footsteps: a clean click on the dry walkways, a splash where it's ankle deep, a slow wade where it's deeper;
 * - now and then water sloshing somewhere, a drain gurgling, and once in a long while, far off, a splash, as if
 *   something went into the water;
 * - falling in: a splash, and then you're under, where it all goes dull and far away and there's only the rumble of
 *   the water and your own bubbles.
 *
 * In a power cut the pump stops and the lamps in the pools go out with a clunk; the water carries on.
 *
 * All of it synthesised from the ambience's audio context, like everything else.
 */

// How loud each part is, before the ambience's master level.
const LAP_LEVEL = 0.55;
const CHATTER_LEVEL = 0.05;
const AIR_LEVEL = 0.06;
const PUMP_LEVEL = 0.07;
const UNDER_LEVEL = 0.9;
const STEP_LEVEL = 1;
const DRIP_LEVEL = 0.3;
const SLOSH_LEVEL = 0.22;
const GURGLE_LEVEL = 0.12;
const FAR_SPLASH_LEVEL = 0.45;
const SPLASH_LEVEL = 1.1;
// How much of everything goes into the hall's echo, and how loud the echo comes back.
const HALL_SEND = 0.35;
const HALL_LEVEL = 2.2;
// Seconds between drips, sloshes, the drains gurgling, a splash far off, and bubbles under the water.
const DRIP_GAP = [0.8, 4.5];
const SLOSH_GAP = [6, 16];
const GURGLE_GAP = [25, 70];
const FAR_SPLASH_GAP = [90, 260];
const BUBBLE_GAP = [0.4, 2.2];
// Under the water: how far down everything's muffled, and how quickly it goes.
const MUFFLED = 420;
const CLEAR = 18000;
// Seconds the power has to stay off before it counts as a cut.
const CUT_CONFIRM = 0.2;

const randomBetween = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class PoolroomsAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        this.ambience = ambience;
        this.enabled = false;
        this.built = false;
        this.underwater = false;
        this._power = 1;
        this._powerOut = false;
        this._dark = 0;
        this._footLeft = false;
        this._resetTimers();
    }

    /** Makes the bed, once the ambience has an audio context (it needs a click first). */
    _build() {
        const context = this.ambience.context;
        if (this.built || !context) return this.built;
        this.built = true;
        this.context = context;
        const noise = this.ambience.noise;
        this.brown = createBrownNoise(context, 8);

        // Everything goes through the muffle (under the water, it closes right down) and fades with the level.
        this.muffle = context.createBiquadFilter();
        this.muffle.type = 'lowpass';
        this.muffle.frequency.value = CLEAR;
        this.muffle.Q.value = 0.5;
        this.level = context.createGain();
        this.level.gain.value = 0;
        this.muffle.connect(this.level).connect(this.ambience.master);
        this.bus = context.createGain();
        this.bus.connect(this.muffle);
        // The hall: a long, bright echo off all that tile.
        this.hall = context.createConvolver();
        this.hall.buffer = createHallImpulse(context, 5.5);
        this.hallSend = context.createGain();
        this.hallSend.gain.value = HALL_SEND;
        const hallLevel = context.createGain();
        hallLevel.gain.value = HALL_LEVEL;
        this.hallSend.connect(this.hall).connect(hallLevel).connect(this.muffle);
        this.bus.connect(this.hallSend);
        // Somewhere else in the halls: all echo, and a little of it direct, dulled.
        this.far = context.createGain();
        this.far.connect(this.hall);
        const distant = context.createBiquadFilter();
        distant.type = 'lowpass';
        distant.frequency.value = 1800;
        const distantLevel = context.createGain();
        distantLevel.gain.value = 0.25;
        this.far.connect(distant).connect(distantLevel).connect(this.muffle);

        // The water lapping: low, slow, swelling and settling out of step with itself.
        const lap = this._loop(this.brown, 0.8);
        const lapFilter = context.createBiquadFilter();
        lapFilter.type = 'bandpass';
        lapFilter.frequency.value = 320;
        lapFilter.Q.value = 0.9;
        this._lfo(0.07, 90, lapFilter.frequency);
        const lapGain = context.createGain();
        lapGain.gain.value = LAP_LEVEL * 0.7;
        this._lfo(0.13, LAP_LEVEL * 0.3, lapGain.gain);
        this._lfo(0.37, LAP_LEVEL * 0.18, lapGain.gain);
        lap.connect(lapFilter).connect(lapGain).connect(this.bus);
        // The chatter of little ripples against the tile.
        const chatter = this._loop(noise, 1.1);
        const chatterFilter = context.createBiquadFilter();
        chatterFilter.type = 'bandpass';
        chatterFilter.frequency.value = 1300;
        chatterFilter.Q.value = 2.2;
        this._lfo(0.21, 300, chatterFilter.frequency);
        const chatterGain = context.createGain();
        chatterGain.gain.value = CHATTER_LEVEL;
        this._lfo(0.9, CHATTER_LEVEL * 0.6, chatterGain.gain);
        chatter.connect(chatterFilter).connect(chatterGain).connect(this.bus);
        // The air.
        const air = this._loop(noise, 0.9);
        const airFilter = context.createBiquadFilter();
        airFilter.type = 'bandpass';
        airFilter.frequency.value = 2600;
        airFilter.Q.value = 0.5;
        const airGain = context.createGain();
        airGain.gain.value = AIR_LEVEL;
        air.connect(airFilter).connect(airGain).connect(this.bus);

        // The pump: a deep turning-over, far below, that stops in a power cut.
        this.pump = context.createGain();
        this.pump.gain.value = 1;
        this.pump.connect(this.far);
        const throb = context.createGain();
        throb.gain.value = 0.7;
        this._lfo(0.55, 0.3, throb.gain);
        throb.connect(this.pump);
        for (const [frequency, level] of [[47, 1], [94.4, 0.45], [141, 0.2]]) {
            const osc = context.createOscillator();
            osc.frequency.value = frequency;
            const gain = context.createGain();
            gain.gain.value = PUMP_LEVEL * level;
            osc.connect(gain).connect(throb);
            osc.start();
        }

        // Under the water: the rumble of it all round, heard only there.
        this.under = context.createGain();
        this.under.gain.value = 0;
        this.under.connect(this.level);
        const rumble = this._loop(this.brown, 0.5);
        const rumbleFilter = context.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 220;
        const rumbleGain = context.createGain();
        rumbleGain.gain.value = UNDER_LEVEL;
        this._lfo(0.11, UNDER_LEVEL * 0.3, rumbleGain.gain);
        rumble.connect(rumbleFilter).connect(rumbleGain).connect(this.under);

        // Footsteps: close by, with a slap-back off the tile and plenty of the hall.
        this.steps = context.createGain();
        this.steps.connect(this.muffle);
        this.slap = context.createDelay(0.25);
        this.slap.delayTime.value = 0.11;
        const slapFilter = context.createBiquadFilter();
        slapFilter.type = 'highpass';
        slapFilter.frequency.value = 500;
        const slapLevel = context.createGain();
        slapLevel.gain.value = 0.3;
        this.steps.connect(this.slap).connect(slapFilter).connect(slapLevel).connect(this.muffle);
        const stepHall = context.createGain();
        stepHall.gain.value = 0.6;
        this.steps.connect(stepHall).connect(this.hallSend);

        this._applyEnabled();
        this._applyUnderwater(true);
        if (this._power < 0.25) {
            this._powerOut = true;
            this.pump.gain.value = 0;
        }
        return true;
    }

    /** Level 37 on or off. The whole layer fades in, and out a little quicker. @param {boolean} on */
    setEnabled(on) {
        if (on && !this.enabled) this._resetTimers();
        this.enabled = on;
        if (on) this._build();
        this._applyEnabled();
    }

    /**
     * Where the listener is, how lit it is there, how much of the power's on, and how high their eyes are (see Game):
     * every frame, before update(). Under the water, it all goes dull.
     * @param {number} _x
     * @param {number} _z
     * @param {number} _areaLight
     * @param {number} power 0..1
     * @param {number} [height] The eyes' height: below 0, under the water.
     */
    follow(_x, _z, _areaLight, power, height = 1) {
        this._power = power;
        this.setUnderwater(height < 0);
    }

    /** @param {boolean} under */
    setUnderwater(under) {
        if (under === this.underwater) return;
        this.underwater = under;
        this._applyUnderwater(false);
        if (under) this._untilBubble = randomBetween(0.1, 0.5);
    }

    /**
     * A footstep at (x, z), in `depth` of water.
     * @param {number} weight How hard the foot lands (0..1.5).
     * @param {number} _x
     * @param {number} _z
     * @param {number} [depth]
     */
    step(weight, _x, _z, depth = 0) {
        this.footstep(weight, depth);
    }

    /**
     * Keeps the level going: watches the power, and brings the drips, the sloshing, the drains and the rest. Call
     * every frame while Level 37 is on.
     * @param {number} dt
     */
    update(dt) {
        if (!this.enabled || !this._build()) return;
        this._watchPower(dt);
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;
        this._untilDrip -= dt;
        if (this._untilDrip <= 0) {
            this._untilDrip = randomBetween(DRIP_GAP[0], DRIP_GAP[1]);
            this.drip(randomBetween(0.3, 1), randomBetween(-1, 1), Math.random() < 0.55);
        }
        this._untilSlosh -= dt;
        if (this._untilSlosh <= 0) {
            this._untilSlosh = randomBetween(SLOSH_GAP[0], SLOSH_GAP[1]);
            this._slosh(randomBetween(0.4, 1), randomBetween(-1, 1), Math.random() < 0.6);
        }
        this._untilGurgle -= dt;
        if (this._untilGurgle <= 0) {
            this._untilGurgle = randomBetween(GURGLE_GAP[0], GURGLE_GAP[1]);
            if (!this._powerOut) this._gurgle();
        }
        this._untilFarSplash -= dt;
        if (this._untilFarSplash <= 0) {
            this._untilFarSplash = randomBetween(FAR_SPLASH_GAP[0], FAR_SPLASH_GAP[1]);
            this._farSplash();
        }
        if (this.underwater) {
            this._untilBubble -= dt;
            if (this._untilBubble <= 0) {
                this._untilBubble = randomBetween(BUBBLE_GAP[0], BUBBLE_GAP[1]);
                this._bubbles(1 + Math.floor(Math.random() * 4));
            }
        }
    }

    /**
     * A footstep: on the dry walkways, a clean click on tile; in shallow water, a splash; deeper, a slow wade; and
     * under the water, only a dull knock.
     * @param {number} weight How hard the foot lands (0..1.5; sprinting is heavier).
     * @param {number} [depth] How deep the water is where it lands.
     */
    footstep(weight, depth = 0) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.footstepsEnabled || weight < 0.05 || !this._build()) return;
        this._footLeft = !this._footLeft;
        const t = this.context.currentTime;
        const heavy = Math.min(weight, 1.5);
        const level = heavy * STEP_LEVEL;
        const out = this._panned(this._footLeft ? -0.08 : 0.08, this.steps);
        this.slap.delayTime.setTargetAtTime(randomBetween(0.08, 0.14), t, 0.3);
        if (this.underwater) {
            this._thump(t, 90, 50, 0.18, level * 0.5, out);
            if (Math.random() < 0.4) this._bubbles(1);
            return;
        }
        if (depth < 0.01) {
            // Bare tile: a hard, clean click, and a little squeak of wet sole now and then.
            this._noise(t, 0.022, 'bandpass', randomBetween(2600, 3600), 1.4, level * 0.5, out);
            this._thump(t, 150, 90, 0.05, level * 0.25, out);
            if (Math.random() < 0.15) this._chirp(t + 0.02, randomBetween(1800, 2400), 0.05, level * 0.05, out);
        } else if (depth < 0.2) {
            // Ankle deep: the foot slapping down into it, a spray, drops falling back.
            this._slosh(level * (0.7 + depth * 3), 0, false, out, 0.2 + depth);
            this._noise(t + 0.004, 0.09, 'highpass', 4200, 0.7, level * 0.22, out);
            this._drops(t + 0.05, 1 + Math.floor(Math.random() * 3), level * 0.3, out);
        } else {
            // Deeper: pushing through it, slow and heavy, the water moving round you.
            this._slosh(level * 0.9, 0, false, out, 0.55);
            this._slosh(level * 0.5, 0, false, out, 0.4, t + randomBetween(0.15, 0.3));
        }
    }

    /** Falling into the water: a crash of it, the thump of going under, and it all raining back down. @param {number} weight */
    splash(weight) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !this._build()) return;
        const t = this.context.currentTime;
        const level = SPLASH_LEVEL * clamp(0.5 + weight * 0.5, 0.5, 1.3);
        const out = this._panned(0, this.bus);
        this._noise(t, 0.7, 'lowpass', 2200, 0.7, level * 0.8, out);
        this._noise(t, 0.25, 'highpass', 3500, 0.7, level * 0.35, out);
        this._slosh(level, 0, false, out, 0.9);
        this._thump(t + 0.03, 110, 40, 0.5, level * 0.6, out);
        this._drops(t + 0.15, 6 + Math.floor(Math.random() * 5), level * 0.25, out, 0.9);
    }

    /**
     * A drop falling into the water: a bloop, with its echo; far off, mostly echo.
     * @param {number} level 0..1
     * @param {number} pan -1..1
     * @param {boolean} [far]
     */
    drip(level, pan, far = false) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.ambienceEnabled || level <= 0.01 || !this._build()) return;
        const t = this.context.currentTime;
        const out = far ? this._panned(pan, this.far) : this._panned(pan, this.bus);
        const frequency = randomBetween(700, 1400);
        const loud = level * DRIP_LEVEL * (far ? 0.8 : 1);
        this._bloop(t, frequency, loud, out);
        this._noise(t, 0.008, 'highpass', 3500, 0.7, loud * 0.35, out);
        if (Math.random() < 0.3) this._bloop(t + randomBetween(0.06, 0.16), frequency * randomBetween(1.2, 1.6), loud * 0.35, out);
    }

    _resetTimers() {
        this._untilDrip = randomBetween(0.3, 1.5);
        this._untilSlosh = randomBetween(2, 8);
        this._untilGurgle = randomBetween(10, 40);
        this._untilFarSplash = randomBetween(60, 150);
        this._untilBubble = 1;
    }

    // ------------------------------------------------------------------ the power

    _watchPower(dt) {
        if (this._power < 0.25) {
            this._dark += dt;
            if (!this._powerOut && this._dark >= CUT_CONFIRM) this._cut();
        } else {
            this._dark = 0;
            if (this._powerOut && this._power > 0.9) this._restore();
        }
    }

    /** The power going: a clunk under the floor as the lamps go, and the pump running down. */
    _cut() {
        this._powerOut = true;
        const t = this.context.currentTime;
        this.pump.gain.cancelScheduledValues(t);
        this.pump.gain.setTargetAtTime(0, t, 1.2);
        if (this.ambience.paused || !this.ambience.ambienceEnabled) return;
        const out = this._panned(randomBetween(-0.5, 0.5), this.far);
        this._thump(t, 90, 45, 0.5, 0.5, out);
        this._noise(t, 0.05, 'bandpass', 1300, 2, 0.2, out);
    }

    _restore() {
        this._powerOut = false;
        const t = this.context.currentTime;
        this.pump.gain.cancelScheduledValues(t);
        this.pump.gain.setTargetAtTime(1, t, 0.8);
        if (this.ambience.paused || !this.ambience.ambienceEnabled) return;
        this._thump(t, 80, 50, 0.35, 0.35, this._panned(randomBetween(-0.5, 0.5), this.far));
    }

    _applyEnabled() {
        if (!this.built) return;
        const t = this.context.currentTime;
        this.level.gain.cancelScheduledValues(t);
        this.level.gain.setTargetAtTime(this.enabled ? 1 : 0, t, this.enabled ? 0.35 : 0.1);
    }

    /** Under the water or not: everything muffled right down, the rumble up, and less of the hall. */
    _applyUnderwater(immediate) {
        if (!this.built) return;
        const t = this.context.currentTime;
        const under = this.underwater;
        const time = immediate ? 0.001 : 0.12;
        this.muffle.frequency.cancelScheduledValues(t);
        this.muffle.frequency.setTargetAtTime(under ? MUFFLED : CLEAR, t, time);
        this.under.gain.cancelScheduledValues(t);
        this.under.gain.setTargetAtTime(under ? 1 : 0, t, time * 2);
        this.hallSend.gain.setTargetAtTime(under ? HALL_SEND * 0.3 : HALL_SEND, t, time);
        if (!immediate && !this.ambience.paused) {
            // Going under, or coming up: a rush of water past the ears.
            const out = this._panned(0, this.bus);
            this._noise(t, 0.35, 'bandpass', under ? 600 : 1500, 0.8, 0.35, out);
            if (under) this._bubbles(3);
        }
    }

    // ------------------------------------------------------------------ water

    /**
     * Water moving: a narrow band of noise that swings up and back, near or far.
     * @param {number} level
     * @param {number} pan
     * @param {boolean} far
     * @param {AudioNode} [out]
     * @param {number} [length] Seconds.
     * @param {number} [t]
     */
    _slosh(level, pan, far, out = null, length = randomBetween(0.4, 0.9), t = this.context.currentTime) {
        const context = this.context;
        const destination = out ?? (far ? this._panned(pan, this.far) : this._panned(pan, this.bus));
        const loud = out ? level : level * SLOSH_LEVEL;
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 3;
        const low = randomBetween(260, 520);
        filter.frequency.setValueAtTime(low, t);
        filter.frequency.exponentialRampToValueAtTime(low * randomBetween(2, 2.8), t + length * 0.25);
        filter.frequency.exponentialRampToValueAtTime(low * 1.1, t + length);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(loud * 1.6, t + Math.min(0.03, length * 0.1));
        gain.gain.exponentialRampToValueAtTime(0.0005, t + length);
        source.connect(filter).connect(gain).connect(destination);
        source.start(t, Math.random() * 2, length + 0.05);
    }

    /** Drops falling back into the water after a splash. */
    _drops(t, count, level, out, spread = 0.35) {
        for (let k = 0; k < count; k++) {
            this._bloop(t + Math.random() * spread, randomBetween(900, 2200), level * randomBetween(0.3, 1), out);
        }
    }

    /** A drain gurgling somewhere: bubbling noise, choking and clearing. */
    _gurgle() {
        const context = this.context;
        const t = context.currentTime;
        const out = this._panned(randomBetween(-1, 1), Math.random() < 0.5 ? this.far : this.bus);
        const length = randomBetween(1.2, 2.6);
        for (let k = 0; k < 14; k++) {
            const at = t + (k / 14) * length + Math.random() * 0.05;
            this._bloop(at, randomBetween(180, 420), GURGLE_LEVEL * randomBetween(0.4, 1) * (1 - k / 18), out);
        }
    }

    /** A long way off, something going into the water. */
    _farSplash() {
        const t = this.context.currentTime;
        const out = this._panned(randomBetween(-1, 1), this.far);
        this._noise(t, 0.6, 'lowpass', 1500, 0.7, FAR_SPLASH_LEVEL, out);
        this._slosh(FAR_SPLASH_LEVEL * 0.8, 0, true, out, 0.8);
        this._drops(t + 0.2, 4, FAR_SPLASH_LEVEL * 0.2, out, 0.7);
    }

    /** Bubbles rising past you under the water. */
    _bubbles(count) {
        if (!this.built || this.ambience.paused) return;
        const t = this.context.currentTime;
        const out = this._panned(randomBetween(-0.4, 0.4), this.under);
        for (let k = 0; k < count; k++) this._chirp(t + k * randomBetween(0.04, 0.12), randomBetween(260, 520), 0.07, 0.12, out, 1.9);
    }

    // ------------------------------------------------------------------ building blocks

    /** A drop's bloop: dropping quickly in pitch, then back up. */
    _bloop(t, frequency, level, out) {
        const context = this.context;
        const decay = 0.16;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(frequency, t);
        osc.frequency.exponentialRampToValueAtTime(frequency * 0.55, t + 0.025);
        osc.frequency.exponentialRampToValueAtTime(frequency * 0.85, t + decay);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.02);
    }

    /** A short sine sweep: a squeak, or (rising) a bubble. */
    _chirp(t, frequency, length, level, out, rise = 1.3) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(frequency, t);
        osc.frequency.exponentialRampToValueAtTime(frequency * rise, t + length);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + length);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + length + 0.02);
    }

    /** A slow sine wobble added onto a parameter. */
    _lfo(frequency, depth, param) {
        const context = this.context;
        const lfo = context.createOscillator();
        lfo.frequency.value = frequency;
        const gain = context.createGain();
        gain.gain.value = depth;
        lfo.connect(gain).connect(param);
        lfo.start();
    }

    /** A buffer looping for good, from somewhere in the middle. */
    _loop(buffer, rate) {
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.playbackRate.value = rate;
        source.start(0, Math.random() * buffer.duration);
        return source;
    }

    _panned(pan, destination) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        panner.connect(destination);
        return panner;
    }

    /** A burst of filtered noise with a sharp attack and an exponential tail. */
    _noise(t, decay, type, frequency, q, level, out) {
        const context = this.context;
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        source.playbackRate.value = randomBetween(0.85, 1.15);
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = q;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + Math.min(0.004, decay * 0.3));
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        source.connect(filter).connect(gain).connect(out);
        source.start(t, Math.random() * Math.max(2.4 - decay, 0), decay + 0.05);
    }

    /** A low sine thump, dropping in pitch. */
    _thump(t, from, to, decay, level, out) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(to, t + decay * 0.7);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.03);
    }
}

/**
 * The hall's echo: noise dying away over `seconds`, bright (tile gives back the highs), with the first reflections
 * coming back clear before it smears into the tail. Stereo, each side its own.
 */
function createHallImpulse(context, seconds) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let smooth = 0;
        for (let i = 0; i < length; i++) {
            const time = i / rate;
            // Darker as it goes (a one-pole low-pass that closes with time), and dying away.
            const k = 0.9 - 0.75 * Math.min(time / seconds, 1);
            smooth += k * (Math.random() * 2 - 1 - smooth);
            data[i] = smooth * Math.exp((-4.2 * time) / seconds) * Math.min(time / 0.012, 1);
        }
        // A few early reflections off the nearest walls.
        for (let r = 0; r < 7; r++) {
            const at = Math.floor(rate * randomBetween(0.012, 0.09));
            data[at] += (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.3, 0.7);
        }
    }
    return buffer;
}

/** Noise with most of its weight down low, normalised, and looping without a click (see LevelOne.js). */
function createBrownNoise(context, seconds) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * seconds);
    const fade = Math.floor(rate * 0.5);
    const raw = new Float32Array(length + fade);
    const k = 1 - Math.exp((-2 * Math.PI * 120) / rate);
    let value = 0;
    for (let i = 0; i < raw.length; i++) {
        value += k * (Math.random() * 2 - 1 - value);
        raw[i] = value;
    }
    const buffer = context.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    let power = 0;
    for (let i = 0; i < length; i++) {
        data[i] = i < fade ? raw[i] * Math.sqrt(i / fade) + raw[length + i] * Math.sqrt(1 - i / fade) : raw[i];
        power += data[i] * data[i];
    }
    const gain = 0.3 / Math.sqrt(power / length);
    for (let i = 0; i < length; i++) data[i] *= gain;
    return buffer;
}
