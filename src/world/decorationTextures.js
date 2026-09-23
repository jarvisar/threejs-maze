import { CanvasTexture } from 'three';
import { DECAL_ATLAS_SIZE, DECAL_CELL, DECAL_PICTURES } from './decals.js';
import { PROP_ATLAS, PROP_ATLAS_SIZE } from './props.js';
import { mulberry32 } from './random.js';

/*
 * The pictures for the decals and props, drawn with the 2D canvas when the game loads rather than shipped
 * as image files. Each is drawn to be read at a glance from across a room: a water stain has the brown
 * tide rings every water stain has, wet carpet is dark with a dried edge, and peeled wallpaper shows the
 * bare wall, the white torn edge of the paper and the flap hanging off it with its shadow.
 *
 * Everything is drawn from a fixed random seed, so the pictures are the same on every load.
 */

// Shadows are drawn with the shape itself moved off the canvas, so only the blurred shadow lands on it.
const OFF_CANVAS = 4096;

/**
 * The decals texture: stains, wet patches and peeling wallpaper on a transparent background.
 * @param {number} maxAnisotropy
 */
export function createDecalAtlas(maxAnisotropy) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = DECAL_ATLAS_SIZE;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const random = mulberry32(0x5ea1);

    DECAL_PICTURES.ceilingStain.forEach((picture, k) => inCell(g, picture, () => drawCeilingStain(g, picture, random, k)));
    DECAL_PICTURES.puddle.forEach((picture) => inCell(g, picture, () => drawPuddle(g, picture, random)));
    DECAL_PICTURES.peel.forEach((picture, k) => inCell(g, picture, () => drawPeel(g, picture, random, k)));
    for (const pictures of Object.values(DECAL_PICTURES)) {
        for (const picture of pictures) fillClearPixels(g, picture);
    }

    const texture = new CanvasTexture(canvas);
    // Floors and ceilings are seen at a grazing angle.
    texture.anisotropy = Math.min(8, maxAnisotropy);
    return texture;
}

/** The props texture: the print on the wet-floor sign, a monitor's face, a bottle's label. */
export function createPropAtlas(maxAnisotropy) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PROP_ATLAS_SIZE;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    // Solid white everywhere nothing is drawn, so a part's vertex colour is all that shows.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, PROP_ATLAS_SIZE, PROP_ATLAS_SIZE);
    drawSignFace(g, PROP_ATLAS.sign);
    drawMonitorFace(g, PROP_ATLAS.monitor);
    drawBottleLabel(g, PROP_ATLAS.label);

    const texture = new CanvasTexture(canvas);
    texture.anisotropy = Math.min(4, maxAnisotropy);
    return texture;
}

// ---------------------------------------------------------------------------------------------- decals

/**
 * A water stain on the ceiling tiles: a faint yellow-brown wash with the darker tide marks left by each
 * spread of water as it dried, a little mould in the middle, and speckled like the tiles themselves.
 */
