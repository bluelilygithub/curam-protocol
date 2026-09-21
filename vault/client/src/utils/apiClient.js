import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';

// Addendum 2 (docs/crm-activity-model.md): a CRM-linked task can be marked
// done from ~20 different surfaces (Kanban, Calendar, mobile tile, focus
// mode, etc.) — none of which know anything about the CRM. Rather than
// touch every one of those call sites, this is the one place all of them
// already funnel through (per this file's own header comment: "use this
// for all /api/ calls"). PUT /api/tasks/:id includes `crmFollowUp` in its
// response only on the todo->done transition of a client-linked task (see
// server/routes/tasks.js) — surfaced here as a toast with a link to log
// the outcome, skipped if already on that client's page.
function maybeShowCrmFollowUpToast(url, res) {
  if (!/^\/api\/tasks\/\d+$/.test(url) || !res.ok) return;
  res.clone().json().then(data => {
    if (!data?.crmFollowUp) return;
    const { clientId, clientName, taskId } = data.crmFollowUp;
    if (window.location.pathname === `/clients/${clientId}`) return; // already there
    useToastStore.getState().addToast(
      `Task linked to ${clientName} completed.`,
      'success',
      undefined,
      { label: 'Log outcome in CRM', href: `/clients/${clientId}?logTask=${taskId}` }
    );
  }).catch(() => {}); // never let this side-channel break the real response
}

function getHeaders(extra = {}) {
  const token = useAuthStore.getState().token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function handleResponse(res) {
  if (res.status === 401) {
    useAuthStore.getState().clearAuth();
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }
  return res;
}

const api = {
  get: async (url) => {
    const res = await fetch(url, { headers: getHeaders() });
    return handleResponse(res);
  },
  post: async (url, body, opts = {}) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    return handleResponse(res);
  },
  put: async (url, body, opts = {}) => {
    const res = await fetch(url, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    maybeShowCrmFollowUpToast(url, res);
    return handleResponse(res);
  },
  patch: async (url, body, opts = {}) => {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
    return handleResponse(res);
  },
  delete: async (url, body, opts = {}) => {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
    return handleResponse(res);
  },
  // For multipart/form-data uploads — do NOT set Content-Type (browser sets it with boundary)
  postForm: async (url, formData, opts = {}) => {
    const token = useAuthStore.getState().token;
    const res = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      signal: opts.signal,
    });
    return handleResponse(res);
  },
  /**
   * Download a binary artifact. Checks HTTP status before treating body as a file
   * (avoids saving JSON error bodies as .docx/.pdf).
   */
  download: async (url, fallbackName = 'download') => {
    const token = useAuthStore.getState().token;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      throw new Error('Not authenticated');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Download failed (${res.status})`);
    }
    const type = res.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download returned JSON instead of a file');
    }
    const blob = await res.blob();
    let filename = fallbackName;
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
    if (m?.[1]) {
      try {
        filename = decodeURIComponent(m[1].trim());
      } catch {
        filename = m[1].trim();
      }
    }
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    return { filename, size: blob.size };
  },
  // For streaming (SSE) — returns raw Response so caller can read the stream
  stream: async (url, body, signal) => {
    const token = useAuthStore.getState().token;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401) {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      throw new Error('Not authenticated');
    }
    return res;
  },
};

export default api;
