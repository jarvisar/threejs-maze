import { Texture } from 'three';
import { LEVELS } from '../world/levels.js';
import { mulberry32 } from '../world/random.js';

/*
 * Note textures. Old paper with a few handwritten words and a drawing, like Slender's pages that teach the rules
 * without a tutorial. Each level has eight (text is in levels.js).
 *
 * Drawn on a 2D canvas letter by letter with some wobble so it doesn't look typed. Each level's notes go on a sheet
 * of their own, drawn the first time they're needed. The walls show one level's sheet at a time, and the on-screen
 * view draws the note you take from it. Level L's note k is index L * 8 + k.
 *
 * Every note takes its random numbers from one stream in index order, as when they were all drawn at load, so they
 * look the same as they always have. That means a level's notes can only be drawn after every earlier level's.
 */

export const NOTE_PIXELS_WIDE = 256;
export const NOTE_PIXELS_TALL = 362;
const COLUMNS = 4;
const ROWS = 2;
export const NOTES_PER_LEVEL = COLUMNS * ROWS;
const SHEET_WIDTH = COLUMNS * NOTE_PIXELS_WIDE;
// No padding to a power of two: WebGL 2 makes mipmaps of any size, and the bottom row then clamps to its own edge
// instead of bleeding into empty canvas.
const SHEET_HEIGHT = ROWS * NOTE_PIXELS_TALL;

const PAPER = '#e6dfc7';
const INK = '#1c1a17';
const handFont = (size) => `bold ${size}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", "Segoe Print", "Bradley Hand", cursive, sans-serif`;

/**
 * @typedef {object} NotePicture Where one note is on its level's sheet (see Hud.showNote).
 * @property {HTMLCanvasElement} image
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/** @typedef {{ u0: number, v0: number, u1: number, v1: number }} NoteUv */

/** Every level's tape notes, drawn as they're needed. One level's are on the GPU at a time. */
export class NoteAtlas {
    constructor() {
        this.notes = LEVELS.flatMap((level) => level.tape.notes);
        /** @type {HTMLCanvasElement[]} One per level, made with its first note. */
        this.sheets = [];
        /** Notes drawn so far, in index order. */
        this.drawn = 0;
        this._random = mulberry32(0x0e7e);
        // No image until a level is shown, so nothing is uploaded in Explore. A CanvasTexture would ask for an upload
        // as soon as it's made. Every sheet is the same size, so showing another level reuses the GPU storage.
        this.texture = new Texture();
        this.texture.anisotropy = 4;
        /** @type {number | null} Level whose sheet the texture shows. */
        this.shown = null;
    }

    /**
     * Draws the next note in order, for idle time. A few ms each, several times that on a phone.
     * @param {number} [upTo] Last level to draw notes for.
     * @returns {boolean} True if it drew one, false when every note up to that level is done.
     */
    drawNext(upTo = LEVELS.length - 1) {
        const end = Math.min(this.notes.length, (upTo + 1) * NOTES_PER_LEVEL);
        if (this.drawn >= end) return false;
        const index = this.drawn;
        const level = Math.floor(index / NOTES_PER_LEVEL);
        this.sheets[level] ??= sheet();
        // A new canvas for each note, as drawNote leaves line caps and the like set for the next one.
        const canvas = document.createElement('canvas');
        canvas.width = NOTE_PIXELS_WIDE;
        canvas.height = NOTE_PIXELS_TALL;
        drawNote(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), this.notes[index], this._random);
        const [x, y] = cell(index);
        /** @type {CanvasRenderingContext2D} */ (this.sheets[level].getContext('2d')).drawImage(canvas, x, y);
        this.drawn++;
        return true;
    }

    /**
     * Draws a level's notes, and every earlier level's first.
     * @param {number} level
     * @returns {HTMLCanvasElement} Its sheet.
     */
    ensure(level) {
        while (this.drawNext(level));
        return this.sheets[level];
    }

    /**
     * Points the texture at a level's notes, drawing them first if needed. It uploads the next time it's drawn or
     * passed to renderer.initTexture.
     * @param {number} level
     */
    show(level) {
        const image = this.ensure(level);
        if (this.shown === level) return;
        this.shown = level;
        this.texture.image = image;
        this.texture.needsUpdate = true;
    }

    /**
     * Where a note is, for the on-screen view. Draws it first if needed.
     * @param {number} index
     * @returns {NotePicture}
     */
    picture(index) {
        const image = this.ensure(Math.floor(index / NOTES_PER_LEVEL));
        const [x, y] = cell(index);
        return { image, x, y, width: NOTE_PIXELS_WIDE, height: NOTE_PIXELS_TALL };
    }

    /**
     * UVs for one note, for while its level is shown. Canvas textures are flipped on upload so row 0 is v = 1.
     * @param {number} index
     * @returns {NoteUv}
     */
    uv(index) {
        const [x, y] = cell(index);
        return {
            u0: x / SHEET_WIDTH,
            u1: (x + NOTE_PIXELS_WIDE) / SHEET_WIDTH,
            v0: 1 - (y + NOTE_PIXELS_TALL) / SHEET_HEIGHT,
            v1: 1 - y / SHEET_HEIGHT,
        };
    }
}