function drawCeilingStain(g, picture, random, k) {
    const cx = picture.x + DECAL_CELL / 2;
    const cy = picture.y + DECAL_CELL / 2;
    const R = DECAL_CELL * (k === 0 ? 0.45 : 0.4);
    const waves = makeWaves(random, k === 0 ? 0.13 : 0.2);
    const outline = blob(cx, cy, R, waves);

    g.save();
    trace(g, outline);
    g.clip();
    const wash = g.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
    wash.addColorStop(0, 'rgba(178,152,98,0.2)');
    wash.addColorStop(0.7, 'rgba(162,126,70,0.33)');
    wash.addColorStop(1, 'rgba(140,98,48,0.52)');
    g.fillStyle = wash;
    g.fillRect(picture.x, picture.y, DECAL_CELL, DECAL_CELL);
    // Blotchy, the way plasterboard soaks unevenly.
    for (let n = 0; n < 70; n++) {
        const a = random() * 2 * Math.PI;
        const d = Math.sqrt(random()) * R * 0.92;
        softDisc(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 8 + random() * 30, `rgba(118,92,52,${0.07 + random() * 0.13})`);
    }
    // Mould, where it stayed damp longest.
    for (let n = 0; n < 45; n++) {
        const a = random() * 2 * Math.PI;
        const d = random() ** 0.7 * R * 0.5;
        disc(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.5 + random() * 3.5, `rgba(56,60,42,${0.25 + random() * 0.35})`);
    }
    speckle(g, cx - R, cy - R, 2 * R, 2 * R, 2600, random, () => `rgba(88,66,36,${0.04 + random() * 0.09})`);
    g.restore();

    // Tide marks, darkest at the outermost, each following the same shape a little smaller.
    const rings = [
        [1, 0.82, 5.5],
        [0.86, 0.5, 3.5],
        [0.7, 0.4, 3],
        [0.54, 0.3, 2.5],
    ];
    for (const [scale, alpha, width] of rings) {
        const ring = blob(cx, cy, R * scale, waves.concat(makeWaves(random, 0.025)));
        shadowed(g, `rgba(102,66,26,${alpha})`, 2.5, (c) => {
            trace(c, ring);
            c.lineWidth = width;
            c.stroke();
        });
        if (scale === 1) {
            // The pale band just inside the outer ring, where the minerals settled.
            const inner = blob(cx, cy, R * 0.955, waves);
            shadowed(g, 'rgba(222,200,150,0.3)', 4, (c) => {
                trace(c, inner);
                c.lineWidth = 6;
                c.stroke();
            });
        }
    }
}

/**
 * Soaked carpet: nearly black where the water sits, softening outwards, with a dirty line where the edge
 * dried, a faint sheen on the wet middle and a few drops around it.
 */
function drawPuddle(g, picture, random) {
    const cx = picture.x + DECAL_CELL / 2;
    const cy = picture.y + DECAL_CELL / 2;
    const R = DECAL_CELL * 0.4;
    const waves = makeWaves(random, 0.2);
    const outline = blob(cx, cy, R, waves);
    shadowed(g, 'rgba(14,11,6,0.72)', 16, (c) => {
        trace(c, outline);
        c.fill();
    });
    const coreX = cx + (random() - 0.5) * 24;
    const coreY = cy + (random() - 0.5) * 24;
    const core = blob(coreX, coreY, R * 0.62, makeWaves(random, 0.25));
    shadowed(g, 'rgba(8,6,3,0.55)', 12, (c) => {
        trace(c, core);
        c.fill();
    });
    const edge = blob(cx, cy, R * 1.03, waves.concat(makeWaves(random, 0.02)));
    shadowed(g, 'rgba(42,27,10,0.6)', 3, (c) => {
        trace(c, edge);
        c.lineWidth = 4;
        c.stroke();
    });
    // What little light there is, reflected off the standing water.
    g.save();
    trace(g, core);
    g.clip();
    const sheen = g.createRadialGradient(coreX - R * 0.22, coreY - R * 0.28, 0, coreX - R * 0.22, coreY - R * 0.28, R * 0.7);
    sheen.addColorStop(0, 'rgba(232,236,226,0.09)');
    sheen.addColorStop(1, 'rgba(232,236,226,0)');
    g.fillStyle = sheen;
    g.fillRect(picture.x, picture.y, DECAL_CELL, DECAL_CELL);
    g.restore();
    for (let n = 0; n < 16; n++) {
        const a = random() * 2 * Math.PI;
        const d = R * (1.06 + random() * 0.28);
        const px = cx + Math.cos(a) * d;
        const py = cy + Math.sin(a) * d;
        shadowed(g, 'rgba(14,11,6,0.5)', 3, (c) => {
            c.beginPath();
            c.arc(px, py, 3 + random() * 6, 0, 2 * Math.PI);
            c.fill();
        });
    }
}

