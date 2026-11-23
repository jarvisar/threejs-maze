import { createHash } from 'node:crypto';
import { MeshBasicMaterial, Texture } from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { finish } from '../src/world/chunkGeometry.js';
import { LEVELS } from '../src/world/levels.js';
import { createMaterials } from '../src/world/materials.js';
import { PanelLightMap } from '../src/world/panelLights.js';
import { mulberry32 } from '../src/world/random.js';
import { fakeDocument } from './fakeCanvas.js';

/*
 * A level's surfaces can be made a step at a time (see levelSteps in materials.js), which means a level's drawing can
 * stop part way while another level's goes on. Each must come out the same however that goes.
 */

const STEPPED = LEVELS.filter((level) => level.surfaceSteps);
const original = { document: globalThis.document, Path2D: globalThis.Path2D };
/** Level being drawn, so each canvas knows whose it is. */
let drawing = null;

beforeEach(() => {
    globalThis.document = /** @type {any} */ (fakeDocument(() => drawing));
    globalThis.Path2D = /** @type {any} */ (class {
        constructor(d) {
            this.fake = `path(${d})`;
        }
    });
});
afterEach(() => {
    globalThis.document = original.document;
    globalThis.Path2D = original.Path2D;
    drawing = null;
});

/** The materials every level shares (see createMaterials), as plain stand-ins. */
function shared() {
    return new Proxy({}, { get: (made, name) => (made[name] ??= new MeshBasicMaterial()) });
}

const hash = (array) => createHash('sha1').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex').slice(0, 12);

/** How a level's surfaces look: every canvas drawn for it, and what each texture is and how it's set up. */
function looks(surfaces, level) {
    const canvases = /** @type {any} */ (globalThis.document).canvases.filter((canvas) => canvas.owner === level).map((canvas) => canvas.digest());
    const materials = [surfaces.wall, surfaces.floor, surfaces.ceiling, surfaces.details, surfaces.backdrop, ...Object.values(surfaces.extras)];
    const seen = new Set();
    const textures = [];
    for (const material of materials) {
        if (!material) continue;
        for (const value of [...Object.values(material), ...Object.values(material.uniforms ?? {}).map((uniform) => uniform?.value)]) {
            if (!value?.isTexture || seen.has(value)) continue;
            seen.add(value);
            const { image } = value;
            textures.push([
                image?.digest?.() ?? (image?.data ? `${image.width}x${image.height} ${hash(image.data)}` : null),
                value.repeat.x, value.repeat.y, value.wrapS, value.wrapT, value.minFilter, value.magFilter, value.anisotropy, value.flipY,
            ]);
        }
    }
    return { canvases, textures, keys: materials.map((material) => material?.customProgramCacheKey()), shadows: surfaces.shadows };
}

describe('a level\'s surfaces made in steps', () => {
    it('come out the same alone or mixed in with other levels\' steps', () => {
        expect(STEPPED.length).toBeGreaterThan(0);
        const alone = new Map();
        for (const level of STEPPED) {
            drawing = level.name;
            alone.set(level.id, looks(finish(level.surfaceSteps(shared(), 16, level.id)), level.name));
        }
        globalThis.document = /** @type {any} */ (fakeDocument(() => drawing));
        // Every level part way through at once, a few steps of one and then another.
        const random = mulberry32(11);
        const jobs = STEPPED.map((level) => ({ level, steps: level.surfaceSteps(shared(), 16, level.id), surfaces: null, count: 0 }));
        while (jobs.some((job) => !job.surfaces)) {
            const open = jobs.filter((job) => !job.surfaces);
            const job = open[Math.floor(random() * open.length)];
            drawing = job.level.name;
            for (let n = 1 + Math.floor(random() * 4); n > 0 && !job.surfaces; n--) {
                const step = job.steps.next();
                job.count++;
                if (step.done) job.surfaces = step.value;
            }
        }
        for (const job of jobs) {
            // Drawn in many steps, not one.
            expect(job.count).toBeGreaterThan(3);
            expect(looks(job.surfaces, job.level.name)).toEqual(alone.get(job.level.id));
        }
    });

    it('share one build per level, however many ask for it', () => {
        const panels = new PanelLightMap();
        const textures = new Proxy({}, { get: (made, name) => (typeof name === 'string' ? (made[name] ??= new Texture()) : undefined) });
        const materials = createMaterials(textures, panels.texture, 16, panels.cells);
        const level = STEPPED[0].id;
        const canvases = /** @type {any} */ (globalThis.document).canvases;
        const first = materials.levelSteps(level);
        const second = materials.levelSteps(level);
        for (let i = 0; i < 10; i++) {
            first.next();
            second.next();
        }
        expect(materials.hasLevel(level)).toBe(false);
        // Stopping one doesn't stop the build, and level() finishes the same one.
        first.return(undefined);
        const before = canvases.length;
        const surfaces = materials.level(level);
        expect(materials.hasLevel(level)).toBe(true);
        expect(second.next()).toEqual({ done: true, value: surfaces });
        expect(materials.levelSteps(level).next()).toEqual({ done: true, value: surfaces });
        // Made once: nothing drawn again after this.
        const drawn = canvases.length;
        expect(drawn).toBeGreaterThanOrEqual(before);
        materials.level(level);
        finish(materials.levelSteps(level));
        expect(canvases.length).toBe(drawn);
    });
});
