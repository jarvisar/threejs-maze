import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Writes the service worker (src/sw.js) into the build with the list of files to keep offline.
 * Its version is a hash of those files, so every deploy that changes anything gets a fresh cache.
 */
function serviceWorker() {
    let root;
    let outDir;
    return {
        name: 'service-worker',
        apply: 'build',
        configResolved(config) {
            root = config.root;
            outDir = resolve(root, config.build.outDir);
        },
        closeBundle() {
            const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
                .filter((entry) => entry.isFile())
                .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
                .filter((file) => file !== 'sw.js')
                .sort();
            const hash = createHash('sha256');
            for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)));
            const source = readFileSync(join(root, 'src/sw.js'), 'utf8')
                .replace('self.__FILES__', JSON.stringify(files))
                .replace('self.__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)));
            writeFileSync(join(outDir, 'sw.js'), source);
        },
    };
}

export default defineConfig({
    // Relative asset URLs, so the build works from any sub-path (e.g. a GitHub Pages project site).
    base: './',
    plugins: [serviceWorker()],
    build: {
        target: 'es2022',
        // three.js is ~700 kB minified on its own; that is expected, not a regression.
        chunkSizeWarningLimit: 900,
        rolldownOptions: {
            output: {
                // three.js changes far less often than the game code, so it gets its own long-cacheable chunk.
                codeSplitting: {
                    groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
                },
            },
        },
    },
    test: {
        environment: 'node',
        // e2e/ is Playwright's (npm run test:e2e).
        include: ['tests/**/*.test.js'],
    },
});
