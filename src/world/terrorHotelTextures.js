import { CanvasTexture } from 'three';
import { CHUNK_SIZE } from '../config.js';
import { repeating, speckle, tiledNoise, toCanvas } from './levelOneTextures.js';
import { mulberry32 } from './random.js';

/*
 * Level 5's pictures, drawn with the 2D canvas when the game loads, like Level 1's and Level 2's: the grain of the
 * plaster, the carpet's pile and the ceiling's plaster (neutral greys, for the shaders to paint; see
 * terrorHotelShading.js), and the paint atlas: the figures for the doors' brass plates, the Beverly Room's plaque, the
 * staff doors' signs, the cards hung on door handles, the lifts' doors, the rugs, the key rack behind the reception, and
 * the paintings in the corridors and the rooms, the books' spines, the blackboard with the menu, the band's desks and
 * its drum, and the reception's plate. Everything is drawn from fixed seeds, so it's the same on every load.
 */

/** The paint atlas: its size, and where each picture is, in pixels. */
export const HOTEL_ATLAS_SIZE = 1024;
export const HOTEL_ATLAS = {
    /** Portraits, 192 × 256, and landscapes, 256 × 192. */
    portraits: [[0, 0, 192, 256], [192, 0, 384, 256], [384, 0, 576, 256], [576, 0, 768, 256], [768, 0, 960, 256]],
    landscapes: [[0, 256, 256, 448], [256, 256, 512, 448], [512, 256, 768, 448], [768, 256, 1024, 448]],
    rugs: [[0, 448, 256, 664], [256, 448, 512, 664], [512, 448, 768, 664]],
    liftDoor: [768, 448, 896, 672],
    keys: [896, 448, 1024, 576],
    button: [896, 576, 960, 672],
    beverly: [0, 672, 256, 736],
    staff: [256, 672, 512, 768],
    doNotDisturb: [512, 672, 576, 800],
    makeUp: [576, 672, 640, 800],
    /** The figures 0 to 9 for the doors' plates, 32 × 48 each. */
    digits: /** @type {number[][]} */ ([]),
    black: [960, 576, 976, 592],
    plain: [976, 576, 992, 592],
    /** The books' spines, 32 × 160 each, in their bindings' colours (see HOTEL_BINDINGS). */
    spines: /** @type {number[][]} */ ([]),
    menu: [512, 848, 640, 1024],
    orchestra: [640, 848, 768, 1024],
    drum: [640, 672, 768, 800],
    reception: [320, 800, 704, 832],
};
for (let d = 0; d < 10; d++) HOTEL_ATLAS.digits.push([d * 32, 800, d * 32 + 32, 848]);
for (let k = 0; k < 16; k++) HOTEL_ATLAS.spines.push([k * 32, 856, k * 32 + 32, 1016]);

/** The books' cloth and leather: each spine's (see HOTEL_ATLAS.spines) is the k-th of these, round again. */
export const HOTEL_BINDINGS = [0x5a1612, 0x1e3222, 0x1c2238, 0x6a4a24, 0x2a1a12, 0x3e0e14, 0x4a4a3a, 0x121212];

/** Which portrait is whose (see paintings in terrorHotelGeometry.js). */
export const PORTRAIT_GENTLEMAN = 2;

/**
 * @typedef {object} TerrorHotelTextures
 * @property {CanvasTexture} walls The plaster's grain, 1 × 1 unit, repeating.
 * @property {CanvasTexture} floor The carpet's pile.
 * @property {CanvasTexture} ceiling
 * @property {CanvasTexture} paint The paint atlas.
 */

/**
 * @param {number} maxAnisotropy
 * @returns {TerrorHotelTextures}
 */
