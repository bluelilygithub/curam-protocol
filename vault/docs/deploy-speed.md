# Deploy speed — READ THIS BEFORE YOU TOUCH `package.json`, `package-lock.json`, `Dockerfile`, `Dockerfile.base` or any `requirements.txt`

**Rule 1. Do not edit `package.json` to add, rename or reorder a test script. Ever.** Run a new test with `node path/to/file.test.js`. A `package.json` edit now makes GitHub rebuild the whole base image (about 10-15 minutes) before the change is fully live. If an edit is truly needed, tell the owner first, say that it means a base rebuild and a slow deploy, and batch it with every other dependency change in one commit.

**Rule 2. Before you diagnose, propose or change anything about deploys, builds, image size or a Dockerfile: read this file, run `git log --oneline -- Dockerfile Dockerfile.base .dockerignore ../.github/workflows/base-image.yml` and read the commit messages.** This has been worked on three times. Proposing a "new" fix from the Dockerfile alone wastes the owner's time and repeats finished work. (It happened on 2026-11-02.)

**Rule 3. Before any push to `staging` or `version-7`, run `git diff --stat origin/<branch>..HEAD` and look for `package.json`, `package-lock.json`, `Dockerfile`, `Dockerfile.base` and `requirements.txt` files. If one is there, say so plainly: "this push will be a slow deploy, because ...".**

The owner judges work by how fast it reaches the live app. A code-only deploy should take about 2-3 minutes.

## How the image is built (since 2026-11-13)

The build is split in two.

**1. The base image, built on GitHub.** `Dockerfile.base` holds every slow step. The workflow `.github/workflows/base-image.yml` (repo root) builds it and stores it, public, at `ghcr.io/bluelilygithub/curam-vault-base:latest`. It runs only when one of these changes on `staging` or `version-7`: `Dockerfile.base`, `package.json`, `package-lock.json`, any `requirements.txt` (root, `server/services/fonts/`, `server/services/pdfRedact/`) or a planner's `package*.json`. It can also be run by hand: GitHub → Actions → Base image → Run workflow. It takes about 10-15 minutes.

| # | Step in `Dockerfile.base` | Cost |
|---|---|---|
| 1 | `apt-get install` LibreOffice, ffmpeg, qpdf, poppler, fonts, Python | very slow, about 1 GB or more |
| 2 | `pip install -r requirements.txt` (librosa, numpy, yt-dlp) | slow |
| 3 | Playwright Chromium `--with-deps` | slow, large |
| 4 | `COPY package*.json` then `npm install --include=dev` | slow, large |
| 5 | `npx playwright install chromium` | quick when the browser matches |
| 6 | Font Customizer and PDF redaction pip installs | slow |
| 7 | Four planner `npm install`s (room, garden, route, cellar) | slow, large |

**2. The app image, built by Railway on every deploy.** `Dockerfile` is short: `FROM` the base, `npm install` (catches up if the base is behind `package.json`), `COPY . .`, `npm run build` (five Vite builds plus TypeScript, about 45 seconds).

Why: Railway's build cache is not guaranteed. On 2026-11-13 its log showed no layer cached at all, so a code-only change rebuilt everything and re-pushed the whole ~2.3 GB image. The base image's layers have the same digests every time, so Railway and its registry reuse them whether or not its own cache survived.

So:

- A normal code change only runs the app image. That is the fast path. Keep deploys on it.
- A dependency change (`package.json`, a lock file, a `requirements.txt`) starts a base rebuild on GitHub. Railway deploys straight away with the old base: root npm packages are caught up by the app image's `npm install`, but system, Python and planner packages arrive only with the next deploy after the base finishes. Check the Actions tab before saying such a change is live.
- A system package, a pip install or a planner install goes in **`Dockerfile.base`**, never in `Dockerfile`.
- Do not switch Railway back to building everything itself.

## What has already been done (do not redo)

- **72aac7cc (2026-10-24):** the four planner installs and the Font/PDF pip installs were moved out of `npm run build` into their own cached layers.
- **7874897c (2026-11-01):** the Playwright Chromium download was moved above `COPY package*.json`. `.dockerignore` was added.
- **0ac982d0, 273148cd (2026-11-13):** the slow steps moved into `Dockerfile.base`, built on GitHub; `Dockerfile` starts from it. The package was made public, so Railway needs no registry credentials.
- **2026-10-17:** CI "Wait for CI" was switched off on both Railway services because it added 10-30 minutes per deploy. Do not add it back. It must stay off now too, or every deploy would wait for the base workflow.

## What is still open (nobody has done it; ask the owner first)

- The final image is still about 2.3 GB: single-stage, with dev dependencies, the four planner `node_modules` trees and the build cache. A multi-stage build would cut it by well over a gigabyte.
- Heavy optional pieces: the Python audio stack (librosa pulls in numba and scipy) and `@imgly/background-removal-node`. Dropping them removes features, so it is the owner's call.
- `nixpacks.toml` and the build commands in `railway.toml` are stale: the `Dockerfile` wins.

## Where the time goes when a deploy is slow

Read the Railway build log. A healthy deploy shows the base image being loaded, a short `npm install`, `COPY . .` and `npm run build`, and no apt, pip or Chromium steps. If those slow steps appear, Railway is not building from the short `Dockerfile`. If the base failed to load, check the Actions tab and that the package is still public. For a dependency change, check the base workflow run first.

## Checklist for any change that touches the build

1. Read this file and the comments in `Dockerfile` and `Dockerfile.base`.
2. Run the `git log` in Rule 2 and read what was done and why.
3. Say in one plain sentence what the change costs in deploy time, and get a yes.
4. After the push, check that the deploy succeeded and how long it took, and for a dependency change that the base workflow succeeded. A successful `git push` is not evidence anything is live.
