/**
 * Small, fast, seedable PRNG (mulberry32). Returns floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Mixes integers into a well-distributed 32-bit hash, so that neighbouring chunks get unrelated seeds.
 * @param {...number} values
 * @returns {number}
 */
export function hashInts(...values) {
    let h = 0x811c9dc5;
    for (const value of values) {
        h = Math.imul(h ^ (value | 0), 0x5bd1e995);
        h ^= h >>> 13;
    }
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

/** @returns {number} A random 32-bit world seed. */
export function randomSeed() {
    if (globalThis.crypto?.getRandomValues) {
        return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return Math.floor(Math.random() * 4294967296) >>> 0;
}

/**
 * Turns user input (e.g. a `?seed=` URL parameter) into a 32-bit seed.
 * Plain numbers are used as-is; anything else is hashed, so "hello" is a valid seed too.
 * @param {string | null | undefined} text
 * @returns {number | null}
 */
export function parseSeed(text) {
    if (text == null) return null;
    const trimmed = String(text).trim();
    if (trimmed === '') return null;
    if (/^\d+$/.test(trimmed)) {
        const value = Number(trimmed);
        if (Number.isSafeInteger(value) && value <= 0xffffffff) return value >>> 0;
    }
    // FNV-1a over UTF-16 code units
    let h = 0x811c9dc5;
    for (let i = 0; i < trimmed.length; i++) {
        h = Math.imul(h ^ trimmed.charCodeAt(i), 0x01000193);
    }
    return h >>> 0;
}
