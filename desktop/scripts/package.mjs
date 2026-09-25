// Invoke the API from Node: Windows command lookup must never choose a config file as the builder executable.
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: {
    win: { type: 'boolean' }, linux: { type: 'boolean' }, mac: { type: 'boolean' }, dir: { type: 'boolean' },
} });
const selected = ['win', 'linux', 'mac'].filter((name) => values[name]);
if (selected.length > 1) throw new Error('Build one platform at a time.');
const { build, Platform, Arch } = await import('electron-builder');
const { verifyPackage } = await import('./verify-package.mjs');
const name = selected[0] || { win32: 'win', linux: 'linux', darwin: 'mac' }[process.platform];
const platform = { win: Platform.WINDOWS, linux: Platform.LINUX, mac: Platform.MAC }[name];
if (!platform) throw new Error(`Unsupported platform: ${process.platform}`);
const projectDir = fileURLToPath(new URL('../', import.meta.url));
await build({
    projectDir,
    config: fileURLToPath(new URL('../electron-builder.config.js', import.meta.url)),
    targets: platform.createTarget(values.dir ? 'dir' : undefined, name === 'mac' ? Arch.universal : Arch.x64),
    // Set once, as a scalar. CLI overrides (including repeated --publish) are deliberately rejected above.
    publish: 'never',
});
const app = await verifyPackage({ projectDir, platform: name, installers: !values.dir });
console.log(`Verified ${name} package: ${app}`);
