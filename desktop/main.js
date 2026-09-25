// The desktop app: the game's web build (the same dist/ that goes to GitHub Pages) in an Electron window.
// The page is served from app://backrooms/ rather than file://, so it gets a proper origin: module scripts and
// localStorage (settings, edits, best times) work exactly as they do on the website.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, screen, session, shell } from 'electron';
import { ALLOWED_PERMISSIONS, CONTENT_SECURITY_POLICY, RELEASES_URL, WEB_URL } from './policy.js';
import { checkForUpdates } from './updates.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP_ID = 'io.github.jarvisar.backrooms-simulator';
const SCHEME = 'app';
const HOST = 'backrooms';
const APP_ORIGIN = `${SCHEME}://${HOST}`;

// Packaged, the build is copied into the app as web/ (see electron-builder.config.js). Run from the repo, it's ../dist.
const webRoot = app.isPackaged ? join(here, 'web') : resolve(here, '..', 'dist');
// `npm run desktop:dev` points the window at Vite's dev server instead, for hot reload.
const devServer = process.env.BACKROOMS_DEV_SERVER || null;
const startUrl = devServer ?? `${APP_ORIGIN}/`;
const pageOrigin = new URL(startUrl).origin;

const flags = new Set(process.argv.slice(1));
// Steam Deck's Game Mode (and any other gamescope session) has no window frame to speak of: always full screen there.
const gamescope = process.platform === 'linux'
    && (process.env.SteamDeck === '1' || process.env.XDG_CURRENT_DESKTOP === 'gamescope' || Boolean(process.env.GAMESCOPE_WAYLAND_DISPLAY));
const allowDevTools = !app.isPackaged || flags.has('--devtools');
// The game's version. Packaged, electron-builder has written it into the app; run from the repo, it's in the root package.json.
const version = app.isPackaged ? app.getVersion() : JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8')).version;

// Where to look for updates: GitHub Releases, a test feed (a URL), or 'off' (the smoke test). Never from the repository.
const updateFeed = process.env.BACKROOMS_UPDATE_FEED || null;
/** A newer version the player should go and download ('notify' updates), once one is found. */
let availableUpdate = null;

// Somewhere else for settings, saves and the log: the smoke test uses a fresh folder every run.
if (process.env.BACKROOMS_USER_DATA) app.setPath('userData', resolve(process.env.BACKROOMS_USER_DATA));

protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
    app.on('second-instance', () => {
        const [win] = BrowserWindow.getAllWindows();
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });
    app.on('window-all-closed', () => app.quit());
    app.whenReady().then(start);
}

// ------------------------------------------------------------------ log

// A log next to the saved settings, for when something goes wrong on a machine without developer tools to hand
// (a Steam Deck in Game Mode, say). Rewritten every launch.
const logPath = join(app.getPath('userData'), 'desktop.log');
let logStream = null;

function log(...parts) {
    const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
    console.log(line);
    try {
        logStream ??= (mkdirSync(dirname(logPath), { recursive: true }), createWriteStream(logPath, { flags: 'w' }));
        logStream.write(line + '\n');
    } catch {
        // Nowhere to write it; the console has it.
    }
}

// ------------------------------------------------------------------ window state

const statePath = join(app.getPath('userData'), 'window.json');

function loadWindowState() {
    try {
        return JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
        return {};
    }
}

/**
 * @param {BrowserWindow} win
 * @param {object} saved What was saved last time.
 */
function saveWindowState(win, saved) {
    // Full screen in Game Mode isn't a choice, so it leaves the choice made on the desktop alone.
    const fullscreen = gamescope ? saved.fullscreen === true : win.isFullScreen();
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized(), fullscreen };
    try {
        writeFileSync(statePath, JSON.stringify(state));
    } catch (error) {
        log('Could not save the window state:', error.message);
    }
}

/** The saved position, if it's still on a screen (a monitor may have been unplugged since). */
function onScreen(bounds) {
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
    const { workArea } = screen.getDisplayMatching(bounds);
    return bounds.x < workArea.x + workArea.width - 64 && bounds.x + bounds.width > workArea.x + 64
        && bounds.y >= workArea.y - 16 && bounds.y < workArea.y + workArea.height - 64;
}

// ------------------------------------------------------------------ startup

async function start() {
    log(`Backrooms Simulator ${version} (Electron ${process.versions.electron}, Chromium ${process.versions.chrome}) on ${process.platform} ${process.arch}${gamescope ? ', gamescope' : ''}`);

    if (!devServer && !existsSync(join(webRoot, 'index.html'))) {
        dialog.showErrorBox('Backrooms Simulator', `The game's web build is missing from:\n${webRoot}\n\nRun "npm run build" in the repository first (or use "npm run desktop", which does).`);
        app.quit();
        return;
    }

    app.on('child-process-gone', (_event, details) => log(`The ${details.type} process stopped: ${details.reason}.`));
    protocol.handle(SCHEME, serve);
    setUpSession(session.defaultSession);
    setUpIpc();
    setUpMenu();
    createWindow();

    if (app.isPackaged && updateFeed !== 'off') {
        checkForUpdates({
            log,
            feed: updateFeed ?? undefined,
            onAvailable(version) {
                availableUpdate = version;
                for (const win of BrowserWindow.getAllWindows()) win.webContents.send('desktop:update', version);
            },
        });
    }
}

/**
 * Serves app://backrooms/… from the web build, with a Content-Security-Policy on top.
 * @param {Request} request
 */
