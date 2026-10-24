'use strict';

// The Route Tracer guide (the round button on Vault's /route-tracer page): a person says what they want to do ("plan a 10 km bike loop", "get my
// Strava file onto the map", "email a map of this walk") and the guide points at the real screens, in order, or says plainly that Route Tracer does
// not do it. It only knows what is written here and the screen the person is looking at; it never sees their tracks or the map. Built on guideCore.js;
// the ids are the app's own, listed in route-tracer/src/guideTools.ts (a test keeps the two in step).

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'search', label: 'Search or ask for a route', group: 'Top of the screen',
    does: 'The box at the top. Type a suburb, address or landmark and press Enter to fly the map there, or ask for a route in plain words, such as "route from Morningside to Carindale", "a 10 km cycling loop from Bulimba" or "Morningside to Carindale about 12 km by bike". A request sets up Plan a route for you to check; nothing is saved. There is a microphone on it.', notes: 'Planning a route from words needs route planning to be set up on the server.' },
  { id: 'tracks', label: 'Your tracks', group: 'Sidebar',
    does: 'The list of your saved tracks, newest first, with a name filter and a Favourites only tick box. Open one to see it on the map with its distance, then star it as a favourite, make a Copy of it, Reverse it (a new track going the other way, without directions), rename it, change its colour, extend it, edit its points, download it as a GPX, TCX or KML file, use Send to watch (download or email the file) for a Zepp watch such as the Amazfit Bip 6, make a Map as PDF or delete it. Tick rows and press Delete to remove several at once. A deleted track is kept for 30 days in the Vault recycle bin (Settings, Recycle bin), and Undo on the message brings it straight back. Tap the line of an open track to see how far that spot is from the start.', notes: 'Up to 1,000 tracks each.' },
  { id: 'draw', label: 'Draw a route', group: 'Sidebar',
    does: 'Trace a route yourself. Freehand: drag a finger or mouse along the map. Click: click each point (double-click to finish); with Follow roads switched on each click finds the road or path from the last one for the way of travelling you pick. Edit points: drag a point to move it, drag a dot between points to add one, delete a point. The distance shows live with numbered distance markers. Undo, Return to start, Out and back, an Elevation chart with climb and descent, then Finish to name and save it.', notes: 'A route keeps at most 20,000 points. A drawing in progress is autosaved in this browser, and a banner offers to restore it next time.' },
  { id: 'plan', label: 'Plan a route', group: 'Sidebar',
    does: 'Directions along real roads and paths. Set a start (A) and an end (B) by typing (suggestions appear as you type) or tapping the map, pick Walking, Hiking, Cycling or Driving, and get up to three routes with distance and time. Loop makes a circular route of a length you type (1 to 50 km) from one start point. Longer route finds a route between A and B of about the length you type. On an A to B route, Add a stop passes through up to eight places in order (you then get one route, not alternatives). Every planned route has turn-by-turn directions you can open and tap to see on the map; they are saved with the track and can be downloaded as a printable PDF from the saved track. Choose a route, then Use selected route to open it in the drawing tools and save it. Reshaping the line afterwards drops the directions.', notes: 'Needs route planning to be set up on the server (the button is greyed out when it is not). Routes are only as good as OpenStreetMap. A and B must be within 50 km in a straight line for a Longer route.' },
  { id: 'places', label: 'Places near the route', group: 'Map buttons',
    does: 'The landmark button on the map. Finds notable buildings, landmarks and entertainment venues within a distance you choose (0.5 to 10 km) of any point on the route being planned or drawn, or the open track, in categories you tick. Results are pins on the map and a list.', notes: 'Needs a route on screen first. The data is from OpenStreetMap and may be incomplete.' },
  { id: 'mappdf', label: 'Map as PDF', group: 'Sidebar',
    does: 'Open a saved track, then press Map as PDF: one A4 page with the map, the route, distance markers and an elevation chart. Download it or email it to one address.', notes: 'Open a saved track first. The email goes to exactly one address, with a copy to you if you tick it, and email must be set up on the server.' },
  { id: 'layers', label: 'Map buttons and style', group: 'Map buttons',
    does: 'The buttons down the right edge of the map: zoom in and out, centre on my location (the browser asks permission), point north, and the map style (Streets for roads and addresses, Outdoor for trails and contours, Satellite).', notes: '' },
  { id: 'settings', label: 'Settings', group: 'Top of the screen',
    does: 'The gear at the top right: choose kilometres or miles (distance markers follow), switch the numbered distance markers on or off, Import GPX, and Take the tour.', notes: 'Remembered on this device only.' },
  { id: 'import', label: 'Import a GPX file', group: 'Top of the screen',
    does: 'Bring in a GPX file from Strava, Garmin or a friend. It opens in the drawing tools in Edit points mode so you can see it, measure it and fix it, then Finish saves it as a track. The file is read in the browser and nothing is uploaded until you save.', notes: 'Files over 15 MB are refused. A very long recording is simplified to fit.' },
  { id: 'info', label: 'How Route Tracer works', group: 'Top of the screen',
    does: 'The plain-language guide to every feature (the ? button at the top right).', notes: '' },
  { id: 'tour', label: 'Guided tour', group: 'Top of the screen',
    does: 'A step-by-step highlighted tour of the screen (about two minutes).', notes: '' },
];

