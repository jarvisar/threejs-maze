// Starts the desktop app from the repository: `npm run desktop` (the web build in dist/) or, with --dev,
// `npm run desktop:dev` (Vite's dev server, so edits to the game reload in the window as they do in a browser;
// changes to desktop/ itself need a restart). Anything else on the command line goes to the app (--fullscreen,
// --windowed, --devtools).
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const env = { ...process.env };
// Set in VS Code's own processes (tasks, extensions); with it, Electron runs as plain Node and can't open a window.
delete env.ELECTRON_RUN_AS_NODE;

let server = null;
if (dev) {
    const { createServer } = await import('vite');
    server = await createServer({ root: fileURLToPath(new URL('../../', import.meta.url)) });
    await server.listen();
    server.printUrls();
    env.BACKROOMS_DEV_SERVER = server.resolvedUrls.local[0];
}

// No trailing slash: on Windows, a quoted argument ending in a backslash swallows its closing quote.
const appDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
const app = spawn(electron, [appDir, ...args.filter((arg) => arg !== '--dev')], { stdio: 'inherit', env });
app.on('exit', async (code) => {
    await server?.close();
    process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.kill());
