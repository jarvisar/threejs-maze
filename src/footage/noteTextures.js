import { CanvasTexture } from 'three';
import { LEVELS } from '../world/levels.js';
import { mulberry32 } from '../world/random.js';

/*
 * The notes: sheets of old paper with a few words scrawled on each and a drawing, the way the pages in Slender
 * tell you the rules without a tutorial. Every level has its eight (what they say is in levels.js). Drawn with the
 * 2D canvas, letter by letter with a bit of wobble so no font looks typed, into one texture for the notes on the
 * walls, and kept as separate pictures for the one held up on screen when you take it. A level's notes come one
 * after another in both: level L's note k is number L × 8 + k.
 */

export const NOTE_PIXELS_WIDE = 256;
export const NOTE_PIXELS_TALL = 362;
const ATLAS_WIDTH = 1024;
const COLUMNS = 4;

const PAPER = '#e6dfc7';
const INK = '#1c1a17';

/**
 * Draws every note.
 * @returns {{ texture: CanvasTexture, images: string[], uv: (index: number) => { u0: number, v0: number, u1: number, v1: number } }}
 */
export function createNoteAtlas() {
    const notes = LEVELS.flatMap((level) => level.tape.notes);
    const atlas = document.createElement('canvas');
    atlas.width = ATLAS_WIDTH;
    atlas.height = atlasHeight(notes.length);
    const g = /** @type {CanvasRenderingContext2D} */ (atlas.getContext('2d'));
    const random = mulberry32(0x0e7e);
    const images = [];
    for (let index = 0; index < notes.length; index++) {
        const canvas = document.createElement('canvas');
        canvas.width = NOTE_PIXELS_WIDE;
        canvas.height = NOTE_PIXELS_TALL;
        drawNote(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), notes[index], random);
        images.push(canvas.toDataURL('image/png'));
        const [x, y] = cell(index);
        g.drawImage(canvas, x, y);
    }
    const texture = new CanvasTexture(atlas);
    texture.anisotropy = 4;
    const height = atlas.height;
    return { texture, images, uv: (index) => uv(index, height) };
}

/** Rows of notes, rounded up to a power of two (for mipmaps). */
function atlasHeight(count) {
    let height = 1;
    while (height < Math.ceil(count / COLUMNS) * NOTE_PIXELS_TALL) height *= 2;
    return height;
}

function cell(index) {
    return [(index % COLUMNS) * NOTE_PIXELS_WIDE, Math.floor(index / COLUMNS) * NOTE_PIXELS_TALL];
}

/** Texture coordinates of one note (canvas textures are flipped on upload: row 0 is v = 1). */
function uv(index, height) {
    const [x, y] = cell(index);
    return {
        u0: x / ATLAS_WIDTH,
        u1: (x + NOTE_PIXELS_WIDE) / ATLAS_WIDTH,
        v0: 1 - (y + NOTE_PIXELS_TALL) / height,
        v1: 1 - y / height,
    };
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {{ lines: string[], drawing: string }} note
 * @param {() => number} random
 */
function drawNote(g, note, random) {
    const w = NOTE_PIXELS_WIDE;
    const h = NOTE_PIXELS_TALL;

    // Old paper: yellowed at the edges, a few stains, a crease or two.
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
    // The bit of tape holding it up.
    g.save();
    g.translate(w / 2, 14);
    g.rotate((random() - 0.5) * 0.3);
    g.fillStyle = 'rgba(235,225,180,0.75)';
    g.fillRect(-42, -10, 84, 22);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(-42, -10, 84, 6);
    g.restore();

    // The words, big, in a shaky hand; the drawing takes whatever's left.
    const lines = note.lines;
    const size = lines.some((line) => line.length > 8) ? 34 : 44;
    const lineHeight = size * 1.12;
    const textTop = 40;
    for (let i = 0; i < lines.length; i++) scrawl(g, lines[i], w / 2, textTop + i * lineHeight + size / 2, size, random);
    const drawingTop = textTop + lines.length * lineHeight + 8;
    drawings[note.drawing]?.(g, w / 2, drawingTop, h - 16 - drawingTop, random);
}

/** Writes a line letter by letter, each a little off, as if in a hurry with a marker. */
function scrawl(g, text, cx, cy, size, random) {
    g.font = `bold ${size}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", "Segoe Print", "Bradley Hand", cursive, sans-serif`;
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
        // A second pass, nudged, thickens the stroke unevenly.
        g.globalAlpha = 0.5;
        g.fillText(ch, -widths[i] / 2 + (random() - 0.5) * 2.5, (random() - 0.5) * 2.5);
        g.restore();
        x += widths[i] * 1.02;
    }
}

/** A polyline in ink with a hand's wobble. */
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

/** The tall thing, as everyone draws it: a long body, long arms, a small head. */
function tallFigure(g, x, top, height, random) {
    const head = height * 0.09;
    ink(g, circle(x, top + head, head * 0.9), 4, random);
    ink(g, [[x, top + head * 2], [x, top + height * 0.62]], 7, random); // body
    ink(g, [[x, top + height * 0.62], [x - head * 0.9, top + height]], 5, random); // legs
    ink(g, [[x, top + height * 0.62], [x + head * 0.9, top + height]], 5, random);
    ink(g, [[x, top + head * 2.6], [x - head * 1.6, top + height * 0.7]], 4, random); // arms, past the knees
    ink(g, [[x, top + head * 2.6], [x + head * 1.6, top + height * 0.7]], 4, random);
}

/** Someone, small, as a stick figure. */
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
        // Crossed out, hard.
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
        // Scribbled out: no light.
        for (let n = 0; n < 9; n++) ink(g, [[cx - 66 + n * 16, cy - 26], [cx - 58 + n * 16, cy + 26]], 3, random);
        ink(g, [[cx - 80, cy - 45], [cx + 80, cy + 45]], 7, random);
    },
    scribble(g, cx, top, height, random) {
        const points = [];
        for (let n = 0; n < 40; n++) points.push([cx - 90 + random() * 180, top + random() * height]);
        ink(g, points, 4, random);
    },
    door(g, cx, top, height, random) {
        const cy = top + height / 2;
        const w = 48;
        const h = Math.min(height * 0.45, 70);
        ink(g, [[cx - w, cy + h], [cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h]], 6, random);
        // Light coming through it: rays.
        for (let n = 0; n < 7; n++) {
            const a = -Math.PI / 2 + (n - 3) * 0.32;
            ink(g, [[cx + Math.cos(a) * (h + 10), cy - h * 0.1 + Math.sin(a) * (h + 10)], [cx + Math.cos(a) * (h + 40), cy - h * 0.1 + Math.sin(a) * (h + 40)]], 3, random);
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
