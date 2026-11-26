// What HTML Content Check uses from DocCompare, bundled for the server by scripts/buildHtmlContentCheckLib.js into
// dist/html-content-check-lib/index.cjs (production runs Node 20, which cannot load DocCompare's TypeScript directly).
// Imported, not copied (brief decision 2): this moves into the tool when DocCompare's web mode is removed.
// `diff` and Readability resolve from doc-compare/node_modules; Vault's own package.json does not have them.
export { extract, decodeHtml, THIN_WORDS } from '../../../../doc-compare/src/readers/html.ts';
export { countWords } from '../../../../doc-compare/src/readers/finalize.ts';
export { diffWordsWithSpace, diffArrays } from 'diff';
export const LIB_VERSION = 1;
