# Code Map kit for Claude Code

Everything Claude Code needs to build the Code Map tool inside Vault.

## Setup

1. Unzip into `vault/specs/code-map/` so the layout is:

   ```
   vault/specs/code-map/
     README.md
     code-map-brief.md      <- the spec Claude Code reads
     prompts.md             <- copy-paste prompts, one per session
     reference/
       analyze.py           <- working Python analysis (logic to port to Node)
       slim.py              <- how findings and page data were shaped
       prototype.html       <- the page to match (open with sample-data.json beside it as data.json)
       sample-data.json     <- real output from version-7 @ 40bf883, used for the accuracy test
   ```

2. Commit the kit on its own, with a changelog entry: it is docs-only, so the deploy is fast.
3. Open Claude Code in the repo and paste **Prompt 1** from `prompts.md`, in plan mode. Approve the plan, let it finish and review the commit, then move to the next prompt.

## Order and effort

| # | Session | What you get |
|---|---|---|
| 1 | Analyzer service | Node port of the analysis, rules file, tests, command-line runner |
| 2 | Storage + API | Saved runs, background job, inbox alerts for high findings |
| 3 | Page | The full GUI in Vault (admin only) |
| 4 | Drift | Compare runs, weekly automatic run |
| 5 | Optional | Guide chat, AI "explain and plan a fix" |

Milestones 1–3 give you the working tool. 4 and 5 can wait.

## Things the kit already settles

- No new npm packages and no `package.json` edits, so deploys stay at about 2–3 minutes. The graph uses `react-force-graph-2d`, which Vault already has.
- It analyses the code running in the container. Git history isn't there (`.dockerignore` excludes `.git`), so change over time comes from comparing saved runs.
- Admin-only, like Changelog and PC Health.
- The analysis itself makes no AI calls: it is free, repeatable and testable.

## Viewing the prototype locally

Copy `reference/sample-data.json` to `reference/data.json`. Then run `python -m http.server` in `reference/` and open `http://localhost:8000/prototype.html`. It fetches `data.json`, so opening the file directly won't work.