export function createTerrorHotelTextures(maxAnisotropy) {
    const walls = repeating(drawGrain(512, 0x5d01, 128, 26, 10), maxAnisotropy, 1, 1);
    // The floor and ceiling are one plane a chunk, textured 0..1 across it.
    const floor = repeating(drawGrain(256, 0x5d02, 128, 40, 60), maxAnisotropy, CHUNK_SIZE * 2, CHUNK_SIZE * 2);
    const ceiling = repeating(drawGrain(256, 0x5d03, 128, 22, 6), maxAnisotropy, CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const paint = new CanvasTexture(drawPaintAtlas());
    paint.anisotropy = Math.min(8, maxAnisotropy);
    return { walls, floor, ceiling, paint };
}

/** Plaster, pile or paper: soft mottling, a fine tooth, and a few specks. A neutral grey round `level`. */
function drawGrain(size, seed, level, fine, specks) {
    const random = mulberry32(seed);
    const broad = tiledNoise(size, random, 4, 4, 0.55);
    const tooth = tiledNoise(size, random, 64, 3, 0.6);
    const grey = new Float32Array(size * size);
    for (let i = 0; i < grey.length; i++) grey[i] = level + (broad[i] - 0.5) * 40 + (tooth[i] - 0.5) * fine;
    speckle(grey, size, random, specks * 10, size / 400, 16);
    return toCanvas(size, grey);
}

// ---------------------------------------------------------------------------------------------- the paint atlas

function drawPaintAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = HOTEL_ATLAS_SIZE;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const random = mulberry32(0x5d0a);
    const [lady, gent, gentleman, faceless, widow] = HOTEL_ATLAS.portraits;
    portrait(g, lady, random, { skin: '#c9a184', hair: '#1c120c', dress: '#2a1016', back: '#2c2418', pearls: true });
    portrait(g, gent, random, { skin: '#c49a7a', hair: '#2a1d14', dress: '#16161a', back: '#1f2420', moustache: true });
    theGentleman(g, gentleman, random);
    portrait(g, faceless, random, { skin: '#b8957c', hair: '#3a2a1c', dress: '#23262c', back: '#2a2016', scratched: true });
    portrait(g, widow, random, { skin: '#b89a86', hair: '#8a8278', dress: '#0e0d0e', back: '#262018', veil: true });
    const [sea, exterior, forest, flowers] = HOTEL_ATLAS.landscapes;
    nightSea(g, sea, random);
    hotelAtNight(g, exterior, random);
    forestPath(g, forest, random);
    stillLife(g, flowers, random);
    HOTEL_ATLAS.rugs.forEach((rect, k) => rug(g, rect, k, random));
    liftDoor(g, HOTEL_ATLAS.liftDoor);
    keyRack(g, HOTEL_ATLAS.keys, random);
    callButton(g, HOTEL_ATLAS.button);
    plaque(g, HOTEL_ATLAS.beverly, ['THE BEVERLY ROOM'], '#b9b6ad', '#1c1a18', 30);
    plaque(g, HOTEL_ATLAS.staff, ['STAFF ONLY', 'PERSONNEL SEULEMENT', 'NUR PERSONAL', 'SOLO PERSONAL'], '#e9e2cf', '#2a1510', 20);
    hanger(g, HOTEL_ATLAS.doNotDisturb, ['DO', 'NOT', 'DISTURB'], '#6e1616', '#e9dfc4');
    hanger(g, HOTEL_ATLAS.makeUp, ['PLEASE', 'MAKE UP', 'ROOM'], '#e9dfc4', '#3a2a1a');
    for (let d = 0; d < 10; d++) figure(g, HOTEL_ATLAS.digits[d], String(d));
    fill(g, HOTEL_ATLAS.black, '#000000');
    fill(g, HOTEL_ATLAS.plain, '#ffffff');
    const more = mulberry32(0x5d0b);
    HOTEL_ATLAS.spines.forEach((rect, k) => spine(g, rect, HOTEL_BINDINGS[k % HOTEL_BINDINGS.length], k, more));
    menu(g, HOTEL_ATLAS.menu, more);
    orchestra(g, HOTEL_ATLAS.orchestra);
    drumHead(g, HOTEL_ATLAS.drum);
    plaque(g, HOTEL_ATLAS.reception, ['RECEPTION'], '#b8903a', '#2a1a08', 24);
    return canvas;
}

function fill(g, [x0, y0, x1, y1], color) {
    g.fillStyle = color;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** Draws inside a rectangle only, with the origin at its top left. */
function within(g, [x0, y0, x1, y1], draw) {
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    g.translate(x0, y0);
    draw(x1 - x0, y1 - y0);
    g.restore();
}

/** Shrink the type as a whole when a label is narrow, keeping the letterforms in proportion. */
function fittedText(g, text, x, y, width, size, height = Infinity, bold = false) {
    const font = (px) => `${bold ? 'bold ' : ''}${px}px Georgia, "Times New Roman", serif`;
    g.font = font(size);
    const measured = g.measureText(text);
    const scale = Math.min(1, width / measured.width, height / (measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent));
    if (scale < 1) g.font = font(size * scale);
    g.fillText(text, x, y);
}

/** Old varnish over a painting: yellowed, darker at the edges, cracked all over. */
function varnish(g, w, h, random) {
    const glaze = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    glaze.addColorStop(0, 'rgba(120, 90, 30, 0.08)');
    glaze.addColorStop(1, 'rgba(20, 12, 4, 0.55)');
    g.fillStyle = glaze;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(10, 6, 2, 0.28)';
    g.lineWidth = 0.6;
    for (let n = 0; n < 90; n++) {
        let x = random() * w;
        let y = random() * h;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
            x += (random() - 0.5) * 16;
            y += (random() - 0.5) * 16;
            g.lineTo(x, y);
        }
        g.stroke();
    }
    // Brushwork: short strokes of lighter and darker all over.
    for (let n = 0; n < 500; n++) {
        g.fillStyle = random() < 0.5 ? 'rgba(255, 240, 210, 0.025)' : 'rgba(0, 0, 0, 0.03)';
        g.fillRect(random() * w, random() * h, 2 + random() * 6, 1 + random() * 2);
    }
}

