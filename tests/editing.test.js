import { LineBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HALF_CHUNK, PILLAR_SIZE, PLAYER_RADIUS, WALL_THICKNESS } from '../src/config.js';
import { moveAndCollide } from '../src/player/collision.js';
import { EDIT_TOOLS, EDIT_TOOL_GROUPS, EditTool } from '../src/player/EditTool.js';
import { raycastWorld } from '../src/player/raycast.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { PROP_BOTTLES, PROP_CHAIR, PROP_MONITOR, PROP_SIGN, makeProp } from '../src/world/decorations.js';
import { EditLog } from '../src/world/edits.js';
import { EDGE_NONE, EDGE_WALL, cellCoord, chunkCoord } from '../src/world/grid.js';
import { propBounds, propFootprint } from '../src/world/props.js';

const DECORATIONS = ['chair', 'monitor', 'bottles', 'sign'];
const TYPES = { chair: PROP_CHAIR, monitor: PROP_MONITOR, bottles: PROP_BOTTLES, sign: PROP_SIGN };
// Somewhere well away from anything being edited, for tests that aren't about the player.
const FAR_AWAY = new Vector3(100, 0.5, 100);

function makeTool(tool = 'wall') {
    const editTool = new EditTool(new Scene(), { build: new LineBasicMaterial(), select: new LineBasicMaterial() });
    while (editTool.tool !== tool) editTool.cycleTool(1);
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

/** A chunk with at least `count` generated props, and its store. */
function chunkWithProps(seed, count, edits = null) {
    const store = new ChunkStore(seed, edits);
    for (let cx = -3; cx <= 3; cx++) {
        for (let cz = -3; cz <= 3; cz++) {
            const chunk = store.getChunk(cx, cz);
            if (chunk.props.length >= count) return { store, chunk };
        }
    }
    throw new Error('no chunk with enough props');
}

const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
        keys: () => [...data.keys()],
    };
}

function withStorage(test) {
    return () => {
        const original = globalThis.localStorage;
        globalThis.localStorage = memoryStorage();
        try {
            test(globalThis.localStorage);
        } finally {
            globalThis.localStorage = original;
        }
    };
}

describe('edit tools', () => {
    it('go from the walls to the decorations and round again, whichever way', () => {
        expect(EDIT_TOOL_GROUPS.flat()).toEqual(EDIT_TOOLS);
        expect(EDIT_TOOL_GROUPS[1]).toEqual(DECORATIONS);
        const tool = makeTool();
        const seen = [tool.tool];
        for (let i = 1; i < EDIT_TOOLS.length; i++) seen.push(tool.cycleTool(1));
        expect(seen).toEqual(['wall', 'doorway', 'pillar', 'chair', 'monitor', 'bottles', 'sign']);
        expect(tool.cycleTool(1)).toBe('wall');
        expect(tool.cycleTool(-1)).toBe('sign');
    });
});

