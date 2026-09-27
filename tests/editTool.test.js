import { LineBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WALL_THICKNESS } from '../src/config.js';
import { EDIT_TOOLS, EditTool } from '../src/player/EditTool.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { PROP_CHAIR, PROP_GUEST, PROP_MAHJONG, PROP_MONITOR, PROP_PORTRAIT, makeProp } from '../src/world/decorations.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL } from '../src/world/grid.js';
import { levelOneOptions } from '../src/world/levelOne.js';
import { propBounds, propFootprint } from '../src/world/props.js';

// Somewhere well away from anything being edited, for tests that aren't about the player.
const FAR_AWAY = new Vector3(100, 0.5, 100);

function makeTool(tool) {
    const editTool = new EditTool(new Scene(), { build: new LineBasicMaterial(), select: new LineBasicMaterial() });
    editTool.setLevelFun(true);
    if (!editTool.select(tool)) throw new Error(`no ${tool} to pick`);
    return editTool;
}

/** Aims from `from` at `at` (both [x, y, z]) and updates the tool. */
function aim(tool, store, from, at, player = FAR_AWAY) {
    const camera = new PerspectiveCamera();
    camera.position.set(...from);
    camera.lookAt(...at);
    tool.update(camera, store, player);
    return tool.target;
}

/** The way a prop faces: its front, (sin yaw, cos yaw). */
const facing = (prop) => [Math.sin(prop.yaw), Math.cos(prop.yaw)];

