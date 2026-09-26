import { CanvasTexture } from 'three';
import { CHUNK_SIZE } from '../config.js';
import { GLYPHS, GLYPH_CELL, drawGlyphs, glyphRect, repeating, speckle, tiledNoise, toCanvas } from './levelOneTextures.js';
import { mulberry32 } from './random.js';

/*
 * Level 2's pictures, drawn with the 2D canvas when the game loads, like Level 1's: the concrete's grain (neutral grey,
 * for the shaders to paint, stain and turn to brick or block; see pipeDreamsShading.js), and the paint atlas: the
 * signs, the tape round the pipes saying what's in them, the streaks and puddles of the black stuff, a locked door, a
 * cabinet's front, a grate in the floor, and the stencil letters (Level 1's; in here so the tunnels' names are drawn
 * with the rest of the paint). Everything is drawn from fixed seeds, so it's the same on every load.
 */

/** The paint atlas: its size, and where each picture is, in pixels. */
export const PAINT_ATLAS_SIZE = 1024;
export const PAINT_ATLAS = {
    danger: [0, 0, 128, 128],
    steam: [128, 0, 256, 128],
    noEntry: [256, 0, 384, 128],
    voltage: [384, 0, 512, 128],
    plantRoom: [512, 0, 768, 64],
    store: [512, 64, 768, 128],
    keepOut: [768, 0, 1024, 64],
    boilerHouse: [768, 64, 1024, 128],
    /** The tape round a pipe (see LABELS). */
    labels: /** @type {number[][]} */ ([]),
    streakGoo: [0, 384, 128, 640],
    streakGoo2: [128, 384, 256, 640],
    streakRust: [256, 384, 384, 640],
    streakRust2: [384, 384, 512, 640],
    puddle: [512, 384, 768, 640],
    puddle2: [768, 384, 1024, 640],
    door: [0, 640, 256, 1024],
    cabinet: [256, 640, 512, 1024],
    grate: [512, 640, 768, 896],
};

/** What the tape round a pipe says, its colour and its writing's. */
const LABELS = [
    ['STEAM', '#b9bcbc', '#111111'],
    ['COLD WATER', '#3d7a45', '#f2f0e6'],
    ['HOT WATER', '#3d7a45', '#f2f0e6'],
    ['CONDENSATE', '#b9bcbc', '#111111'],
    ['GAS', '#d8a520', '#111111'],
    ['FIRE MAIN', '#b3261e', '#f2f0e6'],
    ['RETURN', '#2b4f86', '#f2f0e6'],
    ['DRAIN', '#6b4a2b', '#f2f0e6'],
];
for (let n = 0; n < LABELS.length; n++) PAINT_ATLAS.labels.push([(n % 4) * 256, 128 + Math.floor(n / 4) * 64, (n % 4) * 256 + 256, 192 + Math.floor(n / 4) * 64]);

/**
 * Where stencil letter `c` is in the paint atlas (see GLYPHS in levelOneTextures.js), as [x0, y0, x1, y1] in pixels:
 * two rows of them under the tape, and the last few beside the grate.
 * @param {string} c
 */
export function stencilRect(c) {
    const k = Math.max(0, GLYPHS.indexOf(c));
    const [x, y] = k < 32 ? [(k % 16) * GLYPH_CELL, 256 + Math.floor(k / 16) * GLYPH_CELL] : [768 + ((k - 32) % 4) * GLYPH_CELL, 640 + Math.floor((k - 32) / 4) * GLYPH_CELL];
    return [x, y, x + GLYPH_CELL, y + GLYPH_CELL];
}

/**
 * @typedef {object} PipeDreamsTextures
 * @property {CanvasTexture} walls Concrete's grain, 1 × 1 unit, repeating.
 * @property {CanvasTexture} floor
 * @property {CanvasTexture} ceiling
 * @property {CanvasTexture} paint The paint atlas.
 */

