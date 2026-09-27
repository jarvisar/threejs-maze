import { EDGE_NONE } from '../world/grid.js';

// How many steps back undo can go.
const STEPS = 100;

/**
 * Undo and redo for edit mode. Everything the world changes between begin() and end() is one step (a click, or a
 * sweep of a button held down; see Game), whatever it took (a wall taken down takes what hung on it down with it), and
 * undo() puts all of the last step back the way it was, last change first; redo() does it all again.
 */
export class EditHistory {
    constructor(limit = STEPS) {
        this.limit = limit;
        /** @type {import('../world/ChunkStore.js').EditChange[][]} */
        this.done = [];
        /** @type {import('../world/ChunkStore.js').EditChange[][]} */
        this.undone = [];
        /** @type {import('../world/ChunkStore.js').EditChange[] | null} The step being made. */
        this._step = null;
        /** @type {import('../world/ChunkStore.js').ChunkStore | null} */
        this._store = null;
        // Putting a step back (or doing it again) makes changes of its own, which aren't steps.
        this._replaying = false;
    }

    /**
     * Listens to a world's changes (see ChunkStore.onChange). Another world has a history of its own: the last one's
     * is forgotten.
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     */
    attach(store) {
        if (this._store === store) return;
        if (this._store) this._store.onChange = null;
        this._store = store;
        store.onChange = (change) => this._record(change);
        this.clear();
    }

    /** Starts a step: everything changed until end() is undone in one go. */
    begin() {
        this._step ??= [];
    }

    end() {
        const step = this._step;
        this._step = null;
        if (step && step.length > 0) this._push(step);
    }

    get canUndo() {
        return this.done.length > 0;
    }

    get canRedo() {
        return this.undone.length > 0;
    }

    /**
     * Puts the last step back the way it was.
     * @returns {import('../world/ChunkStore.js').EditChange[] | null} What it changed back, or null for nothing to undo.
     */
    undo() {
        this.end();
        const step = this.done.pop();
        if (!step) return null;
        this._replay([...step].reverse(), true);
        this.undone.push(step);
        return step;
    }

    /**
     * Does the last step undone again.
     * @returns {import('../world/ChunkStore.js').EditChange[] | null} What it changed, or null for nothing to redo.
     */
    redo() {
        this.end();
        const step = this.undone.pop();
        if (!step) return null;
        this._replay(step, false);
        this.done.push(step);
        return step;
    }

    clear() {
        this.done.length = 0;
        this.undone.length = 0;
        this._step = null;
    }

    /** @param {import('../world/ChunkStore.js').EditChange} change */
    _record(change) {
        if (this._replaying) return;
        // (A change made outside a step is a step of its own.)
        if (this._step) this._step.push(change);
        else this._push([change]);
    }

    _push(step) {
        this.done.push(step);
        if (this.done.length > this.limit) this.done.shift();
        // Something new done: what was undone can't be done again on top of it.
        this.undone.length = 0;
    }

    /**
     * @param {import('../world/ChunkStore.js').EditChange[]} changes
     * @param {boolean} back Put back (undo), or done again (redo).
     */
    _replay(changes, back) {
        const store = /** @type {import('../world/ChunkStore.js').ChunkStore} */ (this._store);
        this._replaying = true;
        try {
            for (const change of changes) apply(store, change, back);
        } finally {
            this._replaying = false;
        }
    }
}

/**
 * Makes one change again (or undoes it, `back`).
 * @param {import('../world/ChunkStore.js').ChunkStore} store
 * @param {import('../world/ChunkStore.js').EditChange} change
 * @param {boolean} back
 */
function apply(store, change, back) {
    switch (change.kind) {
        case 'edge':
            store.setEdge(change.x, change.z, change.axis, back ? change.before : change.after);
            break;
        case 'pillar':
            store.setPillar(change.x, change.z, back ? change.before : change.after);
            break;
        case 'outlet':
            store.setOutlet(change.x, change.z, change.axis, change.side, back ? change.before : change.after);
            break;
        case 'prop':
            if (change.added === back) store.removeProp(change.prop);
            else store.addProp(change.prop);
            break;
        case 'light':
            store.setLight(change.x, change.z, ...(back ? change.before : change.after));
            break;
        default:
    }
}

/**
 * Whether a change put something up (or switched a light on), rather than took something down (or switched it off).
 * @param {import('../world/ChunkStore.js').EditChange} change
 */
export function builds(change) {
    switch (change.kind) {
        case 'edge':
            return change.after !== EDGE_NONE;
        case 'pillar':
            return change.after;
        case 'outlet':
            return change.after !== null;
        case 'prop':
            return change.added;
        default:
            return change.after[0] > 0;
    }
}

/**
 * The cells a step's changes were in, for building what's round them again (see WorldView.refreshCell): each once.
 * @param {import('../world/ChunkStore.js').EditChange[]} changes
 * @returns {{ x: number, z: number, light: boolean }[]}
 */
export function changedCells(changes) {
    const cells = new Map();
    for (const change of changes) {
        const x = change.kind === 'prop' ? Math.floor(change.prop.x + 0.5) : change.x;
        const z = change.kind === 'prop' ? Math.floor(change.prop.z + 0.5) : change.z;
        const key = `${x} ${z}`;
        const cell = cells.get(key) ?? { x, z, light: false };
        cell.light ||= change.kind === 'light';
        cells.set(key, cell);
    }
    return [...cells.values()];
}
