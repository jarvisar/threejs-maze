import { EYE_HEIGHT, WALL_HEIGHT } from '../config.js';
import { panelFlicker } from '../world/panelLights.js';

// Overall loudness at 100% volume. The hum should sit in the background and not get noticed.
const MASTER_LEVEL = 0.22;
const PAUSED_LEVEL = 0.4; // volume multiplier while paused
const RAMP_SECONDS = 0.6;
// Ears low-pass (Hz): normal, on the menus, underwater.
const EARS_OPEN = 20000;
const EARS_PAUSED = 1100;
const EARS_UNDER = 420;
// Seconds of play between distant sounds.
const EVENT_MIN_GAP = 35;
const EVENT_MAX_GAP = 120;
// Hum as [harmonic of 60 Hz, level]. The 120 Hz magnetostriction tone dominates the weak fundamental.
const HUM_HARMONICS = [[1, 0.12], [2, 0.3], [3, 0.06], [4, 0.12], [5, 0.02], [6, 0.06], [8, 0.035], [10, 0.02], [12, 0.012]];
// Ballast buzz and tube sizzle, from all around and from the fixtures overhead (see listenToLights).
const BUZZ_LEVEL = 0.06;
const SIZZLE_LEVEL = 0.015;
const FIXTURE_BUZZ = 0.09;
const FIXTURE_SIZZLE = 0.05;
// Failing tubes within BUZZ_RANGE are audible. Tubes within FIXTURE_RANGE are panned to where they are overhead.
const BUZZ_RANGE = 5;
const FIXTURE_RANGE = 3;
const CEILING_ABOVE_EYES = WALL_HEIGHT - EYE_HEIGHT;
// Footstep layers: heel thud, foot pat, sole scuff, and the odd squelch (the carpet is damp).
const STEP_LEVEL = 0.65;
const PAT_LEVEL = 2.2;
const SCUFF_LEVEL = 0.35;
const SQUELCH_LEVEL = 0.12;

/**
 * @typedef {object} Room A level's reverb (see levels.js), applied to anything sent to the ambience's `reverb`. That's
 *     how distant sounds are placed.
 * @property {number} seconds Tail length.
 * @property {number} decay Falloff exponent over the tail.
 * @property {number} bright How much high end gets through at the start, 0..1. Hard walls reflect more of it.
 * @property {number} dark Same at the end, so the tail gets darker.
 * @property {number} gap Pre-delay (s) so close sounds don't smear.
 * @property {number[]} [reflections] Early reflections before the tail: [count, from, to] (seconds).
 * @property {number} level Wet level.
 */

/**
 * Level 0's room, used until a level sets its own (see setRoom). Large, dull office with carpet and ceiling tiles.
 * @type {Room}
 */
const DEFAULT_ROOM = { seconds: 3, decay: 3, bright: 0.53, dark: 0.03, gap: 0.02, level: 3.5 };

