import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ambience, detachable } from '../src/audio/Ambience.js';
import { Dread } from '../src/audio/Dread.js';
import { PartyAudio } from '../src/audio/Party.js';
import { Blackouts } from '../src/world/blackouts.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { LEVELS } from '../src/world/levels.js';
import { FakeAudioContext, FakeNode } from './fakeAudio.js';

let realAudioContext;
beforeEach(() => {
    realAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = FakeAudioContext;
    vi.useFakeTimers();
});
afterEach(() => {
    globalThis.AudioContext = realAudioContext;
    vi.useRealTimers();
});

/** Ambience started and unpaused, as during play. */
function playing() {
    const ambience = new Ambience();
    ambience.setVolume(1);
    ambience.start();
    ambience.setPaused(false);
    return ambience;
}

/** Steps `frame` at 60fps for `seconds`, advancing the sound's clock each step. */
function run(ambience, seconds, frame) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
        ambience.context.currentTime = t;
        frame(t, dt);
    }
}

describe('sound', () => {
    it('plays every level, walked round with the power going and coming back, asking nothing a browser would refuse', () => {
        for (const level of LEVELS) {
            const ambience = playing();
            const store = new ChunkStore(4, null, level.options(4));
            const sound = level.sound?.(ambience) ?? null;
            ambience.setHumScale(sound ? 0 : 1);
            ambience.setRoom(level.room);
            sound?.setEnabled(true);
            sound?.setWorld?.(store);
            // A cut a few seconds in.
            const blackouts = new Blackouts(() => 0.5);
            blackouts.rate = 50;
            const onEvent = (event, strength) => {
                if (event === 'cut') ambience.powerCut();
                else if (event === 'flash') ambience.powerFlash(strength);
                else ambience.powerRestored();
            };
            let nextStep = 0;
            ambience.glitch(0.7, 0.5);
            run(ambience, 20, (t, dt) => {
                const x = 0.5 + t * 0.4;
                const z = 0.5 + Math.sin(t * 0.3) * 2;
                const power = 1 - blackouts.update(dt, onEvent);
                const light = store.areaLight(x, z) * power;
                ambience.setAreaLight(light);
                ambience.update(dt);
                ambience.listenToLights(store, x, z, t * 0.2, t, power);
                const floor = level.water ? store.groundAt(x, z) : 0;
                const depth = Math.max(0, -floor);
                sound?.follow(x, z, light, power, t > 12 && t < 14 ? -0.2 : floor + 0.5);
                sound?.update(dt);
                if (t >= nextStep) {
                    nextStep += 0.5;
                    if (sound) sound.step(1, x, z, depth);
                    else ambience.footstep(1);
                }
                ambience.setZoomMotor(t > 3 && t < 4 ? 0.5 : 0);
            });
            sound?.splash?.(1.2);
            ambience.click(true);
            ambience.edit(true, 0.5, 2);
            ambience.edit(false, -0.5, 6);
            expect(ambience.output.reachesSpeakers()).toBe(true);
            expect(ambience.context.started.length).toBeGreaterThan(100);
        }
    });

    it('leaves nothing of a level\'s sound running once it\'s faded out, and brings it back when it\'s on again', () => {
        for (const level of LEVELS.filter((l) => l.sound)) {
            const ambience = playing();
            const from = ambience.context.started.length;
            const sound = level.sound(ambience);
            sound.setWorld?.(new ChunkStore(2, null, level.options(2)));
            sound.setEnabled(true);
            sound.update(1 / 60);
            // Sources that never stop (loops, hum) and reach the speakers.
            const running = () => ambience.context.started.slice(from).filter((source) => source.stopped === null && source.reachesSpeakers()).length;
            expect(running()).toBeGreaterThan(3);
            sound.setEnabled(false);
            vi.advanceTimersByTime(500);
            expect(running()).toBeGreaterThan(3);
            vi.advanceTimersByTime(2000);
            expect(running()).toBe(0);
            sound.setEnabled(true);
            expect(running()).toBeGreaterThan(3);
        }
    });

    it('takes Level 0\'s hum off the graph on a level with a sound of its own', () => {
        const ambience = playing();
        expect(ambience.mains.reachesSpeakers()).toBe(true);
        ambience.setHumScale(0);
        vi.advanceTimersByTime(3000);
        expect(ambience.mains.reachesSpeakers()).toBe(false);
        ambience.setHumScale(1);
        expect(ambience.mains.reachesSpeakers()).toBe(true);
    });

    it('plays a tape through, and is off the graph between tapes', () => {
        const ambience = playing();
        const dread = new Dread(ambience);
        dread.start();
        expect(dread.bus.reachesSpeakers()).toBe(true);
        let found = 0;
        run(ambience, 30, (t, dt) => {
            dread.setStatic(t > 10 && t < 12 ? 0.8 : 0.1);
            dread.setPresence(t > 8 && t < 14 ? 0.7 : 0, Math.sin(t));
            dread.setTelevision(0.5, Math.sin(t), t % 4 < 2, Math.cos(t));
            dread.setBeacon(found === 8 ? 0.6 : 0, Math.sin(t), Math.cos(t * 0.5));
            if (t >= (found + 1) * 3 && found < 8) {
                found++;
                dread.tvOff();
                dread.drum();
                dread.setLayers(found);
            }
            if (Math.abs(t - 11) < dt / 2) dread.sting();
        });
        dread.caught();
        vi.advanceTimersByTime(3000);
        expect(dread.bus.reachesSpeakers()).toBe(false);
        dread.start();
        expect(dread.bus.reachesSpeakers()).toBe(true);
        dread.escaped();
        vi.advanceTimersByTime(3000);
        // The wind carries on a while after you're out.
        expect(dread.bus.reachesSpeakers()).toBe(true);
        vi.advanceTimersByTime(5000);
        expect(dread.bus.reachesSpeakers()).toBe(false);
    });

    it('plays Level Fun', () => {
        const ambience = playing();
        const party = new PartyAudio(ambience);
        party.setEnabled(true);
        party.arrive();
        run(ambience, 12, (t, dt) => {
            party.setNear(Math.max(0, Math.sin(t * 0.5)));
            party.setPower(t > 5 && t < 7 ? 0 : 1);
            party.setWarp(t / 12);
            party.setMusicBox(t > 2 ? 0.5 : 0, 0.3, t % 3 < 1.5);
            party.update(dt);
        });
        party.pop(1, 0.5);
        party.horn(0.5, 1.2, 0.1);
        party.sadTrombone();
        vi.runAllTimers();
        expect(ambience.context.started.length).toBeGreaterThan(200);
    });

    it('buzzes loudest right under a tube', () => {
        const ambience = playing();
        const store = new ChunkStore(9, null, LEVELS[0].options(9));
        let panel = null;
        for (let px = -15; px <= 15 && !panel; px += 2) {
            for (let pz = -15; pz <= 15 && !panel; pz += 2) {
                const data = store.panelData(px, pz);
                const offset = store.panelOffset(px, pz);
                if (data[offset] > 128 && data[offset + 2] === 0) panel = [px, pz];
            }
        }
        expect(panel).not.toBeNull();
        const [px, pz] = panel;
        ambience.listenToLights(store, px, pz, 0, 0, 1);
        const under = ambience.fixture.gain.target;
        ambience.listenToLights(store, px + 1, pz + 1, 0, 0, 1);
        const between = ambience.fixture.gain.target;
        expect(under).toBeGreaterThan(between * 2);
    });

    it('muffles everything on the menus, and more under the water', () => {
        const ambience = playing();
        const ears = () => ambience.ears.frequency.target;
        expect(ears()).toBeGreaterThan(15000);
        ambience.setPaused(true);
        expect(ears()).toBeLessThan(2000);
        ambience.setUnderwater(true);
        expect(ears()).toBeLessThan(500);
        ambience.setPaused(false);
        expect(ears()).toBeLessThan(500);
        ambience.setUnderwater(false);
        expect(ears()).toBeGreaterThan(15000);
    });

    it('stops altogether while the page is out of sight', async () => {
        const ambience = playing();
        await Promise.resolve();
        const context = ambience.context;
        expect(context.state).toBe('running');
        ambience.setHidden(true);
        await Promise.resolve();
        expect(context.state).toBe('suspended');
        // Not blocked by the browser, just hidden. Nothing to click to resume.
        expect(ambience.blocked).toBe(false);
        ambience.start();
        await Promise.resolve();
        expect(context.state).toBe('suspended');
        ambience.setHidden(false);
        await Promise.resolve();
        expect(context.state).toBe('running');
    });

    it('changes rooms with the level, the old one fading as the new one comes in', () => {
        const ambience = playing();
        ambience.setRoom(LEVELS[0].room);
        expect(ambience.reverb.outputs.size).toBe(1);
        ambience.setRoom(LEVELS[1].room);
        expect(ambience.reverb.outputs.size).toBe(2);
        vi.advanceTimersByTime(3000);
        expect(ambience.reverb.outputs.size).toBe(1);
        ambience.setRoom(LEVELS[1].room);
        expect(ambience.reverb.outputs.size).toBe(1);
    });

    it('keeps every level\'s echo no longer than it was (it\'s the costliest thing in the sound)', () => {
        for (const level of LEVELS) {
            expect(level.room.seconds).toBeLessThanOrEqual(5.5);
            expect(level.room.level).toBeGreaterThan(0);
        }
    });

    it('drops out with the picture, and comes back', () => {
        const ambience = playing();
        ambience.glitch(1, 1.4);
        const gain = ambience.tape.gain;
        expect(Math.min(...gain.events.map((event) => event[1]))).toBeLessThan(0.8);
        expect(gain.target).toBe(1);
    });
});

describe('detachable', () => {
    it('comes off only once it has been unwanted for the whole fade, and only once asked', () => {
        const context = new FakeAudioContext();
        const node = context.createGain();
        const attach = detachable(node, [context.destination]);
        expect(node.reachesSpeakers()).toBe(false);
        attach(true);
        expect(node.reachesSpeakers()).toBe(true);
        attach(false, 1);
        vi.advanceTimersByTime(600);
        // Asked again, as every frame would. The fade doesn't restart.
        attach(false, 1);
        vi.advanceTimersByTime(600);
        expect(node.reachesSpeakers()).toBe(false);
        attach(true);
        attach(false, 1);
        vi.advanceTimersByTime(500);
        attach(true);
        vi.advanceTimersByTime(1000);
        expect(node.reachesSpeakers()).toBe(true);
        expect(node).toBeInstanceOf(FakeNode);
    });
});