/**
 * Wallpaper peeled away from the top of a wall: the bare, water-marked plasterboard above the tear, the
 * torn edge of the paper still on the wall, and the strip that came away hanging down from the tear, back
 * side out, with its shadow on the wall. The three variants are a wide patch, a narrow strip and a long
 * flap.
 */
function drawPeel(g, picture, random, k) {
    const { x, y, aspect } = picture;
    const width = DECAL_CELL * aspect;
    const left = x + (DECAL_CELL - width) / 2;
    const right = left + width;
    const top = y;
    const margin = 8;
    const tearY = y + DECAL_CELL * [0.46, 0.55, 0.36][k];
    const flapBottom = y + DECAL_CELL * [0.9, 0.93, 0.95][k];
    const flapShift = [0, -6, 22][k] * aspect;

    // The exposed wall: a ragged shape from the ceiling line down to the tear, its sides also torn.
    const tear = jagged(left + margin + width * 0.05, tearY, right - margin - width * 0.04, tearY, 16, width * 0.06, random);
    const leftSide = jagged(left + margin + width * 0.08, top, tear[0][0], tear[0][1], 8, width * 0.035, random);
    const rightSide = jagged(tear[tear.length - 1][0], tear[tear.length - 1][1], right - margin - width * 0.02, top, 8, width * 0.035, random);
    const exposed = [...leftSide, ...tear.slice(1), ...rightSide.slice(1)];

    g.save();
    trace(g, exposed);
    g.clip();
    const plaster = g.createLinearGradient(0, top, 0, tearY);
    plaster.addColorStop(0, '#8a7e6b');
    plaster.addColorStop(0.3, '#b3aa97');
    plaster.addColorStop(1, '#c4bcab');
    g.fillStyle = plaster;
    g.fillRect(left, top, width, tearY - top);
    // Old paste and the dirt under it, in vertical smears.
    for (let n = 0; n < 16; n++) {
        const sx = left + random() * width;
        const sw = 3 + random() * 14;
        shadowed(g, `rgba(52,44,34,${0.08 + random() * 0.14})`, 4, (c) => c.fillRect(sx, top, sw, tearY - top));
    }
    for (let n = 0; n < 9; n++) {
        softDisc(g, left + random() * width, top + random() * (tearY - top), 10 + random() * 26, 'rgba(226,218,200,0.35)');
    }
    // Rust-brown runs from the ceiling.
    for (let n = 0; n < 4; n++) {
        const sx = left + width * (0.15 + random() * 0.7);
        const length = (tearY - top) * (0.3 + random() * 0.7);
        shadowed(g, 'rgba(118,78,38,0.45)', 2, (c) => c.fillRect(sx, top, 2 + random() * 3, length));
    }
    speckle(g, left, top, width, tearY - top, 2400, random, () => (random() < 0.7 ? `rgba(0,0,0,${0.04 + random() * 0.1})` : 'rgba(255,255,255,0.06)'));
    g.restore();

    // The strip hanging off the tear: it narrows as it curls, and its bottom edge rolls.
    const flapTop = tear;
    const inset = width * 0.05;
    const flapLeft = [];
    const flapRight = [];
    const steps = 10;
    const x0L = flapTop[0][0];
    const x0R = flapTop[flapTop.length - 1][0];
    for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const yy = tearY + (flapBottom - tearY) * t;
        const wobble = Math.sin(t * 5 + k) * width * 0.012;
        flapLeft.push([x0L + inset * t + flapShift * t + wobble, yy]);
        flapRight.push([x0R - inset * t + flapShift * t - wobble, yy]);
    }
    const bottom = jagged(flapLeft[steps - 1][0], flapBottom, flapRight[steps - 1][0], flapBottom, 6, 4, random)
        .map(([bx, by], i, all) => [bx, by + Math.sin((i / (all.length - 1)) * Math.PI) * 10]);
    const flap = [...flapTop, ...flapRight, ...bottom.slice(1, -1).reverse(), ...flapLeft.slice().reverse()];

    // Its shadow on the wall, before it: it hangs well clear of the wall, so the shadow shows below it.
    shadowed(g, 'rgba(0,0,0,0.45)', 12, (c) => {
        c.translate(width * 0.05, 20);
        trace(c, flap);
        c.fill();
    });

    // The torn edge of the paper still on the wall: a shadow under the raised edge, then the white core.
    for (const side of [leftSide, rightSide]) {
        shadowed(g, 'rgba(0,0,0,0.4)', 4, (c) => {
            path(c, side);
            c.lineWidth = 8;
            c.stroke();
        });
        g.strokeStyle = 'rgba(248,242,226,0.95)';
        g.lineWidth = 3.5;
        g.lineJoin = 'round';
        path(g, side);
        g.stroke();
    }

    // The flap: the back of the paper, shaded round its curl, the wallpaper's own colour showing where the
    // bottom rolls over.
    g.save();
    trace(g, flap);
    g.clip();
    const paper = g.createLinearGradient(0, tearY, 0, flapBottom + 10);
    paper.addColorStop(0, '#b9b193');
    paper.addColorStop(0.18, '#ebe4cc');
    paper.addColorStop(0.55, '#e4dcc2');
    paper.addColorStop(0.82, '#cfc7a9');
    paper.addColorStop(0.93, '#a39c78');
    paper.addColorStop(1, '#a5a86a');
    g.fillStyle = paper;
    g.fillRect(left - 40, tearY, width + 80, flapBottom - tearY + 20);
    for (let n = 0; n < 26; n++) {
        const fx = flapLeft[0][0] + random() * (flapRight[0][0] - flapLeft[0][0]);
        g.fillStyle = `rgba(120,110,88,${0.05 + random() * 0.09})`;
        g.fillRect(fx, tearY, 1 + random() * 2, flapBottom - tearY);
    }
    // Creases.
    for (let n = 0; n < 3; n++) {
        const cy = tearY + (flapBottom - tearY) * (0.25 + random() * 0.55);
        const slope = (random() - 0.5) * 30;
        g.strokeStyle = 'rgba(255,255,245,0.45)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(left - 10, cy);
        g.lineTo(right + 10, cy + slope);
        g.stroke();
        g.strokeStyle = 'rgba(90,80,60,0.28)';
        g.beginPath();
        g.moveTo(left - 10, cy + 2);
        g.lineTo(right + 10, cy + slope + 2);
        g.stroke();
    }
    speckle(g, left, tearY, width, flapBottom - tearY, 900, random, () => `rgba(90,80,60,${0.03 + random() * 0.05})`);
    g.restore();

    // Its outline, the fold along the tear, and the light catching the rolled bottom edge.
    g.strokeStyle = 'rgba(96,86,66,0.55)';
    g.lineWidth = 1.5;
    trace(g, flap);
    g.stroke();
    g.strokeStyle = 'rgba(60,50,38,0.55)';
    g.lineWidth = 2.5;
    path(g, tear);
    g.stroke();
    g.strokeStyle = 'rgba(255,252,238,0.55)';
    g.lineWidth = 2;
    path(g, bottom.map(([bx, by]) => [bx, by - 2]));
    g.stroke();
}