function sheet() {
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;
    return canvas;
}

/** Top left of a note on its level's sheet. */
function cell(index) {
    const slot = index % NOTES_PER_LEVEL;
    return [(slot % COLUMNS) * NOTE_PIXELS_WIDE, Math.floor(slot / COLUMNS) * NOTE_PIXELS_TALL];
}

/**
 * Draws notes into slots on another canvas, for the ones edit mode puts on walls (see PROP_ATLAS.notes in
 * propAtlas.js).
 * @param {CanvasRenderingContext2D} g
 * @param {{ lines: string[], drawing: string }[]} notes
 * @param {number[][]} rects [x0, y0, x1, y1] for each.
 */
export function drawNotes(g, notes, rects) {
    const canvas = document.createElement('canvas');
    canvas.width = NOTE_PIXELS_WIDE;
    canvas.height = NOTE_PIXELS_TALL;
    const note = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const random = mulberry32(0x0e7f);
    rects.forEach(([x0, y0, x1, y1], k) => {
        drawNote(note, notes[k % notes.length], random);
        g.drawImage(canvas, x0, y0, x1 - x0, y1 - y0);
    });
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {{ lines: string[], drawing: string }} note
 * @param {() => number} random
 */
function drawNote(g, note, random) {
    const w = NOTE_PIXELS_WIDE;
    const h = NOTE_PIXELS_TALL;

    // Old paper: yellowed edges, stains, a couple of creases.
    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, h);
    const age = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
    age.addColorStop(0, 'rgba(120,90,40,0)');
    age.addColorStop(1, 'rgba(120,90,40,0.28)');
    g.fillStyle = age;
    g.fillRect(0, 0, w, h);
    for (let n = 0; n < 5; n++) {
        const x = random() * w;
        const y = random() * h;
        const r = 14 + random() * 40;
        const stain = g.createRadialGradient(x, y, 0, x, y, r);
        stain.addColorStop(0, `rgba(110,80,40,${0.06 + random() * 0.1})`);
        stain.addColorStop(1, 'rgba(110,80,40,0)');
        g.fillStyle = stain;
        g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (let n = 0; n < 2; n++) {
        const y = h * (0.25 + random() * 0.5);
        g.strokeStyle = 'rgba(255,255,250,0.5)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y + (random() - 0.5) * 30);
        g.stroke();
        g.strokeStyle = 'rgba(80,60,30,0.18)';
        g.beginPath();
        g.moveTo(0, y + 2);
        g.lineTo(w, y + 2 + (random() - 0.5) * 30);
        g.stroke();
    }
    for (let n = 0; n < 900; n++) {
        g.fillStyle = `rgba(90,70,40,${0.03 + random() * 0.06})`;
        g.fillRect(random() * w, random() * h, 1, 1);
    }
    // Tape strip at the top.
    g.save();
    g.translate(w / 2, 14);
    g.rotate((random() - 0.5) * 0.3);
    g.fillStyle = 'rgba(235,225,180,0.75)';
    g.fillRect(-42, -10, 84, 22);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(-42, -10, 84, 6);
    g.restore();

    // Big shaky text, the drawing gets the space left below it.
    const lines = note.lines;
    let size = lines.some((line) => line.length > 8) ? 34 : 44;
    // Measure per letter like scrawl does, with room for wobble and margins. Character counts alone let wide
    // lines like FOLLOWED or NO NO NO run off the sheet.
    g.font = handFont(size);
    const widest = Math.max(...lines.map((line) => [...line].reduce((width, ch) => width + g.measureText(ch).width, 0) * 1.02));
    size = Math.floor(size * Math.min(1, (w - 40) / widest));
    const lineHeight = size * 1.12;
    const textTop = 40;
    for (let i = 0; i < lines.length; i++) scrawl(g, lines[i], w / 2, textTop + i * lineHeight + size / 2, size, random);
    const drawingTop = textTop + lines.length * lineHeight + 8;
    drawings[note.drawing]?.(g, w / 2, drawingTop, h - 16 - drawingTop, random);
}

/** Writes a line one letter at a time with random offset and rotation, like a rushed marker. */
function scrawl(g, text, cx, cy, size, random) {
    g.font = handFont(size);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const widths = [...text].map((ch) => g.measureText(ch).width);
    const total = widths.reduce((sum, width) => sum + width, 0) * 1.02;
    let x = cx - total / 2;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        g.save();
        g.translate(x + widths[i] / 2, cy + (random() - 0.5) * size * 0.14);
        g.rotate((random() - 0.5) * 0.18);
        g.fillStyle = INK;
        g.globalAlpha = 0.86 + random() * 0.14;
        g.fillText(ch, -widths[i] / 2, 0);
        // Second offset pass makes the stroke uneven.
        g.globalAlpha = 0.5;
        g.fillText(ch, -widths[i] / 2 + (random() - 0.5) * 2.5, (random() - 0.5) * 2.5);
        g.restore();
        x += widths[i] * 1.02;
    }
}

