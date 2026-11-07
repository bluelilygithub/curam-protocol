// Loads the Excalidraw editor on demand (it is large, so it is not part of the main bundle). The fonts come from our own origin
// (see client/vite/excalidrawAssets.mjs); the asset path must be set BEFORE the library is imported.
let loading = null;

export function loadExcalidraw() {
  if (!loading) {
    window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
    loading = Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')]).then(([mod]) => mod);
    loading.catch(() => { loading = null; }); // a failed load can be tried again
  }
  return loading;
}
