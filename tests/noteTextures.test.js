import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NOTE_COUNT } from '../src/footage/arena.js';
import { FoundFootage } from '../src/footage/FoundFootage.js';
import { NOTES_PER_LEVEL, NOTE_PIXELS_TALL, NOTE_PIXELS_WIDE, NoteAtlas } from '../src/footage/noteTextures.js';
import { LEVELS, TAPE_LEVELS } from '../src/world/levels.js';
import { mulberry32 } from '../src/world/random.js';

// The notes draw on canvases. There aren't real ones here, so each fake one keeps a list of what was done to it.
// Copying one canvas onto another records the copied canvas's list, so two notes compare equal only if they were
// drawn the same way with the same random numbers.
const original = globalThis.document;
/** @type {any[]} */
let made = [];
beforeAll(() => {
    globalThis.document = /** @type {any} */ ({ createElement: fakeCanvas });
});
afterAll(() => {
    globalThis.document = original;
});
beforeEach(() => {
    made = [];
});

function fakeCanvas() {
    const canvas = { width: 300, height: 150, ops: /** @type {any[]} */ ([]), getContext: () => context };
    const context = new Proxy({}, {
        get: (_, name) => (...args) => {
            canvas.ops.push([name, ...args.map((arg) => arg?.ops ?? arg)]);
            if (name === 'measureText') return { width: 12 };
            if (name === 'createRadialGradient') return { addColorStop: (...stop) => canvas.ops.push(['addColorStop', ...stop]) };
            return undefined;
        },
        set: (_, name, value) => {
            canvas.ops.push([name, typeof value === 'object' ? 'gradient' : value]);
            return true;
        },
    });
    made.push(canvas);
    return canvas;
}

/** The notes copied onto a level's sheet, as [what was drawn, x, y]. */
function notesOn(atlas, level) {
    return /** @type {any} */ (atlas.sheets[level]).ops.filter(([name]) => name === 'drawImage').map(([, ops, x, y]) => [ops, x, y]);
}

