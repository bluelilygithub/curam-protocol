// The drawing package as a PDF. pdf-lib (MIT) is loaded only when the PDF is asked for: this module is imported on demand.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawPrims } from '@planner-core/export/pdfDraw';
import type { AppProject } from '../app/model';
import { buildSheets, type DrawingMeta, type Fonts, type Sheet } from './drawingPackage';

export interface PackageResult { bytes: Uint8Array; sheets: Pick<Sheet, 'id' | 'title' | 'scale'>[] }

export async function makePackagePdf(project: AppProject, meta: DrawingMeta): Promise<PackageResult> {
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
  const sheets = buildSheets(project, meta, fonts);
  for (const s of sheets) {
    const page = doc.addPage([s.width, s.height]);
    drawPrims(page, s, fonts.regular, fonts.bold, fonts.italic);
  }
  return { bytes: await doc.save(), sheets: sheets.map(({ id, title, scale }) => ({ id, title, scale })) };
}

export const packageFileName = (name: string): string => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cellar'}-drawing-package.pdf`;
