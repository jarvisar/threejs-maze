/*
 * Level 1 (parking garage) sound. Replaces Level 0's office hum, on top of the rest of the ambience.
 * Ventilation rumble that swells like breathing, a thinner tube hum, distant machinery, drips (more where it's wet),
 * concrete footsteps with slap-back and splashes, pipe clangs/groans/knocks, and rarely a far door or shutter.
 *
 * In a blackout a relay drops out, the hum dies and the ventilation winds down, leaving only water and pipes.
 */

import { levelOneWetness } from '../world/levelOneWater.js';
import { randomBetween } from './Ambience.js';
import { LevelAudio, clamp, createBrownNoise } from './LevelAudio.js';

// Levels before the ambience master. The bed sits about where Level 0's hum does.
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
// Seconds for the plant to wind down on a cut and spin back up on restore.
const SPIN_DOWN = 4.5;
const SPIN_UP = 2.4;
// Seconds between drips [min, max], fully dry and fully wet.
const DRIP_GAP_DRY = [4, 12];
const DRIP_GAP_WET = [0.6, 3];
// Seconds between pipe clangs, pipe groans/knocks, and doors/shutters.
const CLANG_GAP = [25, 70];
const PIPE_GAP = [40, 100];
const DOOR_GAP = [120, 300];
// Struck pipe partials as [ratio, level, decay seconds]. Inharmonic so it rings like metal. The second, slightly
// sharp fundamental beats against the first like a long pipe shimmering.
const PIPE_PARTIALS = [[1, 1, 3.2], [1.006, 0.5, 2.6], [2.76, 0.6, 2.2], [5.4, 0.35, 1.3], [8.9, 0.2, 0.7]];
// Tube hum as [harmonic of 60 Hz, level]. Less fundamental and more buzz than Level 0 so it sounds thinner.
const HUM_HARMONICS = [[1, 0.2], [2, 1], [3, 0.15], [4, 0.5], [5, 0.1], [6, 0.35], [8, 0.22], [10, 0.12], [12, 0.08], [14, 0.04], [16, 0.03]];
const BROWN_CORNER = 100; // Hz, where most of the ventilation rumble sits

// How far around the listener to check for water, for drips.
const WET_REACH = 1.5;

