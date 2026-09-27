import { detachable, randomBetween } from './Ambience.js';

/*
 * What every level's own sound has in common (see LevelSound in levels.js): Level 1's (LevelOne.js) and Level 37's
 * (Poolrooms.js) are built on this. It's made from the ambience's audio context once there is one (it needs a click
 * first), fades in and out with its level, and hears the power go, once it's been off for a moment (the lights stutter
 * first), and come back. Its sounds are made from the same few building blocks.
 *
 * A level's sound keeps `_power` (0..1) up to date and calls _watchPower every frame, and has its own _build,
 * _applyEnabled, _resetTimers, _cut and _restore. What it plays all the time goes out through _connect, so that while
 * the level's off it's taken off the graph altogether, and costs nothing.
 */

// Seconds the power has to stay off before it counts as a cut.
const CUT_CONFIRM = 0.2;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class LevelAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        this.ambience = ambience;
        this.enabled = false;
        this.built = false;
        this._power = 1;
        this._powerOut = false;
        this._dark = 0;
        /** @type {((wanted: boolean) => void)[]} Its outputs (see _connect). */
        this._outputs = [];
    }

    /** The level on or off. The whole layer fades in, and out a little quicker. @param {boolean} on */
    setEnabled(on) {
        if (on && !this.enabled) this._resetTimers();
        this.enabled = on;
        if (on) this._build();
        this._applyEnabled();
        for (const attach of this._outputs) attach(on);
    }

    /** Connects one of its outputs: on while the level is, and off once it's faded out after (see detachable). */
    _connect(node, destination) {
        const attach = detachable(node, [destination]);
        this._outputs.push(attach);
        attach(this.enabled);
    }

    /**
     * Makes it, once the ambience has an audio context (`context`, from then on).
     * @returns {boolean} Whether it's made.
     */
    _build() {
        return false;
    }

    /** Fades it in or out, to `enabled`. */
    _applyEnabled() {}

    /** When the next of each of its odd sounds comes, on the way in. */
    _resetTimers() {}

    /** The power going. */
    _cut() {}

    /** The power back. */
    _restore() {}

    /** The power only goes once it has been off for a moment, not with every stutter of the lights. */
    _watchPower(dt) {
        if (this._power < 0.25) {
            this._dark += dt;
            if (!this._powerOut && this._dark >= CUT_CONFIRM) this._cut();
        } else {
            this._dark = 0;
            if (this._powerOut && this._power > 0.9) this._restore();
        }
    }

    // ------------------------------------------------------------------ building blocks

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

    /** A buffer looping for good, from somewhere in the middle (so two loops of the same one don't line up). */
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
 * Noise with most of its weight down low (white noise through a one-pole low-pass at `corner` Hz), normalised, and
 * looping without a click: the start is blended with what would have come after the end.
 * @param {BaseAudioContext} context
 * @param {number} seconds
 * @param {number} corner
 */
export function createBrownNoise(context, seconds, corner) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * seconds);
    const fade = Math.floor(rate * 0.5);
    const raw = new Float32Array(length + fade);
    const k = 1 - Math.exp((-2 * Math.PI * corner) / rate);
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
