import { describe, expect, it } from 'vitest';
import { Blackouts } from '../src/world/blackouts.js';
import { mulberry32 } from '../src/world/random.js';

/** Runs `seconds` of play in frame-sized steps, collecting the events and the levels seen. */
function run(blackouts, seconds, dt = 1 / 60) {
    const events = [];
    const levels = [];
    for (let t = 0; t < seconds; t += dt) {
        levels.push(blackouts.update(dt, (event, strength) => events.push([event, strength, blackouts.phase])));
    }
    return { events, levels };
}

describe('Blackouts', () => {
    it('never cuts the power in the first two minutes', () => {
        for (let seed = 0; seed < 10; seed++) {
            const { events, levels } = run(new Blackouts(mulberry32(seed)), 120);
            expect(events).toEqual([]);
            expect(levels.every((level) => level === 0)).toBe(true);
        }
    });

    it('cuts the power, then brings it back in flashes, within the first six minutes', () => {
        for (let seed = 0; seed < 10; seed++) {
            const blackouts = new Blackouts(mulberry32(seed));
            const { events, levels } = run(blackouts, 360);
            const names = events.map(([name]) => name);
            expect(names.indexOf('cut')).toBeGreaterThanOrEqual(0);
            expect(names.indexOf('restored')).toBeGreaterThan(names.indexOf('cut'));
            // The tubes strike a few times while coming back.
            const flashes = events.filter(([name, , phase]) => name === 'flash' && phase === 'restart');
            expect(flashes.length).toBeGreaterThanOrEqual(2);
            for (const [, strength] of events) {
                expect(strength).toBeGreaterThan(0);
                expect(strength).toBeLessThanOrEqual(1);
            }
            expect(levels.every((level) => level >= 0 && level <= 1)).toBe(true);
            expect(Math.max(...levels)).toBe(1);
            expect(blackouts.level).toBe(0);
            expect(blackouts.phase).toBe('idle');
        }
    });

    it('keeps the lights out for a few seconds, not longer', () => {
        const blackouts = new Blackouts(mulberry32(4));
        const { levels } = run(blackouts, 360);
        let longest = 0;
        let current = 0;
        for (const level of levels) {
            current = level === 1 ? current + 1 : 0;
            longest = Math.max(longest, current);
        }
        expect(longest / 60).toBeGreaterThan(2.5);
        expect(longest / 60).toBeLessThan(8);
    });

    it('waits at least five minutes between cuts', () => {
        const blackouts = new Blackouts(mulberry32(9));
        const { events } = run(blackouts, 1500, 1 / 30);
        const cuts = [];
        let t = 0;
        // Re-run, timing the cuts.
        const again = new Blackouts(mulberry32(9));
        for (let frame = 0; frame < 1500 * 30; frame++) {
            t += 1 / 30;
            again.update(1 / 30, (event) => {
                if (event === 'cut') cuts.push(t);
            });
        }
        expect(cuts.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeGreaterThan(300);
        expect(events.filter(([name]) => name === 'cut').length).toBe(cuts.length);
    });

    it('does nothing while disabled, and can be cancelled mid-cut', () => {
        const blackouts = new Blackouts(mulberry32(1));
        blackouts.enabled = false;
        const { events, levels } = run(blackouts, 900);
        expect(events).toEqual([]);
        expect(levels.every((level) => level === 0)).toBe(true);

        blackouts.enabled = true;
        let cut = false;
        for (let t = 0; t < 400 && !cut; t += 1 / 60) {
            blackouts.update(1 / 60, (event) => {
                if (event === 'cut') cut = true;
            });
        }
        expect(cut).toBe(true);
        expect(blackouts.level).toBe(1);
        blackouts.cancel();
        expect(blackouts.level).toBe(0);
        expect(blackouts.phase).toBe('idle');
        expect(blackouts.update(1 / 60)).toBe(0);
    });
});
