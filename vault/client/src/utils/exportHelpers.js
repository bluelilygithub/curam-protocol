import api from './apiClient';

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
  const res = await api.get(`/api/export/chat/${sessionId}`);
  const blob = await res.blob();
  downloadBlob(blob, `chat-${sessionId}.json`);
}

export async function exportChatPdf(sessionId, title) {
  const res = await api.post('/api/export/chat/pdf', { sessionId, title });
  const blob = await res.blob();
  downloadBlob(blob, `chat-${sessionId}.pdf`);
}

export async function exportProject(projectId) {
  const res = await api.get(`/api/export/project/${projectId}`);
  const blob = await res.blob();
  downloadBlob(blob, `project-${projectId}.json`);
}

export async function exportAllProjects() {
  const res = await api.get('/api/export/projects');
  const blob = await res.blob();
  downloadBlob(blob, 'all-projects.json');
}
