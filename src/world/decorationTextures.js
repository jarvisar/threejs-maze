import { CanvasTexture } from 'three';
import { BARE_WALL_DEPTH, DECAL_ATLAS_SIZE, DECAL_CELL, DECAL_PICTURES } from './decalAtlas.js';
import { drawLevelOneProps } from './levelOneTextures.js';
import { PROP_ATLAS, PROP_ATLAS_HEIGHT, PROP_ATLAS_WIDTH } from './props.js';
import { mulberry32 } from './random.js';

/*
 * The pictures for the decals and props, drawn with the 2D canvas when the game loads rather than shipped
 * as image files. The water damage is drawn the way the real thing looks: a ceiling stain is a pale wash
 * with one hard brown tide line where it stopped spreading, wet carpet is just the carpet a shade darker
 * (the shine is the shader's), and where wallpaper has come away there's patchy, streaked wall.
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
    DECAL_PICTURES.bareWall.forEach((picture) => inCell(g, picture, () => drawBareWall(g, picture, random)));
    DECAL_PICTURES.paperBack.forEach((picture) => inCell(g, picture, () => drawPaperBack(g, picture, random)));
    DECAL_PICTURES.missingTile.forEach((picture) => inCell(g, picture, () => drawMissingTile(g, picture, random)));
    // Read back once for all of them: each read waits for the drawing to finish, and made loading noticeably slower.
    const image = g.getImageData(0, 0, DECAL_ATLAS_SIZE, DECAL_ATLAS_SIZE);
    for (const pictures of Object.values(DECAL_PICTURES)) {
        for (const picture of pictures) {
            fillClearPixels(image, picture);
            g.putImageData(image, 0, 0, picture.x, picture.y, DECAL_CELL, DECAL_CELL);
        }
    }

    const texture = new CanvasTexture(canvas);
    // Floors and ceilings are seen at a grazing angle.
    texture.anisotropy = Math.min(8, maxAnisotropy);
    return texture;
}

/** The props texture: the print on the wet-floor sign, a monitor's face, a bottle's label. */
export function createPropAtlas(maxAnisotropy) {
    const canvas = document.createElement('canvas');
    canvas.width = PROP_ATLAS_WIDTH;
    canvas.height = PROP_ATLAS_HEIGHT;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    // Solid white everywhere nothing is drawn, so a part's vertex colour is all that shows.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, PROP_ATLAS_WIDTH, PROP_ATLAS_HEIGHT);
    drawSignFace(g, PROP_ATLAS.sign);
    drawMonitorFace(g, PROP_ATLAS.monitor);
    drawBottleLabel(g, PROP_ATLAS.label);
    drawCeilingTile(g, PROP_ATLAS.tile, mulberry32(0x711e));
    drawLevelOneProps(g, PROP_ATLAS);

    const texture = new CanvasTexture(canvas);
    texture.anisotropy = Math.min(4, maxAnisotropy);
    return texture;
}

// ---------------------------------------------------------------------------------------------- decals

/**
 * A water stain on the ceiling tiles: a pale yellow-brown wash, deeper towards its edge where the water
 * carried the dirt, blotchy where the tile soaked unevenly, and one crisp brown tide line where it stopped
 * spreading. Fainter, broken lines inside are older, smaller spreads.
 */