/**
 * @param {number} maxAnisotropy
 * @returns {PipeDreamsTextures}
 */
export function createPipeDreamsTextures(maxAnisotropy) {
    const walls = repeating(drawGrain(512, 0x2d01, 130), maxAnisotropy, 1, 1);
    // The floor and ceiling are one plane a chunk, textured 0..1 across it.
    const floor = repeating(drawGrain(512, 0x2d02, 120, true), maxAnisotropy, CHUNK_SIZE, CHUNK_SIZE);
    const ceiling = repeating(drawGrain(256, 0x2d03, 120), maxAnisotropy, CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const paint = new CanvasTexture(drawPaintAtlas());
    paint.anisotropy = Math.min(8, maxAnisotropy);
    return { walls, floor, ceiling, paint };
}

/**
 * Old concrete: mottled, gritty, pitted, and here and there cracked; on the floor, worn smoother, with the grit showing.
 * A neutral grey round `level`.
 */
function drawGrain(size, seed, level, floor = false) {
    const random = mulberry32(seed);
    const broad = tiledNoise(size, random, 4, 5, 0.55);
    const fine = tiledNoise(size, random, 64, 3, 0.6);
    const grey = new Float32Array(size * size);
    for (let i = 0; i < grey.length; i++) grey[i] = level + (broad[i] - 0.5) * 70 + (fine[i] - 0.5) * (floor ? 30 : 46);
    speckle(grey, size, random, floor ? 1400 : 900, size / 340, floor ? 22 : 26);
    speckle(grey, size, random, 90, size / 120, 14);
    // Cracks: a few wandering hairlines.
    for (let n = 0; n < (floor ? 5 : 3); n++) {
        let x = random() * size;
        let y = random() * size;
        let angle = random() * Math.PI * 2;
        const length = size * (0.15 + random() * 0.35);
        for (let t = 0; t < length; t++) {
            angle += (random() - 0.5) * 0.5;
            x += Math.cos(angle);
            y += Math.sin(angle);
            const i = (((Math.floor(y) % size) + size) % size) * size + (((Math.floor(x) % size) + size) % size);
            grey[i] -= 38 * (1 - t / length * 0.6);
        }
    }
    return toCanvas(size, grey);
}

// ---------------------------------------------------------------------------------------------- the paint atlas

function drawPaintAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PAINT_ATLAS_SIZE;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const random = mulberry32(0x2d0a);
    hazard(g, PAINT_ATLAS.danger, 'HOT PIPES', heat, random);
    hazard(g, PAINT_ATLAS.steam, 'STEAM', heat, random, 'CAUTION');
    hazard(g, PAINT_ATLAS.voltage, '415 VOLTS', bolt, random);
    noEntry(g, PAINT_ATLAS.noEntry, random);
    plate(g, PAINT_ATLAS.plantRoom, 'PLANT ROOM', '#24402c', '#e8e4d6', random);
    plate(g, PAINT_ATLAS.store, 'STORE 2', '#2f3a4a', '#e8e4d6', random);
    plate(g, PAINT_ATLAS.keepOut, 'KEEP OUT', '#a3221b', '#f2eee4', random);
    plate(g, PAINT_ATLAS.boilerHouse, 'BOILER HOUSE', '#24402c', '#e8e4d6', random);
    LABELS.forEach(([text, band, ink], n) => pipeTape(g, PAINT_ATLAS.labels[n], text, band, ink, random));
    streak(g, PAINT_ATLAS.streakGoo, random, 0.9);
    streak(g, PAINT_ATLAS.streakGoo2, random, 0.7);
    streak(g, PAINT_ATLAS.streakRust, random, 0.45);
    streak(g, PAINT_ATLAS.streakRust2, random, 0.35);
    puddle(g, PAINT_ATLAS.puddle, random);
    puddle(g, PAINT_ATLAS.puddle2, random);
    door(g, PAINT_ATLAS.door, random);
    cabinetFront(g, PAINT_ATLAS.cabinet, random);
    grate(g, PAINT_ATLAS.grate, random);
    const glyphs = drawGlyphs();
    for (const c of GLYPHS) {
        const [sx, sy] = glyphRect(c);
        const [dx, dy] = stencilRect(c);
        g.drawImage(glyphs, sx, sy, GLYPH_CELL, GLYPH_CELL, dx, dy, GLYPH_CELL, GLYPH_CELL);
    }
    return canvas;
}

