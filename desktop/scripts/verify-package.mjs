import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, normalize } from 'node:path';
import { extractFile } from '@electron/asar';
import { load } from 'js-yaml';

export function packageLayout(platform, version) {
    const stem = `Backrooms-Simulator-${version}`;
    switch (platform) {
        case 'win': return {
            app: 'win-unpacked/Backrooms Simulator.exe', resources: 'win-unpacked/resources', feed: 'latest.yml',
            artifacts: [`${stem}-win-x64-setup.exe`, `${stem}-win-x64-portable.exe`, `${stem}-win-x64-setup.exe.blockmap`],
            update: `${stem}-win-x64-setup.exe`,
        };
        case 'linux': return {
            app: 'linux-unpacked/backrooms-simulator', resources: 'linux-unpacked/resources', feed: 'latest-linux.yml',
            artifacts: ['Backrooms-Simulator-linux-x86_64.AppImage', `${stem}-linux-amd64.deb`, `${stem}-linux-x64.tar.gz`],
            update: 'Backrooms-Simulator-linux-x86_64.AppImage',
        };
        case 'mac': return {
            app: 'mac-universal/Backrooms Simulator.app/Contents/MacOS/Backrooms Simulator',
            resources: 'mac-universal/Backrooms Simulator.app/Contents/Resources', feed: 'latest-mac.yml',
            artifacts: [`${stem}-mac-universal.dmg`, `${stem}-mac-universal.zip`, `${stem}-mac-universal.dmg.blockmap`, `${stem}-mac-universal.zip.blockmap`],
            update: `${stem}-mac-universal.zip`,
        };
        default: throw new Error(`Unsupported platform: ${platform}`);
    }
}

async function nonempty(file) {
    const info = await stat(file);
    assert(info.isFile() && info.size > 0, `Missing or empty build output: ${file}`);
    return info;
}

export async function verifyArtifacts(output, platform, version) {
    const layout = packageLayout(platform, version);
    for (const file of layout.artifacts) await nonempty(join(output, file));
    const feed = load(await readFile(join(output, layout.feed), 'utf8'));
    assert.equal(feed.version, version, 'The update feed has the wrong version');
    assert(Array.isArray(feed.files) && feed.files.length > 0, 'The update feed has no files');
    assert(feed.files.some((file) => file.url === layout.update), `The update feed is missing ${layout.update}`);
    for (const file of feed.files) {
        assert(typeof file.url === 'string' && basename(file.url) === file.url && !/[\\/]/.test(file.url), 'Update files must be local filenames');
        const path = join(output, file.url);
        const info = await nonempty(path);
        assert.equal(file.size, info.size, `Wrong size in update feed: ${file.url}`);
        const hash = createHash('sha512');
        for await (const data of createReadStream(path)) hash.update(data);
        assert.equal(file.sha512, hash.digest('base64'), `Wrong checksum in update feed: ${file.url}`);
    }
}

export async function verifyPackage({ projectDir, platform, installers = true }) {
    const { version } = JSON.parse(await readFile(join(projectDir, '../package.json'), 'utf8'));
    const output = join(projectDir, 'release');
    const layout = packageLayout(platform, version);
    const app = join(output, layout.app);
    await nonempty(app);
    const asar = join(output, layout.resources, 'app.asar');
    await nonempty(asar);
    const metadata = JSON.parse(extractFile(asar, 'package.json'));
    assert.equal(metadata.version, version, 'The packaged app has the wrong version');
    for (const file of ['main.js', 'preload.cjs', 'policy.js', 'updates.js', 'web/index.html', 'node_modules/electron-updater/package.json']) {
        assert(extractFile(asar, normalize(file)).length > 0, `Missing from app.asar: ${file}`);
    }
    assert.deepEqual(extractFile(asar, join('web', 'index.html')), await readFile(join(projectDir, '../dist/index.html')), 'The packaged web build is stale');
    // This config is required even though the builder is forbidden to publish.
    const update = load(await readFile(join(output, layout.resources, 'app-update.yml'), 'utf8'));
    assert.equal(update.provider, 'github');
    assert.equal(update.owner, 'jarvisar');
    assert.equal(update.repo, 'threejs-maze');
    if (installers) await verifyArtifacts(output, platform, version);
    return app;
}
