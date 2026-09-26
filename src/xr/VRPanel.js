import { BackSide, CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3 } from 'three';

// Cards are drawn on a canvas this wide.
const CANVAS_WIDTH = 1024;
// How quickly a card catches up with where you're looking (per second). Fixed to your head, text is hard to read
// and easy to feel sick from; trailing a little behind, it settles in front of you.
const FOLLOW_RATE = 7;
// A title flickers on, the way the camcorder's does on the screen (see .osd-title in styles.css).
const FLICKER_SECONDS = 0.5;

const _target = new Vector3();
const _tilt = new Quaternion();
const _xAxis = new Vector3(1, 0, 0);

/**
 * The toast box (or the camcorder's title), for VR: the page's own overlays can't be seen in a headset, so
 * messages are drawn onto a card that floats in front of you. By default it looks like the toast (white text,
 * white border, dark glass), below and in front of the eyes.
 */
export class VRPanel {
    /**
     * @param {object} [options]
     * @param {number} [options.width] Metres.
     * @param {number} [options.distance] Metres in front of the eyes.
     * @param {number} [options.drop] Metres below them (negative is above).
     * @param {number} [options.fontSize] Canvas pixels.
     * @param {number} [options.lines] The most lines it has room for.
     * @param {boolean} [options.box] Drawn in the toast's box; without one, the text has a shadow, like the title.
     */
    constructor({ width = 0.5, distance = 0.8, drop = 0.16, fontSize = 36, lines = 7, box = true } = {}) {
        this.fontSize = fontSize;
        this.lineHeight = fontSize * 1.4;
        this.paddingX = box ? 40 : 16;
        this.paddingY = box ? 22 : 12;
        this.font = `${fontSize}px 'VCR OSD Mono', ui-monospace, monospace`;
        this.box = box;
        this.maxLines = lines;
        this.distance = distance;
        this.drop = drop;
        /** Whether a new message flickers on. */
        this.flicker = false;

        const height = Math.ceil((lines * this.lineHeight + 2 * this.paddingY + 8) / 4) * 4;
        this.canvas = document.createElement('canvas');
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = height;
        this.context = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
        this.texture = new CanvasTexture(this.canvas);

        this.mesh = new Mesh(
            new PlaneGeometry(width, (width * height) / CANVAS_WIDTH),
            // Always drawn on top: a wall right in front of you shouldn't hide it.
            new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false }),
        );
        this.mesh.name = 'vr message';
        this.mesh.renderOrder = 10;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        // Tilted to face the eyes.
        _tilt.setFromAxisAngle(_xAxis, -Math.atan2(drop, distance));
        this._tilt = _tilt.clone();

        /** @type {string | null} */
        this.message = null;
        this._age = 0;
        this._snap = true;
        // Redraw once the camcorder font is ready, in case the first message went out in the fallback.
        document.fonts?.load(this.font).then(() => this.message && this._draw(this.message), () => {});
    }

    /** @param {string | null} message Null hides the card. */
    show(message) {
        if (message === this.message) return;
        // Straight in front of you when it comes up; after that it follows.
        if (this.message === null) this._snap = true;
        this.message = message;
        this._age = 0;
        this.mesh.visible = message !== null && !this.flicker;
        if (message !== null) this._draw(message);
    }

    /** Puts the card straight in front of the eyes on the next `follow`, instead of easing there. */
    recentre() {
        this._snap = true;
    }

    /**
     * Moves the card towards its place in front of the eyes. Call every frame.
     * @param {import('three').Object3D} viewer The eyes, in the same space as the card.
     * @param {number} dt
     */
    follow(viewer, dt) {
        if (this.message === null) return;
        this._age += dt;
        if (this.flicker) {
            const t = this._age / FLICKER_SECONDS;
            this.mesh.visible = t >= 0.75 || Math.floor(t / 0.15) % 2 === 1;
        }
        _target.set(0, -this.drop, -this.distance).applyQuaternion(viewer.quaternion).add(viewer.position);
        const t = this._snap ? 1 : 1 - Math.exp(-FOLLOW_RATE * dt);
        this._snap = false;
        this.mesh.position.lerp(_target, t);
        this.mesh.quaternion.slerp(_tilt.copy(viewer.quaternion).multiply(this._tilt), t);
    }

    _draw(message) {
        const context = this.context;
        const { width, height } = this.canvas;
        context.clearRect(0, 0, width, height);
        context.font = this.font;
        if ('letterSpacing' in context) context.letterSpacing = this.box ? '0px' : '0.08em';
        const lines = wrap(context, message, width - 2 * this.paddingX - 8);
        lines.length = Math.min(lines.length, this.maxLines);

        const boxWidth = Math.max(...lines.map((line) => context.measureText(line).width)) + 2 * this.paddingX;
        const boxHeight = lines.length * this.lineHeight + 2 * this.paddingY;
        const x = (width - boxWidth) / 2;
        const y = (height - boxHeight) / 2;

        if (this.box) {
            context.beginPath();
            context.roundRect(x, y, boxWidth, boxHeight, 20);
            context.fillStyle = 'rgba(0, 0, 0, 0.5)';
            context.fill();
            context.lineWidth = 4;
            context.strokeStyle = '#fff';
            context.stroke();
        }

        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const shadow = Math.round(this.fontSize * 0.06);
        lines.forEach((line, i) => {
            const lineY = y + this.paddingY + (i + 0.5) * this.lineHeight;
            if (!this.box) {
                context.fillStyle = 'rgba(0, 0, 0, 0.6)';
                context.fillText(line, width / 2 + shadow, lineY + shadow);
            }
            context.fillStyle = '#fff';
            context.fillText(line, width / 2, lineY);
        });
        this.texture.needsUpdate = true;
    }
}

