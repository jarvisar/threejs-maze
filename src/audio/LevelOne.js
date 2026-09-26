/*
 * The sound of Level 1, the car park: bare concrete, standing water, pipes along the ceiling, and a building
 * that never stops breathing. It takes the place of Level 0's warm office hum, on top of the rest of the
 * ambience:
 *
 * - the ventilation: a deep rumble of air that swells and settles like breathing, with the fan motors
 *   beating faintly under it;
 * - a colder, thinner hum from the tubes than Level 0's, fading where they've died;
 * - machinery a long way off, never quite steady;
 * - water dripping all round, closer and more often where it's wet;
 * - footsteps on concrete, with a slap-back off the walls, and a splash in the puddles;
 * - now and then the pipes clanging, groaning or knocking, and very rarely a door or a shutter far away.
 *
 * The blackouts are the level's own: a heavy relay drops out, the hum dies and the ventilation winds down,
 * leaving only the water and the pipes, until it all spins back up again.
 *
 * All of it synthesised from the ambience's audio context, like everything else.
 */

import { levelOneWetness } from '../world/levelOneWater.js';

// How loud each part is, before the ambience's master level. The bed sits about where Level 0's hum does.
const VENT_LEVEL = 0.6;
const AIR_LEVEL = 0.3;
const MOTOR_LEVEL = 0.05;
const MACHINE_LEVEL = 0.35;
const HUM_LEVEL = 0.2;
const STEP_LEVEL = 1;
const DRIP_LEVEL = 0.27;
const CLANG_LEVEL = 0.1;
const GROAN_LEVEL = 0.25;
const KNOCK_LEVEL = 0.27;
const DOOR_LEVEL = 0.45;
const SHUTTER_LEVEL = 0.24;
const RELAY_LEVEL = 0.45;
// Seconds for the plant to wind down when the power goes, and to spin back up when it returns.
const SPIN_DOWN = 4.5;
const SPIN_UP = 2.4;
// Seconds the power has to stay off before it counts as a cut (the lights stutter first).
const CUT_CONFIRM = 0.2;
// Seconds between drips, [least, most]: bone dry, and soaking wet.
const DRIP_GAP_DRY = [4, 12];
const DRIP_GAP_WET = [0.6, 3];
// Seconds between the pipes clanging, the pipes groaning or knocking, and a door or a shutter.
const CLANG_GAP = [25, 70];
const PIPE_GAP = [40, 100];
const DOOR_GAP = [120, 300];
// A struck pipe, as [ratio, level, seconds to die away]. The partials are inharmonic, so it rings like metal;
// the second, slightly sharp fundamental beats against the first, the way a long pipe shimmers.
const PIPE_PARTIALS = [[1, 1, 3.2], [1.006, 0.5, 2.6], [2.76, 0.6, 2.2], [5.4, 0.35, 1.3], [8.9, 0.2, 0.7]];
// The tubes' hum, as [harmonic of 60 Hz, level]: less fundamental and more buzz than Level 0's, so it's thinner.
const HUM_HARMONICS = [[1, 0.2], [2, 1], [3, 0.15], [4, 0.5], [5, 0.1], [6, 0.35], [8, 0.22], [10, 0.12], [12, 0.08], [14, 0.04], [16, 0.03]];
// Where most of the ventilation's rumble sits, in Hz.
const BROWN_CORNER = 100;

// How far round the listener to feel for water, for the drips.
const WET_REACH = 1.5;

