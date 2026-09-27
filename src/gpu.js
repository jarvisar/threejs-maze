/**
 * The graphics card's name, as the browser gives it: Chrome, Edge and the desktop app give the real one (through
 * WEBGL_debug_renderer_info), Firefox a near one ("NVIDIA GeForce GTX 980, or similar"), Safari just "Apple GPU".
 * @param {WebGL2RenderingContext} gl
 * @returns {string}
 */
export function gpuName(gl) {
    const name = String(gl.getParameter(gl.RENDERER) ?? '');
    // Chrome only names it through the extension (Firefox has the real one in RENDERER, and warns about the extension).
    if (name !== 'WebKit WebGL') return name;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : name;
}

// Graphics cards of their own, known to draw the ambient occlusion easily: NVIDIA's RTX cards and GTX 960 on, AMD's
// Radeon RX, Pro and VII cards, Intel's Arc A and B cards, and Apple's Pro, Max and Ultra chips.
const STRONG = [
    /\bRTX\b/,
    /\bGTX (9[6-8]0|10[5-8]0|16[5-6]0)/,
    /\bTITAN\b/i,
    /\bRadeon (RX|Pro|VII)\b/,
    /\bArc\b(\(TM\))? [AB]\d{3}/,
    /\bApple M\d+ (Pro|Max|Ultra)\b/,
];
// And what those match that isn't one: the graphics built into AMD's processors ("Radeon RX Vega 11 Graphics").
const WEAK = [/\bVega \d+ Graphics\b/, /\bRX Vega (3|6|8|9|10|11)\b/];

/**
 * Whether a graphics card is one known to draw the ambient occlusion without trouble (see STRONG). Everything else isn't
 * taken to be: phones and tablets, the Steam Deck, graphics built into a processor, software drawing, and anything the
 * browser won't name.
 * @param {string} name See gpuName.
 */
export function strongGpu(name) {
    return STRONG.some((pattern) => pattern.test(name)) && !WEAK.some((pattern) => pattern.test(name));
}