describe('EditTool with a decoration', () => {
    it('shows where it will go, facing the player, and puts down exactly that', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('chair');
        const eye = new Vector3(0, 0.5, 0);
        const target = aim(tool, store, eye.toArray(), [0.1, 0, -1.2], eye);
        expect(target.kind).toBe('prop');
        expect(target.current).toBe(false);
        const prop = target.prop;
        expect(prop.type).toBe(PROP_CHAIR);
        expect([cellCoord(prop.x), cellCoord(prop.z)]).toEqual([0, -1]);
        expect([target.x, target.z]).toEqual([0, -1]);
        expect(prop.x).toBeCloseTo(0.1, 6);
        expect(prop.z).toBeCloseTo(-1.2, 6);
        // Its front (+z before it's turned) points back at the player.
        const toPlayer = new Vector3(eye.x - prop.x, 0, eye.z - prop.z).normalize();
        expect(Math.sin(prop.yaw) * toPlayer.x + Math.cos(prop.yaw) * toPlayer.z).toBeCloseTo(1, 6);
        // Upright: the generator's chairs are sometimes on their side, but not one put down on purpose.
        expect(prop.variant & 3).not.toBe(0);

        // The preview is an outline of that prop, where it will be.
        const outline = tool.shapes.prop;
        expect(outline.visible).toBe(true);
        expect(outline.material).toBe(tool.materials.build);
        expect(outline.position.x).toBe(prop.x);
        expect(outline.position.z).toBe(prop.z);
        expect(outline.rotation.y).toBe(prop.yaw);
        expect(outline.geometry.attributes.position.count).toBeGreaterThan(24);

        expect(tool.place(store, eye)).toEqual({ x: 0, z: -1 });
        expect(store.propsAt(0, -1)).toEqual([prop]);
        expect(store.getChunk(0, 0).props).toContain(prop);

        // Now it's there, aiming at it picks it.
        const again = aim(tool, store, eye.toArray(), [prop.x, 0.1, prop.z], eye);
        expect(again).toMatchObject({ kind: 'prop', current: true, prop });
        expect(outline.material).toBe(tool.materials.select);
    });

    it('keeps what it puts down inside its cell, clear of walls and pillars, wherever it is aimed', () => {
        const store = new ChunkStore(3);
        const [cx, cz] = [1, -1]; // in the spawn room, with nothing else in it
        // Walled in, with a pillar on every corner.
        for (const [x, z, axis] of [[cx, cz, 0], [cx - 1, cz, 0], [cx, cz, 1], [cx, cz - 1, 1]]) store.setEdge(x, z, axis, EDGE_WALL);
        for (const [x, z] of [[cx, cz], [cx - 1, cz], [cx, cz - 1], [cx - 1, cz - 1]]) store.setPillar(x, z, true);
        const wallFace = 0.5 - WALL_THICKNESS / 2;
        const pillarFace = 0.5 - PILLAR_SIZE / 2;

        let placed = 0;
        for (const name of DECORATIONS) {
            const tool = makeTool(name);
            for (let i = -6; i <= 6; i++) {
                for (let j = -6; j <= 6; j++) {
                    const [ax, az] = [(i / 6) * 0.49, (j / 6) * 0.49];
                    if (Math.abs(ax) > pillarFace && Math.abs(az) > pillarFace) continue; // that's the pillar
                    // From high above the middle of the cell, looking down into it over the walls.
                    const target = aim(tool, store, [cx, 3, cz], [cx + ax, 0, cz + az]);
                    expect(target?.kind, `${name} aimed at ${ax}, ${az}`).toBe('prop');
                    const prop = target.prop;
                    expect(prop.type).toBe(TYPES[name]);
                    const footprint = propFootprint(prop);
                    expect(footprint[0]).toBeGreaterThanOrEqual(cx - wallFace);
                    expect(footprint[2]).toBeLessThanOrEqual(cx + wallFace);
                    expect(footprint[1]).toBeGreaterThanOrEqual(cz - wallFace);
                    expect(footprint[3]).toBeLessThanOrEqual(cz + wallFace);
                    for (const box of store.boxesNear(...footprint)) expect(overlap(footprint, box), `${name} at ${prop.x}, ${prop.z}`).toBe(false);
                    // Put down and taken away again, so every one is tried on an empty cell (and with a new variant).
                    expect(tool.place(store, FAR_AWAY)).not.toBeNull();
                    expect(store.removeProp(prop)).toBe(true);
                    placed++;
                }
            }
        }
        expect(placed).toBeGreaterThan(400);
    });

    it('puts one right up against a wall when aimed at the foot of it', () => {
        const store = new ChunkStore(4);
        store.setEdge(0, -1, 0, EDGE_WALL); // the wall at x = 0.5
        const tool = makeTool('chair');
        const target = aim(tool, store, [0, 0.5, -1.4], [0.49, 0, -1]);
        const face = 0.5 - WALL_THICKNESS / 2;
        const footprint = propFootprint(target.prop);
        expect(footprint[2]).toBeLessThan(face);
        expect(footprint[2]).toBeGreaterThan(face - 0.03);
    });

    it('will not put one down where the player is standing', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('sign');
        const eye = new Vector3(0, 0.5, 0);
        // Looking down at the player's own feet.
        expect(aim(tool, store, eye.toArray(), [0, 0, -0.15], eye)).toBeNull();
        expect(tool.shapes.prop.visible).toBe(false);
        expect(tool.place(store, eye)).toBeNull();
        expect(store.propsAt(0, 0)).toEqual([]);

        // Aimed while standing elsewhere, then walked into the spot before building: still no.
        const target = aim(tool, store, eye.toArray(), [0, 0, -1.2], eye);
        expect(target.kind).toBe('prop');
        expect(tool.place(store, new Vector3(target.prop.x, 0.5, target.prop.z))).toBeNull();
        expect(store.propsAt(0, -1)).toEqual([]);
        // Flying above the walls, nothing is in the way.
        expect(tool.place(store, new Vector3(target.prop.x, 2.6, target.prop.z))).not.toBeNull();
    });

    it('will not put one down on top of another', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('monitor');
        const first = aim(tool, store, [1, 0.5, -1.2], [0, 0, -1.2]).prop;
        expect(tool.place(store, FAR_AWAY)).not.toBeNull();
        // Next to it, on the side away from it (so the aim doesn't land on it): too close.
        const next = aim(tool, store, [1.2, 0.5, -1.2], [first.x + 0.12, 0, -1.2]);
        expect(next).toBeNull();
        expect(tool.shapes.prop.visible).toBe(false);
        // Further along there's room.
        expect(aim(tool, store, [1.2, 0.5, -1.2], [first.x + 0.3, 0, -1.2])?.kind).toBe('prop');
        expect(tool.place(store, FAR_AWAY)).not.toBeNull();
        expect(store.propsAt(0, -1).length).toBe(2);
        // A second go at the same spot, before the aim is updated, doesn't put down another.
        expect(tool.place(store, FAR_AWAY)).toBeNull();
        expect(store.propsAt(0, -1).length).toBe(2);
    });

    it('stands bottles up and changes the arrangement after each one', () => {
        const store = new ChunkStore(1);
        const tool = makeTool('bottles');
        const variants = new Set();
        for (let i = 0; i < 40; i++) {
            const prop = aim(tool, store, [0, 0.5, 0], [0, 0, -1.2]).prop;
            variants.add(prop.variant);
            const count = 1 + ((prop.variant >>> 2) % 3);
            for (let k = 0; k < count; k++) expect((prop.variant >>> (4 + k)) & 3).not.toBe(0);
            expect(tool.place(store, FAR_AWAY)).not.toBeNull();
            store.removeProp(prop);
        }
        expect(variants.size).toBe(40);
    });

    it('picks any prop it is aimed at to remove, whatever the tool', () => {
        const store = new ChunkStore(5);
        let prop = null;
        for (let cx = -3; cx <= 3 && !prop; cx++) {
            for (let cz = -3; cz <= 3 && !prop; cz++) {
                // One on its own in its cell, so nothing else can be in the way.
                prop = store.getChunk(cx, cz).props.find((p) => store.propsAt(cellCoord(p.x), cellCoord(p.z)).length === 1) ?? null;
            }
        }
        const chunk = store.getChunk(chunkCoord(cellCoord(prop.x)), chunkCoord(cellCoord(prop.z)));
        const [x0, y0, z0, x1, y1, z1] = propBounds(prop);
        const [lx, lz] = [(x0 + x1) / 2, (z0 + z1) / 2];
        const [cos, sin] = [Math.cos(prop.yaw), Math.sin(prop.yaw)];
        const centre = [prop.x + lx * cos + lz * sin, (y0 + y1) / 2, prop.z + lz * cos - lx * sin];
        // From a little way off towards the middle of its cell (so no wall is in between).
        const cellX = cellCoord(prop.x);
        const cellZ = cellCoord(prop.z);
        const away = Math.hypot(cellX - prop.x, cellZ - prop.z) > 0.05
            ? new Vector3(cellX - prop.x, 0, cellZ - prop.z).normalize()
            : new Vector3(1, 0, 0);
        const reach = Math.max(x1 - x0, z1 - z0) / 2 + 0.2;
        const eye = [prop.x + away.x * reach, 0.45, prop.z + away.z * reach];
        for (const name of EDIT_TOOLS) {
            const tool = makeTool(name);
            const target = aim(tool, store, eye, centre);
            expect(target, name).toMatchObject({ kind: 'prop', current: true, prop, x: cellX, z: cellZ });
            expect(tool.place(store, FAR_AWAY), name).toBeNull();
        }
        const tool = makeTool('wall');
        aim(tool, store, eye, centre);
        expect(tool.remove(store)).toEqual({ x: cellX, z: cellZ });
        expect(chunk.props).not.toContain(prop);
        expect(tool.remove(store)).toBeNull();
    });

    it('can aim at bottles, though they have nothing to bump into', () => {
        const store = new ChunkStore(1);
        const bottle = makeProp(PROP_BOTTLES, 0, -1.1, 0, 0x60); // a single bottle, standing
        expect(bottle.box).toBeNull();
        store.addProp(bottle);
        const tool = makeTool('wall');
        expect(aim(tool, store, [0, 0.5, 0], [0, 0.05, -1.1])).toMatchObject({ kind: 'prop', current: true, prop: bottle });
        expect(tool.remove(store)).not.toBeNull();
        expect(store.propsAt(0, -1)).toEqual([]);
    });

    it('leaves walls to be removed, not built on, while holding a decoration', () => {
        const store = new ChunkStore(1);
        store.setEdge(0, -1, 1, EDGE_NONE);
        store.setEdge(0, -2, 1, EDGE_WALL); // the wall at z = −1.5
        const tool = makeTool('chair');
        const target = aim(tool, store, [0, 0.5, 0], [0, 0.5, -2]);
        expect(target).toMatchObject({ kind: 'edge', x: 0, z: -2, axis: 1, current: EDGE_WALL });
        expect(tool.shapes.wall.visible).toBe(true);
        expect(tool.shapes.wall.material).toBe(tool.materials.select);
        expect(tool.place(store, FAR_AWAY)).toBeNull();
        expect(store.edge(0, -2, 1)).toBe(EDGE_WALL);
        expect(tool.remove(store)).not.toBeNull();
        expect(store.edge(0, -2, 1)).toBe(EDGE_NONE);
    });
});

