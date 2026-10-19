'use strict';

// Every guide chat in Vault (the round "guide" button bottom right of a page: PDF, Graphics, Video Tools, Finance) is listed here.
// The chat itself is ONE shared component (client/src/components/tutor/TutorChat.jsx), so every guide gets the same behaviour,
// including the readable tooltip and "Email this conversation". A guide only has to say who it is:
//
//   - client: its config has `guideId` (the key below), the same `name` and the same `endpoint`;
//   - server: it is listed here, and its endpoint is mounted and classified in server/testing/routeManifest.json.
//
// `server/config/guides.test.js` (npm run test:guides) fails if a guide on the client is missing from this list, if the
// name/endpoint disagree, if its endpoint is not mounted, or if a required config key is missing. How to add one: docs/guide-chat.md.

const GUIDES = {
  pdf: { name: 'PDF guide', endpoint: '/api/pdf-tutor' },
  graphics: { name: 'Graphics guide', endpoint: '/api/graphics-tutor' },
  video: { name: 'Video Tools tutor', endpoint: '/api/videos/tutor' },
  music: { name: 'Music tutor', endpoint: '/api/music/tutor' },
  finance: { name: 'Finance guide', endpoint: '/api/finance-tutor' },
  cellar: { name: 'Cellar Planner guide', endpoint: '/api/cellar-tutor' },
  route: { name: 'Route Tracer guide', endpoint: '/api/route-tutor' },
};

module.exports = { GUIDES };
