import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbandonedOfficeAudio } from '../src/audio/AbandonedOffice.js';
import { Ambience } from '../src/audio/Ambience.js';
import { START_WELL, abandonedOfficeFloorAt, abandonedOfficeOptions, abandonedOfficeRainAt } from '../src/world/abandonedOffice.js';
import { FURN_VENDING } from '../src/world/abandonedOfficeFurniture.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { storm } from '../src/world/storm.js';
import { FakeAudioContext } from './fakeAudio.js';

function office(seed) {
    return new ChunkStore(seed, null, abandonedOfficeOptions(seed));
}

let realAudioContext;
beforeEach(() => {
    realAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = FakeAudioContext;
    vi.useFakeTimers();
    // storm is shared state. Reset it here, restore it after each test.
    storm.on = true;
    storm.reset();
});
afterEach(() => {
    globalThis.AudioContext = realAudioContext;
    vi.useRealTimers();
    vi.restoreAllMocks();
    storm.on = false;
    storm.reset();
});

/** Ambience started and unpaused, as during play. */
function playing(ambience = new Ambience()) {
    ambience.setVolume(1);
    ambience.start();
    ambience.setPaused(false);
    return ambience;
}

/** Steps the level's sound at 60fps for `seconds` at (x, z), advancing its clock each step. */
function run(ambience, audio, seconds, x = 0, z = 0) {
    const dt = 1 / 60;
    const from = ambience.context.currentTime;
    for (let t = 0; t < seconds; t += dt) {
        ambience.context.currentTime = from + t;
        audio.follow(x, z, 1, 1, 0.5);
        audio.update(dt);
    }
}

