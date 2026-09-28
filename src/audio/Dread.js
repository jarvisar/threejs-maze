/*
 * Found Footage sounds, layered on the normal ambience. Tape static, the Watcher's presence, the sighting sting,
 * music layers that build with notes taken (Slender's trick, so it sounds more wrong the further in you are), the
 * nearest TV, the note drum, the exit wind, and the caught/escaped endings.
 *
 * All synthesized from the ambience's audio context. Nothing is loaded.
 */

import { detachable } from './Ambience.js';

export class Dread {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        this.ambience = ambience;
        this.built = false;
        this._static = 0;
        this._layers = 0;
        this._stopped = true;
        this._tvQuietUntil = 0;
    }

    /** Builds the graph once the ambience has an audio context (needs a click first). */
    _build() {
        const context = this.ambience.context;
        if (this.built || !context) return this.built;
        this.built = true;
        this.context = context;
        const noise = this.ambience.noise;

        this.bus = context.createGain();
        this.bus.gain.value = 0;
        // Only attached during a tape (and its fade out) so none of it runs otherwise.
        this._attach = detachable(this.bus, [this.ambience.master]);

        // Static: broadband tape hiss.
        const hiss = context.createBufferSource();
        hiss.buffer = noise;
        hiss.loop = true;
        const hissFilter = context.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.value = 2600;
        hissFilter.Q.value = 0.4;
        this.staticGain = context.createGain();
        this.staticGain.gain.value = 0;
        hiss.connect(hissFilter).connect(this.staticGain).connect(this.bus);
        hiss.start();

        // Presence: sub-bass drone from two detuned tones, plus a slow breathy murmur. The murmur is what small
        // speakers can play and what tells you which side it's on.
        this.presenceGain = context.createGain();
        this.presenceGain.gain.value = 0;
        this.presencePan = context.createStereoPanner();
        this.presencePan.connect(this.presenceGain).connect(this.bus);
        const presenceFilter = context.createBiquadFilter();
        presenceFilter.type = 'lowpass';
        presenceFilter.frequency.value = 240;
        presenceFilter.connect(this.presencePan);
        {
            const murmur = context.createBufferSource();
            murmur.buffer = noise;
            murmur.loop = true;
            const band = context.createBiquadFilter();
            band.type = 'bandpass';
            band.frequency.value = 420;
            band.Q.value = 3;
            const swell = context.createGain();
            swell.gain.value = 0.9;
            const lfo = context.createOscillator();
            lfo.frequency.value = 0.6;
            const depth = context.createGain();
            depth.gain.value = 0.6;
            lfo.connect(depth).connect(swell.gain);
            murmur.connect(band).connect(swell).connect(this.presencePan);
            murmur.start(0, Math.random() * noise.duration);
            lfo.start();
        }
        for (const [type, frequency, level] of [['sine', 41, 0.5], ['sine', 41.7, 0.5], ['sawtooth', 82, 0.25]]) {
            const osc = context.createOscillator();
            osc.type = type;
            osc.frequency.value = frequency;
            const gain = context.createGain();
            gain.gain.value = level;
            osc.connect(gain).connect(presenceFilter);
            osc.start();
        }

        // Layer 1: slow swelling low tone.
        this.layer1 = context.createGain();
        this.layer1.gain.value = 0;
        this.layer1.connect(this.bus);
        {
            const osc = context.createOscillator();
            osc.frequency.value = 55;
            const swell = context.createGain();
            swell.gain.value = 0.5;
            const lfo = context.createOscillator();
            lfo.frequency.value = 0.35;
            const depth = context.createGain();
            depth.gain.value = 0.45;
            lfo.connect(depth).connect(swell.gain);
            osc.connect(swell).connect(this.layer1);
            osc.start();
            lfo.start();
        }

        // Layer 2: thin dissonant whine.
        this.layer2 = context.createGain();
        this.layer2.gain.value = 0;
        this.layer2.connect(this.bus);
        {
            const tremolo = context.createGain();
            tremolo.gain.value = 0.6;
            const lfo = context.createOscillator();
            lfo.frequency.value = 5.3;
            const depth = context.createGain();
            depth.gain.value = 0.4;
            lfo.connect(depth).connect(tremolo.gain);
            for (const frequency of [1180, 1197]) {
                const osc = context.createOscillator();
                osc.frequency.value = frequency;
                const gain = context.createGain();
                gain.gain.value = 0.5;
                osc.connect(gain).connect(tremolo);
                osc.start();
            }
            tremolo.connect(this.layer2);
            lfo.start();
        }

        // Exit: low wind panned to where it is.
        const wind = context.createBufferSource();
        wind.buffer = noise;
        wind.loop = true;
        const windFilter = context.createBiquadFilter();
        windFilter.type = 'lowpass';
        windFilter.frequency.value = 240;
        const gust = context.createGain();
        gust.gain.value = 0.6;
        const gustLfo = context.createOscillator();
        gustLfo.frequency.value = 0.27;
        const gustDepth = context.createGain();
        gustDepth.gain.value = 0.4;
        gustLfo.connect(gustDepth).connect(gust.gain);
        this.beaconPan = context.createStereoPanner();
        this.beaconGain = context.createGain();
        this.beaconGain.gain.value = 0;
        // Duller when behind you.
        this.beaconShade = context.createBiquadFilter();
        this.beaconShade.type = 'lowpass';
        this.beaconShade.frequency.value = 4000;
        wind.connect(windFilter).connect(gust).connect(this.beaconShade).connect(this.beaconPan).connect(this.beaconGain).connect(this.bus);
        wind.start(0, Math.random() * noise.duration);
        gustLfo.start();
        // Moan: a narrow wandering band that small speakers can play.
        const moan = context.createBufferSource();
        moan.buffer = noise;
        moan.loop = true;
        const moanBand = context.createBiquadFilter();
        moanBand.type = 'bandpass';
        moanBand.frequency.value = 640;
        moanBand.Q.value = 7;
        const wander = context.createOscillator();
        wander.frequency.value = 0.11;
        const wanderDepth = context.createGain();
        wanderDepth.gain.value = 90;
        wander.connect(wanderDepth).connect(moanBand.frequency);
        const moanLevel = context.createGain();
        moanLevel.gain.value = 0.9;
        moan.connect(moanBand).connect(moanLevel).connect(gust);
        moan.start(0, Math.random() * noise.duration);
        wander.start();

        // Nearest TV: dead channel hiss and set hum, muffled through walls.
        this.tvMuffle = context.createBiquadFilter();
        this.tvMuffle.type = 'lowpass';
        this.tvMuffle.frequency.value = 5000;
        this.tvPan = context.createStereoPanner();
        this.tvGain = context.createGain();
        this.tvGain.gain.value = 0;
        this.tvMuffle.connect(this.tvPan).connect(this.tvGain).connect(this.bus);
        {
            const hiss = context.createBufferSource();
            hiss.buffer = noise;
            hiss.loop = true;
            const band = context.createBiquadFilter();
            band.type = 'bandpass';
            band.frequency.value = 1900;
            band.Q.value = 0.6;
            const level = context.createGain();
            level.gain.value = 0.5;
            hiss.connect(band).connect(level).connect(this.tvMuffle);
            hiss.start(0, Math.random() * noise.duration);
            const hum = context.createOscillator();
            hum.type = 'sawtooth';
            hum.frequency.value = 60;
            const humFilter = context.createBiquadFilter();
            humFilter.type = 'lowpass';
            humFilter.frequency.value = 260;
            const humLevel = context.createGain();
            humLevel.gain.value = 0.35;
            hum.connect(humFilter).connect(humLevel).connect(this.tvMuffle);
            hum.start();
        }

        return true;
    }

    /** New run. Resets everything to silence and fades the bus in. */
    start() {
        if (!this._build()) return;
        this._stopped = false;
        this._static = 0;
        this._layers = 0;
        const t = this.context.currentTime;
        this._tvQuietUntil = 0;
        for (const gain of [this.staticGain, this.presenceGain, this.layer1, this.layer2, this.beaconGain, this.tvGain]) {
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(0, t);
        }
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setValueAtTime(0, t);
        this.bus.gain.setTargetAtTime(1, t, 0.5);
        this._attach(true);
    }

    /** Fades everything out when the run ends or the mode is left. */
    stop() {
        if (!this.built || this._stopped) return;
        this._stopped = true;
        const t = this.context.currentTime;
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(0, t, 0.4);
        this._attach(false, 2.5);
    }

    /** Tape damage, 0..1. */
    setStatic(level) {
        if (!this.built || this._stopped) return;
        if (Math.abs(level - this._static) < 0.01) return;
        this._static = level;
        this.staticGain.gain.setTargetAtTime(level ** 1.6 * 0.55, this.context.currentTime, 0.05);
    }

    /**
     * Watcher proximity and side.
     * @param {number} level 0..1, 0 when it isn't there.
     * @param {number} pan -1..1
     */
    setPresence(level, pan) {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.presenceGain.gain.setTargetAtTime(level * 0.26, t, 0.3);
        this.presencePan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)) * 0.8, t, 0.2);
    }

    /** Music layers by notes taken. */
    setLayers(notes) {
        if (!this.built || this._stopped || notes === this._layers) return;
        this._layers = notes;
        const t = this.context.currentTime;
        this.layer1.gain.setTargetAtTime(notes >= 1 ? 0.11 : 0, t, 2);
        this.layer2.gain.setTargetAtTime(notes >= 6 ? 0.02 : 0, t, 3);
    }

    /**
     * Exit wind.
     * @param {number} level 0..1
     * @param {number} pan -1..1
     * @param {number} [front] -1 (right behind) .. 1 (ahead). Duller from behind.
     */
    setBeacon(level, pan, front = 1) {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.beaconGain.gain.setTargetAtTime(level * 0.5, t, 0.3);
        this.beaconPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)) * 0.85, t, 0.2);
        this.beaconShade.frequency.setTargetAtTime(700 + 3300 * facing(front), t, 0.2);
    }

    /**
     * Nearest TV that's still on.
     * @param {number} level 0..1 from distance, 0 for none.
     * @param {number} pan -1..1
     * @param {boolean} clear No wall in the way.
     * @param {number} [front] -1 (right behind) .. 1 (ahead). Duller from behind.
     */
    setTelevision(level, pan, clear, front = 1) {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.tvGain.gain.setTargetAtTime(t < this._tvQuietUntil ? 0 : level * 0.2, t, 0.25);
        this.tvPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)) * 0.85, t, 0.15);
        this.tvMuffle.frequency.setTargetAtTime(clear ? 2000 + 3000 * facing(front) : 650, t, 0.2);
    }

    /** TV next to the note you just took switches off. Click plus a falling whine. */
    tvOff() {
        if (!this.built || this._stopped) return;
        const context = this.context;
        const t = context.currentTime;
        this.tvGain.gain.cancelScheduledValues(t);
        this.tvGain.gain.setTargetAtTime(0, t, 0.02);
        // Short silence before the next TV fades in.
        this._tvQuietUntil = t + 2;
        this._burst(t, 0.05, 'highpass', 2500, 0.35, this.bus);
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(1400, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.25);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain).connect(this.bus);
        osc.start(t);
        osc.stop(t + 0.32);
    }

    /** Sighting sting. Static tear and a low dissonant stab. */
    sting() {
        if (!this.built || this._stopped) return;
        const context = this.context;
        const t = context.currentTime;
        this._burst(t, 0.45, 'highpass', 1500, 0.5, this.bus);
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 900;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.32, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
        filter.connect(gain).connect(this.bus);
        for (const frequency of [92, 97.5, 184]) {
            const osc = context.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(frequency, t);
            osc.frequency.exponentialRampToValueAtTime(frequency * 0.94, t + 1.2);
            osc.connect(filter);
            osc.start(t);
            osc.stop(t + 1.35);
        }
        this._burst(t + 0.02, 1.4, 'lowpass', 300, 0.4, this.ambience.reverb);
    }

    /** Drum hit for taking a note, plus reverb. */
    drum() {
        if (!this.built || this._stopped) return;
        const context = this.context;
        const t = context.currentTime;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(82, t);
        osc.frequency.exponentialRampToValueAtTime(36, t + 0.5);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.9, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        osc.connect(gain).connect(this.bus);
        osc.start(t);
        osc.stop(t + 0.85);
        this._burst(t, 0.25, 'lowpass', 220, 0.7, this.bus);
        this._burst(t + 0.03, 1.6, 'lowpass', 180, 0.5, this.ambience.reverb);
    }

    /** Caught. Wall of noise and a boom, then silence. */
    caught() {
        if (!this.built || this._stopped) return;
        const context = this.context;
        const t = context.currentTime;
        this._burst(t, 0.9, 'highpass', 400, 1, this.bus);
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(48, t);
        osc.frequency.exponentialRampToValueAtTime(28, t + 1);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.9, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
        osc.connect(gain).connect(this.bus);
        osc.start(t);
        osc.stop(t + 1.2);
        this.staticGain.gain.cancelScheduledValues(t);
        this.staticGain.gain.setValueAtTime(0.7, t);
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setValueAtTime(1, t);
        this.bus.gain.setTargetAtTime(0, t + 0.9, 0.12);
        this._stopped = true;
        this._attach(false, 2.5);
    }

    /** Escaped. The wind swells, then everything fades. */
    escaped() {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.beaconGain.gain.cancelScheduledValues(t);
        this.beaconGain.gain.setTargetAtTime(0.9, t, 0.4);
        for (const gain of [this.staticGain, this.presenceGain, this.layer1, this.layer2, this.tvGain]) {
            gain.gain.cancelScheduledValues(t);
            gain.gain.setTargetAtTime(0, t, 0.5);
        }
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(0, t + 2, 0.8);
        this._stopped = true;
        this._attach(false, 7);
    }

    _burst(t, decay, type, frequency, level, out) {
        const context = this.context;
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        source.connect(filter).connect(gain).connect(out);
        source.start(t, 0, decay + 0.05);
    }
}

/** How much high end gets through (0..1) for a sound in front (1) or behind (-1). */
function facing(front) {
    const x = Math.max(0, Math.min(1, (front + 0.6) / 0.9));
    return x * x * (3 - 2 * x);
}
