import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useNewChatStore from '../store/newChatStore';

/** Handles global "new chat" actions and routes immediately. */
export default function NewChatModalHost() {
  const navigate = useNavigate();
  const options = useNewChatStore((s) => s.options);
  const closeNewChatModal = useNewChatStore((s) => s.closeNewChatModal);

  useEffect(() => {
    if (!options) return;
    const mode = options.defaultMode || 'quick';
    const projectId = options.defaultProjectId;

    document.dispatchEvent(new CustomEvent('vault:new-chat'));
    if (mode === 'project' && projectId) {
      navigate(`/projects/${projectId}/chat`);
    } else {
      navigate('/chat');
    }
    closeNewChatModal();
  }, [options, navigate, closeNewChatModal]);

  return null;
}