// ---------------------------------------------------------------------------------------------- props

/** The print on a wet-floor sign: CAUTION, the slipping figure, WET FLOOR. */
function drawSignFace(g, [x0, y0, x1, y1]) {
    const w = x1 - x0;
    const h = y1 - y0;
    g.fillStyle = '#f2c41c';
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = '#111111';
    g.lineWidth = 7;
    g.strokeRect(x0 + 12, y0 + 12, w - 24, h - 24);

    g.fillStyle = '#111111';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 44px "Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif';
    g.fillText('CAUTION', x0 + w / 2, y0 + 56);
    g.font = 'bold 38px "Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif';
    g.fillText('WET FLOOR', x0 + w / 2, y0 + h - 44);

    // Someone losing their footing.
    g.strokeStyle = '#111111';
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    g.beginPath();
    g.arc(cx - 16, cy - 40, 12, 0, 2 * Math.PI); // head
    g.fill();
    g.beginPath();
    g.moveTo(cx - 8, cy - 26); // torso, leaning back
    g.lineTo(cx + 12, cy + 12);
    g.moveTo(cx - 2, cy - 14); // arms flung out
    g.lineTo(cx - 34, cy - 30);
    g.moveTo(cx - 2, cy - 14);
    g.lineTo(cx + 30, cy - 34);
    g.moveTo(cx + 12, cy + 12); // one leg down, one kicked up
    g.lineTo(cx - 22, cy + 34);
    g.moveTo(cx + 12, cy + 12);
    g.lineTo(cx + 46, cy + 4);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath(); // the puddle underfoot
    g.moveTo(cx - 40, cy + 46);
    g.quadraticCurveTo(cx - 10, cy + 36, cx + 14, cy + 46);
    g.quadraticCurveTo(cx + 36, cy + 54, cx + 54, cy + 44);
    g.stroke();
}

