/*
 * The sound of Level 2, the tunnels: hot, close, and never quiet. It takes the place of Level 0's office hum, on top of
 * the rest of the ambience:
 *
 * - the plant: the deep roar of the boilers' burners all round, their flutter, a transformer's hum, and a pump
 *   somewhere thumping over slowly;
 * - the steam: a hiss that comes up as you near a leak and dies away as you go on, with a roar under it by the big ones,
 *   and a boiler's fire crackling when you're in front of it;
 * - the pipes, which never stop: ticking as they heat and cool, knocking when the water hammers through them, groaning,
 *   gurgling, and now and then a valve venting somewhere with a long hiss;
 * - footsteps on concrete, close between the walls; a clank on the drains' gratings; a splash in the water;
 * - drips, and the slow plop of the black stuff; very rarely a steel door, a long way off.
 *
 * In a power cut the burners' fans and the pump run down and the hum goes; the fires, the steam and the pipes carry on.
 *
 * All of it synthesised from the ambience's audio context, like everything else.
 */

import { chunkCoord } from '../world/grid.js';
import { MACHINE_BOILER, firePlace, pipeDreamsFloorAt } from '../world/pipeDreams.js';
import { randomBetween } from './Ambience.js';
import { LevelAudio, clamp, createBrownNoise } from './LevelAudio.js';

// How loud each part is, before the ambience's master level.
const ROAR_LEVEL = 0.55;
const FLUTTER_LEVEL = 0.05;
const HUM_LEVEL = 0.13;
const PUMP_LEVEL = 0.16;
const HISS_LEVEL = 0.32;
const JET_LEVEL = 0.4;
const FIRE_LEVEL = 0.45;
const STEP_LEVEL = 1;
const TICK_LEVEL = 0.06;
const KNOCK_LEVEL = 0.26;
const GROAN_LEVEL = 0.2;
const CLANG_LEVEL = 0.09;
const VENT_LEVEL = 0.2;
const GURGLE_LEVEL = 0.13;
const DRIP_LEVEL = 0.24;
const DOOR_LEVEL = 0.4;
const RELAY_LEVEL = 0.4;
// Seconds for the plant to wind down when the power goes, and back up when it returns.
const SPIN_DOWN = 5;
const SPIN_UP = 2.6;
// How often the pump turns over, in seconds.
const PUMP_PERIOD = 1.3;
// Seconds between the pipes ticking, knocking, groaning and clanging; a valve venting; a gurgle; a drip; a door.
const TICK_GAP = [3, 11];
const KNOCK_GAP = [18, 45];
const GROAN_GAP = [30, 80];
const CLANG_GAP = [22, 60];
const VENT_GAP = [25, 60];
const GURGLE_GAP = [14, 40];
const DRIP_GAP = [1.2, 5];
const DOOR_GAP = [100, 240];
// A struck pipe (see LevelOne.js): [ratio, level, seconds to die away].
const PIPE_PARTIALS = [[1, 1, 2.8], [1.007, 0.5, 2.3], [2.76, 0.6, 2], [5.4, 0.35, 1.1], [8.9, 0.2, 0.6]];
// The transformers' hum, as [harmonic of 50 Hz, level]: heavy on the second, gritty higher up.
const HUM_HARMONICS = [[1, 0.35], [2, 1], [3, 0.2], [4, 0.45], [6, 0.25], [8, 0.12], [10, 0.08], [12, 0.05]];
// How far off a leak can be heard, and a fire.
const HISS_REACH = 4;
const FIRE_REACH = 3.2;

