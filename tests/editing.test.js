import { LineBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HALF_CHUNK, PILLAR_SIZE, PLAYER_RADIUS, WALL_THICKNESS } from '../src/config.js';
import { moveAndCollide } from '../src/player/collision.js';
import { EDIT_SECTIONS, EDIT_TOOLS, EditTool } from '../src/player/EditTool.js';
import { raycastWorld } from '../src/player/raycast.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { buildChunkGeometry } from '../src/world/chunkGeometry.js';
import {
    PROP_BALL,
    PROP_BALLOONS,
    PROP_BOTTLES,
    PROP_CAKE,
    PROP_CHAIR,
    PROP_HAT,
    PROP_MONITOR,
    PROP_NAMES,
    PROP_PRESENTS,
    PROP_RING,
    PROP_SIGN,
    makeProp,
} from '../src/world/decorations.js';
import { EDIT_OUTLET, EditLog } from '../src/world/edits.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, cellCoord, chunkCoord } from '../src/world/grid.js';
import { LEVELS } from '../src/world/levels.js';
import { levelOneOptions } from '../src/world/levelOne.js';
import { seededOutlet } from '../src/world/outlets.js';
import { PARTY_DECORATIONS, propBalloons } from '../src/world/party.js';
import { poolroomsOptions } from '../src/world/poolrooms.js';
import { propBounds, propFootprint } from '../src/world/props.js';

// Every level's things, and Level Fun's, which go down on any level.
const DECORATIONS = [...LEVELS.flatMap((level) => level.decorations), ...PARTY_DECORATIONS].map((type) => PROP_NAMES[type]);
const TYPES = Object.fromEntries(PROP_NAMES.map((name, type) => [name, type]));
// Somewhere well away from anything being edited, for tests that aren't about the player.
const FAR_AWAY = new Vector3(100, 0.5, 100);

