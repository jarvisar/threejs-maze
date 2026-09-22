const PREFIX = 'backrooms-simulator:edits:';
const INDEX_KEY = 'backrooms-simulator:edited-worlds';
// Edits are kept for this many worlds; the least recently edited are forgotten first.
const MAX_WORLDS = 8;
const SAVE_DELAY_MS = 800;

/** Which of a cell's three editable things a change is to. */
export const EDIT_EDGE_X = 0;
export const EDIT_EDGE_Z = 1;
export const EDIT_PILLAR = 2;

/**
 * The changes made to one world in edit mode, saved in the browser so that coming back to the same seed
 * brings them back. Changes are grouped by chunk and replayed over each chunk as it's generated.
 */
export class EditLog {
    /** @param {number} seed */
    constructor(seed) {
        this.seed = seed;
        /** @type {Map<string, Map<number, number>>} chunk "cx,cz" → (slot → value) */
        this.chunks = new Map();
        this._timer = 0;
        // Only write when something changed here, so another tab's edits to the same world aren't clobbered.
        this._dirty = false;
        this._load();
    }

    /** Number of changed edges and pillars. */
    get size() {
        let size = 0;
        for (const slots of this.chunks.values()) size += slots.size;
        return size;
    }

    /**
     * @param {number} cx
     * @param {number} cz
     * @param {number} kind EDIT_EDGE_X, EDIT_EDGE_Z or EDIT_PILLAR
     * @param {number} index The cell's index within its chunk.
     * @param {number} value
     */
    record(cx, cz, kind, index, value) {
        const key = `${cx},${cz}`;
        let slots = this.chunks.get(key);
        if (!slots) {
            slots = new Map();
            this.chunks.set(key, slots);
        }
        slots.set(kind * 65536 + index, value);
        this._dirty = true;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
    }

    /** Replays the saved changes onto a freshly generated chunk. */
    applyTo(chunk) {
        const slots = this.chunks.get(`${chunk.cx},${chunk.cz}`);
        if (!slots) return;
        const arrays = [chunk.edgesX, chunk.edgesZ, chunk.pillars];
        for (const [slot, value] of slots) {
            const array = arrays[Math.floor(slot / 65536)];
            const index = slot % 65536;
            if (array && index < array.length) array[index] = value;
        }
    }

    clear() {
        this.chunks.clear();
        this._dirty = true;
        this.save();
    }

    /** Writes any changes not yet saved (called shortly after each change, and when the page is hidden). */
    save() {
        clearTimeout(this._timer);
        if (!this._dirty) return;
        this._dirty = false;
        const storage = getStorage();
        if (!storage) return;
        try {
            const key = PREFIX + this.seed;
            const index = readIndex(storage).filter((seed) => seed !== this.seed);
            if (this.chunks.size === 0) {
                storage.removeItem(key);
            } else {
                const data = {};
                for (const [chunk, slots] of this.chunks) data[chunk] = [...slots];
                storage.setItem(key, JSON.stringify({ version: 1, chunks: data }));
                index.push(this.seed);
            }
            while (index.length > MAX_WORLDS) storage.removeItem(PREFIX + index.shift());
            storage.setItem(INDEX_KEY, JSON.stringify(index));
        } catch {
            // Out of space or storage blocked; edits still work for this visit.
        }
    }

    _load() {
        const storage = getStorage();
        if (!storage) return;
        try {
            const saved = JSON.parse(storage.getItem(PREFIX + this.seed) ?? 'null');
            if (saved?.version !== 1 || typeof saved.chunks !== 'object') return;
            for (const [chunk, entries] of Object.entries(saved.chunks)) {
                if (!Array.isArray(entries)) continue;
                const slots = new Map();
                for (const entry of entries) {
                    if (Array.isArray(entry) && Number.isInteger(entry[0]) && Number.isInteger(entry[1])) slots.set(entry[0], entry[1]);
                }
                this.chunks.set(chunk, slots);
            }
        } catch {
            // Junk in storage: start with no edits.
        }
    }
}

function getStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function readIndex(storage) {
    try {
        const index = JSON.parse(storage.getItem(INDEX_KEY) ?? '[]');
        return Array.isArray(index) ? index.filter(Number.isInteger) : [];
    } catch {
        return [];
    }
}
