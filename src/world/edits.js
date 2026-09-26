import { PROP_NAMES, makeProp } from './decorations.js';
import { cellCoord, chunkCoord } from './grid.js';
import { decodeOutlet } from './outlets.js';

const PREFIX = 'backrooms-simulator:edits:';
const INDEX_KEY = 'backrooms-simulator:edited-worlds';
// Edits are kept for this many worlds; the least recently edited are forgotten first.
const MAX_WORLDS = 8;
const SAVE_DELAY_MS = 800;

/** Which of a cell's three editable things a change is to. */
export const EDIT_EDGE_X = 0;
export const EDIT_EDGE_Z = 1;
export const EDIT_PILLAR = 2;
/** An outlet put up or taken down: slotted by outletSlot rather than by cell (see outlets.js). */
export const EDIT_OUTLET = 3;

/**
 * @typedef {object} PropChanges What's been done to the props of one chunk.
 * @property {Set<number>} removed Generated props taken away, by their index (see Prop).
 * @property {import('./decorations.js').Prop[]} added Props put down.
 */

/**
 * The changes made to one world in edit mode, saved in the browser so that coming back to the same seed
 * brings them back. Changes are grouped by chunk and replayed over each chunk as it's generated.
 */
export class EditLog {
    /**
     * @param {number} seed
     * @param {number} [level] Each level's worlds are kept apart from the others' with the same seed.
     */
    constructor(seed, level = 0) {
        this.seed = seed;
        this.level = level;
        /** What it's saved under: "level:seed", or for Level 0 just the seed, as it always was. */
        this.world = level === 0 ? seed : `${level}:${seed}`;
        /** @type {Map<string, Map<number, number>>} chunk "cx,cz" → (slot → value) */
        this.chunks = new Map();
        /** @type {Map<string, PropChanges>} chunk "cx,cz" → its props' changes */
        this.props = new Map();
        this._timer = 0;
        // Only write when something changed here, so another tab's edits to the same world aren't clobbered.
        this._dirty = false;
        this._load();
    }

    /** Number of changed edges, pillars and outlets, and props put down or taken away. */
    get size() {
        let size = 0;
        for (const slots of this.chunks.values()) size += slots.size;
        for (const { removed, added } of this.props.values()) size += removed.size + added.length;
        return size;
    }

    /**
     * @param {number} cx
     * @param {number} cz
     * @param {number} kind EDIT_EDGE_X, EDIT_EDGE_Z, EDIT_PILLAR or EDIT_OUTLET
     * @param {number} index The cell's index within its chunk (or for an outlet, its slot).
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
        this._changed();
    }

    /**
     * A prop put down in chunk (cx, cz).
     * @param {import('./decorations.js').Prop} prop
     */
    addProp(cx, cz, prop) {
        this._propChanges(`${cx},${cz}`).added.push(prop);
        this._changed();
    }

    /**
     * A prop taken away from chunk (cx, cz): one it was generated with, or one put down earlier.
     * @param {import('./decorations.js').Prop} prop
     */
    removeProp(cx, cz, prop) {
        const key = `${cx},${cz}`;
        const changes = this._propChanges(key);
        if (prop.index !== undefined) {
            changes.removed.add(prop.index);
        } else {
            const i = changes.added.indexOf(prop);
            if (i >= 0) changes.added.splice(i, 1);
        }
        if (changes.removed.size === 0 && changes.added.length === 0) this.props.delete(key);
        this._changed();
    }

    /** Replays the saved changes onto a freshly generated chunk. */
    applyTo(chunk) {
        const key = `${chunk.cx},${chunk.cz}`;
        const slots = this.chunks.get(key);
        if (slots) {
            const arrays = [chunk.edgesX, chunk.edgesZ, chunk.pillars];
            for (const [slot, value] of slots) {
                const kind = Math.floor(slot / 65536);
                const index = slot % 65536;
                // (Outlets came later; a copy of the game from before them skips these, as it does any kind it
                // doesn't know.)
                if (kind === EDIT_OUTLET) {
                    if (index < chunk.edgesX.length * 4) (chunk.outlets ??= new Map()).set(index, decodeOutlet(value));
                    continue;
                }
                const array = arrays[kind];
                if (array && index < array.length) array[index] = value;
            }
        }
        const props = this.props.get(key);
        if (props) {
            chunk.props = chunk.props.filter((prop) => prop.index === undefined || !props.removed.has(prop.index));
            chunk.props.push(...props.added);
        }
    }

