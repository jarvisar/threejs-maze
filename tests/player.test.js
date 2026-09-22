import { describe, expect, it } from 'vitest';
import { findFreeSpot, moveAndCollide, overlapsWall } from '../src/player/collision.js';
import { raycastGrid } from '../src/player/raycast.js';

const R = 0.17;
const grid = (...cells) => {
    const set = new Set(cells.map(([x, z]) => `${x},${z}`));
    return (x, z) => set.has(`${x},${z}`);
};

describe('moveAndCollide', () => {
    it('moves freely in open space', () => {
        const p = { x: 0, z: 0 };
        moveAndCollide(p, 0.1, -0.05, R, grid());
        expect(p.x).toBeCloseTo(0.1);
        expect(p.z).toBeCloseTo(-0.05);
    });

    it('stops flush against a wall', () => {
        const isWall = grid([1, 0]);
        const p = { x: 0.3, z: 0 };
        const hit = moveAndCollide(p, 0.1, 0, R, isWall);
        expect(hit.hitX).toBe(true);
        expect(p.x).toBeCloseTo(0.5 - R, 5);
        expect(overlapsWall(p.x, p.z, R, isWall)).toBe(false);
    });

    it('slides along a wall instead of sticking to it', () => {
        const isWall = grid([1, 0], [1, 1], [1, -1]);
        const p = { x: 0.5 - R - 0.001, z: 0 };
        moveAndCollide(p, 0.05, 0.05, R, isWall);
        expect(p.x).toBeLessThan(0.5 - R);
        expect(p.z).toBeCloseTo(0.05);
    });

    it('handles negative directions and coordinates', () => {
        const isWall = grid([-4, -7]);
        const p = { x: -3.3, z: -7 };
        moveAndCollide(p, -0.1, 0, R, isWall);
        expect(p.x).toBeCloseTo(-3.5 + R, 5);
    });

    it('never ends up inside a wall over many random steps', () => {
        const isWall = (x, z) => ((x * 7 + z * 13) & 3) === 0 && !(x === 0 && z === 0);
        const p = { x: 0, z: 0 };
        let seed = 1;
        const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 20000; i++) {
            moveAndCollide(p, (random() - 0.5) * 0.09, (random() - 0.5) * 0.09, R, isWall);
            expect(overlapsWall(p.x, p.z, R, isWall)).toBe(false);
        }
    });
});

describe('findFreeSpot', () => {
    it('returns the input when it is already free', () => {
        expect(findFreeSpot(0.2, 0.1, R, grid())).toEqual({ x: 0.2, z: 0.1 });
    });

    it('moves out of a wall to the nearest free cell', () => {
        const isWall = grid([0, 0], [1, 0], [0, 1], [-1, 0]);
        const spot = findFreeSpot(0, 0, R, isWall);
        expect(overlapsWall(spot.x, spot.z, R, isWall)).toBe(false);
        expect(Math.hypot(spot.x, spot.z)).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
    });
});

describe('raycastGrid', () => {
    it('hits the side of a wall and reports the face normal', () => {
        const hit = raycastGrid(0, 0.5, 0, 1, 0, 0, 10, grid([3, 0]));
        expect(hit.kind).toBe('wall');
        expect([hit.x, hit.z]).toEqual([3, 0]);
        expect(hit.distance).toBeCloseTo(2.5);
        expect(hit.normal).toEqual([-1, 0, 0]);
    });

    it('works in negative directions', () => {
        const hit = raycastGrid(0, 0.5, 0, 0, 0, -1, 10, grid([0, -2]));
        expect([hit.x, hit.z]).toEqual([0, -2]);
        expect(hit.normal).toEqual([0, 0, 1]);
    });

    it('hits the floor when looking down at open space', () => {
        const d = Math.SQRT1_2;
        const hit = raycastGrid(0, 0.5, 0, d, -d, 0, 10, grid());
        expect(hit.kind).toBe('floor');
        expect(hit.distance).toBeCloseTo(0.5 / d);
        expect([hit.x, hit.z]).toEqual([1, 0]);
    });

    it('hits the ceiling from below', () => {
        const hit = raycastGrid(0, 0.5, 0, 0, 1, 0, 10, grid());
        expect(hit.kind).toBe('ceiling');
        expect(hit.distance).toBeCloseTo(0.5);
    });

    it('hits the top of a wall when flying above it', () => {
        const d = Math.SQRT1_2;
        const hit = raycastGrid(0, 2, 0, d, -d, 0, 10, grid([1, 0], [2, 0]));
        expect(hit.kind).toBe('wall');
        expect(hit.normal).toEqual([0, 1, 0]);
    });

    it('ignores walls beyond the reach', () => {
        expect(raycastGrid(0, 0.5, 0, 1, 0, 0, 2, grid([5, 0]))).toBeNull();
    });

    it('passes over walls when the ray is above them', () => {
        expect(raycastGrid(0, 1.5, 0, 1, 0, 0, 10, grid([2, 0]))).toBeNull();
    });
});
