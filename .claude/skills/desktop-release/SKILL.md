---
name: desktop-release
description: Prepare a release of the Backrooms Simulator desktop app (Windows installer/portable exe, Linux AppImage/.deb/.tar.gz for the Steam Deck, macOS dmg/zip), or fetch the latest desktop builds from CI. Use when the user wants to release, bump the version, get installers or a Steam Deck build, or check on the "Desktop app" GitHub Actions workflow.
---

# Releasing the desktop app

Builds for all three platforms are made by `.github/workflows/desktop.yml` on GitHub's machines. A version tag `vX.Y.Z` drafts a GitHub Release with them. See "Releasing" in `desktop/README.md`.

The user makes every commit, tag and push themselves. Prepare the changes, run the checks, then give them the exact commands. Don't run `git commit`, `git tag` or `git push`, and don't publish a draft release, unless they ask for that step in so many words.

## Preparing a release

1. Check the tree: `git status`. Anything unrelated that's uncommitted goes in the user's own commit; mention it.
2. Run the checks (see the `desktop` skill): `npx vitest run --maxWorkers=2`, then `npm run desktop:test` once.
3. Bump the version in the root package (the only version; the app reads it from there):
   `npm version <patch|minor|major> --no-git-tag-version`. That changes `package.json` and `package-lock.json`. Ask which kind of bump if the user didn't say: patch for fixes, minor for new things.
4. If the README or `desktop/README.md` mentions anything the release changes, update it.
5. Hand over the commands, with the real version filled in:

   ```sh
   git add package.json package-lock.json
   git commit -m "Version X.Y.Z"
   git push
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   The tag must equal `v` + the version in `package.json`, or the workflow's first step fails on purpose.

## After the tag is pushed

- Watch the run: `gh run list --workflow desktop.yml --limit 5`, then `gh run watch <id>` or `gh run view <id> --log-failed`.
- The `release` job leaves a draft release: `gh release view vX.Y.Z`. Tell the user it's there to review and publish (Releases page, or `gh release edit vX.Y.Z --draft=false` if they ask you to publish it).
- Re-running the workflow for the same tag replaces the draft's files.

## Getting a build without releasing

Every push to `main` that touches the game builds all three. Artifacts are kept 14 days:

```sh
gh run list --workflow desktop.yml --branch main --limit 3
gh run download <run-id> --name backrooms-simulator-linux --dir <scratch dir>   # or -windows, -macos
```

The Steam Deck wants the `.AppImage` from the linux artifact. Local builds only cover the current OS: `npm run desktop:dist` on Windows gives the setup and portable `.exe` in `desktop/release/`.

## If the workflow fails

- `smoke` job: a real problem with the game in Electron. Download `desktop-smoke-report` and read the Playwright report.
- `package` job on one OS: read that job's log (`gh run view <id> --log-failed`). The macOS smoke test is `continue-on-error` (virtual machine, and nobody has a Mac to check by hand), so a red step there still uploads the build. Say so plainly rather than calling the Mac build verified.
- Mac signing: only when the `MAC_CERTIFICATE`… secrets exist; otherwise ad hoc. Never ask the user to paste certificate or password values into the chat. They go into the repository's secrets.
