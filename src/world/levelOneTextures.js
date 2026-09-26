import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping } from 'three';
import { CHUNK_SIZE } from '../config.js';
import { mulberry32 } from './random.js';

/*
 * Level 1's pictures, drawn with the 2D canvas when the game loads, like Level 0's decals and props: the concrete
 * (cast walls with the lines of the boards it was poured against, a trowelled floor, the slab overhead), the
 * letters stencilled on the columns, the fittings on the walls and ceiling, and the pictures on its props.
 *
 * The concrete is drawn a neutral mid grey, with detail but no colour of its own; the materials and their shaders
 * (materials.js) do the staining, the damp and the paint over it, at a scale no tile can. Everything is drawn from
 * fixed seeds, so it's the same on every load.
 */

/** How many texture tiles to a world unit on the walls, floor and ceiling. */
export const CONCRETE_TILES = 1;

/**
 * @typedef {object} LevelOneTextures
 * @property {CanvasTexture} walls Cast concrete: 1 × 1 unit, repeating.
 * @property {CanvasTexture} floor
 * @property {CanvasTexture} ceiling
 * @property {CanvasTexture} glyphs The stencil letters and numbers (see GLYPHS).
 * @property {CanvasTexture} details A junction box (left half) and a ceiling grille (right half).
 */

/**
 * @param {number} maxAnisotropy
 * @returns {LevelOneTextures}
 */
export function createLevelOneTextures(maxAnisotropy) {
    const walls = repeating(drawWallConcrete(512), maxAnisotropy, 1, 1);
    // The floor and ceiling are one plane a chunk, textured 0..1 across it.
    const floor = repeating(drawFloorConcrete(512), maxAnisotropy, CHUNK_SIZE, CHUNK_SIZE);
    const ceiling = repeating(drawCeilingConcrete(256), maxAnisotropy, CHUNK_SIZE / 2, CHUNK_SIZE / 2);
    const glyphs = new CanvasTexture(drawGlyphs());
    glyphs.anisotropy = Math.min(4, maxAnisotropy);
    const details = new CanvasTexture(drawDetails());
    details.magFilter = NearestFilter;
    return { walls, floor, ceiling, glyphs, details };
}

function repeating(canvas, maxAnisotropy, repeatX, repeatY) {
    const texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(8, maxAnisotropy);
    return texture;
}

// ---------------------------------------------------------------------------------------------- concrete

/**
 * Smooth noise that tiles: a sum of random grids, each twice as fine as the last, blended smoothly between their
 * points and wrapped at the edges. Returns values roughly 0..1.
 * @param {number} size Pixels across (a power of two).
 * @param {() => number} random
 * @param {number} coarsest Grid points across the first octave.
 * @param {number} octaves
 * @param {number} [falloff] How much weaker each octave is than the last.
 */
function tiledNoise(size, random, coarsest, octaves, falloff = 0.5) {
    const out = new Float32Array(size * size);
    let amplitude = 1;
    let total = 0;
    for (let o = 0, cells = coarsest; o < octaves && cells <= size; o++, cells *= 2) {
        const grid = new Float32Array(cells * cells);
        for (let i = 0; i < grid.length; i++) grid[i] = random();
        const scale = cells / size;
        for (let y = 0; y < size; y++) {
            const gy = y * scale;
            const y0 = Math.floor(gy);
            let fy = gy - y0;
            fy = fy * fy * (3 - 2 * fy);
            const r0 = (y0 % cells) * cells;
            const r1 = ((y0 + 1) % cells) * cells;
            for (let x = 0; x < size; x++) {
                const gx = x * scale;
                const x0 = Math.floor(gx);
                let fx = gx - x0;
                fx = fx * fx * (3 - 2 * fx);
                const c0 = x0 % cells;
                const c1 = (x0 + 1) % cells;
                const top = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * fx;
                const bottom = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * fx;
                out[y * size + x] += (top + (bottom - top) * fy) * amplitude;
            }
        }
        total += amplitude;
        amplitude *= falloff;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
}

/** Writes greys (0..255, one per pixel) into a canvas. */
function toCanvas(size, grey) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const image = g.createImageData(size, size);
    for (let i = 0; i < grey.length; i++) {
        const v = Math.max(0, Math.min(255, grey[i]));
        image.data[i * 4] = v;
        image.data[i * 4 + 1] = v;
        image.data[i * 4 + 2] = v;
        image.data[i * 4 + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    return canvas;
}

/** Specks of aggregate and the little holes left by air bubbles, darker and lighter than the concrete round them. */
function speckle(grey, size, random, count, radius, strength) {
    for (let n = 0; n < count; n++) {
        const cx = random() * size;
        const cy = random() * size;
        const r = radius * (0.4 + random() * 0.8);
        const d = (random() < 0.6 ? -1 : 1) * strength * (0.5 + random() * 0.5);
        for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
            for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
                const t = 1 - Math.hypot(x - cx, y - cy) / r;
                if (t <= 0) continue;
                const i = ((y + size) % size) * size + ((x + size) % size);
                grey[i] += d * Math.min(1, t * 2);
            }
        }
    }
}

