/**
 * @typedef {object} DesktopBridge Added to the page by the desktop app (desktop/preload.cjs).
 * @property {'win32' | 'linux' | 'darwin'} platform
 * @property {string} version
 * @property {string} webUrl Public web URL of the game, for links other people can open.
 * @property {() => boolean} isFullscreen
 * @property {(on: boolean) => Promise<boolean>} setFullscreen Doesn't need a click, unlike the browser API.
 * @property {(callback: (fullscreen: boolean) => void) => () => void} onFullscreenChange
 * @property {(callback: (version: string) => void) => () => void} onUpdateAvailable A newer version is out that
 *   this build can't install itself. Fires right away if one is already known.
 * @property {() => void} openUpdate Opens the download page in the browser.
 * @property {() => void} quit
 */

/**
 * Desktop app bridge, or null in a browser. All desktop-only behavior goes through this, so searching for
 * `desktop` finds all of it.
 * @type {DesktopBridge | null}
 */
export const desktop = globalThis.backroomsDesktop ?? null;
