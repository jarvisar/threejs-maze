import { LineBasicMaterial, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DOOR_HEIGHT, DOOR_WIDTH, PILLAR_SIZE, PLAYER_RADIUS, WALL_THICKNESS } from '../src/config.js';
import { findFreeSpot, moveAndCollide, overlapsSolid } from '../src/player/collision.js';
import { EditTool } from '../src/player/EditTool.js';
import { Player } from '../src/player/Player.js';
import { raycastWorld } from '../src/player/raycast.js';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { EDGE_DOOR, EDGE_NONE, EDGE_WALL, edgeBoxes, pillarBox } from '../src/world/grid.js';

const R = PLAYER_RADIUS;
const T = WALL_THICKNESS / 2;

/**
 * A small hand-made world: `edges` maps "x,z,axis" to an edge type and `pillars` lists corner owners.
 * Returns both the query object raycasts use and the box query collision uses.
 */
function world(edges = {}, pillars = []) {
    const pillarSet = new Set(pillars.map(([x, z]) => `${x},${z}`));
    const edge = (x, z, axis) => edges[`${x},${z},${axis}`] ?? EDGE_NONE;
    const pillar = (x, z) => pillarSet.has(`${x},${z}`);
    const boxesNear = (minX, minZ, maxX, maxZ, doorsSolid = false) => {
        const solid = (type) => (doorsSolid && type === EDGE_DOOR ? EDGE_WALL : type);
        const boxes = [];
        for (let x = Math.floor(minX) - 1; x <= Math.ceil(maxX) + 1; x++) {
            for (let z = Math.floor(minZ) - 1; z <= Math.ceil(maxZ) + 1; z++) {
                edgeBoxes(x, z, 0, solid(edge(x, z, 0)), boxes);
                edgeBoxes(x, z, 1, solid(edge(x, z, 1)), boxes);
                if (pillar(x, z)) boxes.push(pillarBox(x, z));
            }
        }
        return boxes;
    };
    return { edge, pillar, boxesNear };
}