/**
 * Cast concrete: mottled, with the faint lines of the boards it was poured against running across (about 30 cm
 * apart), the grain of the boards in between, the holes where the form ties went through, and air holes.
 */
function drawWallConcrete(size) {
    const random = mulberry32(0xc0c1);
    const broad = tiledNoise(size, random, 4, 5, 0.55);
    const fine = tiledNoise(size, random, 64, 3, 0.6);
    const grain = tiledNoise(size, random, 8, 2, 0.5);
    const grey = new Float32Array(size * size);
    const boards = 9;
    const boardHeight = size / boards;
    for (let y = 0; y < size; y++) {
        const inBoard = (y % boardHeight) / boardHeight;
        const board = Math.floor(y / boardHeight);
        // Each board a slightly different shade, and a dark hairline where two met.
        const shade = ((board * 2654435761) >>> 0) / 4294967296 - 0.5;
        const seam = Math.max(0, 1 - Math.min(inBoard, 1 - inBoard) * boardHeight / 1.6);
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            // The grain runs along the boards: noise stretched out along x.
            const g = grain[(Math.floor(y * 4) % size) * size + (Math.floor(x / 6) % size)];
            grey[i] = 132 + (broad[i] - 0.5) * 70 + (fine[i] - 0.5) * 34 + shade * 12 + (g - 0.5) * 10 - seam * 26;
        }
    }
    speckle(grey, size, random, 900, 1.3, 30);
    // Form tie holes: small dark pits in rows, a board apart.
    for (let row = 0; row < boards; row += 3) {
        for (let col = 0; col < 3; col++) {
            const cx = (col + 0.5) * (size / 3) + (random() - 0.5) * 6;
            const cy = (row + 1) * boardHeight + (random() - 0.5) * 2;
            for (let y = Math.floor(cy - 5); y <= cy + 5; y++) {
                for (let x = Math.floor(cx - 5); x <= cx + 5; x++) {
                    const d = Math.hypot(x - cx, y - cy);
                    if (d > 4.5) continue;
                    const i = ((y + size) % size) * size + ((x + size) % size);
                    grey[i] -= d < 2.4 ? 60 : 18 * (1 - (d - 2.4) / 2.1);
                }
            }
        }
    }
    return toCanvas(size, grey);
}

/**
 * A trowelled concrete floor: smoother than the walls, with the swirls of the float, grit, and hairline cracks.
 */
function drawFloorConcrete(size) {
    const random = mulberry32(0xf100);
    const broad = tiledNoise(size, random, 4, 5, 0.6);
    const fine = tiledNoise(size, random, 128, 2, 0.5);
    const grey = new Float32Array(size * size);
    // The float's sweeps: arcs of slightly lighter, smoother concrete.
    const swirls = [];
    for (let n = 0; n < 26; n++) swirls.push([random() * size, random() * size, 30 + random() * 70, random() * Math.PI * 2]);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            let sweep = 0;
            for (const [cx, cy, r] of swirls) {
                let dx = Math.abs(x - cx);
                let dy = Math.abs(y - cy);
                dx = Math.min(dx, size - dx);
                dy = Math.min(dy, size - dy);
                const ring = Math.abs(Math.hypot(dx, dy) - r);
                if (ring < 9) sweep += (1 - ring / 9) * 0.5;
            }
            grey[i] = 128 + (broad[i] - 0.5) * 60 + (fine[i] - 0.5) * 22 + Math.min(sweep, 1) * 9;
        }
    }
    speckle(grey, size, random, 1600, 1.1, 34);
    speckle(grey, size, random, 160, 3.5, 14);
    // Hairline cracks: a few wandering lines.
    for (let n = 0; n < 5; n++) {
        let x = random() * size;
        let y = random() * size;
        let angle = random() * Math.PI * 2;
        const length = 80 + random() * 200;
        for (let step = 0; step < length; step++) {
            angle += (random() - 0.5) * 0.5;
            x += Math.cos(angle);
            y += Math.sin(angle);
            const i = ((Math.floor(y) % size + size) % size) * size + ((Math.floor(x) % size + size) % size);
            grey[i] -= 45 * (1 - step / length * 0.6);
        }
    }
    return toCanvas(size, grey);
}