describe('ChunkStore props', () => {
    it('adds and removes props, and they block the player only while they are there', () => {
        const store = new ChunkStore(1);
        const boxesNear = (a, b, c, d, doors) => store.boxesNear(a, b, c, d, doors);
        const chair = makeProp(PROP_CHAIR, 0, -1, 0, 1);
        store.addProp(chair);
        expect(store.propsAt(0, -1)).toEqual([chair]);
        expect(store.boxesNear(-0.3, -1.3, 0.3, -0.7)).toContain(chair.box);

        const walker = { x: 0, z: -0.5 };
        for (let i = 0; i < 30; i++) moveAndCollide(walker, 0, -0.03, PLAYER_RADIUS, boxesNear);
        expect(walker.z).toBeCloseTo(chair.box[3] + PLAYER_RADIUS, 4);

        expect(store.removeProp(chair)).toBe(true);
        expect(store.removeProp(chair)).toBe(false);
        expect(store.propsAt(0, -1)).toEqual([]);
        expect(store.boxesNear(-0.3, -1.3, 0.3, -0.7)).not.toContain(chair.box);
        for (let i = 0; i < 30; i++) moveAndCollide(walker, 0, -0.03, PLAYER_RADIUS, boxesNear);
        expect(walker.z).toBeLessThan(-1.2);
    });

    it('keeps each prop in the chunk of its cell, and finds it from the chunk next door', () => {
        const store = new ChunkStore(1);
        const inside = makeProp(PROP_SIGN, -HALF_CHUNK + 0.3, 0, 0, 0); // cell −8, the first of chunk 0
        const outside = makeProp(PROP_SIGN, -HALF_CHUNK - 0.8, 0.2, 0, 0); // cell −9, the last of chunk −1
        store.addProp(inside);
        store.addProp(outside);
        expect(store.getChunk(0, 0).props).toContain(inside);
        expect(store.getChunk(-1, 0).props).toContain(outside);
        expect(store.propsAt(-HALF_CHUNK - 1, 0)).toEqual([outside]);
        expect(store.boxesNear(-HALF_CHUNK - 0.9, 0, -HALF_CHUNK - 0.6, 0.3)).toContain(outside.box);
    });

    it('removes generated props too', () => {
        const { store, chunk } = chunkWithProps(2, 1);
        const prop = chunk.props[0];
        expect(store.propsAt(cellCoord(prop.x), cellCoord(prop.z))).toContain(prop);
        expect(store.removeProp(prop)).toBe(true);
        expect(chunk.props).not.toContain(prop);
    });
});

