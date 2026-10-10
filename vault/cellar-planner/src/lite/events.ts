// Tells the page around the planner what the visitor is doing, so the website's own analytics (Google Tag Manager) can count it. Names only, never
// anything typed, never the design: no personal data. Nothing is sent when the planner is not embedded.

export const EVENT_TYPE = 'cellar-lite:event';
export type EventName = 'start' | 'preset' | 'unit' | 'view' | 'quote' | 'link_copied' | 'plan_downloaded' | 'price_help' | 'fix' | 'welcome_back' | 'call' | 'door_pick' | 'step' | 'finish' | 'photo';

export function track(name: EventName, to: string | null, detail: Record<string, string | number | boolean> = {}): void {
  if (!to || typeof window === 'undefined' || window.parent === window) return;
  try { window.parent.postMessage({ type: EVENT_TYPE, version: 1, name, ...detail }, to); } catch { /* never let analytics break the tool */ }
}
