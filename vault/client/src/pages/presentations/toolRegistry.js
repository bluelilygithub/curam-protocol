import { lazy } from 'react';

// One lazily loaded component per Presentations tool, keyed by the id used in the sidebar and in the job goals.
export const TOOL_COMPONENTS = {
  create: lazy(() => import('./tools/CreateDeck')),
  import: lazy(() => import('./tools/ImportSource')),
  templates: lazy(() => import('./tools/Themes')),
  slides: lazy(() => import('./tools/SlideEditor')),
  export: lazy(() => import('./tools/ExportDeck')),
  decks: lazy(() => import('./tools/MyDecks')),
};
