# Third-party licences (Room Planner)

Runtime libraries are listed in `package.json`; this file records the ones added for a specific feature so their licence is easy to find.

| Package | Version (pinned) | Licence | Used for |
|---|---|---|---|
| `three-gpu-pathtracer` | 0.0.26 | MIT | Render photo (M4.7): path-traced still image. Loaded only when the Render photo panel opens. |
| `three-mesh-bvh` | 0.9.15 | MIT | Required by `three-gpu-pathtracer` (spatial index for ray tracing). `package.json` `overrides` forces this one version, because `@react-three/drei` asks for 0.8.x and the path tracer needs 0.9.15 or later; the planner does not use drei's BVH helpers. |
| `shepherd.js` | 14.5.0 | MIT | The guided tour (same library Vault's other tours use). Loaded only when the tour starts. |
| Poly Haven models (6) | CC0 1.0 | public domain | `public/models/*`: Modern Arm Chair 01, Mid Century Lounge Chair, Modern Coffee Table 01, Sofa 02, Dining Chair 02, Wooden Display Shelves 01 (authors in each folder's `source.json` and in the app's Credits panel). Textures resized (1K, JPEG) by `scripts/fetch-polyhaven.py`. |
| `pdf-lib` | 1.17.1 | MIT | The plan and furniture schedule PDF. Loaded only when a PDF is made. |
| `xatlas-web` | 0.1.0 | MIT | Peer dependency of `three-gpu-pathtracer` (lightmap UVs); installed to satisfy it, not used by the planner. |

**Textures and images:** none are shipped. Wood, fabric, leather, metal, plank, plaster and paint textures are generated in code at run time (`src/render3d/textureData.ts`), so no image licence applies (Spec Addition A1.2 #4, A2).

**Upstream note:** `three-gpu-pathtracer` marks its WebGL path tracer as deprecated in favour of a WebGPU one. The planner keeps every use of it in `src/render3d/photoTracer.ts` so it can be swapped (DECISIONS D73).