function within(g, [x0, y0, x1, y1], draw) {
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    g.translate(x0, y0);
    draw(x1 - x0, y1 - y0);
    g.restore();
}

/** Dirt and wear over a sign: specks gone, rust bleeding from its fixings, grime at the edges. */
function weather(g, w, h, random, strength = 1) {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
    edge.addColorStop(0, 'rgba(40, 30, 20, 0)');
    edge.addColorStop(1, `rgba(40, 30, 20, ${0.45 * strength})`);
    g.fillStyle = edge;
    g.fillRect(0, 0, w, h);
    for (let n = 0; n < 60 * strength; n++) {
        g.fillStyle = `rgba(${60 + random() * 40}, ${40 + random() * 20}, 20, ${0.1 + random() * 0.25})`;
        g.beginPath();
        g.arc(random() * w, random() * h, 0.5 + random() * 3, 0, Math.PI * 2);
        g.fill();
    }
    g.restore();
    g.save();
    g.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < 50 * strength; n++) {
        g.globalAlpha = 0.2 + random() * 0.6;
        g.beginPath();
        g.arc(random() * w, random() * h, 0.4 + random() * 2.2, 0, Math.PI * 2);
        g.fill();
    }
    g.restore();
}

function font(size, weight = 'bold') {
    return `${weight} ${size}px "Arial Narrow", "Helvetica Neue", Arial, "Liberation Sans", sans-serif`;
}

/** A warning sign: a yellow triangle with its symbol, a heading, and what the danger is. */
function hazard(g, rect, text, symbol, random, heading = 'DANGER') {
    within(g, rect, (w, h) => {
        g.fillStyle = '#e9e5d8';
        g.fillRect(4, 4, w - 8, h - 8);
        g.fillStyle = '#1b1b1b';
        g.font = font(17);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(heading, w / 2, 17, w - 16);
        // The triangle.
        g.beginPath();
        g.moveTo(w / 2, 30);
        g.lineTo(w / 2 + 34, 90);
        g.lineTo(w / 2 - 34, 90);
        g.closePath();
        g.fillStyle = '#e3b21c';
        g.fill();
        g.lineWidth = 5;
        g.lineJoin = 'round';
        g.strokeStyle = '#1b1b1b';
        g.stroke();
        symbol(g, w / 2, 68);
        g.fillStyle = '#1b1b1b';
        g.font = font(15);
        g.fillText(text, w / 2, 107, w - 14);
        // The screws at its corners.
        for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) {
            g.fillStyle = '#6d6a64';
            g.beginPath();
            g.arc(x, y, 2.4, 0, Math.PI * 2);
            g.fill();
        }
        weather(g, w, h, random);
    });
}