/** The slab overhead: smooth, cast against plywood, a little blotchy. */
function drawCeilingConcrete(size) {
    const random = mulberry32(0xce11);
    const broad = tiledNoise(size, random, 4, 5, 0.6);
    const fine = tiledNoise(size, random, 32, 3, 0.55);
    const grey = new Float32Array(size * size);
    for (let i = 0; i < grey.length; i++) grey[i] = 150 + (broad[i] - 0.5) * 46 + (fine[i] - 0.5) * 20;
    speckle(grey, size, random, 260, 1, 20);
    return toCanvas(size, grey);
}

// ---------------------------------------------------------------------------------------------- stencils

/** The letters and numbers in the glyph texture, in order, eight to a row. */
export const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
/** The glyph texture: its size, and the size of each glyph's cell, in pixels. */
export const GLYPH_TEXTURE = 512;
export const GLYPH_CELL = 64;
/** Other pictures in the glyph texture, in pixels: an arrow painted on the floor. */
export const GLYPH_PICTURES = {
    arrow: [0, 320, 128, 448],
    stripe: [128, 320, 256, 448],
};

/** Where glyph `c` is in the glyph texture, as [x0, y0, x1, y1] in pixels. */
export function glyphRect(c) {
    const k = Math.max(0, GLYPHS.indexOf(c));
    const x = (k % 8) * GLYPH_CELL;
    const y = Math.floor(k / 8) * GLYPH_CELL;
    return [x, y, x + GLYPH_CELL, y + GLYPH_CELL];
}

/**
 * Stencilled letters: bold capitals in white on nothing, with the bridges a stencil leaves across them, the edges
 * softened and spattered the way sprayed paint is. (The material colours them.)
 */
function drawGlyphs() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GLYPH_TEXTURE;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const random = mulberry32(0x57e7);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const c of GLYPHS) {
        const [x0, y0] = glyphRect(c);
        const cx = x0 + GLYPH_CELL / 2;
        const cy = y0 + GLYPH_CELL / 2 + 2;
        g.save();
        g.beginPath();
        g.rect(x0 + 2, y0 + 2, GLYPH_CELL - 4, GLYPH_CELL - 4);
        g.clip();
        g.fillStyle = '#ffffff';
        g.shadowColor = 'rgba(255, 255, 255, 0.7)';
        g.shadowBlur = 2.5;
        g.font = 'bold 54px "Arial Narrow", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';
        g.fillText(c, cx, cy, GLYPH_CELL - 10);
        g.shadowBlur = 0;
        // The stencil's bridges: thin gaps across the letter, top and bottom of its middle.
        g.globalCompositeOperation = 'destination-out';
        if ('ABDOPQR0689'.includes(c)) {
            g.fillRect(cx - 1.5, y0 + 6, 3, 13);
            g.fillRect(cx - 1.5, y0 + GLYPH_CELL - 18, 3, 13);
        } else if ('CGSU235'.includes(c)) {
            g.fillRect(cx - 1.5, y0 + 6, 3, 11);
        }
        // Overspray eaten away in places.
        for (let n = 0; n < 40; n++) {
            g.globalAlpha = 0.25 + random() * 0.5;
            g.beginPath();
            g.arc(x0 + 6 + random() * (GLYPH_CELL - 12), y0 + 6 + random() * (GLYPH_CELL - 12), 0.6 + random() * 2.2, 0, Math.PI * 2);
            g.fill();
        }
        g.restore();
    }

    // A floor arrow: long shaft, broad head, worn.
    {
        const [x0, y0, x1, y1] = GLYPH_PICTURES.arrow;
        g.save();
        g.fillStyle = '#ffffff';
        const w = x1 - x0;
        const h = y1 - y0;
        g.beginPath();
        g.moveTo(x0 + w * 0.5, y0 + h * 0.06);
        g.lineTo(x0 + w * 0.86, y0 + h * 0.44);
        g.lineTo(x0 + w * 0.62, y0 + h * 0.44);
        g.lineTo(x0 + w * 0.62, y0 + h * 0.94);
        g.lineTo(x0 + w * 0.38, y0 + h * 0.94);
        g.lineTo(x0 + w * 0.38, y0 + h * 0.44);
        g.lineTo(x0 + w * 0.14, y0 + h * 0.44);
        g.closePath();
        g.fill();
        wear(g, x0, y0, w, h, random, 140);
        g.restore();
    }
    // A painted stripe, worn: the lines between bays.
    {
        const [x0, y0, x1, y1] = GLYPH_PICTURES.stripe;
        g.save();
        g.fillStyle = '#ffffff';
        g.fillRect(x0 + 8, y0, x1 - x0 - 16, y1 - y0);
        wear(g, x0, y0, x1 - x0, y1 - y0, random, 220);
        g.restore();
    }
    return canvas;
}

