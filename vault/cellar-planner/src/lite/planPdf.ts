import type { AppProject } from '../app/model';

// "Download my plan": the same A3 drawing package the staff planner makes (specification, plan, elevations, racks), for the visitor to keep. The PDF
// library is loaded only when it is asked for, so it is not part of the planner's first download. Every sheet says it is a preliminary design.

export async function downloadPlan(project: AppProject, code: string): Promise<void> {
  const { makePackagePdf } = await import('../export/packagePdf');
  const meta = { company: '', client: '', address: '', projectNo: code.slice(0, 14), drawnBy: 'Online cellar planner', checkedBy: '', date: new Date().toISOString().slice(0, 10) };
  const { bytes } = await makePackagePdf({ ...project, name: 'My wine cellar' }, meta);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'my-wine-cellar-plan.pdf';
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