/**
 * The picture going to black or white (the way out of a tape), for VR: a sphere just round the eyes. Follows
 * the page's fade (see .fade in styles.css), which a headset can't see.
 */
export class VRFade {
    constructor() {
        this.mesh = new Mesh(
            new SphereGeometry(0.25, 16, 8),
            new MeshBasicMaterial({ color: 0x000000, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
        );
        this.mesh.name = 'vr fade';
        // Under the message cards, which still show through it.
        this.mesh.renderOrder = 9;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.on = false;
        this.white = false;
        /** Straight to the new state, without fading (for reduced motion). */
        this.instant = false;
        this._level = 0;
    }

    /**
     * @param {boolean} on
     * @param {'black' | 'white'} color Which, going out (coming back is from whichever it went to).
     */
    set(on, color) {
        if (on) this.white = color === 'white';
        this.on = on;
    }

    /** @param {number} dt */
    update(dt) {
        // As long as the page's: 1.4s out, and back from white more slowly.
        const seconds = this.on ? 1.4 : this.white ? 2.6 : 1.4;
        const target = this.on ? 1 : 0;
        this._level = this.instant ? target : moveTowards(this._level, target, dt / seconds);
        const material = /** @type {MeshBasicMaterial} */ (this.mesh.material);
        // Easing in, as the page's does.
        material.opacity = this._level * this._level;
        material.color.setHex(this.white ? 0xffffff : 0x000000);
        this.mesh.visible = this._level > 0;
    }

    clear() {
        this.on = false;
        this._level = 0;
        this.mesh.visible = false;
    }
}

function moveTowards(value, target, step) {
    // (Stepping by fractions of a duration can land a hair short of the end.)
    if (Math.abs(target - value) <= step + 1e-9) return target;
    return value < target ? value + step : value - step;
}

/** Splits the message at its line breaks, then wraps each line at spaces to fit `maxWidth`. */
function wrap(context, message, maxWidth) {
    const lines = [];
    for (const paragraph of message.split('\n')) {
        let line = '';
        for (const word of paragraph.split(' ')) {
            const next = line ? `${line} ${word}` : word;
            if (line && context.measureText(next).width > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = next;
            }
        }
        lines.push(line);
    }
    return lines;
}
