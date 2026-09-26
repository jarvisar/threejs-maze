import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveRecords } from '../src/footage/records.js';
import { findLevelFun, levelFunFound } from '../src/unlocks.js';

describe('Level Fun', () => {
    let original;
    beforeEach(() => {
        original = globalThis.localStorage;
        const data = new Map();
        globalThis.localStorage = {
            getItem: (key) => (data.has(key) ? data.get(key) : null),
            setItem: (key, value) => data.set(key, String(value)),
            removeItem: (key) => data.delete(key),
        };
    });
    afterEach(() => {
        globalThis.localStorage = original;
    });

    it('is not found to begin with', () => {
        expect(levelFunFound()).toBe(false);
    });

    it('stays found once it has been', () => {
        findLevelFun();
        expect(levelFunFound()).toBe(true);
        expect(globalThis.localStorage.getItem('backrooms-simulator:level-fun:v1')).toBe('1');
    });

    it('is found already by anyone who got all the way out of a tape before it was kept', () => {
        saveRecords({ runs: 3, escapes: 2, best: 200, finishes: 0, bestFinish: 0 });
        expect(levelFunFound()).toBe(false);
        saveRecords({ runs: 3, escapes: 2, best: 200, finishes: 1, bestFinish: 500 });
        expect(levelFunFound()).toBe(true);
    });

    it('is not found without storage, and finding it then does no harm', () => {
        globalThis.localStorage = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
        };
        expect(levelFunFound()).toBe(false);
        expect(() => findLevelFun()).not.toThrow();
    });
});
