import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, NearestMipmapNearestFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { PARTY_PALETTE } from './party.js';
import { PARTY_ATLAS, PARTY_ATLAS_SIZE, PARTY_LETTERS } from './partyGeometry.js';
import { mulberry32 } from './random.js';

/*
 * Level Fun's pictures, drawn with the 2D canvas when the game loads: its wallpaper, and one texture with
 * everything else (wrapping paper, the frosting on a cake, crêpe paper, the flags' cloth, party hats, the
 * letters on the banner, the =) drawn on the walls, and the guests' faces). Drawn from fixed random seeds, so
 * they're the same on every load.
 */

const css = (hex, alpha = 1) => `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`;
const PAPER = PARTY_PALETTE.map((hex) => css(hex));

/**
 * Party wallpaper, in strips a quarter of a unit wide like the level's own: a warm cream with a faint stripe,
 * printed all over with confetti, streamers, little balloons, and now and then a =). It shares the level
 * wallpaper's offset (so the strips join where the peeling paper expects them to) and its blocky look far off.
 * @param {import('three').Texture} wallpaper The level's own.
 * @param {number} maxAnisotropy
 */
export function createPartyWallpaper(wallpaper, maxAnisotropy) {
    const TILE_W = 256;
    const TILE_H = 512;
    const tile = document.createElement('canvas');
    tile.width = TILE_W;
    tile.height = TILE_H;
    const g = /** @type {CanvasRenderingContext2D} */ (tile.getContext('2d'));
    const random = mulberry32(0xf00d);

    g.fillStyle = '#d9cca6';
    g.fillRect(0, 0, TILE_W, TILE_H);
    // Broad soft stripes, and a fine line down the middle of each.
    for (let x = 0; x < TILE_W; x += 64) {
        g.fillStyle = 'rgba(255, 246, 222, 0.22)';
        g.fillRect(x, 0, 32, TILE_H);
        g.fillStyle = 'rgba(150, 120, 90, 0.12)';
        g.fillRect(x + 47, 0, 2, TILE_H);
    }

    // The print, placed so nothing overlaps much, and wrapped round the tile's edges so it repeats seamlessly.
    const placed = [];
    const spot = (radius) => {
        for (let attempt = 0; attempt < 60; attempt++) {
            const x = random() * TILE_W;
            const y = random() * TILE_H;
            const clear = placed.every(([px, py, pr]) => {
                const dx = Math.min(Math.abs(px - x), TILE_W - Math.abs(px - x));
                const dy = Math.min(Math.abs(py - y), TILE_H - Math.abs(py - y));
                return Math.hypot(dx, dy) > pr + radius + 6;
            });
            if (clear) {
                placed.push([x, y, radius]);
                return [x, y];
            }
        }
        return null;
    };
    const wrapped = (x, y, draw) => {
        for (const dx of [-TILE_W, 0, TILE_W]) {
            for (const dy of [-TILE_H, 0, TILE_H]) {
                g.save();
                g.translate(x + dx, y + dy);
                draw();
                g.restore();
            }
        }
    };
    const color = () => PAPER[Math.floor(random() * PAPER.length)];

    for (let n = 0; n < 3; n++) {
        const at = spot(26);
        if (!at) continue;
        const fill = color();
        const turn = (random() - 0.5) * 0.5;
        wrapped(at[0], at[1], () => printBalloon(g, fill, turn));
    }
    {
        const at = spot(14);
        if (at) wrapped(at[0], at[1], () => printSmiley(g));
    }
    for (let n = 0; n < 6; n++) {
        const at = spot(9);
        if (!at) continue;
        const fill = color();
        const turn = random() * Math.PI;
        wrapped(at[0], at[1], () => printStar(g, fill, turn));
    }
    for (let n = 0; n < 6; n++) {
        const at = spot(12);
        if (!at) continue;
        const stroke = color();
        const turn = random() * Math.PI;
        wrapped(at[0], at[1], () => printSquiggle(g, stroke, turn));
    }
    for (let n = 0; n < 22; n++) {
        const at = spot(7);
        if (!at) continue;
        const fill = color();
        const turn = random() * Math.PI;
        const dot = random() < 0.35;
        wrapped(at[0], at[1], () => printConfetti(g, fill, turn, dot));
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const out = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    for (let x = 0; x < 1024; x += TILE_W) {
        for (let y = 0; y < 1024; y += TILE_H) out.drawImage(tile, x, y);
    }
    const texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = NearestMipmapNearestFilter;
    texture.anisotropy = Math.min(4, maxAnisotropy);
    // The same Vector2, so it moves with the level's wallpaper whenever that's set for a new world.
    texture.offset = wallpaper.offset;
    return texture;
}

/** A printed balloon on its string, a bit smudged the way cheap printing is. */
function printBalloon(g, fill, turn) {
    g.rotate(turn);
    g.strokeStyle = 'rgba(110, 90, 70, 0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 13);
    g.bezierCurveTo(6, 22, -6, 30, 2, 40);
    g.stroke();
    g.fillStyle = 'rgba(0, 0, 0, 0.08)';
    g.beginPath();
    g.ellipse(2, 2, 10, 12.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(0, 0, 10, 12.5, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-2.5, 13);
    g.lineTo(2.5, 13);
    g.lineTo(0, 10);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.55)';
    g.beginPath();
    g.ellipse(-3.5, -5, 2.2, 3.6, -0.5, 0, Math.PI * 2);
    g.fill();
}

/** The odd =) in the print: easy to miss, until you've seen one. */
function printSmiley(g) {
    g.rotate(-0.2);
    g.strokeStyle = 'rgba(96, 60, 56, 0.6)';
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-7, -3);
    g.lineTo(-1, -3);
    g.moveTo(-7, 3);
    g.lineTo(-1, 3);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 7, -1.1, 1.1);
    g.stroke();
}