/**
 * All game sound, synthesized with Web Audio (no audio files). This is the part every level shares, plus Level 0's
 * own sound: the fluorescent hum, carpet footsteps, failing tubes, zoom motor, flashlight click, edit mode sounds,
 * distant events and power cuts.
 *
 * Everything goes through the camcorder tape (drops out on picture glitches) and the ears (muffled on menus and
 * underwater). The level's room adds the reverb (see setRoom).
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
        this._humScale = 1;
        this._powerOut = false;
        this._underwater = false;
        this._hidden = false;
        this._motorSpeed = 0;
        /** @type {Room} */
        this._roomWanted = DEFAULT_ROOM;
        /** @type {{ key: string, level: GainNode, convolver: ConvolverNode } | null} */
        this._room = null;
        /** Impulse cache keyed by room JSON. @type {Map<string, AudioBuffer>} */
        this._impulses = new Map();
        /** Last lit state of each flickering panel nearby (see listenToLights). */
        this._flickerLit = new Map();
        this._fixture = { level: -1, pan: 0 };
    }

    /** Creates/resumes audio. Browsers only allow this from a user gesture (e.g. the Start click). */
    start() {
        const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!this.context) {
            const context = new AudioContextClass();
            this.context = context;
            // master -> tape (drops out on glitches) -> ears -> output (volume).
            this.master = context.createGain();
            this.tape = context.createGain();
            this.ears = context.createBiquadFilter();
            this.ears.type = 'lowpass';
            this.ears.Q.value = -3;
            this.ears.frequency.value = this._earsFrequency();
            this.output = context.createGain();
            this.output.gain.value = 0;
            this.master.connect(this.tape).connect(this.ears).connect(this.output).connect(context.destination);
            // Sounds inside your head (like the underwater rumble) skip the ears filter.
            this.inner = context.createGain();
            this.inner.connect(this.output);

            // Everything that dies in a power cut, like the light hum. Detached on levels with their own sound.
            this.mains = context.createGain();
            this.mains.gain.value = this._mainsLevel();
            this._attachMains = detachable(this.mains, [this.master]);
            this._attachMains(this._humScale > 0);
            this.hum = context.createGain();
            this.hum.gain.value = this._humLevel();
            this.hum.connect(this.mains);
            this.fixture = context.createGain();
            this.fixture.gain.value = 0;
            this.fixturePan = context.createStereoPanner();
            this.fixture.connect(this.fixturePan).connect(this.mains);
            this.noise = createNoiseBuffer(context, 3);
            buildHum(context, this.hum, this.fixture, this.noise);

            this.effects = context.createGain();
            this.effects.connect(this.master);
            // Sounds sent here get the level's reverb so they seem far off.
            this.reverb = context.createGain();
            this.setRoom(this._roomWanted);
        }
        if (this.context.state === 'suspended' && !this._hidden) this.context.resume().catch(() => {});
        this._applyLevel();
    }

    /** Started, but the browser won't play until the next click or key press. */
    get blocked() {
        return this.context?.state === 'suspended' && !this._hidden;
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

    /** Paused or on the title screen: quieter and muffled. */
    setPaused(paused) {
        this.paused = paused;
        this._applyLevel();
        this._applyEars(0.15);
        if (paused) this.setZoomMotor(0);
    }

    /**
     * Suspends the context while the page is hidden (other tab, minimized).
     * @param {boolean} hidden
     */
    setHidden(hidden) {
        this._hidden = hidden;
        const context = this.context;
        if (!context) return;
        if (hidden && context.state === 'running') context.suspend().catch(() => {});
        else if (!hidden && context.state === 'suspended') context.resume().catch(() => {});
    }

    /** Muffles everything while the ears are underwater (Level 37). @param {boolean} under */
    setUnderwater(under) {
        if (under === this._underwater) return;
        this._underwater = under;
        this._applyEars(0.12);
    }

    /**
     * Sets the level's reverb (see levels.js). Crossfades from the old one.
     * @param {Room} [room]
     */
    setRoom(room = DEFAULT_ROOM) {
        this._roomWanted = room;
        const context = this.context;
        const key = JSON.stringify(room);
        if (!context || this._room?.key === key) return;
        const t = context.currentTime;
        let impulse = this._impulses.get(key);
        if (!impulse) {
            impulse = createRoomImpulse(context, room);
            this._impulses.set(key, impulse);
        }
        const convolver = context.createConvolver();
        convolver.buffer = impulse;
        const level = context.createGain();
        const old = this._room;
        level.gain.value = old ? 0 : room.level;
        this.reverb.connect(convolver).connect(level).connect(this.master);
        if (old) {
            level.gain.setTargetAtTime(room.level, t, 0.3);
            old.level.gain.setTargetAtTime(0, t, 0.3);
            // Remove once its tail has died out.
            setTimeout(() => {
                this.reverb.disconnect(old.convolver);
                old.level.disconnect();
            }, 2500);
        }
        this._room = { key, level, convolver };
    }

    /** The hum comes from the lights, so it fades where they're dead. @param {number} level 0..1 */
    setAreaLight(level) {
        if (!this.context || Math.abs(level - this._areaLight) < 0.01) return;
        this._areaLight = level;
        this.hum.gain.setTargetAtTime(this._humLevel(), this.context.currentTime, 0.5);
    }

    /**
     * Scales Level 0's hum and power sounds. Levels with their own sound turn it off and use their own hum.
     * @param {number} scale 0..1
     */
    setHumScale(scale) {
        if (scale === this._humScale) return;
        this._humScale = scale;
        if (!this.context) return;
        this.mains.gain.setTargetAtTime(this._mainsLevel(), this.context.currentTime, 0.4);
        this._attachMains(scale > 0, 2.5);
    }

    /**
     * Call every frame while playing. Pans the buzz of the tubes overhead (stuttering as they flicker) and plays a
     * buzz when a nearby failing tube comes back on.
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @param {number} x
     * @param {number} z
     * @param {number} yaw Listener facing.
     * @param {number} time Lighting clock the flicker runs on (see Lighting).
     * @param {number} power 0..1
     */
    listenToLights(store, x, z, yaw, time, power) {
        if (!this.context) return;
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const strikes = this.ambienceEnabled && power > 0.5;
        // Levels with their own hum skip the overhead buzz.
        const overhead = this._humScale > 0;
        let sum = 0;
        let side = 0;
        const firstX = Math.floor((x - BUZZ_RANGE - 1) / 2) * 2 + 1;
        const firstZ = Math.floor((z - BUZZ_RANGE - 1) / 2) * 2 + 1;
        for (let px = firstX; px <= x + BUZZ_RANGE; px += 2) {
            for (let pz = firstZ; pz <= z + BUZZ_RANGE; pz += 2) {
                const data = store.panelData(px, pz);
                const offset = store.panelOffset(px, pz);
                const brightness = data[offset];
                if (brightness === 0) continue;
                const pattern = data[offset + 2];
                const lit = panelFlicker(pattern, time) === 1;
                const distance = Math.hypot(px - x, pz - z, CEILING_ABOVE_EYES);
                const right = ((px - x) * rightX + (pz - z) * rightZ) / distance;
                if (overhead && lit && distance < FIXTURE_RANGE) {
                    const weight = (brightness / 255) * (CEILING_ABOVE_EYES / distance) ** 2 * (1 - distance / FIXTURE_RANGE);
                    sum += weight;
                    side += weight * right;
                }
                if (pattern === 0) continue;
                const key = px * 1048576 + pz;
                const wasLit = this._flickerLit.get(key) ?? true;
                this._flickerLit.set(key, lit);
                if (strikes && lit && !wasLit && distance <= BUZZ_RANGE) this.buzz((1 - distance / BUZZ_RANGE) ** 2, right);
            }
        }
        if (this._flickerLit.size > 400) this._flickerLit.clear();
        if (overhead) this._setFixture(Math.min(sum, 1.5), sum > 0 ? side / sum : 0);
    }

    /** Clears flicker state when the world changes. */
    forgetLights() {
        this._flickerLit.clear();
    }

    /** Hum cuts out right away with a heavy relay clunk. */
    powerCut() {
        if (!this.context) return;
        this._powerOut = true;
        const context = this.context;
        const t = context.currentTime;
        this.mains.gain.cancelScheduledValues(t);
        this.mains.gain.setTargetAtTime(this._mainsLevel(), t, 0.04);
        // Levels with their own sound do their own relay (see LevelAudio).
        if (this.paused || !this.ambienceEnabled || this._humScale === 0) return;
        const near = this._panned(randomBetween(-0.3, 0.3), this.effects);
        this._noiseBurst(t, 0.55, 'lowpass', 90, 1, near);
        this._noiseBurst(t, 0.03, 'highpass', 2500, 0.35, near);
        // Echo through the building.
        this._noiseBurst(t + 0.05, 1.4, 'lowpass', 160, 0.6, this._panned(randomBetween(-0.6, 0.6), this.reverb));
    }

    /**
     * Tubes trying to strike as the power comes back. The hum blips and a few tubes buzz.
     * @param {number} level 0..1
     */
    powerFlash(level) {
        if (!this.context || this.paused) return;
        const t = this.context.currentTime;
        this.mains.gain.cancelScheduledValues(t);
        this.mains.gain.setTargetAtTime(this._humScale * 0.7, t, 0.01);
        this.mains.gain.setTargetAtTime(this._mainsLevel(), t + 0.07, 0.03);
        const count = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) this.buzz(level * randomBetween(0.3, 0.7), randomBetween(-0.9, 0.9));
    }

    /** Hum fades back in. */
    powerRestored() {
        if (!this.context) return;
        this._powerOut = false;
        const t = this.context.currentTime;
        this.mains.gain.cancelScheduledValues(t);
        this.mains.gain.setTargetAtTime(this._mainsLevel(), t, 0.25);
    }

    _humLevel() {
        return 0.15 + 0.85 * this._areaLight;
    }

    _mainsLevel() {
        return this._humScale * (this._powerOut ? 0.02 : 1);
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
     * Footstep on damp carpet. Muffled thump, then the sole scuffing the pile.
     * @param {number} weight How hard the foot lands (0..1.5, higher when sprinting).
     */
    footstep(weight) {
        if (!this.context || this.paused || !this.footstepsEnabled || weight < 0.05) return;
        this._footLeft = !this._footLeft;
        const t = this.context.currentTime;
        const heavy = Math.min(weight, 1.5);
        const level = heavy * STEP_LEVEL;
        const out = this._panned(this._footLeft ? -0.08 : 0.08, this.effects);
        this._thump(t, 95, 48, 0.12, level * 0.6, out);
        this._noiseBurst(t, 0.12, 'lowpass', randomBetween(750, 1000), level * PAT_LEVEL, out);
        // Longer, harder scuff when running.
        const scuff = t + randomBetween(0.035, 0.06);
        this._noiseBurst(scuff, 0.06 + 0.05 * heavy, 'bandpass', randomBetween(1600, 2400) * (0.9 + 0.15 * heavy), level * SCUFF_LEVEL, out, 0.9);
        if (Math.random() < 0.3) this._squelch(t + randomBetween(0.015, 0.03), level * SQUELCH_LEVEL, out);
    }

    /**
     * Buzz and tick of a fluorescent tube flickering back on.
     * @param {number} level 0..1, from distance.
     * @param {number} pan -1..1
     * @param {boolean} [far] Send through the reverb so it sounds distant.
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
     * Zoom motor whirr while zooming.
     * @param {number} speed 0 (still) .. 1 (full speed)
     */
    setZoomMotor(speed) {
        speed = Math.min(Math.max(speed, 0), 1);
        if (!this.context || speed === this._motorSpeed) return;
        this._motorSpeed = speed;
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
            this._attachMotor = detachable(this.motor, [this.effects]);
            source.start();
            whine.start();
        }
        this.motor.gain.setTargetAtTime(speed * 0.22, this.context.currentTime, 0.04);
        // Detach once it's quiet.
        this._attachMotor(speed > 0, 0.4);
    }

    /** Flashlight switch click, a bit higher for on. @param {boolean} on */
    click(on) {
        if (!this.context || this.paused) return;
        const t = this.context.currentTime;
        const pitch = on ? 1 : 0.84;
        const out = this._panned(0.2, this.effects);
        this._noiseBurst(t, 0.01, 'highpass', 3200 * pitch, 0.3, out);
        this._noiseBurst(t, 0.03, 'bandpass', 2300 * pitch, 0.22, out, 7);
        this._thump(t, 260 * pitch, 140, 0.04, 0.12, out);
    }

    /**
     * Edit mode build or remove sound, panned to where it happened. More reverb the farther it is.
     * @param {boolean} build
     * @param {number} pan -1..1
     * @param {number} distance In cells.
     */
    edit(build, pan, distance) {
        if (!this.context || this.paused) return;
        const context = this.context;
        const t = context.currentTime;
        const near = 1 / (1 + 0.35 * distance);
        const out = context.createGain();
        const dry = context.createGain();
        dry.gain.value = near;
        out.connect(dry).connect(this._panned(pan * Math.min(distance, 1) * 0.8, this.effects));
        const wet = context.createGain();
        wet.gain.value = 0.08 + 0.2 * (1 - near);
        out.connect(wet).connect(this._panned(pan, this.reverb));
        if (build) {
            // Build: heavy thud plus the knock of an edge.
            this._noiseBurst(t, 0.25, 'lowpass', 380, 0.8, out);
            this._thump(t, 120, 55, 0.22, 0.6, out);
            this._noiseBurst(t + 0.008, 0.05, 'bandpass', 900, 0.3, out, 1.5);
            return;
        }
        // Remove: duller thud, then debris falling.
        this._noiseBurst(t, 0.35, 'lowpass', 260, 0.8, out);
        this._thump(t, 90, 40, 0.3, 0.55, out);
        const bits = 4 + Math.floor(Math.random() * 5);
        for (let i = 0; i < bits; i++) {
            const at = randomBetween(0.04, 0.5);
            this._noiseBurst(t + at, randomBetween(0.02, 0.05), 'bandpass', randomBetween(1200, 3500), 0.14 * (1 - at), out, 2);
        }
    }

    /**
     * Tape tracking glitch that matches the picture (see PostProcessing.glitch). Dropouts and crackle.
     * @param {number} strength 0..1
     * @param {number} seconds Time to settle.
     */
    glitch(strength, seconds) {
        if (!this.context || strength < 0.05) return;
        const t = this.context.currentTime;
        const gain = this.tape.gain;
        let at = t;
        const dropouts = 1 + Math.round(strength * 2 + Math.random() * 0.8);
        for (let i = 0; i < dropouts; i++) {
            const length = randomBetween(0.02, 0.06);
            gain.setTargetAtTime(1 - 0.5 * strength * randomBetween(0.6, 1), at, 0.004);
            gain.setTargetAtTime(1, at + length, 0.012);
            at += length + randomBetween(0.04, 0.15) * seconds;
        }
        const bursts = 2 + Math.round(strength * 4);
        for (let i = 0; i < bursts; i++) {
            const when = Math.random() * seconds * 0.5;
            this._noiseBurst(t + when, randomBetween(0.02, 0.08), 'highpass', randomBetween(1500, 3500), 0.2 * strength * (1 - when / seconds), this.master);
        }
    }

    _applyLevel() {
        if (!this.context) return;
        const level = this.muted ? 0 : this.volume * this.volume * MASTER_LEVEL * (this.paused ? PAUSED_LEVEL : 1);
        const now = this.context.currentTime;
        this.output.gain.cancelScheduledValues(now);
        this.output.gain.setTargetAtTime(level, now, RAMP_SECONDS / 3);
    }

    _earsFrequency() {
        const open = Math.min(EARS_OPEN, (this.context?.sampleRate ?? 44100) * 0.45);
        return Math.min(this.paused ? EARS_PAUSED : open, this._underwater ? EARS_UNDER : open);
    }

    _applyEars(timeConstant) {
        if (!this.context) return;
        const t = this.context.currentTime;
        this.ears.frequency.cancelScheduledValues(t);
        this.ears.frequency.setTargetAtTime(this._earsFrequency(), t, timeConstant);
    }

    /** Level and pan for the overhead tube buzz. */
    _setFixture(level, pan) {
        const fixture = this._fixture;
        const t = this.context.currentTime;
        if (Math.abs(level - fixture.level) > 0.01) {
            fixture.level = level;
            // Fast enough to stutter with a flickering tube.
            this.fixture.gain.setTargetAtTime(level, t, 0.015);
        }
        if (Math.abs(pan - fixture.pan) > 0.02) {
            fixture.pan = pan;
            this.fixturePan.pan.setTargetAtTime(pan * 0.8, t, 0.1);
        }
    }

    // ------------------------------------------------------------------ building blocks

    _panned(pan, destination) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        panner.connect(destination);
        return panner;
    }

    /** Filtered noise burst, sharp attack and exponential tail. */
    _noiseBurst(t, decay, type, frequency, level, out, q = 0.8) {
        const context = this.context;
        const source = context.createBufferSource();
        source.buffer = this.noise;
        source.playbackRate.value = randomBetween(0.85, 1.15);
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = q;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        source.connect(filter).connect(gain).connect(out);
        source.start(t, Math.random() * Math.max(2.8 - decay, 0), decay + 0.05);
    }

    /** Low sine thump that drops in pitch. */
    _thump(t, from, to, decay, level, out) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(to, t + decay * 0.75);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.03);
    }

    /** Foot pat plus a short low heel thud. */
    _step(t, level, brightness, out) {
        this._noiseBurst(t, 0.14, 'lowpass', brightness * randomBetween(0.8, 1.2), level, out);
        this._thump(t, 95, 48, 0.12, level * 0.6, out);
    }

    /** Wet carpet squelch. Band-passed noise that sweeps up and back down. */
    _squelch(t, level, out) {
        const context = this.context;
        const source = context.createBufferSource();
        source.buffer = this.noise;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 4;
        const low = randomBetween(500, 700);
        filter.frequency.setValueAtTime(low, t);
        filter.frequency.exponentialRampToValueAtTime(low * randomBetween(2, 2.6), t + 0.035);
        filter.frequency.exponentialRampToValueAtTime(low * 1.3, t + 0.09);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        source.connect(filter).connect(gain).connect(out);
        source.start(t, Math.random() * 2.5, 0.12);
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

    /** Someone else walking away in the distance. */
    _distantSteps() {
        const t = this.context.currentTime;
        const out = this._panned(randomBetween(-0.9, 0.9), this.reverb);
        const count = 5 + Math.floor(Math.random() * 5);
        const pace = randomBetween(0.5, 0.62);
        for (let i = 0; i < count; i++) this._step(t + i * pace, 0.45 * (1 - i / (count + 2)), 380, out);
    }
}

