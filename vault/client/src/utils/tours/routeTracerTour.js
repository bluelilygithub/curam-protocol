// Route Tracer runs in its own app inside an iframe (vault/route-tracer/), so its tour is built and run there
// (route-tracer/src/help/tour.ts, Shepherd.js, same look as Vault's other tours). This file is Vault's side of it: the shared
// localStorage key (the app is served from Vault's origin, so both see it) and a starter that opens the app with ?tour=1,
// which makes the app run the tour.
export const TOUR_KEY = 'vault_tour_route_tracer_completed';

export function startRouteTracerTour(navigate) {
  localStorage.removeItem(TOUR_KEY);
  navigate('/route-tracer?tour=1');
}
