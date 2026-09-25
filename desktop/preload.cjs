// Runs in the game's page before it loads, and gives it window.backroomsDesktop: the few things a web page can't
// do on its own. The game looks for it in src/desktop.js; in a browser it isn't there and nothing changes.
// CommonJS, because sandboxed preload scripts can't be ES modules.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('desktop:info');

if (info) {
    let fullscreen = info.fullscreen;
    const listeners = new Set();
    ipcRenderer.on('desktop:fullscreen', (_event, value) => {
        fullscreen = value;
        for (const listener of listeners) listener(value);
    });

    contextBridge.exposeInMainWorld('backroomsDesktop', {
        /** 'win32', 'linux' or 'darwin'. */
        platform: info.platform,
        /** The app's version (the web app's package.json version). */
        version: info.version,
        /** Where the game lives on the web, for links that other people can open. */
        webUrl: info.webUrl,
        /** Whether the window is full screen. */
        isFullscreen: () => fullscreen,
        /** Puts the window in or out of full screen; no click needed. Resolves with the state asked for. */
        setFullscreen: (on) => ipcRenderer.invoke('desktop:set-fullscreen', Boolean(on)),
        /** Calls back with true or false whenever the window goes in or out of full screen. Returns a function that stops it. */
        onFullscreenChange: (callback) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        /** Closes the game. */
        quit: () => ipcRenderer.send('desktop:quit'),
    });
}