function drawCeilingStain(g, picture, random, k) {
    const cx = picture.x + DECAL_CELL / 2;
    const cy = picture.y + DECAL_CELL / 2;
    const R = DECAL_CELL * (k === 0 ? 0.43 : 0.39);
    const waves = fractalWaves(random, k === 0 ? 0.11 : 0.17, 30);
    const outline = blob(cx, cy, R, waves, 256);

    g.save();
    trace(g, outline);
    g.clip();
    // (The ceiling material darkens all of this along with the tiles, so the colours are drawn light: the
    // stain tints the tile yellow-brown more than it darkens it.)
    const wash = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.08);
    wash.addColorStop(0, 'rgba(236,204,128,0.2)');
    wash.addColorStop(0.6, 'rgba(230,190,110,0.28)');
    wash.addColorStop(0.9, 'rgba(210,160,86,0.4)');
    wash.addColorStop(1, 'rgba(190,138,70,0.5)');
    g.fillStyle = wash;
    g.fillRect(picture.x, picture.y, DECAL_CELL, DECAL_CELL);
    for (let n = 0; n < 44; n++) {
        const a = random() * 2 * Math.PI;
        const d = Math.sqrt(random()) * R;
        softDisc(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 14 + random() * 34, `rgba(170,124,62,${0.05 + random() * 0.08})`);
    }
    for (let n = 0; n < 12; n++) {
        const a = random() * 2 * Math.PI;
        const d = Math.sqrt(random()) * R * 0.8;
        softDisc(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 16 + random() * 30, `rgba(250,236,200,${0.06 + random() * 0.08})`);
    }
    // The band of dirt just inside the edge.
    shadowed(g, 'rgba(176,120,54,0.3)', 6, (c) => {
        trace(c, outline);
        c.lineWidth = 12;
        c.stroke();
    });
    g.restore();

    for (const [scale, alpha] of [[0.72, 0.34], [0.48, 0.24]]) {
        const ring = blob(cx + (random() - 0.5) * R * 0.22, cy + (random() - 0.5) * R * 0.22, R * scale, waves.concat(fractalWaves(random, 0.05, 20)), 256);
        brokenStroke(g, ring, `rgba(160,108,46,${alpha})`, 1.6, random);
    }
    shadowed(g, 'rgba(132,84,32,0.75)', 1.4, (c) => {
        trace(c, outline);
        c.lineWidth = 2;
        c.stroke();
    });
    // Where it came through.
    softDisc(g, cx + (random() - 0.5) * R * 0.3, cy + (random() - 0.5) * R * 0.3, R * 0.16, 'rgba(160,112,52,0.25)');
}

/**
 * Wet carpet: the carpet a shade darker, fading out where it's barely damp, wetter in the middle, with the
 * dirt the water carried left along its edge and a few splashes round it. How opaque it is is how wet it
 * is: the decal material makes the wettest parts shine (see materials.js).
 */
function drawPuddle(g, picture, random) {
    const cx = picture.x + DECAL_CELL / 2;
    const cy = picture.y + DECAL_CELL / 2;
    const R = DECAL_CELL * 0.4;
    const waves = fractalWaves(random, 0.16, 24);
    const outline = blob(cx, cy, R, waves, 200);
    shadowed(g, 'rgba(12,9,5,0.58)', 16, (c) => {
        trace(c, outline);
        c.fill();
    });
    const core = blob(cx + (random() - 0.5) * 30, cy + (random() - 0.5) * 30, R * 0.64, fractalWaves(random, 0.2, 18), 160);
    shadowed(g, 'rgba(8,6,3,0.42)', 20, (c) => {
        trace(c, core);
        c.fill();
    });
    shadowed(g, 'rgba(58,42,20,0.32)', 2.5, (c) => {
        trace(c, blob(cx, cy, R * 1.01, waves, 200));
        c.lineWidth = 3;
        c.stroke();
    });
    for (let n = 0; n < 10; n++) {
        const a = random() * 2 * Math.PI;
        const d = R * (1.06 + random() * 0.24);
        const px = cx + Math.cos(a) * d;
        const py = cy + Math.sin(a) * d;
        const r = 2 + random() * 4;
        shadowed(g, 'rgba(10,8,4,0.34)', 3, (c) => {
            c.beginPath();
            c.arc(px, py, r, 0, 2 * Math.PI);
            c.fill();
        });
    }
}

/**
 * The wall where a strip of wallpaper has come away (see peels.js), from the ceiling down to the tear, and
 * the strip's shadow on the paper below that. The wall is brown-grey plasterboard, darkest at the top where
 * the water came in, with runs down from there, scraps of the paper's backing still stuck to it, and the
 * old paste. Its left side is a join between strips, a clean edge; the right is torn, with the white core
 * of the paper showing along it. (Pictures are mirrored at random when laid on the wall.)
 */