export class PipeDreamsAudio extends LevelAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        super(ambience);
        /** @type {import('../world/ChunkStore.js').ChunkStore | null} */
        this.store = null;
        this._light = 1;
        this._humTarget = -1;
        this._humPower = 1;
        this._footLeft = false;
        this._steam = 0;
        /** The leaks and fires near where the listener was last looked for them (see _gather). */
        this._around = { cellX: NaN, cellZ: NaN, leaks: /** @type {number[][]} */ ([]), fires: /** @type {number[][]} */ ([]) };
        this._hiss = 0;
        this._jet = 0;
        this._fire = 0;
        /** What each of those was last eased to (see _ease). */
        this._eased = { hiss: -1, jet: -1, fire: -1 };
        this._resetTimers();
    }

    /** The world it's in (see LevelSound.setWorld): where its leaks and fires are. */
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
        this.brown = createBrownNoise(context, 8, 90);

        this.bus = context.createGain();
        this.bus.gain.value = 0;
        this._connect(this.bus, this.ambience.master);
        this.farBus = context.createGain();
        this.farBus.gain.value = 0;
        this._connect(this.farBus, this.ambience.reverb);
        this.distant = context.createBiquadFilter();
        this.distant.type = 'lowpass';
        this.distant.frequency.value = 1200;
        const distantLevel = context.createGain();
        distantLevel.gain.value = 0.35;
        this.distant.connect(distantLevel).connect(this.bus);
        this.room = context.createGain();
        this.room.gain.value = 0.25;
        this.room.connect(this.farBus);

        // The plant: everything that runs off the power. Each entry in _spin is [param, running, stopped].
        this.plant = context.createGain();
        this.plant.connect(this.bus);
        const plantFar = context.createGain();
        plantFar.connect(this.farBus);
        this._spin = [[this.plant.gain, 1, 0.25], [plantFar.gain, 1, 0.2]];

        // The burners' roar, swelling and settling, and their flutter.
        const breath = context.createGain();
        breath.gain.value = 0.8;
        this._lfo(0.061, 0.12, breath.gain);
        this._lfo(0.023, 0.08, breath.gain);
        breath.connect(this.plant);
        const roarSend = context.createGain();
        roarSend.gain.value = 0.5;
        breath.connect(roarSend).connect(plantFar);
        const roar = this._loop(this.brown, 1);
        const roarFilter = context.createBiquadFilter();
        roarFilter.type = 'lowpass';
        roarFilter.frequency.value = 130;
        roarFilter.Q.value = 0.8;
        this._lfo(0.037, 25, roarFilter.frequency);
        const roarLevel = context.createGain();
        roarLevel.gain.value = ROAR_LEVEL;
        roar.connect(roarFilter).connect(roarLevel).connect(breath);
        const flutter = this._loop(noise, 0.9);
        const flutterFilter = context.createBiquadFilter();
        flutterFilter.type = 'bandpass';
        flutterFilter.frequency.value = 230;
        flutterFilter.Q.value = 1.3;
        const flutterLevel = context.createGain();
        flutterLevel.gain.value = FLUTTER_LEVEL;
        this._lfo(7.3, FLUTTER_LEVEL * 0.6, flutterLevel.gain);
        flutter.connect(flutterFilter).connect(flutterLevel).connect(breath);
        this._spin.push([roar.playbackRate, 1, 0.45], [roarFilter.frequency, 130, 70], [flutterLevel.gain, FLUTTER_LEVEL, 0]);

        // The transformers.
        this.hum = context.createGain();
        this.hum.gain.value = 0;
        this.hum.connect(this.bus);
        const size = HUM_HARMONICS[HUM_HARMONICS.length - 1][0] + 1;
        const real = new Float32Array(size);
        const imag = new Float32Array(size);
        for (const [harmonic, level] of HUM_HARMONICS) imag[harmonic] = level;
        const mains = context.createOscillator();
        mains.setPeriodicWave(context.createPeriodicWave(real, imag));
        mains.frequency.value = 50;
        const swell = context.createGain();
        swell.gain.value = 0.9;
        this._lfo(0.07, 0.1, swell.gain);
        mains.connect(swell).connect(this.hum);
        mains.start();

        // The steam: a hiss, and under the big ones a roar, as loud as the leaks near you make them.
        this.hissLevel = context.createGain();
        this.hissLevel.gain.value = 0;
        this.hissLevel.connect(this.bus);
        const hiss = this._loop(noise, 1.1);
        const hissHigh = context.createBiquadFilter();
        hissHigh.type = 'highpass';
        hissHigh.frequency.value = 1800;
        const hissBand = context.createBiquadFilter();
        hissBand.type = 'peaking';
        hissBand.frequency.value = 5200;
        hissBand.gain.value = 6;
        hiss.connect(hissHigh).connect(hissBand).connect(this.hissLevel);
        this._lfo(0.9, 0.08, this.hissLevel.gain);
        this.jetLevel = context.createGain();
        this.jetLevel.gain.value = 0;
        this.jetLevel.connect(this.bus);
        const jet = this._loop(noise, 0.7);
        const jetFilter = context.createBiquadFilter();
        jetFilter.type = 'bandpass';
        jetFilter.frequency.value = 900;
        jetFilter.Q.value = 0.5;
        jet.connect(jetFilter).connect(this.jetLevel);

        // A fire in front of you: a low roar in the firebox, and crackling (see update).
        this.fireLevel = context.createGain();
        this.fireLevel.gain.value = 0;
        this.fireLevel.connect(this.bus);
        const fire = this._loop(this.brown, 1.8);
        const fireFilter = context.createBiquadFilter();
        fireFilter.type = 'bandpass';
        fireFilter.frequency.value = 320;
        fireFilter.Q.value = 0.7;
        this._lfo(0.4, 60, fireFilter.frequency);
        fire.connect(fireFilter).connect(this.fireLevel);

        // Footsteps: close by, with a quick slap back off the walls either side.
        this.steps = context.createGain();
        this.steps.connect(this.ambience.effects);
        this.slap = context.createDelay(0.2);
        this.slap.delayTime.value = 0.045;
        const slapFilter = context.createBiquadFilter();
        slapFilter.type = 'lowpass';
        slapFilter.frequency.value = 2400;
        const slapLevel = context.createGain();
        slapLevel.gain.value = 0.34;
        this.steps.connect(this.slap).connect(slapFilter).connect(slapLevel).connect(this.ambience.effects);
        const stepRoom = context.createGain();
        stepRoom.gain.value = 0.1;
        this.steps.connect(stepRoom).connect(this.ambience.reverb);

        this._applyEnabled();
        this._applyHum();
        if (this._power < 0.25) {
            this._powerOut = true;
            this._setPlant(false, 0.01);
        }
        return true;
    }

    /**
     * Where the listener is, how lit it is there and how much of the power's on (see Game): every frame, before update().
     * The hiss and the fire follow what's near.
     */
    follow(x, z, areaLight, power) {
        this._light = areaLight;
        this._power = power;
        this._applyHum();
        this._listen(x, z);
    }

    /**
     * A footstep at (x, z): on concrete, on a grating, or in the water.
     * @param {number} weight How hard the foot lands (0..1.5).
     */
    step(weight, x, z) {
        const floor = this.store ? pipeDreamsFloorAt(this.store, x, z) : { grating: false, wet: 0 };
        this.footstep(weight, floor.grating, floor.wet);
    }

    update(dt) {
        if (!this.enabled || !this._build()) return;
        this._watchPower(dt);
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;
        const t = this.context.currentTime;
        // The hiss and the fire, easing to what's near.
        this._ease('hiss', this.hissLevel.gain, HISS_LEVEL * this._hiss, t, 0.15);
        this._ease('jet', this.jetLevel.gain, JET_LEVEL * this._jet, t, 0.2);
        this._ease('fire', this.fireLevel.gain, FIRE_LEVEL * this._fire, t, 0.3);
        if (this._fire > 0.05 && Math.random() < dt * 9 * this._fire) this._crackle(this._fire);

        // The pump, while the power's on.
        this._untilPump -= dt;
        if (this._untilPump <= 0) {
            this._untilPump += PUMP_PERIOD;
            if (!this._powerOut) this._pump();
        }
        for (const [key, gap, sound] of this._events) {
            this[key] -= dt;
            if (this[key] > 0) continue;
            this[key] = randomBetween(gap[0], gap[1]);
            sound.call(this);
        }
    }

    /**
     * Eases a level to `target`, but only when that's moved: a new target every frame would pile up the level's
     * automation events.
     */
    _ease(key, param, target, t, timeConstant) {
        if (Math.abs(target - this._eased[key]) < 0.003) return;
        this._eased[key] = target;
        param.setTargetAtTime(target, t, timeConstant);
    }

    // ------------------------------------------------------------------ listening round

    /** How near the listener the leaks and the fires are: the hiss, the big ones' roar, and the fire. */
    _listen(x, z) {
        const store = this.store;
        if (!store) return;
        const cellX = Math.round(x);
        const cellZ = Math.round(z);
        const near = this._around;
        if (cellX !== near.cellX || cellZ !== near.cellZ) this._gather(store, cellX, cellZ);
        let hiss = 0;
        let jet = 0;
        for (const [lx, ly, lz, strength] of near.leaks) {
            const d = Math.hypot(lx - x, (ly - 0.5) * 0.5, lz - z);
            const reach = Math.max(0, 1 - d / HISS_REACH);
            hiss += strength * reach * reach;
            jet += strength * strength * Math.max(0, 1 - d / 1.6) ** 2;
        }
        let fire = 0;
        for (const [fx, fz] of near.fires) fire = Math.max(fire, Math.max(0, 1 - Math.hypot(fx - x, fz - z) / FIRE_REACH) ** 2);
        this._hiss = clamp(0.05 + hiss * 0.6, 0, 1.2);
        this._jet = clamp(jet * 0.5, 0, 1);
        this._fire = fire;
    }

    /** The leaks and fires within earshot of a cell, from the chunks round it. */
    _gather(store, cellX, cellZ) {
        const near = this._around;
        near.cellX = cellX;
        near.cellZ = cellZ;
        near.leaks.length = 0;
        near.fires.length = 0;
        const reach = HISS_REACH + 1;
        for (let cx = chunkCoord(Math.floor(cellX - reach)); cx <= chunkCoord(Math.ceil(cellX + reach)); cx++) {
            for (let cz = chunkCoord(Math.floor(cellZ - reach)); cz <= chunkCoord(Math.ceil(cellZ + reach)); cz++) {
                const data = store.getChunk(cx, cz).pipeDreams;
                if (!data) continue;
                for (const leak of data.leaks) {
                    if (Math.abs(leak.x - cellX) < reach && Math.abs(leak.z - cellZ) < reach) near.leaks.push([leak.x, leak.y, leak.z, leak.vent ? 0.7 : leak.strength]);
                }
                for (const machine of data.machines) {
                    if (machine.type === MACHINE_BOILER) near.fires.push(firePlace(machine));
                }
            }
        }
    }

    // ------------------------------------------------------------------ footsteps

    /**
     * A footstep: a heel's click and a scuff on the concrete, a clank on a grating, a splash in the water.
     * @param {number} weight 0..1.5
     * @param {boolean} [grating]
     * @param {number} [wet] 0..1
     */
    footstep(weight, grating = false, wet = 0) {
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.footstepsEnabled || weight < 0.05 || !this._build()) return;
        this._footLeft = !this._footLeft;
        const t = this.context.currentTime;
        const heavy = Math.min(weight, 1.5);
        const level = heavy * STEP_LEVEL;
        const out = this._panned(this._footLeft ? -0.08 : 0.08, this.steps);
        this.slap.delayTime.setTargetAtTime(randomBetween(0.035, 0.06), t, 0.3);
        if (grating) {
            // Steel bars rattling in their frame, and ringing a little.
            this._noise(t, 0.05, 'bandpass', randomBetween(1300, 1900), 2.5, level * 0.45, out);
            for (const [ratio, amount] of [[1, 1], [2.3, 0.5], [3.9, 0.3]]) this._tone(t, randomBetween(560, 640) * ratio, 0.14, level * 0.05 * amount, out);
            this._noise(t + randomBetween(0.03, 0.06), 0.03, 'bandpass', 2600, 2, level * 0.18, out);
            this._thump(t, 110, 60, 0.08, level * 0.25, out);
            return;
        }
        const dry = 1 - 0.45 * wet;
        this._noise(t, 0.03, 'bandpass', randomBetween(1700, 2600), 1.2, level * 0.55 * dry, out);
        this._thump(t, 125, 68, 0.07, level * 0.35, out);
        this._noise(t + 0.012, 0.06 + 0.04 * heavy, 'bandpass', randomBetween(3000, 4200), 0.7, level * 0.22 * dry, out);
        if (Math.random() < 0.3) this._noise(t + randomBetween(0.03, 0.07), 0.012, 'highpass', 4000, 0.7, level * 0.14 * dry, out);
        if (wet > 0.05) this._splash(t, level * wet, out);
    }

    /** Water underfoot: a slosh, a hiss of spray, a drop or two. */
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
    }

    // ------------------------------------------------------------------ the plant

    /** The pump turning over, somewhere through the walls: a heavy stroke, and the water shoved along. */
    _pump() {
        const t = this.context.currentTime;
        const out = this._far(-0.4 + 0.2 * Math.sin(t * 0.05));
        this._thump(t, 68, 42, 0.4, PUMP_LEVEL, out);
        this._noise(t + 0.05, 0.45, 'lowpass', 260, 0.8, PUMP_LEVEL * 0.8, out);
    }

    /** The fire in the box: a crack, now and then a pop. */
    _crackle(level) {
        const t = this.context.currentTime;
        const out = this._panned(randomBetween(-0.3, 0.3), this.bus);
        this._noise(t, randomBetween(0.006, 0.02), 'highpass', randomBetween(1500, 3500), 0.7, FIRE_LEVEL * 0.4 * level, out);
        if (Math.random() < 0.15) this._thump(t, 180, 90, 0.05, FIRE_LEVEL * 0.3 * level, out);
    }

    _cut() {
        this._powerOut = true;
        this._setPlant(false, SPIN_DOWN / 3);
        this._untilKnock = Math.min(this._untilKnock, randomBetween(2, 5));
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;
        const t = this.context.currentTime;
        const near = this._near(randomBetween(-0.3, 0.3));
        this._noise(t, 0.04, 'bandpass', 1500, 2, RELAY_LEVEL * 0.45, near);
        this._thump(t, 150, 90, 0.09, RELAY_LEVEL * 0.4, near);
        this._thump(t + 0.004, 58, 26, 0.7, RELAY_LEVEL, near);
        this._whine(t, 140, 20, SPIN_DOWN, 0.05, this._far(randomBetween(-0.6, 0.6)));
    }

    _restore() {
        this._powerOut = false;
        this._setPlant(true, SPIN_UP / 3);
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;
        const t = this.context.currentTime;
        const near = this._near(randomBetween(-0.3, 0.3));
        this._noise(t, 0.035, 'bandpass', 1700, 2, RELAY_LEVEL * 0.45, near);
        this._thump(t, 120, 60, 0.25, RELAY_LEVEL * 0.4, near);
        this._whine(t, 22, 140, SPIN_UP * 1.4, 0.035, this._far(randomBetween(-0.8, 0.8)));
        // The burners lighting again.
        this._noise(t + 0.4, 1.2, 'lowpass', 200, 0.8, RELAY_LEVEL * 0.6, this._far(randomBetween(-0.8, 0.8)));
    }

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

    /** The hum comes from the transformers: it follows the power, stutter and all, and the lights round about. */
    _applyHum() {
        if (!this.built) return;
        const power = clamp((this._power - 0.2) / 0.6, 0, 1);
        const target = HUM_LEVEL * (0.3 + 0.7 * this._light) * power;
        if (Math.abs(target - this._humTarget) < HUM_LEVEL * 0.01) return;
        const quick = Math.abs(power - this._humPower) > 0.05;
        this._humTarget = target;
        this._humPower = power;
        this.hum.gain.setTargetAtTime(target, this.context.currentTime, quick ? 0.012 : 0.5);
    }

    _resetTimers() {
        this._untilPump = 0.5;
        this._untilTick = randomBetween(1, 4);
        this._untilKnock = randomBetween(8, 20);
        this._untilGroan = randomBetween(15, 40);
        this._untilClang = randomBetween(6, 18);
        this._untilVent = randomBetween(10, 30);
        this._untilGurgle = randomBetween(6, 20);
        this._untilDrip = randomBetween(0.5, 2);
        this._untilDoor = randomBetween(60, 150);
        /** @type {[string, number[], () => void][]} */
        this._events = [
            ['_untilTick', TICK_GAP, this._ticks],
            ['_untilKnock', KNOCK_GAP, this._knocks],
            ['_untilGroan', GROAN_GAP, this._groan],
            ['_untilClang', CLANG_GAP, this._clang],
            ['_untilVent', VENT_GAP, this._vent],
            ['_untilGurgle', GURGLE_GAP, this._gurgle],
            ['_untilDrip', DRIP_GAP, this._drip],
            ['_untilDoor', DOOR_GAP, this._door],
        ];
    }

    // ------------------------------------------------------------------ the pipes

    /** Pipes ticking as they heat and cool: a run of small, dry clicks, uneven, moving along. */
    _ticks() {
        const t = this.context.currentTime;
        const count = 3 + Math.floor(Math.random() * 7);
        let pan = randomBetween(-0.9, 0.9);
        const drift = randomBetween(-0.15, 0.15);
        const pitch = randomBetween(2400, 4200);
        let at = t;
        for (let i = 0; i < count; i++) {
            const out = Math.random() < 0.6 ? this._near(pan) : this._far(pan);
            this._noise(at, 0.012, 'bandpass', pitch * randomBetween(0.9, 1.1), 4, TICK_LEVEL * randomBetween(0.5, 1), out);
            at += randomBetween(0.07, 0.45);
            pan = clamp(pan + drift, -1, 1);
        }
    }

    /** Water hammer: a run of knocks going along the pipes from one side to the other. */
    _knocks() {
        const t = this.context.currentTime;
        const count = 3 + Math.floor(Math.random() * 5);
        const from = Math.random() < 0.5 ? -0.9 : 0.9;
        const pitch = randomBetween(130, 220);
        let at = t;
        for (let i = 0; i < count; i++) {
            const along = i / (count - 1);
            const level = KNOCK_LEVEL * (0.45 + 0.55 * Math.sin(Math.PI * along));
            const out = this._far(from * (1 - 2 * along));
            for (const [ratio, amount] of [[1, 1], [2.3, 0.35]]) this._tone(at, pitch * ratio, 0.16, level * amount, out, 0.9);
            this._noise(at, 0.05, 'bandpass', 700, 1.2, level * 0.8, out);
            at += randomBetween(0.14, 0.34);
        }
    }

    /** Pressure in the pipes: a low moan that swells and bends. */
    _groan() {
        const context = this.context;
        const t = context.currentTime;
        const length = randomBetween(2.2, 4.5);
        const low = randomBetween(55, 90);
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0, t);
        envelope.gain.linearRampToValueAtTime(GROAN_LEVEL, t + length * 0.35);
        envelope.gain.linearRampToValueAtTime(GROAN_LEVEL * 0.6, t + length * 0.7);
        envelope.gain.linearRampToValueAtTime(0, t + length);
        envelope.connect(this._far(randomBetween(-0.9, 0.9)));
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
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(low * 0.6, t);
        osc.frequency.linearRampToValueAtTime(low * 0.78, t + length * 0.5);
        osc.frequency.linearRampToValueAtTime(low * 0.66, t + length);
        const resonance = context.createBiquadFilter();
        resonance.type = 'lowpass';
        resonance.frequency.value = randomBetween(260, 420);
        resonance.Q.value = 7;
        const toneLevel = context.createGain();
        toneLevel.gain.value = 0.18;
        osc.connect(resonance).connect(toneLevel).connect(envelope);
        osc.start(t);
        osc.stop(t + length + 0.05);
    }

    /** Something striking the pipes: one to three rings. */
    _clang() {
        const context = this.context;
        const t = context.currentTime;
        const base = randomBetween(90, 200);
        const hits = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 2 : 3;
        const pan = randomBetween(-0.9, 0.9);
        let at = t;
        for (let i = 0; i < hits; i++) {
            const out = this._far(pan);
            const level = CLANG_LEVEL * 0.6 ** i * randomBetween(0.7, 1);
            for (const [ratio, amount, decay] of PIPE_PARTIALS) this._tone(at, base * ratio * randomBetween(0.997, 1.003), decay, level * amount, out, 1);
            this._noise(at, 0.025, 'bandpass', 2400, 1, level * 0.8, out);
            at += randomBetween(0.35, 1.2);
        }
    }

    /** A valve venting somewhere: a hard hiss that swells and dies, with a thud as it opens. */
    _vent() {
        const context = this.context;
        const t = context.currentTime;
        const length = randomBetween(1.2, 3.2);
        const near = Math.random() < 0.3;
        const out = near ? this._near(randomBetween(-0.8, 0.8)) : this._far(randomBetween(-0.9, 0.9));
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        source.loop = true;
        const high = context.createBiquadFilter();
        high.type = 'highpass';
        high.frequency.setValueAtTime(900, t);
        high.frequency.exponentialRampToValueAtTime(2200, t + length);
        const gain = context.createGain();
        const level = VENT_LEVEL * (near ? 0.7 : 1);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.06);
        gain.gain.setValueAtTime(level * 0.9, t + length * 0.6);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + length);
        source.connect(high).connect(gain).connect(out);
        source.start(t, Math.random() * 2);
        source.stop(t + length + 0.05);
        this._thump(t, 90, 50, 0.2, level * 0.8, out);
    }

    /** Water forcing its way along a pipe: a run of bubbling blips, rising. */
    _gurgle() {
        const t = this.context.currentTime;
        const out = this._far(randomBetween(-0.9, 0.9));
        const count = 5 + Math.floor(Math.random() * 8);
        let at = t;
        let frequency = randomBetween(260, 420);
        for (let i = 0; i < count; i++) {
            this._noise(at, randomBetween(0.03, 0.08), 'bandpass', frequency, 8, GURGLE_LEVEL * randomBetween(0.5, 1), out);
            at += randomBetween(0.04, 0.16);
            frequency *= randomBetween(1.02, 1.12);
        }
    }

    /** A drop: a plink of water, or the slow, thick plop of the black stuff. */
    _drip() {
        const context = this.context;
        const t = context.currentTime;
        const thick = Math.random() < 0.35;
        const near = Math.random() < 0.45;
        const out = near ? this._near(randomBetween(-0.8, 0.8)) : this._far(randomBetween(-1, 1));
        const level = DRIP_LEVEL * randomBetween(0.4, 1) * (near ? 1 : 0.6);
        const osc = context.createOscillator();
        osc.type = 'sine';
        const frequency = thick ? randomBetween(180, 300) : randomBetween(1300, 2400);
        const decay = thick ? 0.22 : 0.07;
        osc.frequency.setValueAtTime(frequency, t);
        osc.frequency.exponentialRampToValueAtTime(frequency * (thick ? 0.5 : 0.62), t + decay * 0.8);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + (thick ? 0.01 : 0.002));
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.02);
        this._noise(t, 0.01, 'highpass', thick ? 1200 : 3200, 0.7, level * 0.4, out);
    }

    /** A steel door slamming a long way off. */
    _door() {
        if (this._powerOut) return;
        const t = this.context.currentTime;
        const out = this._far(randomBetween(-0.9, 0.9));
        this._noise(t, 0.03, 'bandpass', 2200, 1.5, 0.18, out);
        const slam = t + randomBetween(0.08, 0.14);
        this._noise(slam, 1.3, 'lowpass', 170, 0.8, DOOR_LEVEL, out);
        this._thump(slam, 70, 34, 0.5, DOOR_LEVEL * 0.8, out);
        for (const [ratio, amount, decay] of PIPE_PARTIALS.slice(0, 3)) this._tone(slam, 140 * ratio, decay * 0.5, DOOR_LEVEL * 0.08 * amount, out, 1);
    }

    // ------------------------------------------------------------------ building blocks

    /** A ringing tone: a quick attack, dying away (and dropping a little in pitch, by `bend`). */
    _tone(t, frequency, decay, level, out, bend = 1) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(frequency, t);
        if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(frequency * bend, t + decay * 0.8);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + decay + 0.05);
    }

    /** A motor running down or up. */
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

    /** Close by, with a little of the tunnel. */
    _near(pan) {
        const panner = this._panned(pan, this.bus);
        panner.connect(this.room);
        return panner;
    }

    /** Somewhere else in the tunnels: mostly echo. */
    _far(pan) {
        const panner = this._panned(pan, this.farBus);
        panner.connect(this.distant);
        return panner;
    }
}
