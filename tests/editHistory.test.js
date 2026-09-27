import { describe, expect, it } from 'vitest';
import { EditHistory, builds, changedCells } from '../src/player/EditHistory.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { PROP_CHAIR, PROP_NOTE, PROP_PORTRAIT, makeProp } from '../src/world/decorations.js';
import { EditLog } from '../src/world/edits.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL } from '../src/world/grid.js';

function withStorage(test) {
    return () => {
        const original = globalThis.localStorage;
        const data = new Map();
        globalThis.localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
        try {
            test();
        } finally {
            globalThis.localStorage = original;
        }
    };
}

/** A world with its history, and a generated prop somewhere near the start. */
function world(seed = 5) {
    const store = new ChunkStore(seed, new EditLog(seed));
    const history = new EditHistory();
    history.attach(store);
    return { store, history };
}

/** Everything about the world an edit could change, near the start, to compare before and after. */
function snapshot(store) {
    const cells = [];
    for (let x = -4; x <= 4; x++) {
        for (let z = -4; z <= 4; z++) {
            cells.push(store.edge(x, z, 0), store.edge(x, z, 1), store.pillar(x, z), store.outlet(x, z, 0, 1), store.outlet(x, z, 1, -1));
            cells.push(store.propsAt(x, z).map((prop) => `${prop.type} ${prop.x} ${prop.z}`).sort().join());
        }
    }
    for (const [x, z] of [[1, 1], [-1, -1], [1, -3]]) cells.push(store.light(x, z).join());
    return cells;
}

