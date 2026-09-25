// Serves a folder of builds (desktop/release/ by default) as an update feed, to try updates out before releasing:
//
//   node desktop/scripts/serve-updates.mjs [folder] [--port 8765]
//
// then start an installed or packaged build with BACKROOMS_UPDATE_FEED set to the address it prints. The folder needs
// the latest*.yml files electron-builder writes next to the builds, and the builds they name.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8765;
const folder = resolve(args.find((arg, i) => !arg.startsWith('--') && i !== portIndex + 1) ?? new URL('../release/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));

createServer((request, response) => {
    // Only files directly in the folder, by name.
    const name = basename(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    let size;
    try {
        size = statSync(join(folder, name)).size;
    } catch {
        size = -1;
    }
    console.log(`${request.method} ${name} ${size < 0 ? '404' : '200'}`);
    if (size < 0) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'Content-Length': size, 'Content-Type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(join(folder, name)).pipe(response);
}).listen(port, () => {
    const addresses = Object.values(networkInterfaces()).flat().filter((a) => a?.family === 'IPv4').map((a) => a.address);
    console.log(`Serving ${folder}`);
    for (const address of addresses) console.log(`  BACKROOMS_UPDATE_FEED=http://${address}:${port}/`);
});
