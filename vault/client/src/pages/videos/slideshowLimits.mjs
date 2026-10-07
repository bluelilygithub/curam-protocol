// What the Slideshow tool can and cannot do, shown before "Plan my video" runs so nobody spends
// time describing effects the tool can't produce. Pure + dependency-free so it is unit-tested
// (node client/src/pages/videos/slideshowLimits.test.mjs).
//
// The Slideshow only arranges the user's own still photos with ffmpeg: order, timing, slow
// zoom/pan, colour look, captions, transitions, plus an uploaded music track. Anything that needs
// NEW pixels (other viewpoints, added objects, people, lighting changes) or new audio is outside
// it — each limit below names the realistic way around it using other Video Tools.

export const SLIDESHOW_CAN = [
  'Put your photos in a sensible order and set how long each one stays on screen',
  'Slow zoom in/out or pan on each photo (a gentle "camera move" over a still)',
  'A colour look: warm, cool, vivid, black & white, vintage or cinematic',
  'Transitions between photos: crossfade, dissolve, wipe, slide and more',
  'Captions on individual slides',
  'Background music — a track you upload (it loops or trims to fit)',
];

export const SLIDESHOW_LIMITS = [
  {
    id: 'views',
    title: 'New viewpoints, walk-arounds and camera orbits',
    why: 'The slideshow only moves over the photo you gave it. It can zoom or pan, but it cannot show the other side of an object or invent an angle that is not in the picture.',
    workaround: 'Use Create → Generate clip: choose the photo as the reference image and describe the move ("slow camera orbit around the cabinet"). It is AI-generated, billed per clip and can take a few tries. Or film a real walk-around and bring it in with Compose → Join videos.',
    pattern: /walk[\s-]?around|walk\s?through|orbit|rotat|360|new angle|other side|fly[\s-]?(through|over)|tour|different (view|angle)|views? of/i,
  },
  {
    id: 'objects',
    title: 'Adding or changing things inside a photo',
    why: 'Photos are used exactly as supplied. The slideshow cannot add bottles to empty racks, remove clutter or restyle a room.',
    workaround: 'Edit the photo first (an image editor or an AI image-edit tool, e.g. "fill these racks with wine bottles") and use the edited picture. Or describe it in Create → Generate clip with the photo as the reference image.',
    pattern: /\b(fill(ed)?|stock(ed)?|populate|remove (the )?(clutter|objects?)|(add|put|place|insert)\w* (some |a |the |more )?(wine|bottles?|furniture|plants?|items?|objects?|products?|people|decor))\b|bottles?|\bempty\b/i,
  },
  {
    id: 'people',
    title: 'People and actions (someone taking a bottle out, etc.)',
    why: 'Stills cannot be turned into someone moving. Nothing in this tool animates people or objects.',
    workaround: 'Create → Generate clip can attempt it from a photo plus a description, but hands and bottles often look wrong, so expect several attempts. For a reliable result, film the action and join it in with Compose → Join videos.',
    pattern: /person|people|man\b|woman|someone|hand|remov(e|ing)|pick(s|ing)? (up|out)|pour|open(s|ing)? (the )?(door|fridge)|walking|using/i,
  },
  {
    id: 'lighting',
    title: 'Changing the lighting inside a photo (lights on / off)',
    why: 'The slideshow can tint a photo, but it cannot switch lights on or off within it.',
    workaround: 'Supply two photos — one lights on, one lights off — and the slideshow will cross-fade between them. Or ask for the change in Create → Generate clip.',
    pattern: /lights?\b|lamp|glow|illuminat|\bon and off\b|switch(ed|ing)? on|dark(er|en)?|bright(er|en)?|night/i,
  },
  {
    id: 'music',
    title: 'Creating music or sound',
    why: 'The slideshow cannot compose music. It can only play a track you upload under the video.',
    workaround: 'Upload a royalty-free track in the "Background music" box below (it loops or trims to fit). You can also add or swap music afterwards with Optimise → Mute / replace audio.',
    pattern: /music|song|soundtrack|sound\b|audio|chill(ed)?|jazz|ambient|lo-?fi|beat|melod|tune|piano/i,
  },
];

/** Ids of the limits the description's wording runs into (empty description = none). */
export function detectLimits(description) {
  const text = String(description || '');
  if (!text.trim()) return [];
  return SLIDESHOW_LIMITS.filter((l) => l.pattern.test(text)).map((l) => l.id);
}

/** All limits, the ones the description touches first (original order kept within each group). */
export function orderedLimits(description) {
  const hit = new Set(detectLimits(description));
  const flagged = SLIDESHOW_LIMITS.filter((l) => hit.has(l.id)).map((l) => ({ ...l, triggered: true }));
  const rest = SLIDESHOW_LIMITS.filter((l) => !hit.has(l.id)).map((l) => ({ ...l, triggered: false }));
  return [...flagged, ...rest];
}