const randomBetween = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class LevelOneAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        this.ambience = ambience;
        this.enabled = false;
        this.built = false;
        this._light = 1;
        this._power = 1;
        this._powerOut = false;
        this._dark = 0;
        this._wet = 0;
        this._humTarget = -1;
        this._humPower = 1;
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

        // Everything fades in and out with the level: what's heard directly, and what's sent to the reverb.
        this.bus = context.createGain();
        this.bus.gain.value = 0;
        this.bus.connect(this.ambience.master);
        this.farBus = context.createGain();
        this.farBus.gain.value = 0;
        this.farBus.connect(this.ambience.reverb);
        // Far-off things come through directly too, faint and dull, so they keep some edge in the echo.
        this.distant = context.createBiquadFilter();
        this.distant.type = 'lowpass';
        this.distant.frequency.value = 1400;
        const distantLevel = context.createGain();
        distantLevel.gain.value = 0.3;
        this.distant.connect(distantLevel).connect(this.bus);
        // And close things get a little of the room: it's all bare concrete.
        this.room = context.createGain();
        this.room.gain.value = 0.2;
        this.room.connect(this.farBus);

        // The plant: everything that runs off the power, and winds down when it goes. Each entry in _spin is
        // [param, running value, stopped value].
        this.plant = context.createGain();
        this.plant.connect(this.bus);
        const plantFar = context.createGain();
        plantFar.connect(this.farBus);
        this._spin = [[this.plant.gain, 1, 0], [plantFar.gain, 1, 0]];

        // The ventilation: a deep rumble of air, and a little of the rush you can hear on small speakers,
        // breathing together.
        const breath = context.createGain();
        breath.gain.value = 0.75;
        breath.connect(this.plant);
        this._lfo(0.071, 0.14, breath.gain);
        this._lfo(0.029, 0.09, breath.gain);
        const vent = this._loop(this.brown, 1);
        const ventFilter = context.createBiquadFilter();
        ventFilter.type = 'lowpass';
        ventFilter.frequency.value = 150;
        ventFilter.Q.value = 0.7;
        this._lfo(0.043, 30, ventFilter.frequency);
        const ventLevel = context.createGain();
        ventLevel.gain.value = VENT_LEVEL;
        vent.connect(ventFilter).connect(ventLevel).connect(breath);
        const air = this._loop(noise, 1);
        const airFilter = context.createBiquadFilter();
        airFilter.type = 'bandpass';
        airFilter.frequency.value = 420;
        airFilter.Q.value = 0.6;
        const airLevel = context.createGain();
        airLevel.gain.value = AIR_LEVEL;
        air.connect(airFilter).connect(airLevel).connect(breath);
        // Winding down, the air slows and drops in pitch.
        this._spin.push([vent.playbackRate, 1, 0.3], [ventFilter.frequency, 150, 70], [airFilter.frequency, 420, 160]);

        // The fan motors: two low tones not quite together, beating slowly.
        for (const frequency of [52, 52.35]) {
            const osc = context.createOscillator();
            osc.frequency.value = frequency;
            const gain = context.createGain();
            gain.gain.value = MOTOR_LEVEL;
            osc.connect(gain).connect(this.plant);
            osc.start();
            this._spin.push([osc.frequency, frequency, frequency * 0.25]);
        }

        // Machinery a long way off: a low churn that never quite settles (three slow wobbles that never line
        // up), mostly heard as echo.
        const machine = this._loop(this.brown, 0.62);
        const machineFilter = context.createBiquadFilter();
        machineFilter.type = 'bandpass';
        machineFilter.frequency.value = 75;
        machineFilter.Q.value = 1.5;
        const churn = context.createGain();
        churn.gain.value = 0.6;
        this._lfo(0.19, 0.22, churn.gain);
        this._lfo(1.33, 0.14, churn.gain);
        this._lfo(0.047, 0.18, churn.gain);
        const machineLevel = context.createGain();
        machineLevel.gain.value = MACHINE_LEVEL;
        machine.connect(machineFilter).connect(churn).connect(machineLevel).connect(this.plant);
        const machineSend = context.createGain();
        machineSend.gain.value = 0.4;
        machineLevel.connect(machineSend).connect(plantFar);
        this._spin.push([machine.playbackRate, 0.62, 0.2]);

        // The tubes: a colder, thinner hum than Level 0's (one oscillator carries all the harmonics), and a
        // faint hiss.
        this.hum = context.createGain();
        this.hum.gain.value = 0;
        this.hum.connect(this.bus);
        const swell = context.createGain();
        swell.gain.value = 0.9;
        this._lfo(0.09, 0.1, swell.gain);
        swell.connect(this.hum);
        const size = HUM_HARMONICS[HUM_HARMONICS.length - 1][0] + 1;
        const real = new Float32Array(size);
        const imag = new Float32Array(size);
        for (const [harmonic, level] of HUM_HARMONICS) imag[harmonic] = level;
        const mains = context.createOscillator();
        mains.setPeriodicWave(context.createPeriodicWave(real, imag));
        mains.frequency.value = 60;
        mains.connect(swell);
        mains.start();
        const hiss = this._loop(noise, 1.3);
        const hissFilter = context.createBiquadFilter();
        hissFilter.type = 'bandpass';
        hissFilter.frequency.value = 6500;
        hissFilter.Q.value = 0.8;
        const hissLevel = context.createGain();
        hissLevel.gain.value = 0.08;
        hiss.connect(hissFilter).connect(hissLevel).connect(swell);

        // Footsteps: heard close by (not faded with the level), with a slap-back off the concrete and a little
        // of the room.
        this.steps = context.createGain();
        this.steps.connect(this.ambience.effects);
        this.slap = context.createDelay(0.2);
        this.slap.delayTime.value = 0.085;
        const slapFilter = context.createBiquadFilter();
        slapFilter.type = 'lowpass';
        slapFilter.frequency.value = 2600;
        const slapLevel = context.createGain();
        slapLevel.gain.value = 0.28;
        this.steps.connect(this.slap).connect(slapFilter).connect(slapLevel).connect(this.ambience.effects);
        const stepRoom = context.createGain();
        stepRoom.gain.value = 0.12;
        this.steps.connect(stepRoom).connect(this.ambience.reverb);

        // It may have been switched on, or the power may have gone, before there was any sound.
        this._applyEnabled();
        this._applyHum();
        if (this._power < 0.25) {
            this._powerOut = true;
            this._setPlant(false, 0.01);
        }
        return true;
    }

    /** Level 1 on or off. The whole layer fades in, and out a little quicker. @param {boolean} on */
    setEnabled(on) {
        if (on && !this.enabled) this._resetTimers();
        this.enabled = on;
        if (on) this._build();
        this._applyEnabled();
    }

    /** The hum comes from the tubes, so it fades where they've died. @param {number} level 0..1 */
    setAreaLight(level) {
        this._light = level;
        this._applyHum();
    }

    /**
     * How much of the power is on, 0..1. The hum follows the lights, stutter and all; the plant only winds
     * down once the power has properly gone (see update).
     * @param {number} level
     */
    setPower(level) {
        this._power = level;
        this._applyHum();
    }

    /**
     * Where the listener is, how lit it is there and how much of the power's on (see Game): every frame, before
     * update(). The drips follow how wet it is round about.
     * @param {number} x
     * @param {number} z
     * @param {number} areaLight 0..1
     * @param {number} power 0..1
     */
    follow(x, z, areaLight, power) {
        this.setAreaLight(areaLight);
        this.setPower(power);
        let wet = levelOneWetness(x, z);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) wet = Math.max(wet, 0.8 * levelOneWetness(x + dx * WET_REACH, z + dz * WET_REACH));
        this.setWetness(wet);
    }

    /**
     * A footstep at (x, z), splashing if there's water there.
     * @param {number} weight How hard the foot lands (0..1.5).
     * @param {number} x
     * @param {number} z
     */
    step(weight, x, z) {
        this.footstep(weight, levelOneWetness(x, z));
    }

    /** How wet the floor is round the listener: more drips, and closer. @param {number} level 0..1 */
    setWetness(level) {
        this._wet = clamp(level, 0, 1);
    }

    /**
     * Keeps the level going: watches the power, and brings the drips, the pipes and the odd door. Call every
     * frame while Level 1 is on.
     * @param {number} dt
     */
    update(dt) {
        if (!this.enabled || !this._build()) return;
        this._watchPower(dt);
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;

        // Drips, more often the wetter it is (and sooner, if it's just got wetter).
        const most = DRIP_GAP_DRY[1] + (DRIP_GAP_WET[1] - DRIP_GAP_DRY[1]) * this._wet;
        this._untilDrip = Math.min(this._untilDrip - dt, most);
        if (this._untilDrip <= 0) {
            this._untilDrip = randomBetween(DRIP_GAP_DRY[0] + (DRIP_GAP_WET[0] - DRIP_GAP_DRY[0]) * this._wet, most);
            this._randomDrip();
        }

        // The pipes don't need the power.
        this._untilClang -= dt;
        if (this._untilClang <= 0) {
            this._untilClang = randomBetween(CLANG_GAP[0], CLANG_GAP[1]);
            this._clang();
        }
        this._untilPipe -= dt;
        if (this._untilPipe <= 0) {
            this._untilPipe = randomBetween(PIPE_GAP[0], PIPE_GAP[1]);
            if (Math.random() < 0.5) this._groan();
            else this._knocks();
        }

        // Nothing else moves in a blackout.
        this._untilDoor -= dt;
        if (this._untilDoor <= 0) {
            this._untilDoor = randomBetween(DOOR_GAP[0], DOOR_GAP[1]);
            if (!this._powerOut) {
                if (Math.random() < 0.55) this._door();
                else this._shutter();
            }
        }
    }

    /**
     * A footstep on bare concrete: the heel's click, a gritty scuff, and the slap of it back off the walls;
     * in the wet, a splash as well.
     * @param {number} weight How hard the foot lands (0..1.5; sprinting is heavier).
     * @param {number} [wet] How wet it is underfoot, 0..1.
     */
    footstep(weight, wet = 0) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.footstepsEnabled || weight < 0.05 || !this._build()) return;
        this._footLeft = !this._footLeft;
        const context = this.context;
        const t = context.currentTime;
        const heavy = Math.min(weight, 1.5);
        const level = heavy * STEP_LEVEL;
        const out = this._panned(this._footLeft ? -0.08 : 0.08, this.steps);
        // The walls are never quite the same distance away.
        this.slap.delayTime.setTargetAtTime(randomBetween(0.065, 0.105), t, 0.3);
        // Water takes the edge off the click.
        wet = clamp(wet, 0, 1);
        const dry = 1 - 0.45 * wet;

        // The heel: a hard click, with a little knock of body under it.
        this._noise(t, 0.03, 'bandpass', randomBetween(1800, 2800), 1.2, level * 0.55 * dry, out);
        this._thump(t, 130, 70, 0.07, level * 0.35, out);
        // The sole scuffing on grit (longer when landing hard), and now and then a grain of it skittering off.
        this._noise(t + 0.012, 0.06 + 0.04 * heavy, 'bandpass', randomBetween(3200, 4400), 0.7, level * 0.2 * dry, out);
        if (Math.random() < 0.35) this._noise(t + randomBetween(0.03, 0.07), 0.012, 'highpass', 4000, 0.7, level * 0.15 * dry, out);
        if (wet > 0.02) this._splash(t, level * wet, out);
    }

    /**
     * One drop of water landing: a plink on concrete, or a deeper bloop in a puddle.
     * @param {number} level Loudness, 0..1 (by distance).
     * @param {number} pan -1..1
     * @param {boolean} [far] Through the reverb, as if from further off.
     * @param {boolean} [puddle] Into standing water (left out, it's more likely the wetter it is).
     */
    drip(level, pan, far = false, puddle = Math.random() < 0.15 + 0.7 * this._wet) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.ambienceEnabled || level <= 0.01 || !this._build()) return;
        const t = this.context.currentTime;
        const out = far ? this._far(pan) : this._near(pan);
        const frequency = puddle ? randomBetween(900, 1500) : randomBetween(1500, 2600);
        const loud = level * DRIP_LEVEL * (far ? 0.6 : 1);
        this._plink(t, frequency, loud, puddle, out);
        // The smack of it landing.
        this._noise(t, 0.01, 'highpass', 3200, 0.7, loud * 0.5, out);
        // Sometimes a smaller drop, thrown back up, lands a moment later.
        if (Math.random() < 0.3) this._plink(t + randomBetween(0.05, 0.14), frequency * randomBetween(1.15, 1.5), loud * 0.35, puddle, out);
    }

    /** Coming into the level: the first pipe sounds come sooner than the rest will. */
    _resetTimers() {
        this._untilDrip = randomBetween(0.5, 2);
        this._untilClang = randomBetween(6, 20);
        this._untilPipe = randomBetween(20, 50);
        this._untilDoor = randomBetween(60, 180);
    }

    // ------------------------------------------------------------------ the power

    /** The plant only goes once the power has been off for a moment, not with every stutter of the lights. */
    _watchPower(dt) {
        if (this._power < 0.25) {
            this._dark += dt;
            if (!this._powerOut && this._dark >= CUT_CONFIRM) this._cut();
        } else {
            this._dark = 0;
            if (this._powerOut && this._power > 0.9) this._restore();
        }
    }

    /** The power going: a heavy relay drops out, the building follows it, and the fans run down. */
    _cut() {
        this._powerOut = true;
        this._setPlant(false, SPIN_DOWN / 3);
        // With the pumps stopped, the water in the pipes settles, and they complain about it.
        this._untilPipe = Math.min(this._untilPipe, randomBetween(2, 5));
        const ambience = this.ambience;
        if (ambience.paused) return;
        const t = this.context.currentTime;
        const near = this._near(randomBetween(-0.3, 0.3));
        this._whine(t, 170, 22, SPIN_DOWN, 0.05, near);
        this._whine(t, 110, 16, SPIN_DOWN * 1.3, 0.05, this._far(randomBetween(-0.6, 0.6)));
        if (!ambience.ambienceEnabled) return;
        // The contactor letting go: a hard metal clack, and a deep thump.
        this._noise(t, 0.04, 'bandpass', 1500, 2, RELAY_LEVEL * 0.45, near);
        this._thump(t, 150, 90, 0.09, RELAY_LEVEL * 0.4, near);
        this._thump(t + 0.004, 62, 28, 0.7, RELAY_LEVEL, near);
        this._noise(t, 0.6, 'lowpass', 110, 0.8, RELAY_LEVEL * 0.9, near);
        // ...and the rest of the building going with it, a bank at a time.
        let at = t + 0.03;
        for (let i = 0; i < 3; i++) {
            const far = this._far(randomBetween(-0.9, 0.9));
            this._noise(at, 1.6, 'lowpass', 170, 0.8, RELAY_LEVEL * (0.8 - 0.2 * i), far);
            this._thump(at, 55, 30, 0.6, RELAY_LEVEL * 0.5 * (1 - 0.25 * i), far);
            at += randomBetween(0.25, 0.7);
        }
    }

    /** The power back: the contactors pull in, and the plant spins up again. */
    _restore() {
        this._powerOut = false;
        this._setPlant(true, SPIN_UP / 3);
        const ambience = this.ambience;
        if (ambience.paused) return;
        const t = this.context.currentTime;
        const near = this._near(randomBetween(-0.3, 0.3));
        this._whine(t, 25, 170, SPIN_UP * 1.4, 0.035, near);
        if (!ambience.ambienceEnabled) return;
        this._noise(t, 0.035, 'bandpass', 1700, 2, RELAY_LEVEL * 0.45, near);
        this._thump(t, 120, 60, 0.25, RELAY_LEVEL * 0.45, near);
        this._noise(t + 0.02, 1.1, 'lowpass', 180, 0.8, RELAY_LEVEL * 0.4, this._far(randomBetween(-0.8, 0.8)));
    }

    /** Winds the plant down, or back up. */
    _setPlant(on, timeConstant) {
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

    _applyHum() {
        if (!this.built) return;
        const power = clamp((this._power - 0.2) / 0.6, 0, 1);
        const target = HUM_LEVEL * (0.12 + 0.88 * this._light) * power;
        if (Math.abs(target - this._humTarget) < HUM_LEVEL * 0.01) return;
        // Quick when the lights stutter; slow when walking from lit to dark.
        const quick = Math.abs(power - this._humPower) > 0.05;
        this._humTarget = target;
        this._humPower = power;
        this.hum.gain.setTargetAtTime(target, this.context.currentTime, quick ? 0.012 : 0.5);
    }

    // ------------------------------------------------------------------ water

    /** A drip somewhere round the listener: nearer, and more often in a puddle, the wetter it is. */
    _randomDrip() {
        const wet = this._wet;
        const pan = randomBetween(-1, 1);
        if (Math.random() < 0.3 + 0.45 * wet) this.drip(randomBetween(0.45, 0.9) * (0.7 + 0.3 * wet), pan * 0.8);
        else this.drip(randomBetween(0.4, 1), pan, true);
    }

    /** A drop's ring: falling quickly in pitch, or for a puddle, falling and coming back up (a bloop). */
    _plink(t, frequency, level, puddle, out) {
        const context = this.context;
        const decay = puddle ? 0.17 : 0.07;
        const osc = context.createOscillator();
        osc.type = puddle ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(frequency, t);
        if (puddle) {
            osc.frequency.exponentialRampToValueAtTime(frequency * 0.55, t + 0.025);
            osc.frequency.exponentialRampToValueAtTime(frequency * 0.8, t + decay);
        } else {
            osc.frequency.exponentialRampToValueAtTime(frequency * 0.62, t + 0.05);
        }
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.02);
    }

    /** Water underfoot: a slosh (a narrow band of noise that swings up and back), a hiss of spray, a drop or two. */
    _splash(t, level, out) {
        const context = this.context;
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 3.5;
        const low = randomBetween(420, 650);
        filter.frequency.setValueAtTime(low, t);
        filter.frequency.exponentialRampToValueAtTime(low * randomBetween(2.2, 3), t + 0.05);
        filter.frequency.exponentialRampToValueAtTime(low * 1.2, t + 0.24);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level * 2, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.26);
        source.connect(filter).connect(gain).connect(out);
        source.start(t, Math.random() * 2.5, 0.3);
        this._noise(t + 0.004, 0.08, 'highpass', 4500, 0.7, level * 0.3, out);
        const drops = Math.floor(Math.random() * 3);
        for (let i = 0; i < drops; i++) this._plink(t + randomBetween(0.06, 0.18), randomBetween(1600, 3000), level * 0.12, true, out);
    }

    // ------------------------------------------------------------------ pipes, doors

    /** Something striking the pipes overhead, and the pipes carrying it: one to three rings, moving along. */
    _clang() {
        const t = this.context.currentTime;
        const base = randomBetween(95, 210);
        const drift = randomBetween(-0.3, 0.3);
        const hits = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 2 : 3;
        let pan = randomBetween(-0.9, 0.9);
        let at = t;
        for (let i = 0; i < hits; i++) {
            this._strike(at, base * randomBetween(0.98, 1.02), CLANG_LEVEL * 0.6 ** i * randomBetween(0.7, 1), pan);
            at += randomBetween(0.35, 1.2);
            pan = clamp(pan + drift, -1, 1);
        }
    }

    /** One ring of a pipe, and the tick of whatever hit it. */
    _strike(t, base, level, pan) {
        const context = this.context;
        const out = this._far(pan);
        for (const [ratio, amount, decay] of PIPE_PARTIALS) {
            const osc = context.createOscillator();
            osc.frequency.value = base * ratio * randomBetween(0.997, 1.003);
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(level * amount, t + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
            osc.connect(gain).connect(out);
            osc.start(t);
            osc.stop(t + decay + 0.05);
        }
        this._noise(t, 0.025, 'bandpass', 2400, 1, level * 0.8, out);
    }

    /** Pressure in the pipes: a low, resonant moan that swells and bends. */
    _groan() {
        const context = this.context;
        const t = context.currentTime;
        const length = randomBetween(2.2, 4);
        const low = randomBetween(60, 95);
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0, t);
        envelope.gain.linearRampToValueAtTime(GROAN_LEVEL, t + length * 0.35);
        envelope.gain.linearRampToValueAtTime(GROAN_LEVEL * 0.6, t + length * 0.7);
        envelope.gain.linearRampToValueAtTime(0, t + length);
        envelope.connect(this._far(randomBetween(-0.9, 0.9)));
        // Water forcing its way along: resonant low noise, bending up and settling.
        const source = context.createBufferSource();
        source.buffer = this.brown;
        const band = context.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 9;
        band.frequency.setValueAtTime(low, t);
        band.frequency.exponentialRampToValueAtTime(low * 1.8, t + length * 0.4);
        band.frequency.exponentialRampToValueAtTime(low * 1.1, t + length);
        const bandLevel = context.createGain();
        bandLevel.gain.value = 3;
        source.connect(band).connect(bandLevel).connect(envelope);
        source.start(t, Math.random() * (this.brown.duration - length - 0.1), length + 0.05);
        // The metal complaining: a buzzy tone through the pipe's own resonance.
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(low * 0.6, t);
        osc.frequency.linearRampToValueAtTime(low * 0.75, t + length * 0.5);
        osc.frequency.linearRampToValueAtTime(low * 0.66, t + length);
        const resonance = context.createBiquadFilter();
        resonance.type = 'lowpass';
        resonance.frequency.value = randomBetween(280, 420);
        resonance.Q.value = 7;
        const toneLevel = context.createGain();
        toneLevel.gain.value = 0.18;
        osc.connect(resonance).connect(toneLevel).connect(envelope);
        osc.start(t);
        osc.stop(t + length + 0.05);
    }

    /** Water hammer: a run of knocks travelling along the pipes, from one side over to the other. */
    _knocks() {
        const t = this.context.currentTime;
        const count = 3 + Math.floor(Math.random() * 4);
        const from = Math.random() < 0.5 ? -0.9 : 0.9;
        const pitch = randomBetween(150, 240);
        let at = t;
        for (let i = 0; i < count; i++) {
            const along = i / (count - 1);
            // Loudest as it passes overhead.
            const level = KNOCK_LEVEL * (0.45 + 0.55 * Math.sin(Math.PI * along));
            this._knock(at, pitch * randomBetween(0.95, 1.05), level, from * (1 - 2 * along));
            at += randomBetween(0.16, 0.38);
        }
    }

    _knock(t, frequency, level, pan) {
        const context = this.context;
        const out = this._far(pan);
        for (const [ratio, amount] of [[1, 1], [2.3, 0.35]]) {
            const osc = context.createOscillator();
            osc.frequency.setValueAtTime(frequency * ratio, t);
            osc.frequency.exponentialRampToValueAtTime(frequency * ratio * 0.9, t + 0.12);
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(level * amount, t + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
            osc.connect(gain).connect(out);
            osc.start(t);
            osc.stop(t + 0.18);
        }
        this._noise(t, 0.05, 'bandpass', 700, 1.2, level * 0.8, out);
    }

    /** A heavy door slamming, somewhere across the car park: the latch, then the slam. */
    _door() {
        const t = this.context.currentTime;
        const out = this._far(randomBetween(-0.9, 0.9));
        this._noise(t, 0.03, 'bandpass', 2200, 1.5, 0.2, out);
        const slam = t + randomBetween(0.08, 0.14);
        this._noise(slam, 1.3, 'lowpass', 170, 0.8, DOOR_LEVEL, out);
        this._thump(slam, 70, 34, 0.5, DOOR_LEVEL * 0.8, out);
        // Metal on metal.
        this._noise(slam, 0.06, 'bandpass', 900, 1, DOOR_LEVEL * 0.4, out);
    }

    /** A roller shutter coming down a long way off: a rattling run, and the bang as it lands. */
    _shutter() {
        const context = this.context;
        const t = context.currentTime;
        const length = randomBetween(1.6, 3);
        const out = this._far(randomBetween(-0.9, 0.9));
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        source.loop = true;
        const band = context.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = randomBetween(700, 1100);
        band.Q.value = 1.4;
        // The slats clattering over the drum: the noise chopped up by a fast wobble, slowing as it goes.
        const rattle = context.createGain();
        rattle.gain.value = 0.5;
        const wobble = context.createOscillator();
        wobble.type = 'square';
        wobble.frequency.setValueAtTime(randomBetween(13, 17), t);
        wobble.frequency.linearRampToValueAtTime(randomBetween(9, 11), t + length);
        const depth = context.createGain();
        depth.gain.value = 0.5;
        wobble.connect(depth).connect(rattle.gain);
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0, t);
        envelope.gain.linearRampToValueAtTime(SHUTTER_LEVEL, t + 0.3);
        envelope.gain.setValueAtTime(SHUTTER_LEVEL, t + length - 0.1);
        envelope.gain.linearRampToValueAtTime(0, t + length);
        source.connect(band).connect(rattle).connect(envelope).connect(out);
        source.start(t, Math.random() * 2);
        source.stop(t + length + 0.05);
        wobble.start(t);
        wobble.stop(t + length + 0.05);
        const end = t + length;
        this._noise(end, 1.2, 'lowpass', 160, 0.8, SHUTTER_LEVEL * 1.6, out);
        this._thump(end, 65, 32, 0.45, SHUTTER_LEVEL * 1.2, out);
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

    /** Close by, with a little of the room. */
    _near(pan) {
        const panner = this._panned(pan, this.bus);
        panner.connect(this.room);
        return panner;
    }

    /** Somewhere else in the car park: mostly echo. */
    _far(pan) {
        const panner = this._panned(pan, this.farBus);
        panner.connect(this.distant);
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

    /**
     * A motor running down or up: a buzzy tone sliding in pitch. Running down it fades as it goes; running up
     * it swells, then gives way to the bed.
     */
    _whine(t, from, to, length, level, out) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(to, t + length);
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        if (to < from) {
            gain.gain.linearRampToValueAtTime(level, t + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0005, t + length);
        } else {
            gain.gain.linearRampToValueAtTime(level, t + length * 0.7);
            gain.gain.linearRampToValueAtTime(0, t + length);
        }
        osc.connect(filter).connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + length + 0.05);
    }
}

/**
 * Noise with most of its weight down low (white noise through a one-pole low-pass), normalised, and looping
 * without a click: the start is blended with what would have come after the end.
 */
function createBrownNoise(context, seconds) {
    const rate = context.sampleRate;
    const length = Math.floor(rate * seconds);
    const fade = Math.floor(rate * 0.5);
    const raw = new Float32Array(length + fade);
    const k = 1 - Math.exp((-2 * Math.PI * BROWN_CORNER) / rate);
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
