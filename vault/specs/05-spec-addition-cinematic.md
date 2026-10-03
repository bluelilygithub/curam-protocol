# Spec Addition A1 — Cinematic mode

Oct 3, 2026 · Owner: Michael Barrett

**Status:** Approved scope. **Style decided 2026-10-03: clay (white architectural model) is the Cinematic look; realistic is a planned follow-up (A1.7), not part of M4.5.** Companion to Spec V2 Rev 4 and Appendix C. This is an **addition**, not a contract resolution: it adds a milestone, **M4.5**, between M4 (3D) and M5 (plan library and export). Where it conflicts with Appendix C, Appendix C wins and the conflict is raised by number before implementation.

## A1.1 Purpose
A **Cinematic** mode of the 3D view for the plan being designed (never a separate sample scene): a more realistic look, a camera **fly-through**, and a first-person **walk** mode. Used to show clients and to check the designer's own work (sightlines, scale, clearances at eye height).

## A1.2 Decisions (owner, 2026-10-03)
1. Cinematic is a **mode of the current plan**. It renders the user's own rooms, walls, openings and furniture.
2. **Fly-through stops are the saved views** (`Project.savedViews`, creation order). With fewer than two saved views the stops are chosen automatically: an overview, the entrance, then the diagonal view from each far corner (a single saved view is kept as the first stop).
3. **Style (decided):** **clay** — one white matte material, neutral soft light, soft shadows and contact shading — is the Cinematic look. It was chosen from two stills of the owner's own room (realistic vs clay). **Realistic becomes a switchable look later, after the furniture shapes are improved** (A1.7). Before M4.5 is closed the choice is re-confirmed on a furnished scene (sofa, coffee table, armchair, wardrobe, bookshelf, at least one window).
4. **Textures are CC0 or self-generated only**, and the licence of every texture file is recorded next to the file. A test fails if a file has no licence line.
5. A **Quality** setting, **low / high**, **default low**. It is tested on a laptop (integrated) GPU before release.
6. **Walk mode collides** with walls and furniture. The camera can never end up inside a wall or a solid object.
7. An optional **"See an example"** link on the empty screen loads a normal, editable project. **Lowest priority.**

## A1.3 Sub-milestones (M4.5)
| Step | Scope |
|---|---|
| C0 | Style spike: two stills of the owner's room (realistic, clay), same camera. **Done; clay chosen.** Not shipped. |
| C1 | ~~Better furniture shapes~~ — moved to the realistic follow-up (A1.7). |
| C2 | **Clay look** (one white matte material, neutral light, soft shadows, AO at high quality) and the **Quality setting** (low/high, default low). No texture files are needed for clay, so no licences yet. **Built.** |
| C3 | **Fly-through:** path from saved views, or automatic stops (an overview, the entrance, then the diagonal view from each far corner); Play / Pause / Loop; full-screen view with the interface hidden. **Built.** |
| C4 | Walk mode: eye height about 1.6 m, keyboard/mouse and touch, collision with walls and furniture. |
| C5 | "See an example" link (lowest priority). |

## A1.4 Acceptance
- Cinematic is optional and reversible: switching it off returns the ordinary 3D view; it never changes the project or history.
- Both Quality levels render the same scene; low must stay smooth (about 30 fps) on a 4 × 5 m room with up to 20 objects on an integrated GPU. High may be slower.
- Every texture file has a licence line (CC0 or self-generated). No other source is allowed.
- Fly-through with no saved views still produces a sensible tour for any room shape.
- Walk mode: the camera never ends inside a wall or an object whose top is above knee height; it slides along them.
- Furniture models fill exactly their width × length × height (the M4 envelope test stays in force).

## A1.5 Non-goals
Path-traced or photoreal still export (M5 export reuses the Cinematic render settings but is not photoreal), real furniture models (glTF), audio, multi-room tours.

## A1.6 Open points
- Re-confirm clay on the furnished stills (owner request) before M4.5 is closed.
- Where saved-view stops are listed and reordered in the interface (decide at C3).

## A1.7 Planned follow-up (not part of M4.5): realistic look
After the furniture shapes are improved (rounded and bevelled boxes, cushions, tapered legs, armrests, headboards, shelves with depth, still procedural and still exactly filling the engine footprint), **realistic** becomes a second, switchable Cinematic look: generated or CC0 textures (licence noted per file, enforced by a test), warm sun with image-based light, soft shadows. It reuses the Quality setting, fly-through and walk mode unchanged. Scheduled as its own milestone after M4.5 (working name **M4.6**).
