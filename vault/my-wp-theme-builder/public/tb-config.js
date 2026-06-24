/**
 * Base path + embedded mode — works standalone (/) or mounted in Vault (/tb).
 */
(function initTbConfig() {
  const script = document.currentScript;
  let base = '';
  if (script?.src) {
    base = new URL('.', script.src).pathname.replace(/\/$/, '');
  }

  window.tbPath = function tbPath(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  };

  window.tbFetch = function tbFetch(path, options) {
    return fetch(window.tbPath(path), options);
  };

  if (/\bembedded=1\b/.test(window.location.search)) {
    document.documentElement.classList.add('tb-embedded');
  }
})();