/** Scuffs worn out of paint: faded patches and specks gone. */
function wear(g, x0, y0, w, h, random, count) {
    g.globalCompositeOperation = 'destination-out';
    for (let n = 0; n < count; n++) {
        g.globalAlpha = 0.15 + random() * 0.6;
        g.beginPath();
        g.ellipse(x0 + random() * w, y0 + random() * h, 1 + random() * 7, 0.8 + random() * 3, random() * Math.PI, 0, Math.PI * 2);
        g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
}

// ---------------------------------------------------------------------------------------------- fittings

/**
 * The fittings Level 1 has where Level 0 has outlets and vents (the same shapes, see chunkGeometry.js): a grey
 * junction box with a conduit coming out of it, and a steel grille over a duct in the slab.
 */
function drawDetails() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    // Junction box.
    g.fillStyle = '#8d918f';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#6f7371';
    g.fillRect(0, 0, 32, 2);
    g.fillRect(0, 30, 32, 2);
    g.fillRect(0, 0, 2, 32);
    g.fillRect(30, 0, 2, 32);
    g.fillStyle = '#a9adab';
    g.fillRect(4, 4, 24, 3);
    // A yellow warning sticker, and the screws.
    g.fillStyle = '#d8b21c';
    g.beginPath();
    g.moveTo(16, 11);
    g.lineTo(23, 23);
    g.lineTo(9, 23);
    g.closePath();
    g.fill();
    g.fillStyle = '#26241e';
    g.fillRect(15, 15, 2, 5);
    g.fillRect(15, 21, 2, 1);
    for (const [x, y] of [[4, 27], [26, 27], [4, 9], [26, 9]]) g.fillRect(x, y, 2, 2);
    // Duct grille.
    g.fillStyle = '#7b7f80';
    g.fillRect(32, 0, 32, 32);
    g.fillStyle = '#2b2d2e';
    for (let y = 4; y < 28; y += 3) g.fillRect(35, y, 26, 2);
    g.fillStyle = '#9ea2a3';
    g.fillRect(32, 0, 32, 2);
    g.fillRect(32, 30, 32, 2);
    g.fillRect(32, 0, 2, 32);
    g.fillRect(62, 0, 2, 32);
    return canvas;
}

// ---------------------------------------------------------------------------------------------- props

/**
 * Level 1's pictures in the props texture (see PROP_ATLAS in props.js).
 * @param {CanvasRenderingContext2D} g
 * @param {Record<string, number[]>} atlas
 */
export function drawLevelOneProps(g, atlas) {
    const random = mulberry32(0x1c7a);
    drawCrateSide(g, atlas.crate, random, null);
    drawCrateSide(g, atlas.crateStencil, random, 'L1');
    drawCrateTop(g, atlas.crateTop, random);
    drawWood(g, atlas.wood, random);
    drawCardboard(g, atlas.cardboard, random, false);
    drawCardboard(g, atlas.cardboardLabel, random, true);
    drawCardboardTop(g, atlas.cardboardTop, random);
    drawDrumLabel(g, atlas.drumLabel);
    drawWrap(g, atlas.wrap, random);
    drawDecking(g, atlas.decking);
    drawSack(g, atlas.sack, random);
    drawPlate(g, atlas.plate);
    drawGrille(g, atlas.grille);
}

