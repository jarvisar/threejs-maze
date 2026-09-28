import { EDGE_NONE } from '../world/grid.js';

// Max undo steps.
const STEPS = 100;

/**
 * Undo/redo for edit mode. All world changes between begin() and end() make one step (a click, or a held-button
 * sweep, see Game), including side effects like props removed with their wall. undo() reverts the last step in
 * reverse order.
 */
export class EditHistory {
    constructor(limit = STEPS) {
        this.limit = limit;
        /** @type {import('../world/ChunkStore.js').EditChange[][]} */
        this.done = [];
        /** @type {import('../world/ChunkStore.js').EditChange[][]} */
        this.undone = [];
        /** @type {import('../world/ChunkStore.js').EditChange[] | null} Step in progress. */
        this._step = null;
        /** @type {import('../world/ChunkStore.js').ChunkStore | null} */
        this._store = null;
        // Undo/redo fire change events too. Those must not be recorded as new steps.
        this._replaying = false;
    }

    /**
     * Listens to a world's changes (see ChunkStore.onChange). Switching worlds clears the history.
     * @param {import('../world/ChunkStore.js').ChunkStore} store
     */
    attach(store) {
        if (this._store === store) return;
        if (this._store) this._store.onChange = null;
        this._store = store;
        store.onChange = (change) => this._record(change);
        this.clear();
    }

    /** Starts a step. Everything until end() undoes together. */
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
     * @returns {import('../world/ChunkStore.js').EditChange[] | null} The reverted changes, or null if nothing to undo.
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
     * @returns {import('../world/ChunkStore.js').EditChange[] | null} The reapplied changes, or null if nothing to redo.
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
        // A change outside begin/end is its own step.
        if (this._step) this._step.push(change);
        else this._push([change]);
    }

    _push(step) {
        this.done.push(step);
        if (this.done.length > this.limit) this.done.shift();
        // A new edit drops the redo stack.
        this.undone.length = 0;
    }

    /**
     * @param {import('../world/ChunkStore.js').EditChange[]} changes
     * @param {boolean} back True for undo, false for redo.
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
 * Reapplies one change, or reverts it when `back` is set.
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
 * True if a change built something or turned a light on. False for removals and lights off.
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
 * Unique cells touched by a step, for rebuilding around them (see WorldView.refreshCell).
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
