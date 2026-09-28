import { CanvasTexture } from 'three';
import { CHUNK_SIZE } from '../config.js';
import { GLYPHS, GLYPH_CELL, drawGlyphs, glyphRect, repeating, speckle, tiledNoise, toCanvas } from './levelOneTextures.js';
import { mulberry32 } from './random.js';

/*
 * Level 2 canvas textures, drawn at load like Level 1's. The concrete grain is neutral gray so the shaders can
 * tint it and turn it into brick or block (see pipeDreamsShading.js). The paint atlas has signs, pipe tape, goo
 * streaks and puddles, door, cabinet, grate, and Level 1's stencil letters (copied in so tunnel names draw with the
 * rest of the paint). Fixed seeds, so it's the same every load.
 */

/** Paint atlas size and each image's rect, in pixels. */
export const PAINT_ATLAS_SIZE = 1024;
// Text and the flow arrow use separate UV panels, so reversing flow never mirrors the lettering.
export const PIPE_LABEL_ARROW_START = 184 / 256;
export const PAINT_ATLAS = {
    danger: [0, 0, 128, 128],
    steam: [128, 0, 256, 128],
    noEntry: [256, 0, 384, 128],
    voltage: [384, 0, 512, 128],
    plantRoom: [512, 0, 768, 64],
    store: [512, 64, 768, 128],
    keepOut: [768, 0, 1024, 64],
    boilerHouse: [768, 64, 1024, 128],
    /** pipe tape (see LABELS) */
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
    // Added later into leftover space: below the grate, and from (768, 768) on. Stencils past the 32nd use
    // x 768+, y 640 to 768 (eight at most), so stay clear of that.
    /** maker's plate on a machine */
    plate: [512, 896, 640, 944],
    /** plain white, for paint colored only by vertex color (floor lines) */
    white: [1012, 1012, 1020, 1020],
    /** yellow and black stripes, tile is 2:1 */
    hatch: [768, 768, 896, 832],
    firePoint: [896, 768, 1024, 832],
    noSmoking: [768, 832, 832, 896],
    telephone: [832, 832, 960, 896],
    keepClear: [768, 896, 896, 960],
};

/** Pipe tape: [text, tape color, text color]. */
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
 * Atlas rect [x0, y0, x1, y1] (pixels) of stencil letter `c` (see GLYPHS in levelOneTextures.js). The first 32 are
 * two rows under the tape, the rest go beside the grate.
 * @param {string} c
 */
export function stencilRect(c) {
    const k = Math.max(0, GLYPHS.indexOf(c));
    const [x, y] = k < 32 ? [(k % 16) * GLYPH_CELL, 256 + Math.floor(k / 16) * GLYPH_CELL] : [768 + ((k - 32) % 4) * GLYPH_CELL, 640 + Math.floor((k - 32) / 4) * GLYPH_CELL];
    return [x, y, x + GLYPH_CELL, y + GLYPH_CELL];
}

/**
 * @typedef {object} PipeDreamsTextures
 * @property {CanvasTexture} walls Concrete grain, repeats every 1 × 1 unit.
 * @property {CanvasTexture} floor
 * @property {CanvasTexture} ceiling
 * @property {CanvasTexture} paint Paint atlas.
 */

/**
 * @param {number} maxAnisotropy
 * @returns {PipeDreamsTextures}
 */
