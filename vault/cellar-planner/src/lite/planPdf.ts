import type { AppProject } from '../app/model';

// The plan PDF that goes to the business with an enquiry: the same A3 drawing package the staff planner makes (specification, plan, elevations,
// racks). The visitor never downloads it; the team sends the customer their own copy with the quote. The PDF library is loaded only when an
// enquiry is sent, so it is not part of the planner's first download. Every sheet says it is a preliminary design.

/** Largest PDF sent (bytes). The server refuses anything bigger, so a larger one is left out and the enquiry goes without it. */
export const MAX_PDF_BYTES = 2 * 1024 * 1024;

export async function planPdfBase64(project: AppProject, code: string): Promise<string> {
  const { makePackagePdf } = await import('../export/packagePdf');
  const meta = { company: '', client: '', address: '', projectNo: code.slice(0, 14), drawnBy: 'Online cellar planner', checkedBy: '', date: new Date().toISOString().slice(0, 10) };
  const { bytes } = await makePackagePdf({ ...project, name: 'Website enquiry' }, meta);
  if (bytes.length > MAX_PDF_BYTES) return '';
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
