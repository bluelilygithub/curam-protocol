/** True on a phone-sized screen, where the sidebar becomes a bottom sheet over the map. */
export const isPhone = (): boolean => window.matchMedia('(max-width: 767px)').matches;

/**
 * Padding for map.fitBounds so a route is not hidden behind something. On a computer the sidebar is beside the map (the map does not run
 * under it), so only the map buttons on the right need room. On a phone the sidebar is a sheet over the bottom half of the map.
 */
export function fitPadding(): { top: number; left: number; right: number; bottom: number } {
  return isPhone()
    ? { top: 70, left: 40, right: 70, bottom: Math.round(window.innerHeight * 0.52) + 30 }
    : { top: 60, left: 50, right: 80, bottom: 50 };
}
