export const APP_NAV_GROUPS = [
  {
    id: 'everyday',
    label: 'Everyday',
    items: [
      { id: 'notes', label: 'Notes', path: '/notes', icon: 'pen', featureKey: null },
      { id: 'guide', label: 'User Guide', path: '/guide', icon: 'help', featureKey: null },
      { id: 'site', label: 'Website', path: 'https://example.com', icon: 'link', featureKey: null, external: true },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    items: [
      { id: 'recipes', label: 'Recipes', path: '/recipes', icon: 'book', featureKey: 'recipes' },
      { id: 'gardenPlanner', label: 'Garden', path: '/garden', icon: 'leaf', featureKey: 'gardenPlanner' },
      { id: 'routeTracer', label: 'Routes', path: '/routes', icon: 'map', featureKey: 'routeTracer' },
      { id: 'mood', label: 'Mood', path: '/mood', icon: 'smile', featureKey: 'mood' },
      { id: 'changelog', label: 'Changelog', path: '/changelog', icon: 'list', featureKey: null, adminOnly: true },
    ],
  },
];

export function isNavItemActive() { return false; }