function printStar(g, fill, turn) {
    g.rotate(turn);
    g.fillStyle = fill;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 7.5 : 3.2;
        const a = (k / 10) * Math.PI * 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
}

function printSquiggle(g, stroke, turn) {
    g.rotate(turn);
    g.strokeStyle = stroke;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const x = -11 + t * 22;
        const y = Math.sin(t * Math.PI * 3) * 3.5;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
    }
    g.stroke();
}

function printConfetti(g, fill, turn, dot) {
    g.fillStyle = fill;
    if (dot) {
        g.beginPath();
        g.arc(0, 0, 3.2, 0, Math.PI * 2);
        g.fill();
        return;
    }
    g.rotate(turn);
    g.fillRect(-5.5, -2, 11, 4);
}

/**
 * The texture for everything else (see PARTY_ATLAS). Its clear parts are given the colour of the strokes
 * drawn over them (white), so nothing gets a dark fringe as the GPU shrinks it; that needs the pixels as they
 * are, so it goes up as data rather than as the canvas.
 * @param {number} maxAnisotropy
 */
export function createPartyAtlas(maxAnisotropy) {
    const size = PARTY_ATLAS_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const random = mulberry32(0xca4e);
    const A = PARTY_ATLAS;

    fill(g, A.plain, '#ffffff');
    drawCrepe(g, A.crepe, random);
    drawFabric(g, A.fabric, random);
    drawStripes(g, A.stripes);
    drawDots(g, A.dots, random);
    drawStars(g, A.stars, random);
    drawCakeSide(g, A.cakeSide, random);
    drawCakeTop(g, A.cakeTop, random);
    drawGingham(g, A.cloth);
    drawHat(g, A.hatStripes, ['#f0609e', '#f4cc2e'], false);
    drawHat(g, A.hatStars, ['#2f6fd6', '#2cb8b0'], true);
    drawCup(g, A.cup);
    PARTY_LETTERS.forEach((letter, k) => drawLetter(g, A.letters(k), letter));
    for (let style = 0; style < 3; style++) drawScrawl(g, A.scrawl(style), style, random);
    drawFace(g, A.face);

    const image = g.getImageData(0, 0, size, size).data;
    // Flipped as it's copied, the way canvas textures are when they go up, so texture coordinates work the same.
    const data = new Uint8Array(size * size * 4);
    const row = size * 4;
    for (let y = 0; y < size; y++) data.set(image.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) data[i] = data[i + 1] = data[i + 2] = 255;
    }
    const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, maxAnisotropy);
    texture.needsUpdate = true;
    return texture;
}

