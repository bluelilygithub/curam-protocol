import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

// Same merged flags the menus use (GET /api/settings/feature-access). Fetched once per page
// load and shared, so wrapping several routes costs one request.
let flagsPromise = null;
function loadFlags() {
  if (!flagsPromise) {
    flagsPromise = api.get('/api/settings/feature-access')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => ({ ...DEFAULT_FEATURE_ACCESS, ...(data?.flags || {}) }))
      .catch(() => {
        flagsPromise = null;
        return { ...DEFAULT_FEATURE_ACCESS };
      });
  }
  return flagsPromise;
}

/** Renders its page only when the feature is on; otherwise sends the person Home. */
export default function FeatureRoute({ feature, children }) {
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    let live = true;
    loadFlags().then((flags) => { if (live) setAllowed(flags[feature] !== false); });
    return () => { live = false; };
  }, [feature]);

  if (allowed === null) return null;
  return allowed ? children : <Navigate to="/" replace />;
}