/** Ink polyline with jitter. */
function ink(g, points, width, random) {
    g.strokeStyle = INK;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalAlpha = 0.85;
    g.beginPath();
    points.forEach(([x, y], i) => {
        const jx = x + (random() - 0.5) * 3;
        const jy = y + (random() - 0.5) * 3;
        if (i === 0) g.moveTo(jx, jy);
        else g.lineTo(jx, jy);
    });
    g.stroke();
    g.globalAlpha = 1;
}

/** The Watcher: long body, long arms, small head. */
function tallFigure(g, x, top, height, random) {
    const head = height * 0.09;
    ink(g, circle(x, top + head, head * 0.9), 4, random);
    ink(g, [[x, top + head * 2], [x, top + height * 0.62]], 7, random); // body
    ink(g, [[x, top + height * 0.62], [x - head * 0.9, top + height]], 5, random); // legs
    ink(g, [[x, top + height * 0.62], [x + head * 0.9, top + height]], 5, random);
    ink(g, [[x, top + head * 2.6], [x - head * 1.6, top + height * 0.7]], 4, random); // arms, past the knees
    ink(g, [[x, top + head * 2.6], [x + head * 1.6, top + height * 0.7]], 4, random);
}

/** Small stick figure for a person. */
function stickFigure(g, x, top, height, random, running = false) {
    const head = height * 0.16;
    ink(g, circle(x, top + head, head * 0.8), 3, random);
    ink(g, [[x, top + head * 1.8], [x, top + height * 0.6]], 4, random);
    const spread = running ? head * 1.6 : head * 0.7;
    ink(g, [[x, top + height * 0.6], [x - spread, top + height]], 3, random);
    ink(g, [[x, top + height * 0.6], [x + spread * 0.8, top + height * (running ? 0.85 : 1)]], 3, random);
    ink(g, [[x, top + head * 2.3], [x - head * 0.9, top + head * (running ? 1.6 : 3.4)]], 3, random);
    ink(g, [[x, top + head * 2.3], [x + head * 0.9, top + head * (running ? 3.4 : 1.6)]], 3, random);
}