/** An edit tool holding `tool`, with Level Fun found unless it's said it isn't. */
function makeTool(tool = 'wall', levelFun = true) {
    const editTool = new EditTool(new Scene(), { build: new LineBasicMaterial(), select: new LineBasicMaterial() });
    editTool.setLevelFun(levelFun);
    for (let i = 0; editTool.tool !== tool; i++) {
        if (i > EDIT_TOOLS.length) throw new Error(`no ${tool} to pick`);
        editTool.cycleTool(1);
    }
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
    it('come in sections: what is built, then each level\'s things, then Level Fun\'s', () => {
        expect(EDIT_SECTIONS[0]).toEqual({ name: null, tools: ['wall', 'doorway', 'pillar', 'outlet'] });
        expect(EDIT_SECTIONS.slice(1).map(({ name }) => name)).toEqual(['Level 0', 'Level 1', 'Level 37', 'Level Fun']);
        expect(EDIT_SECTIONS[1].tools).toEqual(['chair', 'monitor', 'bottles', 'sign']);
        expect(EDIT_SECTIONS[2].tools).toEqual(['crates', 'boxes', 'pallet', 'barrel', 'cone', 'rack']);
        expect(EDIT_SECTIONS[3].tools).toEqual(['lifebuoy', 'ring', 'ball']);
        expect(EDIT_SECTIONS[4]).toMatchObject({ tools: ['cake', 'presents', 'hat', 'balloons'], levelFun: true });
        expect(EDIT_SECTIONS.flatMap(({ tools }) => tools)).toEqual(EDIT_TOOLS);
        expect(new Set(EDIT_TOOLS).size).toBe(EDIT_TOOLS.length);
    });

    it('leave Level Fun\'s out until it has been found', () => {
        const tool = new EditTool(new Scene(), { build: new LineBasicMaterial(), select: new LineBasicMaterial() });
        expect(tool.sections.map(({ name }) => name)).toEqual([null, 'Level 0', 'Level 1', 'Level 37']);
        const seen = [tool.tool];
        for (let i = 0; i < EDIT_TOOLS.length; i++) seen.push(tool.cycleTool(1));
        expect(seen).not.toContain('cake');
        while (tool.tool !== 'wall') tool.cycleTool(1);
        expect(tool.cycleTool(-1)).toBe('ball');
        expect(tool.cycleSection(1)).toBe('wall');

        // Found while holding something: still in hand, and Level Fun's are after it.
        tool.cycleTool(-1);
        expect(tool.tool).toBe('ball');
        tool.setLevelFun(true);
        expect(tool.tool).toBe('ball');
        expect(tool.cycleSection(1)).toBe('cake');
        expect(tool.section).toBe(4);
        // Lost again (storage cleared, say), holding one of them: back to the start.
        tool.setLevelFun(false);
        expect(tool.tool).toBe('wall');
    });

    it('go from the walls through every section and round again, whichever way', () => {
        const tool = makeTool();
        const seen = [tool.tool];
        for (let i = 1; i < EDIT_TOOLS.length; i++) seen.push(tool.cycleTool(1));
        expect(seen).toEqual(EDIT_TOOLS);
        expect(tool.cycleTool(1)).toBe('wall');
        expect(tool.cycleTool(-1)).toBe('balloons');
        expect(tool.section).toBe(4);
    });

    it('jump from section to section, back to the tool last picked in each', () => {
        const tool = makeTool();
        expect(tool.cycleSection(1)).toBe('chair');
        expect(tool.section).toBe(1);
        expect(tool.cycleSection(1)).toBe('crates');
        tool.cycleTool(1);
        expect(tool.cycleTool(1)).toBe('pallet');
        expect(tool.cycleSection(1)).toBe('lifebuoy');
        expect(tool.cycleSection(1)).toBe('cake');
        expect(tool.cycleSection(1)).toBe('wall');
        expect(tool.cycleSection(-1)).toBe('cake');
        expect(tool.cycleSection(-2)).toBe('pallet');
        expect(tool.cycleSection(-2)).toBe('wall');
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
                    // (Level 1's racking is a hair longer than the room between two walls.)
                    const slack = name === 'rack' ? 0.002 : 0;
                    const [x0, z0, x1, z1] = propFootprint(prop);
                    const footprint = [x0 + slack, z0 + slack, x1 - slack, z1 - slack];
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

describe('outlets', () => {
    /** A store with a plain wall at x = 0.5 by cell (0, −1), and nothing seeded on it. */
    function walled(edits = null, seed = 1) {
        const store = new ChunkStore(seed, edits);
        store.setEdge(0, -1, 0, EDGE_WALL);
        for (const side of [1, -1]) store.setOutlet(0, -1, 0, side, null);
        return store;
    }

    it('go up on the side of the wall facing the aim, where it is aimed, and come down again', () => {
        const store = walled();
        const tool = makeTool('outlet');
        const target = aim(tool, store, [0, 0.3, -1.1], [0.5, 0.1, -0.9]);
        expect(target).toMatchObject({ kind: 'outlet', x: 0, z: -1, axis: 0, side: -1, current: false });
        expect(target.along).toBeCloseTo(0.1, 2);
        expect(tool.shapes.outlet.visible).toBe(true);
        expect(tool.shapes.outlet.position.x).toBeCloseTo(0.5 - WALL_THICKNESS / 2, 6);
        expect(tool.place(store, FAR_AWAY)).toEqual({ x: 0, z: -1 });
        expect(store.outlet(0, -1, 0, -1)).toBeCloseTo(0.1, 2);
        expect(store.outlet(0, -1, 0, 1)).toBeNull();

        // Aimed at anywhere on that side of the wall now, it's the one there.
        const again = aim(tool, store, [0, 0.3, -1.1], [0.5, 0.2, -1.2]);
        expect(again).toMatchObject({ kind: 'outlet', side: -1, current: true });
        expect(again.along).toBe(store.outlet(0, -1, 0, -1));
        expect(tool.shapes.outlet.material).toBe(tool.materials.select);
        expect(tool.place(store, FAR_AWAY)).toBeNull();
        // The other side's still free.
        expect(aim(tool, store, [1, 0.3, -1.1], [0.5, 0.1, -1])).toMatchObject({ side: 1, current: false });

        aim(tool, store, [0, 0.3, -1.1], [0.5, 0.1, -0.9]);
        expect(tool.remove(store)).toEqual({ x: 0, z: -1 });
        expect(store.outlet(0, -1, 0, -1)).toBeNull();
        expect(store.edge(0, -1, 0)).toBe(EDGE_WALL); // the wall stays
        expect(tool.remove(store)).toBeNull();
    });

    it('keep clear of the ends of the wall, where pillars go', () => {
        const store = walled();
        const tool = makeTool('outlet');
        const target = aim(tool, store, [0, 0.3, -1.1], [0.5, 0.1, -0.52]);
        expect(target.kind).toBe('outlet');
        expect(0.5 - Math.abs(target.along) - 0.017).toBeGreaterThan(PILLAR_SIZE / 2);
    });

    it('only go on walls: a doorway aimed at can be removed, and nothing is built on it', () => {
        const store = walled();
        store.setEdge(0, -1, 0, EDGE_DOOR);
        const tool = makeTool('outlet');
        expect(aim(tool, store, [0, 0.3, -1.1], [0.5, 0.1, -0.7])).toMatchObject({ kind: 'edge', current: EDGE_DOOR });
        expect(tool.place(store, FAR_AWAY)).toBeNull();
        expect(store.edge(0, -1, 0)).toBe(EDGE_DOOR);
        expect(tool.remove(store)).toEqual({ x: 0, z: -1 });
        // And aiming at the floor puts nothing up.
        expect(aim(tool, store, [0, 0.5, 0], [0, 0, -1.2])).toBeNull();
    });

    it('are seeded on a few walls, and those can be taken down', () => {
        const store = new ChunkStore(5);
        let seeded = null;
        for (let x = -20; x < 20 && !seeded; x++) {
            for (let z = -20; z < 20 && !seeded; z++) if (seededOutlet(5, x, z, 1, 1) !== null) seeded = [x, z];
        }
        const [x, z] = seeded;
        expect(store.outlet(x, z, 1, 1)).toBe(seededOutlet(5, x, z, 1, 1));
        expect(store.setOutlet(x, z, 1, 1, null)).toBe(true);
        expect(store.outlet(x, z, 1, 1)).toBeNull();
        expect(store.setOutlet(x, z, 1, 1, null)).toBe(false);
        // Level 37 has none of its own.
        const pools = new ChunkStore(5, null, poolroomsOptions(5));
        expect(pools.outlet(x, z, 1, 1)).toBeNull();
    });

    it('are drawn on walls where they are', () => {
        const store = walled();
        const before = buildChunkGeometry(store, 0, 0).details.attributes.position.count;
        store.setOutlet(0, -1, 0, 1, 0.2);
        store.setOutlet(0, -1, 0, -1, -0.1);
        expect(buildChunkGeometry(store, 0, 0).details.attributes.position.count).toBe(before + 8);
        // Not where the wall's been taken away.
        store.setEdge(0, -1, 0, EDGE_NONE);
        expect(buildChunkGeometry(store, 0, 0).details.attributes.position.count).toBe(before);
    });

    it('are saved with the world, alongside what copies of the game from before them read', withStorage((storage) => {
        const store = walled(new EditLog(11), 11);
        store.setOutlet(0, -1, 0, 1, 0.123);
        store.edits.save();
        const saved = JSON.parse(storage.getItem('backrooms-simulator:edits:11'));
        expect(saved.version).toBe(1);
        const entries = saved.chunks['0,0'];
        expect(entries.every(([slot, value]) => Number.isInteger(slot) && Number.isInteger(value))).toBe(true);
        // (Taking one down from where there wasn't one changes nothing, and isn't saved.)
        expect(entries.filter(([slot]) => Math.floor(slot / 65536) === EDIT_OUTLET).length).toBeGreaterThanOrEqual(1);

        const again = new ChunkStore(11, new EditLog(11));
        expect(again.outlet(0, -1, 0, 1)).toBe(store.outlet(0, -1, 0, 1));
        expect(again.outlet(0, -1, 0, 1)).toBeCloseTo(0.123, 3);
        expect(again.outlet(0, -1, 0, -1)).toBeNull();
        expect(again.edge(0, -1, 0)).toBe(EDGE_WALL);
    }));
});

describe('decorations on any level', () => {
    it('go down on Level 1 like on Level 0, the other levels\' too', () => {
        const store = new ChunkStore(4, null, levelOneOptions(4));
        for (const name of ['chair', 'crates', 'rack', 'lifebuoy']) {
            const tool = makeTool(name);
            // From above the spawn room, looking down into the middle of a cell.
            const target = aim(tool, store, [0, 2.5, -1], [0, 0, -1.02]);
            expect(target?.kind, name).toBe('prop');
            expect(target.prop.type).toBe(TYPES[name]);
            expect(target.prop.y ?? 0).toBe(0);
            expect(tool.place(store, FAR_AWAY), name).not.toBeNull();
            expect(store.removeProp(target.prop)).toBe(true);
        }
    });

    it('stand on Level 37\'s floor, down on the bottom of a pool, and float if they float', () => {
        const store = new ChunkStore(3, null, poolroomsOptions(3));
        // Somewhere in deep water.
        let deep = null;
        for (let x = -24; x < 24 && !deep; x++) {
            for (let z = -24; z < 24 && !deep; z++) {
                if (store.groundAt(x, z) < -0.6 && store.groundAt(x - 0.3, z - 0.3) === store.groundAt(x + 0.3, z + 0.3) && !store.pillar(x, z)) deep = [x, z];
            }
        }
        expect(deep).not.toBeNull();
        const [x, z] = deep;
        const ground = store.groundAt(x, z);

        const tool = makeTool('chair');
        const eye = [x, 0.8, z + 0.05];
        const chair = aim(tool, store, eye, [x, 0, z]).prop;
        expect(chair.y).toBe(ground);
        expect(chair.box).toBeNull(); // swum over
        expect(tool.shapes.prop.position.y).toBeCloseTo(ground, 2);
        expect(tool.place(store, FAR_AWAY)).not.toBeNull();
        // Aimed at through the water, it's there to be taken away.
        expect(aim(tool, store, eye, [chair.x, ground + 0.1, chair.z])).toMatchObject({ kind: 'prop', current: true, prop: chair });
        expect(tool.remove(store)).not.toBeNull();

        for (const type of [PROP_RING, PROP_BALL]) {
            const floater = makeProp(type, x, z, 0, 1);
            store.addProp(floater);
            expect(floater.y).toBeLessThan(0);
            expect(floater.y).toBeGreaterThan(-0.05);
            store.removeProp(floater);
        }
    });

    it('come back where they were put, on the bottom of the pool', withStorage(() => {
        const log = new EditLog(3, 2);
        const store = new ChunkStore(3, log, poolroomsOptions(3));
        let spot = null;
        for (let x = -24; x < 24 && !spot; x++) for (let z = -24; z < 24 && !spot; z++) if (store.groundAt(x, z) < -0.1) spot = [x, z];
        const [x, z] = spot;
        store.addProp(makeProp(PROP_MONITOR, x, z, 0, 0));
        log.save();
        const again = new ChunkStore(3, new EditLog(3, 2), poolroomsOptions(3));
        expect(again.propsAt(x, z)).toMatchObject([{ type: PROP_MONITOR, y: store.groundAt(x, z) }]);
    }));
});

describe('Level Fun\'s things', () => {
    const count = (geometry) => geometry?.attributes.position.count ?? 0;

    it('are drawn with the party, on any level, dressed for it or not', () => {
        for (const store of [new ChunkStore(2), new ChunkStore(2, null, levelOneOptions(2)), new ChunkStore(2, null, poolroomsOptions(2))]) {
            const before = buildChunkGeometry(store, 0, 0);
            expect(before.partyThings).toBeNull();
            store.addProp(makeProp(PROP_CAKE, 0, -1, 0, 7));
            store.addProp(makeProp(PROP_BALLOONS, 1, -1, 0, 9));
            const after = buildChunkGeometry(store, 0, 0);
            expect(count(after.partyThings)).toBeGreaterThan(0);
            expect(count(after.flames)).toBeGreaterThan(0); // the candles
            expect(count(after.balloons)).toBeGreaterThan(0);
            // Not with the level's own props.
            expect(count(after.props)).toBe(count(before.props));
        }
    });

    it('go in with the party\'s own when it is dressed', () => {
        const store = new ChunkStore(2);
        store.setParty(true);
        const dressed = count(buildChunkGeometry(store, 0, 0).partyThings);
        store.addProp(makeProp(PROP_PRESENTS, 1, -1, 0, 2));
        expect(count(buildChunkGeometry(store, 0, 0).partyThings)).toBeGreaterThan(dressed);
    });

    it('keep their balloons with them, turned the way they are', () => {
        const prop = makeProp(PROP_BALLOONS, 3, 4, 1.1, 12345);
        const balloons = propBalloons(prop);
        expect(balloons.length).toBeGreaterThanOrEqual(3);
        expect(propBalloons(prop)).toEqual(balloons);
        // Where the outline (its template, turned and moved into place) says they are.
        const [x0, y0, z0, x1, y1, z1] = propBounds(prop);
        const [cos, sin] = [Math.cos(prop.yaw), Math.sin(prop.yaw)];
        for (const { x, y, z, tie } of balloons) {
            const dx = x - prop.x;
            const dz = z - prop.z;
            const lx = dx * cos - dz * sin;
            const lz = dx * sin + dz * cos;
            expect(lx).toBeGreaterThan(x0);
            expect(lx).toBeLessThan(x1);
            expect(lz).toBeGreaterThan(z0);
            expect(lz).toBeLessThan(z1);
            expect(y).toBeGreaterThan(y0);
            expect(y).toBeLessThan(y1);
            expect(tie).toMatchObject({ x: prop.x, z: prop.z });
        }
        expect(propBalloons(makeProp(PROP_CAKE, 0, 0, 0, 1))).toEqual([]);
    });

    it('can be walked into only where the party\'s would be: the table and the presents', () => {
        expect(makeProp(PROP_CAKE, 0, 0, 0, 1).box).not.toBeNull();
        expect(makeProp(PROP_PRESENTS, 0, 0, 0, 1).box).not.toBeNull();
        expect(makeProp(PROP_HAT, 0, 0, 0, 1).box).toBeNull();
        expect(makeProp(PROP_BALLOONS, 0, 0, 0, 1).box).toBeNull();
    });

    it('are put down, aimed at and taken away like the rest', () => {
        const store = new ChunkStore(1);
        for (const name of ['cake', 'presents', 'hat', 'balloons']) {
            const tool = makeTool(name);
            const eye = [0, 0.5, 0];
            const target = aim(tool, store, eye, [0, 0, -1.2]);
            expect(target?.kind, name).toBe('prop');
            if (name === 'hat') expect(target.prop.variant & 1).toBe(0); // standing up
            expect(tool.place(store, FAR_AWAY), name).not.toBeNull();
            const [, y0, , , y1] = propBounds(target.prop);
            const again = aim(tool, store, eye, [target.prop.x, (y0 + y1) / 2, target.prop.z]);
            expect(again, name).toMatchObject({ kind: 'prop', current: true, prop: target.prop });
            expect(tool.remove(store)).not.toBeNull();
        }
    });

    it('are saved with the world', withStorage(() => {
        const store = new ChunkStore(21, new EditLog(21));
        const cake = makeProp(PROP_CAKE, 0.1, -1.1, 0.5, 77);
        store.addProp(cake);
        store.edits.save();
        const again = new ChunkStore(21, new EditLog(21));
        expect(again.propsAt(0, -1)).toMatchObject([{ type: PROP_CAKE, x: 0.1, z: -1.1, yaw: 0.5, variant: 77, box: cake.box }]);
    }));
});
