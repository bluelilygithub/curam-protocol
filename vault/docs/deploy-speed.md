# Deploy speed — READ THIS BEFORE YOU TOUCH `package.json`, `package-lock.json`, `Dockerfile` or any `requirements.txt`

**Rule 1. Do not edit `package.json` to add, rename or reorder a test script. Ever.** Run a new test with `node path/to/file.test.js`. If it truly must be in an npm script, tell the owner first, say that it makes the next deploy slow, and batch it with every other `package.json` change in one commit.

**Rule 2. Before you diagnose, propose or change anything about deploys, builds, image size or the `Dockerfile`: read this file, run `git log --oneline -- Dockerfile .dockerignore` and read the commit messages.** This has already been worked on twice. Proposing a "new" fix from the `Dockerfile` alone wastes the owner's time and repeats finished work. (It happened on 2026-11-02.)

**Rule 3. Before any push to `staging` or `version-7`, run `git diff --stat origin/<branch>..HEAD` and look for `package.json`, `package-lock.json`, `Dockerfile` and `requirements.txt` files. If one is there, say so plainly: "this push will be a slow deploy, because ...".**

The owner judges work by how fast it reaches the live app. A deploy that should take about 2-3 minutes (the figure recorded on 2026-10-17, see the memory note on process overhead) took about 10 on 2026-11-02, because `package.json` had been edited just to register test scripts.

## Why: how the image is built

Railway builds the `Dockerfile` with Docker layer caching. A layer is reused only if it and **every layer above it** are unchanged. The first layer that changes forces every layer below it to rebuild and be pushed again. The order today:

| # | Layer | Rebuilds when | Cost |
|---|---|---|---|
| 1 | `apt-get install` LibreOffice, ffmpeg, qpdf, poppler, fonts, Python | the `Dockerfile`'s top lines change | very slow, about 1 GB or more |
| 2 | `pip install -r requirements.txt` (librosa, numpy, yt-dlp) | `requirements.txt` changes | slow |
| 3 | Playwright Chromium `--with-deps` | layers 1-2 change, or the `PLAYWRIGHT_VERSION` arg | slow, large |
| 4 | `COPY package*.json` then `npm install --include=dev` | **any edit to `package.json` or `package-lock.json`, including a script** | slow, large |
| 5 | `npx playwright install chromium` | layer 4 | quick when the browser matches |
| 6 | Font Customizer and PDF redaction pip installs | layer 4, or those two `requirements.txt` files | slow |
| 7 | Four planner `npm install`s (room, garden, route, cellar) in parallel | layer 4, or a planner's own `package*.json` | slow, large |
| 8 | `COPY . .` then `npm run build` (five Vite builds plus TypeScript) | **every deploy**, any change at all | a few minutes: the floor |

So:

- A normal code change only runs layer 8. That is the fast path. Keep deploys on it.
- A `package.json` edit, even one test script, re-runs layers 4 to 8: the root `npm install`, both pip installs and all four planner installs, then the build. That is gigabytes pushed again.
- A change near the top of the `Dockerfile` re-runs everything.

## What has already been done (do not redo)

- **72aac7cc (2026-10-24):** the four planner installs and the Font/PDF pip installs were moved out of `npm run build` into their own cached layers, ahead of `COPY . .`.
- **7874897c (2026-11-01):** the Playwright Chromium download was moved above `COPY package*.json`, so a `package.json` edit no longer re-downloads the browser. `.dockerignore` was added. Its `Dockerfile` comment says why, in as many words: "even just adding a test script".
- **2026-10-17:** CI "Wait for CI" was switched off on both Railway services because it added 10-30 minutes per deploy. Do not add it back (see the memory note on process overhead).

## What is still open (nobody has done it; ask the owner first)

- Layers 6 and 7 still sit **below** `COPY package*.json`, so a `package.json` edit still rebuilds them. Moving them above it makes a script-only edit cost only the root `npm install` and the build.
- The final image is single-stage and keeps dev dependencies, the four planner `node_modules` trees and the build cache. A multi-stage build would cut what is pushed by well over a gigabyte.
- Heavy optional pieces: the Python audio stack (librosa pulls in numba and scipy) and `@imgly/background-removal-node`. Dropping them removes features, so it is the owner's call.
- `nixpacks.toml` is stale: the `Dockerfile` wins.

## Where the time goes when a deploy is slow

Read the Railway build log. Layers reported "CACHED" were reused; the first one that is not cached is where the cascade started. If it starts at `COPY package*.json`, someone edited `package.json`. Check `git log -p -3 -- package.json`.

## Checklist for any change that touches the build

1. Read this file and the `Dockerfile` comments.
2. `git log --oneline -- Dockerfile .dockerignore package.json` and read what was done and why.
3. Say in one plain sentence what the change costs in deploy time, and get a yes.
4. After the push, check that the deploy succeeded and how long it took. A successful `git push` is not evidence anything is live.
