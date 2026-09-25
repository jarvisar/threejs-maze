import { defineConfig } from 'vitest/config';

// Packaging checks need desktop dependencies. Keep the web-only npm install independent of them.
export default defineConfig({ test: { include: ['checks/**/*.test.js'], maxWorkers: 2 } });
