import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { packageLayout, verifyArtifacts, verifyPackage } from '../scripts/verify-package.mjs';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { createPackage } = require('@electron/asar');
const { dump } = require('js-yaml');
const version = '2.3.4';
let folder;

beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'backrooms-build-')); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

async function put(file, content) {
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, content);
}

async function artifacts(platform) {
    const layout = packageLayout(platform, version);
    const data = Buffer.from('download contents');
    for (const file of layout.artifacts) await put(join(folder, file), data);
    const feed = { version, files: [{ url: layout.update, size: data.length, sha512: createHash('sha512').update(data).digest('base64') }] };
    await put(join(folder, layout.feed), dump(feed));
    return { layout, feed };
}

describe('desktop build outputs', () => {
    for (const platform of ['win', 'linux', 'mac']) {
        it(`${platform}: accepts a complete release and rejects a missing download`, async () => {
            const { layout } = await artifacts(platform);
            await verifyArtifacts(folder, platform, version);
            // This file is not necessarily referenced by the updater, but still must ship.
            await rm(join(folder, layout.artifacts[1]));
            await expect(verifyArtifacts(folder, platform, version)).rejects.toThrow();
        });

        it(`${platform}: rejects a stale feed and a corrupted download`, async () => {
            const { layout } = await artifacts(platform);
            await expect(verifyArtifacts(folder, platform, '2.3.5')).rejects.toThrow();
            await writeFile(join(folder, layout.update), 'corrupted content');
            await expect(verifyArtifacts(folder, platform, version)).rejects.toThrow(/checksum/);
        });
    }

    it('rejects a wrong version even when all expected filenames exist', async () => {
        const { layout, feed } = await artifacts('win');
        feed.version = '2.3.3';
        await put(join(folder, layout.feed), dump(feed));
        await expect(verifyArtifacts(folder, 'win', version)).rejects.toThrow(/wrong version/);
    });

    it('requires the platform updater format and accurate file sizes', async () => {
        const { layout, feed } = await artifacts('mac');
        feed.files[0].size++;
        await put(join(folder, layout.feed), dump(feed));
        await expect(verifyArtifacts(folder, 'mac', version)).rejects.toThrow(/Wrong size/);
        feed.files[0].url = layout.artifacts[0]; // DMG alone cannot serve the Mac updater.
        await put(join(folder, layout.feed), dump(feed));
        await expect(verifyArtifacts(folder, 'mac', version)).rejects.toThrow(/missing.*zip/);
    });

    for (const platform of ['win', 'linux', 'mac']) {
        it(`${platform}: checks the executable, bundled web build and app version`, async () => {
            const projectDir = join(folder, 'desktop');
            const layout = packageLayout(platform, version);
            const output = join(projectDir, 'release');
            const source = join(folder, 'app');
            await put(join(folder, 'package.json'), JSON.stringify({ version }));
            await put(join(folder, 'dist/index.html'), '<title>Current build</title>');
            for (const file of ['main.js', 'preload.cjs', 'policy.js', 'updates.js', 'node_modules/electron-updater/package.json']) {
                await put(join(source, file), '{}');
            }
            await put(join(source, 'package.json'), JSON.stringify({ version }));
            await put(join(source, 'web/index.html'), await readFile(join(folder, 'dist/index.html')));
            await put(join(output, layout.app), 'executable');
            await put(join(output, layout.resources, 'app-update.yml'), dump({ provider: 'github', owner: 'jarvisar', repo: 'threejs-maze' }));
            const asar = join(output, layout.resources, 'app.asar');
            await createPackage(source, asar);
            const verify = () => verifyPackage({ projectDir, platform, installers: false });
            await expect(verify()).resolves.toBe(join(output, layout.app));
            await put(join(folder, 'dist/index.html'), '<title>New build</title>');
            await expect(verify()).rejects.toThrow(/stale/);
            await rm(join(output, layout.app));
            await expect(verify()).rejects.toThrow(/ENOENT/);
        });
    }

    it('rejects publication overrides before building', () => {
        expect(() => execFileSync(process.execPath, ['scripts/package.mjs', '--publish', 'never'], { cwd: projectDir, encoding: 'utf8', stdio: 'pipe' })).toThrow(/Unknown option '--publish'/);
    });

    it('rejects multiple platforms before building', () => {
        expect(() => execFileSync(process.execPath, ['scripts/package.mjs', '--win', '--linux'], { cwd: projectDir, encoding: 'utf8', stdio: 'pipe' })).toThrow(/one platform/);
    });
});