async function serve(request) {
    const url = new URL(request.url);
    let file;
    try {
        file = resolve(webRoot, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
    } catch {
        return new Response('Bad request', { status: 400 }); // a malformed %-escape
    }
    if (url.host !== HOST || !file.startsWith(webRoot + sep)) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href).catch(() => null);
    if (!response?.ok) return new Response('Not found', { status: 404 });
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: 200, headers });
}

/** @param {Electron.Session} ses */
function setUpSession(ses) {
    ses.setPermissionRequestHandler((_contents, permission, callback) => {
        const allowed = ALLOWED_PERMISSIONS.has(permission);
        if (!allowed) log(`Refused the "${permission}" permission (see desktop/policy.js).`);
        callback(allowed);
    });
    ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));

    // Stills (P, or View on a controller) go straight into Pictures/Backrooms Simulator, without a save dialog.
    ses.on('will-download', (_event, item) => {
        const folder = join(app.getPath('pictures'), 'Backrooms Simulator');
        try {
            mkdirSync(folder, { recursive: true });
            item.setSavePath(join(folder, item.getFilename()));
        } catch (error) {
            log('Could not save a still:', error.message);
            item.cancel();
        }
    });
}

function setUpIpc() {
    /** Only the game's own page gets to talk to the app. */
    const trusted = (event) => {
        try {
            return new URL(event.senderFrame?.url ?? '').origin === pageOrigin;
        } catch {
            return false;
        }
    };
    const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);

    ipcMain.on('desktop:info', (event) => {
        event.returnValue = trusted(event)
            ? { platform: process.platform, version, webUrl: WEB_URL, fullscreen: windowOf(event)?.isFullScreen() ?? false, update: availableUpdate }
            : null;
    });
    ipcMain.handle('desktop:set-fullscreen', (event, on) => {
        const win = windowOf(event);
        if (!trusted(event) || !win) return false;
        win.setFullScreen(Boolean(on));
        // Not win.isFullScreen(): on macOS the switch is animated, and it's still the old state at this point.
        return Boolean(on);
    });
    // Always the releases page, whatever the page asks: it doesn't get to pick what opens in the browser.
    ipcMain.on('desktop:open-update', (event) => {
        if (trusted(event)) shell.openExternal(RELEASES_URL);
    });
    ipcMain.on('desktop:quit', (event) => {
        if (trusted(event)) app.quit();
    });
}

function setUpMenu() {
    if (process.platform !== 'darwin') {
        // No menu bar over a game. Alt would show it, and the game has no use for one.
        Menu.setApplicationMenu(null);
        return;
    }
    // macOS keeps its menu bar: Quit, Hide, copy and paste (in the seed box) and full screen live there.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(allowDevTools ? [{ role: 'toggleDevTools' }] : [])] },
        { role: 'windowMenu' },
    ]));
}

function createWindow() {
    const saved = loadWindowState();
    const fullscreen = flags.has('--windowed') ? false : flags.has('--fullscreen') || gamescope || saved.fullscreen === true;
    const bounds = onScreen(saved) ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1280, height: 800 };

    const win = new BrowserWindow({
        ...bounds,
        minWidth: 640,
        minHeight: 400,
        fullscreen,
        // On macOS, fullscreen: false also disables entering fullscreen unless this is explicit.
        fullscreenable: true,
        show: false,
        title: 'Backrooms Simulator',
        backgroundColor: '#000000',
        // Windows gets the icon from the .exe; Linux needs it on the window.
        icon: process.platform === 'linux' ? join(here, 'build', 'icon.png') : undefined,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(here, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false,
            devTools: allowDevTools,
            // Browsers hold sound back until a click or a key press, and a controller button doesn't count.
            // On a Steam Deck the controller may be all there is.
            autoplayPolicy: 'no-user-gesture-required',
        },
    });
    if (saved.maximized && !fullscreen) win.maximize();
    win.once('ready-to-show', () => win.show());

    // Not win.isFullScreen(): on Windows it still has the old state while these events fire.
    win.on('enter-full-screen', () => win.webContents.send('desktop:fullscreen', true));
    win.on('leave-full-screen', () => win.webContents.send('desktop:fullscreen', false));
    win.on('close', () => saveWindowState(win, saved));

    const contents = win.webContents;
    contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        // F11, or Alt+Enter, as in most PC games. (macOS has its own shortcut, in the View menu.)
        if (process.platform !== 'darwin' && (input.key === 'F11' || (input.key === 'Enter' && input.alt))) {
            win.setFullScreen(!win.isFullScreen());
            event.preventDefault();
        } else if (allowDevTools && input.key.toLowerCase() === 'i' && input.shift && (input.control || input.meta)) {
            contents.toggleDevTools();
            event.preventDefault();
        }
    });

    // Links (the GitHub one on the menu) open in the browser; the window only ever shows the game.
    contents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
        if (new URL(url).origin === pageOrigin) return;
        event.preventDefault();
        openExternal(url);
    });

    contents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
        if (level === 'warning' || level === 'error') log(`[page ${level}] ${message} (${sourceId}:${lineNumber})`);
    });
    contents.on('did-fail-load', (_event, code, description, url) => log(`Failed to load ${url}: ${description} (${code})`));
    let reloads = 0;
    contents.on('render-process-gone', (_event, details) => {
        log(`The page's process stopped: ${details.reason} (exit code ${details.exitCode}).`);
        // Once or twice it's worth trying again; after that it'll only keep crashing.
        if (details.reason !== 'clean-exit' && reloads++ < 2) contents.reload();
    });
    if (flags.has('--devtools') && allowDevTools) contents.openDevTools({ mode: 'detach' });
    win.loadURL(startUrl);
    return win;
}

/** @param {string} url */
function openExternal(url) {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    else log(`Blocked a link to ${url}`);
}
