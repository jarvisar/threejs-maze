// Overall loudness at 100% volume. The hum is meant to sit in the background, not to be noticed.
const MASTER_LEVEL = 0.22;
// How much quieter it gets while the game is paused.
const PAUSED_LEVEL = 0.4;
const RAMP_SECONDS = 0.6;
// Seconds of play between distant sounds.
const EVENT_MIN_GAP = 35;
const EVENT_MAX_GAP = 120;

/**
 * Everything you hear, synthesised with the Web Audio API (no audio files):
 *
 * - the fluorescent-light hum: mains hum (60 Hz and harmonics), a filtered ballast buzz and a faint
 *   electrical hiss, drifting slowly, and fading where the lights have died;
 * - footsteps on damp carpet;
 * - the buzz of a failing tube coming back on;
 * - the camcorder's zoom motor;
 * - now and then, something in the distance.
 */
export class Ambience {
    constructor() {
        /** @type {AudioContext | null} */
        this.context = null;
        this.master = null;
        this.volume = 0.5;
        this.muted = false;
        this.paused = true;
        this.footstepsEnabled = true;
        this.ambienceEnabled = true;
        this._untilEvent = randomBetween(EVENT_MIN_GAP * 0.5, EVENT_MAX_GAP * 0.6);
        this._footLeft = false;
        this._areaLight = 1;
    }

    /** Creates/resumes audio. Browsers only allow this from a user gesture (e.g. the Start click). */
    start() {
        const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!this.context) {
            const context = new AudioContextClass();
            this.context = context;
            this.master = context.createGain();
            this.master.gain.value = 0;
            this.master.connect(context.destination);

            this.hum = context.createGain();
            this.hum.connect(this.master);
            buildHum(context, this.hum);

            this.effects = context.createGain();
            this.effects.connect(this.master);
            // Sounds sent here seem to come from far off, down some other corridor. (The convolver normalizes
            // its impulse, which leaves the tail quiet; the gain brings it back up to audible.)
            this.reverb = context.createConvolver();
            this.reverb.buffer = createReverbImpulse(context, 3);
            const reverbLevel = context.createGain();
            reverbLevel.gain.value = 3.5;
            this.reverb.connect(reverbLevel).connect(this.master);
            this.noise = createNoiseBuffer(context, 3);
        }
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
        this._applyLevel();
    }

    /** @param {number} volume 0..1 */
    setVolume(volume) {
        this.volume = volume;
        this._applyLevel();
    }

    setMuted(muted) {
        this.muted = muted;
        this._applyLevel();
    }

    setPaused(paused) {
        this.paused = paused;
        this._applyLevel();
        if (paused) this.setZoomMotor(0);
    }

    /** The hum comes from the lights, so it fades where they've died. @param {number} level 0..1 */
    setAreaLight(level) {
        if (!this.context || Math.abs(level - this._areaLight) < 0.01) return;
        this._areaLight = level;
        this.hum.gain.setTargetAtTime(0.15 + 0.85 * level, this.context.currentTime, 0.5);
    }

    /**
     * Advances the clock for distant sounds. Call every frame while playing.
     * @param {number} dt
     */
    update(dt) {
        if (!this.context || this.paused || !this.ambienceEnabled) return;
        this._untilEvent -= dt;
        if (this._untilEvent > 0) return;
        this._untilEvent = randomBetween(EVENT_MIN_GAP, EVENT_MAX_GAP);
        const roll = Math.random();
        if (roll < 0.35) this._distantThud();
        else if (roll < 0.65) this._distantKnocks();
        else if (roll < 0.85) this._distantSteps();
        else this.buzz(0.35, randomBetween(-0.9, 0.9), true);
    }

    /**
     * A footstep on carpet: a soft, muffled thump.
     * @param {number} weight How hard the foot lands (0..1.5; sprinting is heavier).
     */
    footstep(weight) {
        if (!this.context || this.paused || !this.footstepsEnabled || weight < 0.05) return;
        this._footLeft = !this._footLeft;
        this._step(this.context.currentTime, Math.min(weight, 1.5) * 0.65, this._footLeft ? -0.08 : 0.08, 650, this.effects);
    }

    /**
     * The buzz and tick of a fluorescent tube flickering back on.
     * @param {number} level Loudness, 0..1 (by distance).
     * @param {number} pan -1..1
     * @param {boolean} [far] Send it through the reverb, as if from far away.
     */
    buzz(level, pan, far = false) {
        if (!this.context || this.paused || !this.ambienceEnabled || level <= 0.01) return;
        const context = this.context;
        const t = context.currentTime;
        const length = randomBetween(0.06, 0.16);
        const out = this._panned(pan, far ? this.reverb : this.effects);

        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 120;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = randomBetween(1400, 2200);
        filter.Q.value = 1.5;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.4 * level, t + 0.006);
        gain.gain.setValueAtTime(0.4 * level, t + length);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.06);
        osc.connect(filter).connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + length + 0.08);

        this._noiseBurst(t, 0.012, 'highpass', 3000, 0.25 * level, out);
    }

    /**
     * The whirr of the zoom motor, while the zoom is moving.
     * @param {number} speed 0 (still) .. 1 (full speed)
     */
    setZoomMotor(speed) {
        if (!this.context) return;
        if (!this.motor) {
            if (speed <= 0) return;
            const context = this.context;
            const source = context.createBufferSource();
            source.buffer = this.noise;
            source.loop = true;
            const filter = context.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1100;
            filter.Q.value = 6;
            const whine = context.createOscillator();
            whine.frequency.value = 340;
            const whineGain = context.createGain();
            whineGain.gain.value = 0.08;
            this.motor = context.createGain();
            this.motor.gain.value = 0;
            source.connect(filter).connect(this.motor);
            whine.connect(whineGain).connect(this.motor);
            this.motor.connect(this.effects);
            source.start();
            whine.start();
        }
        this.motor.gain.setTargetAtTime(Math.min(speed, 1) * 0.22, this.context.currentTime, 0.04);
    }

    _applyLevel() {
        if (!this.context) return;
        const level = this.muted ? 0 : this.volume * this.volume * MASTER_LEVEL * (this.paused ? PAUSED_LEVEL : 1);
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(level, now, RAMP_SECONDS / 3);
    }

    // ------------------------------------------------------------------ building blocks

    _panned(pan, destination) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        panner.connect(destination);
        return panner;
    }

    /** A burst of filtered noise with a sharp attack and an exponential tail. */
    _noiseBurst(t, decay, type, frequency, level, out) {
        const context = this.context;
        const source = context.createBufferSource();
        source.buffer = this.noise;
        source.playbackRate.value = randomBetween(0.85, 1.15);
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = 0.8;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        source.connect(filter).connect(gain).connect(out);
        source.start(t, Math.random() * Math.max(2.8 - decay, 0), decay + 0.05);
    }

    _step(t, level, pan, brightness, destination) {
        const out = this._panned(pan, destination);
        this._noiseBurst(t, 0.14, 'lowpass', brightness * randomBetween(0.8, 1.2), level, out);
        // The heel: a short, low thud under the scuff.
        const context = this.context;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(95, t);
        osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level * 0.6, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + 0.15);
    }

    _distantThud() {
        const t = this.context.currentTime;
        const out = this._panned(randomBetween(-0.8, 0.8), this.reverb);
        this._noiseBurst(t, 1.2, 'lowpass', 140, 0.9, out);
    }

    _distantKnocks() {
        const t = this.context.currentTime;
        const out = this._panned(randomBetween(-0.9, 0.9), this.reverb);
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) this._noiseBurst(t + i * randomBetween(0.32, 0.46), 0.14, 'lowpass', 420, 0.85, out);
    }

    /** Someone else walking, somewhere, heading away. */
    _distantSteps() {
        const t = this.context.currentTime;
        const pan = randomBetween(-0.9, 0.9);
        const count = 5 + Math.floor(Math.random() * 5);
        const pace = randomBetween(0.5, 0.62);
        for (let i = 0; i < count; i++) {
            this._step(t + i * pace, 0.45 * (1 - i / (count + 2)), pan, 380, this.reverb);
        }
    }
}

