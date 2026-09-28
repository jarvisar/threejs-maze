import { loadRecords } from './footage/records.js';

const LEVEL_FUN_KEY = 'backrooms-simulator:level-fun:v1';

/*
 * Level Fun is unlocked by escaping a tape or entering the Konami code. Until then it's hidden everywhere, and
 * ?level=fun opens the normal level. Once found it stays unlocked in this browser.
 */

/** True if Level Fun was unlocked here, or any tape was escaped (covers records from before this key existed). */
export function levelFunFound() {
    try {
        if (globalThis.localStorage?.getItem(LEVEL_FUN_KEY) === '1') return true;
    } catch {
        // No storage, fall back to the records.
    }
    return loadRecords().finishes > 0;
}

export function findLevelFun() {
    try {
        globalThis.localStorage?.setItem(LEVEL_FUN_KEY, '1');
    } catch {
        // Only lasts for this visit then.
    }
}
