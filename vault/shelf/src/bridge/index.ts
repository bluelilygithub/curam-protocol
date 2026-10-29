import type { Bridge, ShelfNative } from './types';
import { createNativeBridge } from './native';

declare global { interface Window { shelfNative?: ShelfNative } }

/**
 * The real shell when this page is hosted by it (it provides window.shelfNative). In development, with no shell, sample data lets the UI be
 * built and checked in a normal browser. The built page never contains the sample data: with no shell it returns null and says so.
 */
export async function loadBridge(): Promise<Bridge | null> {
  if (window.shelfNative) return createNativeBridge(window.shelfNative);
  if (import.meta.env.DEV) {
    const { createMockBridge } = await import('./mock');
    return createMockBridge();
  }
  return null;
}