function circle(cx, cy, r, points = 20) {
    const out = [];
    for (let i = 0; i <= points; i++) {
        const a = (i / points) * 2 * Math.PI;
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
}

/** @type {Record<string, (g: CanvasRenderingContext2D, cx: number, top: number, height: number, random: () => number) => void>} */
const drawings = {
    eye(g, cx, top, height, random) {
        const cy = top + height / 2;
        const w = 80;
        const h = 44;
        ink(g, [[cx - w, cy], [cx - w / 2, cy - h], [cx, cy - h * 1.1], [cx + w / 2, cy - h], [cx + w, cy], [cx + w / 2, cy + h], [cx, cy + h * 1.1], [cx - w / 2, cy + h], [cx - w, cy]], 4, random);
        ink(g, circle(cx, cy, 18), 4, random);
        g.fillStyle = INK;
        g.beginPath();
        g.arc(cx, cy, 8, 0, 2 * Math.PI);
        g.fill();
        // Heavy cross through it.
        ink(g, [[cx - w - 10, cy - h - 30], [cx + w + 10, cy + h + 30]], 8, random);
        ink(g, [[cx + w + 10, cy - h - 30], [cx - w - 10, cy + h + 30]], 8, random);
    },
    behind(g, cx, top, height, random) {
        tallFigure(g, cx + 30, top, height, random);
        stickFigure(g, cx - 40, top + height * 0.45, height * 0.55, random);
    },
    arrows(g, cx, top, height, random) {
        for (let n = 0; n < 3; n++) {
            const y = top + height * (0.2 + n * 0.3);
            const x0 = cx - 70 + n * 10;
            const x1 = cx + 60 + n * 10;
            ink(g, [[x0, y], [x1, y]], 6, random);
            ink(g, [[x1 - 22, y - 20], [x1, y], [x1 - 22, y + 20]], 6, random);
        }
    },
    panel(g, cx, top, height, random) {
        const cy = top + height / 2;
        ink(g, [[cx - 70, cy - 30], [cx + 70, cy - 30], [cx + 70, cy + 30], [cx - 70, cy + 30], [cx - 70, cy - 30]], 5, random);
        // Scribbled out, meaning no light.
        for (let n = 0; n < 9; n++) ink(g, [[cx - 66 + n * 16, cy - 26], [cx - 58 + n * 16, cy + 26]], 3, random);
        ink(g, [[cx - 80, cy - 45], [cx + 80, cy + 45]], 7, random);
    },
    scribble(g, cx, top, height, random) {
        const points = [];
        for (let n = 0; n < 40; n++) points.push([cx - 90 + random() * 180, top + random() * height]);
        ink(g, points, 4, random);
    },
    door(g, cx, top, height, random) {
        // Leave room above the door for the rays so they don't hit the text on short notes.
        const bottom = top + height - 4;
        const doorTop = top + height * 0.32;
        const cy = (doorTop + bottom) / 2;
        const w = Math.min(48, height * 0.4);
        const h = (bottom - doorTop) / 2;
        ink(g, [[cx - w, cy + h], [cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h]], 6, random);
        // Light rays.
        const inner = h + 6;
        const outer = Math.min(inner + 24, cy - top - 4);
        for (let n = 0; n < 7; n++) {
            const a = -Math.PI / 2 + (n - 3) * 0.32;
            ink(g, [[cx + Math.cos(a) * inner, cy + Math.sin(a) * inner], [cx + Math.cos(a) * outer, cy + Math.sin(a) * outer]], 3, random);
        }
    },
    run(g, cx, top, height, random) {
        stickFigure(g, cx - 55, top + height * 0.3, height * 0.7, random, true);
        tallFigure(g, cx + 45, top, height, random);
    },
    figure(g, cx, top, height, random) {
        tallFigure(g, cx, top, height, random);
    },
};
