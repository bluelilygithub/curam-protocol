// The customer quote as a PDF. pdf-lib (MIT) is loaded only when the PDF is asked for: this module is imported on demand.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { drawPrims } from '@planner-core/export/pdfDraw';
import type { Catalogue } from '../app/catalogue';
import type { AppProject } from '../app/model';
import type { Fonts } from './drawingPackage';
import { buildQuote, layoutQuote, type QuoteDoc, type QuoteMeta } from './quote';

export type QuoteResult = { ok: true; bytes: Uint8Array; pages: number; doc: QuoteDoc } | { ok: false; blockers: string[] };

export async function makeQuotePdf(project: AppProject, cat: Catalogue | null, meta: QuoteMeta): Promise<QuoteResult> {
  const built = buildQuote(project, cat, meta);
  if (!built.ok) return built;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Quote ${built.doc.reference}`.trim());
  pdf.setAuthor(built.doc.business);
  pdf.setCreator('Vault Cellar Planner');
  pdf.setProducer('pdf-lib');
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const pages = layoutQuote(built.doc, fonts);
  for (const pg of pages) drawPrims(pdf.addPage([pg.width, pg.height]), pg, fonts.regular, fonts.bold, fonts.italic);
  return { ok: true, bytes: await pdf.save(), pages: pages.length, doc: built.doc };
}
