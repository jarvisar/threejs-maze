/**
 * @typedef {object} DesktopBridge What the desktop app (desktop/preload.cjs) adds to the page.
 * @property {'win32' | 'linux' | 'darwin'} platform
 * @property {string} version
 * @property {string} webUrl Where the game lives on the web, for links other people can open.
 * @property {() => boolean} isFullscreen
 * @property {(on: boolean) => Promise<boolean>} setFullscreen No click needed, unlike the browser's.
 * @property {(callback: (fullscreen: boolean) => void) => () => void} onFullscreenChange
 * @property {() => void} quit
 */

/**
 * The desktop app's bridge to its window, or null in a browser. Everything the game does differently in the
 * desktop app starts from here, so searching for `desktop` finds all of it.
 * @type {DesktopBridge | null}
 */
export const desktop = globalThis.backroomsDesktop ?? null;