/** Heat coming off a surface: three wavy lines rising off a bar. */
function heat(g, x, y) {
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (const dx of [-10, 0, 10]) {
        g.beginPath();
        for (let t = 0; t <= 1; t += 0.1) {
            const px = x + dx + Math.sin(t * Math.PI * 2) * 3;
            const py = y + 10 - t * 26;
            if (t === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
        }
        g.stroke();
    }
    g.fillStyle = '#1b1b1b';
    g.fillRect(x - 16, y + 12, 32, 4);
}

/** A lightning bolt. */
function bolt(g, x, y) {
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.moveTo(x + 4, y - 18);
    g.lineTo(x - 8, y + 2);
    g.lineTo(x, y + 2);
    g.lineTo(x - 5, y + 18);
    g.lineTo(x + 9, y - 3);
    g.lineTo(x + 1, y - 3);
    g.closePath();
    g.fill();
}

/** A red and white no-entry sign. */
function noEntry(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#e9e5d8';
        g.fillRect(4, 4, w - 8, h - 8);
        g.fillStyle = '#b3261e';
        g.beginPath();
        g.arc(w / 2, 52, 36, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#f2eee4';
        g.fillRect(w / 2 - 26, 46, 52, 12);
        g.fillStyle = '#1b1b1b';
        g.font = font(16);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('NO ENTRY', w / 2, 107, w - 14);
        weather(g, w, h, random);
    });
}

/** A door plate: white letters on a coloured ground. */
function plate(g, rect, text, ground, ink, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = ground;
        g.fillRect(3, 3, w - 6, h - 6);
        g.strokeStyle = ink;
        g.lineWidth = 2;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = ink;
        g.font = font(32);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 1, w - 30);
        weather(g, w, h, random, 0.8);
    });
}

/**
 * Tape round a pipe: a band of colour with what's in it written along it, and an arrow for which way it flows. It's
 * seen wrapped round the pipe (about twice as long as it looks across), so the writing is drawn narrow.
 */
function pipeTape(g, rect, text, band, ink, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = band;
        g.fillRect(0, 0, w, h);
        g.fillStyle = ink;
        g.save();
        g.scale(0.5, 1);
        g.font = font(40);
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(text, 20, h / 2 + 2, w * 2 - 150);
        g.restore();
        // The arrow.
        g.beginPath();
        g.moveTo(w - 12, h / 2);
        g.lineTo(w - 34, h / 2 - 20);
        g.lineTo(w - 34, h / 2 - 8);
        g.lineTo(w - 62, h / 2 - 8);
        g.lineTo(w - 62, h / 2 + 8);
        g.lineTo(w - 34, h / 2 + 8);
        g.lineTo(w - 34, h / 2 + 20);
        g.closePath();
        g.fill();
        weather(g, w, h, random, 0.9);
    });
}

/**
 * A streak running down a wall from where something drips, in white (the material colours it): narrow where it
 * starts, spreading and branching as it runs, darker at the foot where it's pooled.
 */
function streak(g, rect, random, strength) {
    within(g, rect, (w, h) => {
        const image = g.createImageData(w, h);
        const columns = [];
        const count = 3 + Math.floor(random() * 4);
        for (let n = 0; n < count; n++) columns.push({ x: w / 2 + (random() - 0.5) * w * 0.3, width: 6 + random() * 9, reach: 0.45 + random() * 0.55, drift: (random() - 0.5) * 0.15 });
        for (let y = 0; y < h; y++) {
            const t = y / h;
            for (let x = 0; x < w; x++) {
                let a = 0;
                // The wet bloom at the top where it comes out.
                const top = Math.exp(-(((x - w / 2) / (w * 0.14)) ** 2) - ((t / 0.08) ** 2));
                a = Math.max(a, top * 0.9);
                for (const c of columns) {
                    if (t > c.reach) continue;
                    const cx = c.x + c.drift * y + Math.sin(y * 0.05 + c.x) * 2;
                    const d = Math.abs(x - cx) / (c.width * (0.5 + t * 1.2));
                    const fade = 1 - (t / c.reach) ** 3;
                    a = Math.max(a, Math.exp(-d * d) * fade);
                }
                // Spread out along the foot.
                const foot = Math.exp(-(((x - w / 2) / (w * 0.42)) ** 2)) * Math.max(0, (t - 0.9) / 0.1);
                a = Math.max(a, foot * 0.7);
                const i = (y * w + x) * 4;
                image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
                image.data[i + 3] = Math.round(255 * Math.min(1, a * strength));
            }
        }
        g.putImageData(image, rect[0], rect[1]);
    });
}

