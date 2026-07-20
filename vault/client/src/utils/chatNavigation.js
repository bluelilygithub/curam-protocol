/** Dispatch vault:load-session after navigation settles. */
export function loadSessionById(sessionId, delayMs = 80) {
  if (!sessionId) return;
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('vault:load-session', { detail: sessionId }));
  }, delayMs);
}

/** Open a recent session in the correct chat route. */
export function openRecentSession(session, navigate, setActiveProject) {
  if (!session?.sessionId) return;
  if (session.projectId) {
    if (setActiveProject) setActiveProject(session.projectId);
    navigate(`/projects/${session.projectId}/chat`);
  } else {
    navigate('/chat');
  }
  loadSessionById(session.sessionId);
}

/** Start a blank chat in quick or project context. */
export function startBlankChat(navigate, { projectId } = {}) {
  document.dispatchEvent(new CustomEvent('vault:new-chat'));
  if (projectId) {
    navigate(`/projects/${projectId}/chat`);
  } else {
    navigate('/chat');
  }
}
