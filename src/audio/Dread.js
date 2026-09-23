/*
 * The sound of Found Footage, on top of the usual ambience: static that rises as the tape goes, a presence
 * from wherever it's standing, a sting when you catch sight of it, music that builds a layer at a time with
 * the notes (Slender's trick: the drone, then the beat, then the whine, so the place sounds more wrong the
 * further in you are), the nearest TV that's been left on, a drum when you take a note, breathing when
 * you're spent, the way out calling, and the end.
 *
 * Everything is synthesised from the ambience's audio context; nothing is loaded.
 */

const HEARTBEAT_FAST = 0.55;
const HEARTBEAT_SLOW = 1.05;
const BREATH_INTERVAL = 1.35;

export class Dread {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        this.ambience = ambience;
        this.built = false;
        this._static = 0;
        this._layers = 0;
        this._beat = 0;
        this._breathing = false;
        this._breath = 0;
        this._stopped = true;
        this._tvQuietUntil = 0;
    }

    /** Makes the sounds, once the ambience has an audio context (it needs a click first). */
    _build() {
        const context = this.ambience.context;
        if (this.built || !context) return false;
        this.built = true;
        this.context = context;
        const noise = this.ambience.noise;

        this.bus = context.createGain();
        this.bus.gain.value = 0;
        this.bus.connect(this.ambience.master);

        // Static: broadband hiss that the tape gives off as it goes.
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

        // Presence: a sub-bass drone with a beat between two detuned tones, and a slow, breathy murmur over it
        // (which is what small speakers can play, and what tells you which side it's on).
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

        // Layer one: a slow, swelling low tone.
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

        // Layer two is the heartbeat (scheduled in update). Layer three: a thin, dissonant whine.
        this.layer2 = context.createGain();
        this.layer2.gain.value = 0;
        this.layer2.connect(this.bus);
        this.layer3 = context.createGain();
        this.layer3.gain.value = 0;
        this.layer3.connect(this.bus);
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
            tremolo.connect(this.layer3);
            lfo.start();
        }

        // The way out: a low wind from wherever it is.
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
        wind.connect(windFilter).connect(gust).connect(this.beaconPan).connect(this.beaconGain).connect(this.bus);
        wind.start();
        gustLfo.start();

        // A TV left on: the hiss of a dead channel and the hum of the set, from wherever the nearest one is,
        // muffled when there's a wall in the way.
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

        // Breathing: shaped noise, pulsed in update.
        const breath = context.createBufferSource();
        breath.buffer = noise;
        breath.loop = true;
        const breathFilter = context.createBiquadFilter();
        breathFilter.type = 'bandpass';
        breathFilter.frequency.value = 700;
        breathFilter.Q.value = 1.2;
        this.breathGain = context.createGain();
        this.breathGain.gain.value = 0;
        breath.connect(breathFilter).connect(this.breathGain).connect(this.bus);
        breath.start();
        return true;
    }

    /** A new run: everything back to silence, then in. */
    start() {
        if (!this._build() && !this.built) return;
        this._stopped = false;
        this._static = 0;
        this._layers = 0;
        this._breathing = false;
        const t = this.context.currentTime;
        this._tvQuietUntil = 0;
        for (const gain of [this.staticGain, this.presenceGain, this.layer1, this.layer2, this.layer3, this.beaconGain, this.breathGain, this.tvGain]) {
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(0, t);
        }
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setValueAtTime(0, t);
        this.bus.gain.setTargetAtTime(1, t, 0.5);
    }

    /** Fades everything out (the run is over, or the mode was left). */
    stop() {
        if (!this.built || this._stopped) return;
        this._stopped = true;
        const t = this.context.currentTime;
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(0, t, 0.4);
    }

    /** How far gone the tape is, 0..1. */
    setStatic(level) {
        if (!this.built || this._stopped) return;
        if (Math.abs(level - this._static) < 0.01) return;
        this._static = level;
        this.staticGain.gain.setTargetAtTime(level ** 1.6 * 0.55, this.context.currentTime, 0.05);
    }

    /**
     * How near it is, and which side.
     * @param {number} level 0..1 (0 when it isn't there).
     * @param {number} pan -1..1
     */
    setPresence(level, pan) {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.presenceGain.gain.setTargetAtTime(level * 0.26, t, 0.3);
        this.presencePan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)) * 0.8, t, 0.2);
    }

    /** Brings in the layers of the music for how many notes have been taken. */
    setLayers(notes) {
        if (!this.built || this._stopped || notes === this._layers) return;
        this._layers = notes;
        const t = this.context.currentTime;
        this.layer1.gain.setTargetAtTime(notes >= 1 ? 0.11 : 0, t, 2);
        this.layer2.gain.setTargetAtTime(notes >= 3 ? 1 : 0, t, 2);
        this.layer3.gain.setTargetAtTime(notes >= 6 ? 0.02 : 0, t, 3);
    }

    /**
     * The wind from the way out.
     * @param {number} level 0..1
     * @param {number} pan -1..1
     */
    setBeacon(level, pan) {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.beaconGain.gain.setTargetAtTime(level * 0.5, t, 0.3);
        this.beaconPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.2);
    }

    /**
     * The nearest TV that's still on.
     * @param {number} level 0..1 (by distance; 0 for none).
     * @param {number} pan -1..1
     * @param {boolean} clear Nothing in the way.
     */
    setTelevision(level, pan, clear) {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.tvGain.gain.setTargetAtTime(t < this._tvQuietUntil ? 0 : level * 0.2, t, 0.25);
        this.tvPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.15);
        this.tvMuffle.frequency.setTargetAtTime(clear ? 5000 : 650, t, 0.2);
    }

    /** The TV by the note you've just taken goes off: a click, and the whine of the picture dropping away. */
    tvOff() {
        if (!this.built || this._stopped) return;
        const context = this.context;
        const t = context.currentTime;
        this.tvGain.gain.cancelScheduledValues(t);
        this.tvGain.gain.setTargetAtTime(0, t, 0.02);
        // A moment's quiet before the next one is heard.
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

    /** You've caught sight of it: a tear of static and a low, sour stab. */
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

    setBreathing(on) {
        this._breathing = on;
    }

    /** The drum that goes with taking a note: a deep hit, and the room's answer. */
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

    /** It has you: a wall of noise, a boom, and then nothing. */
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
    }

    /** You got out: the wind takes over, then everything fades. */
    escaped() {
        if (!this.built || this._stopped) return;
        const t = this.context.currentTime;
        this.beaconGain.gain.cancelScheduledValues(t);
        this.beaconGain.gain.setTargetAtTime(0.9, t, 0.4);
        for (const gain of [this.staticGain, this.presenceGain, this.layer1, this.layer2, this.layer3, this.tvGain]) {
            gain.gain.cancelScheduledValues(t);
            gain.gain.setTargetAtTime(0, t, 0.5);
        }
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(0, t + 2, 0.8);
        this._stopped = true;
    }

    /** Keeps the heartbeat and the breathing going. @param {number} dt */
    update(dt) {
        if (!this.built || this._stopped || this.ambience.paused) return;
        const t = this.context.currentTime;
        if (this._layers >= 4) {
            this._beat -= dt;
            if (this._beat <= 0) {
                // Faster the worse the tape is.
                this._beat = HEARTBEAT_SLOW + (HEARTBEAT_FAST - HEARTBEAT_SLOW) * this._static;
                this._thump(t);
                this._thump(t + 0.17, 0.7);
            }
        }
        if (this._breathing) {
            this._breath -= dt;
            if (this._breath <= 0) {
                this._breath = BREATH_INTERVAL;
                const g = this.breathGain.gain;
                g.cancelScheduledValues(t);
                g.setValueAtTime(0, t);
                g.linearRampToValueAtTime(0.14, t + 0.35);
                g.linearRampToValueAtTime(0.02, t + 0.6);
                g.linearRampToValueAtTime(0.1, t + 0.85);
                g.linearRampToValueAtTime(0, t + 1.2);
            }
        }
    }

    _thump(t, level = 1) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(58, t);
        osc.frequency.exponentialRampToValueAtTime(34, t + 0.12);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.35 * level, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(gain).connect(this.layer2);
        osc.start(t);
        osc.stop(t + 0.2);
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