/** A puddle, in white with a soft, uneven edge (the material colours it and makes it shine). */
function puddle(g, rect, random) {
    within(g, rect, (w, h) => {
        const image = g.createImageData(w, h);
        const lobes = [];
        for (let n = 0; n < 5; n++) lobes.push([w / 2 + (random() - 0.5) * w * 0.4, h / 2 + (random() - 0.5) * h * 0.4, w * (0.12 + random() * 0.16)]);
        const waves = [random() * 6, random() * 6, random() * 6];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let field = 0;
                for (const [lx, ly, r] of lobes) field += Math.exp(-(((x - lx) ** 2 + (y - ly) ** 2) / (r * r)));
                const angle = Math.atan2(y - h / 2, x - w / 2);
                field *= 1 + 0.12 * Math.sin(angle * 3 + waves[0]) + 0.08 * Math.sin(angle * 7 + waves[1]);
                const a = Math.min(1, Math.max(0, (field - 0.5) * 3));
                const i = (y * w + x) * 4;
                image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
                image.data[i + 3] = Math.round(255 * a);
            }
        }
        g.putImageData(image, rect[0], rect[1]);
    });
}

/** A steel door, in pale grey for the vertex colour to paint: its panels, kick plate, rivets and wear. */
function door(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#d8d8d4';
        g.fillRect(0, 0, w, h);
        // Pressed panels.
        g.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        g.lineWidth = 3;
        g.strokeRect(24, 30, w - 48, h * 0.38);
        g.strokeRect(24, 40 + h * 0.4, w - 48, h * 0.34);
        g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        g.lineWidth = 2;
        g.strokeRect(27, 33, w - 54, h * 0.38 - 6);
        // The kick plate, scuffed.
        g.fillStyle = '#9a9c9a';
        g.fillRect(8, h - 52, w - 16, 44);
        for (let n = 0; n < 40; n++) {
            g.fillStyle = `rgba(40, 40, 40, ${0.1 + random() * 0.3})`;
            g.fillRect(8 + random() * (w - 20), h - 50 + random() * 40, 2 + random() * 14, 1);
        }
        // Rivets down the hinge side.
        g.fillStyle = 'rgba(0, 0, 0, 0.35)';
        for (let y = 20; y < h - 60; y += 36) {
            g.beginPath();
            g.arc(10, y, 2.5, 0, Math.PI * 2);
            g.fill();
        }
        // Dirt: grimy round the handle and along the foot, rust coming through.
        const handle = g.createRadialGradient(w - 30, h * 0.53, 2, w - 30, h * 0.53, 40);
        handle.addColorStop(0, 'rgba(30, 25, 20, 0.45)');
        handle.addColorStop(1, 'rgba(30, 25, 20, 0)');
        g.fillStyle = handle;
        g.fillRect(0, 0, w, h);
        const foot = g.createLinearGradient(0, h - 90, 0, h);
        foot.addColorStop(0, 'rgba(40, 30, 20, 0)');
        foot.addColorStop(1, 'rgba(40, 30, 20, 0.6)');
        g.fillStyle = foot;
        g.fillRect(0, h - 90, w, 90);
        for (let n = 0; n < 30; n++) {
            g.fillStyle = `rgba(${90 + random() * 40}, ${45 + random() * 20}, 20, ${0.15 + random() * 0.4})`;
            const x = random() * w;
            const y = random() * h;
            g.fillRect(x, y, 1 + random() * 3, 3 + random() * 30);
        }
        weather(g, w, h, random, 0.6);
    });
}