/**
 * A head-and-shoulders portrait on a dark ground: the shoulders and the dress, the neck, the face (lit from the left),
 * the hair; the eyes dark, looking straight out.
 */
function portrait(g, rect, random, { skin, hair, dress, back, pearls = false, moustache = false, scratched = false, veil = false }) {
    within(g, rect, (w, h) => {
        const ground = g.createRadialGradient(w * 0.4, h * 0.35, 10, w / 2, h / 2, h * 0.8);
        ground.addColorStop(0, back);
        ground.addColorStop(1, '#0a0806');
        g.fillStyle = ground;
        g.fillRect(0, 0, w, h);
        const cx = w / 2;
        const headY = h * 0.38;
        // Shoulders.
        g.fillStyle = dress;
        g.beginPath();
        g.moveTo(cx - w * 0.48, h);
        g.bezierCurveTo(cx - w * 0.46, h * 0.72, cx - w * 0.24, h * 0.64, cx, h * 0.63);
        g.bezierCurveTo(cx + w * 0.24, h * 0.64, cx + w * 0.46, h * 0.72, cx + w * 0.48, h);
        g.fill();
        // Neck.
        g.fillStyle = shade(skin, -0.25);
        g.fillRect(cx - w * 0.07, headY + h * 0.1, w * 0.14, h * 0.18);
        if (pearls) {
            g.fillStyle = '#e8e2d0';
            for (let k = -5; k <= 5; k++) {
                g.beginPath();
                g.arc(cx + k * w * 0.022, h * 0.62 + Math.abs(k) * -1.1 + k * k * 0.25, 2.4, 0, Math.PI * 2);
                g.fill();
            }
        }
        // The head: an oval, lit from the left.
        const face = g.createRadialGradient(cx - w * 0.06, headY - h * 0.03, 4, cx, headY, w * 0.2);
        face.addColorStop(0, shade(skin, 0.15));
        face.addColorStop(0.7, skin);
        face.addColorStop(1, shade(skin, -0.45));
        g.fillStyle = face;
        g.beginPath();
        g.ellipse(cx, headY, w * 0.14, h * 0.13, 0, 0, Math.PI * 2);
        g.fill();
        // Hair: a cap over the top, down the sides (a bob), or a veil.
        g.fillStyle = hair;
        g.beginPath();
        g.ellipse(cx, headY - h * 0.05, w * 0.155, h * 0.1, 0, Math.PI, 0);
        g.fill();
        g.fillRect(cx - w * 0.155, headY - h * 0.05, w * 0.05, h * 0.12);
        g.fillRect(cx + w * 0.105, headY - h * 0.05, w * 0.05, h * 0.12);
        // Eyes, nose, mouth.
        g.fillStyle = '#120a06';
        for (const s of [-1, 1]) {
            g.beginPath();
            g.ellipse(cx + s * w * 0.05, headY - h * 0.005, w * 0.022, h * 0.009, 0, 0, Math.PI * 2);
            g.fill();
        }
        g.fillStyle = 'rgba(40, 18, 10, 0.5)';
        g.fillRect(cx - 1, headY + h * 0.01, 2, h * 0.04);
        g.fillStyle = moustache ? '#24170f' : '#6e2a22';
        g.fillRect(cx - w * 0.04, headY + h * 0.065, w * 0.08, moustache ? h * 0.014 : h * 0.01);
        if (moustache) {
            g.fillStyle = '#e8e2d6';
            g.beginPath();
            g.moveTo(cx - w * 0.08, h * 0.63);
            g.lineTo(cx, h * 0.72);
            g.lineTo(cx + w * 0.08, h * 0.63);
            g.fill();
            g.fillStyle = '#5a1418';
            g.fillRect(cx - w * 0.015, h * 0.64, w * 0.03, h * 0.1);
        }
        if (veil) {
            g.fillStyle = 'rgba(8, 8, 10, 0.72)';
            g.beginPath();
            g.ellipse(cx, headY + h * 0.02, w * 0.2, h * 0.17, 0, Math.PI * 1.05, Math.PI * 1.95, true);
            g.fill();
        }
        if (scratched) {
            // Someone's taken the face out: scratched through the paint to the ground, over and over.
            g.strokeStyle = 'rgba(214, 196, 160, 0.8)';
            for (let n = 0; n < 60; n++) {
                g.lineWidth = 0.6 + random() * 1.4;
                const x = cx + (random() - 0.5) * w * 0.26;
                const y = headY + (random() - 0.5) * h * 0.22;
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x + (random() - 0.5) * 30, y + (random() - 0.5) * 30);
                g.stroke();
            }
        }
        varnish(g, w, h, random);
    });
}