    clear() {
        this.chunks.clear();
        this.props.clear();
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
            const key = PREFIX + this.world;
            const index = readIndex(storage).filter((world) => world !== this.world);
            if (this.chunks.size === 0 && this.props.size === 0) {
                storage.removeItem(key);
            } else {
                const data = {};
                for (const [chunk, slots] of this.chunks) data[chunk] = [...slots];
                /** @type {{ version: number, chunks: object, props?: object }} */
                const saved = { version: 1, chunks: data };
                // Props came later, in a field of their own: saves from before them still load as they are, and
                // an older copy of the game (still open in another tab, say) still reads the walls.
                if (this.props.size > 0) {
                    saved.props = {};
                    for (const [chunk, { removed, added }] of this.props) {
                        saved.props[chunk] = {
                            removed: [...removed],
                            added: added.map((p) => [p.type, p.x, p.z, p.yaw, p.variant]),
                        };
                    }
                }
                storage.setItem(key, JSON.stringify(saved));
                index.push(this.world);
            }
            while (index.length > MAX_WORLDS) storage.removeItem(PREFIX + index.shift());
            storage.setItem(INDEX_KEY, JSON.stringify(index));
        } catch {
            // Out of space or storage blocked; edits still work for this visit.
        }
    }

    _changed() {
        this._dirty = true;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
    }

    /** @returns {PropChanges} */
    _propChanges(key) {
        let changes = this.props.get(key);
        if (!changes) {
            changes = { removed: new Set(), added: [] };
            this.props.set(key, changes);
        }
        return changes;
    }

    _load() {
        const storage = getStorage();
        if (!storage) return;
        try {
            const saved = JSON.parse(storage.getItem(PREFIX + this.world) ?? 'null');
            if (saved?.version !== 1 || typeof saved.chunks !== 'object') return;
            for (const [chunk, entries] of Object.entries(saved.chunks)) {
                if (!Array.isArray(entries)) continue;
                const slots = new Map();
                for (const entry of entries) {
                    if (Array.isArray(entry) && Number.isInteger(entry[0]) && Number.isInteger(entry[1])) slots.set(entry[0], entry[1]);
                }
                this.chunks.set(chunk, slots);
            }
            if (typeof saved.props === 'object' && saved.props !== null) {
                for (const [chunk, changes] of Object.entries(saved.props)) this._loadProps(chunk, changes);
            }
        } catch {
            // Junk in storage: start with no edits.
        }
    }

    _loadProps(chunk, changes) {
        const [cx, cz] = chunk.split(',').map(Number);
        if (!Number.isInteger(cx) || !Number.isInteger(cz) || typeof changes !== 'object' || changes === null) return;
        const removed = Array.isArray(changes.removed) ? changes.removed.filter((i) => Number.isInteger(i) && i >= 0) : [];
        const added = [];
        for (const entry of Array.isArray(changes.added) ? changes.added : []) {
            if (!Array.isArray(entry)) continue;
            const [type, x, z, yaw, variant] = entry;
            if (!Number.isInteger(type) || type < 0 || type >= PROP_NAMES.length) continue;
            if (![x, z, yaw].every(Number.isFinite) || !Number.isInteger(variant)) continue;
            // Only where it could have been put down: the chunks' meshes and collision expect their own props.
            if (chunkCoord(cellCoord(x)) !== cx || chunkCoord(cellCoord(z)) !== cz) continue;
            added.push(makeProp(type, x, z, yaw, variant >>> 0));
        }
        if (removed.length === 0 && added.length === 0) return;
        this.props.set(`${cx},${cz}`, { removed: new Set(removed), added });
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
        return Array.isArray(index) ? index.filter((world) => Number.isInteger(world) || (typeof world === 'string' && /^\d+:-?\d+$/.test(world))) : [];
    } catch {
        return [];
    }
}