export class LevelOneAudio extends LevelAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        super(ambience);
        this._light = 1;
        this._wet = 0;
        this._humTarget = -1;
        this._humPower = 1;
        this._footLeft = false;
        this._resetTimers();
    }

    /** Builds the bed once the ambience has an audio context (needs a click first). */
    _build() {
        const context = this.ambience.context;
        if (this.built || !context) return this.built;
        this.built = true;
        this.context = context;
        const noise = this.ambience.noise;
        this.brown = createBrownNoise(context, 8, BROWN_CORNER);

        // Dry and reverb buses, both fade with the level.
        this.bus = context.createGain();
        this.bus.gain.value = 0;
        this._connect(this.bus, this.ambience.master);
        this.farBus = context.createGain();
        this.farBus.gain.value = 0;
        this._connect(this.farBus, this.ambience.reverb);
        // Far sounds also go direct, faint and dull, so they keep some edge in the reverb.
        this.distant = context.createBiquadFilter();
        this.distant.type = 'lowpass';
        this.distant.frequency.value = 1400;
        const distantLevel = context.createGain();
        distantLevel.gain.value = 0.3;
        this.distant.connect(distantLevel).connect(this.bus);
        // Close sounds get a little reverb too since it's all bare concrete.
        this.room = context.createGain();
        this.room.gain.value = 0.2;
        this.room.connect(this.farBus);

        // The plant: everything that runs on power and winds down in a cut. _spin entries are
        // [param, running value, stopped value].
        this.plant = context.createGain();
        this.plant.connect(this.bus);
        const plantFar = context.createGain();
        plantFar.connect(this.farBus);
        this._spin = [[this.plant.gain, 1, 0], [plantFar.gain, 1, 0]];

        // Ventilation: deep rumble plus some mid rush for small speakers, both swelling together.
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
        // Air slows and drops in pitch when winding down.
        this._spin.push([vent.playbackRate, 1, 0.3], [ventFilter.frequency, 150, 70], [airFilter.frequency, 420, 160]);

        // Fan motors: two slightly detuned low tones that beat slowly.
        for (const frequency of [52, 52.35]) {
            const osc = context.createOscillator();
            osc.frequency.value = frequency;
            const gain = context.createGain();
            gain.gain.value = MOTOR_LEVEL;
            osc.connect(gain).connect(this.plant);
            osc.start();
            this._spin.push([osc.frequency, frequency, frequency * 0.25]);
        }

        // Distant machinery: low churn, mostly reverb. Three LFOs that never line up keep it from settling.
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

        // Tubes: thinner hum than Level 0 (one oscillator carries all the harmonics) and a faint hiss.
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

        // Footsteps go to effects, not faded with the level. Slap-back off the concrete plus a little reverb.
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

        // The level may have been enabled, or the power cut, before audio existed.
        this._applyEnabled();
        this._applyHum();
        if (this._power < 0.25) {
            this._powerOut = true;
            this._setPlant(false, 0.01);
        }
        return true;
    }

    /** The hum comes from the tubes, so it fades where they're dead. @param {number} level 0..1 */
    setAreaLight(level) {
        this._light = level;
        this._applyHum();
    }

    /**
     * Power level 0..1. The hum follows every stutter. The plant only winds down once the power is really out
     * (see update).
     * @param {number} level
     */
    setPower(level) {
        this._power = level;
        this._applyHum();
    }

    /**
     * Listener position, light and power (see Game). Call every frame before update(). Drips follow how wet it is
     * nearby.
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
     * Footstep at (x, z), with a splash if there's water.
     * @param {number} weight How hard the foot lands (0..1.5).
     * @param {number} x
     * @param {number} z
     */
    step(weight, x, z) {
        this.footstep(weight, levelOneWetness(x, z));
    }

    /** Floor wetness near the listener. Wetter means more and closer drips. @param {number} level 0..1 */
    setWetness(level) {
        this._wet = clamp(level, 0, 1);
    }

    /**
     * Watches the power and schedules drips, pipes and doors. Call every frame while Level 1 is on.
     * @param {number} dt
     */
    update(dt) {
        if (!this.enabled || !this._build()) return;
        this._watchPower(dt);
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;

        // More drips the wetter it is. The min() brings the next one sooner if it just got wetter.
        const most = DRIP_GAP_DRY[1] + (DRIP_GAP_WET[1] - DRIP_GAP_DRY[1]) * this._wet;
        this._untilDrip = Math.min(this._untilDrip - dt, most);
        if (this._untilDrip <= 0) {
            this._untilDrip = randomBetween(DRIP_GAP_DRY[0] + (DRIP_GAP_WET[0] - DRIP_GAP_DRY[0]) * this._wet, most);
            this._randomDrip();
        }

        // Pipes keep going in a blackout.
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

        // No doors or shutters in a blackout.
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
     * Footstep on bare concrete. Heel click, gritty scuff, slap-back off the walls, and a splash in the wet.
     * @param {number} weight How hard the foot lands (0..1.5, higher when sprinting).
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
        // Vary the slap-back since walls are never the same distance away.
        this.slap.delayTime.setTargetAtTime(randomBetween(0.065, 0.105), t, 0.3);
        // Water softens the click.
        wet = clamp(wet, 0, 1);
        const dry = 1 - 0.45 * wet;

        // Heel: hard click with a little body under it.
        this._noise(t, 0.03, 'bandpass', randomBetween(1800, 2800), 1.2, level * 0.55 * dry, out);
        this._thump(t, 130, 70, 0.07, level * 0.35, out);
        // Sole scuffing on grit (longer when landing hard), and sometimes a grain skittering off.
        this._noise(t + 0.012, 0.06 + 0.04 * heavy, 'bandpass', randomBetween(3200, 4400), 0.7, level * 0.2 * dry, out);
        if (Math.random() < 0.35) this._noise(t + randomBetween(0.03, 0.07), 0.012, 'highpass', 4000, 0.7, level * 0.15 * dry, out);
        if (wet > 0.02) this._splash(t, level * wet, out);
    }

    /**
     * One drip. A plink on concrete or a deeper bloop in a puddle.
     * @param {number} level 0..1, from distance.
     * @param {number} pan -1..1
     * @param {boolean} [far] Through the reverb so it sounds farther off.
     * @param {boolean} [puddle] Lands in water. Defaults to random, likelier the wetter it is.
     */
    drip(level, pan, far = false, puddle = Math.random() < 0.15 + 0.7 * this._wet) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.ambienceEnabled || level <= 0.01 || !this._build()) return;
        const t = this.context.currentTime;
        const out = far ? this._far(pan) : this._near(pan);
        const frequency = puddle ? randomBetween(900, 1500) : randomBetween(1500, 2600);
        const loud = level * DRIP_LEVEL * (far ? 0.6 : 1);
        this._plink(t, frequency, loud, puddle, out);
        // Impact.
        this._noise(t, 0.01, 'highpass', 3200, 0.7, loud * 0.5, out);
        // Sometimes a smaller drop bounces up and lands a moment later.
        if (Math.random() < 0.3) this._plink(t + randomBetween(0.05, 0.14), frequency * randomBetween(1.15, 1.5), loud * 0.35, puddle, out);
    }

    /** On entering the level the first pipe sounds come sooner than usual. */
    _resetTimers() {
        this._untilDrip = randomBetween(0.5, 2);
        this._untilClang = randomBetween(6, 20);
        this._untilPipe = randomBetween(20, 50);
        this._untilDoor = randomBetween(60, 180);
    }

    // ------------------------------------------------------------------ power

    /** Heavy relay drops out, the rest of the building follows, and the fans run down. */
    _cut() {
        this._powerOut = true;
        this._setPlant(false, SPIN_DOWN / 3);
        // Pumps stop and the water settles, so the pipes groan or knock soon after.
        this._untilPipe = Math.min(this._untilPipe, randomBetween(2, 5));
        const ambience = this.ambience;
        if (ambience.paused) return;
        const t = this.context.currentTime;
        const near = this._near(randomBetween(-0.3, 0.3));
        this._whine(t, 170, 22, SPIN_DOWN, 0.05, near);
        this._whine(t, 110, 16, SPIN_DOWN * 1.3, 0.05, this._far(randomBetween(-0.6, 0.6)));
        if (!ambience.ambienceEnabled) return;
        // Contactor letting go: hard metal clack and a deep thump.
        this._noise(t, 0.04, 'bandpass', 1500, 2, RELAY_LEVEL * 0.45, near);
        this._thump(t, 150, 90, 0.09, RELAY_LEVEL * 0.4, near);
        this._thump(t + 0.004, 62, 28, 0.7, RELAY_LEVEL, near);
        this._noise(t, 0.6, 'lowpass', 110, 0.8, RELAY_LEVEL * 0.9, near);
        // Then the rest of the building, one bank at a time.
        let at = t + 0.03;
        for (let i = 0; i < 3; i++) {
            const far = this._far(randomBetween(-0.9, 0.9));
            this._noise(at, 1.6, 'lowpass', 170, 0.8, RELAY_LEVEL * (0.8 - 0.2 * i), far);
            this._thump(at, 55, 30, 0.6, RELAY_LEVEL * 0.5 * (1 - 0.25 * i), far);
            at += randomBetween(0.25, 0.7);
        }
    }

    /** Contactors pull in and the plant spins back up. */
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
        // Fast when the lights stutter, slow when walking from lit to dark.
        const quick = Math.abs(power - this._humPower) > 0.05;
        this._humTarget = target;
        this._humPower = power;
        this.hum.gain.setTargetAtTime(target, this.context.currentTime, quick ? 0.012 : 0.5);
    }

    // ------------------------------------------------------------------ water

    /** Random drip nearby. Wetter means closer and more often in a puddle. */
    _randomDrip() {
        const wet = this._wet;
        const pan = randomBetween(-1, 1);
        if (Math.random() < 0.3 + 0.45 * wet) this.drip(randomBetween(0.45, 0.9) * (0.7 + 0.3 * wet), pan * 0.8);
        else this.drip(randomBetween(0.4, 1), pan, true);
    }

    /** Drop tone. Falls fast in pitch, or for a puddle falls and comes back up (a bloop). */
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

    /** Splash underfoot. Slosh (narrow noise band sweeping up and back), spray hiss, and a drop or two. */
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

    /** Pipe clang overhead. One to three rings that drift in pan. */
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

    /** One pipe ring plus the tick of whatever hit it. */
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

    /** Pipe pressure groan. Low resonant moan that swells and bends. */
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
        // Water: resonant low noise that bends up and settles.
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
        // Metal: buzzy tone through a resonant filter.
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

    /** Water hammer. A run of knocks moving along the pipes from one side to the other. */
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

    /** Heavy door slamming somewhere far off. Latch, then slam. */
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

    /** Distant roller shutter coming down. Rattle, then a bang when it lands. */
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
        // Slats clattering over the drum: noise chopped by a fast square LFO that slows down.
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

    /** Close by, with a little reverb. */
    _near(pan) {
        const panner = this._panned(pan, this.bus);
        panner.connect(this.room);
        return panner;
    }

    /** Far off, mostly reverb. */
    _far(pan) {
        const panner = this._panned(pan, this.farBus);
        panner.connect(this.distant);
        return panner;
    }

    /**
     * Motor spinning down or up, a buzzy tone sliding in pitch. Down fades as it goes. Up swells, then hands off
     * to the bed.
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