describe('EditTool', () => {
    it('picks any tool there is by its name', () => {
        const tool = makeTool('wall');
        for (const name of EDIT_TOOLS) {
            expect(tool.select(name)).toBe(true);
            expect(tool.tool).toBe(name);
        }
        expect(tool.select('tile')).toBe(false);
        expect(tool.tool).toBe(EDIT_TOOLS.at(-1));
    });

    it('turns what\'s put down an eighth of a turn at a time, either way', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('chair');
        const eye = [0, 0.5, 0];
        const at = [0.1, 0, -1.2];
        const yaw = aim(tool, store, eye, at).prop.yaw;
        tool.rotate(1);
        const once = aim(tool, store, eye, at).prop.yaw;
        expect(Math.cos(once - yaw)).toBeCloseTo(Math.cos(Math.PI / 4), 6);
        expect(Math.sin(once - yaw)).toBeCloseTo(Math.sin(Math.PI / 4), 6);
        tool.rotate(-1);
        tool.rotate(-1);
        const back = aim(tool, store, eye, at).prop.yaw;
        expect(Math.sin(back - yaw)).toBeCloseTo(-Math.sin(Math.PI / 4), 6);
        for (let k = 0; k < 8; k++) tool.rotate(1);
        expect(Math.sin(aim(tool, store, eye, at).prop.yaw - back)).toBeCloseTo(0, 6);
    });

    it('puts it up against a wall, its back to the wall, when it\'s aimed near one', () => {
        const store = new ChunkStore(1);
        store.setEdge(0, -2, 1, EDGE_WALL); // the wall at z = −1.5
        const tool = makeTool('monitor');
        const target = aim(tool, store, [0.2, 0.5, 0], [0.1, 0, -1.38]);
        expect(target).toMatchObject({ kind: 'prop', x: 0, z: -1, current: false });
        const [fx, fz] = facing(target.prop);
        expect(fx).toBeCloseTo(0, 6);
        expect(fz).toBeCloseTo(1, 6);
        const face = -1.5 + WALL_THICKNESS / 2;
        const [, z0] = propFootprint(target.prop);
        expect(z0).toBeGreaterThan(face);
        expect(z0).toBeLessThan(face + 0.02);
        // Further out, it faces whoever's putting it down, as ever.
        const out = aim(tool, store, [0.2, 0.5, 0], [0.1, 0, -1.1]);
        expect(Math.abs(facing(out.prop)[0])).toBeGreaterThan(0.05);
    });

    it('gives what\'s put down another look when asked, and a new one after each', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('crates');
        const eye = [0, 0.5, 0];
        const first = aim(tool, store, eye, [0, 0, -1.2]).prop.variant;
        expect(aim(tool, store, eye, [0, 0, -1.2]).prop.variant).toBe(first);
        tool.restyle();
        const second = aim(tool, store, eye, [0, 0, -1.2]).prop.variant;
        expect(second).not.toBe(first);
        tool.place(store, FAR_AWAY);
        store.removeProp(store.propsAt(0, -1)[0]);
        expect(aim(tool, store, eye, [0, 0, -1.2]).prop.variant).not.toBe(second);
    });

    it('copies what it\'s aimed at: a prop exactly as it looks, or the tool that builds the rest', () => {
        const store = new ChunkStore(1);
        store.setEdge(0, -2, 1, EDGE_WALL);
        store.setEdge(1, -2, 1, EDGE_DOOR);
        // A chair on its side, which a chair put down on purpose never is (see uprightVariant).
        const tipped = makeProp(PROP_CHAIR, 0, -1, 0.3, 0x1000);
        store.addProp(tipped);
        const tool = makeTool('wall');
        aim(tool, store, [0.3, 0.5, -0.2], [0, 0.1, -1]);
        expect(tool.copy()).toBe('chair');
        expect(tool.tool).toBe('chair');
        // Put down again elsewhere: the same, and again after that.
        store.removeProp(tipped);
        for (let k = 0; k < 2; k++) {
            const copy = aim(tool, store, [0.3, 0.5, 0.4], [0.2, 0, -0.8]).prop;
            expect(copy.variant).toBe(tipped.variant);
            tool.place(store, FAR_AWAY);
            store.removeProp(copy);
        }
        // Another tool, and it's a new look again.
        tool.cycleTool(1);
        tool.cycleTool(-1);
        expect(aim(tool, store, [0.3, 0.5, 0.4], [0.2, 0, -0.8]).prop.variant & 3).not.toBe(0);

        const doorway = makeTool('chair');
        aim(doorway, store, [1, 0.5, -0.8], [1.2, 0.85, -1.5]);
        expect(doorway.copy()).toBe('doorway');
        aim(doorway, store, [0, 0.5, -0.8], [0, 0.5, -1.5]);
        expect(doorway.copy()).toBe('wall');
        // Nothing there: nothing to copy, and the tool stays.
        aim(doorway, store, [0, 0.5, -0.8], [0, 5, -0.8]);
        expect(doorway.copy()).toBeNull();
        expect(doorway.tool).toBe('wall');
    });

    it('hangs what goes on a wall where it\'s aimed, facing out of it, on the side it\'s aimed from', () => {
        const store = new ChunkStore(1);
        store.setEdge(0, -1, 0, EDGE_WALL); // the wall at x = 0.5
        const tool = makeTool('portrait');
        const target = aim(tool, store, [0, 0.5, -1.1], [0.5, 0.55, -0.95]);
        expect(target).toMatchObject({ kind: 'prop', x: 0, z: -1, current: false, edge: { x: 0, z: -1, axis: 0 } });
        const prop = target.prop;
        expect(prop.x).toBeCloseTo(0.5 - WALL_THICKNESS / 2 - 0.002, 6);
        expect(prop.z).toBeCloseTo(-0.95, 1);
        expect(facing(prop)[0]).toBeCloseTo(-1, 6);
        expect(prop.box).toBeNull();
        expect(tool.describe()).toEqual({ build: 'HANG PORTRAIT', remove: 'REMOVE WALL', note: null });
        expect(tool.place(store, FAR_AWAY)).toEqual({ x: 0, z: -1 });
        // Aimed at, it's there to be removed; beside it, there's no room for another; on the far side, there is.
        expect(aim(tool, store, [0, 0.5, -1.1], [0.5, 0.55, -0.95])).toMatchObject({ kind: 'prop', current: true, prop });
        expect(tool.describe()).toEqual({ build: null, remove: 'REMOVE PORTRAIT', note: null });
        expect(aim(tool, store, [0.1, 0.55, -0.8], [0.5, 0.55, -0.8])).toMatchObject({ kind: 'edge' });
        expect(tool.describe().note).toBe('NO ROOM');
        const other = aim(tool, store, [1, 0.5, -1.1], [0.5, 0.55, -0.95]);
        expect(other).toMatchObject({ kind: 'prop', x: 1, z: -1, current: false });
        expect(facing(other.prop)[0]).toBeCloseTo(1, 6);

        // Only on a wall.
        expect(aim(tool, store, [0, 0.5, -0.4], [0, 0, -1])).toBeNull();
        expect(tool.describe()).toEqual({ build: null, remove: null, note: 'AIM AT A WALL' });
        store.setEdge(0, -3, 0, EDGE_DOOR);
        expect(aim(tool, store, [0, 0.5, -3.1], [0.5, 0.9, -3])).toMatchObject({ kind: 'edge', current: EDGE_DOOR });
        expect(tool.place(store, FAR_AWAY)).toBeNull();

        // Taken down with its wall.
        expect(store.propsAt(0, -1).map(({ type }) => type)).toEqual([PROP_PORTRAIT]);
        store.setEdge(0, -1, 0, EDGE_NONE);
        expect(store.propsAt(0, -1)).toEqual([]);
    });

    it('switches a light on, to flickering and back, and off', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('light');
        const eye = [0.2, 0.5, 0.3];
        const at = [1, 1, -1];
        expect(aim(tool, store, eye, at)).toEqual({ kind: 'light', x: 1, z: -1, brightness: 255, flicker: 0 });
        expect(tool.describe()).toEqual({ build: 'FLICKER', remove: 'LIGHT OFF', note: null });
        expect(tool.place(store, FAR_AWAY)).toEqual({ x: 1, z: -1 });
        const [brightness, flicker] = store.light(1, -1);
        expect(brightness).toBe(255);
        expect(flicker).toBeGreaterThan(0);
        aim(tool, store, eye, at);
        expect(tool.describe().build).toBe('STEADY');
        tool.place(store, FAR_AWAY);
        expect(store.light(1, -1)).toEqual([255, 0]);
        aim(tool, store, eye, at);
        expect(tool.remove(store)).toEqual({ x: 1, z: -1 });
        expect(store.light(1, -1)).toEqual([0, 0]);
        aim(tool, store, eye, at);
        expect(tool.describe()).toEqual({ build: 'LIGHT ON', remove: null, note: null });
        tool.place(store, FAR_AWAY);
        expect(store.light(1, -1)).toEqual([255, 0]);

        // Aimed at the floor, there's nothing to switch; from over the walls, it's the light over where it lands.
        expect(aim(tool, store, eye, [0.5, 0, -1])).toBeNull();
        expect(tool.describe().note).toBe('AIM AT A LIGHT');
        expect(aim(tool, store, [1, 2, 0], [1, 0, -1])).toMatchObject({ kind: 'light', x: 1, z: -1 });
    });

    it('only switches a light where there is one', () => {
        // A car park's rows of lights have gaps between them (see levelOne.js).
        const store = new ChunkStore(4, null, levelOneOptions(4));
        const tool = makeTool('light');
        let found = null;
        for (let x = -7; x <= 7 && !found; x += 2) {
            for (let z = -7; z <= 7 && !found; z += 2) if (!store.hasLight(x, z)) found = [x, z];
        }
        expect(found).not.toBeNull();
        const [x, z] = found;
        expect(aim(tool, store, [x + 0.2, 0.5, z + 0.3], [x, 1, z])).toBeNull();
        expect(tool.describe().note).toBe('NO LIGHT');
    });

    it('sweeps a held button over only what it can act on, each thing once', () => {
        const store = new ChunkStore(1);
        store.setEdge(0, -2, 1, EDGE_NONE);
        const tool = makeTool('wall');
        aim(tool, store, [0, 0.5, 0], [0, 0, -1.45]);
        expect(tool.target).toMatchObject({ kind: 'edge', current: EDGE_NONE });
        expect(tool.repeatable('build')).toBe(true);
        expect(tool.repeatable('remove')).toBe(false);
        const key = tool.targetKey();
        tool.place(store, FAR_AWAY);
        aim(tool, store, [0, 0.5, 0], [0, 0, -1.45]);
        // Built: the same thing still, which a sweep doesn't build on again (it'd make a doorway of it).
        expect(tool.targetKey()).toBe(key);
        expect(tool.repeatable('build')).toBe(false);
        expect(tool.repeatable('remove')).toBe(true);
        const light = makeTool('light');
        aim(light, store, [0.2, 0.5, 0.3], [1, 1, -1]);
        expect(light.repeatable('build')).toBe(false);
        expect(light.repeatable('remove')).toBe(false);
    });

    it('keeps how much is put down in one chunk to what it can build again at once', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('monitor');
        const eye = [0, 0.5, 0];
        expect(aim(tool, store, eye, [0, 0, -1.2])?.kind).toBe('prop');
        // A room's worth of the heaviest there is, in the chunk.
        const heavy = [];
        for (let x = -7; x <= 7 && heavy.length < 60; x++) {
            for (let z = 4; z <= 7 && heavy.length < 60; z++) {
                const table = makeProp(PROP_MAHJONG, x, z, 0, 1);
                store.addProp(table);
                heavy.push(table);
            }
        }
        expect(aim(tool, store, eye, [0, 0, -1.2])).toBeNull();
        expect(tool.describe().note).toBe('CHUNK FULL');
        expect(tool.place(store, FAR_AWAY)).toBeNull();
        // Some taken away, and there's room again; the chunk next door was never full.
        for (const table of heavy.slice(0, 30)) store.removeProp(table);
        expect(aim(tool, store, eye, [0, 0, -1.2])?.kind).toBe('prop');
        expect(aim(tool, store, [0, 0.5, -8.6], [0, 0, -9.5])?.kind).toBe('prop');
        expect(propBounds(makeProp(PROP_MONITOR, 0, 0, 0, 1))[4]).toBeGreaterThan(0);
    });

    it('puts a partygoer down out of its reach, so it doesn\'t pop straight away, and only a few in a chunk', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('partygoer');
        const player = new Vector3(0, 0.5, 0);
        // Right in front: it'd pop. A step further: fine.
        expect(aim(tool, store, [0, 0.5, 0], [0, 0, -0.45], player)).toBeNull();
        expect(tool.describe().note).toBe('NO ROOM');
        // From up over the walls, it can go down right under you (it only pops when you come down to it).
        expect(aim(tool, store, [0, 1.6, 0], [0.05, 0, -0.3], new Vector3(0, 1.6, 0))?.kind).toBe('prop');
        const target = aim(tool, store, [0, 0.5, 0], [0, 0, -1.2], player);
        expect(target).toMatchObject({ kind: 'prop', current: false, prop: { type: PROP_GUEST, box: null } });
        expect(tool.describe().build).toBe('PLACE PARTYGOER');
        expect(tool.place(store, player)).toEqual({ x: 0, z: -1 });

        // Aimed at, from any side, it's there to be removed (it turns to watch you: see PartyLayer.js).
        const [placed] = store.propsAt(0, -1);
        for (const [x, z] of [[0, 0], [1, -1], [-1, -1], [0, -2]]) {
            expect(aim(tool, store, [x, 0.5, z], [placed.x, 0.3, placed.z], FAR_AWAY), `from ${x}, ${z}`).toMatchObject({ kind: 'prop', current: true, prop: placed });
        }
        expect(tool.describe().remove).toBe('REMOVE PARTYGOER');

        // A few to a chunk: each is drawn on its own.
        for (let k = 0; k < 5; k++) store.addProp(makeProp(PROP_GUEST, 2 + k, 5, 0, 1));
        expect(aim(tool, store, [3, 0.5, 0], [3, 0, -1.2], FAR_AWAY)).toBeNull();
        expect(tool.describe().note).toBe('CHUNK FULL');
        // Anything else still goes down.
        tool.select('chair');
        expect(aim(tool, store, [3, 0.5, 0], [3, 0, -1.2], FAR_AWAY)?.kind).toBe('prop');
    });
});