/**
 * The Gentleman: a portrait of a man in evening dress, the head of a cephalopod on his shoulders, its tentacles hanging
 * over his collar, and its eyes pale violet.
 */
function theGentleman(g, rect, random) {
    within(g, rect, (w, h) => {
        const ground = g.createRadialGradient(w * 0.5, h * 0.3, 10, w / 2, h / 2, h * 0.8);
        ground.addColorStop(0, '#2b2030');
        ground.addColorStop(1, '#070508');
        g.fillStyle = ground;
        g.fillRect(0, 0, w, h);
        const cx = w / 2;
        // Evening dress: the jacket, the shirt front, the tie.
        g.fillStyle = '#0c0c10';
        g.beginPath();
        g.moveTo(cx - w * 0.5, h);
        g.bezierCurveTo(cx - w * 0.48, h * 0.7, cx - w * 0.22, h * 0.62, cx, h * 0.61);
        g.bezierCurveTo(cx + w * 0.22, h * 0.62, cx + w * 0.48, h * 0.7, cx + w * 0.5, h);
        g.fill();
        g.fillStyle = '#d8d2c4';
        g.beginPath();
        g.moveTo(cx - w * 0.09, h * 0.62);
        g.lineTo(cx, h * 0.86);
        g.lineTo(cx + w * 0.09, h * 0.62);
        g.fill();
        g.fillStyle = '#1a1030';
        g.beginPath();
        g.moveTo(cx - w * 0.05, h * 0.63);
        g.lineTo(cx + w * 0.05, h * 0.63);
        g.lineTo(cx, h * 0.67);
        g.fill();
        // The mantle, dark blue, swelling up and back.
        const mantle = g.createRadialGradient(cx - w * 0.05, h * 0.22, 5, cx, h * 0.3, w * 0.3);
        mantle.addColorStop(0, '#3a4a78');
        mantle.addColorStop(0.6, '#1c2446');
        mantle.addColorStop(1, '#0a0c1a');
        g.fillStyle = mantle;
        g.beginPath();
        g.ellipse(cx, h * 0.28, w * 0.17, h * 0.2, 0, 0, Math.PI * 2);
        g.fill();
        // The tentacles, hanging down over the collar, curling.
        g.strokeStyle = '#1e2a52';
        g.lineCap = 'round';
        for (let k = 0; k < 7; k++) {
            const x = cx + (k - 3) * w * 0.035;
            g.lineWidth = 6 - Math.abs(k - 3) * 0.8;
            g.beginPath();
            g.moveTo(x, h * 0.4);
            g.bezierCurveTo(x + (random() - 0.5) * 20, h * 0.5, x + (k - 3) * 6, h * 0.58, x + (k - 3) * 9 + (random() - 0.5) * 10, h * 0.66);
            g.stroke();
        }
        // The eyes: pale violet, with a slit.
        for (const s of [-1, 1]) {
            g.fillStyle = '#b8a2e8';
            g.beginPath();
            g.ellipse(cx + s * w * 0.075, h * 0.3, w * 0.03, h * 0.016, s * 0.2, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#100818';
            g.fillRect(cx + s * w * 0.075 - w * 0.02, h * 0.3 - 1, w * 0.04, 2);
        }
        varnish(g, w, h, random);
    });
}

/** A dark sea at night: a lighthouse on a point, its beam, and the moon behind cloud. */
function nightSea(g, rect, random) {
    within(g, rect, (w, h) => {
        const sky = g.createLinearGradient(0, 0, 0, h * 0.6);
        sky.addColorStop(0, '#0d1418');
        sky.addColorStop(1, '#2c3a3a');
        g.fillStyle = sky;
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(220, 210, 170, 0.55)';
        g.beginPath();
        g.arc(w * 0.72, h * 0.2, 12, 0, Math.PI * 2);
        g.fill();
        for (let n = 0; n < 14; n++) {
            g.fillStyle = `rgba(20, 26, 28, ${0.3 + random() * 0.4})`;
            g.beginPath();
            g.ellipse(random() * w, h * (0.1 + random() * 0.3), 20 + random() * 50, 4 + random() * 8, 0, 0, Math.PI * 2);
            g.fill();
        }
        g.fillStyle = '#10181a';
        g.fillRect(0, h * 0.58, w, h);
        for (let n = 0; n < 160; n++) {
            g.fillStyle = `rgba(160, 170, 160, ${random() * 0.12})`;
            g.fillRect(random() * w, h * (0.58 + random() * 0.42), 6 + random() * 18, 1);
        }
        g.fillStyle = '#080a0a';
        g.beginPath();
        g.moveTo(0, h * 0.62);
        g.lineTo(w * 0.28, h * 0.54);
        g.lineTo(w * 0.36, h * 0.62);
        g.lineTo(0, h * 0.7);
        g.fill();
        g.fillStyle = '#d8d0b8';
        g.fillRect(w * 0.2, h * 0.36, 7, h * 0.19);
        g.fillStyle = 'rgba(255, 230, 160, 0.9)';
        g.fillRect(w * 0.2 - 1, h * 0.34, 9, 5);
        g.fillStyle = 'rgba(255, 230, 160, 0.12)';
        g.beginPath();
        g.moveTo(w * 0.21, h * 0.35);
        g.lineTo(w, h * 0.24);
        g.lineTo(w, h * 0.36);
        g.fill();
        varnish(g, w, h, random);
    });
}

/** The hotel itself, at night, seen from its gardens: floor on floor of windows, all lit but one. */
function hotelAtNight(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#0b0c12';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#1a1714';
        g.fillRect(w * 0.12, h * 0.2, w * 0.76, h * 0.62);
        g.fillStyle = '#211d18';
        g.fillRect(w * 0.42, h * 0.1, w * 0.16, h * 0.12);
        const dark = [Math.floor(random() * 8), Math.floor(random() * 6)];
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 8; col++) {
                const lit = !(col === dark[0] && row === dark[1]);
                g.fillStyle = lit ? `rgba(230, 180, 90, ${0.55 + random() * 0.3})` : '#050505';
                g.fillRect(w * 0.16 + col * w * 0.086, h * 0.25 + row * h * 0.09, w * 0.04, h * 0.05);
            }
        }
        g.fillStyle = '#060806';
        for (let n = 0; n < 40; n++) {
            g.beginPath();
            g.arc(random() * w, h * (0.82 + random() * 0.2), 10 + random() * 16, 0, Math.PI * 2);
            g.fill();
        }
        varnish(g, w, h, random);
    });
}

