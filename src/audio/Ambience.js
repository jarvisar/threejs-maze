import { EYE_HEIGHT, WALL_HEIGHT } from '../config.js';
import { panelFlicker } from '../world/panelLights.js';

// Overall loudness at 100% volume. The hum is meant to sit in the background, not to be noticed.
const MASTER_LEVEL = 0.22;
// How much quieter it gets while the game is paused.
const PAUSED_LEVEL = 0.4;
const RAMP_SECONDS = 0.6;
// What the ears let through, as a low-pass in Hz: everything; on the menus, as if from the next room; under water.
const EARS_OPEN = 20000;
const EARS_PAUSED = 1100;
const EARS_UNDER = 420;
// Seconds of play between distant sounds.
const EVENT_MIN_GAP = 35;
const EVENT_MAX_GAP = 120;
// The hum, as [harmonic of 60 Hz, level]: the 120 Hz magnetostriction tone dominates the weak fundamental.
const HUM_HARMONICS = [[1, 0.12], [2, 0.3], [3, 0.06], [4, 0.12], [5, 0.02], [6, 0.06], [8, 0.035], [10, 0.02], [12, 0.012]];
// The ballast's buzz and the tubes' sizzle, as heard from all round, and from the ones overhead (see listenToLights).
const BUZZ_LEVEL = 0.06;
const SIZZLE_LEVEL = 0.015;
const FIXTURE_BUZZ = 0.09;
const FIXTURE_SIZZLE = 0.05;
// Failing tubes within this distance are loud enough to hear buzzing; the ones within FIXTURE_RANGE are heard where
// they are, overhead.
const BUZZ_RANGE = 5;
const FIXTURE_RANGE = 3;
const CEILING_ABOVE_EYES = WALL_HEIGHT - EYE_HEIGHT;
// Footsteps on the carpet: the heel's thud, the foot patting down, the sole brushing the pile after it, and the odd
// squelch (it's damp).
const STEP_LEVEL = 0.65;
const PAT_LEVEL = 2.2;
const SCUFF_LEVEL = 0.35;
const SQUELCH_LEVEL = 0.12;

/**
 * @typedef {object} Room How a level sounds (see levels.js): the echo of anything sent to the ambience's `reverb`, which
 *     is how far-off things are heard.
 * @property {number} seconds How long the echo goes on.
 * @property {number} decay How quickly it dies away over that (the power it falls off by).
 * @property {number} bright How much of the top gets through at the start, 0..1 (hard walls give it back)...
 * @property {number} dark ...and at the end: every echo is darker than the last.
 * @property {number} gap Seconds before it comes back, so close sounds don't smear.
 * @property {number[]} [reflections] The first few reflections, coming back clear off the nearest walls before it all
 *     smears into the tail: [how many, from, to] (seconds).
 * @property {number} level How loud it comes back.
 */

/**
 * The room until a level says otherwise (see setRoom): a large, dull office, all carpet and ceiling tiles (Level 0's).
 * @type {Room}
 */
const DEFAULT_ROOM = { seconds: 3, decay: 3, bright: 0.53, dark: 0.03, gap: 0.02, level: 3.5 };

