// The Garden Planner runs in its own app inside an iframe (vault/garden-planner/), so its tour is built and run there
// (garden-planner/src/help/gardenTour.ts, Shepherd.js, same look). This file is Vault's side of it: the shared
// localStorage key (the planner is served from Vault's origin, so both see it) and a starter that opens the planner
// with ?tour=1, which makes the planner run the tour.
export const TOUR_KEY = 'vault_tour_garden_planner_completed';

export function startGardenPlannerTour(navigate) {
  localStorage.removeItem(TOUR_KEY);
  navigate('/garden-planner?tour=1');
}