/** A path into a forest at dusk, the trees closing over it. */
function forestPath(g, rect, random) {
    within(g, rect, (w, h) => {
        const sky = g.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#3a3024');
        sky.addColorStop(1, '#0c0e08');
        g.fillStyle = sky;
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#4a3c26';
        g.beginPath();
        g.moveTo(w * 0.42, h * 0.6);
        g.lineTo(w * 0.58, h * 0.6);
        g.lineTo(w * 0.8, h);
        g.lineTo(w * 0.2, h);
        g.fill();
        for (let n = 0; n < 26; n++) {
            const x = random() * w;
            const tw = 4 + random() * 12;
            g.fillStyle = `rgb(${14 + random() * 12}, ${14 + random() * 10}, ${8 + random() * 6})`;
            g.fillRect(x, 0, tw, h * (0.7 + random() * 0.3));
            g.beginPath();
            g.arc(x + tw / 2, h * 0.15, 20 + random() * 30, 0, Math.PI * 2);
            g.fill();
        }
        // Something standing far down the path.
        g.fillStyle = '#060606';
        g.fillRect(w * 0.495, h * 0.54, 3, 12);
        varnish(g, w, h, random);
    });
}

/** Flowers in a vase on a dark ground, going over: petals fallen on the table. */
function stillLife(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#16120c';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#2a1e12';
        g.fillRect(0, h * 0.72, w, h);
        g.fillStyle = '#6e7a78';
        g.beginPath();
        g.ellipse(w / 2, h * 0.6, w * 0.08, h * 0.14, 0, 0, Math.PI * 2);
        g.fill();
        for (let n = 0; n < 18; n++) {
            const a = -Math.PI / 2 + (random() - 0.5) * 2.2;
            const r = h * (0.18 + random() * 0.14);
            const x = w / 2 + Math.cos(a) * r;
            const y = h * 0.48 + Math.sin(a) * r;
            g.strokeStyle = '#2a3a1c';
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(w / 2, h * 0.5);
            g.lineTo(x, y);
            g.stroke();
            g.fillStyle = ['#8a2a28', '#b89a70', '#6e1c24', '#c8b8a0'][Math.floor(random() * 4)];
            g.beginPath();
            g.arc(x, y + (a > 0 ? 8 : 0), 6 + random() * 7, 0, Math.PI * 2);
            g.fill();
        }
        for (let n = 0; n < 7; n++) {
            g.fillStyle = '#6e1c24';
            g.beginPath();
            g.ellipse(w * (0.3 + random() * 0.5), h * (0.76 + random() * 0.08), 4, 2, random(), 0, Math.PI * 2);
            g.fill();
        }
        varnish(g, w, h, random);
    });
}

