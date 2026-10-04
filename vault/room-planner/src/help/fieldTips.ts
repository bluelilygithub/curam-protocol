// Plain-language help for every inspector field, shown as the themed tooltip (same idea as Vault's field tooltips).
export const FIELD_TIPS: Record<string, string> = {
  X: 'Distance from the plan origin, left to right, in metres. Type an exact value or drag the object on the plan.',
  Y: 'Distance from the plan origin, front to back, in metres. Type an exact value or drag the object on the plan.',
  Width: 'Size across the object, in metres. For a door or window this is the opening width.',
  Length: 'Size front to back, in metres.',
  Height: 'Size from bottom to top, in metres.',
  Elevation: 'Height of the underside above the floor, in metres. A window sill sits at about 0.9 m; furniture normally 0; a picture hangs at about 1.3 m. A small plant takes the height of what you drop it on.',
  Rotation: 'Turn the object in degrees. Rotate 45° (key R) is the quick way.',
  'Offset along wall': 'Where the opening sits along its wall: distance from the wall’s start to the centre of the opening, in metres.',
  'Swing angle': 'How far the door opens, in degrees. The swing area is kept clear of furniture.',
  'Hinge side': 'Which side the door is hinged on, seen from inside the room.',
  'Inside length': 'Length of the wall’s inside face, in metres. Typing a value moves the far corner along the wall, so this sets the room’s size.',
  Thickness: 'Wall thickness in metres. Walls grow outward only; the room’s inside size never changes.',
  Finish: 'The material of the object: wood, fabric, leather and so on. “Default” uses the piece’s standard finish. Shown in the Realistic look.',
  Vendor: 'Who sells or makes this piece. For your own records; not used in the plan.',
  SKU: 'The supplier’s product code. For your own records.',
  'Finish code': 'The supplier’s code for the chosen finish. For your own records.',
  'Unit cost': 'Price of one piece. For your own records.',
  Notes: 'Anything worth remembering about this piece.',
  'Room name': 'The name shown on the room tab and in Projects. Press Enter to save.',
};

export const tipFor = (label: string): string | undefined => FIELD_TIPS[label];