export function createPipeDreamsTextures(maxAnisotropy) {
    const walls = repeating(drawGrain(512, 0x2d01, 130), maxAnisotropy, 1, 1);
    // Floor and ceiling are one plane per chunk with UVs 0..1 across it.
    const floor = repeating(drawGrain(512, 0x2d02, 120, true), maxAnisotropy, CHUNK_SIZE, CHUNK_SIZE);
    const ceiling = repeating(drawGrain(256, 0x2d03, 120), maxAnisotropy, CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const paint = new CanvasTexture(drawPaintAtlas());
    paint.anisotropy = Math.min(8, maxAnisotropy);
    return { walls, floor, ceiling, paint };
}

/** Mottled, pitted, cracked concrete in neutral gray around `level`. The floor version is smoother and grittier. */
function drawGrain(size, seed, level, floor = false) {
    const random = mulberry32(seed);
    const broad = tiledNoise(size, random, 4, 5, 0.55);
    const fine = tiledNoise(size, random, 64, 3, 0.6);
    const grey = new Float32Array(size * size);
    for (let i = 0; i < grey.length; i++) grey[i] = level + (broad[i] - 0.5) * 70 + (fine[i] - 0.5) * (floor ? 30 : 46);
    speckle(grey, size, random, floor ? 1400 : 900, size / 340, floor ? 22 : 26);
    speckle(grey, size, random, 90, size / 120, 14);
    // a few wandering hairline cracks
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
    // Later additions use their own seed so the images above don't change.
    const later = mulberry32(0x2d0b);
    makersPlate(g, PAINT_ATLAS.plate, later);
    g.fillStyle = '#ffffff';
    g.fillRect(1008, 1008, 16, 16);
    hatching(g, PAINT_ATLAS.hatch, later);
    plate(g, PAINT_ATLAS.firePoint, 'FIRE POINT', '#a3221b', '#f2eee4', later);
    noSmoking(g, PAINT_ATLAS.noSmoking, later);
    plate(g, PAINT_ATLAS.telephone, 'TELEPHONE', '#24402c', '#e8e4d6', later);
    plate(g, PAINT_ATLAS.keepClear, 'KEEP CLEAR', '#d8a520', '#161616', later);
    return canvas;
}

/** Worn yellow and black floor stripes at 45 degrees. Tiles end to end along its length. */
function hatching(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#d4a21c';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#161616';
        const band = w / 4;
        for (let k = -2; k < 5; k++) {
            g.beginPath();
            g.moveTo(k * band, h);
            g.lineTo(k * band + band / 2, h);
            g.lineTo(k * band + band / 2 + h, 0);
            g.lineTo(k * band + h, 0);
            g.closePath();
            g.fill();
        }
        // scuffs showing concrete through
        g.save();
        g.globalCompositeOperation = 'source-atop';
        for (let n = 0; n < 260; n++) {
            g.fillStyle = `rgba(${90 + random() * 30}, ${86 + random() * 30}, ${78 + random() * 25}, ${0.3 + random() * 0.5})`;
            g.beginPath();
            g.arc(random() * w, random() * h, 0.5 + random() * 3.5, 0, Math.PI * 2);
            g.fill();
        }
        g.restore();
    });
}

/** No smoking sign. */
function noSmoking(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#ebe7da';
        g.fillRect(2, 2, w - 4, h - 4);
        g.fillStyle = '#1b1b1b';
        g.fillRect(w * 0.22, h * 0.47, w * 0.44, h * 0.09);
        g.fillStyle = '#b3261e';
        g.fillRect(w * 0.66, h * 0.47, w * 0.1, h * 0.09);
        g.strokeStyle = '#b3261e';
        g.lineWidth = 6;
        g.beginPath();
        g.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(w / 2 - w * 0.25, h / 2 - h * 0.25);
        g.lineTo(w / 2 + w * 0.25, h / 2 + h * 0.25);
        g.stroke();
        weather(g, w, h, random, 0.5);
    });
}

/** Riveted aluminum maker's plate with maker name, serial and pressure rating. */
function makersPlate(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#a9aca6';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(30, 30, 30, 0.6)';
        g.lineWidth = 2;
        g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = '#2a2a28';
        for (const [x, y] of [[8, 8], [w - 8, 8], [8, h - 8], [w - 8, h - 8]]) {
            g.beginPath();
            g.arc(x, y, 2.5, 0, Math.PI * 2);
            g.fill();
        }
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fittedText(g, 'HALLAM & CO. LTD', w / 2, 15, 11, w - 24);
        g.font = font(9, 'normal');
        g.fillText(`No. ${1000 + Math.floor(random() * 8999)}   W.P. ${[80, 100, 150, 200][Math.floor(random() * 4)]} PSI`, w / 2, 30);
        weather(g, w, h, random, 0.6);
    });
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

/** Wear over a sign: grime at the edges, rust spots, and chipped specks. */
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

/** Shrinks the font size to fit instead of squeezing the letters. */
function fittedText(g, text, x, y, size, width) {
    g.font = font(size);
    const measured = g.measureText(text).width;
    if (measured > width) g.font = font(size * width / measured);
    g.fillText(text, x, y);
}

/** Warning sign: heading, yellow triangle with a symbol, and text. */
function hazard(g, rect, text, symbol, random, heading = 'DANGER') {
    within(g, rect, (w, h) => {
        g.fillStyle = '#e9e5d8';
        g.fillRect(4, 4, w - 8, h - 8);
        g.fillStyle = '#1b1b1b';
        g.font = font(17);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(heading, w / 2, 17, w - 16);
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
        // corner screws
        for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) {
            g.fillStyle = '#6d6a64';
            g.beginPath();
            g.arc(x, y, 2.4, 0, Math.PI * 2);
            g.fill();
        }
        weather(g, w, h, random);
    });
}

/** Hot surface symbol: three wavy lines over a bar. */
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

/** Door plate: text on a colored background. */
function plate(g, rect, text, ground, ink, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = ground;
        g.fillRect(3, 3, w - 6, h - 6);
        g.strokeStyle = ink;
        g.lineWidth = 2;
        g.strokeRect(8, 8, w - 16, h - 16);
        g.fillStyle = ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fittedText(g, text, w / 2, h / 2 + 1, 32, w - 34);
        weather(g, w, h, random, 0.8);
    });
}

