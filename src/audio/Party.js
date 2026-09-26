/*
 * The sound of Level Fun, on top of the usual ambience: a party going on somewhere nearby (mostly the bass and
 * the kick drum, through the walls, and all of it once you're in the room with the mirror ball), a music box
 * playing Happy Birthday by the nearest cake, a party horn now and then from far off, and the noises that go
 * with things: horns when the party starts, a pop when a guest goes, and a sad trombone when it's over.
 *
 * On a tape the party is still going somewhere, and slows and sags as the tape gets worse. It stops dead when
 * the power goes, and spins back up when it comes back.
 *
 * All of it synthesised from the ambience's audio context, like everything else. The music is scheduled a
 * little ahead as it plays.
 */

const TEMPO = 118;
const LOOKAHEAD = 0.3;
// The loop: four bars of sixteenths.
const STEPS = 64;
const BARS = [
    { bass: 36, chord: [60, 64, 67] },
    { bass: 43, chord: [59, 62, 67] },
    { bass: 45, chord: [57, 60, 64] },
    { bass: 41, chord: [57, 60, 65] },
];
// The tune, in eighths (null for a rest).
const LEAD = [
    67, null, 64, 67, 69, 67, 64, null,
    62, null, 67, 69, 71, 69, 67, null,
    72, null, 69, 72, 76, 74, 72, 69,
    69, null, 65, 69, 72, null, 67, null,
];
// Happy Birthday (the tune is Good Morning to All, 1893), an octave up for a music box: [note, beats].
const BIRTHDAY = [
    [79, 0.75], [79, 0.25], [81, 1], [79, 1], [84, 1], [83, 2],
    [79, 0.75], [79, 0.25], [81, 1], [79, 1], [86, 1], [84, 2],
    [79, 0.75], [79, 0.25], [91, 1], [88, 1], [84, 1], [83, 1], [81, 1],
    [89, 0.75], [89, 0.25], [88, 1], [84, 1], [86, 1], [84, 3],
];
const BIRTHDAY_TEMPO = 104;
// Beats of quiet before it plays again.
const BIRTHDAY_GAP = 3;
// Seconds for the music to get back up to speed after a power cut.
const SPIN_UP = 0.9;

const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const randomBetween = (min, max) => min + Math.random() * (max - min);

export class PartyAudio {
    /** @param {import('./Ambience.js').Ambience} ambience */
    constructor(ambience) {
        this.ambience = ambience;
        this.enabled = false;
        this.built = false;
        this._step = 0;
        this._nextStep = 0;
        this._warp = 0;
        this._near = 0;
        this._power = 1;
        this._powerOut = false;
        this._spin = 0;
        this._box = { level: 0, note: 0, next: 0, quiet: 0, tempo: 1 };
        this._untilDistant = randomBetween(15, 40);
    }

    _build() {
        const context = this.ambience.context;
        if (this.built || !context) return this.built;
        this.built = true;
        this.context = context;

        this.bus = context.createGain();
        this.bus.gain.value = 0;
        this.bus.connect(this.ambience.master);

        // The party, through the wall: a low-pass that opens up the nearer you are.
        this.music = context.createGain();
        this.music.gain.value = 0.5;
        this.wall = context.createBiquadFilter();
        this.wall.type = 'lowpass';
        this.wall.frequency.value = 300;
        this.wall.Q.value = 0.7;
        this.musicLevel = context.createGain();
        this.musicLevel.gain.value = 0.4;
        this.music.connect(this.wall).connect(this.musicLevel).connect(this.bus);
        const send = context.createGain();
        send.gain.value = 0.18;
        this.wall.connect(send).connect(this.ambience.reverb);

        // The music box by the nearest cake: from its side, muffled with a wall in the way.
        this.box = context.createGain();
        this.box.gain.value = 1;
        this.boxMuffle = context.createBiquadFilter();
        this.boxMuffle.type = 'lowpass';
        this.boxMuffle.frequency.value = 6000;
        this.boxPan = context.createStereoPanner();
        this.boxLevel = context.createGain();
        this.boxLevel.gain.value = 0;
        this.box.connect(this.boxMuffle).connect(this.boxPan).connect(this.boxLevel).connect(this.bus);
        // Level Fun may have been on since before there was any sound.
        this.setEnabled(this.enabled);
        return true;
    }

