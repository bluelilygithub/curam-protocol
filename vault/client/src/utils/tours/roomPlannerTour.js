// The Room Planner runs in its own app inside an iframe (vault/room-planner/), so its tour is built and run there
// (room-planner/src/help/roomPlannerTour.ts, Shepherd.js, same look). This file is Vault's side of it: the shared
// localStorage key (the planner is served from Vault's origin, so both see it) and a starter that opens the planner
// with ?tour=1, which makes the planner reset the key and run the tour.
export const TOUR_KEY = 'vault_tour_room_planner_completed';

export function startRoomPlannerTour(navigate) {
  localStorage.removeItem(TOUR_KEY);
  navigate('/room-planner?tour=1');
}
