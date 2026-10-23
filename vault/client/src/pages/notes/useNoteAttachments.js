import { useCallback, useState } from 'react';
import api from '../../utils/apiClient';
import { fileProblem } from './noteAttachments.mjs';

/**
 * Putting files on the open note and taking them off. The list itself lives with the note (the page keeps it on `selected.attachments`);
 * `onChange(noteId, update)` is how this changes it: `update` is a function from the old list to the new one, applied only if that
 * note is still the open one (so a slow upload finishing after you moved to another note changes nothing on screen).
 * Files are sent one after another. A file that is refused (here or by the server) is named in `error`; the others still go.
 */
export default function useNoteAttachments({ noteId, attachments, onChange }) {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');

  const upload = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!noteId || !files.length) return;
    setError('');
    setUploading((n) => n + files.length);
    let have = attachments.length;
    const problems = [];
    for (const file of files) {
      const problem = fileProblem(file, have);
      if (problem) {
        problems.push(`${file.name}: ${problem}`);
      } else {
        try {
          const form = new FormData();
          form.append('file', file, file.name);
          const res = await api.postForm(`/api/notes/${noteId}/attachments`, form);
          const data = await res.json().catch(() => ({}));
          if (res.ok) { have += 1; onChange(noteId, (list) => [...list, data]); } else problems.push(`${file.name}: ${data.error || 'it could not be attached.'}`);
        } catch {
          problems.push(`${file.name}: it could not be attached. Check your connection and try again.`);
        }
      }
      setUploading((n) => n - 1);
    }
    if (problems.length) setError(problems.join(' '));
  }, [noteId, attachments.length, onChange]);

  const remove = useCallback(async (att) => {
    setError('');
    try {
      const res = await api.delete(`/api/attachments/${att.id}`);
      if (!res.ok) throw new Error('remove failed');
      onChange(noteId, (list) => list.filter((a) => a.id !== att.id));
    } catch {
      setError(`${att.filename} could not be removed. Try again.`);
    }
  }, [noteId, onChange]);

  return { uploading: uploading > 0, error, clearError: () => setError(''), upload, remove };
}