describe('moveAndCollide', () => {
    it('moves freely in open space', () => {
        const p = { x: 0, z: 0 };
        moveAndCollide(p, 0.1, -0.05, R, world().boxesNear);
        expect(p.x).toBeCloseTo(0.1);
        expect(p.z).toBeCloseTo(-0.05);
    });

    it('stops flush against a thin wall', () => {
        const w = world({ '0,0,0': EDGE_WALL }); // the wall at x = 0.5
        const p = { x: 0.2, z: 0 };
        const hit = moveAndCollide(p, 0.3, 0, R, w.boxesNear);
        expect(hit.hitX).toBe(true);
        expect(p.x).toBeCloseTo(0.5 - T - R, 5);
        expect(overlapsSolid(p.x, p.z, R, w.boxesNear)).toBe(false);
    });

    it('cannot pass through a wall however fast it goes', () => {
        const w = world({ '0,0,0': EDGE_WALL });
        const p = { x: 0.2, z: 0 };
        moveAndCollide(p, 5, 0, R, w.boxesNear);
        expect(p.x).toBeLessThan(0.5);
    });

    it('slides along a wall instead of sticking to it', () => {
        const w = world({ '0,0,0': EDGE_WALL, '0,1,0': EDGE_WALL, '0,-1,0': EDGE_WALL });
        const p = { x: 0.5 - T - R - 0.001, z: 0 };
        moveAndCollide(p, 0.05, 0.05, R, w.boxesNear);
        expect(p.x).toBeLessThan(0.5 - T - R);
        expect(p.z).toBeCloseTo(0.05);
    });

    it('walks through the middle of a doorway, but not through its sides', () => {
        const w = world({ '0,0,0': EDGE_DOOR });
        const through = { x: 0, z: 0 };
        for (let i = 0; i < 40; i++) moveAndCollide(through, 0.03, 0, R, w.boxesNear);
        expect(through.x).toBeGreaterThan(1);

        const beside = { x: 0, z: DOOR_WIDTH / 2 + R + 0.05 };
        for (let i = 0; i < 40; i++) moveAndCollide(beside, 0.03, 0, R, w.boxesNear);
        expect(beside.x).toBeLessThan(0.5);
    });

    it('treats doorways as walls for someone too tall to fit under them', () => {
        const w = world({ '0,0,0': EDGE_DOOR });
        const p = { x: 0, z: 0 };
        for (let i = 0; i < 40; i++) moveAndCollide(p, 0.03, 0, R, w.boxesNear, true);
        expect(p.x).toBeCloseTo(0.5 - T - R, 5);
    });

    it('is blocked by pillars', () => {
        const w = world({}, [[0, 0]]); // pillar at (0.5, 0.5)
        const p = { x: 0.5, z: 0 };
        moveAndCollide(p, 0, 0.4, R, w.boxesNear);
        expect(p.z).toBeCloseTo(0.5 - PILLAR_SIZE / 2 - R, 5);
    });

    it('handles negative directions and coordinates', () => {
        const w = world({ '-5,-7,0': EDGE_WALL }); // the wall at x = −4.5
        const p = { x: -4.2, z: -7 };
        moveAndCollide(p, -0.3, 0, R, w.boxesNear);
        expect(p.x).toBeCloseTo(-4.5 + T + R, 5);
    });

    it('never ends up inside anything over many random steps', () => {
        const edges = {};
        for (let x = -6; x <= 6; x++) {
            for (let z = -6; z <= 6; z++) {
                const h = (x * 7 + z * 13) & 7;
                if (h === 0) edges[`${x},${z},0`] = EDGE_WALL;
                if (h === 3) edges[`${x},${z},1`] = EDGE_DOOR;
                if (h === 5) edges[`${x},${z},1`] = EDGE_WALL;
            }
        }
        const w = world(edges, [[2, 2], [-3, 1]]);
        const p = { x: 0, z: 0 };
        expect(overlapsSolid(p.x, p.z, R, w.boxesNear)).toBe(false);
        let seed = 1;
        const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 20000; i++) {
            moveAndCollide(p, (random() - 0.5) * 0.12, (random() - 0.5) * 0.12, R, w.boxesNear);
            expect(overlapsSolid(p.x, p.z, R, w.boxesNear)).toBe(false);
        }
    });
});

describe('Player', () => {
    it('stops under the lintel when flying up inside a doorway', () => {
        const w = world({ '0,0,0': EDGE_DOOR });
        const player = new Player();
        player.reset(0.5, 0); // in the doorway
        player.flying = true;
        for (let i = 0; i < 120; i++) player.step({ forward: 0, right: 0, up: 1, sprint: false }, 0, 1, w.boxesNear);
        expect(player.position.y).toBeLessThan(DOOR_HEIGHT);
    });

    it('can fly up anywhere else', () => {
        const player = new Player();
        player.flying = true;
        for (let i = 0; i < 120; i++) player.step({ forward: 0, right: 0, up: 1, sprint: false }, 0, 1, world().boxesNear);
        expect(player.position.y).toBeGreaterThan(1.5);
    });

    it('can\'t walk through a wall in real life either (VR room-scale)', () => {
        const w = world({ '0,0,0': EDGE_WALL }); // the wall at x = 0.5
        const player = new Player();
        player.shift(2, 0, w.boxesNear);
        expect(player.position.x).toBeCloseTo(0.5 - T - R, 5);
        // The move happened between steps, so there's nothing to interpolate across.
        expect(player.previousPosition.x).toBeCloseTo(player.position.x, 5);
    });
});