describe('NoteAtlas', () => {
    it('has a sheet of notes for every level, in id order', () => {
        expect(NOTES_PER_LEVEL).toBe(NOTE_COUNT);
        LEVELS.forEach((level, i) => {
            expect(level.id).toBe(i);
            expect(level.tape.notes.length).toBe(NOTES_PER_LEVEL);
        });
    });

    it('draws nothing until a level is needed, and nothing goes to the GPU before', () => {
        const atlas = new NoteAtlas();
        expect(made).toEqual([]);
        expect(atlas.texture.image).toBe(null);
        expect(atlas.texture.version).toBe(0);
    });

    it('draws only up to the level shown, and points the texture at its sheet', () => {
        const atlas = new NoteAtlas();
        atlas.show(0);
        expect(atlas.drawn).toBe(NOTES_PER_LEVEL);
        expect(atlas.texture.image).toBe(atlas.sheets[0]);
        expect(atlas.texture.version).toBe(1);
        atlas.show(0);
        expect(atlas.texture.version).toBe(1);

        // Level 2 (id 3) is drawn after every lower id, whatever order the tape goes in.
        atlas.show(3);
        expect(atlas.drawn).toBe(4 * NOTES_PER_LEVEL);
        expect(atlas.texture.image).toBe(atlas.sheets[3]);
        expect(atlas.texture.version).toBe(2);
        for (const sheet of atlas.sheets) expect([sheet.width, sheet.height]).toEqual([atlas.sheets[0].width, atlas.sheets[0].height]);

        // Going back draws nothing new.
        atlas.show(1);
        expect(atlas.drawn).toBe(4 * NOTES_PER_LEVEL);
        expect(atlas.texture.image).toBe(atlas.sheets[1]);
    });

    it('draws one note at a time up to a level', () => {
        const atlas = new NoteAtlas();
        for (let i = 1; i < NOTES_PER_LEVEL; i++) expect(atlas.drawNext(1)).toBe(true);
        expect(atlas.drawn).toBe(NOTES_PER_LEVEL - 1);
        for (let i = 0; i <= NOTES_PER_LEVEL; i++) expect(atlas.drawNext(1)).toBe(true);
        expect(atlas.drawn).toBe(2 * NOTES_PER_LEVEL);
        // Nothing left up to that level.
        expect(atlas.drawNext(1)).toBe(false);
        expect(atlas.drawn).toBe(2 * NOTES_PER_LEVEL);
        while (atlas.drawNext());
        expect(atlas.drawn).toBe(LEVELS.length * NOTES_PER_LEVEL);
    });

    it('draws every note the same whatever order they\'re asked for', () => {
        const all = new NoteAtlas();
        all.picture(LEVELS.length * NOTES_PER_LEVEL - 1);
        const asNeeded = new NoteAtlas();
        for (const level of TAPE_LEVELS) {
            asNeeded.show(level);
            asNeeded.drawNext();
        }
        for (let level = 0; level < LEVELS.length; level++) {
            expect(notesOn(all, level)).toHaveLength(NOTES_PER_LEVEL);
            expect(notesOn(asNeeded, level)).toEqual(notesOn(all, level));
        }
        // One stream through them all, so each level's first note has its first stain somewhere else. The first
        // gradient is the yellowing, the same on every note.
        const firstStain = (level) => notesOn(all, level)[0][0].filter(([name]) => name === 'createRadialGradient')[1];
        expect(firstStain(0).slice(1, 3)).toEqual([mulberry32(0x0e7e)() * NOTE_PIXELS_WIDE, expect.any(Number)]);
        const stains = LEVELS.map((_, level) => JSON.stringify(firstStain(level)));
        expect(new Set(stains).size).toBe(LEVELS.length);
    });

    it('draws every note as it always has', () => {
        const atlas = new NoteAtlas();
        atlas.ensure(LEVELS.length - 1);
        const notes = LEVELS.flatMap((_, level) => notesOn(atlas, level).map(([ops]) => ops));
        expect(notes).toHaveLength(LEVELS.length * NOTES_PER_LEVEL);
        // Every call that drew the 48 notes when they were all drawn into one atlas at load. Changes if a note's
        // drawing or its random numbers do.
        expect(createHash('sha1').update(JSON.stringify(notes)).digest('hex')).toBe('2c107468cb00caefb9eee1d26babf3968982ae2f');
    });

    it('maps each note\'s UVs exactly onto its picture', () => {
        const atlas = new NoteAtlas();
        // The UVs below count on rows being flipped on upload.
        expect(atlas.texture.flipY).toBe(true);
        for (let index = 0; index < LEVELS.length * NOTES_PER_LEVEL; index++) {
            const level = Math.floor(index / NOTES_PER_LEVEL);
            const { image, x, y, width, height } = atlas.picture(index);
            expect(image).toBe(atlas.sheets[level]);
            expect([width, height]).toEqual([NOTE_PIXELS_WIDE, NOTE_PIXELS_TALL]);
            expect(x + width).toBeLessThanOrEqual(image.width);
            expect(y + height).toBeLessThanOrEqual(image.height);
            // Copied onto the sheet where the picture says.
            expect(notesOn(atlas, level)[index % NOTES_PER_LEVEL].slice(1)).toEqual([x, y]);
            // Flipped on upload, so v = 1 is the top row.
            const { u0, u1, v0, v1 } = atlas.uv(index);
            expect(u0 * image.width).toBeCloseTo(x, 9);
            expect(u1 * image.width).toBeCloseTo(x + width, 9);
            expect((1 - v1) * image.height).toBeCloseTo(y, 9);
            expect((1 - v0) * image.height).toBeCloseTo(y + height, 9);
        }
        // No two notes on a sheet overlap.
        for (let level = 0; level < LEVELS.length; level++) {
            const cells = notesOn(atlas, level).map(([, x, y]) => `${x},${y}`);
            expect(new Set(cells).size).toBe(NOTES_PER_LEVEL);
        }
    });
});

describe('FoundFootage.drawAhead', () => {
    const drawAhead = (footage) => FoundFootage.prototype.drawAhead.call(footage);

    it('gets the next level\'s notes ready a note at a time', () => {
        const noteAtlas = new NoteAtlas();
        // Outside a tape, the first tape level's, for when the mode is picked.
        expect(drawAhead({ prepared: false, level: TAPE_LEVELS[0], noteAtlas })).toBe(true);
        expect(noteAtlas.drawn).toBe(1);
        while (drawAhead({ prepared: false, level: TAPE_LEVELS[0], noteAtlas }));
        expect(noteAtlas.drawn).toBe((TAPE_LEVELS[0] + 1) * NOTES_PER_LEVEL);
        expect(noteAtlas.texture.version).toBe(0);

        noteAtlas.show(TAPE_LEVELS[0]);
        while (drawAhead({ prepared: true, level: TAPE_LEVELS[0], noteAtlas }));
        expect(noteAtlas.drawn).toBe((Math.max(TAPE_LEVELS[0], TAPE_LEVELS[1]) + 1) * NOTES_PER_LEVEL);

        const last = TAPE_LEVELS[TAPE_LEVELS.length - 1];
        const drawn = noteAtlas.drawn;
        expect(drawAhead({ prepared: true, level: last, noteAtlas })).toBe(false);
        expect(noteAtlas.drawn).toBe(drawn);
    });
});
