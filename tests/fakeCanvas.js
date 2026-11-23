import { createHash } from 'node:crypto';

/*
 * A stand-in for 2D canvases, for drawing code run in Node. Each canvas keeps a running hash of every call and
 * property write made to it, in order, so two canvases drawn the same way have the same digest. Pixel data passed to
 * putImageData is hashed too.
 */

const METHODS = new Set(['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'clip', 'translate', 'rotate', 'scale',
    'setTransform', 'resetTransform', 'transform', 'fillText', 'strokeText', 'drawImage', 'putImageData', 'setLineDash']);
const DEFAULTS = { globalAlpha: 1, font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, textAlign: 'start',
    textBaseline: 'alphabetic', globalCompositeOperation: 'source-over', lineCap: 'butt', lineJoin: 'miter', filter: 'none',
    shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true, letterSpacing: '0px',
    miterLimit: 10, lineDashOffset: 0, direction: 'inherit' };

const hashBytes = (data) => createHash('sha1').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex').slice(0, 12);

export class FakeCanvas {
    /** @param {string | null} owner Whatever was being drawn when it was made (see fakeDocument). */
    constructor(owner) {
        this.owner = owner;
        this.width = 300;
        this.height = 150;
        this.hash = createHash('sha1');
        this.calls = 0;
        this.context = null;
    }

    log(text) {
        this.hash.update(`${text}\n`);
        this.calls++;
    }

    digest() {
        return `${this.width}x${this.height}:${this.calls}:${this.hash.copy().digest('hex').slice(0, 16)}`;
    }

    getContext(type) {
        if (type !== '2d') throw new Error(`no ${type} context`);
        this.context ??= this._makeContext();
        return this.context;
    }

    _makeContext() {
        const canvas = this;
        const state = {};
        let objects = 0;
        const text = (v) => {
            if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
            if (typeof v === 'string') return JSON.stringify(v);
            if (v === undefined || v === null || typeof v === 'boolean') return String(v);
            if (v instanceof FakeCanvas) return `canvas(${v.digest()})`;
            if (v.fake) return v.fake;
            if (v.data instanceof Uint8ClampedArray) return `image(${v.width}x${v.height}:${hashBytes(v.data)})`;
            if (Array.isArray(v)) return `[${v.map(text).join(',')}]`;
            return `obj(${JSON.stringify(v)})`;
        };
        const object = (kind, args) => {
            const name = `${kind}#${objects++}`;
            canvas.log(`${kind} ${name} ${args.map(text).join(' ')}`);
            return { fake: name, addColorStop: (o, c) => canvas.log(`${name}.addColorStop ${text(o)} ${text(c)}`), setTransform: () => canvas.log(`${name}.setTransform`) };
        };
        const imageData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        return new Proxy({}, {
            get(_, name) {
                if (name === 'canvas') return canvas;
                if (typeof name !== 'string') return undefined;
                if (METHODS.has(name)) return (...args) => canvas.log(`${name} ${args.map(text).join(' ')}`);
                if (['createLinearGradient', 'createRadialGradient', 'createConicGradient', 'createPattern'].includes(name)) return (...args) => object(name, args);
                if (name === 'createImageData') {
                    return (w, h) => {
                        if (typeof w === 'object') ({ width: w, height: h } = w);
                        canvas.log(`createImageData ${w} ${h}`);
                        return imageData(w, h);
                    };
                }
                if (name === 'getImageData') {
                    return (x, y, w, h) => {
                        canvas.log(`getImageData ${x} ${y} ${w} ${h}`);
                        return imageData(w, h);
                    };
                }
                if (name === 'measureText') {
                    return (words) => {
                        const font = state.font ?? DEFAULTS.font;
                        canvas.log(`measureText ${text(words)} font=${text(font)}`);
                        const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
                        const width = words.length * size * 0.55;
                        return { width, actualBoundingBoxAscent: size * 0.7, actualBoundingBoxDescent: size * 0.2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 };
                    };
                }
                if (name === 'getLineDash') return () => [];
                if (name === 'getTransform') {
                    return () => {
                        canvas.log('getTransform');
                        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
                    };
                }
                if (name in state) return state[name];
                if (name in DEFAULTS) return DEFAULTS[name];
                throw new Error(`fake canvas has no ${name}`);
            },
            set(_, name, value) {
                state[name] = value;
                canvas.log(`set ${String(name)} = ${text(value)}`);
                return true;
            },
        });
    }
}

/**
 * A `document` whose canvases are FakeCanvas. Each is tagged with `owner()` at the time it's made, and kept in
 * `canvases`.
 * @param {() => string | null} [owner]
 */
export function fakeDocument(owner = () => null) {
    /** @type {FakeCanvas[]} */
    const canvases = [];
    return {
        canvases,
        createElement(tag) {
            if (tag !== 'canvas') throw new Error(`fake document can't make a ${tag}`);
            const canvas = new FakeCanvas(owner());
            canvases.push(canvas);
            return canvas;
        },
    };
}