describe('EditTool', () => {
    it('never builds a wall through the player, even over a doorway', () => {
        const store = new ChunkStore(1);
        store.setEdge(0, 0, 0, EDGE_DOOR);
        const tool = new EditTool(new Scene(), { build: new LineBasicMaterial(), select: new LineBasicMaterial() });
        tool.target = { kind: 'edge', x: 0, z: 0, axis: 0, current: EDGE_DOOR };
        const standingInDoorway = new Vector3(0.5, 0.5, 0);
        expect(tool.place(store, standingInDoorway)).toBeNull();
        expect(store.edge(0, 0, 0)).toBe(EDGE_DOOR);
        expect(tool.place(store, new Vector3(-0.5, 0.5, 0))).not.toBeNull();
        expect(store.edge(0, 0, 0)).toBe(EDGE_WALL);
    });
});

describe('findFreeSpot', () => {
    it('returns the input when it is already free', () => {
        expect(findFreeSpot(0.2, 0.1, R, world().boxesNear)).toEqual({ x: 0.2, z: 0.1 });
    });

    it('moves off a wall to the middle of the cell', () => {
        const w = world({ '0,0,0': EDGE_WALL, '0,0,1': EDGE_WALL });
        const spot = findFreeSpot(0.48, 0.1, R, w.boxesNear);
        expect(overlapsSolid(spot.x, spot.z, R, w.boxesNear)).toBe(false);
    });
});

describe('raycastWorld', () => {
    it('hits a wall and reports its edge', () => {
        const w = world({ '2,0,0': EDGE_WALL }); // the wall at x = 2.5
        const hit = raycastWorld(0, 0.5, 0, 1, 0, 0, 10, w);
        expect(hit.kind).toBe('edge');
        expect([hit.x, hit.z, hit.axis]).toEqual([2, 0, 0]);
        expect(hit.distance).toBeCloseTo(2.5);
    });

    it('works in negative directions', () => {
        const w = world({ '0,-2,1': EDGE_WALL }); // the wall at z = −1.5
        const hit = raycastWorld(0, 0.5, 0, 0, 0, -1, 10, w);
        expect([hit.x, hit.z, hit.axis]).toEqual([0, -2, 1]);
        expect(hit.distance).toBeCloseTo(1.5);
    });

    it('goes through a doorway, but hits the wall above it', () => {
        const w = world({ '0,0,0': EDGE_DOOR, '3,0,0': EDGE_WALL });
        expect(raycastWorld(0, 0.4, 0, 1, 0, 0, 10, w).x).toBe(3);
        const d = Math.SQRT1_2;
        const up = raycastWorld(0, 0.5, 0, d, d, 0, 10, w);
        expect(up.kind).toBe('edge');
        expect(up.point[1]).toBeGreaterThan(DOOR_HEIGHT);
    });

    it('hits pillars', () => {
        const w = world({}, [[1, -1]]); // pillar at (1.5, −0.5)
        const d = Math.SQRT1_2;
        const hit = raycastWorld(0, 0.5, 1, d, 0, -d, 10, w);
        expect(hit.kind).toBe('pillar');
        expect([hit.x, hit.z]).toEqual([1, -1]);
    });

    it('hits the floor when looking down at open space', () => {
        const d = Math.SQRT1_2;
        const hit = raycastWorld(0, 0.5, 0, d, -d, 0, 10, world());
        expect(hit.kind).toBe('floor');
        expect(hit.distance).toBeCloseTo(0.5 / d);
        expect([hit.x, hit.z]).toEqual([1, 0]);
    });

    it('hits the ceiling from below', () => {
        const hit = raycastWorld(0, 0.5, 0, 0, 1, 0, 10, world());
        expect(hit.kind).toBe('ceiling');
        expect(hit.distance).toBeCloseTo(0.5);
    });

    it('ignores walls beyond the reach', () => {
        expect(raycastWorld(0, 0.5, 0, 1, 0, 0, 2, world({ '5,0,0': EDGE_WALL }))).toBeNull();
    });

    it('passes over walls when the ray is above them', () => {
        expect(raycastWorld(0, 1.5, 0, 1, 0, 0, 10, world({ '2,0,0': EDGE_WALL }))).toBeNull();
    });
});