function drawBareWall(g, picture, random) {
    const { x, y, aspect } = picture;
    const width = DECAL_CELL * aspect;
    const left = x + (DECAL_CELL - width) / 2 + 3;
    const right = left + width - 6;
    const top = y;
    const tearY = y + DECAL_CELL / BARE_WALL_DEPTH;
    const bottom = y + DECAL_CELL;
    const span = tearY - top;

    // The strip's shadow on the wallpaper below the tear, strongest right under it.
    const slices = 14;
    for (let n = 0; n < slices; n++) {
        const sy = tearY + ((bottom - tearY) * 0.8 * n) / slices;
        const alpha = 0.3 * (1 - n / slices) ** 1.6;
        shadowed(g, `rgba(0,0,0,${alpha.toFixed(3)})`, 8, (c) => c.fillRect(left + width * 0.08, sy, width * 0.8, ((bottom - tearY) * 0.8) / slices + 1));
    }

    const leftEdge = jagged(left, top, left + 1, tearY, 10, 1.2, random);
    const tear = jagged(left + 1, tearY, right - width * 0.03, tearY, 12, span * 0.03, random);
    const rightEdge = jagged(right - width * 0.03, tearY, right, top, 14, width * 0.045, random);
    const exposed = [...leftEdge, ...tear.slice(1), ...rightEdge.slice(1)];

    g.save();
    trace(g, exposed);
    g.clip();
    const board = g.createLinearGradient(0, top, 0, tearY);
    board.addColorStop(0, '#5f523f');
    board.addColorStop(0.3, '#7e725b');
    board.addColorStop(1, '#8c826b');
    g.fillStyle = board;
    g.fillRect(left - 4, top, width + 8, span + 4);
    // Old paste, in the sweeps it was brushed on with.
    for (let n = 0; n < 7; n++) {
        const px = left + random() * width;
        const py = top + random() * span;
        g.strokeStyle = `rgba(170,146,92,${0.08 + random() * 0.08})`;
        g.lineWidth = 10 + random() * 16;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(px - 30, py + 20 * (random() - 0.5));
        g.quadraticCurveTo(px, py + 30 * (random() - 0.5), px + 30, py + 20 * (random() - 0.5));
        g.stroke();
    }
    // Scraps of the paper's backing that stayed stuck.
    for (let n = 0; n < 6; n++) {
        const px = left + random() * width;
        const py = top + span * (0.2 + random() * 0.8);
        const scrap = blob(px, py, 5 + random() * 12, makeWaves(random, 0.35), 18);
        g.fillStyle = `rgba(196,188,160,${0.4 + random() * 0.3})`;
        trace(g, scrap);
        g.fill();
    }
    for (let n = 0; n < 16; n++) {
        softDisc(g, left + random() * width, top + random() * span, 8 + random() * 22, random() < 0.5 ? 'rgba(60,48,30,0.14)' : 'rgba(190,180,150,0.1)');
    }
    // Water down from the ceiling: runs of different lengths, each ending in a darker drop.
    for (let n = 0; n < 6; n++) {
        const px = left + width * (0.08 + random() * 0.84);
        const length = span * (0.25 + random() * 0.8);
        const w = 2 + random() * 6;
        shadowed(g, `rgba(70,48,22,${0.2 + random() * 0.2})`, 3, (c) => c.fillRect(px, top, w, length));
        softDisc(g, px + w / 2, top + length, w * 1.4, 'rgba(64,44,20,0.26)');
    }
    const grime = g.createLinearGradient(0, top, 0, top + span * 0.4);
    grime.addColorStop(0, 'rgba(86,62,34,0.4)');
    grime.addColorStop(1, 'rgba(86,62,34,0)');
    g.fillStyle = grime;
    g.fillRect(left - 4, top, width + 8, span * 0.4);
    speckle(g, left, top, width, span, Math.round(width * span * 0.05), random, () => (random() < 0.7 ? `rgba(0,0,0,${0.04 + random() * 0.08})` : 'rgba(255,255,255,0.07)'));
    // In the shadow of the curl, just above the tear.
    const curl = g.createLinearGradient(0, tearY - span * 0.3, 0, tearY);
    curl.addColorStop(0, 'rgba(0,0,0,0)');
    curl.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = curl;
    g.fillRect(left - 4, tearY - span * 0.3, width + 8, span * 0.3 + 4);
    g.restore();

    // The join: the edge of the next strip, standing a hair off the wall.
    shadowed(g, 'rgba(0,0,0,0.3)', 2, (c) => {
        path(c, leftEdge.map(([px, py]) => [px + 2, py]));
        c.lineWidth = 3;
        c.stroke();
    });
    // The torn edge: its shadow, then the paper's white core.
    shadowed(g, 'rgba(0,0,0,0.38)', 3, (c) => {
        path(c, rightEdge.map(([px, py]) => [px - 3, py]));
        c.lineWidth = 5;
        c.stroke();
    });
    g.strokeStyle = 'rgba(238,232,212,0.92)';
    g.lineWidth = 2.2;
    g.lineJoin = 'round';
    path(g, rightEdge);
    g.stroke();
}