/** A soft round glow, for the light of the candles. */
export function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 240, 200, 1)');
    gradient.addColorStop(0.25, 'rgba(255, 200, 120, 0.55)');
    gradient.addColorStop(0.6, 'rgba(255, 170, 90, 0.14)');
    gradient.addColorStop(1, 'rgba(255, 170, 90, 0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    return new CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------------------------- the atlas

function fill(g, [x0, y0, x1, y1], color) {
    g.fillStyle = color;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** Inside a picture's rectangle, with (0, 0) at its top left and nothing drawn outside it. */
function within(g, [x0, y0, x1, y1], draw) {
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    g.translate(x0, y0);
    draw(x1 - x0, y1 - y0);
    g.restore();
}

/** Crêpe paper (tinted by the streamer's colour): fine crinkles across it, and a little shading along each edge. */
function drawCrepe(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#f4f4f4';
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 2 + random() * 2) {
            g.fillStyle = `rgba(0, 0, 0, ${0.05 + random() * 0.1})`;
            g.fillRect(0, y, w, 1);
        }
        for (const [x, dir] of [[0, 1], [w, -1]]) {
            const shade = g.createLinearGradient(x, 0, x + dir * w * 0.25, 0);
            shade.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
            shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
            g.fillStyle = shade;
            g.fillRect(0, 0, w, h);
        }
    });
}

/** The cloth the flags are cut from (tinted): a faint weave, and a hem along the top. */
function drawFabric(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#f2f2f2';
        g.fillRect(0, 0, w, h);
        for (let k = 0; k < 900; k++) {
            g.fillStyle = `rgba(0, 0, 0, ${0.03 + random() * 0.05})`;
            g.fillRect(random() * w, random() * h, 1 + random() * 3, 1);
        }
        g.fillStyle = 'rgba(0, 0, 0, 0.14)';
        g.fillRect(0, 6, w, 3);
    });
}

/** Wrapping paper: candy stripes. */
function drawStripes(g, rect) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#f7f1ea';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#e8456f';
        for (let k = -h; k < w + h; k += 40) {
            g.beginPath();
            g.moveTo(k, 0);
            g.lineTo(k + 18, 0);
            g.lineTo(k + 18 + h, h);
            g.lineTo(k + h, h);
            g.fill();
        }
        g.fillStyle = 'rgba(255, 255, 255, 0.5)';
        for (let k = -h; k < w + h; k += 40) {
            g.fillRect(k + 26, 0, 3, h);
        }
    });
}

/** Wrapping paper: white spots on blue. */
function drawDots(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#2f62c4';
        g.fillRect(0, 0, w, h);
        for (let y = 16; y < h; y += 32) {
            for (let x = (y / 32) % 2 === 0 ? 16 : 32; x < w; x += 32) {
                g.fillStyle = random() < 0.2 ? '#f4cc2e' : '#f5f3ee';
                g.beginPath();
                g.arc(x, y, 7, 0, Math.PI * 2);
                g.fill();
            }
        }
    });
}

/** Wrapping paper: gold stars on purple. */
function drawStars(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#6f3fb8';
        g.fillRect(0, 0, w, h);
        for (let k = 0; k < 26; k++) {
            g.save();
            g.translate(random() * w, random() * h);
            g.rotate(random() * Math.PI);
            g.fillStyle = random() < 0.75 ? '#f2c434' : '#ffffff';
            g.beginPath();
            const r = 9 + random() * 7;
            for (let p = 0; p < 10; p++) {
                const a = (p / 10) * Math.PI * 2;
                const d = p % 2 === 0 ? r : r * 0.42;
                g.lineTo(Math.cos(a) * d, Math.sin(a) * d);
            }
            g.closePath();
            g.fill();
            g.restore();
        }
    });
}

/**
 * The side of a cake, all the way round (tinted by the frosting's colour): the frosting, drips from the top, a
 * piped border along the top and the bottom, and sprinkles.
 */
function drawCakeSide(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#f6efe6';
        g.fillRect(0, 0, w, h);
        // A band of the sponge showing through low down.
        g.fillStyle = 'rgba(214, 170, 120, 0.25)';
        g.fillRect(0, h * 0.62, w, h * 0.08);
        // Drips from the top.
        g.fillStyle = '#fbf8f4';
        for (let x = 0; x < w; x += 18 + random() * 22) {
            const length = h * (0.18 + random() * 0.3);
            const width = 7 + random() * 7;
            g.fillRect(x, 0, width, length);
            g.beginPath();
            g.arc(x + width / 2, length, width / 2, 0, Math.PI * 2);
            g.fill();
        }
        g.fillStyle = 'rgba(0, 0, 0, 0.06)';
        g.fillRect(0, h * 0.32, w, 2);
        // Piping: a row of beads along the top and the bottom.
        for (const y of [8, h - 9]) {
            for (let x = 6; x < w; x += 13) {
                g.fillStyle = '#ffffff';
                g.beginPath();
                g.arc(x, y, 7, 0, Math.PI * 2);
                g.fill();
                g.fillStyle = 'rgba(0, 0, 0, 0.12)';
                g.beginPath();
                g.arc(x + 2, y + 3, 4, 0, Math.PI);
                g.fill();
            }
        }
        sprinkles(g, 0, 18, w, h - 34, 170, random);
    });
}