/** A CRT's face: the yellowed bezel around a dark, slightly reflective screen, with nothing on. */
function drawMonitorFace(g, [x0, y0, x1, y1]) {
    const w = x1 - x0;
    const h = y1 - y0;
    const bezel = g.createLinearGradient(0, y0, 0, y1);
    bezel.addColorStop(0, '#dcd3b8');
    bezel.addColorStop(1, '#c7bea1');
    g.fillStyle = bezel;
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 3;
    g.strokeRect(x0 + 1.5, y0 + 1.5, w - 3, h - 3);

    const sx = x0 + 28;
    const sy = y0 + 22;
    const sw = w - 56;
    const sh = h - 62;
    g.fillStyle = 'rgba(0,0,0,0.32)'; // the recess
    g.fillRect(sx - 4, sy - 4, sw + 8, sh + 8);
    g.fillStyle = '#1b201e';
    g.fillRect(sx, sy, sw, sh);
    const glass = g.createRadialGradient(sx + sw * 0.35, sy + sh * 0.3, 0, sx + sw * 0.35, sy + sh * 0.3, sw * 0.8);
    glass.addColorStop(0, 'rgba(120,135,125,0.16)');
    glass.addColorStop(1, 'rgba(120,135,125,0)');
    g.fillStyle = glass;
    g.fillRect(sx, sy, sw, sh);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.beginPath();
    g.moveTo(sx + 10, sy + sh - 10);
    g.lineTo(sx + sw * 0.45, sy + 8);
    g.lineTo(sx + sw * 0.62, sy + 8);
    g.lineTo(sx + 30, sy + sh - 10);
    g.closePath();
    g.fill();

    g.fillStyle = '#a89f86'; // a badge
    g.fillRect(x0 + w / 2 - 22, y1 - 30, 44, 12);
    g.fillStyle = '#5a1810'; // the power light, off
    g.beginPath();
    g.arc(x1 - 40, y1 - 24, 4.5, 0, 2 * Math.PI);
    g.fill();
}

/** A bottle's label, wrapped all the way around it. */
function drawBottleLabel(g, [x0, y0, x1, y1]) {
    const w = x1 - x0;
    const h = y1 - y0;
    g.fillStyle = '#f1e9d2';
    g.fillRect(x0, y0, w, h);
    g.fillStyle = '#6b4a24';
    g.fillRect(x0, y0 + 4, w, 3);
    g.fillRect(x0, y1 - 7, w, 3);
    // An almond.
    g.save();
    g.translate(x0 + w * 0.25, y0 + h / 2);
    g.rotate(-0.5);
    g.fillStyle = '#a4713a';
    g.beginPath();
    g.ellipse(0, 0, 11, 18, 0, 0, 2 * Math.PI);
    g.fill();
    g.strokeStyle = '#d9b07a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-3, -12);
    g.lineTo(-3, 12);
    g.stroke();
    g.restore();
    g.fillStyle = '#6b4a24';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 20px "Arial Black", Arial, Helvetica, sans-serif';
    g.fillText('ALMOND WATER', x0 + w * 0.68, y0 + h / 2);
}