/**
 * The back of a strip of wallpaper: off-white paper, the fibres running along it, greyish where the paste
 * was, shaded into the fold at the tear (top) and water-stained at the end that was up by the ceiling
 * (bottom), with a tide line.
 */
function drawPaperBack(g, picture, random) {
    const { x, y } = picture;
    const size = DECAL_CELL;
    const paper = g.createLinearGradient(0, y, 0, y + size);
    paper.addColorStop(0, '#a39b80');
    paper.addColorStop(0.12, '#c4bca2');
    paper.addColorStop(0.6, '#cac2a8');
    paper.addColorStop(1, '#bfb69a');
    g.fillStyle = paper;
    g.fillRect(x, y, size, size);
    for (let n = 0; n < 90; n++) {
        const fx = x + random() * size;
        g.fillStyle = `rgba(140,128,100,${0.04 + random() * 0.07})`;
        g.fillRect(fx, y, 1 + random() * 1.5, size);
    }
    for (let n = 0; n < 12; n++) {
        softDisc(g, x + random() * size, y + random() * size, 20 + random() * 40, 'rgba(160,150,122,0.12)');
    }
    // The water that got behind it, from the end at the ceiling.
    const stainTop = y + size * (0.55 + random() * 0.1);
    const edge = wavy(x - 4, stainTop, x + size + 4, stainTop + (random() - 0.5) * 24, 48, 9, random);
    g.save();
    trace(g, [...edge, [x + size + 4, y + size + 4], [x - 4, y + size + 4]]);
    g.clip();
    const water = g.createLinearGradient(0, stainTop, 0, y + size);
    water.addColorStop(0, 'rgba(168,128,70,0.2)');
    water.addColorStop(1, 'rgba(140,100,50,0.38)');
    g.fillStyle = water;
    g.fillRect(x, stainTop - 30, size, size);
    g.restore();
    shadowed(g, 'rgba(120,84,38,0.5)', 2, (c) => {
        path(c, edge);
        c.lineWidth = 2;
        c.stroke();
    });
    // Its edges, a little darker.
    for (const [ex, dir] of [[x, 1], [x + size, -1]]) {
        const shade = g.createLinearGradient(ex, 0, ex + dir * 14, 0);
        shade.addColorStop(0, 'rgba(90,80,60,0.28)');
        shade.addColorStop(1, 'rgba(90,80,60,0)');
        g.fillStyle = shade;
        g.fillRect(Math.min(ex, ex + dir * 14), y, 14, size);
    }
    speckle(g, x, y, size, size, 2200, random, () => `rgba(100,90,70,${0.03 + random() * 0.06})`);
}

/**
 * Where a ceiling tile has fallen out: the dark space above, lit a little at its edges by the room below,
 * a pipe crossing it, and the lip of the grid the tile sat on.
 */
