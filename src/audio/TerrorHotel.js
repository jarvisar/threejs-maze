/*
 * The sound of Level 5, the hotel: quiet, carpeted, and never quite empty. It takes the place of Level 0's office hum,
 * on top of the rest of the ambience:
 *
 * - the old wiring's low hum, and the stillness of the air;
 * - a band playing somewhere: a slow foxtrot, bass, piano, brushes and a muted horn, heard through the walls and down
 *   the corridors like an old record, wavering; now nearer, now further off, and nearest in the ballroom; now and then
 *   it drags, as if the record were slowing, or stops, and starts again;
 * - a party going on with it, somewhere you can't find: a murmur of voices, a laugh, a glass;
 * - a long-case clock ticking, when you're near one; a lift's motor humming behind its doors, and its bell;
 * - knocking on a door somewhere, a door closing, the building creaking; and behind a door with light under it,
 *   footsteps;
 * - footsteps muffled by carpet, sharp on marble, squeaking on the staff passages' linoleum.
 *
 * In a power cut the hum dies and the lifts stop. The band plays on.
 *
 * All of it synthesised from the ambience's audio context, like everything else. The music is scheduled a little
 * ahead as it plays.
 */

import { chunkCoord } from '../world/grid.js';
import { DOOR_ELEVATOR, DOOR_LIT, terrorHotelFloorAt } from '../world/terrorHotel.js';
import { FURN_CLOCK } from '../world/terrorHotelFurniture.js';
import { ZONE_BALLROOM } from '../world/zones.js';
import { randomBetween } from './Ambience.js';
import { LevelAudio, clamp, createBrownNoise } from './LevelAudio.js';

// How loud each part is, before the ambience's master level.
const HUM_LEVEL = 0.1;
const AIR_LEVEL = 0.12;
const BAND_LEVEL = 0.34;
const CROWD_LEVEL = 0.1;
const LAUGH_LEVEL = 0.16;
const GLASS_LEVEL = 0.05;
const TICK_LEVEL = 0.22;
const CHIME_LEVEL = 0.2;
const LIFT_HUM_LEVEL = 0.1;
const DING_LEVEL = 0.26;
const KNOCK_LEVEL = 0.4;
const CREAK_LEVEL = 0.16;
const DOOR_LEVEL = 0.4;
const STEPS_BEHIND_LEVEL = 0.24;
const STEP_LEVEL = 1;
const RELAY_LEVEL = 0.3;

// The band: its tempo (beats a minute), how far ahead it's scheduled, and its tune.
const TEMPO = 92;
const LOOKAHEAD = 0.35;
// Each bar's chord, as its bass root and the piano's voicing (MIDI notes): D minor, a slow and sad one.
const BARS = [
    { root: 38, chord: [62, 65, 69] },
    { root: 38, chord: [62, 65, 69] },
    { root: 43, chord: [62, 67, 70] },
    { root: 45, chord: [61, 64, 67] },
    { root: 38, chord: [62, 65, 69] },
    { root: 46, chord: [62, 65, 70] },
    { root: 40, chord: [62, 67, 70] },
    { root: 45, chord: [61, 64, 67] },
];
// The horn's tune, as [note, beats] (null for a rest): eight bars of four.
const TUNE = [
    [69, 1], [65, 0.5], [64, 0.5], [62, 1], [null, 1],
    [64, 0.5], [65, 0.5], [69, 1], [74, 1.5], [null, 0.5],
    [74, 1], [72, 0.5], [70, 0.5], [67, 1], [null, 1],
    [69, 1], [73, 1], [76, 1], [null, 1],
    [77, 1.5], [76, 0.5], [74, 1], [69, 1],
    [70, 1], [74, 0.5], [72, 0.5], [70, 1], [65, 1],
    [67, 1], [70, 1], [73, 1.5], [null, 0.5],
    [69, 2], [61, 1], [null, 1],
];
const BEATS = BARS.length * 4;

