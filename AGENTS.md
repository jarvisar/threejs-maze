# Notes for coding agents

Backrooms Simulator: an endless, procedurally generated Backrooms in three.js, built with Vite. The web game is `index.html`, `src/` and `public/`. It's deployed to GitHub Pages by `.github/workflows/deploy.yml`. The same build is also shipped as a desktop app (Electron, `desktop/`) for Windows, Linux/Steam Deck and macOS. See `README.md` and `desktop/README.md`.

## Keep the desktop app up to date with every change

Every change to the game has to keep working in the desktop app, not only in the browser. Treat the desktop app as part of the change, not a follow-up:

1. **Before finishing any change to `src/`, `index.html`, `public/`, `vite.config.js` or `package.json`, check it against the desktop app.** Go through the table under "Keeping the desktop app in step" in `desktop/README.md`. Look out especially for: new permission-gated browser APIs, anything loaded from another site, downloads, full screen, sound start-up, capturing the mouse, the service worker/install/manifest, external links, URL parameters, and anything that should behave differently in the app.
2. **Update `desktop/` in the same change when it's needed:** permissions or the Content-Security-Policy in `desktop/policy.js`, a new bridge call (`desktop/preload.cjs` + a handler in `desktop/main.js` + the typedef in `src/desktop.js`), download handling, `WEB_URL`. Desktop-only behaviour in the game goes behind `import { desktop } from './desktop.js'`, with the browser path unchanged.
3. **Update the docs in the same change** when behaviour differs in the app or a desktop command changes: `desktop/README.md` ("What's different in the app"), and the "Desktop app" section of `README.md` if players would notice.
4. **Run the checks:**
   - `npm test`, always. It includes `tests/desktop.test.js`, which fails when the game uses a permission the app doesn't grant or loads something from the internet.
   - `npm run desktop:test` (build + Electron smoke test), whenever the change touches anything in step 1, or the startup, menu or input code. Run it once, from one agent, not in parallel.
   - After changing `desktop/` itself, or packaging, also do a packaged check as described in `.claude/skills/desktop/SKILL.md`.
5. **Say what you did for the desktop app** in your summary, including "nothing needed" when that's the case, and any check you couldn't run.

The version number lives only in the root `package.json`; the desktop app takes it from there. Releases: `.claude/skills/desktop-release/SKILL.md`. Publishing a GitHub Release sends it to every installed copy of the desktop app (`desktop/updates.js`), so leave publishing to the owner.

## Commands

```sh
npm run dev              # web dev server
npm test                 # unit tests (Vitest), including the desktop guard
npm run test:e2e         # browser layout/accessibility tests (Playwright, heavy)
npm run build            # production build into dist/
npm run desktop:install  # once: the desktop app's own dependencies
npm run desktop          # build and open the desktop app
npm run desktop:dev      # desktop app on the Vite dev server
npm run desktop:test     # desktop smoke test
npm run desktop:dist     # installers for this OS, into desktop/release/
```

## Working rules

- Don't commit, amend, tag or push. Leave changes in the working tree and say what changed; the owner commits everything.
- No AI attribution anywhere: no co-author trailers, "generated with" lines, or credits in commits, PRs, docs or code.
- Keep the look. The legacy lighting and colour settings (colour management off, light intensities, falloff, the bump-map patch) are deliberate; don't "fix" them. UI text and docs stay short and plain, in the VHS/camcorder style: no emoji, no marketing copy.
- The Playwright e2e suite (`npm run test:e2e`) is very heavy on the developer's machine. Run only the projects/specs a change needs, once, at low priority with one worker, and never from several agents at once. Unit tests: `npx vitest run --maxWorkers=2`.
