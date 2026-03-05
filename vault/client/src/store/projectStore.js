import { create } from 'zustand';

const useProjectStore = create((set, get) => ({
  projects: [],
  activeProjectId: null,

  fetchProjects: async () => {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    set({ projects });
    return projects;
  },

  setActive: (id) => set({ activeProjectId: id }),

  create: async (data) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const project = await res.json();
    set((s) => ({ projects: [project, ...s.projects] }));
    return project;
  },

  update: async (id, data) => {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const project = await res.json();
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? project : p)),
    }));
    return project;
  },

  remove: async (id) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    }));
  },
}));

export default useProjectStore;
