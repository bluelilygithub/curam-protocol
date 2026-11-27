# HTML Content Check rework (brief and decisions)

The owner's rework brief (2026-11-27), kept here so each milestone can follow it. The tool works but is cumbersome in real use: the owner
ends up judging the tool instead of the edits. The rework reshapes presentation and flow; the extraction, diff, pages, request lines and
matching engine stay. House rules apply in full; where this conflicts with the docs, the docs win and the conflict is reported.

**Adoption test:** the owner will only use it if it is quicker and safer than just making the edits. Every change must make the tool faster
to use or easier to trust; anything that adds a step or a choice without doing either is left out or hidden.

**Success test (after R5):** use it on the next 3-4 real client requests. If it is still easier to skip it, park the tool.

## The owner's workflow (the target)

1. A client emails a request: typically a handful of changes across 1-4 pages of a live, mostly text site; usually no staging site.
2. **Before touching the site** the owner creates a job, pastes the request and assigns each line to its page. The pages are saved as the
   starting point.
3. The owner makes the edits on the live site, often with an LLM.
4. The owner asks the tool to verify: for every request line, the before and after, to approve or question; and **every change nobody asked
   for** (LLMs make "helpful" unrequested edits, and dull text changes are easy to miss): the most important list.
5. Fix and verify again until satisfied. A repeat check shows what is still open and what is new, not everything again.
6. Send the client a checklist of the changes they asked for, plus extra changes the owner made on purpose. Everything on it is already
   live; the client reviews the live site against it (a safety net and a say, not a formal sign-off).
7. More changes from the client are a new job.

Purposes, in order: an audit trail for the owner (what was asked, changed, approved, sent); catching unrequested and missed changes;
managing client expectations.

## Decisions

1. **Judge the edits, not the tool.** Each request line shows its own before and after, with Approve and Question and an optional note.
   The AI's links work in the background; the reason shows on hover or expand. Linking by hand moves into this screen ("Not this change /
   pick another").
2. **Unrequested changes come first**, as their own prominent list with word diffs (links, picture addresses, alt text, heading levels,
   removed blocks included). Each is marked **Mine, intentional** (on the client checklist as "Also changed"), **Question** (needs fixing)
   or **Expected** (changes by itself). Self-changing items appear dimmed in this list, not in a closed group.
3. **Review order:** Needs attention (unrequested not yet marked, requests with no change found, questioned), To approve (requests that
   look done), Approved (collapsed). With the first two empty: "Ready to send to the client".
4. **Repeat checks:** "New this check" on changes new since the previous check. Approved lines stay approved unless their change has gone
   or changed ("Was approved, now changed"). No since-last-round switch: always against the starting point.
5. **The timing trap:** New job says "Create the job before you edit the site"; warn when a line's new text is already on the starting
   page; offer "Paste the old text as the starting point" per page.
6. **Images:** a SHA-256 of each image's bytes through the guarded fetch: "Image is different" / "Same image"; never "the right image"; say
   when it could not be fetched.
7. **Re-read before sending:** the checklist first re-reads every page; a missing or altered approved change is listed before the
   checklist, with "Send anyway".
8. **The client checklist** (reusing the PDF code): by page, each address a link; each approved request in the client's words, what the
   page now says (changed words marked), a tick box; then **Also changed**; then "These changes are live now. Please check them on the site
   and tick each one, or tell us what's not right." No internal labels.
9. **Audit trail:** an ordered history (request pasted, starting point, every check, every decision, each checklist sent with its PDF
   stored and a "Sent to client" time; a sent checklist never changes). Status Sent, then Closed by hand. Closed jobs stay (filterable).
10. **New job from this** on a sent or closed job: copies the pages (not the lines), fresh starting point, opens the paste box.
11. **Hide, don't delete:** the "Just compare a page" tile, the All changes view, Rounds (replaced by a strip in the job header).
12. **Parked:** reading returned client PDFs and a client link (notes kept under Future in `docs/html-content-check.md`).
13. **Help:** keep the (i) box and tooltips; a tour of about 5 steps along the workflow; the guide's catalogue follows the new screens.
14. No `package.json`, lockfile or Dockerfile changes without asking.

Optional, if small: a separate address to check per page (a staging address); otherwise Future.

## R1 answers (owner, 2026-11-27)

The split below approved. Pasted old text: blocks added outside the pasted text are grouped as "not compared". Self-changing changes arrive
marked **Expected**, and the "Ready to send" line says how many were marked automatically. Several-page jobs show the lines with page
pickers before Create job; one page goes straight to waiting. Verify skips matching for a page whose changes are as last matched. A Keep
line whose text changed needs attention; held-over lines are listed at the end of To approve, never blocking, and go on the client
checklist under **"Still to discuss"**. The staging address: Future unless R4 has room. Also hidden: client and ticket on New job, the
Keep / Held over picker (shown on request), and "Copy for the developer" becomes **Copy the open questions**, written to paste straight into
an LLM as a prompt. Fingerprints are unique across pages and for identical changes on one page. The re-read before sending only checks the
approved fingerprints and lists new unlinked changes, with no AI. If R2 is too big, split it rather than cut tests.

## Milestones

- **R1** Gap review (done).
- **R2** Identity and review (done, 2026-11-27): fingerprints, decisions and their migration, links by fingerprint; decisions 1-4; hide
  All changes, the switch, Just compare and Rounds; the job strip. See `docs/html-content-check.md`, "Review (rework R2)".
- **R3** Timing and images: decision 5 (warning, "already live" check, pasted old text), decision 6 (image hashes), page pickers before
  Create job on several-page jobs.
- **R4** Sending and history: decisions 7-10; the staging address if there is room.
- **R5** Help (decision 13), docs, and the real end-to-end run on Railway with the Dorothy Stoner request.
