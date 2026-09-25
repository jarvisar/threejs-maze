import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALLOWED_PERMISSIONS, CONTENT_SECURITY_POLICY, PERMISSION_APIS } from '../desktop/policy.js';

// The desktop app (desktop/) refuses any permission it hasn't been told about, and anything from outside the app
// itself. These catch a change to the game that would work in a browser but quietly not in the desktop app.
// See "Keeping the desktop app in step" in desktop/README.md.

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const sources = [
    { file: 'index.html', code: html },
    ...readdirSync(new URL('src/', root), { recursive: true })
        .map((path) => path.replaceAll('\\', '/'))
        .filter((path) => path.endsWith('.js') && path !== 'sw.js')
        .map((path) => ({ file: `src/${path}`, code: readFileSync(new URL(`src/${path}`, root), 'utf8') })),
];

describe('desktop app', () => {
    it('allows every permission the game asks for', () => {
        const missing = [];
        for (const { file, code } of sources) {
            for (const { api, permission } of PERMISSION_APIS) {
                if (api.test(code) && !ALLOWED_PERMISSIONS.has(permission)) {
                    missing.push(`${file} uses ${api.source}: add '${permission}' to ALLOWED_PERMISSIONS in desktop/policy.js`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('loads nothing from the internet, which its Content-Security-Policy would block', () => {
        expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
        const remote = [];
        // Anything index.html loads (links people click, <a href>, are fine: they open in the browser).
        for (const [tag] of html.matchAll(/<(script|img|iframe|audio|video|source|link)\b[^>]*>/g)) {
            if (/^<link\b/.test(tag) && !/\brel="[^"]*\b(stylesheet|icon|preload|modulepreload|manifest|apple-touch-icon|mask-icon)\b/.test(tag)) continue;
            if (/\b(src|href)="(https?:)?\/\//.test(tag)) remote.push(`index.html: ${tag}`);
        }
        // And anything fetched or imported from a full URL in the code.
        for (const { file, code } of sources.slice(1)) {
            for (const [call] of code.matchAll(/\b(fetch|import|importScripts|new (Worker|Audio|EventSource|WebSocket))\s*\(\s*['"`](https?:|wss?:)?\/\/[^'"`]*/g)) {
                remote.push(`${file}: ${call}`);
            }
        }
        expect(remote).toEqual([]);
    });
});