/**
 * Everything you hear, synthesised with the Web Audio API (no audio files). This is the part every level shares, and
 * Level 0's own sound:
 *
 * - the way it all reaches you: through the camcorder's tape, which drops out when the picture glitches, and the ears,
 *   muffled on the menus and under water, with the level's room giving back the echo (see setRoom);
 * - the fluorescent-light hum: mains hum (60 Hz and harmonics), the ballasts' buzz, the tubes' sizzle and a faint
 *   electrical hiss, drifting slowly and fading where the lights have died, and louder under the tubes overhead;
 * - footsteps on damp carpet;
 * - the buzz of a failing tube coming back on;
 * - the camcorder's zoom motor, and the flashlight's switch;
 * - edit mode putting things up and knocking them down;
 * - now and then, something in the distance;
 * - the power going: a clunk, the hum dying, and the tubes striking as it comes back.
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
        /** Each room's echo, once made, by its description. @type {Map<string, AudioBuffer>} */
        this._impulses = new Map();
        /** Whether each flickering panel near the listener was lit last time (see listenToLights). */
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
            // Everything is mixed into `master`, then goes through the tape (which drops out when the picture glitches)
            // and the ears, to the volume.
            this.master = context.createGain();
            this.tape = context.createGain();
            this.ears = context.createBiquadFilter();
            this.ears.type = 'lowpass';
            this.ears.Q.value = -3;
            this.ears.frequency.value = this._earsFrequency();
            this.output = context.createGain();
            this.output.gain.value = 0;
            this.master.connect(this.tape).connect(this.ears).connect(this.output).connect(context.destination);
            // Sounds from inside your own head (under the water, the rumble of it in your ears): past the ears.
            this.inner = context.createGain();
            this.inner.connect(this.output);

            // The power: the lights' hum, and anything else that goes with them in a power cut. On a level with a
            // sound of its own, it's taken off altogether.
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
            // Sounds sent here seem to come from far off, down some other corridor: the level's room gives them back.
            this.reverb = context.createGain();
            this.setRoom(this._roomWanted);
        }
        if (this.context.state === 'suspended' && !this._hidden) this.context.resume().catch(() => {});
        this._applyLevel();
    }

    /** Started, but the browser is holding the sound back until the next click or key press. */
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

    /** Paused (or on the title screen): quieter, and muffled, as if from the next room. */
    setPaused(paused) {
        this.paused = paused;
        this._applyLevel();
        this._applyEars(0.15);
        if (paused) this.setZoomMotor(0);
    }

    /**
     * The page out of sight (another tab, the window minimised): no sound at all, and nothing running, until it's back.
     * @param {boolean} hidden
     */
    setHidden(hidden) {
        this._hidden = hidden;
        const context = this.context;
        if (!context) return;
        if (hidden && context.state === 'running') context.suspend().catch(() => {});
        else if (!hidden && context.state === 'suspended') context.resume().catch(() => {});
    }

    /** With the ears under the water (Level 37), everything goes dull. @param {boolean} under */
    setUnderwater(under) {
        if (under === this._underwater) return;
        this._underwater = under;
        this._applyEars(0.12);
    }

    /**
     * The room the level's in (see levels.js): the echo that comes back from anything sent to `reverb`. The old one
     * fades as the new one comes in.
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
            // Gone once it's died away.
            setTimeout(() => {
                this.reverb.disconnect(old.convolver);
                old.level.disconnect();
            }, 2500);
        }
        this._room = { key, level, convolver };
    }

    /** The hum comes from the lights, so it fades where they've died. @param {number} level 0..1 */
    setAreaLight(level) {
        if (!this.context || Math.abs(level - this._areaLight) < 0.01) return;
        this._areaLight = level;
        this.hum.gain.setTargetAtTime(this._humLevel(), this.context.currentTime, 0.5);
    }

    /**
     * Turns the hum, and the rest of Level 0's power, down (a level with its own sound has lights, and a hum, of its own).
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
     * The lights round the listener, every frame while playing: the buzz of the tubes overhead, from where they are
     * (stuttering as they flicker), and a failing one close by buzzing every time it comes back on.
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     * @param {number} x
     * @param {number} z
     * @param {number} yaw Which way the listener faces.
     * @param {number} time The lights' clock (see Lighting), which the flickering goes by.
     * @param {number} power How much of the power's on, 0..1.
     */
    listenToLights(store, x, z, yaw, time, power) {
        if (!this.context) return;
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const strikes = this.ambienceEnabled && power > 0.5;
        // (Nobody hears the ones overhead on a level with a hum of its own.)
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

    /** Which lights were flickering was another world's. */
    forgetLights() {
        this._flickerLit.clear();
    }

    /** The power has gone: the hum dies at once, and somewhere a heavy relay lets go. */
    powerCut() {
        if (!this.context) return;
        this._powerOut = true;
        const context = this.context;
        const t = context.currentTime;
        this.mains.gain.cancelScheduledValues(t);
        this.mains.gain.setTargetAtTime(this._mainsLevel(), t, 0.04);
        // (A level with a sound of its own has its own relay; see LevelAudio.)
        if (this.paused || !this.ambienceEnabled || this._humScale === 0) return;
        const near = this._panned(randomBetween(-0.3, 0.3), this.effects);
        this._noiseBurst(t, 0.55, 'lowpass', 90, 1, near);
        this._noiseBurst(t, 0.03, 'highpass', 2500, 0.35, near);
        // ...and the building's echo of it.
        this._noiseBurst(t + 0.05, 1.4, 'lowpass', 160, 0.6, this._panned(randomBetween(-0.6, 0.6), this.reverb));
    }

    /**
     * The tubes trying to strike while the power is coming back: the hum blips on and a few of them buzz.
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

    /** The lights are back on and the hum settles in again. */
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
     * A footstep on damp carpet: a soft, muffled thump, and the sole brushing the pile as it rolls off.
     * @param {number} weight How hard the foot lands (0..1.5; sprinting is heavier).
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
        // Running, the sole drags longer and harder.
        const scuff = t + randomBetween(0.035, 0.06);
        this._noiseBurst(scuff, 0.06 + 0.05 * heavy, 'bandpass', randomBetween(1600, 2400) * (0.9 + 0.15 * heavy), level * SCUFF_LEVEL, out, 0.9);
        if (Math.random() < 0.3) this._squelch(t + randomBetween(0.015, 0.03), level * SQUELCH_LEVEL, out);
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
        // (Taken off while the zoom's still, once it's quiet.)
        this._attachMotor(speed > 0, 0.4);
    }

    /** The flashlight's switch clicking over (a little higher on than off). @param {boolean} on */
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
     * Edit mode putting something up, or knocking it down: heard from where it is, with more of the room the further off.
     * @param {boolean} build
     * @param {number} pan -1..1
     * @param {number} distance How far off, in cells.
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
            // Set down hard: a heavy thud, and the knock of its edge.
            this._noiseBurst(t, 0.25, 'lowpass', 380, 0.8, out);
            this._thump(t, 120, 55, 0.22, 0.6, out);
            this._noiseBurst(t + 0.008, 0.05, 'bandpass', 900, 0.3, out, 1.5);
            return;
        }
        // Knocked down: a duller thud, and the bits of it coming down after.
        this._noiseBurst(t, 0.35, 'lowpass', 260, 0.8, out);
        this._thump(t, 90, 40, 0.3, 0.55, out);
        const bits = 4 + Math.floor(Math.random() * 5);
        for (let i = 0; i < bits; i++) {
            const at = randomBetween(0.04, 0.5);
            this._noiseBurst(t + at, randomBetween(0.02, 0.05), 'bandpass', randomBetween(1200, 3500), 0.14 * (1 - at), out, 2);
        }
    }

    /**
     * The tape losing tracking for a moment, with the picture (see PostProcessing.glitch): it drops out and crackles.
     * @param {number} strength 0..1
     * @param {number} seconds How long it takes to settle.
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

    /** The buzz of the tubes overhead: how much, and from which side. */
    _setFixture(level, pan) {
        const fixture = this._fixture;
        const t = this.context.currentTime;
        if (Math.abs(level - fixture.level) > 0.01) {
            fixture.level = level;
            // Quick enough to stutter with a flickering tube.
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

    /** A burst of filtered noise with a sharp attack and an exponential tail. */
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

    /** A low sine thump, dropping in pitch. */
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

    /** A step: the pat of the foot, and the heel's short, low thud under it. */
    _step(t, level, brightness, out) {
        this._noiseBurst(t, 0.14, 'lowpass', brightness * randomBetween(0.8, 1.2), level, out);
        this._thump(t, 95, 48, 0.12, level * 0.6, out);
    }

    /** Wet carpet giving under a foot: a little suck of noise, swinging up and back. */
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

    /** Someone else walking, somewhere, heading away. */
    _distantSteps() {
        const t = this.context.currentTime;
        const out = this._panned(randomBetween(-0.9, 0.9), this.reverb);
        const count = 5 + Math.floor(Math.random() * 5);
        const pace = randomBetween(0.5, 0.62);
        for (let i = 0; i < count; i++) this._step(t + i * pace, 0.45 * (1 - i / (count + 2)), 380, out);
    }
}

/**
 * The lights' hum, heard from all round (into `hum`), and the ballasts' buzz and the tubes' sizzle again for the ones
 * overhead (into `overhead`; see listenToLights).
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

    // Ballast buzz: a sawtooth at 120 Hz, filtered to its middle harmonics (what small speakers can play).
    const buzz = context.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.value = 120;
    const buzzFilter = context.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 1100;
    buzzFilter.Q.value = 0.5;
    buzz.connect(buzzFilter);
    buzz.start();

    // The tubes' sizzle: hiss chopped at 120 Hz, so it buzzes rather than hisses.
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
 * A room's echo (see Room): decaying noise, darker as it fades (a one-pole low-pass that closes over time), each side
 * its own, after a short gap, with the first few reflections standing out of it.
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
 * Connects `node` to `destinations` only while it's wanted. Once it's been unwanted for `fade` seconds (long enough to
 * have gone quiet) it's taken off, and nothing feeding it is worked out at all, since browsers only process what can
 * reach the speakers; it goes back on as soon as it's wanted again.
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

/** A random number from `min` up to `max`. */
export function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}