describe('raycastWorld and props', () => {
    /** A flat world with the given props in it, and maybe some walls. */
    function world(props, edges = {}) {
        return {
            edge: (x, z, axis) => edges[`${x},${z},${axis}`] ?? EDGE_NONE,
            pillar: () => false,
            propsAt: (x, z) => props.filter((prop) => cellCoord(prop.x) === x && cellCoord(prop.z) === z),
        };
    }

    it('hits a prop before the wall behind it, but only when asked to', () => {
        const chair = makeProp(PROP_CHAIR, 2, 0, 0, 1);
        const w = world([chair], { '2,0,0': EDGE_WALL }); // the wall at x = 2.5
        const hit = raycastWorld(0, 0.15, 0, 1, 0, 0, 10, w, propBounds);
        expect(hit).toMatchObject({ kind: 'prop', prop: chair, x: 2, z: 0 });
        expect(hit.distance).toBeCloseTo(2 + propBounds(chair)[0], 6);
        // Found Footage's line of sight doesn't ask, and looks straight past props as it always has.
        expect(raycastWorld(0, 0.15, 0, 1, 0, 0, 10, w)).toMatchObject({ kind: 'edge', x: 2 });
        // Over the top of it.
        expect(raycastWorld(0, 0.45, 0, 1, 0, 0, 10, w, propBounds)).toMatchObject({ kind: 'edge' });
    });

    it('hits a prop on the floor before the floor', () => {
        const bottles = makeProp(PROP_BOTTLES, 1, 0, 0, 0x60);
        const d = Math.SQRT1_2;
        const hit = raycastWorld(0.95 - 0.5, 0.55, 0, d, -d, 0, 10, world([bottles]), propBounds);
        expect(hit.kind).toBe('prop');
        expect(hit.point[1]).toBeGreaterThan(0);
    });

    it('turns the box with the prop', () => {
        const long = () => [-0.3, 0, -0.02, 0.3, 0.2, 0.02]; // long across the prop, thin front to back
        const straight = makeProp(PROP_MONITOR, 2, 0, 0, 0);
        const turned = makeProp(PROP_MONITOR, 2, 0, Math.PI / 2, 0);
        // Along x, 0.2 to the side of its middle.
        expect(raycastWorld(0, 0.1, 0.2, 1, 0, 0, 10, world([straight]), long)).toBeNull();
        const hit = raycastWorld(0, 0.1, 0.2, 1, 0, 0, 10, world([turned]), long);
        expect(hit?.kind).toBe('prop');
        expect(hit.distance).toBeCloseTo(1.98, 6);
    });

    it('hits the nearest of several props in a cell, and the first cell along the way', () => {
        const near = makeProp(PROP_SIGN, 1.8, 0, 0, 0);
        const far = makeProp(PROP_SIGN, 2.2, 0, 0, 0);
        const next = makeProp(PROP_SIGN, 3, 0, 0, 0);
        const hit = raycastWorld(0, 0.1, 0, 1, 0, 0, 10, world([next, far, near]), propBounds);
        expect(hit.prop).toBe(near);
    });
});

