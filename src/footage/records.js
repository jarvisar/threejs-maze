const KEY = 'backrooms-simulator:footage:v1';

/**
 * @typedef {object} Records
 * @property {number} runs Tapes started.
 * @property {number} escapes Tapes that escaped the first level.
 * @property {number} best Fastest escape from the first level (s), 0 if none yet.
 * @property {number} finishes Tapes that got through every level to Level Fun.
 * @property {number} bestFinish Fastest full run (s), 0 if none yet.
 */

/** @returns {Records} */
export function loadRecords() {
    const records = { runs: 0, escapes: 0, best: 0, finishes: 0, bestFinish: 0 };
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
        for (const key of Object.keys(records)) {
            if (typeof saved?.[key] === 'number' && Number.isFinite(saved[key]) && saved[key] >= 0) records[key] = saved[key];
        }
    } catch {
        // No storage or bad data. Starting from zero is fine.
    }
    return records;
}

/** @param {Records} records */
export function saveRecords(records) {
    try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify(records));
    } catch {
        // Failing to save records shouldn't break anything.
    }
}

/** "4:07" or "1:02:33". */
export function formatTime(seconds) {
    const whole = Math.floor(seconds);
    const h = Math.floor(whole / 3600);
    const m = Math.floor(whole / 60) % 60;
    const s = whole % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