    /** Level Fun on or off. The music fades in and out. */
    setEnabled(on) {
        this.enabled = on;
        if (!this.built) return;
        const t = this.context.currentTime;
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.6 : 0.25);
    }

    /** How close the party is (0: somewhere else, 1: the room with the mirror ball). */
    setNear(level) {
        this._near = level;
    }

    /** How far gone the tape is, 0..1: the music drags and goes flat. */
    setWarp(amount) {
        this._warp = amount;
    }

    /** How much of the power is on, 0..1. */
    setPower(level) {
        if (level < 0.25) this._powerOut = true;
        else if (this._powerOut && level > 0.9) {
            this._powerOut = false;
            this._spin = SPIN_UP;
        }
        this._power = level;
    }

    /**
     * The music box by the nearest cake.
     * @param {number} level 0..1 (by distance; 0 for none).
     * @param {number} pan -1..1
     * @param {boolean} clear Nothing in the way.
     */
    setMusicBox(level, pan, clear) {
        this._box.level = level;
        if (!this.built) return;
        const t = this.context.currentTime;
        this.boxLevel.gain.setTargetAtTime(level * 0.5, t, 0.2);
        this.boxPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.15);
        this.boxMuffle.frequency.setTargetAtTime(clear ? 6000 : 900, t, 0.2);
    }

    /** Keeps the music going. Call every frame while Level Fun is on. @param {number} dt */
    update(dt) {
        if (!this.enabled || !this._build()) return;
        const context = this.context;
        const now = context.currentTime;
        const near = this._near;
        this.wall.frequency.setTargetAtTime(260 + near * near * 3800, now, 0.3);
        const power = Math.min(Math.max((this._power - 0.2) / 0.6, 0), 1);
        this.musicLevel.gain.setTargetAtTime((0.32 + 0.4 * near) * power * (1 - 0.35 * this._warp), now, this._powerOut ? 0.01 : 0.15);
        if (this._spin > 0) this._spin = Math.max(0, this._spin - dt);

        // The party: nothing scheduled while the power's out (the music just stops).
        if (this._nextStep < now) this._nextStep = now + 0.05;
        while (this._nextStep < now + LOOKAHEAD) {
            if (!this._powerOut) this._playStep(this._step, this._nextStep);
            // Slower the worse the tape, and slower still while it's spinning back up.
            const spin = this._spin / SPIN_UP;
            const pace = (1 - 0.28 * this._warp) * (1 - 0.6 * spin * spin);
            this._nextStep += 60 / TEMPO / 4 / pace;
            this._step = (this._step + 1) % STEPS;
        }

        this._updateMusicBox(now, dt);

        if (!this.ambience.paused && this.ambience.ambienceEnabled) {
            this._untilDistant -= dt;
            if (this._untilDistant <= 0) {
                this._untilDistant = randomBetween(25, 70);
                if (Math.random() < 0.6) this.horn(0.45, randomBetween(0.85, 1.2), 0, this.ambience.reverb);
                else this.pop(0.5, randomBetween(-0.8, 0.8), this.ambience.reverb);
            }
        }
    }

    // ------------------------------------------------------------------ the party

    /** How far off pitch the notes going out now are, in cents. */
    _detune(t) {
        const spin = this._spin / SPIN_UP;
        return -this._warp * 320 + Math.sin(t * 2.3) * 30 * this._warp - 1100 * spin * spin;
    }

    _playStep(step, t) {
        const bar = BARS[Math.floor(step / 16)];
        const beat = step % 16;
        const detune = this._detune(t);
        if (beat % 4 === 0) this._kick(t);
        if (beat === 4 || beat === 12) this._clap(t);
        if (beat % 4 === 2) {
            this._hat(t);
            this._stab(t, bar.chord, detune);
        }
        // Disco octaves: the root, then an octave up, in eighths.
        if (beat % 2 === 0) this._bass(t, bar.bass + (beat % 4 === 2 ? 12 : 0), detune);
        if (beat % 2 === 0) {
            const note = LEAD[Math.floor(step / 2)];
            if (note !== null) this._lead(t, note, detune);
        }
    }

    _kick(t) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.95, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain).connect(this.music);
        osc.start(t);
        osc.stop(t + 0.32);
    }

    _clap(t) {
        for (let k = 0; k < 3; k++) this._noise(t + k * 0.011, 0.07 + k * 0.03, 'bandpass', 1300, 0.28, this.music);
    }

    _hat(t) {
        this._noise(t, 0.035, 'highpass', 7000, 0.1, this.music);
    }

    _bass(t, midi, detune) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToHz(midi);
        osc.detune.value = detune;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, t);
        filter.frequency.exponentialRampToValueAtTime(220, t + 0.16);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.32, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(filter).connect(gain).connect(this.music);
        osc.start(t);
        osc.stop(t + 0.22);
    }

    _stab(t, chord, detune) {
        const context = this.context;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1800;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.055, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        filter.connect(gain).connect(this.music);
        for (const midi of chord) {
            const osc = context.createOscillator();
            osc.type = 'square';
            osc.frequency.value = midiToHz(midi);
            osc.detune.value = detune;
            osc.connect(filter);
            osc.start(t);
            osc.stop(t + 0.16);
        }
    }

    _lead(t, midi, detune) {
        const context = this.context;
        const osc = context.createOscillator();
        osc.type = 'square';
        osc.frequency.value = midiToHz(midi);
        osc.detune.value = detune;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2400;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.07, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(filter).connect(gain).connect(this.music);
        osc.start(t);
        osc.stop(t + 0.22);
    }

    // ------------------------------------------------------------------ the music box

    /** Happy Birthday by the nearest cake, from the top whenever you come back to one. */
    _updateMusicBox(now, dt) {
        const box = this._box;
        if (box.level < 0.01) {
            box.quiet += dt;
            if (box.quiet > 1.5) {
                box.note = 0;
                box.next = 0;
                box.tempo = 1;
            }
            return;
        }
        box.quiet = 0;
        if (box.next < now) box.next = now + 0.05;
        while (box.next < now + LOOKAHEAD) {
            const [midi, beats] = BIRTHDAY[box.note];
            const beat = 60 / BIRTHDAY_TEMPO / box.tempo;
            this._bell(box.next, midi, beats * beat);
            box.next += beats * beat;
            box.note++;
            if (box.note === BIRTHDAY.length) {
                box.note = 0;
                box.next += BIRTHDAY_GAP * beat;
                // Winding down, a little more every time round, until someone winds it up again.
                box.tempo = box.tempo > 0.8 ? box.tempo * 0.96 : 1;
            }
        }
    }

    /** One note of a music box: a bright plucked tine, a little out of tune. */
    _bell(t, midi, length) {
        const context = this.context;
        const frequency = midiToHz(midi) * 2 ** (randomBetween(-12, 12) / 1200);
        for (const [ratio, level, decay] of [[1, 0.22, 1.3], [2.01, 0.06, 0.5], [3.93, 0.03, 0.22], [5.4, 0.014, 0.1]]) {
            const osc = context.createOscillator();
            osc.frequency.value = frequency * ratio;
            const gain = context.createGain();
            const end = t + Math.min(decay * 1.5, length + decay);
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(level, t + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0005, end);
            osc.connect(gain).connect(this.box);
            osc.start(t);
            osc.stop(end + 0.02);
        }
    }

    // ------------------------------------------------------------------ noises

    /**
     * A party horn: a buzzing, rising blat, and the rattle of the paper unrolling.
     * @param {number} [level]
     * @param {number} [pitch]
     * @param {number} [delay] Seconds from now.
     * @param {AudioNode} [out] Where it's heard (close by, unless it's given).
     */
    horn(level = 1, pitch = 1, delay = 0, out) {
        if (!this._build()) return;
        const context = this.context;
        const t = context.currentTime + delay;
        const destination = out ?? this.ambience.effects;
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300 * pitch, t);
        osc.frequency.exponentialRampToValueAtTime(430 * pitch, t + 0.07);
        osc.frequency.setValueAtTime(430 * pitch, t + 0.45);
        osc.frequency.exponentialRampToValueAtTime(380 * pitch, t + 0.6);
        const vibrato = context.createOscillator();
        vibrato.frequency.value = 23;
        const depth = context.createGain();
        depth.gain.value = 9 * pitch;
        vibrato.connect(depth).connect(osc.frequency);
        const buzz = context.createBiquadFilter();
        buzz.type = 'bandpass';
        buzz.frequency.value = 1300 * pitch;
        buzz.Q.value = 1.1;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.4 * level, t + 0.025);
        gain.gain.setValueAtTime(0.36 * level, t + 0.48);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.64);
        osc.connect(buzz).connect(gain).connect(destination);
        osc.start(t);
        vibrato.start(t);
        osc.stop(t + 0.66);
        vibrato.stop(t + 0.66);
        this._noise(t, 0.5, 'bandpass', 3400, 0.08 * level, destination);
    }

    /** A pop, and the rubber snapping. */
    pop(level = 1, pan = 0, out) {
        if (!this._build()) return;
        const context = this.context;
        const t = context.currentTime;
        const panner = context.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        panner.connect(out ?? this.ambience.effects);
        this._noise(t, 0.07, 'highpass', 900, 0.8 * level, panner);
        const osc = context.createOscillator();
        osc.frequency.setValueAtTime(190, t);
        osc.frequency.exponentialRampToValueAtTime(55, t + 0.1);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.55 * level, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain).connect(panner);
        osc.start(t);
        osc.stop(t + 0.14);
    }

    /** The party starting: horns all round, and a pop or two. */
    arrive() {
        this.horn(1, 1);
        this.horn(0.8, 1.26, 0.22);
        this.horn(0.7, 0.84, 0.4);
        this.pop(0.7, -0.5);
        setTimeout(() => this.pop(0.6, 0.6), 180);
    }

    /** The party's over: wah, wah, wah, waaah. */
    sadTrombone() {
        if (!this._build()) return;
        const context = this.context;
        let t = context.currentTime + 0.05;
        const notes = [[62, 0.36], [61, 0.36], [60, 0.36], [59, 1.25]];
        notes.forEach(([midi, length], k) => {
            const last = k === notes.length - 1;
            const osc = context.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = midiToHz(midi);
            if (last) {
                const wobble = context.createOscillator();
                wobble.frequency.value = 5.5;
                const depth = context.createGain();
                depth.gain.value = 5;
                wobble.connect(depth).connect(osc.frequency);
                wobble.start(t);
                wobble.stop(t + length);
            }
            // The mute going in and out: wah.
            const filter = context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.Q.value = 4;
            filter.frequency.setValueAtTime(350, t);
            filter.frequency.linearRampToValueAtTime(1500, t + 0.12);
            filter.frequency.linearRampToValueAtTime(600, t + length);
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.2, t + 0.04);
            gain.gain.setValueAtTime(0.2, t + length - 0.08);
            gain.gain.linearRampToValueAtTime(0, t + length);
            osc.connect(filter).connect(gain).connect(this.ambience.effects);
            osc.start(t);
            osc.stop(t + length + 0.02);
            t += length;
        });
    }

    _noise(t, decay, type, frequency, level, out) {
        const context = this.context;
        const source = context.createBufferSource();
        source.buffer = this.ambience.noise;
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(level, t + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0005, t + decay);
        source.connect(filter).connect(gain).connect(out);
        source.start(t, Math.random() * 2, decay + 0.05);
    }
}
