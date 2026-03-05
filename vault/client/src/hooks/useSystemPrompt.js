import { useMemo } from 'react';
import useProjectStore from '../store/projectStore';

export function useSystemPrompt() {
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((p) => p.id === activeProjectId);

  return useMemo(() => {
    if (!project) return '';
    const parts = [`You are an AI assistant for the project "${project.name}".`];
    if (project.goal) parts.push(`Goal: ${project.goal}`);
    if (project.problem) parts.push(`Problem being solved: ${project.problem}`);
    if (project.audience) parts.push(`Target audience: ${project.audience}`);
    if (project.techStack) parts.push(`Tech stack: ${project.techStack}`);
    if (project.constraints) parts.push(`Constraints: ${project.constraints}`);
    if (project.successCriteria) parts.push(`Success criteria: ${project.successCriteria}`);
    if (project.tone) parts.push(`Communication tone: ${project.tone}`);
    if (project.notes) parts.push(`Additional notes: ${project.notes}`);
    return parts.join('\n');
  }, [project]);
}