// Seconds between the band's moods (how near it seems), the laughter, a glass, the knocking, the creaks, a door, the
// lifts' bell far off, and the band stopping.
const NEAR_GAP = [18, 45];
const LAUGH_GAP = [20, 55];
const GLASS_GAP = [8, 25];
const KNOCK_GAP = [60, 160];
const CREAK_GAP = [25, 70];
const DOOR_GAP = [90, 220];
const DING_GAP = [70, 180];
const PAUSE_GAP = [140, 320];
// How far off a clock can be heard, a lift, and someone behind a door.
const CLOCK_REACH = 3.2;
const LIFT_REACH = 3.5;
const BEHIND_REACH = 2.5;
// The long-case clock's bell (Westminster's first quarter), as MIDI notes.
const QUARTER = [68, 66, 64, 59];

const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export class TerrorHotelAudio extends LevelAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        super(ambience);
        /** @type {import('../world/ChunkStore.js').ChunkStore | null} */
        this.store = null;
        this._light = 1;
        this._humTarget = -1;
        this._footLeft = false;
        /** How near the band seems (0..1): drifting, and nearest in the ballroom. */
        this._nearness = 0.3;
        this._nearTarget = 0.3;
        this._ballroom = 0;
        this._clock = 0;
        this._lift = 0;
        this._behind = 0;
        // The band's place in the tune, and when its next beat is due.
        this._beat = 0;
        this._nextBeat = 0;
        this._tuneAt = 0;
        this._nextNote = 0;
        this._stopped = 0;
        this._drag = 0;
        /** What's near the listener (see _gather). */
        this._around = { cellX: NaN, cellZ: NaN, clock: Infinity, clockPan: 0, lift: Infinity, liftPan: 0, lit: Infinity, litPan: 0 };
        this._tick = 0;
        this._resetTimers();
    }

    /** The world it's in (see LevelSound.setWorld): where its clocks, its lifts and its lit doors are. */
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

        // The wiring's hum, following the lights, and the still air.
        this.hum = context.createGain();
        this.hum.gain.value = 0;
        this.hum.connect(this.bus);
        const real = new Float32Array(7);
        const imag = new Float32Array(7);
        for (const [harmonic, level] of [[1, 0.7], [2, 0.5], [3, 0.25], [4, 0.12], [6, 0.05]]) imag[harmonic] = level;
        const mains = context.createOscillator();
        mains.setPeriodicWave(context.createPeriodicWave(real, imag));
        mains.frequency.value = 50;
        const humFilter = context.createBiquadFilter();
        humFilter.type = 'lowpass';
        humFilter.frequency.value = 260;
        mains.connect(humFilter).connect(this.hum);
        mains.start();
        const air = this._loop(this.brown, 1);
        const airFilter = context.createBiquadFilter();
        airFilter.type = 'lowpass';
        airFilter.frequency.value = 180;
        const airLevel = context.createGain();
        airLevel.gain.value = AIR_LEVEL;
        this._lfo(0.05, 0.04, airLevel.gain);
        air.connect(airFilter).connect(airLevel).connect(this.bus);

        // The band, and the party: through the walls, like an old record (a narrow band of it, and dull), louder and
        // clearer the nearer it seems; a little always in the echo.
        this.music = context.createGain();
        this.music.gain.value = 0;
        this.record = context.createBiquadFilter();
        this.record.type = 'lowpass';
        this.record.frequency.value = 600;
        this.record.Q.value = 0.6;
        const thin = context.createBiquadFilter();
        thin.type = 'highpass';
        thin.frequency.value = 170;
        this.music.connect(thin).connect(this.record).connect(this.bus);
        const musicEcho = context.createGain();
        musicEcho.gain.value = 0.55;
        this.record.connect(musicEcho).connect(this.farBus);
        // The record's surface: a quiet hiss, and crackle (see update).
        const surface = this._loop(noise, 0.7);
        const surfaceFilter = context.createBiquadFilter();
        surfaceFilter.type = 'bandpass';
        surfaceFilter.frequency.value = 2500;
        surfaceFilter.Q.value = 0.4;
        const surfaceLevel = context.createGain();
        surfaceLevel.gain.value = 0.012;
        surface.connect(surfaceFilter).connect(surfaceLevel).connect(this.music);

        // The party: a crowd talking, a few formants of noise, each coming and going.
        this.crowd = context.createGain();
        this.crowd.gain.value = 0;
        const crowdDull = context.createBiquadFilter();
        crowdDull.type = 'lowpass';
        crowdDull.frequency.value = 1100;
        this.crowd.connect(crowdDull).connect(this.bus);
        const crowdEcho = context.createGain();
        crowdEcho.gain.value = 0.8;
        crowdDull.connect(crowdEcho).connect(this.farBus);
        for (const [frequency, q, rate] of [[380, 3, 3.1], [720, 4, 4.3], [1150, 5, 5.7], [520, 3, 2.3]]) {
            const voices = this._loop(this.brown, randomBetween(1.8, 2.4));
            const formant = context.createBiquadFilter();
            formant.type = 'bandpass';
            formant.frequency.value = frequency;
            formant.Q.value = q;
            this._lfo(rate * 0.13, frequency * 0.12, formant.frequency);
            const chatter = context.createGain();
            chatter.gain.value = 0.9;
            this._lfo(rate, 0.5, chatter.gain);
            this._lfo(rate * 0.37, 0.35, chatter.gain);
            voices.connect(formant).connect(chatter).connect(this.crowd);
        }

        // A lift's motor, behind its doors (when near one; see follow).
        this.liftHum = context.createGain();
        this.liftHum.gain.value = 0;
        this.liftPan = context.createStereoPanner();
        this.liftHum.connect(this.liftPan).connect(this.bus);
        const motor = context.createOscillator();
        motor.type = 'sawtooth';
        motor.frequency.value = 46;
        const motorFilter = context.createBiquadFilter();
        motorFilter.type = 'lowpass';
        motorFilter.frequency.value = 160;
        motor.connect(motorFilter).connect(this.liftHum);
        motor.start();
        const cable = this._loop(noise, 0.4);
        const cableFilter = context.createBiquadFilter();
        cableFilter.type = 'bandpass';
        cableFilter.frequency.value = 900;
        cableFilter.Q.value = 2;
        const cableLevel = context.createGain();
        cableLevel.gain.value = 0.15;
        this._lfo(0.3, 0.1, cableLevel.gain);
        cable.connect(cableFilter).connect(cableLevel).connect(this.liftHum);
        this._spin = [[mains.frequency, 50, 20], [motor.frequency, 46, 12]];

        // Footsteps: heard close by, with a little of the room.
        this.steps = context.createGain();
        this.steps.connect(this.ambience.effects);
        const stepRoom = context.createGain();
        stepRoom.gain.value = 0.1;
        this.steps.connect(stepRoom).connect(this.ambience.reverb);

        this._applyEnabled();
        this._applyHum();
        this._applyNear(0.01);
        return true;
    }

    /**
     * Where the listener is, how lit it is there and how much of the power's on (see Game): every frame, before
     * update(). The band's nearer in the ballroom; the clocks, the lifts and whoever's behind a lit door, when you're
     * by one.
     */
    follow(x, z, areaLight, power) {
        this._light = areaLight;
        this._power = power;
        this._applyHum();
        if (!this.store) return;
        const cellX = Math.floor(x + 0.5);
        const cellZ = Math.floor(z + 0.5);
        if (cellX !== this._around.cellX || cellZ !== this._around.cellZ) this._gather(cellX, cellZ);
        const around = this._around;
        this._ballroom = this.store.getChunk(chunkCoord(cellX), chunkCoord(cellZ)).zone.type === ZONE_BALLROOM ? 1 : 0;
        // How near each thing is (as it was when the cell was entered: close enough for a sound).
        this._clock = clamp(1 - around.clock / CLOCK_REACH, 0, 1);
        this._lift = clamp(1 - around.lift / LIFT_REACH, 0, 1);
        this._behind = clamp(1 - around.lit / BEHIND_REACH, 0, 1);
        if (this.built) {
            const t = this.context.currentTime;
            this.liftHum.gain.setTargetAtTime(LIFT_HUM_LEVEL * this._lift * this._lift * (this._powerOut ? 0 : 1), t, 0.3);
            this.liftPan.pan.setTargetAtTime(around.liftPan, t, 0.3);
        }
    }

    /** The clocks, lifts and lit doors round a cell: how far to the nearest of each, and which way. */
    _gather(cellX, cellZ) {
        const around = this._around;
        around.cellX = cellX;
        around.cellZ = cellZ;
        around.clock = Infinity;
        around.lift = Infinity;
        around.lit = Infinity;
        const cx = chunkCoord(cellX);
        const cz = chunkCoord(cellZ);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const data = this.store.getChunk(cx + dx, cz + dz).terrorHotel;
                if (!data) continue;
                for (const piece of data.furniture) {
                    if (piece.type !== FURN_CLOCK) continue;
                    const d = Math.hypot(piece.x - cellX, piece.z - cellZ);
                    if (d < around.clock) {
                        around.clock = d;
                        around.clockPan = clamp((piece.x - cellX) * 0.3, -0.8, 0.8);
                    }
                }
                for (const door of data.doors) {
                    if (door.kind !== DOOR_ELEVATOR && door.state !== DOOR_LIT) continue;
                    const wx = door.axis === 0 ? door.x + 0.5 : door.x;
                    const wz = door.axis === 0 ? door.z : door.z + 0.5;
                    const d = Math.hypot(wx - cellX, wz - cellZ);
                    if (door.kind === DOOR_ELEVATOR && d < around.lift) {
                        around.lift = d;
                        around.liftPan = clamp((wx - cellX) * 0.3, -0.8, 0.8);
                    } else if (door.state === DOOR_LIT && d < around.lit) {
                        around.lit = d;
                        around.litPan = clamp((wx - cellX) * 0.3, -0.8, 0.8);
                    }
                }
            }
        }
    }

    /** A footstep at (x, z): on carpet (the ambience's own), marble, or linoleum. */
    step(weight, x, z) {
        const floor = this.store ? terrorHotelFloorAt(this.store, x, z) : 0;
        if (floor === 0) {
            this.ambience.footstep(weight * 0.8);
            return;
        }
        const ambience = this.ambience;
        if (!ambience.context || ambience.paused || !ambience.footstepsEnabled || weight < 0.05 || !this._build()) return;
        this._footLeft = !this._footLeft;
        const t = this.context.currentTime;
        const level = Math.min(weight, 1.5) * STEP_LEVEL;
        const out = this._panned(this._footLeft ? -0.08 : 0.08, this.steps);
        if (floor === 1) {
            // A heel on marble: a hard click, ringing a little.
            this._noise(t, 0.025, 'bandpass', randomBetween(2400, 3400), 2, level * 0.5, out);
            this._thump(t, 180, 110, 0.05, level * 0.3, out);
            this._noise(t + 0.01, 0.18, 'bandpass', randomBetween(1200, 1500), 8, level * 0.12, out);
        } else {
            // A rubber sole on linoleum: a soft slap, and now and then a squeak.
            this._noise(t, 0.04, 'bandpass', randomBetween(900, 1300), 1.2, level * 0.45, out);
            this._thump(t, 120, 70, 0.06, level * 0.3, out);
            if (Math.random() < 0.25) this._squeak(t + randomBetween(0.03, 0.06), level * 0.08, out);
        }
    }

    /** Keeps the level going: the band, the party, the clock, and everything else now and then. */
    update(dt) {
        if (!this.enabled || !this._build()) return;
        this._watchPower(dt);
        const ambience = this.ambience;
        if (ambience.paused) return;
        const t = this.context.currentTime;

        // The band, now nearer, now further off.
        this._untilNear -= dt;
        if (this._untilNear <= 0) {
            this._untilNear = randomBetween(NEAR_GAP[0], NEAR_GAP[1]);
            this._nearTarget = Math.random() < 0.3 ? randomBetween(0.55, 0.85) : randomBetween(0.05, 0.4);
        }
        const wanted = Math.max(this._nearTarget, 0.7 * this._ballroom + 0.25 * this._nearTarget);
        this._nearness += (wanted - this._nearness) * Math.min(dt * 0.15, 1);
        this._applyNear(1.5);
        if (!ambience.ambienceEnabled) return;
        this._playBand(t, dt);

        // The party's noises.
        this._untilLaugh -= dt;
        if (this._untilLaugh <= 0) {
            this._untilLaugh = randomBetween(LAUGH_GAP[0], LAUGH_GAP[1]);
            this._laugh(t);
        }
        this._untilGlass -= dt;
        if (this._untilGlass <= 0) {
            this._untilGlass = randomBetween(GLASS_GAP[0], GLASS_GAP[1]);
            this._glass(t);
        }
        // A clock, when you're by one: a tick a second, and the quarter now and then.
        if (this._clock > 0) {
            this._tick -= dt;
            if (this._tick <= 0) {
                this._tick += 1;
                this._tock = !this._tock;
                this._clockTick(t, this._clock);
                this._untilChime -= 1;
                if (this._untilChime <= 0) {
                    this._untilChime = Math.floor(randomBetween(90, 200));
                    this._chime(t + 0.5, this._clock);
                }
            }
        }
        this._untilKnock -= dt;
        if (this._untilKnock <= 0) {
            this._untilKnock = randomBetween(KNOCK_GAP[0], KNOCK_GAP[1]);
            this._knock(t, this._behind > 0 ? this._around.litPan : randomBetween(-0.9, 0.9), this._behind > 0);
        }
        // Behind a door with light under it: someone walking about.
        if (this._behind > 0.2) {
            this._untilBehind -= dt;
            if (this._untilBehind <= 0) {
                this._untilBehind = randomBetween(9, 22);
                this._stepsBehind(t, this._behind, this._around.litPan);
            }
        }
        this._untilCreak -= dt;
        if (this._untilCreak <= 0) {
            this._untilCreak = randomBetween(CREAK_GAP[0], CREAK_GAP[1]);
            this._creak(t);
        }
        this._untilDoor -= dt;
        if (this._untilDoor <= 0) {
            this._untilDoor = randomBetween(DOOR_GAP[0], DOOR_GAP[1]);
            this._door(t);
        }
        this._untilDing -= dt;
        if (this._untilDing <= 0 && !this._powerOut) {
            // Near a lift, its own bell; else one somewhere far off.
            this._untilDing = randomBetween(DING_GAP[0], DING_GAP[1]) * (this._lift > 0 ? 0.4 : 1);
            this._ding(t, this._lift > 0 ? 0.4 + 0.6 * this._lift : 0.25, this._lift > 0 ? this._around.liftPan : randomBetween(-0.9, 0.9), this._lift <= 0);
        }
    }

    /** Coming into the level: the band's playing, and the rest comes sooner than it will. */
    _resetTimers() {
        this._untilNear = randomBetween(8, 20);
        this._untilLaugh = randomBetween(8, 20);
        this._untilGlass = randomBetween(4, 12);
        this._untilKnock = randomBetween(30, 80);
        this._untilCreak = randomBetween(10, 30);
        this._untilDoor = randomBetween(40, 120);
        this._untilDing = randomBetween(20, 60);
        this._untilBehind = randomBetween(3, 8);
        this._untilPause = randomBetween(PAUSE_GAP[0], PAUSE_GAP[1]);
        this._untilChime = Math.floor(randomBetween(20, 80));
        this._tock = false;
    }

    // ------------------------------------------------------------------ the power

    /** The power going: the hum dies with a clunk, and the lifts stop. The band plays on. */
    _cut() {
        this._powerOut = true;
        this._setPlant(false, 1.2);
        this._applyHum();
        const ambience = this.ambience;
        if (ambience.paused || !ambience.ambienceEnabled) return;
        const t = this.context.currentTime;
        const out = this._far(randomBetween(-0.5, 0.5));
        this._thump(t, 70, 35, 0.5, RELAY_LEVEL, out);
        this._noise(t, 0.3, 'lowpass', 200, 0.8, RELAY_LEVEL * 0.6, out);
    }

    _restore() {
        this._powerOut = false;
        this._setPlant(true, 0.8);
        this._applyHum();
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
        // The band starts where it left off, from now.
        this._nextBeat = t + 0.2;
        this._nextNote = t + 0.2;
    }

    _applyHum() {
        if (!this.built) return;
        const power = this._powerOut ? 0 : clamp((this._power - 0.2) / 0.6, 0, 1);
        const target = HUM_LEVEL * (0.15 + 0.85 * this._light) * power;
        if (Math.abs(target - this._humTarget) < HUM_LEVEL * 0.01) return;
        this._humTarget = target;
        this.hum.gain.setTargetAtTime(target, this.context.currentTime, 0.4);
    }

    /** How near the band and the party seem: how loud, and how much of their top end gets through. */
    _applyNear(timeConstant) {
        if (!this.built) return;
        const t = this.context.currentTime;
        const near = this._nearness;
        const playing = this._stopped > 0 ? 0 : 1;
        this.music.gain.setTargetAtTime(BAND_LEVEL * (0.08 + 0.92 * near) * playing, t, timeConstant);
        this.record.frequency.setTargetAtTime(280 + 2600 * near * near, t, timeConstant);
        this.crowd.gain.setTargetAtTime(CROWD_LEVEL * (0.15 + 0.85 * near) * playing, t, timeConstant);
    }

    // ------------------------------------------------------------------ the band

    /**
     * Schedules the band's beats and the horn's notes a little ahead: now and then it drags for a bar, as if the record
     * were slowing, and very now and then it stops, for a while, and starts again from the top.
     */
    _playBand(t, dt) {
        if (this._stopped > 0) {
            this._stopped -= dt;
            if (this._stopped > 0) return;
            this._stopped = 0;
            this._beat = 0;
            this._tuneAt = 0;
            this._nextBeat = t + 0.1;
            this._nextNote = t + 0.1;
            this._applyNear(0.5);
        }
        if (this._nextBeat < t - 1) {
            this._nextBeat = t + 0.05;
            this._nextNote = t + 0.05;
        }
        while (this._nextBeat < t + LOOKAHEAD) {
            const beat = this._beat % BEATS;
            if (beat === 0) {
                this._untilPause -= BEATS * 60 / TEMPO;
                if (this._untilPause <= 0) {
                    this._untilPause = randomBetween(PAUSE_GAP[0], PAUSE_GAP[1]);
                    this._stopped = randomBetween(8, 25);
                    this._applyNear(0.08);
                    return;
                }
                this._drag = Math.random() < 0.18 ? 1 : 0;
            }
            // A bar dragging: slower, and flat.
            const dragging = this._drag > 0 && beat >= BEATS - 8;
            const length = (60 / TEMPO) * (dragging ? 1 + (beat - (BEATS - 8)) * 0.06 : 1);
            const detune = dragging ? -(beat - (BEATS - 8)) * 12 : 0;
            this._beatAt(this._nextBeat, beat, length, detune);
            this._nextBeat += length;
            this._beat++;
        }
        while (this._nextNote < t + LOOKAHEAD && this._stopped <= 0) {
            const [note, beats] = TUNE[this._tuneAt % TUNE.length];
            const length = beats * 60 / TEMPO;
            if (note !== null) this._horn(this._nextNote, midiToHz(note), length);
            this._nextNote += length;
            this._tuneAt++;
            // (Kept with the beat, whatever the beat's doing.)
            if (this._tuneAt % TUNE.length === 0) this._nextNote = Math.max(this._nextNote, this._nextBeat);
        }
    }

    /** One beat: the bass on the first and third, the piano on the second and fourth, the brushes on all. */
    _beatAt(t, beat, length, detune) {
        const bar = BARS[Math.floor(beat / 4)];
        const inBar = beat % 4;
        if (inBar === 0 || inBar === 2) this._bass(t, midiToHz(bar.root + (inBar === 2 ? 7 : 0)), length, detune);
        if (inBar === 1 || inBar === 3) for (const note of bar.chord) this._piano(t, midiToHz(note), detune);
        // Brushes: a swish on two and four, a tap on the others, swung.
        this._noise(t, inBar % 2 ? 0.16 : 0.05, 'bandpass', inBar % 2 ? 4200 : 5200, 0.8, inBar % 2 ? 0.05 : 0.025, this.music);
        if (Math.random() < 0.5) this._noise(t + length * 0.66, 0.04, 'bandpass', 5200, 0.8, 0.018, this.music);
        // The record's crackle.
        for (let k = 0; k < 3; k++) if (Math.random() < 0.5) this._noise(t + Math.random() * length, 0.004, 'highpass', 2500, 0.7, randomBetween(0.02, 0.06), this.music);
    }

    /** A plucked string bass note. */
    _bass(t, frequency, length, detune) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.5, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + Math.min(length * 1.8, 0.9));
        osc.connect(gain).connect(this.music);
        osc.start(t);
        osc.stop(t + 1);
    }

    /** A short piano chord note. */
    _piano(t, frequency, detune) {
        const context = this.context;
        for (const [ratio, level, type] of [[1, 0.14, 'triangle'], [2.003, 0.04, 'sine']]) {
            const osc = context.createOscillator();
            osc.type = /** @type {OscillatorType} */ (type);
            osc.frequency.value = frequency * ratio;
            osc.detune.value = detune + randomBetween(-4, 4);
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(level, t + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.7);
            osc.connect(gain).connect(this.music);
            osc.start(t);
            osc.stop(t + 0.75);
        }
    }

    /** The muted horn: a buzzy note through a narrow band, swelling in, with a slow vibrato. */
    _horn(t, frequency, length) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = frequency;
        const vibrato = context.createOscillator();
        vibrato.frequency.value = 5.2;
        const depth = context.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(14, t + Math.min(length, 0.6));
        vibrato.connect(depth).connect(osc.detune);
        const mute = context.createBiquadFilter();
        mute.type = 'bandpass';
        mute.frequency.value = 1100;
        mute.Q.value = 1.6;
        const gain = context.createGain();
        const end = t + length * 0.95;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.16, t + 0.05);
        gain.gain.setValueAtTime(0.13, end - 0.06);
        gain.gain.linearRampToValueAtTime(0, end);
        osc.connect(mute).connect(gain).connect(this.music);
        osc.start(t);
        vibrato.start(t);
        osc.stop(end + 0.02);
        vibrato.stop(end + 0.02);
    }

    // ------------------------------------------------------------------ the party

    /** Somebody laughing, a few rooms away: a run of breathy "ha"s, falling. */
    _laugh(t) {
        const out = this._far(randomBetween(-0.9, 0.9));
        const level = LAUGH_LEVEL * (0.2 + 0.8 * this._nearness);
        const count = 3 + Math.floor(Math.random() * 4);
        const pitch = randomBetween(170, 290);
        for (let k = 0; k < count; k++) {
            const at = t + k * randomBetween(0.16, 0.22);
            this._voice(at, pitch * (1 - k * 0.03), 0.12, level * (1 - k * 0.12), out);
        }
    }

    /** One syllable: a buzz through the formants of an "ah". */
    _voice(t, pitch, length, level, out) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(pitch * 1.08, t);
        osc.frequency.exponentialRampToValueAtTime(pitch * 0.92, t + length);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + length);
        for (const [frequency, q, amount] of [[800, 6, 1], [1250, 8, 0.6]]) {
            const formant = context.createBiquadFilter();
            formant.type = 'bandpass';
            formant.frequency.value = frequency;
            formant.Q.value = q;
            const share = context.createGain();
            share.gain.value = amount;
            osc.connect(formant).connect(share).connect(gain);
        }
        gain.connect(out);
        osc.start(t);
        osc.stop(t + length + 0.02);
    }

    /** A glass set down, or two touching, somewhere in the party. */
    _glass(t) {
        const context = this.context;
        const out = this._far(randomBetween(-0.9, 0.9));
        const level = GLASS_LEVEL * (0.1 + 0.9 * this._nearness);
        const base = randomBetween(2400, 3400);
        const touches = Math.random() < 0.5 ? 2 : 1;
        for (let n = 0; n < touches; n++) {
            const at = t + n * randomBetween(0.05, 0.12);
            for (const ratio of [1, 2.32, 4.1]) {
                const osc = context.createOscillator();
                osc.frequency.value = base * ratio * randomBetween(0.99, 1.01);
                const gain = context.createGain();
                gain.gain.setValueAtTime(0, at);
                gain.gain.linearRampToValueAtTime(level / ratio, at + 0.002);
                gain.gain.exponentialRampToValueAtTime(0.0003, at + 0.6 / ratio);
                osc.connect(gain).connect(out);
                osc.start(at);
                osc.stop(at + 0.62);
            }
        }
    }

    // ------------------------------------------------------------------ the building

    /** The clock's tick (and its tock, lower). */
    _clockTick(t, near) {
        const out = this._near(this._around.clockPan);
        const level = TICK_LEVEL * near * near;
        this._noise(t, 0.012, 'bandpass', this._tock ? 2600 : 3300, 3, level, out);
        this._thump(t, this._tock ? 700 : 900, 400, 0.03, level * 0.4, out);
    }

    /** The clock chiming the quarter: four bell notes, the last held. */
    _chime(t, near) {
        const context = this.context;
        const out = this._near(this._around.clockPan);
        const level = CHIME_LEVEL * (0.3 + 0.7 * near);
        QUARTER.forEach((note, k) => {
            const at = t + k * 0.7;
            for (const [ratio, amount, decay] of [[1, 1, 2.4], [2.01, 0.5, 1.4], [2.98, 0.25, 0.9], [4.2, 0.15, 0.5]]) {
                const osc = context.createOscillator();
                osc.frequency.value = midiToHz(note) * ratio;
                const gain = context.createGain();
                gain.gain.setValueAtTime(0, at);
                gain.gain.linearRampToValueAtTime(level * amount, at + 0.004);
                gain.gain.exponentialRampToValueAtTime(0.0005, at + decay * (k === 3 ? 1.6 : 1));
                osc.connect(gain).connect(out);
                osc.start(at);
                osc.stop(at + decay * 1.6 + 0.05);
            }
        });
    }

    /** A lift's bell: one note, and the hum of the car arriving (or a long way off, just the bell). */
    _ding(t, level, pan, far) {
        const context = this.context;
        const out = far ? this._far(pan) : this._near(pan);
        for (const [frequency, amount, decay] of [[1318, 1, 1.8], [2637, 0.3, 1], [3950, 0.12, 0.6]]) {
            const osc = context.createOscillator();
            osc.frequency.value = frequency;
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(DING_LEVEL * level * amount, t + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
            osc.connect(gain).connect(out);
            osc.start(t);
            osc.stop(t + decay + 0.05);
        }
    }

    /** Knocking on a door: three, and sometimes three more. From behind a lit door, when you're by one. */
    _knock(t, pan, behind) {
        const out = behind ? this._near(pan) : this._far(pan);
        const level = KNOCK_LEVEL * (behind ? 0.7 : 0.5);
        const sets = Math.random() < 0.3 ? 2 : 1;
        let at = t;
        for (let s = 0; s < sets; s++) {
            for (let k = 0; k < 3; k++) {
                this._thump(at, 190, 95, 0.12, level, out);
                this._noise(at, 0.03, 'bandpass', 900, 1.5, level * 0.35, out);
                at += randomBetween(0.2, 0.28);
            }
            at += randomBetween(1.2, 2.2);
        }
    }

    /** Someone walking about behind a door, on carpet: a few soft steps, going away. */
    _stepsBehind(t, near, pan) {
        const out = this._near(pan);
        const level = STEPS_BEHIND_LEVEL * near;
        const steps = 3 + Math.floor(Math.random() * 5);
        let at = t;
        for (let k = 0; k < steps; k++) {
            const fading = 1 - k / (steps + 2);
            this._thump(at, 85, 45, 0.12, level * fading, out);
            this._noise(at, 0.08, 'lowpass', 600, 0.7, level * 0.4 * fading, out);
            at += randomBetween(0.5, 0.62);
        }
    }

    /** Old timber taking the weight: a slow, resonant creak somewhere in the building. */
    _creak(t) {
        const context = this.context;
        const out = this._far(randomBetween(-0.9, 0.9));
        const length = randomBetween(0.5, 1.2);
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        const band = context.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 18;
        const low = randomBetween(260, 420);
        band.frequency.setValueAtTime(low, t);
        band.frequency.linearRampToValueAtTime(low * randomBetween(1.3, 1.8), t + length);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(CREAK_LEVEL * 4, t + length * 0.3);
        gain.gain.linearRampToValueAtTime(0, t + length);
        source.connect(band).connect(gain).connect(out);
        source.start(t, Math.random() * 1.5, length + 0.05);
    }

    /** A door closing, a long way off: the latch, and the thud. */
    _door(t) {
        const out = this._far(randomBetween(-0.9, 0.9));
        this._noise(t, 0.03, 'bandpass', 1800, 2, DOOR_LEVEL * 0.3, out);
        this._thump(t + 0.02, 120, 55, 0.4, DOOR_LEVEL, out);
    }

    /** A rubber sole squeaking on linoleum. */
    _squeak(t, level, out) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.type = 'triangle';
        const pitch = randomBetween(1400, 2200);
        osc.frequency.setValueAtTime(pitch, t);
        osc.frequency.linearRampToValueAtTime(pitch * randomBetween(1.1, 1.3), t + 0.06);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + 0.1);
    }

    /** Close by, in the hotel's quiet: heard directly, with a little of the room. */
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
