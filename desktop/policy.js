// What the game's page is allowed to do in the desktop app. Kept apart from main.js (and free of Electron imports)
// so the web app's unit tests can check it against the browser APIs the game uses: see tests/desktop.test.js.

/**
 * Permissions the page is granted without asking. Everything else is refused, and the refusal is logged.
 * @type {ReadonlySet<string>}
 */
export const ALLOWED_PERMISSIONS = new Set([
    // Capturing the mouse when you click Start.
    'pointerLock',
    // Full screen from a click or a tap (the controller's full screen goes through the desktop bridge instead).
    'fullscreen',
    // Esc and the like while the mouse is captured.
    'keyboardLock',
    // Settings → Copy world link.
    'clipboard-sanitized-write',
]);

/**
 * Browser APIs that need a permission in Electron, and which one. tests/desktop.test.js fails when the game
 * starts using one of these whose permission isn't in ALLOWED_PERMISSIONS, so a new feature can't quietly
 * stop working in the desktop app. Add to this list when using a permission-gated API not already in it.
 * @type {ReadonlyArray<{ api: RegExp, permission: string }>}
 */
export const PERMISSION_APIS = [
    { api: /\brequestPointerLock\s*\(/, permission: 'pointerLock' },
    { api: /\brequestFullscreen\b/, permission: 'fullscreen' },
    { api: /\bkeyboard\.lock\s*\(/, permission: 'keyboardLock' },
    { api: /\bclipboard\.write(Text)?\s*\(/, permission: 'clipboard-sanitized-write' },
    { api: /\bclipboard\.read(Text)?\s*\(/, permission: 'clipboard-read' },
    { api: /\bgetUserMedia\s*\(/, permission: 'media' },
    { api: /\bgetDisplayMedia\s*\(/, permission: 'display-capture' },
    { api: /\bNotification\.requestPermission\b|\bnew Notification\s*\(/, permission: 'notifications' },
    { api: /\bgeolocation\./, permission: 'geolocation' },
    { api: /\brequestMIDIAccess\s*\(/, permission: 'midi' },
    { api: /\bwakeLock\.request\s*\(/, permission: 'screen-wake-lock' },
    { api: /\bshow(Open|Save)FilePicker\s*\(|\bshowDirectoryPicker\s*\(/, permission: 'fileSystem' },
    { api: /\bpersist\s*\(\s*\)/, permission: 'persistent-storage' },
    { api: /\bgetScreenDetails\s*\(/, permission: 'window-management' },
];

/**
 * Content-Security-Policy for the bundled game. Everything is served from the app itself; nothing is loaded from
 * the internet. data: and blob: cover textures drawn on canvases and stills being saved.
 */
export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');

/** Where the game lives on the web. Shared world links point here, since the app's own address means nothing to anyone else. */
export const WEB_URL = 'https://jarvisar.github.io/threejs-maze/';

/** Where new versions of the desktop app are downloaded from, for the menu's "New version" link. */
export const RELEASES_URL = 'https://github.com/jarvisar/threejs-maze/releases/latest';
