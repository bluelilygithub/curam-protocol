export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportChatJson(sessionId) {
  const res = await fetch(`/api/export/chat/${sessionId}`);
  const blob = await res.blob();
  downloadBlob(blob, `chat-${sessionId}.json`);
}

export async function exportChatPdf(sessionId, title) {
  const res = await fetch('/api/export/chat/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, title }),
  });
  const blob = await res.blob();
  downloadBlob(blob, `chat-${sessionId}.pdf`);
}

export async function exportProject(projectId) {
  const res = await fetch(`/api/export/project/${projectId}`);
  const blob = await res.blob();
  downloadBlob(blob, `project-${projectId}.json`);
}

export async function exportAllProjects() {
  const res = await fetch('/api/export/projects');
  const blob = await res.blob();
  downloadBlob(blob, 'all-projects.json');
}