/**
 * Light hum from all around into `hum`, plus a second copy of the buzz and sizzle into `overhead` for the fixtures
 * above (see listenToLights).
 * @param {BaseAudioContext} context
 * @param {AudioNode} hum
 * @param {AudioNode} overhead
 * @param {AudioBuffer} noise
 */
function buildHum(context, hum, overhead, noise) {
    const bus = context.createGain();
    bus.gain.value = 0.8;
    bus.connect(hum);

    // Mains hum: one oscillator carries every harmonic.
    const size = HUM_HARMONICS[HUM_HARMONICS.length - 1][0] + 1;
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    for (const [harmonic, level] of HUM_HARMONICS) imag[harmonic] = level;
    const mains = context.createOscillator();
    mains.setPeriodicWave(context.createPeriodicWave(real, imag, { disableNormalization: true }));
    mains.frequency.value = 60;
    mains.connect(bus);
    mains.start();

    // Ballast buzz. 120 Hz sawtooth filtered to its middle harmonics so small speakers can play it.
    const buzz = context.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 120;
    const buzzFilter = context.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 1100;
    buzzFilter.Q.value = 0.5;
    buzz.connect(buzzFilter);
    buzz.start();

    // Tube sizzle. Hiss chopped at 120 Hz so it buzzes instead of hissing.
    const sizzleSource = context.createBufferSource();
    sizzleSource.buffer = noise;
    sizzleSource.loop = true;
    const sizzleFilter = context.createBiquadFilter();
    sizzleFilter.type = 'bandpass';
    sizzleFilter.frequency.value = 3200;
    sizzleFilter.Q.value = 0.9;
    const chop = context.createGain();
    chop.gain.value = 0.5;
    const chopper = context.createOscillator();
    chopper.frequency.value = 120;
    const chopDepth = context.createGain();
    chopDepth.gain.value = 0.5;
    chopper.connect(chopDepth).connect(chop.gain);
    sizzleSource.connect(sizzleFilter).connect(chop);
    sizzleSource.start(0, Math.random() * noise.duration);
    chopper.start();

    for (const [source, level, out] of [[buzzFilter, BUZZ_LEVEL, bus], [chop, SIZZLE_LEVEL, bus], [buzzFilter, FIXTURE_BUZZ, overhead], [chop, FIXTURE_SIZZLE, overhead]]) {
        const gain = context.createGain();
        gain.gain.value = level;
        source.connect(gain).connect(out);
    }

    // Faint electrical hiss.
    const hiss = context.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const hissFilter = context.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 5000;
    hissFilter.Q.value = 0.7;
    const hissGain = context.createGain();
    hissGain.gain.value = 0.02;
    hiss.connect(hissFilter).connect(hissGain).connect(bus);
    hiss.start(0, Math.random() * noise.duration);

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
 * Impulse response for a Room. Decaying stereo noise after a short gap, with a one-pole low-pass that closes over time
 * so the tail gets darker. Early reflections are added as spikes.
 * @param {BaseAudioContext} context
 * @param {Room} room
 */
function createRoomImpulse(context, room) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * room.seconds);
    const gap = Math.floor(rate * room.gap);
    const fade = Math.floor(rate * 0.01);
    const buffer = context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let smoothed = 0;
        for (let i = 0; i < length; i++) {
            const t = i / length;
            smoothed += (room.bright + (room.dark - room.bright) * t) * (Math.random() * 2 - 1 - smoothed);
            data[i] = i < gap ? 0 : smoothed * (1 - t) ** room.decay * Math.min((i - gap) / fade, 1);
        }
        const [count, from, to] = room.reflections ?? [0, 0, 0];
        for (let r = 0; r < count; r++) data[Math.floor(rate * randomBetween(from, to))] += (Math.random() < 0.5 ? -1 : 1) * randomBetween(0.3, 0.7);
    }
    return buffer;
}

/**
 * Connects `node` to `destinations` only while wanted. After `fade` seconds unwanted (long enough to go quiet) it's
 * disconnected. Browsers only process nodes that reach the speakers, so everything feeding it stops costing CPU.
 * Reconnects right away when wanted again.
 * @param {AudioNode} node
 * @param {AudioNode[]} destinations
 * @returns {(wanted: boolean, fade?: number) => void}
 */
export function detachable(node, destinations) {
    let wanted = false;
    let attached = false;
    let timer;
    return (on, fade = 1.5) => {
        if (on === wanted) return;
        wanted = on;
        clearTimeout(timer);
        if (on) {
            if (!attached) for (const destination of destinations) node.connect(destination);
            attached = true;
            return;
        }
        timer = setTimeout(() => {
            if (wanted || !attached) return;
            node.disconnect();
            attached = false;
        }, fade * 1000);
    };
}

/** Random number in [min, max). */
export function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}