describe('Level 4 sound', () => {
    it('is safe to use before there is any sound (there is no audio context until the first click)', () => {
        const audio = new AbandonedOfficeAudio(new Ambience());
        expect(() => {
            audio.setWorld(office(3));
            audio.setEnabled(true);
            audio.follow(0, 0, 1, 1, 0.5);
            audio.follow(0, -5, 1, 0, 0.5);
            storm.strike();
            for (let i = 0; i < 600; i++) audio.update(1 / 60);
            audio.step(1.2, 0, 0);
            audio.step(1.2, 0, -5);
            audio.setEnabled(false);
        }).not.toThrow();
        expect(audio.built).toBe(false);
    });

    it('thunders after a strike, once, a moment after the flash', () => {
        const ambience = playing();
        const audio = new AbandonedOfficeAudio(ambience);
        audio.setWorld(office(3));
        audio.setEnabled(true);
        const thunder = vi.spyOn(audio, '_thunder');
        run(ambience, audio, 2);
        expect(thunder).not.toHaveBeenCalled();
        const from = ambience.context.started.length;
        const now = ambience.context.currentTime;
        storm.strike();
        run(ambience, audio, 0.1);
        expect(thunder).toHaveBeenCalledTimes(1);
        // Scheduled after the flash, not with it.
        const later = ambience.context.started.slice(from).filter((source) => source.started >= now + 0.25);
        expect(later.length).toBeGreaterThan(0);
        run(ambience, audio, 8);
        expect(thunder).toHaveBeenCalledTimes(1);
        storm.strike();
        run(ambience, audio, 0.1);
        expect(thunder).toHaveBeenCalledTimes(2);
    });

    it('has no thunder for a strike from before it was on, one seen too late, or one from before there was sound', () => {
        const ambience = playing();
        const audio = new AbandonedOfficeAudio(ambience);
        audio.setWorld(office(3));
        const thunder = vi.spyOn(audio, '_thunder');
        storm.strike();
        audio.setEnabled(true);
        run(ambience, audio, 6);
        storm.strike();
        storm.since = 10;
        run(ambience, audio, 1);
        expect(thunder).not.toHaveBeenCalled();

        // Enabled before the first click. Strikes before that are counted but never heard.
        const quiet = new Ambience();
        const early = new AbandonedOfficeAudio(quiet);
        early.setWorld(office(3));
        early.setEnabled(true);
        const earlyThunder = vi.spyOn(early, '_thunder');
        storm.strike();
        storm.strike();
        early.update(1 / 60);
        playing(quiet);
        run(quiet, early, 6);
        expect(earlyThunder).not.toHaveBeenCalled();
        storm.strike();
        run(quiet, early, 0.1);
        expect(earlyThunder).toHaveBeenCalledTimes(1);
    });

    it('plays everything it has, near thunder and far, through a power cut, asking nothing a browser would refuse', () => {
        const ambience = playing();
        const audio = new AbandonedOfficeAudio(ambience);
        audio.setWorld(office(3));
        audio.setEnabled(true);
        run(ambience, audio, 1);
        const from = ambience.context.started.length;
        audio._vending = 1;
        for (const near of [0, 0.3, 0.6, 1]) {
            storm.strike();
            storm.near = near;
            run(ambience, audio, 0.1);
        }
        audio._phone();
        audio._ding();
        audio._door();
        audio._pipes();
        audio._gust();
        audio._drop(ambience.context.currentTime);
        audio._clunk(ambience.context.currentTime, true);
        audio._power = 0;
        audio.update(0.5);
        expect(audio._powerOut).toBe(true);
        audio._power = 1;
        audio.update(0.1);
        expect(audio._powerOut).toBe(false);
        // On the carpet, and on the vinyl of a core or a kitchen.
        let vinyl = null;
        for (let x = -60; x < 60 && !vinyl; x++) for (let z = -60; z < 60 && !vinyl; z++) if (abandonedOfficeFloorAt(audio.store, x, z) === 1) vinyl = [x, z];
        expect(vinyl).not.toBeNull();
        audio.step(1.2, 0, 0);
        audio.step(1.2, vinyl[0], vinyl[1]);
        expect(ambience.context.started.length - from).toBeGreaterThan(30);
    });

    it('hears a vending machine only when it is by one, and not in a power cut', () => {
        const store = office(3);
        let machine = null;
        for (let cx = -4; cx <= 4 && !machine; cx++) {
            for (let cz = -4; cz <= 4 && !machine; cz++) machine = store.getChunk(cx, cz).abandonedOffice.furniture.find((piece) => piece.type === FURN_VENDING) ?? null;
        }
        expect(machine).not.toBeNull();
        const ambience = playing();
        const audio = new AbandonedOfficeAudio(ambience);
        audio.setWorld(store);
        audio.setEnabled(true);
        run(ambience, audio, 1, machine.x + Math.sin(machine.yaw) * 0.4, machine.z + Math.cos(machine.yaw) * 0.4);
        expect(audio._vending).toBeGreaterThan(0.5);
        expect(audio.vend.gain.target).toBeGreaterThan(0.02);
        run(ambience, audio, 1, machine.x + 6, machine.z + 6);
        expect(audio._vending).toBe(0);
        expect(audio.vend.gain.target).toBe(0);
        const x = machine.x + Math.sin(machine.yaw) * 0.4;
        const z = machine.z + Math.cos(machine.yaw) * 0.4;
        run(ambience, audio, 1, x, z);
        expect(audio.vend.gain.target).toBeGreaterThan(0.02);
        for (let i = 0; i < 30; i++) {
            audio.follow(x, z, 0, 0, 0.5);
            audio.update(1 / 60);
        }
        expect(audio._powerOut).toBe(true);
        expect(audio.vend.gain.target).toBe(0);
    });

    it('hears the rain loud and bright by the windows, and dull away from them', () => {
        const store = office(3);
        const wellX = (START_WELL.x0 + START_WELL.x1) / 2;
        const wellZ = (START_WELL.z0 + START_WELL.z1) / 2;
        expect(abandonedOfficeRainAt(store, wellX, wellZ)).toBe(1);
        let far = null;
        for (let x = 20; x < 200 && !far; x++) if (abandonedOfficeRainAt(store, x, 30) === 0) far = [x, 30];
        expect(far).not.toBeNull();
        const ambience = playing();
        const audio = new AbandonedOfficeAudio(ambience);
        audio.setWorld(store);
        audio.setEnabled(true);
        run(ambience, audio, 10, wellX, wellZ);
        const nearLevel = audio.rainLevel.gain.target;
        const nearTone = audio.rainTone.frequency.target;
        run(ambience, audio, 10, far[0], far[1]);
        expect(audio.rainLevel.gain.target).toBeLessThan(nearLevel * 0.5);
        expect(audio.rainTone.frequency.target).toBeLessThan(nearTone * 0.3);
        expect(audio.patterLevel.gain.target).toBeLessThan(0.01);
    });
});
