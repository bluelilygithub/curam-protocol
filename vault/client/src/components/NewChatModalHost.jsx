import React, { useEffect } from 'react';
import NewChatModal from './NewChatModal';
import useNewChatStore from '../store/newChatStore';
import useProjectStore from '../store/projectStore';

/** Renders NewChatModal once at app root — see openNewChatModal(). */
export default function NewChatModalHost() {
  const options = useNewChatStore((s) => s.options);
  const closeNewChatModal = useNewChatStore((s) => s.closeNewChatModal);
  const { projects, fetchProjects } = useProjectStore();

  useEffect(() => {
    if (options) fetchProjects();
  }, [options, fetchProjects]);

  if (!options) return null;

  return (
    <NewChatModal
      projects={projects}
      defaultMode={options.defaultMode || 'quick'}
      defaultProjectId={options.defaultProjectId || ''}
      onClose={closeNewChatModal}
    />
  );
}
