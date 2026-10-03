# Spec Addition A2 — Photographic view (realistic look and rendered photo)

Oct 3, 2026 · Owner: Michael Barrett

**Status:** Approved scope. Companion to Spec V2 Rev 4, Appendix C and Spec Addition A1. Adds two milestones after M4.5: **M4.6 Realistic look** (the planned follow-up in A1.7) and **M4.7 Render photo**. Where it conflicts with Appendix C, Appendix C wins.

## A2.1 Purpose
Show a client a **photographic representation** of a room being designed. Two parts that build on each other: a **Realistic look** for the live 3D view (textures, better furniture shapes, daylight), and a **Render photo** button that path-traces the same scene into a downloadable image with real bounced light and soft shadows.

## A2.2 Decisions (owner, 2026-10-03)
1. Do the **realistic look first (M4.6), then the rendered photo (M4.7)**. Use: **client presentation**.
2. **No AI-generated images.** The photo is computed from the design itself, so it always shows what was designed.
3. **Textures are generated at run time**, with no image files, so no licence question arises. If real photographic textures are added later, A1.2 #4 applies (CC0 or self-generated, licence noted per file, enforced by a test).
4. **Finishes are data:** a material has an optional texture kind; each furniture item has default finishes per part; the designer's own finish choices (per-instance overrides) always win.
5. **Clay stays the default Cinematic look.** Realistic is a switch inside Cinematic (`Clay | Realistic`). The ordinary 3D view is unchanged.
6. The photo renderer is a **third-party library with an MIT licence**; its licence is recorded in `room-planner/LICENCES.md`.
7. Presentation extras: an optional **caption strip** (project, room, date) in the downloaded image, lighting presets (Daylight, Overcast, Evening), resolution presets and quality targets with a time estimate.

## A2.3 Milestones
| Step | Scope |
|---|---|
| M4.6 a | Furniture shapes v2 (rounded and tapered parts; cushions, panels, handles, drawers), still exactly filling width × length × height. |
| M4.6 b | Room details (skirting, door panel and handle, window frame and sill), generated sky, floor planks. |
| M4.6 c | Generated textures, finishes as data, the Realistic look and its switch. |
| M4.7 | Photo view: choose camera / lighting / size / quality, render progressively, pause or stop, download PNG with optional caption. |

## A2.4 Acceptance
- Every library item fills exactly its envelope at any size (the M4 test stays in force) and uses the new shapes.
- A finish chosen by the designer shows in the Realistic look and in the photo exactly as in the Inspector.
- Switching look or leaving Cinematic restores the previous look exactly and never changes the project or its history.
- A rendered photo shows the open room from the chosen camera, starts rough and sharpens, can be paused, stopped and downloaded at any point, and never blocks editing elsewhere after it ends.
- Where the device cannot render photos (no WebGL 2 or float textures) the button says so in plain words and the Realistic 3D view still works.

## A2.5 Non-goals
AI image generation, animation or video render, real furniture models (glTF), server-side rendering, storing renders inside the project (download only).

## A2.6 Open points
- Whether the project should keep a gallery of past renders (decide after M4.7 is seen).
- Real CC0 photographic textures as an upgrade over generated ones.