function within(g, [x0, y0, x1, y1], draw) {
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    draw(x0, y0, x1 - x0, y1 - y0);
    g.restore();
}

/** Boards of pale softwood with grain and the odd knot. */
function planks(g, x0, y0, w, h, count, random, vertical = false) {
    const across = vertical ? w : h;
    const size = across / count;
    for (let k = 0; k < count; k++) {
        const shade = 176 + Math.floor(random() * 34);
        g.fillStyle = `rgb(${shade}, ${Math.floor(shade * 0.8)}, ${Math.floor(shade * 0.56)})`;
        if (vertical) g.fillRect(x0 + k * size, y0, size, h);
        else g.fillRect(x0, y0 + k * size, w, size);
        // Grain lines along the board.
        g.strokeStyle = `rgba(110, 76, 40, ${0.12 + random() * 0.12})`;
        g.lineWidth = 1;
        for (let line = 0; line < 5; line++) {
            g.beginPath();
            const offset = (line + random()) * size / 5;
            for (let t = 0; t <= 1.001; t += 0.1) {
                const along = t * (vertical ? h : w);
                const wobble = Math.sin(t * 7 + line * 2 + k) * 1.5;
                if (vertical) g.lineTo(x0 + k * size + offset + wobble, y0 + along);
                else g.lineTo(x0 + along, y0 + k * size + offset + wobble);
            }
            g.stroke();
        }
        if (random() < 0.4) {
            g.fillStyle = 'rgba(96, 62, 30, 0.55)';
            g.beginPath();
            const along = random() * (vertical ? h : w);
            const off = (0.3 + random() * 0.4) * size;
            if (vertical) g.ellipse(x0 + k * size + off, y0 + along, 2, 4, 0, 0, Math.PI * 2);
            else g.ellipse(x0 + along, y0 + k * size + off, 4, 2, 0, 0, Math.PI * 2);
            g.fill();
        }
        // The gap between boards.
        g.fillStyle = 'rgba(40, 28, 16, 0.55)';
        if (vertical) g.fillRect(x0 + k * size, y0, 1.5, h);
        else g.fillRect(x0, y0 + k * size, w, 1.5);
    }
}

/** Dirt worked into something: a darker wash towards the bottom, and smudges. */
function grime(g, x0, y0, w, h, random, strength) {
    const gradient = g.createLinearGradient(0, y0, 0, y0 + h);
    gradient.addColorStop(0, 'rgba(40, 30, 20, 0)');
    gradient.addColorStop(1, `rgba(40, 30, 20, ${strength})`);
    g.fillStyle = gradient;
    g.fillRect(x0, y0, w, h);
    for (let n = 0; n < 10; n++) {
        g.fillStyle = `rgba(50, 40, 30, ${random() * strength * 0.6})`;
        g.beginPath();
        g.ellipse(x0 + random() * w, y0 + random() * h, 4 + random() * 14, 2 + random() * 8, random() * 3, 0, Math.PI * 2);
        g.fill();
    }
}

