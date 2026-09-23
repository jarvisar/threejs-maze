import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Run only when the artwork changes. The generated assets are checked in;
// normal builds do not need a browser or an image processing dependency.
const root = new URL('../', import.meta.url);
const output = new URL('public/', root);
const source = await readFile(new URL('icons/backrooms.svg', output), 'utf8');
const square = source.replace('rx="96"', 'rx="0"');
// All foreground artwork fits inside the central 80%-diameter safe circle.
const maskable = square.replace('<g id="corridor">', '<g id="corridor" transform="translate(256 256) scale(.8) translate(-256 -256)">');
await mkdir(new URL('social/', output), { recursive: true });
await writeFile(new URL('icons/backrooms-maskable.svg', output), maskable);

const browser = await chromium.launch();
try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    async function render(svg, width, height = width) {
        await page.setViewportSize({ width, height });
        await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
        await page.evaluate(() => document.fonts.ready);
        return page.screenshot({ omitBackground: true });
    }
    const sizes = [16, 32, 48];
    const faviconFrames = [];
    for (const size of sizes) {
        const png = await render(source, size);
        faviconFrames.push(png);
        await writeFile(new URL(`icons/favicon-${size}x${size}.png`, output), png);
    }
    for (const size of [192, 512]) {
        await writeFile(new URL(`icons/android-chrome-${size}x${size}.png`, output), await render(source, size));
        await writeFile(new URL(`icons/maskable-${size}x${size}.png`, output), await render(maskable, size));
    }
    await writeFile(new URL('icons/apple-touch-icon.png', output), await render(square, 180));

    // An ICO directory followed by PNG frames, one for each native tab size.
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    faviconFrames.forEach((png, i) => {
        const entry = 6 + i * 16;
        header[entry] = sizes[i];
        header[entry + 1] = sizes[i];
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(png.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += png.length;
    });
    await writeFile(new URL('favicon.ico', output), Buffer.concat([header, ...faviconFrames]));

    const font = await readFile(new URL('src/assets/fonts/vcr-osd-mono.woff2', root));
    const mark = source.match(/<g id="corridor">[\s\S]*<\/g>/)[0];
    const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <title>Backrooms Simulator</title>
  <defs>
    <style>@font-face{font-family:VCR;src:url(data:font/woff2;base64,${font.toString('base64')})}text{font-family:VCR,monospace}</style>
    <pattern id="lines" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H4" stroke="#000" stroke-opacity=".12"/></pattern>
    <radialGradient id="glow"><stop stop-color="#50482b"/><stop offset="1" stop-color="#15150e"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#15150e"/>
  <rect x="654" width="546" height="630" fill="url(#glow)"/>
  <g transform="translate(652 59)">${mark}</g>
  <path d="M48 104V48H104M1096 48H1152V104M48 526V582H104M1096 582H1152V526" fill="none" stroke="#8b824e" stroke-width="2"/>
  <circle cx="88" cy="92" r="7" fill="#c76b51"/>
  <text x="108" y="100" fill="#dfce7b" font-size="24">REC</text>
  <text x="76" y="264" fill="#eee0a2" font-size="76">BACKROOMS</text>
  <text x="80" y="326" fill="#dfce7b" font-size="48" letter-spacing="5">SIMULATOR</text>
  <path d="M80 362H224" stroke="#8b824e" stroke-width="2"/>
  <text x="80" y="405" fill="#b7ae86" font-size="24">The endless level.</text>
  <text x="80" y="548" fill="#8b824e" font-size="19" letter-spacing="2">LEVEL 0 / NO SIGNAL</text>
  <rect width="1200" height="630" fill="url(#lines)"/>
</svg>`;
    await writeFile(new URL('social/backrooms-card.svg', output), card);
    await writeFile(new URL('social/backrooms-card.png', output), await render(card, 1200, 630));
    console.log(`Generated Backrooms icons and share artwork in ${fileURLToPath(output)}`);
} finally {
    await browser.close();
}