describe('EditHistory', () => {
    it('undoes and redoes each kind of change, one step at a time, last first', withStorage(() => {
        const { store, history } = world();
        const start = snapshot(store);
        const chair = makeProp(PROP_CHAIR, 0.1, -1.1, 0.3, 5);
        history.begin();
        store.setEdge(0, -2, 1, EDGE_WALL);
        history.end();
        history.begin();
        store.setEdge(0, -2, 1, EDGE_DOOR);
        store.setPillar(2, 2, true);
        history.end();
        store.setOutlet(0, -2, 1, 1, 0.1);
        store.addProp(chair);
        store.setLight(1, -1, 0, 0);
        const after = snapshot(store);
        // (Those three outside a step are a step each.)
        expect(history.done.length).toBe(5);

        expect(history.undo()).toEqual([{ kind: 'light', x: 1, z: -1, before: [255, 0], after: [0, 0] }]);
        expect(store.light(1, -1)).toEqual([255, 0]);
        history.undo();
        expect(store.propsAt(0, -1)).toEqual([]);
        history.undo();
        expect(store.outlet(0, -2, 1, 1)).toBeNull();
        history.undo();
        // Both changes of that step.
        expect(store.edge(0, -2, 1)).toBe(EDGE_WALL);
        expect(store.pillar(2, 2)).toBe(false);
        history.undo();
        expect(snapshot(store)).toEqual(start);
        expect(history.undo()).toBeNull();

        // And all of it again, the same.
        while (history.redo());
        expect(snapshot(store)).toEqual(after);
        expect(store.propsAt(0, -1)).toEqual([chair]);
    }));

    it('forgets what was undone once something new is done', withStorage(() => {
        const { store, history } = world();
        store.setEdge(0, -2, 1, EDGE_WALL);
        history.undo();
        expect(history.canRedo).toBe(true);
        store.setPillar(1, 1, true);
        expect(history.canRedo).toBe(false);
        expect(history.redo()).toBeNull();
    }));

    it('puts back a generated prop that was taken away, and leaves nothing to save once everything is undone', withStorage(() => {
        const { store, history } = world(9);
        let prop = null;
        for (let cx = -2; cx <= 2 && !prop; cx++) for (let cz = -2; cz <= 2 && !prop; cz++) prop = store.getChunk(cx, cz).props[0] ?? null;
        expect(prop).not.toBeNull();
        const start = store.getChunk(Math.floor((Math.round(prop.x) + 8) / 16), Math.floor((Math.round(prop.z) + 8) / 16)).props.slice();
        store.removeProp(prop);
        store.setEdge(0, -2, 1, EDGE_WALL);
        store.setOutlet(0, -2, 1, -1, 0.2);
        store.setLight(1, 1, 255, 40);
        store.addProp(makeProp(PROP_CHAIR, 0.1, -1.1, 0.3, 5));
        expect(store.edits.size).toBe(5);
        while (history.undo());
        expect(store.edits.size).toBe(0);
        expect(store.getChunk(Math.floor((Math.round(prop.x) + 8) / 16), Math.floor((Math.round(prop.z) + 8) / 16)).props).toEqual(expect.arrayContaining(start));
        // Saved, it's the world as it was made.
        store.edits.save();
        expect(new EditLog(9).size).toBe(0);
    }));

    it('takes down what hangs on a wall with the wall, and puts both back together', withStorage(() => {
        const { store, history } = world();
        store.setEdge(0, -2, 1, EDGE_WALL); // the wall at z = −1.5
        // A note on each side of it.
        const near = makeProp(PROP_NOTE, 0.1, -1.5 + 0.042, 0, 1);
        const far = makeProp(PROP_PORTRAIT, -0.1, -1.5 - 0.042, Math.PI, 2);
        store.addProp(near);
        store.addProp(far);
        history.begin();
        store.setEdge(0, -2, 1, EDGE_DOOR);
        history.end();
        expect(store.propsAt(0, -1)).toEqual([]);
        expect(store.propsAt(0, -2)).toEqual([]);
        history.undo();
        expect(store.edge(0, -2, 1)).toBe(EDGE_WALL);
        expect(store.propsAt(0, -1)).toEqual([near]);
        expect(store.propsAt(0, -2)).toEqual([far]);
        // What stands on the floor by it stays either way.
        const chair = makeProp(PROP_CHAIR, 0, -1.3, 0, 5);
        store.addProp(chair);
        store.setEdge(0, -2, 1, EDGE_NONE);
        expect(store.propsAt(0, -1)).toEqual([chair]);
    }));

    it('keeps each world\'s history to itself', withStorage(() => {
        const { store, history } = world();
        store.setEdge(0, -2, 1, EDGE_WALL);
        expect(history.canUndo).toBe(true);
        const other = new ChunkStore(6, new EditLog(6));
        history.attach(other);
        expect(history.canUndo).toBe(false);
        // The first world's changes aren't heard any more.
        store.setPillar(1, 1, true);
        expect(history.canUndo).toBe(false);
        other.setPillar(1, 1, true);
        expect(history.canUndo).toBe(true);
    }));

    it('goes back only so far', withStorage(() => {
        const store = new ChunkStore(5, new EditLog(5));
        const history = new EditHistory(3);
        history.attach(store);
        for (let k = 0; k < 5; k++) store.setPillar(k, 3, true);
        let steps = 0;
        while (history.undo()) steps++;
        expect(steps).toBe(3);
        expect(store.pillar(0, 3)).toBe(true);
        expect(store.pillar(2, 3)).toBe(false);
    }));

    it('says what a change did, and where', () => {
        expect(builds({ kind: 'edge', x: 0, z: 0, axis: 0, before: EDGE_NONE, after: EDGE_WALL })).toBe(true);
        expect(builds({ kind: 'edge', x: 0, z: 0, axis: 0, before: EDGE_WALL, after: EDGE_NONE })).toBe(false);
        expect(builds({ kind: 'light', x: 1, z: 1, before: [0, 0], after: [255, 0] })).toBe(true);
        expect(builds({ kind: 'prop', prop: makeProp(PROP_CHAIR, 0, 0, 0, 1), added: false })).toBe(false);
        const cells = changedCells([
            { kind: 'edge', x: 2, z: 3, axis: 0, before: EDGE_NONE, after: EDGE_WALL },
            { kind: 'pillar', x: 2, z: 3, before: false, after: true },
            { kind: 'prop', prop: makeProp(PROP_CHAIR, 5.2, -1.4, 0, 1), added: true },
            { kind: 'light', x: 1, z: 1, before: [0, 0], after: [255, 0] },
        ]);
        expect(cells).toEqual([{ x: 2, z: 3, light: false }, { x: 5, z: -1, light: false }, { x: 1, z: 1, light: true }]);
    });
});
