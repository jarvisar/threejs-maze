// Packaging for Windows, Linux (Steam Deck included) and macOS. See desktop/README.md.
// The version, name and description come from the web app's package.json, so there is one version number to bump.
import { readFileSync } from 'node:fs';

const web = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// The workflow passes the signing secrets as empty strings when they aren't set, and electron-builder takes an
// empty CSC_LINK as a certificate at "" (the project folder), and fails. Empty means not set.
for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (process.env[name] === '') delete process.env[name];
}
// A signing certificate in the environment (CSC_LINK, see desktop/README.md) signs and notarizes the Mac build.
// Without one it's signed ad hoc, which Apple Silicon needs to open it at all.
const macSigning = Boolean(process.env.CSC_LINK);

/** @type {import('electron-builder').Configuration} */
export default {
    appId: 'io.github.jarvisar.backrooms-simulator',
    productName: 'Backrooms Simulator',
    copyright: 'Copyright © Jarvisar',
    extraMetadata: {
        version: web.version,
        description: web.description,
    },
    directories: {
        output: 'release',
        buildResources: 'build',
    },
    // The app's own files, with the web build as web/. electron-builder adds the runtime dependencies from
    // package.json (electron-updater) itself; three.js is already bundled into the web build.
    files: [
        'package.json',
        'main.js',
        'preload.cjs',
        'policy.js',
        'updates.js',
        'build/icon.png',
        { from: '../dist', to: 'web', filter: ['**/*'] },
    ],
    asar: true,
    // English is all the game has; the other ~50 Chromium languages are dead weight.
    electronLanguages: ['en-US'],
    artifactName: 'Backrooms-Simulator-${version}-${os}-${arch}.${ext}',

    win: {
        target: [
            { target: 'nsis', arch: ['x64'] },
            { target: 'portable', arch: ['x64'] },
        ],
    },
    nsis: {
        artifactName: 'Backrooms-Simulator-${version}-win-${arch}-setup.${ext}',
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        shortcutName: 'Backrooms Simulator',
        // Settings, world edits and best times stay if the game is uninstalled and installed again.
        deleteAppDataOnUninstall: false,
    },
    portable: {
        artifactName: 'Backrooms-Simulator-${version}-win-${arch}-portable.${ext}',
    },

    linux: {
        // AppImage is the one to use on a Steam Deck (see desktop/README.md); .deb and .tar.gz for everything else.
        target: [
            { target: 'AppImage', arch: ['x64'] },
            { target: 'deb', arch: ['x64'] },
            { target: 'tar.gz', arch: ['x64'] },
        ],
        category: 'Game',
        executableName: 'backrooms-simulator',
        synopsis: 'An endless, procedurally generated Backrooms',
        maintainer: 'Jarvisar <jarvisar@users.noreply.github.com>',
        vendor: 'Jarvisar',
        desktop: {
            entry: {
                Name: 'Backrooms Simulator',
                Comment: web.description,
                Categories: 'Game;',
                Keywords: 'backrooms;level 0;maze;horror;',
            },
        },
    },

    appImage: {
        // No version in the name: an update then replaces the file where it is. With one, it would arrive under a
        // new name and the old file would go, breaking anything that points at it (a Steam shortcut, say).
        artifactName: 'Backrooms-Simulator-linux-${arch}.${ext}',
    },

    mac: {
        target: [
            { target: 'dmg', arch: ['universal'] },
            { target: 'zip', arch: ['universal'] },
        ],
        category: 'public.app-category.games',
        icon: 'build/icon-mac.png',
        identity: macSigning ? undefined : '-',
        hardenedRuntime: macSigning,
        notarize: macSigning && Boolean(process.env.APPLE_ID),
        // Chromium's JIT and the GPU need these under the hardened runtime.
        entitlements: 'build/entitlements.mac.plist',
        entitlementsInherit: 'build/entitlements.mac.plist',
        extendInfo: {
            // Game controllers, over Bluetooth or USB.
            NSBluetoothAlwaysUsageDescription: 'Backrooms Simulator uses Bluetooth game controllers.',
        },
    },
    dmg: {
        artifactName: 'Backrooms-Simulator-${version}-mac-${arch}.${ext}',
    },

    // Where updates come from (see updates.js). This writes app-update.yml into the app and the latest*.yml files
    // next to the builds; the workflow uploads the builds itself, so electron-builder never publishes anything.
    publish: {
        provider: 'github',
        owner: 'jarvisar',
        repo: 'threejs-maze',
    },
};
