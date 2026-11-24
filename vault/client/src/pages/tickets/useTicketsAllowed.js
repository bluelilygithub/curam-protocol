import { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useAuthStore from '../../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../../utils/featureAccess';

/** Whether this person can use Tickets (admins always; members when the feature is on for them), as PlanButton checks Plans. */
export default function useTicketsAllowed() {
  const isAdmin = !!useAuthStore((s) => s.user?.isAdmin);
  const [allowed, setAllowed] = useState(isAdmin);
  useEffect(() => {
    if (isAdmin) { setAllowed(true); return; }
    let live = true;
    api.get('/api/settings/feature-access').then((r) => r.json())
      .then((d) => { if (live) setAllowed({ ...DEFAULT_FEATURE_ACCESS, ...(d?.flags || {}) }.tickets !== false); })
      .catch(() => { if (live) setAllowed(false); });
    return () => { live = false; };
  }, [isAdmin]);
  return allowed;
}