/** A crate's side: horizontal boards in a frame of battens, nailed at the corners; with `stencil`, printed. */
function drawCrateSide(g, rect, random, stencil) {
    within(g, rect, (x0, y0, w, h) => {
        planks(g, x0, y0, w, h, 4, random);
        // The frame round the edge.
        const b = 13;
        g.fillStyle = 'rgba(150, 112, 70, 1)';
        g.fillRect(x0, y0, w, b);
        g.fillRect(x0, y0 + h - b, w, b);
        g.fillRect(x0, y0, b, h);
        g.fillRect(x0 + w - b, y0, b, h);
        g.strokeStyle = 'rgba(60, 40, 20, 0.6)';
        g.lineWidth = 1.5;
        g.strokeRect(x0 + b, y0 + b, w - 2 * b, h - 2 * b);
        g.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
        g.fillStyle = '#3b3530';
        for (const [x, y] of [[b / 2, b / 2], [w - b / 2, b / 2], [b / 2, h - b / 2], [w - b / 2, h - b / 2], [w / 2, b / 2], [w / 2, h - b / 2]]) {
            g.beginPath();
            g.arc(x0 + x, y0 + y, 1.6, 0, Math.PI * 2);
            g.fill();
        }
        if (stencil) {
            g.fillStyle = 'rgba(30, 28, 26, 0.78)';
            g.font = 'bold 34px "Arial Narrow", Arial, "Liberation Sans", sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(stencil, x0 + w / 2, y0 + h / 2 - 8);
            g.font = 'bold 13px "Arial Narrow", Arial, "Liberation Sans", sans-serif';
            g.fillText('SUPPLY', x0 + w / 2, y0 + h / 2 + 20);
            g.globalCompositeOperation = 'destination-over';
        }
        grime(g, x0, y0, w, h, random, 0.3);
    });
}

/** A crate's lid: boards the other way, and the battens across. */
function drawCrateTop(g, rect, random) {
    within(g, rect, (x0, y0, w, h) => {
        planks(g, x0, y0, w, h, 5, random, true);
        g.fillStyle = 'rgba(150, 112, 70, 1)';
        g.fillRect(x0, y0 + 12, w, 12);
        g.fillRect(x0, y0 + h - 24, w, 12);
        grime(g, x0, y0, w, h, random, 0.18);
    });
}

function drawWood(g, rect, random) {
    within(g, rect, (x0, y0, w, h) => {
        planks(g, x0, y0, w, h, 3, random);
        grime(g, x0, y0, w, h, random, 0.35);
    });
}

/** Brown board with a strip of parcel tape down the middle, and sometimes a shipping label. */
function drawCardboard(g, rect, random, label) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#b48d5c';
        g.fillRect(x0, y0, w, h);
        // The corrugation shows through faintly.
        g.fillStyle = 'rgba(90, 64, 34, 0.08)';
        for (let x = 0; x < w; x += 4) g.fillRect(x0 + x, y0, 2, h);
        g.fillStyle = 'rgba(210, 180, 130, 0.55)';
        g.fillRect(x0 + w * 0.42, y0, w * 0.16, h * 0.34);
        if (label) {
            g.fillStyle = '#ecebe4';
            g.fillRect(x0 + w * 0.18, y0 + h * 0.46, w * 0.5, h * 0.3);
            g.fillStyle = '#34322e';
            for (let line = 0; line < 4; line++) g.fillRect(x0 + w * 0.22, y0 + h * (0.5 + line * 0.06), w * (0.2 + random() * 0.2), 2);
            g.fillRect(x0 + w * 0.52, y0 + h * 0.5, 12, 12);
        } else {
            g.strokeStyle = 'rgba(40, 36, 32, 0.7)';
            g.lineWidth = 2;
            // An arrow: this way up.
            g.beginPath();
            g.moveTo(x0 + w * 0.2, y0 + h * 0.8);
            g.lineTo(x0 + w * 0.2, y0 + h * 0.55);
            g.moveTo(x0 + w * 0.14, y0 + h * 0.62);
            g.lineTo(x0 + w * 0.2, y0 + h * 0.55);
            g.lineTo(x0 + w * 0.26, y0 + h * 0.62);
            g.stroke();
        }
        grime(g, x0, y0, w, h, random, 0.28);
    });
}

function drawCardboardTop(g, rect, random) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#b8915f';
        g.fillRect(x0, y0, w, h);
        // The flaps meeting, and the tape over the join.
        g.fillStyle = 'rgba(60, 40, 20, 0.5)';
        g.fillRect(x0, y0 + h / 2 - 1, w, 2);
        g.fillStyle = 'rgba(214, 184, 134, 0.7)';
        g.fillRect(x0, y0 + h * 0.42, w, h * 0.16);
        grime(g, x0, y0, w, h, random, 0.15);
    });
}