function drawMissingTile(g, picture, random) {
    const { x, y } = picture;
    const size = DECAL_CELL;
    g.fillStyle = '#100f0c';
    g.fillRect(x, y, size, size);
    for (const [x0, y0, x1, y1] of [[x, 0, x + size * 0.22, 0], [x + size, 0, x + size * 0.78, 0], [0, y, 0, y + size * 0.22], [0, y + size, 0, y + size * 0.78]]) {
        const light = g.createLinearGradient(x0, y0, x1, y1);
        light.addColorStop(0, 'rgba(92,86,72,0.55)');
        light.addColorStop(1, 'rgba(92,86,72,0)');
        g.fillStyle = light;
        g.fillRect(x, y, size, size);
    }
    // A pipe running across, above the grid.
    const t = random();
    const [ax, ay, bx, by] = [x - 10, y + size * (0.55 + t * 0.2), x + size + 10, y + size * (0.2 + t * 0.15)];
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(46,43,37,0.95)';
    g.lineWidth = size * 0.13;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    g.strokeStyle = 'rgba(120,112,94,0.45)';
    g.lineWidth = size * 0.025;
    g.beginPath();
    g.moveTo(ax, ay - size * 0.035);
    g.lineTo(bx, by - size * 0.035);
    g.stroke();
    // The grid's lip, and the shadow just inside it.
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 10;
    g.strokeRect(x + 8, y + 8, size - 16, size - 16);
    g.strokeStyle = '#cbc6b4';
    g.lineWidth = 6;
    g.strokeRect(x + 3, y + 3, size - 6, size - 6);
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

/**
 * The face of a ceiling tile: off-white, pitted all over like the ones still up there, and brown where it
 * soaked through, which is why it fell.
 */
function drawCeilingTile(g, [x0, y0, x1, y1], random) {
    const w = x1 - x0;
    const h = y1 - y0;
    g.fillStyle = '#e4e1d6';
    g.fillRect(x0, y0, w, h);
    for (let n = 0; n < 700; n++) {
        g.fillStyle = `rgba(120,116,100,${0.12 + random() * 0.2})`;
        g.fillRect(x0 + random() * w, y0 + random() * h, 1 + random() * 2.5, 1 + random() * 1.5);
    }
    g.save();
    g.beginPath();
    g.rect(x0, y0, w, h);
    g.clip();
    const cx = x0 + w * (0.4 + random() * 0.2);
    const cy = y0 + h * (0.45 + random() * 0.2);
    const stain = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.6);
    stain.addColorStop(0, 'rgba(150,112,58,0.55)');
    stain.addColorStop(0.75, 'rgba(160,122,66,0.35)');
    stain.addColorStop(1, 'rgba(160,122,66,0)');
    g.fillStyle = stain;
    g.fillRect(x0, y0, w, h);
    g.strokeStyle = 'rgba(110,74,32,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(cx, cy, w * 0.5, h * 0.36, random(), 0, 2 * Math.PI);
    g.stroke();
    g.restore();
    // Its bevelled edge.
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 4;
    g.strokeRect(x0 + 2, y0 + 2, w - 4, h - 4);
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

/**
 * Like makeWaves, but with many more, smaller waves on top: an outline that wanders at every scale, the
 * way the edge of a real stain does.
 */
function fractalWaves(random, wobble, highest) {
    const waves = [];
    for (let k = 2; k <= highest; k++) waves.push([k, (wobble * (0.5 + random()) * 2) / k ** 1.25, random() * 2 * Math.PI]);
    return waves;
}

/** A smooth wandering line from (x0, y0) to (x1, y1), as a list of points: a few sine waves across it. */
function wavy(x0, y0, x1, y1, segments, amplitude, random) {
    const waves = [1, 2, 3, 5, 8].map((k) => [k, (amplitude * (0.5 + random())) / k ** 0.7, random() * 2 * Math.PI]);
    const out = [];
    for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        let d = 0;
        for (const [k, a, phase] of waves) d += a * Math.sin(k * t * Math.PI + phase);
        out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + d]);
    }
    return out;
}

/** Strokes a closed outline with gaps in it, as a line that has faded away in places. */
function brokenStroke(g, points, color, width, random) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    let drawing = random() < 0.7;
    let run = 0;
    g.beginPath();
    for (let i = 0; i <= points.length; i++) {
        const [px, py] = points[i % points.length];
        if (--run <= 0) {
            drawing = random() < (drawing ? 0.75 : 0.6);
            run = 6 + Math.floor(random() * 30);
            g.moveTo(px, py);
            continue;
        }
        if (drawing) g.lineTo(px, py);
        else g.moveTo(px, py);
    }
    g.stroke();
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
 * @param {ImageData} image The whole atlas.
 * @param {import('./decalAtlas.js').Picture} picture
 */
function fillClearPixels(image, { x, y }) {
    const data = image.data;
    const cellPixels = (visit) => {
        for (let row = y; row < y + DECAL_CELL; row++) {
            for (let i = (row * image.width + x) * 4, end = i + DECAL_CELL * 4; i < end; i += 4) visit(i);
        }
    };
    let r = 0;
    let gr = 0;
    let b = 0;
    let weight = 0;
    cellPixels((i) => {
        const a = data[i + 3];
        if (a === 0) return;
        r += data[i] * a;
        gr += data[i + 1] * a;
        b += data[i + 2] * a;
        weight += a;
    });
    if (weight === 0) return;
    r = Math.round(r / weight);
    gr = Math.round(gr / weight);
    b = Math.round(b / weight);
    cellPixels((i) => {
        if (data[i + 3] !== 0) return;
        data[i] = r;
        data[i + 1] = gr;
        data[i + 2] = b;
    });
}
