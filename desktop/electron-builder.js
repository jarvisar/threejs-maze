// Packaging for Windows, Linux (Steam Deck included) and macOS. See desktop/README.md.
// The version, name and description come from the web app's package.json, so there is one version number to bump.
import { readFileSync } from 'node:fs';

const web = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
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
    // The app is main.js, preload.cjs and policy.js, with the web build as web/. Nothing from node_modules:
    // Electron is the runtime, and three.js is already bundled into the web build.
    files: [
        'package.json',
        'main.js',
        'preload.cjs',
        'policy.js',
        'build/icon.png',
        { from: '../dist', to: 'web', filter: ['**/*'] },
        '!node_modules/**',
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
        // The .blockmap is only for auto-updates, which the app doesn't do.
        differentialPackage: false,
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

    // No auto-update feed; new versions are downloaded from GitHub Releases.
    publish: null,
};