/** The top of a cake (tinted): rosettes round the edge, sprinkles, and a =) piped across the middle. */
function drawCakeTop(g, rect, random) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#f6efe6';
        g.fillRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        sprinkles(g, cx - w * 0.38, cy - h * 0.38, w * 0.76, h * 0.76, 90, random, cx, cy, w * 0.36);
        for (let k = 0; k < 22; k++) {
            const a = (k / 22) * Math.PI * 2;
            const x = cx + Math.cos(a) * w * 0.43;
            const y = cy + Math.sin(a) * h * 0.43;
            g.fillStyle = '#ffffff';
            g.beginPath();
            g.arc(x, y, 9, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = 'rgba(0, 0, 0, 0.12)';
            g.lineWidth = 2;
            g.beginPath();
            g.arc(x, y, 5, 0.5, 4.5);
            g.stroke();
        }
        // =), in icing.
        g.strokeStyle = '#d5457c';
        g.lineWidth = 9;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx - 44, cy - 16);
        g.lineTo(cx - 10, cy - 16);
        g.moveTo(cx - 44, cy + 16);
        g.lineTo(cx - 10, cy + 16);
        g.stroke();
        g.beginPath();
        g.arc(cx + 2, cy, 36, -1.05, 1.05);
        g.stroke();
    });
}

/** Sprinkles, in a rectangle (or, given a centre and radius, a circle). */
function sprinkles(g, x, y, w, h, count, random, cx = NaN, cy = NaN, radius = Infinity) {
    for (let k = 0; k < count; k++) {
        const px = x + random() * w;
        const py = y + random() * h;
        if (Math.hypot(px - cx, py - cy) > radius) continue;
        g.save();
        g.translate(px, py);
        g.rotate(random() * Math.PI);
        g.fillStyle = PAPER[Math.floor(random() * PAPER.length)];
        g.fillRect(-4, -1.5, 8, 3);
        g.restore();
    }
}

/** A tablecloth: pink gingham. */
function drawGingham(g, rect) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#fbf3f3';
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(226, 88, 128, 0.45)';
        for (let k = 0; k < w; k += 32) g.fillRect(k, 0, 16, h);
        for (let k = 0; k < h; k += 32) g.fillRect(0, k, w, 16);
    });
}

/** A party hat, unrolled: stripes round it (or stars), and a zigzag trim at its brim (the bottom). */
function drawHat(g, rect, [a, b], stars) {
    within(g, rect, (w, h) => {
        g.fillStyle = a;
        g.fillRect(0, 0, w, h);
        if (stars) {
            for (let y = 24; y < h - 30; y += 44) {
                for (let x = (y / 44) % 2 < 1 ? 16 : 40; x < w; x += 48) {
                    g.fillStyle = '#f4cc2e';
                    g.beginPath();
                    for (let p = 0; p < 10; p++) {
                        const angle = (p / 10) * Math.PI * 2 - Math.PI / 2;
                        const d = p % 2 === 0 ? 13 : 5.5;
                        g.lineTo(x + Math.cos(angle) * d, y + Math.sin(angle) * d);
                    }
                    g.fill();
                }
            }
        } else {
            g.fillStyle = b;
            for (let k = -h; k < w + h; k += 48) {
                g.beginPath();
                g.moveTo(k, h);
                g.lineTo(k + 22, h);
                g.lineTo(k + 22 + h * 0.6, 0);
                g.lineTo(k + h * 0.6, 0);
                g.fill();
            }
            g.fillStyle = '#ffffff';
            for (let k = 12; k < w; k += 32) {
                g.beginPath();
                g.arc(k, h * 0.35 + ((k / 32) % 2) * 30, 5, 0, Math.PI * 2);
                g.fill();
            }
        }
        g.fillStyle = b;
        g.fillRect(0, h - 22, w, 22);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(0, h - 22);
        for (let x = 0; x <= w; x += 12) g.lineTo(x, h - 22 + ((x / 12) % 2 === 0 ? 0 : 9));
        g.lineTo(w, h - 26);
        g.lineTo(0, h - 26);
        g.fill();
    });
}

/** A red plastic cup: white inside the rim (the top), faint ridges down it. */
function drawCup(g, rect) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#d8262e';
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(0, 0, 0, 0.12)';
        for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h);
        g.fillStyle = 'rgba(255, 255, 255, 0.18)';
        g.fillRect(0, h * 0.55, w, 3);
        g.fillStyle = '#f3f1ee';
        g.fillRect(0, 0, w, h * 0.16);
    });
}

