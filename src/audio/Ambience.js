// Overall loudness at 100% volume. The hum is meant to sit in the background, not to be noticed.
const MASTER_LEVEL = 0.22;
// How much quieter it gets while the game is paused.
const PAUSED_LEVEL = 0.4;
const RAMP_SECONDS = 0.6;

/**
 * The fluorescent-light hum of the Backrooms, synthesised with the Web Audio API (no audio files):
 * mains hum (60 Hz and harmonics), a filtered ballast buzz, and a faint electrical hiss, all drifting slowly.
 */
export class Ambience {
    constructor() {
        /** @type {AudioContext | null} */
        this.context = null;
        this.master = null;
        this.volume = 0.5;
        this.muted = false;
        this.paused = true;
    }

    /** Creates/resumes audio. Browsers only allow this from a user gesture (e.g. the Start click). */
    start() {
        const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!this.context) {
            this.context = new AudioContextClass();
            this.master = this.context.createGain();
            this.master.gain.value = 0;
            this.master.connect(this.context.destination);
            buildHum(this.context, this.master);
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
    }

    _applyLevel() {
        if (!this.context) return;
        const level = this.muted ? 0 : this.volume * this.volume * MASTER_LEVEL * (this.paused ? PAUSED_LEVEL : 1);
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(level, now, RAMP_SECONDS / 3);
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