/**
 * @param {BaseAudioContext} context
 * @param {AudioNode} output
 */
export function buildHum(context, output) {
    const bus = context.createGain();
    bus.gain.value = 0.8;
    bus.connect(output);

    // Mains hum: the 60 Hz fundamental is weak, the 120 Hz magnetostriction tone dominates.
    for (const [frequency, gain] of [[60, 0.16], [120, 0.3], [180, 0.05], [240, 0.08], [360, 0.03]]) {
        const osc = context.createOscillator();
        osc.frequency.value = frequency;
        const g = context.createGain();
        g.gain.value = gain;
        osc.connect(g).connect(bus);
        osc.start();
    }

    // Ballast buzz: a sawtooth at 120 Hz, filtered down to its lower harmonics.
    const buzz = context.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 120;
    const buzzFilter = context.createBiquadFilter();
    buzzFilter.type = 'lowpass';
    buzzFilter.frequency.value = 900;
    buzzFilter.Q.value = 0.5;
    const buzzGain = context.createGain();
    buzzGain.gain.value = 0.05;
    buzz.connect(buzzFilter).connect(buzzGain).connect(bus);
    buzz.start();

    // Faint electrical hiss.
    const noise = context.createBufferSource();
    noise.buffer = createNoiseBuffer(context, 3);
    noise.loop = true;
    const hissFilter = context.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 5000;
    hissFilter.Q.value = 0.7;
    const hissGain = context.createGain();
    hissGain.gain.value = 0.02;
    noise.connect(hissFilter).connect(hissGain).connect(bus);
    noise.start();

    // Slow, uneven swell so it never sounds like a pure test tone.
    for (const [frequency, depth] of [[0.07, 0.12], [0.23, 0.06]]) {
        const lfo = context.createOscillator();
        lfo.frequency.value = frequency;
        const lfoGain = context.createGain();
        lfoGain.gain.value = depth;
        lfo.connect(lfoGain).connect(bus.gain);
        lfo.start();
    }
}

function createNoiseBuffer(context, seconds) {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
}

/**
 * A large, dull room: decaying noise, darker as it fades (a one-pole low-pass that closes over time),
 * with a short gap before the tail so close sounds don't smear.
 */
function createReverbImpulse(context, seconds) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let smoothed = 0;
        for (let i = 0; i < length; i++) {
            const t = i / length;
            const cutoff = 0.5 * (1 - t) + 0.03;
            smoothed += cutoff * (Math.random() * 2 - 1 - smoothed);
            data[i] = i < context.sampleRate * 0.02 ? 0 : smoothed * (1 - t) ** 3;
        }
    }
    return buffer;
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}
