// The drawing package as a PDF. pdf-lib (MIT) is loaded only when the PDF is asked for: this module is imported on demand.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { dataUrlBytes } from '../lite/thumbnail';
import { drawPrims } from '@planner-core/export/pdfDraw';
import type { AppProject } from '../app/model';
import { buildSheets, type DrawingMeta, type Fonts, type Sheet } from './drawingPackage';

export interface PackageResult { bytes: Uint8Array; sheets: Pick<Sheet, 'id' | 'title' | 'scale'>[] }

export async function makePackagePdf(project: AppProject, meta: DrawingMeta, opts: { insideImage?: string } = {}): Promise<PackageResult> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${project.name} - drawing package`);
  doc.setCreator('Vault Cellar Planner');
  doc.setProducer('pdf-lib');
  doc.setSubject('Preliminary design only: final site measure required prior to fabrication');
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const sheets = buildSheets(project, meta, fonts, opts);
  for (const s of sheets) {
    const page = doc.addPage([s.width, s.height]);
    // a picture goes under the frame and title block, which are drawn on top of the sheet's margin
    if (s.image) { const bytes = dataUrlBytes(s.image.dataUrl); if (bytes) page.drawImage(await doc.embedJpg(bytes), { x: s.image.x, y: s.image.y, width: s.image.w, height: s.image.h }); }
    drawPrims(page, s, fonts.regular, fonts.bold, fonts.italic);
  }
  return { bytes: await doc.save(), sheets: sheets.map(({ id, title, scale }) => ({ id, title, scale })) };
}

export const packageFileName = (name: string): string => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cellar'}-drawing-package.pdf`;
