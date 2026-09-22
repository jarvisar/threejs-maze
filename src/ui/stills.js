import { formatDateStamp } from './Hud.js';

/**
 * Saves what's on screen as a PNG, with the camcorder's date stamp burned into the corner the way it was on
 * a real tape. Call it right after rendering a frame, before the browser clears the WebGL canvas.
 *
 * @param {HTMLCanvasElement} source The WebGL canvas.
 * @param {number} seed Goes into the file name.
 */
export function saveStill(source, seed) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    g.drawImage(source, 0, 0);

    const now = new Date();
    const { date, time } = formatDateStamp(now);
    const size = Math.max(10, Math.round(canvas.height * 0.045));
    const shadow = Math.max(1, Math.round(size / 12));
    g.font = `${size}px 'VCR OSD Mono', monospace`;
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    const x = canvas.width - size;
    const y = canvas.height - size * 0.8;
    for (const [text, dy] of [[date, 0], [time, -size * 1.15]]) {
        g.fillStyle = 'rgba(0, 0, 0, 0.55)';
        g.fillText(text, x + shadow, y + dy + shadow);
        g.fillStyle = '#f2f2ea';
        g.fillText(text, x, y + dy);
    }

    const pad = (n) => String(n).padStart(2, '0');
    const name = `backrooms-${seed}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
    canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }, 'image/png');
}
