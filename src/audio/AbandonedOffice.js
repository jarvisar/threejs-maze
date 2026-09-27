/*
 * The sound of Level 4, the abandoned office: an empty building at night, and the storm outside. It takes the place of
 * Level 0's office hum, on top of the rest of the ambience:
 *
 * - the rain on the windows, which never stops: a wash of it, the drumming on the glass and the patter of the drops,
 *   loud and bright by a window and dull everywhere else, and the building giving it back wherever you are; now and
 *   then a gust, and it comes down harder for a few seconds;
 * - thunder after each flash of lightning (see storm.js): close, a crack and then a long rumble; far off, a few seconds
 *   after, only the rumble, lower and quieter; louder by the windows;
 * - the air from the vents, quiet; and the pipes, rumbling somewhere now and then, and sometimes knocking;
 * - a vending machine humming when you're by one, its compressor clunking in and out;
 * - very now and then, far off, a phone ringing on a desk somewhere, a lift arriving, a door closing;
 * - footsteps soft on the carpet, harder on the vinyl of the core and the kitchens.
 *
 * In a power cut the vents and the vending machines stop. The rain doesn't.
 *
 * All of it synthesised from the ambience's audio context, like everything else.
 */

import { abandonedOfficeFloorAt, abandonedOfficeRainAt } from '../world/abandonedOffice.js';
import { FURN_VENDING } from '../world/abandonedOfficeFurniture.js';
import { chunkCoord } from '../world/grid.js';
import { storm } from '../world/storm.js';
import { randomBetween } from './Ambience.js';
import { LevelAudio, clamp, createBrownNoise } from './LevelAudio.js';

// How loud each part is, before the ambience's master level.
const RAIN_LEVEL = 0.16;
const PATTER_LEVEL = 0.12;
const SILL_LEVEL = 0.07;
const RAIN_ECHO = 0.14;
const AIR_LEVEL = 0.05;
const DIFFUSER_LEVEL = 0.008;
const THUNDER_LEVEL = 0.6;
const CRACK_LEVEL = 0.35;
const PIPE_LEVEL = 0.26;
const KNOCK_LEVEL = 0.22;
const VEND_LEVEL = 0.09;
const CLUNK_LEVEL = 0.14;
const PHONE_LEVEL = 0.05;
const DING_LEVEL = 0.12;
const DOOR_LEVEL = 0.32;
const STEP_LEVEL = 1;
const RELAY_LEVEL = 0.3;
// The rain's drumming on the glass, against its wash.
const DRUM = 1.2;
// How much of the rain gets through far from any window; and how far up its top end reaches (Hz), there and right by
// the glass.
const RAIN_FAR = 0.3;
const DULL = 700;
const BRIGHT = 7000;
// How quickly the rain follows you to a window and away (a share a second).
const RAIN_EASE = 0.7;
// Seconds between gusts, the pipes, and something far off; and a vending machine's compressor running, and resting.
const GUST_GAP = [20, 60];
const PIPE_GAP = [30, 90];
const FAR_GAP = [90, 240];
const RUN_GAP = [20, 60];
const REST_GAP = [15, 40];
// A strike seen longer ago than this (seconds) is too late for its thunder.
const THUNDER_LATE = 4;
// How far off a vending machine can be heard.
const VEND_REACH = 2.5;
// A vending machine's mains buzz, as [harmonic of 50 Hz, level]: mostly the second.
const BUZZ_HARMONICS = [[1, 0.3], [2, 1], [3, 0.25], [4, 0.3], [6, 0.1]];