/** The hazard label on a drum: a diamond on a white patch. */
function drawDrumLabel(g, rect) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#e8e6de';
        g.fillRect(x0, y0, w, h);
        g.fillStyle = '#d8541c';
        g.beginPath();
        g.moveTo(x0 + w / 2, y0 + 10);
        g.lineTo(x0 + w / 2 + 46, y0 + h / 2);
        g.lineTo(x0 + w / 2, y0 + h - 10);
        g.lineTo(x0 + w / 2 - 46, y0 + h / 2);
        g.closePath();
        g.fill();
        g.fillStyle = '#1f1d1a';
        g.fillRect(x0 + w / 2 - 3, y0 + h / 2 - 24, 6, 30);
        g.fillRect(x0 + w / 2 - 3, y0 + h / 2 + 12, 6, 6);
    });
}

/** Cardboard boxes under stretched plastic: the boxes' edges and tape through a glossy, wrinkled sheen. */
function drawWrap(g, rect, random) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#a98657';
        g.fillRect(x0, y0, w, h);
        g.strokeStyle = 'rgba(60, 40, 20, 0.6)';
        g.lineWidth = 2;
        for (let k = 1; k < 3; k++) {
            g.beginPath();
            g.moveTo(x0, y0 + k * h / 3);
            g.lineTo(x0 + w, y0 + k * h / 3);
            g.stroke();
        }
        g.beginPath();
        g.moveTo(x0 + w / 2, y0);
        g.lineTo(x0 + w / 2, y0 + h);
        g.stroke();
        // The wrap: pale bands at a slant where it's wound on thicker, and creases.
        for (let n = 0; n < 7; n++) {
            g.fillStyle = `rgba(235, 240, 245, ${0.18 + random() * 0.2})`;
            const y = y0 + random() * h;
            g.beginPath();
            g.moveTo(x0, y);
            g.lineTo(x0 + w, y - 14 + random() * 8);
            g.lineTo(x0 + w, y + 6 + random() * 12);
            g.lineTo(x0, y + 18 + random() * 8);
            g.closePath();
            g.fill();
        }
        g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        g.lineWidth = 1;
        for (let n = 0; n < 12; n++) {
            g.beginPath();
            const x = x0 + random() * w;
            const y = y0 + random() * h;
            g.moveTo(x, y);
            g.lineTo(x + 10 + random() * 30, y + (random() - 0.5) * 10);
            g.stroke();
        }
    });
}

/** Wire mesh decking on a shelf. */
function drawDecking(g, rect) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#5f6264';
        g.fillRect(x0, y0, w, h);
        g.fillStyle = '#c6c9cb';
        for (let x = 2; x < w; x += 8) g.fillRect(x0 + x, y0, 2, h);
        for (let y = 2; y < h; y += 20) g.fillRect(x0, y0 + y, w, 2);
    });
}

/** Paper sacks (cement, or something like it): pale paper, printed, a seam. */
function drawSack(g, rect, random) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#d9cfb8';
        g.fillRect(x0, y0, w, h);
        g.fillStyle = 'rgba(160, 40, 30, 0.8)';
        g.fillRect(x0 + w * 0.3, y0 + h * 0.3, w * 0.4, h * 0.14);
        g.fillStyle = 'rgba(40, 40, 40, 0.6)';
        g.fillRect(x0 + w * 0.34, y0 + h * 0.52, w * 0.32, 4);
        g.fillRect(x0 + w * 0.34, y0 + h * 0.6, w * 0.22, 4);
        grime(g, x0, y0, w, h, random, 0.25);
    });
}

/** A number plate with nothing on it. */
function drawPlate(g, rect) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#d9d8cf';
        g.fillRect(x0, y0, w, h);
        g.strokeStyle = '#2a2a28';
        g.lineWidth = 4;
        g.strokeRect(x0 + 4, y0 + 4, w - 8, h - 8);
    });
}

/** A car's front: a black grille between two headlamps. */
function drawGrille(g, rect) {
    within(g, rect, (x0, y0, w, h) => {
        g.fillStyle = '#1b1c1d';
        g.fillRect(x0, y0, w, h);
        g.fillStyle = '#3a3c3e';
        for (let y = 8; y < h - 6; y += 6) g.fillRect(x0 + w * 0.28, y0 + y, w * 0.44, 2);
        g.fillStyle = '#c9ccc4';
        g.fillRect(x0 + 4, y0 + 12, w * 0.2, h - 24);
        g.fillRect(x0 + w * 0.8 - 4, y0 + 12, w * 0.2, h - 24);
    });
}
