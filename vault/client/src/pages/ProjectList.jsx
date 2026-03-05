import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import NewProjectModal from '../components/NewProjectModal';
import { getModelShortName } from '../utils/models';

function ProjectList() {
  const { projects, fetchProjects, create, setActive } = useProjectStore();
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();
  const getIcon = useIcon();

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (data) => {
    const project = await create(data);
    setShowModal(false);
    navigate(`/projects/${project.id}`);
  };

  return (
    <div className="flex flex-col h-full">
      {showModal && <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />}

      {projects.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
          >
            {getIcon('folder', { size: 24 })}
          </div>
          <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
            Welcome to Project Vault
          </h1>
          <p className="text-sm mb-8 text-center max-w-xs" style={{ color: 'var(--color-muted)' }}>
            Create a project to give Claude focused context for your work.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 14, color: 'white' })}
            New Project
          </button>
        </div>
      ) : (
        /* Project grid */
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Projects</h1>
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                {getIcon('plus', { size: 13, color: 'white' })}
                New
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => { setActive(project.id); navigate(`/projects/${project.id}`); }}
                  className="text-left p-4 rounded-xl border transition-all hover:shadow-sm"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}
                    >
                      {getIcon('folder', { size: 15 })}
                    </div>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="font-medium text-sm mb-1 truncate" style={{ color: 'var(--color-text)' }}>
                    {project.name}
                  </h3>
                  {project.goal ? (
                    <p className="text-xs line-clamp-2" style={{ color: 'var(--color-muted)' }}>{project.goal}</p>
                  ) : (
                    <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>No description</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    {project.model && (
                      <span className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.8 }}>
                        {getModelShortName(project.model)}
                      </span>
                    )}
                    {project.chatCount > 0 && (
                      <span className="text-xs ml-auto" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                        {project.chatCount} {project.chatCount === 1 ? 'chat' : 'chats'}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectList;
