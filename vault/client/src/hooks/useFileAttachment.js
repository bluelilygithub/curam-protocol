import { useState, useCallback } from 'react';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useFileAttachment(projectId) {
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Upload a new file to the project, then attach it to the current message
  const uploadAndAttach = useCallback(async (file) => {
    if (!projectId) { setError('Select a project first'); return null; }
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/files/upload/${projectId}`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const record = await res.json();

      // For images, generate a local preview URL
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

      setAttachments(prev => [...prev, {
        id: record.id,
        name: record.name,
        mimetype: record.mimetype,
        extractedText: record.extractedText,
        aiSummary: record.aiSummary,
        preview,
        isNew: true,
      }]);
      return record;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setUploading(false);
    }
  }, [projectId]);

  // Attach a file that already exists in the project
  const attachExisting = useCallback((record) => {
    if (attachments.some(a => a.id === record.id)) return;
    setAttachments(prev => [...prev, {
      id: record.id,
      name: record.name,
      mimetype: record.mimetype,
      extractedText: record.extractedText,
      aiSummary: record.aiSummary,
      preview: null,
      isNew: false,
    }]);
  }, [attachments]);

  const remove = useCallback((id) => {
    setAttachments(prev => {
      const att = prev.find(a => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    attachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview); });
    setAttachments([]);
  }, [attachments]);

  return { attachments, uploading, error, uploadAndAttach, attachExisting, remove, clear };
}