/** A rug: a border of bands, a field of small figures, a medallion in the middle; its fringe at the ends. */
function rug(g, rect, k, random) {
    const palettes = [
        ['#5a1414', '#1c1a3a', '#c8a060', '#e0d0a8', '#2a0c0c'],
        ['#1c2a3a', '#6e1a18', '#d0b070', '#e8dcc0', '#0e141e'],
        ['#6a3a14', '#2a3a24', '#d8b878', '#efe2c4', '#2a160a'],
    ];
    const [field, border, gold, ivory, dark] = palettes[k];
    within(g, rect, (w, h) => {
        const fringe = 8;
        g.fillStyle = ivory;
        g.fillRect(0, 0, w, h);
        g.clearRect(0, 0, fringe, h);
        g.clearRect(w - fringe, 0, fringe, h);
        g.fillStyle = '#e8e0cc';
        for (let y = 2; y < h; y += 4) {
            g.fillRect(0, y, fringe, 1.5);
            g.fillRect(w - fringe, y, fringe, 1.5);
        }
        const inner = [fringe, 0, w - 2 * fringe, h];
        const bands = [[0, dark], [5, border], [18, gold], [21, border], [30, dark]];
        for (const [inset, color] of bands) {
            g.fillStyle = color;
            g.fillRect(inner[0] + inset, inner[1] + inset, inner[2] - 2 * inset, inner[3] - 2 * inset);
        }
        // Small figures round the border band.
        g.fillStyle = gold;
        for (let x = inner[0] + 10; x < inner[0] + inner[2] - 10; x += 10) {
            g.fillRect(x, 10, 4, 4);
            g.fillRect(x, h - 14, 4, 4);
        }
        for (let y = 10; y < h - 10; y += 10) {
            g.fillRect(inner[0] + 10, y, 4, 4);
            g.fillRect(inner[0] + inner[2] - 14, y, 4, 4);
        }
        g.fillStyle = field;
        g.fillRect(inner[0] + 34, 34, inner[2] - 68, h - 68);
        // The field: a lattice of small diamonds.
        for (let y = 40; y < h - 40; y += 12) {
            for (let x = inner[0] + 40 + ((y / 12) % 2) * 6; x < inner[0] + inner[2] - 40; x += 12) {
                g.fillStyle = random() < 0.5 ? gold : border;
                g.beginPath();
                g.moveTo(x, y - 3);
                g.lineTo(x + 3, y);
                g.lineTo(x, y + 3);
                g.lineTo(x - 3, y);
                g.fill();
            }
        }
        // The medallion.
        const cx = w / 2;
        const cy = h / 2;
        for (const [r, color] of [[46, dark], [42, border], [36, gold], [30, field], [18, ivory], [12, border], [5, gold]]) {
            g.fillStyle = color;
            g.beginPath();
            for (let a = 0; a < 16; a++) {
                const angle = (a / 16) * Math.PI * 2;
                const rr = r * (a % 2 === 0 ? 1 : 0.8) * 1.25;
                g.lineTo(cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr * 0.72);
            }
            g.fill();
        }
        // Worn.
        for (let n = 0; n < 400; n++) {
            g.fillStyle = `rgba(0, 0, 0, ${random() * 0.12})`;
            g.fillRect(fringe + random() * (w - 2 * fringe), random() * h, 3, 2);
        }
    });
}

/** One leaf of a lift's doors: brass, a sunburst over chevrons, engraved. */
function liftDoor(g, rect) {
    within(g, rect, (w, h) => {
        const brass = g.createLinearGradient(0, 0, w, 0);
        brass.addColorStop(0, '#8a6a30');
        brass.addColorStop(0.5, '#c8a45a');
        brass.addColorStop(1, '#8a6a30');
        g.fillStyle = brass;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#3a2a10';
        g.lineWidth = 2;
        g.strokeRect(6, 6, w - 12, h - 12);
        // The sunburst, from the middle of the doors (this leaf's right edge).
        for (let k = 0; k < 9; k++) {
            const a = Math.PI * 0.5 + (k / 8) * Math.PI * 0.5;
            g.beginPath();
            g.moveTo(w, h * 0.34);
            g.lineTo(w + Math.cos(a) * w * 1.2, h * 0.34 - Math.sin(a) * w * 1.2);
            g.stroke();
        }
        g.beginPath();
        g.arc(w, h * 0.34, w * 0.35, Math.PI, Math.PI * 1.5);
        g.stroke();
        for (let k = 0; k < 6; k++) {
            const y = h * 0.5 + k * h * 0.07;
            g.beginPath();
            g.moveTo(10, y + h * 0.04);
            g.lineTo(w / 2, y);
            g.lineTo(w - 10, y + h * 0.04);
            g.stroke();
        }
    });
}