/** A letter for the banner, white, as if cut out and stuck on. */
function drawLetter(g, rect, letter) {
    within(g, rect, (w, h) => {
        g.fillStyle = '#ffffff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `bold ${Math.round(w * 0.95)}px "Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif`;
        if (letter === '=' || letter === ')') {
            // Drawn rather than typed, so the =) looks like the ones on the walls.
            g.strokeStyle = '#ffffff';
            g.lineWidth = w * 0.14;
            g.lineCap = 'round';
            g.beginPath();
            if (letter === '=') {
                g.moveTo(w * 0.22, h * 0.38);
                g.lineTo(w * 0.78, h * 0.38);
                g.moveTo(w * 0.22, h * 0.62);
                g.lineTo(w * 0.78, h * 0.62);
            } else {
                g.arc(w * 0.18, h * 0.5, w * 0.52, -0.95, 0.95);
            }
            g.stroke();
            return;
        }
        g.fillText(letter, w / 2, h * 0.52, w * 0.92);
    });
}

/**
 * =) on a wall (white; the ink is the vertex colour): in marker, in crayon, or drawn as a face in a circle.
 * Wobbly on purpose, like someone did it quickly.
 */
function drawScrawl(g, rect, style, random) {
    within(g, rect, (w, h) => {
        const wobble = () => (random() - 0.5) * 6;
        g.strokeStyle = '#ffffff';
        g.lineCap = 'round';
        g.lineJoin = 'round';
        const stroke = (width, draw) => {
            if (style === 1) {
                // Crayon: many thin, broken passes.
                for (let pass = 0; pass < 5; pass++) {
                    g.lineWidth = width * 0.3;
                    g.setLineDash([6 + random() * 10, 2 + random() * 4]);
                    g.beginPath();
                    g.save();
                    g.translate((random() - 0.5) * width * 0.6, (random() - 0.5) * width * 0.6);
                    draw();
                    g.restore();
                    g.stroke();
                }
                g.setLineDash([]);
            } else {
                g.lineWidth = width;
                g.beginPath();
                draw();
                g.stroke();
            }
        };
        const cx = w / 2;
        const cy = h / 2;
        if (style === 2) {
            // A face in a circle: the =) stood up, two lines for eyes and the smile under them.
            stroke(10, () => g.ellipse(cx, cy, w * 0.4 + wobble(), h * 0.38 + wobble(), random() * 0.3, 0, Math.PI * 2));
            stroke(11, () => {
                g.moveTo(cx - 26 + wobble(), cy - 52);
                g.lineTo(cx - 24 + wobble(), cy - 10);
                g.moveTo(cx + 26 + wobble(), cy - 52);
                g.lineTo(cx + 24 + wobble(), cy - 10);
            });
            stroke(11, () => {
                g.moveTo(cx - 58, cy + 8);
                g.quadraticCurveTo(cx + wobble(), cy + 78 + wobble(), cx + 58, cy + 8);
            });
            return;
        }
        stroke(16, () => {
            g.moveTo(cx - 70 + wobble(), cy - 26 + wobble());
            g.lineTo(cx - 12 + wobble(), cy - 28 + wobble());
            g.moveTo(cx - 70 + wobble(), cy + 24 + wobble());
            g.lineTo(cx - 12 + wobble(), cy + 22 + wobble());
        });
        stroke(16, () => {
            g.moveTo(cx + 18, cy - 70);
            g.quadraticCurveTo(cx + 88 + wobble(), cy + wobble(), cx + 18, cy + 70);
        });
    });
}

/**
 * A guest's face (white; the guests' is dark, and the one the thing on a tape wears is chalk): =) turned on
 * its side, so the = is two eyes and the ) a wide smile.
 */
function drawFace(g, rect) {
    within(g, rect, (w, h) => {
        g.strokeStyle = '#ffffff';
        g.lineCap = 'round';
        g.lineWidth = w * 0.07;
        g.beginPath();
        g.moveTo(w * 0.36, h * 0.22);
        g.lineTo(w * 0.37, h * 0.42);
        g.moveTo(w * 0.64, h * 0.22);
        g.lineTo(w * 0.63, h * 0.42);
        g.stroke();
        g.beginPath();
        g.arc(w * 0.5, h * 0.4, w * 0.3, 0.35, Math.PI - 0.35);
        g.stroke();
    });
}
