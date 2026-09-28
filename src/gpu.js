/**
 * GPU name as reported by the browser. Chrome, Edge and the desktop app give the real one (via
 * WEBGL_debug_renderer_info). Firefox gives a close one ("NVIDIA GeForce GTX 980, or similar"). Safari just says
 * "Apple GPU".
 * @param {WebGL2RenderingContext} gl
 * @returns {string}
 */
export function gpuName(gl) {
    const name = String(gl.getParameter(gl.RENDERER) ?? '');
    // Chrome only gives the name through the extension. Firefox puts it in RENDERER and warns if you use the extension.
    if (name !== 'WebKit WebGL') return name;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : name;
}

// Dedicated GPUs known to run the game well over 60 fps. NVIDIA RTX and GTX 960 and up, AMD Radeon RX/Pro/VII,
// Intel Arc A and B, Apple Pro/Max/Ultra chips.
const DEDICATED = [
    /\bRTX\b/,
    /\bGTX (9[6-8]0|10[5-8]0|16[5-6]0)/,
    /\bTITAN\b/i,
    /\bRadeon (RX|Pro|VII)\b/,
    /\bArc\b(\(TM\))? [AB]\d{3}/,
    /\bApple M\d+ (Pro|Max|Ultra)\b/,
];
// False positives from the list above: AMD integrated graphics ("Radeon RX Vega 11 Graphics").
const BUILT_IN = [/\bVega \d+ Graphics\b/, /\bRX Vega (3|6|8|9|10|11)\b/];

/**
 * True for a GPU in DEDICATED. Those get no FPS limit by default. Phones, tablets, the Steam Deck, integrated and
 * software rendering, and unnamed GPUs all count as not dedicated.
 * @param {string} name See gpuName.
 */
export function dedicatedGpu(name) {
    return DEDICATED.some((pattern) => pattern.test(name)) && !BUILT_IN.some((pattern) => pattern.test(name));
}
