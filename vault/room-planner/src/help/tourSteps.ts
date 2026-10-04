// The Room Planner tour as data (pure, tested): each step names the element it points at (a `data-tour` value) and whether it needs
// the 3D view or an existing room. The Shepherd wiring is in `roomPlannerTour.ts`.
export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** `data-tour` value of the element to point at; omitted = centred card. */
  target?: string;
  on?: 'top' | 'bottom' | 'left' | 'right';
  /** Show the 3D view first (only possible when the project has a room). */
  needs3d?: boolean;
  /** Make sure the 2D view is showing first. */
  needs2d?: boolean;
  /** Open the panel first. */
  panel?: 'left' | 'right';
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'rp-welcome', title: 'Room Planner — Quick Tour',
    text: 'Design rooms to scale, check that everything fits, then walk through them or make a photo to show a client. This tour takes about a minute.',
  },
  {
    id: 'rp-projects', title: 'Projects & Saving', target: 'rp-project', on: 'bottom',
    text: 'Your work lives in a project, which can hold several rooms. Click here to start a new project, open, rename, duplicate or delete one, or import and export a file. Changes save by themselves a moment after you make them.',
  },
  {
    id: 'rp-rooms', title: 'Rooms', target: 'rp-rooms', on: 'bottom', needs2d: true,
    text: 'Switch between the rooms in this project, add another room, or rename and duplicate one. “Add room” starts a rectangle or lets you draw any shape.',
  },
  {
    id: 'rp-tools', title: 'Tools', target: 'rp-tools', on: 'bottom', needs2d: true,
    text: 'Select (1) picks and moves things. Pan (2) moves the view. Walls (3) drags corners, adds a corner or draws a room. Measure (4) reads a distance. Undo and Redo cover every change.',
  },
  {
    id: 'rp-library', title: 'Library', target: 'rp-library', on: 'right', needs2d: true, panel: 'left',
    text: 'Pick a door, window or piece of furniture, then click the plan to place it. Search or filter by type: seating, tables, storage, bedroom, plants and decor, and rugs. Doors and windows snap to walls; furniture snaps to walls and other pieces and can stand on a rug.',
  },
  {
    id: 'rp-canvas', title: 'The Plan', target: 'rp-stage', on: 'left', needs2d: true,
    text: 'Drag to move a piece, press R to rotate it. Anything that overlaps, blocks a door swing or leaves too little clearance is flagged in red or amber with the reason. The mouse wheel zooms.',
  },
  {
    id: 'rp-inspector', title: 'Inspector', target: 'rp-inspector', on: 'left', needs2d: true, panel: 'right',
    text: 'Select anything to edit it exactly: type a size, position, rotation or finish. Select a wall and type its length to set the room’s size. With nothing selected you can pick a colour palette for the room. Hover any field for what it means.',
  },
  {
    id: 'rp-view', title: '2D and 3D', target: 'rp-view', on: 'bottom',
    text: 'Switch between the plan you edit (2D) and a 3D view of the same design. In 3D you can orbit, switch to isometric, and save viewpoints to return to.',
  },
  {
    id: 'rp-cinematic', title: 'Cinematic', target: 'rp-cinematic', on: 'bottom', needs3d: true,
    text: 'Cinematic shows a clean model with soft shadows. Choose Clay (white model) or Realistic (wood, fabric, daylight), pick a colour palette for the room, then Low or High quality, play a fly-through of your saved views, or press Walk to move through the room at eye height.',
  },
  {
    id: 'rp-photo', title: 'Render Photo', target: 'rp-photo', on: 'bottom', needs3d: true,
    text: 'Make a real picture of your design to download as a PNG. Choose the view (the 3D view, a saved view, or an eye-level view inside the room), lighting, size and quality. It starts grainy and sharpens, and can take minutes, so try Draft first. Your design is never changed.',
  },
  {
    id: 'rp-done', title: 'You’re Set',
    text: 'Hover any button or field for a short explanation. The (i) beside the title explains how it all fits together, and the compass retakes this tour. You can also retake it from Settings.',
  },
];