/** The rack of pigeonholes behind the desk: a key hung under each, on its brass tag, and a few gone. */
function keyRack(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#2a170c';
        g.fillRect(0, 0, w, h);
        const cols = 8;
        const rows = 5;
        const cw = w / cols;
        const ch = h / rows;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                g.fillStyle = '#120904';
                g.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch * 0.55);
                if (random() < 0.3) {
                    g.fillStyle = '#d8d0b8';
                    g.fillRect(c * cw + 4, r * ch + 4, cw - 9, ch * 0.2);
                }
                if (random() < 0.85) {
                    g.fillStyle = '#c8a050';
                    g.fillRect(c * cw + cw / 2 - 1, r * ch + ch * 0.6, 2, ch * 0.18);
                    g.beginPath();
                    g.ellipse(c * cw + cw / 2, r * ch + ch * 0.86, 3, 4, 0, 0, Math.PI * 2);
                    g.fill();
                }
            }
        }
    });
}

/** A lift's call button: a brass plate, one button. */
function callButton(g, rect) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#a88444';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#4a3410';
        g.strokeRect(3, 3, w - 6, h - 6);
        g.fillStyle = '#e8dcc0';
        g.beginPath();
        g.arc(w / 2, h / 2, w * 0.18, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#2a1a08';
        g.beginPath();
        g.moveTo(w / 2, h * 0.2);
        g.lineTo(w / 2 - 6, h * 0.3);
        g.lineTo(w / 2 + 6, h * 0.3);
        g.fill();
    });
}

/** A plaque with its lines on it, engraved in capitals, in a thin frame. */
function plaque(g, rect, lines, ground, ink, size) {
    within(g, rect, (w, h) => {
        g.fillStyle = ground;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = ink;
        g.lineWidth = 2;
        g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const step = (h - 16) / lines.length;
        lines.forEach((line, k) => {
            fittedText(g, line, w / 2, 8 + step * (k + 0.5), w - 24, k === 0 ? size : size * 0.8, step - 2);
        });
    });
}

