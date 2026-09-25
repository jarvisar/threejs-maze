// Updates from GitHub Releases, with electron-updater. How depends on what kind of build is running:
// - 'install': the Windows installer's copy and the Linux AppImage download a new version in the background and
//   install it when the game is closed. Nothing to click.
// - 'notify': everything else can't replace itself (the portable .exe; the Mac app, which is unsigned; the .deb and
//   the .tar.gz), so the menu shows a link to the download page instead.
// Only published releases count: a draft reaches nobody until it's published.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {string} [platform]
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [execPath]
 * @returns {'install' | 'notify'}
 */
export function updateMode(platform = process.platform, env = process.env, execPath = process.execPath) {
    if (platform === 'win32') {
        // The installer leaves its uninstaller next to the game. The portable .exe (which says so in the environment
        // it starts the game with) and an unpacked folder don't.
        const installed = existsSync(join(dirname(execPath), 'Uninstall Backrooms Simulator.exe'));
        return installed && !env.PORTABLE_EXECUTABLE_DIR ? 'install' : 'notify';
    }
    if (platform === 'linux') return env.APPIMAGE ? 'install' : 'notify';
    return 'notify';
}

/**
 * Checks once. Whatever goes wrong (no connection, GitHub down, a broken release) ends up in the log and nowhere else.
 * @param {object} options
 * @param {(...parts: string[]) => void} options.log
 * @param {(version: string) => void} options.onAvailable 'notify' mode: a newer version is out.
 * @param {string} [options.feed] A folder of latest*.yml files to use instead of GitHub Releases, for trying updates
 *   out (see desktop/README.md).
 */
export async function checkForUpdates({ log, onAvailable, feed }) {
    const mode = updateMode();
    try {
        // Loaded here rather than at the top, so the unit tests can import updateMode without Electron.
        const { autoUpdater } = (await import('electron-updater')).default;
        autoUpdater.logger = {
            info: (message) => log(`[updates] ${message}`),
            warn: (message) => log(`[updates] ${message}`),
            error: (message) => log(`[updates] ${message}`),
            debug: () => {},
        };
        autoUpdater.autoDownload = mode === 'install';
        autoUpdater.autoInstallOnAppQuit = mode === 'install';
        autoUpdater.disableWebInstaller = true; // the Windows installer is the full one, never the web one
        // electron-updater won't even check from a Linux build that isn't an AppImage (it couldn't install anything
        // there). All this changes is that: the settings still come from the packaged app.
        autoUpdater.forceDevUpdateConfig = mode === 'notify';
        if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });

        autoUpdater.on('error', () => {}); // already logged through the logger above
        if (mode === 'notify') autoUpdater.on('update-available', (info) => onAvailable(info.version));
        else autoUpdater.on('update-downloaded', (info) => log(`[updates] ${info.version} is ready and installs when the game is closed.`));

        log(`[updates] Checking (${mode})${feed ? ` at ${feed}` : ''}.`);
        const result = await autoUpdater.checkForUpdates();
        await result?.downloadPromise;
    } catch (error) {
        log(`[updates] Check failed: ${error?.message ?? error}`);
    }
}
