import { Color, Group, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROP_GUEST, makeProp } from '../src/world/decorations.js';
import { PartyLayer } from '../src/world/PartyLayer.js';

// The candles' glow draws on a canvas. There isn't a real one here, so fake it.
const original = globalThis.document;
beforeAll(() => {
    const context = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
    globalThis.document = /** @type {any} */ ({ createElement: () => ({ getContext: () => context }) });
});
afterAll(() => {
    globalThis.document = original;
});

function makeLayer() {
    const materials = { things: new MeshBasicMaterial(), decal: new MeshBasicMaterial(), flame: new MeshBasicMaterial({ color: new Color() }) };
    return new PartyLayer(/** @type {any} */ (materials));
}

/** A camera at (x, y, z), looking at (lx, ly, lz). */
function viewer([x, y, z], [lx, ly, lz]) {
    const camera = new PerspectiveCamera();
    camera.position.set(x, y, z);
    camera.lookAt(lx, ly, lz);
    camera.updateMatrixWorld();
    return camera;
}

const guestsIn = (group) => group.children.filter((child) => child.name === 'guest');

describe('PartyLayer', () => {
    it('has a partygoer put down in edit mode turn to watch you, on any level, pop, and come back out of sight', () => {
        const layer = makeLayer();
        const chunk = { cx: 0, cz: 0, group: new Group() };
        const data = { party: null, props: [makeProp(PROP_GUEST, 2, 0.5, 0, 1)] };
        layer.attach(/** @type {any} */ (chunk), /** @type {any} */ (data));
        const [guest] = guestsIn(chunk.group);
        expect(guest).toBeDefined();
        expect(guest.position.toArray()).toEqual([2, 0, 0.5]);

        // It turns to face you.
        const pops = [];
        const onPop = (x, y, z) => pops.push([x, y, z]);
        layer.update(1, viewer([4, 0.5, 0.5], [2, 0.3, 0.5]), true, onPop);
        expect(guest.rotation.y).toBeGreaterThan(1);
        // Not from over the walls. Walked up to, it pops.
        layer.update(0.1, viewer([2.1, 1.7, 0.6], [2, 0, 0.5]), true, onPop);
        expect(pops).toEqual([]);
        layer.update(0.1, viewer([2.1, 0.5, 0.6], [3, 0.5, 0.6]), true, onPop);
        expect(pops).toEqual([[2, 0, 0.5]]);
        expect(guestsIn(chunk.group)).toEqual([]);
        // Its chunk built again (something put down near it), and it's still away, not popping again where you stand.
        layer.detach(/** @type {any} */ (chunk));
        layer.attach(/** @type {any} */ (chunk), /** @type {any} */ (data));
        layer.update(0.1, viewer([2.1, 0.5, 0.6], [3, 0.5, 0.6]), true, onPop);
        expect(guestsIn(chunk.group)).toEqual([]);
        expect(pops.length).toBe(1);
        const [again] = layer.attached.get(/** @type {any} */ (chunk))?.guests ?? [];

        // Back a while later, but not while you're right there, or looking.
        layer.update(10, viewer([2.1, 0.5, 0.6], [3, 0.5, 0.6]), true, onPop);
        expect(guestsIn(chunk.group)).toEqual([]);
        layer.update(0.1, viewer([5, 0.5, 0.5], [2, 0.5, 0.5]), true, onPop);
        expect(guestsIn(chunk.group)).toEqual([]);
        layer.update(0.1, viewer([5, 0.5, 0.5], [8, 0.5, 0.5]), true, onPop);
        expect(guestsIn(chunk.group)).toEqual([again.mesh]);
        expect(pops.length).toBe(1);
        // And built again now, it's there.
        layer.detach(/** @type {any} */ (chunk));
        layer.attach(/** @type {any} */ (chunk), /** @type {any} */ (data));
        expect(guestsIn(chunk.group).length).toBe(1);
    });

    it('keeps the party\'s own guests that have popped gone, in this world', () => {
        const layer = makeLayer();
        const chunk = { cx: 0, cz: 0, group: new Group() };
        const data = { party: { things: [], discos: [], guests: [{ x: 1, z: 1, yaw: 0 }] }, props: [] };
        layer.attach(/** @type {any} */ (chunk), /** @type {any} */ (data));
        expect(guestsIn(chunk.group).length).toBe(1);
        layer.update(0.1, viewer([1.1, 0.5, 1.1], [2, 0.5, 1.1]), true, () => {});
        layer.update(30, viewer([6, 0.5, 6], [9, 0.5, 9]), true, () => {});
        expect(guestsIn(chunk.group)).toEqual([]);
        layer.detach(/** @type {any} */ (chunk));
        layer.attach(/** @type {any} */ (chunk), /** @type {any} */ (data));
        expect(guestsIn(chunk.group)).toEqual([]);
        // A different world.
        layer.reset();
        layer.detach(/** @type {any} */ (chunk));
        layer.attach(/** @type {any} */ (chunk), /** @type {any} */ (data));
        expect(guestsIn(chunk.group).length).toBe(1);
    });
});