/** A card to hang on a door handle: a hole at the top, three words. */
function hanger(g, rect, lines, ground, ink) {
    within(g, rect, (w, h) => {
        g.fillStyle = ground;
        g.beginPath();
        g.roundRect(2, 2, w - 4, h - 4, 6);
        g.fill();
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath();
        g.arc(w / 2, 19, 9, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.fillStyle = ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        lines.forEach((line, k) => fittedText(g, line, w / 2, 52 + k * 20, w - 16, 13, 18, true));
    });
}

/**
 * A book's spine in its binding: darker at its edges where it rounds away, gilt bands across it top and bottom (raised
 * ones, on the leather), a label, and a short title in gilt.
 */
function spine(g, rect, binding, k, random) {
    within(g, rect, (w, h) => {
        const hex = `#${binding.toString(16).padStart(6, '0')}`;
        const round = g.createLinearGradient(0, 0, w, 0);
        round.addColorStop(0, shade(hex, -0.45));
        round.addColorStop(0.35, shade(hex, 0.12));
        round.addColorStop(0.6, hex);
        round.addColorStop(1, shade(hex, -0.5));
        g.fillStyle = round;
        g.fillRect(0, 0, w, h);
        const gold = '#c8a45a';
        const raised = k % 3 === 0;
        for (const y of raised ? [0.1, 0.3, 0.5, 0.7, 0.9] : [0.05, 0.08, 0.92, 0.95]) {
            if (raised) {
                g.fillStyle = shade(hex, -0.55);
                g.fillRect(0, y * h - 3, w, 6);
                g.fillStyle = gold;
                g.fillRect(0, y * h - 1, w, 1.5);
            } else {
                g.fillStyle = gold;
                g.fillRect(0, y * h - 1.5, w, 3);
            }
        }
        // The label, and the title on it.
        const labelTop = raised ? 0.33 * h : 0.14 * h;
        const labelColor = k % 4 === 1 ? '#6a1a14' : k % 4 === 2 ? '#1a140e' : null;
        if (labelColor) {
            g.fillStyle = labelColor;
            g.fillRect(4, labelTop, w - 8, h * 0.14);
        }
        g.fillStyle = '#d8b870';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const title = ['POEMS', 'ATLAS', 'ESSAYS', 'VERSE', 'PLAYS', 'TALES', 'FLORA', 'HISTORY'][k % 8];
        fittedText(g, title, w / 2, labelTop + h * 0.045, w - 10, 7);
        fittedText(g, k < 8 ? 'I' : 'II', w / 2, labelTop + h * 0.1, w - 10, 7);
        // Rubbed, and faded.
        for (let n = 0; n < 60; n++) {
            g.fillStyle = `rgba(255, 240, 210, ${random() * 0.08})`;
            g.fillRect(random() * w, random() * h, 2 + random() * 4, 1 + random() * 3);
        }
    });
}

/** A blackboard menu: chalk lettering over the dust left by previous dinners. */
function menu(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#1c201c';
        g.fillRect(0, 0, w, h);
        // Chalk dust, where it was rubbed off.
        for (let n = 0; n < 90; n++) {
            g.fillStyle = `rgba(220, 220, 210, ${random() * 0.07})`;
            g.beginPath();
            g.ellipse(random() * w, random() * h, 6 + random() * 18, 2 + random() * 6, random() * Math.PI, 0, Math.PI * 2);
            g.fill();
        }
        g.fillStyle = 'rgba(236, 234, 224, 0.9)';
        g.strokeStyle = 'rgba(236, 234, 224, 0.85)';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 30px Georgia, "Times New Roman", serif';
        g.fillText('MENU', w / 2, 26);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(w * 0.22, 44);
        g.lineTo(w * 0.78, 46);
        g.stroke();
        const dishes = [
            ['SOUP', '1.50'],
            ['ROAST BEEF', '4.50'],
            ['POACHED FISH', '4.00'],
            ['POTATOES', '0.75'],
            ['APPLE PIE', '1.00'],
            ['COFFEE', '0.50'],
            ['TEA', '0.50'],
        ];
        for (let line = 0; line < dishes.length; line++) {
            const y = 64 + line * 15;
            const [dish, price] = dishes[line];
            g.textAlign = 'left';
            fittedText(g, dish, 12, y, w - 52, 9);
            g.textAlign = 'right';
            fittedText(g, price, w - 12, y, 25, 10);
        }
    });
}

/** The front of a band's desk: black lacquer, a gilt sunburst, a B in a ring, ORCHESTRA along the foot. */
function orchestra(g, rect) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#0e0c0c';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#c8a45a';
        g.fillStyle = '#c8a45a';
        g.lineWidth = 2;
        g.strokeRect(6, 6, w - 12, h - 12);
        const cx = w / 2;
        const cy = h * 0.42;
        for (let k = 0; k <= 12; k++) {
            const a = Math.PI + (k / 12) * Math.PI;
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
            g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54);
            g.stroke();
        }
        g.beginPath();
        g.arc(cx, cy, 22, 0, Math.PI * 2);
        g.stroke();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 28px Georgia, "Times New Roman", serif';
        g.fillText('B', cx, cy + 2);
        for (const y of [h * 0.66, h * 0.86]) g.fillRect(14, y, w - 28, 2);
        g.font = '13px Georgia, "Times New Roman", serif';
        g.fillText('ORCHESTRA', cx, h * 0.76, w - 20);
    });
}

/** The bass drum's head: calfskin, the band's name on it in red, between gilt rules. */
function drumHead(g, rect) {
    within(g, rect, (w, h) => {
        const skin = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.75);
        skin.addColorStop(0, '#e8dcc0');
        skin.addColorStop(1, '#b8a888');
        g.fillStyle = skin;
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#7a1414';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 16px Georgia, "Times New Roman", serif';
        g.fillText('THE', w / 2, h * 0.3);
        g.font = 'bold 22px Georgia, "Times New Roman", serif';
        g.fillText('BEVERLY', w / 2, h * 0.5, w - 10);
        g.font = 'bold 13px Georgia, "Times New Roman", serif';
        g.fillText('ORCHESTRA', w / 2, h * 0.7, w - 14);
        g.fillStyle = '#a8843c';
        g.fillRect(12, h * 0.39, w - 24, 2);
        g.fillRect(12, h * 0.6, w - 24, 2);
    });
}

/** One of the figures on a door's plate, engraved black. */
function figure(g, rect, text) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#140c04';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `bold ${h * 0.9}px Georgia, "Times New Roman", serif`;
        g.fillText(text, w / 2, h * 0.55);
    });
}

/** A hex colour made lighter (amount > 0) or darker. */
function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const channel = (c) => Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))));
    return `rgb(${channel(n >> 16)}, ${channel((n >> 8) & 255)}, ${channel(n & 255)})`;
}
