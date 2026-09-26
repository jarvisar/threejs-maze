import { loadRecords } from './footage/records.js';

const LEVEL_FUN_KEY = 'backrooms-simulator:level-fun:v1';

/*
 * Level Fun is found, not picked: by getting all the way out of a tape, or with the Konami code. Until then there's
 * no sign of it (no Level Fun on the title screen or in edit mode, and ?level=fun in a link opens the usual level).
 * Once it's found it stays found, in this browser.
 */

/** Whether Level Fun has been found here: remembered, or a tape's been got all the way out of (from before this). */
export function levelFunFound() {
    try {
        if (globalThis.localStorage?.getItem(LEVEL_FUN_KEY) === '1') return true;
    } catch {
        // No storage: only the records can say.
    }
    return loadRecords().finishes > 0;
}

/** Remembers that Level Fun has been found. */
export function findLevelFun() {
    try {
        globalThis.localStorage?.setItem(LEVEL_FUN_KEY, '1');
    } catch {
        // Found for this visit, at least.
    }
}
