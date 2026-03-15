import { create } from 'zustand';
import api from '../utils/apiClient';

const useProjectStore = create((set, get) => ({
  projects: [],
  activeProjectId: null,

  fetchProjects: async () => {
    const res = await api.get('/api/projects');
    const projects = await res.json();
    set({ projects });
    return projects;
  },

  setActive: (id) => set({ activeProjectId: id }),

  create: async (data) => {
    const res = await api.post('/api/projects', data);
    const project = await res.json();
    set((s) => ({ projects: [project, ...s.projects] }));
    return project;
  },

  update: async (id, data) => {
    const res = await api.put(`/api/projects/${id}`, data);
    const project = await res.json();
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? project : p)),
    }));
    return project;
  },

  reorder: async (orderedIds) => {
    set((s) => ({
      projects: orderedIds.map(id => s.projects.find(p => p.id === id)).filter(Boolean),
    }));
    await api.patch('/api/projects/reorder', { ids: orderedIds });
  },

  remove: async (id) => {
    await api.delete(`/api/projects/${id}`);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    }));
  },

  archive: async (id) => {
    await api.patch(`/api/projects/${id}/archive`);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    }));
  },

  unarchive: async (id) => {
    const res = await api.patch(`/api/projects/${id}/unarchive`);
    const project = await res.json();
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },
}));

export default useProjectStore;
