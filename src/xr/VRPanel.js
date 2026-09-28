import { BackSide, CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3 } from 'three';

const CANVAS_WIDTH = 1024;
// How fast a card catches up with your view (per second). Head-locked text is hard to read and can make people
// sick, so it trails a little behind.
const FOLLOW_RATE = 7;
// Titles flicker on like the camcorder title on screen (see .osd-title in styles.css).
const FLICKER_SECONDS = 0.5;

const _target = new Vector3();
const _tilt = new Quaternion();
const _xAxis = new Vector3(1, 0, 0);

/**
 * Toast or camcorder title for VR. Page overlays don't show in a headset, so messages go on a floating card.
 * Defaults to the toast look (white text and border on dark glass), a bit below and in front of the eyes.
 */
export class VRPanel {
    /**
     * @param {object} [options]
     * @param {number} [options.width] Meters.
     * @param {number} [options.distance] Meters in front of the eyes.
     * @param {number} [options.drop] Meters below the eyes (negative is above).
     * @param {number} [options.fontSize] Canvas pixels.
     * @param {number} [options.lines] Max lines.
     * @param {boolean} [options.box] Draw the toast box. Without it the text gets a shadow like the title.
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
        /** New messages flicker on. */
        this.flicker = false;

        const height = Math.ceil((lines * this.lineHeight + 2 * this.paddingY + 8) / 4) * 4;
        this.canvas = document.createElement('canvas');
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = height;
        this.context = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
        this.texture = new CanvasTexture(this.canvas);

        this.mesh = new Mesh(
            new PlaneGeometry(width, (width * height) / CANVAS_WIDTH),
            // Always on top so a wall right in front of you can't hide it.
            new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false }),
        );
        this.mesh.name = 'vr message';
        this.mesh.renderOrder = 10;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        // Tilt to face the eyes.
        _tilt.setFromAxisAngle(_xAxis, -Math.atan2(drop, distance));
        this._tilt = _tilt.clone();

        /** @type {string | null} */
        this.message = null;
        this._age = 0;
        this._snap = true;
        // Redraw once the camcorder font loads, in case the first message used the fallback.
        document.fonts?.load(this.font).then(() => this.message && this._draw(this.message), () => {});
    }

    /** @param {string | null} message Null hides the card. */
    show(message) {
        if (message === this.message) return;
        // Snap in front when it first shows, then follow.
        if (this.message === null) this._snap = true;
        this.message = message;
        this._age = 0;
        this.mesh.visible = message !== null && !this.flicker;
        if (message !== null) this._draw(message);
    }

    /** Snaps in front of the eyes on the next `follow` without easing. */
    recentre() {
        this._snap = true;
    }

    /**
     * Eases the card toward its spot in front of the eyes. Call every frame.
     * @param {import('three').Object3D} viewer Eyes, in the same space as the card.
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
 * Fade to black or white (e.g. escaping a tape) for VR, as a small sphere around the eyes. Mirrors the page's
 * .fade in styles.css, which a headset can't show.
 */
export class VRFade {
    constructor() {
        this.mesh = new Mesh(
            new SphereGeometry(0.25, 16, 8),
            new MeshBasicMaterial({ color: 0x000000, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
        );
        this.mesh.name = 'vr fade';
        // Below the message cards so they still show through.
        this.mesh.renderOrder = 9;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.on = false;
        this.white = false;
        /** Skip the fade, for reduced motion. */
        this.instant = false;
        this._level = 0;
    }

    /**
     * @param {boolean} on
     * @param {'black' | 'white'} color Only used when fading out. Fading back in keeps the last color.
     */
    set(on, color) {
        if (on) this.white = color === 'white';
        this.on = on;
    }

    /** @param {number} dt */
    update(dt) {
        // Same timing as the page. 1.4 s out, slower back from white.
        const seconds = this.on ? 1.4 : this.white ? 2.6 : 1.4;
        const target = this.on ? 1 : 0;
        this._level = this.instant ? target : moveTowards(this._level, target, dt / seconds);
        const material = /** @type {MeshBasicMaterial} */ (this.mesh.material);
        // Ease in like the page.
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
    // Fractional steps can end up a hair short of the target.
    if (Math.abs(target - value) <= step + 1e-9) return target;
    return value < target ? value + step : value - step;
}

/** Splits on line breaks, then word-wraps each line to `maxWidth`. */
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
