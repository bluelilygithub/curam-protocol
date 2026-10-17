import { createContext, useContext } from 'react';

// What the page shell shares with every tool: the compare toggle, Brand Kit, provider status, the full-size preview,
// the "Use in…" hand-off between tools, and the render helpers that depend on them.
export const GraphicsContext = createContext(null);
export const useGraphics = () => useContext(GraphicsContext);