describe('EditLog props', () => {
    it('remembers props put down and taken away, and brings them back with the world', withStorage(() => {
        const { store, chunk } = chunkWithProps(77, 2, new EditLog(77));
        const generated = chunk.props.map((p) => ({ ...p }));
        store.removeProp(chunk.props[0]);
        const chair = makeProp(PROP_CHAIR, 0.1, -1.1, 0.5, 12345);
        store.addProp(chair);
        // Put down and taken away again: nothing to remember.
        const bottles = makeProp(PROP_BOTTLES, 1, -1, 0, 0x60);
        store.addProp(bottles);
        store.removeProp(bottles);
        expect(store.edits.size).toBe(2);
        store.edits.save();

        const log = new EditLog(77);
        expect(log.size).toBe(2);
        const again = new ChunkStore(77, log);
        const reloaded = again.getChunk(chunk.cx, chunk.cz).props.filter((p) => p.index !== undefined);
        expect(reloaded.map((p) => p.index)).toEqual(generated.slice(1).map((p) => p.index));
        expect(reloaded.map(({ type, x, z }) => [type, x, z])).toEqual(generated.slice(1).map(({ type, x, z }) => [type, x, z]));
        const [placed, ...rest] = again.propsAt(0, -1);
        expect(rest).toEqual([]);
        expect(placed).toMatchObject({ type: PROP_CHAIR, x: 0.1, z: -1.1, yaw: 0.5, variant: 12345, box: chair.box });
        expect(placed.index).toBeUndefined();
        expect(again.boxesNear(-0.2, -1.4, 0.4, -0.8)).toContainEqual(chair.box);
        if (generated[0].box) expect(again.boxesNear(...generated[0].box)).not.toContainEqual(generated[0].box);

        // Taking the reloaded one away is remembered too.
        again.removeProp(placed);
        again.edits.save();
        const third = new ChunkStore(77, new EditLog(77));
        expect(third.propsAt(0, -1)).toEqual([]);
        expect(third.getChunk(chunk.cx, chunk.cz).props.map((p) => p.index)).toEqual(generated.slice(1).map((p) => p.index));
        expect(third.edits.size).toBe(1);
    }));

    it('saves props alongside the walls, and still loads saves from before props', withStorage((storage) => {
        storage.setItem('backrooms-simulator:edits:9', JSON.stringify({ version: 1, chunks: { '0,0': [[5, EDGE_WALL]] } }));
        const log = new EditLog(9);
        expect(log.size).toBe(1);
        const store = new ChunkStore(9, log);
        const plain = new ChunkStore(9);
        expect(store.getChunk(0, 0).edgesX[5]).toBe(EDGE_WALL);
        expect(store.getChunk(0, 0).props).toEqual(plain.getChunk(0, 0).props);

        store.addProp(makeProp(PROP_SIGN, 2, 1, 0, 7));
        store.edits.save();
        const saved = JSON.parse(storage.getItem('backrooms-simulator:edits:9'));
        expect(saved.version).toBe(1);
        expect(saved.chunks['0,0']).toEqual([[5, EDGE_WALL]]);
        expect(saved.props['0,0'].added).toEqual([[PROP_SIGN, 2, 1, 0, 7]]);
    }));

    it('forgets prop changes when the edits are undone', withStorage((storage) => {
        const { store, chunk } = chunkWithProps(78, 1, new EditLog(78));
        const count = chunk.props.length;
        store.removeProp(chunk.props[0]);
        store.addProp(makeProp(PROP_MONITOR, 0, -1, 0, 0));
        store.edits.save();
        expect(storage.getItem('backrooms-simulator:edits:78')).not.toBeNull();

        store.edits.clear();
        expect(store.edits.size).toBe(0);
        expect(storage.getItem('backrooms-simulator:edits:78')).toBeNull();
        const fresh = new ChunkStore(78, store.edits);
        expect(fresh.getChunk(chunk.cx, chunk.cz).props.length).toBe(count);
        expect(fresh.propsAt(0, -1)).toEqual([]);
    }));

    it('ignores junk props in storage', withStorage((storage) => {
        storage.setItem('backrooms-simulator:edits:6', JSON.stringify({
            version: 1,
            chunks: {},
            props: {
                '0,0': { removed: [-1, 'x', 1.5], added: [[PROP_CHAIR, 'a', 0, 0, 1], [99, 0, 0, 0, 1], [PROP_CHAIR, 30, 0, 0, 1], 'x', [PROP_SIGN, 1, 2, 0, 3]] },
                'nonsense': { added: [[PROP_SIGN, 1, 2, 0, 3]] },
                '1,1': 'x',
            },
        }));
        const log = new EditLog(6);
        // Only the sign in its own chunk survives.
        expect(log.size).toBe(1);
        expect(new ChunkStore(6, log).propsAt(1, 2)).toMatchObject([{ type: PROP_SIGN, x: 1, z: 2 }]);
    }));
});
