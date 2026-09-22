import { defineConfig } from 'vite';

export default defineConfig({
    // Relative asset URLs, so the build works from any sub-path (e.g. a GitHub Pages project site).
    base: './',
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
    },
});
