// Same naming as Vault's other tools. The planner runs on Vault's origin, so Vault's Settings page can reset these.
export const TOUR_KEY = 'vault_tour_room_planner_completed';
export const INFO_SEEN_KEY = 'vault_room_planner_info_seen';

export const safeGet = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
export const safeSet = (k: string, v: string): void => { try { window.localStorage.setItem(k, v); } catch { /* storage unavailable: it will simply show again */ } };
export const safeRemove = (k: string): void => { try { window.localStorage.removeItem(k); } catch { /* ignore */ } };
