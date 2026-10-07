// The Cellar Planner runs in its own app inside an iframe (vault/cellar-planner/), so its tour is built and run there
// (cellar-planner/src/help/cellarTour.ts, Shepherd.js, same look). This file is Vault's side of it: the shared
// localStorage key (the planner is served from Vault's origin, so both see it) and a starter that opens the planner
// with ?tour=1, which makes the planner run the tour.
export const TOUR_KEY = 'vault_tour_cellar_planner_completed';

export function startCellarPlannerTour(navigate) {
  localStorage.removeItem(TOUR_KEY);
  navigate('/cellar-planner?tour=1');
}