const RULES = [
  'Route Tracer saves tracks to the person\'s Vault account, one list per person. Nothing here is shared with other people.',
  'Distances come from the line itself and match the live readout, the markers and the saved track. Units (km or miles) are chosen in Settings.',
  'A sensible order for a planned trip: Plan a route (A, B, the way of travelling), Use selected route, check or tidy it in the drawing tools (Edit points, Elevation), Finish to save, then Map as PDF, download the GPX, or Send to watch.',
  'To trace a route you already know, use Draw a route. Click mode with Follow roads switched on snaps each click to real roads and paths; Freehand does not follow roads.',
  'Planning, loops and Follow roads use the OpenRouteService routing service through Vault, so they need it to be set up, and work only where OpenStreetMap has roads or paths.',
  'The Open buttons in this chat only show a screen. They never draw, change, save or delete anything. If a drawing or a plan is in progress, an Open button asks you to finish or cancel it first rather than throwing it away.',
];

const NOT_POSSIBLE = [
  'Recording a walk or ride live with GPS, or guiding you turn by turn while you move. Route Tracer gives written turn-by-turn directions for a planned route (to read or print), but it does not follow your position or speak them.',
  'Snapping a freehand line to roads. Use Click mode with Follow roads, or Plan a route, for a route that follows roads.',
  'Sharing a track with another person by link, offline maps, or working with no internet.',
  'Weather, traffic, opening hours, public transport times, or reviews of places.',
  'Routes where OpenStreetMap has no road or path (the routing says so), or ferry, flight and rail routing.',
  'Seeing the person\'s tracks, their drawing or the map. The guide knows what each screen does and which one is open, but cannot see what is on the map.',
  'Exporting anything other than GPX, TCX, KML or the one-page Map as PDF (no Strava upload). It cannot push a route straight to a watch: you download the file and import it in the app that comes with the watch (Zepp for Amazfit).',
];

const SYSTEM = `You are the guide to Route Tracer, a map tool for tracing, planning, saving and exporting walking, hiking, cycling and driving routes. People say, in everyday words, what they want to do. You point them to the right screen(s), in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a screen, a button or a feature, and never promise something the notes say Route Tracer cannot do.
- You cannot see this person's tracks, drawing or map. Never state or guess what is on their map.
- Never give safety, legal or navigation advice (whether a route is safe, open to the public, suitable for a bike, or the right way to go). Routes are suggestions from map data; say they should check the route on the ground.
- Be plain and short, as to someone who is not technical. Avoid jargon; if you must use a term such as "waypoint" or "loop", say what it means in the same sentence.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Route Tracer guide', feature: 'route_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'ROUTE TRACER SCREENS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your route, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askRouteTutor: guide.ask,
};
