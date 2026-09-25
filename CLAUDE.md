# Claude Code

Always keep the desktop app (`desktop/`) up to date whenever you change the game's code (`src/`, `index.html`, `public/`, `vite.config.js`, `package.json`). Check the change against the desktop app, update `desktop/` and its docs in the same change when needed, run `npm test` (and `npm run desktop:test` when the change touches browser APIs, loading, input, menus or startup), and say in your summary what the desktop app needed. The `desktop` skill has the details; `desktop-release` covers releases.

Full instructions, shared with other coding agents:

@AGENTS.md