/** Pipe tape. Text runs along the pipe, the short edge wraps around it. */
function pipeTape(g, rect, text, band, ink, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = band;
        g.fillRect(0, 0, w, h);
        g.fillStyle = ink;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        fittedText(g, text, 10, h / 2 + 1, 26, w * PIPE_LABEL_ARROW_START - 22);
        // flow arrow
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
 * Drip streak down a wall, white so the material can color it. Narrow at the top, spreading and branching lower
 * down, heavier at the foot where it pools.
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
                // wet spot at the top
                const top = Math.exp(-(((x - w / 2) / (w * 0.14)) ** 2) - ((t / 0.08) ** 2));
                a = Math.max(a, top * 0.9);
                for (const c of columns) {
                    if (t > c.reach) continue;
                    const cx = c.x + c.drift * y + Math.sin(y * 0.05 + c.x) * 2;
                    const d = Math.abs(x - cx) / (c.width * (0.5 + t * 1.2));
                    const fade = 1 - (t / c.reach) ** 3;
                    a = Math.max(a, Math.exp(-d * d) * fade);
                }
                // spread along the foot
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

/** White puddle with a soft uneven edge. The material colors it and makes it shiny. */
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

/** Steel door in pale gray so the vertex color can tint it. Panels, kick plate, rivets and wear. */
function door(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#d8d8d4';
        g.fillRect(0, 0, w, h);
        // pressed panels
        g.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        g.lineWidth = 3;
        g.strokeRect(24, 30, w - 48, h * 0.38);
        g.strokeRect(24, 40 + h * 0.4, w - 48, h * 0.34);
        g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        g.lineWidth = 2;
        g.strokeRect(27, 33, w - 54, h * 0.38 - 6);
        // scuffed kick plate
        g.fillStyle = '#9a9c9a';
        g.fillRect(8, h - 52, w - 16, 44);
        for (let n = 0; n < 40; n++) {
            g.fillStyle = `rgba(40, 40, 40, ${0.1 + random() * 0.3})`;
            g.fillRect(8 + random() * (w - 20), h - 50 + random() * 40, 2 + random() * 14, 1);
        }
        // rivets down the hinge side
        g.fillStyle = 'rgba(0, 0, 0, 0.35)';
        for (let y = 20; y < h - 60; y += 36) {
            g.beginPath();
            g.arc(10, y, 2.5, 0, Math.PI * 2);
            g.fill();
        }
        // grime around the handle and along the bottom, plus rust streaks
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

/** Electrical cabinet front, pale for vertex color tinting. Door, louvers, label and warning sticker. */
function cabinetFront(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#d4d4d0';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        g.lineWidth = 3;
        g.strokeRect(10, 10, w - 20, h - 20);
        g.fillStyle = 'rgba(0, 0, 0, 0.45)';
        for (let y = h - 90; y < h - 30; y += 9) g.fillRect(40, y, w - 80, 4);
        // label plate and sticker
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
        // scaled down so the bolt's lower point clears the triangle border
        g.save();
        g.translate(w / 2, 157);
        g.scale(0.7, 0.7);
        bolt(g, 0, 0);
        g.restore();
        // handle
        g.fillStyle = '#3a3a3a';
        g.fillRect(w - 34, h / 2 - 20, 10, 40);
        weather(g, w, h, random, 0.7);
    });
}

/** Square floor grate: steel bars over black, with rust. */
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
 * Level 2 images in the props texture (see props.js): tin labels and box file spines.
 * @param {CanvasRenderingContext2D} g
 * @param {Record<string, number[]>} atlas
 */
export function drawPipeDreamsProps(g, atlas) {
    within(g, atlas.tins, (w, h) => {
        g.fillStyle = '#b3261e';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#d8a520';
        g.fillRect(0, 7, w, 3);
        g.fillRect(0, h - 10, w, 3);
        g.fillStyle = '#efece0';
        g.fillRect(w * 0.28, 18, w * 0.44, 29);
        g.fillStyle = '#1b1b1b';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fittedText(g, 'SOUP', w / 2, 29, 11, w * 0.36);
        g.font = font(7, 'normal');
        g.fillText('400 g', w / 2, 40);
    });
    within(g, atlas.spines, (w, h) => {
        // The wide atlas slot maps onto a tall narrow spine (about 0.022 × 0.095 units). Draw at the spine's real
        // proportions so the text and finger hole don't get stretched.
        g.scale(w / 24, h / 104);
        g.fillStyle = '#cfcac0';
        g.fillRect(0, 0, 24, 104);
        g.fillStyle = '#f4f1e8';
        g.fillRect(4, 12, 16, 48);
        g.fillStyle = '#1b1b1b';
        g.save();
        g.translate(12, 36);
        g.rotate(-Math.PI / 2);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fittedText(g, 'RECORDS', 0, 0, 7, 41);
        g.restore();
        g.fillStyle = '#838480';
        g.beginPath();
        g.arc(12, 80, 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#262725';
        g.beginPath();
        g.arc(12, 80, 3.4, 0, Math.PI * 2);
        g.fill();
    });
}
