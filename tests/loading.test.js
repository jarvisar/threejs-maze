import { MeshBasicMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { ChunkStore } from '../src/world/ChunkStore.js';
import { chunkKey } from '../src/world/grid.js';
import { LEVELS } from '../src/world/levels.js';
import { whenCompiled } from '../src/world/materials.js';
import { PanelLightMap } from '../src/world/panelLights.js';
import { WorldView } from '../src/world/WorldView.js';

/*
 * Builds a world without blocking the page (see Game.settle). Chunks load a few at a time, nearest first, and
 * shaders compile without blocking either.
 */

/** Stand-in materials (see createMaterials). Plain, since nothing here actually draws. */
function fakeMaterials() {
    const plain = () => new MeshBasicMaterial();
    const levels = [];
    const shared = {
        baseboard: plain(),
        shade: plain(),
        decal: plain(),
        ceilingDecal: plain(),
        prop: plain(),
        fixture: plain(),
        panel: plain(),
        panelGlow: plain(),
        party: { things: plain(), decal: plain(), balloon: plain(), flame: plain(), disco: plain(), chalk: plain() },
    };
    return {
        ...shared,
        level(id) {
            return (levels[id] ??= { wall: plain(), floor: plain(), ceiling: plain(), details: plain(), extras: new Proxy({}, { get: (target, name) => (target[name] ??= plain()) }), shadows: [] });
        },
        hasLevel: (id) => levels[id] !== undefined,
    };
}

function view(level = 0) {
    const store = new ChunkStore(99, null, LEVELS[level].options(99));
    return new WorldView(new Scene(), store, fakeMaterials(), new PanelLightMap());
}

describe('WorldView.update with a budget', () => {
    it('does the chunk the player is in first, then the rest, a bit at a time', () => {
        const world = view();
        world.update(0, 0, Infinity, 0);
        // No time budget: one chunk per call, the player's own chunk first.
        expect([...world.chunks.keys()]).toEqual([chunkKey(0, 0)]);
        expect(world.pending).toBeGreaterThan(0);
        let calls = 1;
        while (world.pending > 0 && calls < 100) {
            world.update(0, 0, Infinity, 0);
            calls++;
        }
        expect(world.pending).toBe(0);
        expect(calls).toBeGreaterThan(9);

        // Same chunks end up built as building everything in one call.
        const all = view();
        all.update(0, 0, Infinity);
        expect(all.pending).toBe(0);
        expect([...world.chunks.keys()].sort()).toEqual([...all.chunks.keys()].sort());
        for (const chunk of world.chunks.values()) expect(chunk.dirty).toBe(false);
    });

    it('builds the nearest waiting chunk before any further off', () => {
        const world = view(1);
        // Load everything but build nothing yet.
        world.update(0, 0, 0);
        const built = [];
        while (world.pending > 0) {
            const before = new Set([...world.chunks.values()].filter((chunk) => !chunk.dirty));
            world.update(0, 0, 1, 0);
            for (const chunk of world.chunks.values()) if (!chunk.dirty && !before.has(chunk)) built.push(chunk.distance);
        }
        expect(built.length).toBe(world.chunks.size);
        expect(built).toEqual([...built].sort((a, b) => a - b));
    });
});

describe('whenCompiled', () => {
    /** Fake three.js program. Ready after `polls` checks, or once its uniforms are read. */
    function program(polls) {
        return {
            program: {},
            looks: 0,
            read: 0,
            isReady() {
                return ++this.looks > polls;
            },
            getUniforms() {
                this.read++;
            },
        };
    }
    const renderer = (programs, parallel) => ({ extensions: { has: () => parallel }, info: { programs } });
    const between = () => Promise.resolve();

    it('waits for the browser to finish them, where it compiles in the background', async () => {
        const programs = [program(0), program(3), program(5)];
        await whenCompiled(renderer(programs, true), programs, { between });
        for (const p of programs) expect(p.isReady()).toBe(true);
        // Never forces one to finish immediately.
        expect(programs.every((p) => p.read === 0)).toBe(true);
    });

    it('finishes them itself elsewhere', async () => {
        const programs = [program(Infinity), program(Infinity)];
        await whenCompiled(renderer(programs, false), programs, { between });
        expect(programs.map((p) => p.read)).toEqual([1, 1]);
    });

    it('stops waiting for one that has gone (its material, or the graphics driver reset)', async () => {
        const gone = program(Infinity);
        const deleted = { ...program(Infinity), program: undefined };
        await whenCompiled(renderer([], true), [gone, deleted], { between });
    });

    it('stops when told to', async () => {
        const stuck = program(Infinity);
        let asked = 0;
        await whenCompiled(renderer([stuck], true), [stuck], { between, cancelled: () => ++asked > 3 });
        expect(asked).toBeGreaterThan(3);
    });
});
