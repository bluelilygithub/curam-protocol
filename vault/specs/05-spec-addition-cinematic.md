# Spec Addition A1 — Cinematic mode

Oct 3, 2026 · Owner: Michael Barrett

**Status:** Approved scope, style decision open. Companion to Spec V2 Rev 4 and Appendix C. This is an **addition**, not a contract resolution: it adds a milestone, **M4.5**, between M4 (3D) and M5 (plan library and export). Where it conflicts with Appendix C, Appendix C wins and the conflict is raised by number before implementation.

## A1.1 Purpose
A **Cinematic** mode of the 3D view for the plan being designed (never a separate sample scene): a more realistic look, a camera **fly-through**, and a first-person **walk** mode. Used to show clients and to check the designer's own work (sightlines, scale, clearances at eye height).

## A1.2 Decisions (owner, 2026-10-03)
1. Cinematic is a **mode of the current plan**. It renders the user's own rooms, walls, openings and furniture.
2. **Fly-through stops are the saved views** (`Project.savedViews`, creation order). If there are none, stops are chosen automatically: the entrance, then the diagonal view from each far corner.
3. **Style is decided from two stills of the owner's own room, rendered before any build:** (a) realistic textures, (b) clay / white architectural model with soft shadows. If (a), **better furniture shapes are built first** (before the fly-through).
4. **Textures are CC0 or self-generated only**, and the licence of every texture file is recorded next to the file. A test fails if a file has no licence line.
5. A **Quality** setting, **low / high**, **default low**. It is tested on a laptop (integrated) GPU before release.
6. **Walk mode collides** with walls and furniture. The camera can never end up inside a wall or a solid object.
7. An optional **"See an example"** link on the empty screen loads a normal, editable project. **Lowest priority.**

## A1.3 Sub-milestones (M4.5)
| Step | Scope |
|---|---|
| C0 | Style spike: two stills of the owner's room (realistic, clay), same camera. Owner picks. Not shipped. |
| C1 | Better furniture shapes (only if style (a) is chosen). Still procedural, still exactly filling the engine footprint. |
| C2 | Materials and look, Quality setting (low/high), texture licences. |
| C3 | Fly-through: path from saved views or automatic stops; Play / Pause / Loop; full-screen view with the interface hidden. |
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
- **Style (a) realistic vs (b) clay:** open until the two stills are seen.
- Where saved-view stops are listed and reordered in the interface (decide at C3).
