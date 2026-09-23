import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

// The card is drawn on a canvas this big, shown this many metres wide, below and in front of the eyes.
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 256;
const WIDTH = 0.5;
const DISTANCE = 0.8;
const DROP = 0.16;

const FONT_SIZE = 36;
const LINE_HEIGHT = FONT_SIZE * 1.4;
const PADDING_X = 40;
const PADDING_Y = 22;
const FONT = `${FONT_SIZE}px 'VCR OSD Mono', ui-monospace, monospace`;

/**
 * The toast box, for VR: the page's own overlays can't be seen in a headset, so messages are drawn onto a
 * small card that floats in front of you. Looks like the toast (white text, white border, dark glass).
 */
export class VRPanel {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = CANVAS_WIDTH;
        this.canvas.height = CANVAS_HEIGHT;
        this.context = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
        this.texture = new CanvasTexture(this.canvas);

        this.mesh = new Mesh(
            new PlaneGeometry(WIDTH, (WIDTH * CANVAS_HEIGHT) / CANVAS_WIDTH),
            // Always drawn on top: a wall right in front of you shouldn't hide it.
            new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, fog: false }),
        );
        this.mesh.name = 'vr message';
        this.mesh.position.set(0, -DROP, -DISTANCE);
        // Tilted to face the eyes.
        this.mesh.rotation.x = -Math.atan2(DROP, DISTANCE);
        this.mesh.renderOrder = 10;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;

        /** @type {string | null} */
        this.message = null;
        // Redraw once the camcorder font is ready, in case the first message went out in the fallback.
        document.fonts?.load(FONT).then(() => this.message && this._draw(this.message), () => {});
    }

    /** @param {string | null} message Null hides the card. */
    show(message) {
        if (message === this.message) return;
        this.message = message;
        this.mesh.visible = message !== null;
        if (message !== null) this._draw(message);
    }

    _draw(message) {
        const context = this.context;
        context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        context.font = FONT;
        const lines = wrap(context, message, CANVAS_WIDTH - 2 * PADDING_X - 8);
        const maxLines = Math.floor((CANVAS_HEIGHT - 2 * PADDING_Y - 8) / LINE_HEIGHT);
        lines.length = Math.min(lines.length, maxLines);

        const width = Math.max(...lines.map((line) => context.measureText(line).width)) + 2 * PADDING_X;
        const height = lines.length * LINE_HEIGHT + 2 * PADDING_Y;
        const x = (CANVAS_WIDTH - width) / 2;
        const y = (CANVAS_HEIGHT - height) / 2;

        context.beginPath();
        context.roundRect(x, y, width, height, 20);
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.fill();
        context.lineWidth = 4;
        context.strokeStyle = '#fff';
        context.stroke();

        context.fillStyle = '#fff';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        lines.forEach((line, i) => context.fillText(line, CANVAS_WIDTH / 2, y + PADDING_Y + (i + 0.5) * LINE_HEIGHT));
        this.texture.needsUpdate = true;
    }
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