/** An electrical cabinet's front, pale for the vertex colour: its door, louvres, a label and a warning sticker. */
function cabinetFront(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#d4d4d0';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        g.lineWidth = 3;
        g.strokeRect(10, 10, w - 20, h - 20);
        g.fillStyle = 'rgba(0, 0, 0, 0.45)';
        for (let y = h - 90; y < h - 30; y += 9) g.fillRect(40, y, w - 80, 4);
        // The label plate and the sticker.
        g.fillStyle = '#efece0';
        g.fillRect(w / 2 - 50, 80, 100, 26);
        g.fillStyle = '#1b1b1b';
        g.font = font(16);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`DB-${2 + Math.floor(random() * 30)}`, w / 2, 94);
        g.beginPath();
        g.moveTo(w / 2, 130);
        g.lineTo(w / 2 + 26, 174);
        g.lineTo(w / 2 - 26, 174);
        g.closePath();
        g.fillStyle = '#e3b21c';
        g.fill();
        g.strokeStyle = '#1b1b1b';
        g.lineWidth = 3;
        g.stroke();
        bolt(g, w / 2, 158);
        // The handle.
        g.fillStyle = '#3a3a3a';
        g.fillRect(w - 34, h / 2 - 20, 10, 40);
        weather(g, w, h, random, 0.7);
    });
}

/** A square grate in the floor: steel bars over the dark, rusted at the edges. */
function grate(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#060504';
        g.fillRect(8, 8, w - 16, h - 16);
        g.fillStyle = '#7d7f7c';
        g.fillRect(0, 0, w, 10);
        g.fillRect(0, h - 10, w, 10);
        g.fillRect(0, 0, 10, h);
        g.fillRect(w - 10, 0, 10, h);
        for (let x = 22; x < w - 10; x += 18) g.fillRect(x, 8, 7, h - 16);
        g.fillRect(8, h / 2 - 4, w - 16, 8);
        for (let n = 0; n < 120; n++) {
            g.fillStyle = `rgba(${100 + random() * 50}, ${50 + random() * 20}, 20, ${0.2 + random() * 0.5})`;
            g.beginPath();
            g.arc(random() * w, random() * h, 1 + random() * 5, 0, Math.PI * 2);
            g.fill();
        }
    });
}

// ---------------------------------------------------------------------------------------------- props

/**
 * Level 2's pictures in the props texture (see props.js): the labels round a row of tins, and the spines of box files.
 * @param {CanvasRenderingContext2D} g
 * @param {Record<string, number[]>} atlas
 */
export function drawPipeDreamsProps(g, atlas) {
    const random = mulberry32(0x2d0b);
    {
        const [x0, y0, x1, y1] = atlas.tins;
        const colors = ['#b3261e', '#2b4f86', '#d8a520', '#3d7a45', '#e9e5d8'];
        const w = x1 - x0;
        g.fillStyle = colors[0];
        g.fillRect(x0, y0, w, y1 - y0);
        for (let n = 0; n < 6; n++) {
            g.fillStyle = colors[Math.floor(random() * colors.length)];
            g.fillRect(x0, y0 + n * 10 + random() * 4, w, 3 + random() * 8);
        }
        g.fillStyle = '#efece0';
        g.fillRect(x0 + w * 0.3, y0 + 20, w * 0.4, 22);
        g.fillStyle = '#1b1b1b';
        for (let n = 0; n < 3; n++) g.fillRect(x0 + w * 0.33, y0 + 24 + n * 6, w * (0.2 + random() * 0.12), 2);
    }
    {
        const [x0, y0, x1, y1] = atlas.spines;
        g.fillStyle = '#cfcac0';
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.fillStyle = '#f4f1e8';
        g.fillRect(x0 + 30, y0 + 8, x1 - x0 - 60, 24);
        g.fillStyle = '#1b1b1b';
        for (let n = 0; n < 3; n++) g.fillRect(x0 + 36, y0 + 13 + n * 6, 30 + random() * 20, 2);
        g.fillStyle = 'rgba(0, 0, 0, 0.55)';
        g.beginPath();
        g.arc((x0 + x1) / 2, y0 + 48, 7, 0, Math.PI * 2);
        g.fill();
    }
}