export class AbandonedOfficeAudio extends LevelAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        super(ambience);
        /** @type {import('../world/ChunkStore.js').ChunkStore | null} */
        this.store = null;
        this._footLeft = false;
        /** How near a window the rain is (0..1): where you are, and eased, as it's heard. */
        this._rainTarget = 0;
        this._rain = -1;
        /** How near a vending machine is (0..1), and whether its compressor's running. */
        this._vending = 0;
        this._running = true;
        /** What each level was last eased to (see _ease). */
        this._eased = { rain: -1, tone: -1, patter: -1, vend: -1 };
        /** The vending machines near where the listener was last looked for them, as x, z, x, z... (see _gather). */
        this._around = { cellX: NaN, cellZ: NaN, machines: /** @type {number[]} */ ([]) };
        /** @type {[string, number[], () => void][]} */
        this._events = [
            ['_untilGust', GUST_GAP, this._gust],
            ['_untilPipes', PIPE_GAP, this._pipes],
            ['_untilFar', FAR_GAP, this._farOff],
        ];
        this._resetTimers();
    }

    /** The world it's in (see LevelSound.setWorld): where its windows and its vending machines are. */
    setWorld(store) {
        this.store = store;
        this._around.cellX = NaN;
    }

    _build() {
        const context = this.ambience.context;
        if (this.built || !context) return this.built;
        this.built = true;
        this.context = context;
        const noise = this.ambience.noise;
        this.brown = createBrownNoise(context, 8, 120);
        this.patter = createPatter(context, 4, 55);

        this.bus = context.createGain();
        this.bus.gain.value = 0;
        this._connect(this.bus, this.ambience.master);
        this.farBus = context.createGain();
        this.farBus.gain.value = 0;
        this._connect(this.farBus, this.ambience.reverb);
        this.distant = context.createBiquadFilter();
        this.distant.type = 'lowpass';
        this.distant.frequency.value = 900;
        const distantLevel = context.createGain();
        distantLevel.gain.value = 0.35;
        this.distant.connect(distantLevel).connect(this.bus);
        this.room = context.createGain();
        this.room.gain.value = 0.15;
        this.room.connect(this.farBus);
        // The whole building, for the thunder.
        this.building = context.createGain();
        this.building.gain.value = 0.45;
        this.building.connect(this.farBus);

        // The rain: its wash on the glass and the drumming, through a filter that opens by a window and closes far from
        // one, and the drops, heard only near the glass. A gust swells all of it, and the building gives some of it back.
        this.gust = context.createGain();
        this.gust.connect(this.bus);
        const rainEcho = context.createGain();
        rainEcho.gain.value = RAIN_ECHO;
        this.gust.connect(rainEcho).connect(this.farBus);
        this.rainLevel = context.createGain();
        this.rainLevel.gain.value = RAIN_LEVEL * RAIN_FAR;
        this.rainTone = context.createBiquadFilter();
        this.rainTone.type = 'lowpass';
        this.rainTone.frequency.value = DULL;
        this.rainTone.Q.value = 0.5;
        this.rainTone.connect(this.rainLevel).connect(this.gust);
        const wash = this._loop(noise, 1);
        const washHigh = context.createBiquadFilter();
        washHigh.type = 'highpass';
        washHigh.frequency.value = 350;
        const washPeak = context.createBiquadFilter();
        washPeak.type = 'peaking';
        washPeak.frequency.value = 3000;
        washPeak.Q.value = 0.8;
        washPeak.gain.value = 4;
        const washLevel = context.createGain();
        this._lfo(0.11, 0.08, washLevel.gain);
        this._lfo(0.37, 0.05, washLevel.gain);
        wash.connect(washHigh).connect(washPeak).connect(washLevel).connect(this.rainTone);
        const drum = this._loop(this.brown, 1.6);
        const drumFilter = context.createBiquadFilter();
        drumFilter.type = 'bandpass';
        drumFilter.frequency.value = 240;
        drumFilter.Q.value = 0.7;
        const drumLevel = context.createGain();
        drumLevel.gain.value = DRUM;
        drum.connect(drumFilter).connect(drumLevel).connect(this.rainTone);
        // The drops: two loops of the same patter, out of step.
        this.patterLevel = context.createGain();
        this.patterLevel.gain.value = 0;
        this.patterLevel.connect(this.gust);
        const patterHigh = context.createBiquadFilter();
        patterHigh.type = 'highpass';
        patterHigh.frequency.value = 1500;
        patterHigh.connect(this.patterLevel);
        for (const rate of [1, 0.87]) this._loop(this.patter, rate).connect(patterHigh);

        // The air from the vents: a low rush, and the diffusers' hiss. Each entry in _spin is [param, running, stopped].
        this.plant = context.createGain();
        this.plant.connect(this.bus);
        const air = this._loop(this.brown, 0.9);
        const airFilter = context.createBiquadFilter();
        airFilter.type = 'lowpass';
        airFilter.frequency.value = 320;
        const airLevel = context.createGain();
        airLevel.gain.value = AIR_LEVEL;
        this._lfo(0.043, AIR_LEVEL * 0.25, airLevel.gain);
        air.connect(airFilter).connect(airLevel).connect(this.plant);
        const diffuser = this._loop(noise, 0.8);
        const diffuserFilter = context.createBiquadFilter();
        diffuserFilter.type = 'bandpass';
        diffuserFilter.frequency.value = 1400;
        diffuserFilter.Q.value = 0.6;
        const diffuserLevel = context.createGain();
        diffuserLevel.gain.value = DIFFUSER_LEVEL;
        diffuser.connect(diffuserFilter).connect(diffuserLevel).connect(this.plant);
        this._spin = [[this.plant.gain, 1, 0], [air.playbackRate, 0.9, 0.4]];

        // A vending machine, when you're by one (see follow): the mains buzz of its lit front, its fan, and its
        // compressor's hum, when that's running.
        this.vend = context.createGain();
        this.vend.gain.value = 0;
        this.vend.connect(this.bus);
        const size = BUZZ_HARMONICS[BUZZ_HARMONICS.length - 1][0] + 1;
        const real = new Float32Array(size);
        const imag = new Float32Array(size);
        for (const [harmonic, level] of BUZZ_HARMONICS) imag[harmonic] = level;
        const mains = context.createOscillator();
        mains.setPeriodicWave(context.createPeriodicWave(real, imag));
        mains.frequency.value = 50;
        const buzzFilter = context.createBiquadFilter();
        buzzFilter.type = 'lowpass';
        buzzFilter.frequency.value = 500;
        const buzzLevel = context.createGain();
        buzzLevel.gain.value = 0.25;
        mains.connect(buzzFilter).connect(buzzLevel).connect(this.vend);
        mains.start();
        const fan = this._loop(noise, 0.6);
        const fanFilter = context.createBiquadFilter();
        fanFilter.type = 'bandpass';
        fanFilter.frequency.value = 900;
        fanFilter.Q.value = 1.2;
        const fanLevel = context.createGain();
        fanLevel.gain.value = 0.05;
        fan.connect(fanFilter).connect(fanLevel).connect(this.vend);
        this.compressor = context.createGain();
        this.compressor.connect(this.vend);
        const motor = context.createOscillator();
        motor.type = 'sawtooth';
        motor.frequency.value = 47;
        const motorFilter = context.createBiquadFilter();
        motorFilter.type = 'lowpass';
        motorFilter.frequency.value = 180;
        const motorLevel = context.createGain();
        motorLevel.gain.value = 0.6;
        motor.connect(motorFilter).connect(motorLevel).connect(this.compressor);
        motor.start();
        const rattle = this._loop(this.brown, 1.3);
        const rattleFilter = context.createBiquadFilter();
        rattleFilter.type = 'bandpass';
        rattleFilter.frequency.value = 95;
        rattleFilter.Q.value = 2;
        const rattleLevel = context.createGain();
        rattleLevel.gain.value = 0.8;
        this._lfo(0.3, 0.2, rattleLevel.gain);
        rattle.connect(rattleFilter).connect(rattleLevel).connect(this.compressor);

        // Footsteps: heard close by, with a little of the room.
        this.steps = context.createGain();
        this.steps.connect(this.ambience.effects);
        const stepRoom = context.createGain();
        stepRoom.gain.value = 0.1;
        this.steps.connect(stepRoom).connect(this.ambience.reverb);

        this._applyEnabled();
        this._applyCompressor(0.01);
        if (this._power < 0.25) {
            this._powerOut = true;
            this._setPlant(false, 0.01);
        }
        return true;
    }

    /**
     * Where the listener is and how much of the power's on (see Game): every frame, before update(). The rain is nearer
     * by the windows; a vending machine is heard when you're by one.
     */
    follow(x, z, areaLight, power) {
        this._power = power;
        if (!this.store) return;
        this._rainTarget = abandonedOfficeRainAt(this.store, x, z);
        const cellX = Math.floor(x + 0.5);
        const cellZ = Math.floor(z + 0.5);
        if (cellX !== this._around.cellX || cellZ !== this._around.cellZ) this._gather(cellX, cellZ);
        const machines = this._around.machines;
        let nearest = Infinity;
        for (let k = 0; k < machines.length; k += 2) nearest = Math.min(nearest, Math.hypot(machines[k] - x, machines[k + 1] - z));
        this._vending = clamp(1 - nearest / VEND_REACH, 0, 1);
    }

    /** The vending machines within earshot of a cell, from the chunks round it. */
    _gather(cellX, cellZ) {
        const around = this._around;
        around.cellX = cellX;
        around.cellZ = cellZ;
        around.machines.length = 0;
        const reach = VEND_REACH + 1;
        for (let cx = chunkCoord(Math.floor(cellX - reach)); cx <= chunkCoord(Math.ceil(cellX + reach)); cx++) {
            for (let cz = chunkCoord(Math.floor(cellZ - reach)); cz <= chunkCoord(Math.ceil(cellZ + reach)); cz++) {
                const data = this.store.getChunk(cx, cz).abandonedOffice;
                if (!data) continue;
                for (const piece of data.furniture) {
                    if (piece.type !== FURN_VENDING) continue;
                    if (Math.abs(piece.x - cellX) < reach && Math.abs(piece.z - cellZ) < reach) around.machines.push(piece.x, piece.z);
                }
            }
        }
    }

    /** A footstep at (x, z): on the carpet, or the vinyl of the core and the kitchens. */
    step(weight, x, z) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.footstepsEnabled || weight < 0.05 || !this._build()) return;
        const vinyl = this.store ? abandonedOfficeFloorAt(this.store, x, z) === 1 : false;
        this._footLeft = !this._footLeft;
        const t = this.context.currentTime;
        const heavy = Math.min(weight, 1.5);
        const level = heavy * STEP_LEVEL;
        const out = this._panned(this._footLeft ? -0.08 : 0.08, this.steps);
        if (vinyl) {
            // A heel on vinyl tiles: a click, and the sole's slap.
            this._noise(t, 0.02, 'bandpass', randomBetween(2600, 3600), 1.8, level * 0.35, out);
            this._thump(t, 140, 80, 0.06, level * 0.3, out);
            this._noise(t + 0.008, 0.05, 'bandpass', randomBetween(1000, 1400), 1, level * 0.4, out);
        } else {
            // Office carpet, thin and hard-wearing: a soft, dull thud, and the sole brushing the pile.
            this._thump(t, 90, 50, 0.1, level * 0.4, out);
            this._noise(t, 0.09, 'lowpass', randomBetween(600, 850), 0.7, level * 1.2, out);
            this._noise(t + randomBetween(0.03, 0.05), 0.05 + 0.04 * heavy, 'bandpass', randomBetween(1400, 2000), 0.9, level * 0.2, out);
        }
    }

    /** Keeps the level going: the rain, the thunder, the vending machines, and everything else now and then. */
    update(dt) {
        // (Every strike's counted, heard or not, so none are saved up for later.)
        const fresh = storm.strikes > this._strikes;
        this._strikes = storm.strikes;
        if (!this.enabled || !this._build()) return;
        this._watchPower(dt);
        const ambience = this.ambience;
        if (ambience.paused) return;
        const t = this.context.currentTime;

        // The rain, following you to the windows and away; a vending machine, by one.
        if (this._rain < 0) this._rain = this._rainTarget;
        this._rain += (this._rainTarget - this._rain) * Math.min(dt * RAIN_EASE, 1);
        const near = this._rain;
        this._ease('rain', this.rainLevel.gain, RAIN_LEVEL * (RAIN_FAR + (1 - RAIN_FAR) * near), t, 0.4, RAIN_LEVEL * 0.02);
        this._ease('tone', this.rainTone.frequency, DULL + (BRIGHT - DULL) * near * near, t, 0.4, 30);
        this._ease('patter', this.patterLevel.gain, PATTER_LEVEL * near * near, t, 0.4, PATTER_LEVEL * 0.02);
        const vend = this._powerOut ? 0 : this._vending * this._vending;
        this._ease('vend', this.vend.gain, VEND_LEVEL * vend, t, 0.3, VEND_LEVEL * 0.02);
        if (!ambience.ambienceEnabled) return;

        if (fresh && storm.since < THUNDER_LATE) this._thunder(t);
        // Now and then a heavier drop off the frame, by a window.
        if (near > 0.2 && Math.random() < dt * 0.8 * near) this._drop(t);
        // The compressor running for a while, and resting.
        this._untilCycle -= dt;
        if (this._untilCycle <= 0) {
            this._running = !this._running;
            this._untilCycle = this._running ? randomBetween(RUN_GAP[0], RUN_GAP[1]) : randomBetween(REST_GAP[0], REST_GAP[1]);
            this._applyCompressor(this._running ? 0.4 : 0.8);
            if (vend > 0.01) this._clunk(t, this._running);
        }
        for (const [key, gap, sound] of this._events) {
            this[key] -= dt;
            if (this[key] > 0) continue;
            this[key] = randomBetween(gap[0], gap[1]);
            sound.call(this);
        }
    }

    /**
     * Eases a level to `target`, but only when that's moved by more than `step`: a new target every frame would pile up
     * the level's automation events.
     */
    _ease(key, param, target, t, timeConstant, step) {
        const last = this._eased[key];
        if (Math.abs(target - last) < step && !(target === 0 && last !== 0)) return;
        this._eased[key] = target;
        param.setTargetAtTime(target, t, timeConstant);
    }

    /** Coming into the level: the storm's already going, and the rest comes sooner than it will. */
    _resetTimers() {
        this._untilGust = randomBetween(10, 30);
        this._untilPipes = randomBetween(15, 40);
        this._untilFar = randomBetween(40, 120);
        this._untilCycle = randomBetween(RUN_GAP[0], RUN_GAP[1]);
        this._rain = -1;
        // Only the strikes from now on have thunder.
        this._strikes = storm.strikes;
    }

    // ------------------------------------------------------------------ the power

    /** The power going: the vents run down and the vending machines stop, with a clunk somewhere. The rain carries on. */
    _cut() {
        this._powerOut = true;
        this._setPlant(false, 1.5);
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;
        const t = this.context.currentTime;
        const out = this._far(randomBetween(-0.5, 0.5));
        this._thump(t, 70, 35, 0.5, RELAY_LEVEL, out);
        this._noise(t, 0.3, 'lowpass', 200, 0.8, RELAY_LEVEL * 0.6, out);
        if (this._vending > 0.1 && this._running) this._clunk(t, false);
    }

    _restore() {
        this._powerOut = false;
        this._setPlant(true, 1);
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;
        if (this._vending > 0.1 && this._running) this._clunk(this.context.currentTime, true);
    }

    _setPlant(on, timeConstant) {
        if (!this.built) return;
        const t = this.context.currentTime;
        for (const [param, running, stopped] of this._spin) {
            param.cancelScheduledValues(t);
            param.setTargetAtTime(on ? running : stopped, t, timeConstant);
        }
    }

    _applyEnabled() {
        if (!this.built) return;
        const t = this.context.currentTime;
        for (const gain of [this.bus.gain, this.farBus.gain]) {
            gain.cancelScheduledValues(t);
            gain.setTargetAtTime(this.enabled ? 1 : 0, t, this.enabled ? 0.35 : 0.1);
        }
    }

    /** The compressor's hum, running or resting (the front's buzz and the fan carry on). */
    _applyCompressor(timeConstant) {
        this.compressor.gain.setTargetAtTime(this._running ? 1 : 0.1, this.context.currentTime, timeConstant);
    }

    // ------------------------------------------------------------------ the storm

    /**
     * Thunder for the strike just seen (see storm.js): as long after the flash as it was far off. Near, a crack that
     * tears across the sky and a long rumble; far off, only the rumble, rolling, lower and quieter. Louder, and a
     * little brighter, by the windows.
     */
    _thunder(t) {
        const context = this.context;
        const near = storm.near;
        const delay = 0.3 + 4.2 * (1 - near) ** 1.3 + randomBetween(0, 0.5);
        const at = t + Math.max(0.02, delay - storm.since);
        const open = 0.8 + 0.35 * this._rain;
        const level = THUNDER_LEVEL * (0.3 + 0.7 * near) * open;
        const out = this._panned(randomBetween(-0.4, 0.4), this.bus);
        out.connect(this.building);
        const close = near > 0.45;

        if (close) {
            // The crack: a few splits of bright noise, tearing, and the air thumping.
            const crack = CRACK_LEVEL * near * open;
            const splits = 3 + Math.floor(Math.random() * 3);
            let split = at;
            for (let k = 0; k < splits; k++) {
                this._noise(split, randomBetween(0.08, 0.25), 'highpass', randomBetween(800, 2000), 0.7, crack * randomBetween(0.4, 1), out);
                split += randomBetween(0.02, 0.07);
            }
            this._noise(at, 0.9, 'lowpass', 600, 0.7, crack * 0.8, out);
            this._thump(at, 70, 28, 1.4, crack * 0.9, out);
        }

        // The rumble: low noise, slowly swelling and falling back, and darker as it goes.
        const length = close ? randomBetween(5, 8) : randomBetween(6, 10);
        const source = context.createBufferSource();
        source.buffer = this.brown;
        source.loop = true;
        source.playbackRate.value = randomBetween(0.6, 0.9);
        const low = context.createBiquadFilter();
        low.type = 'lowpass';
        low.Q.value = 0.7;
        const top = (close ? 380 : 150 + 150 * near) * (0.75 + 0.35 * this._rain);
        low.frequency.setValueAtTime(top, at);
        low.frequency.exponentialRampToValueAtTime(top * 0.45, at + length);
        const envelope = context.createGain();
        const gain = envelope.gain;
        const rise = close ? 0.25 : randomBetween(0.8, 1.6);
        gain.setValueAtTime(0, at);
        gain.linearRampToValueAtTime(level * randomBetween(0.6, 0.9), at + rise);
        const swells = 2 + Math.floor(Math.random() * 3);
        const stride = (length - rise) / (swells + 1);
        let when = at + rise;
        for (let k = 1; k <= swells; k++) {
            const fading = 1 - k / (swells + 1);
            gain.linearRampToValueAtTime(level * fading * randomBetween(0.2, 0.45), when + stride * randomBetween(0.3, 0.5));
            when += stride;
            gain.linearRampToValueAtTime(level * fading * randomBetween(0.6, 1.1), when);
        }
        gain.exponentialRampToValueAtTime(0.0005, at + length);
        source.connect(low).connect(envelope).connect(out);
        source.start(at, Math.random() * 4);
        source.stop(at + length + 0.05);
    }

    /** A gust: the rain coming down harder for a few seconds, and easing off. */
    _gust() {
        const t = this.context.currentTime;
        const length = randomBetween(3, 7);
        this.gust.gain.setTargetAtTime(randomBetween(1.4, 2), t, length * 0.25);
        this.gust.gain.setTargetAtTime(1, t + length, length * 0.3);
    }

    /** A heavier drop off the window's frame, onto the sill. */
    _drop(t) {
        const out = this._panned(randomBetween(-0.7, 0.7), this.bus);
        const level = SILL_LEVEL * this._rain * randomBetween(0.4, 1);
        this._noise(t, 0.012, 'bandpass', randomBetween(2500, 4500), 2, level, out);
        if (Math.random() < 0.4) this._thump(t, randomBetween(700, 1100), 400, 0.04, level * 0.5, out);
    }

    // ------------------------------------------------------------------ the building

    /** The pipes, somewhere in the walls: a low rumble that swells and bends, and sometimes a few knocks after it. */
    _pipes() {
        const context = this.context;
        const t = context.currentTime;
        const length = randomBetween(1.8, 3.2);
        const out = this._far(randomBetween(-0.9, 0.9));
        const low = randomBetween(45, 75);
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0, t);
        envelope.gain.linearRampToValueAtTime(PIPE_LEVEL, t + length * 0.3);
        envelope.gain.linearRampToValueAtTime(PIPE_LEVEL * 0.7, t + length * 0.7);
        envelope.gain.linearRampToValueAtTime(0, t + length);
        envelope.connect(out);
        const source = context.createBufferSource();
        source.buffer = this.brown;
        const band = context.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 6;
        band.frequency.setValueAtTime(low, t);
        band.frequency.exponentialRampToValueAtTime(low * 1.5, t + length * 0.4);
        band.frequency.exponentialRampToValueAtTime(low * 1.1, t + length);
        const bandLevel = context.createGain();
        bandLevel.gain.value = 3;
        source.connect(band).connect(bandLevel).connect(envelope);
        source.start(t, Math.random() * (this.brown.duration - length - 0.1), length + 0.05);
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(low * 0.55, t);
        osc.frequency.linearRampToValueAtTime(low * 0.7, t + length * 0.5);
        osc.frequency.linearRampToValueAtTime(low * 0.6, t + length);
        const resonance = context.createBiquadFilter();
        resonance.type = 'lowpass';
        resonance.frequency.value = randomBetween(200, 320);
        resonance.Q.value = 5;
        const toneLevel = context.createGain();
        toneLevel.gain.value = 0.15;
        osc.connect(resonance).connect(toneLevel).connect(envelope);
        osc.start(t);
        osc.stop(t + length + 0.05);
        if (Math.random() < 0.55) {
            // The water hammer: a few knocks along the pipe.
            const knocks = 2 + Math.floor(Math.random() * 4);
            let at = t + length * randomBetween(0.5, 0.9);
            for (let k = 0; k < knocks; k++) {
                const level = KNOCK_LEVEL * randomBetween(0.5, 1);
                this._thump(at, 160, 80, 0.12, level, out);
                this._noise(at, 0.04, 'bandpass', 650, 1.4, level * 0.6, out);
                at += randomBetween(0.18, 0.5);
            }
        }
    }

    /** A vending machine's compressor starting (a clunk, and it hums up to speed) or stopping (a shudder). */
    _clunk(t, on) {
        const level = CLUNK_LEVEL * this._vending * this._vending;
        const out = this._near(0);
        this._noise(t, 0.02, 'bandpass', 1600, 2, level * 0.5, out);
        this._thump(t, on ? 90 : 70, on ? 45 : 35, on ? 0.25 : 0.35, level, out);
    }

    /** Something far off in the building: a phone ringing, a lift arriving, a door closing. */
    _farOff() {
        const roll = Math.random();
        if (roll < 0.45) this._phone();
        else if (roll < 0.75 && !this._powerOut) this._ding();
        else this._door();
    }

    /** A phone on a desk somewhere: an office trill, two bursts to a ring, a few rings, and nobody answers. */
    _phone() {
        const context = this.context;
        const t = context.currentTime;
        const out = this._far(randomBetween(-0.9, 0.9));
        const rings = 3 + Math.floor(Math.random() * 4);
        const pitch = randomBetween(900, 1200);
        const osc = context.createOscillator();
        osc.type = 'square';
        osc.frequency.value = pitch;
        const trill = context.createOscillator();
        trill.type = 'square';
        trill.frequency.value = randomBetween(16, 22);
        const depth = context.createGain();
        depth.gain.value = pitch * 0.12;
        trill.connect(depth).connect(osc.frequency);
        // Through a wall or two.
        const muffle = context.createBiquadFilter();
        muffle.type = 'lowpass';
        muffle.frequency.value = 1800;
        muffle.Q.value = 0.7;
        const gate = context.createGain();
        gate.gain.value = 0;
        let at = t + 0.05;
        for (let r = 0; r < rings; r++) {
            for (let b = 0; b < 2; b++) {
                const on = at + b * 0.6;
                gate.gain.setValueAtTime(0, on);
                gate.gain.linearRampToValueAtTime(PHONE_LEVEL, on + 0.01);
                gate.gain.setValueAtTime(PHONE_LEVEL, on + 0.4);
                gate.gain.linearRampToValueAtTime(0, on + 0.41);
            }
            at += 3;
        }
        osc.connect(muffle).connect(gate).connect(out);
        osc.start(t);
        trill.start(t);
        osc.stop(at);
        trill.stop(at);
    }

    /** A lift arriving somewhere on the floor: its chime, and the doors rolling open on nobody. */
    _ding() {
        const context = this.context;
        const t = context.currentTime;
        const out = this._far(randomBetween(-0.9, 0.9));
        const notes = Math.random() < 0.5 ? [1318] : [1318, 1046];
        notes.forEach((frequency, k) => {
            const at = t + k * 0.45;
            for (const [ratio, amount, decay] of [[1, 1, 1.6], [2.01, 0.3, 0.9], [3.9, 0.1, 0.5]]) {
                const osc = context.createOscillator();
                osc.frequency.value = frequency * ratio;
                const gain = context.createGain();
                gain.gain.setValueAtTime(0, at);
                gain.gain.linearRampToValueAtTime(DING_LEVEL * amount, at + 0.004);
                gain.gain.exponentialRampToValueAtTime(0.0005, at + decay);
                osc.connect(gain).connect(out);
                osc.start(at);
                osc.stop(at + decay + 0.05);
            }
        });
        this._noise(t + 1.3, 1.4, 'lowpass', 300, 0.7, DING_LEVEL * 0.6, out);
    }

    /** A door closing, a long way off: the latch, and the thud. */
    _door() {
        const t = this.context.currentTime;
        const out = this._far(randomBetween(-0.9, 0.9));
        this._noise(t, 0.03, 'bandpass', 1800, 2, DOOR_LEVEL * 0.3, out);
        this._thump(t + 0.02, 110, 50, 0.45, DOOR_LEVEL, out);
        this._noise(t + 0.02, 0.5, 'lowpass', 220, 0.8, DOOR_LEVEL * 0.5, out);
    }

    /** Close by: heard directly, with a little of the room. */
    _near(pan) {
        const panner = this._panned(pan, this.bus);
        panner.connect(this.room);
        return panner;
    }

    /** Somewhere else in the building: mostly echo. */
    _far(pan) {
        const panner = this._panned(pan, this.farBus);
        panner.connect(this.distant);
        return panner;
    }
}

/**
 * Rain on glass: a loop of little ticks, dropped at random, most of them faint, each wrapping round the end so the loop
 * joins up.
 * @param {BaseAudioContext} context
 * @param {number} seconds
 * @param {number} perSecond
 */
function createPatter(context, seconds, perSecond) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = context.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const drops = Math.floor(seconds * perSecond);
    for (let k = 0; k < drops; k++) {
        const at = Math.floor(Math.random() * length);
        const level = 0.1 + 0.9 * Math.random() ** 3;
        const decay = rate * randomBetween(0.0006, 0.003);
        const end = Math.floor(decay * 6);
        for (let i = 0; i < end; i++) data[(at + i) % length] += level * (Math.random() * 2 - 1) * Math.exp(-i / decay);
    }
    let power = 0;
    for (let i = 0; i < length; i++) power += data[i] * data[i];
    const gain = power > 0 ? 0.2 / Math.sqrt(power / length) : 0;
    for (let i = 0; i < length; i++) data[i] *= gain;
    return buffer;
}