// ---------------------------------------------------------------------------------------------- helpers

/** Draws a picture with everything clipped to its cell (with a little margin kept clear). */
function inCell(g, { x, y }, draw) {
    g.save();
    g.beginPath();
    g.rect(x + 3, y + 3, DECAL_CELL - 6, DECAL_CELL - 6);
    g.clip();
    draw();
    g.restore();
}

/**
 * A few sine waves that make an outline wander: [frequency, amplitude, phase] each. Sharing them between
 * outlines nests one inside another.
 */
function makeWaves(random, wobble) {
    const waves = [];
    for (let k = 2; k <= 7; k++) waves.push([k, (wobble * (0.6 + random() * 0.8) * 2) / k, random() * 2 * Math.PI]);
    return waves;
}

/** A closed irregular outline around (cx, cy). */
function blob(cx, cy, radius, waves, points = 96) {
    const out = [];
    for (let i = 0; i < points; i++) {
        const a = (i / points) * 2 * Math.PI;
        let r = 1;
        for (const [k, amplitude, phase] of waves) r += amplitude * Math.sin(k * a + phase);
        out.push([cx + Math.cos(a) * radius * r, cy + Math.sin(a) * radius * r]);
    }
    return out;
}

/** A line from (x0, y0) to (x1, y1) that wanders sideways by up to `amplitude`, as a list of points. */
function jagged(x0, y0, x1, y1, segments, amplitude, random) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const out = [[x0, y0]];
    for (let s = 1; s < segments; s++) {
        const t = s / segments;
        const d = (random() - 0.5) * 2 * amplitude * (0.5 + random());
        out.push([x0 + dx * t + nx * d, y0 + dy * t + ny * d]);
    }
    out.push([x1, y1]);
    return out;
}

function path(g, points) {
    g.beginPath();
    g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
}

function trace(g, points) {
    path(g, points);
    g.closePath();
}

/**
 * Draws something as a soft shadow: the drawing itself lands off the canvas and only its blurred shadow,
 * in `color`, shows. That's the canvas' one built-in blur that works everywhere.
 */
function shadowed(g, color, blur, draw) {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.shadowOffsetX = OFF_CANVAS;
    g.translate(-OFF_CANVAS, 0);
    g.fillStyle = '#000000';
    g.strokeStyle = '#000000';
    draw(g);
    g.restore();
}

function disc(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, 2 * Math.PI);
    g.fill();
}

function softDisc(g, x, y, r, color) {
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = gradient;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** Scatters tiny dots over a rectangle. */
function speckle(g, x, y, w, h, count, random, color) {
    for (let n = 0; n < count; n++) {
        g.fillStyle = color();
        g.fillRect(x + random() * w, y + random() * h, 1 + (random() < 0.3 ? 1 : 0), 1);
    }
}

/**
 * Gives the fully transparent pixels of a picture the colour of the picture itself. The GPU blends
 * neighbouring pixels together when it shrinks the texture, and if the clear ones were black the edges
 * of every picture would get a dark fringe.
 */
function fillClearPixels(g, { x, y }) {
    const image = g.getImageData(x, y, DECAL_CELL, DECAL_CELL);
    const data = image.data;
    let r = 0;
    let gr = 0;
    let b = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;
        r += data[i] * a;
        gr += data[i + 1] * a;
        b += data[i + 2] * a;
        weight += a;
    }
    if (weight === 0) return;
    r = Math.round(r / weight);
    gr = Math.round(gr / weight);
    b = Math.round(b / weight);
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 0) continue;
        data[i] = r;
        data[i + 1] = gr;
        data[i + 2] = b;
    }
    g.putImageData(image, x, y);
}
