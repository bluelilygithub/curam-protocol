// Vite plugin: serves and builds the on-device text reader's files (Tesseract worker, wasm cores, language data) from our own origin under
// `<base>ocr/`, so Vault's Content Security Policy needs no third-party script host. Without it tesseract.js fetches them from cdn.jsdelivr.net,
// which the production policy blocks (script-src / connect-src are 'self' only).
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CORES = ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'];

// English is always included. An app that needs more passes `langs` (ids that have a <lang>.traineddata.gz in ../ocr-assets). Each language
// adds 0.7 to 3 MB to that app's build, so apps only ask for what they use.
export function ocrAssets({ from, langs = ['eng'] }) {
  const wanted = [...new Set(['eng', ...langs])];
  const req = createRequire(path.join(from, 'package.json'));
  const files = () => {
    const worker = req.resolve('tesseract.js/dist/worker.min.js');
    const coreDir = path.dirname(req.resolve('tesseract.js-core/package.json'));
    return [
      ['worker.min.js', worker, 'text/javascript'],
      ...CORES.map((c) => [c, path.join(coreDir, c), 'text/javascript']),
      ...wanted.map((l) => [`${l}.traineddata.gz`, path.resolve(here, `../ocr-assets/${l}.traineddata.gz`), 'application/gzip']),
    ];
  };
  let base = '/';
  return {
    name: 'planner-ocr-assets',
    configResolved(cfg) { base = cfg.base.endsWith('/') ? cfg.base : cfg.base + '/'; },
    configureServer(server) {
      server.middlewares.use((req2, res, next) => {
        const url = (req2.url ?? '').split('?')[0];
        const hit = files().find(([name]) => url === `${base}ocr/${name}` || url === `/ocr/${name}`);
        if (!hit || !existsSync(hit[1])) return next();
        res.setHeader('Content-Type', hit[2]);
        res.end(readFileSync(hit[1]));
      });
    },
    generateBundle() {
      for (const [name, file] of files()) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) });
    },
  };
}
