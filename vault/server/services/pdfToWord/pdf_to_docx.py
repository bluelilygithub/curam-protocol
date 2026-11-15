"""
PDF -> Word (.docx) with pdf2docx: real paragraphs, tables and images, a page break per PDF page.
LibreOffice's PDF import was tried first and stacks every page onto page 1 of the .docx, so it is not used for this.

Usage: python3 pdf_to_docx.py <input.pdf> <output.docx>
Output (JSON on stdout): { "ok": true, "pages": n, ... }   or exit 1 with { "ok": false, "error": "..." }

pdf2docx and PyMuPDF are installed from server/services/pdfRedact/requirements.txt (the base image copies that file).

Repairs on top of plain pdf2docx (found on a Chrome-printed press kit, 2026-11-15):

1. Sliced text. pdf2docx guesses "stream tables" from text laid out side by side. A running footer with text at
   both ends ("NEAL PRICE ... | Page 1 of 6") plus horizontal rules made it turn the bottom half of a page into a
   2-column table, cutting every body line in half (the right half landed in a narrow cell or was lost). After
   parsing, any page where a stream table cell boundary cuts through a PDF text span is re-parsed: first with that
   page's running header/footer text removed, then, if still sliced, with stream tables off for that page only.
   The same retry runs when a stream table reaches into the running header/footer (on the press kit that swallowed
   a photo; on a 13-page questionnaire it added 9 near-empty pages). Removed header/footer text is put back as the
   page's real Word header/footer, so nothing is lost.

2. Nameless fonts. Chrome/Skia prints web fonts as Type3 fonts with no name, so the .docx asked Word for a font
   called "Type3 (14 0 R)" and Word substituted its default serif everywhere. Each such font is classified from its
   rendered glyphs ('l' / 'I'): serif feet -> Georgia, else Arial; thick stem -> bold; slanted stem -> italic.

3. Invisible header text. The press kit's table header is two dark-red rectangles; pdf2docx shaded the first cell
   and dropped the second, leaving "DETAILS" white on white. A table cell with only light text and no shading gets
   the fill of the dark shape found behind that text in the PDF, when that shape is about as wide as the cell.
"""
import json
import re
import sys
from collections import Counter, defaultdict


# ── 1. Stream tables that slice text ─────────────────────────────────────────

def _stream_tables(layout):
    for blk in layout.blocks:
        if not blk.is_table_block:
            continue
        if blk.is_stream_table_block:
            yield blk
        for row in blk:
            for cell in row:
                if cell is not None and hasattr(cell, 'blocks'):
                    yield from _stream_tables(cell)


def _page_stream_tables(page):
    for section in page.sections:
        for column in section:
            yield from _stream_tables(column)


def _slices_text(page, fitz_page, band_lines=()):
    """True when a stream table on this parsed page has cell boundaries running through a PDF text span, or
    reaches into the page's running header/footer (that is how the footer drags body content into a table; on the
    press kit it also swallowed a photo)."""
    tables = list(_page_stream_tables(page))
    if not tables:
        return False
    for t in tables:
        for x0, y0, x1, y1 in (l['bbox'] for l in band_lines):
            if min(x1, t.bbox.x1) - max(x0, t.bbox.x0) > 0 and min(y1, t.bbox.y1) - max(y0, t.bbox.y0) > 0:
                return True
    spans = [s['bbox'] for b in fitz_page.get_text('dict')['blocks'] for l in b.get('lines', [])
             for s in l['spans'] if s['text'].strip()]
    for t in tables:
        cells = [c.bbox for row in t for c in row if c is not None and c.bbox]
        for x0, y0, x1, y1 in spans:
            h = max(y1 - y0, 1)
            hits = sum(1 for c in cells
                       if min(x1, c.x1) - max(x0, c.x0) > 2 and min(y1, c.y1) - max(y0, c.y0) > 0.5 * h)
            if hits >= 2:
                return True
    return False


def _running_band_lines(doc, band=0.08):
    """{page_no: [line, ...]} text lines (PyMuPDF dict lines) in the top/bottom band of a page whose text (digits
    ignored) repeats on another page: running headers and footers."""
    found = defaultdict(list)
    for page in doc:
        h = page.rect.height
        for b in page.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                y0, y1 = l['bbox'][1], l['bbox'][3]
                if y1 > h * band and y0 < h * (1 - band):
                    continue
                text = re.sub(r'\d+', '#', ''.join(s['text'] for s in l['spans'])).strip()
                if text:
                    found[text].append((page.number, l))
    out = defaultdict(list)
    for text, hits in found.items():
        if len({p for p, _ in hits}) >= 2:
            for p, line in hits:
                out[p].append(line)
    return out


def _swap_pages(target, source, ids):
    for i in ids:
        target.pages._instances[i] = source.pages[i]


def _repair_sliced_pages(Converter, src, tmp_pdf, cv, settings):
    """Re-parse pages whose text a stream table sliced. Returns (footer_fixed_ids, no_stream_ids, bands); the
    caller puts the removed header/footer text of footer_fixed pages back as real Word headers/footers."""
    import fitz  # PyMuPDF
    bands = _running_band_lines(cv.fitz_doc)
    bad = [p.id for p in cv.pages if p.finalized and _slices_text(p, cv.fitz_doc[p.id], bands.get(p.id, ()))]
    if not bad:
        return [], [], bands
    fixed = []
    retry = [i for i in bad if bands.get(i)]
    if retry:
        doc = fitz.open(src)
        for i in retry:
            page = doc[i]
            for line in bands[i]:
                page.add_redact_annot(fitz.Rect(line['bbox']))
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
        doc.save(tmp_pdf)
        doc.close()
        alt = Converter(tmp_pdf)
        alt.parse(pages=retry, **settings)
        fixed = [i for i in retry if not _slices_text(alt.pages[i], alt.fitz_doc[i])]
        _swap_pages(cv, alt, fixed)
    still = [i for i in bad if i not in fixed]
    if still:
        alt = Converter(src)
        alt.parse(pages=still, **dict(settings, parse_stream_table=False))
        _swap_pages(cv, alt, still)
    return fixed, still, bands


def _add_running_text(docx_path, page_ids, bands, fonts, page_rects):
    """Put the header/footer lines removed from page_ids back into that page's Word header/footer, so the text is
    kept but no longer sits in the body where pdf2docx turns it into a table.

    pdf2docx lays the body out with zero page margins, so ordinary header/footer paragraphs would take space from
    the body and push every page's last lines onto an extra page. Each line is placed instead as a floating frame
    (w:framePr) at its exact PDF position, which takes no body space, and the header/footer's one required flow
    paragraph is shrunk to 1pt. Lines keep size, colour and left/centre/right alignment. Pages not listed get an
    empty header/footer (their running text is still in the body). Returns how many pages got one."""
    from docx import Document
    from docx.enum.section import WD_SECTION
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor
    d = Document(docx_path)
    starts = [s for k, s in enumerate(d.sections) if k == 0 or s.start_type == WD_SECTION.NEW_PAGE]

    def tiny(para):
        pf = para.paragraph_format
        pf.space_before = pf.space_after = Pt(0)
        pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        pf.line_spacing = Pt(1)
        ppr = para._p.get_or_add_pPr()
        rpr = ppr.find(qn('w:rPr'))  # the paragraph mark's run properties; rPr is the last child of pPr
        if rpr is None:
            rpr = ppr.makeelement(qn('w:rPr'), {})
            ppr.append(rpr)
        for el in rpr.findall(qn('w:sz')):
            rpr.remove(el)
        rpr.append(rpr.makeelement(qn('w:sz'), {qn('w:val'): '2'}))

    def add_line(part, line, page_w):
        x0, y0, x1, y1 = line['bbox']
        w = (x1 - x0) * 1.2 + 8  # room for Word's slightly different glyph widths, so the line never wraps
        centre = (x0 + x1) / 2
        if x1 > page_w * 0.75 and x0 > page_w * 0.45:
            align, fx = WD_ALIGN_PARAGRAPH.RIGHT, x1 - w
        elif abs(centre - page_w / 2) < page_w * 0.05:
            align, fx = WD_ALIGN_PARAGRAPH.CENTER, centre - w / 2
        else:
            align, fx = WD_ALIGN_PARAGRAPH.LEFT, x0
        para = part.add_paragraph()
        para.alignment = align
        pf = para.paragraph_format
        pf.space_before = pf.space_after = Pt(0)
        ppr = para._p.get_or_add_pPr()
        frame = ppr.makeelement(qn('w:framePr'), {
            qn('w:w'): str(int(w * 20)), qn('w:wrap'): 'none', qn('w:vAnchor'): 'page', qn('w:hAnchor'): 'page',
            qn('w:x'): str(int(max(fx, 0) * 20)), qn('w:y'): str(int(max(y0 - 1, 0) * 20))})
        ppr.insert(0, frame)  # framePr comes first after pStyle/keepNext etc.; none of those are set here
        for sp in line['spans']:
            if not sp['text']:
                continue
            run = para.add_run(sp['text'])
            run.font.size = Pt(round(sp['size'] * 2) / 2)
            c = sp['color']
            run.font.color.rgb = RGBColor((c >> 16) & 255, (c >> 8) & 255, c & 255)
            info = fonts.get(sp['font'])
            if info:
                run.font.name = info['name']
                run.font.bold = bool(info['bold'])
                run.font.italic = bool(info['italic'])
            elif not _needs_font(sp['font']):
                run.font.name = re.sub(r'^[A-Z]{6}\+', '', sp['font']).split('-')[0]
                run.font.bold = bool(sp['flags'] & 16)
                run.font.italic = bool(sp['flags'] & 2)
            else:
                run.font.name = 'Arial'

    done = 0
    for pid, section in enumerate(starts):
        section.header.is_linked_to_previous = False
        section.footer.is_linked_to_previous = False
        section.header_distance = Pt(0)
        section.footer_distance = Pt(0)
        for part in (section.header, section.footer):
            for para in part.paragraphs[1:]:
                para._p.getparent().remove(para._p)
            if not part.paragraphs:
                part.add_paragraph()
            part.paragraphs[0].text = ''
            tiny(part.paragraphs[0])
        if pid not in page_ids or pid >= len(page_rects):
            continue
        page_w, page_h = page_rects[pid]
        seen = []  # some PDFs print the same footer twice on top of itself; Word would stack the copies
        for line in sorted(bands.get(pid, []), key=lambda l: l['bbox'][1]):
            key = (''.join(sp['text'] for sp in line['spans']).strip(), line['bbox'])
            if any(k[0] == key[0] and all(abs(u - v) < 2 for u, v in zip(k[1], key[1])) for k in seen):
                continue
            seen.append(key)
            add_line(section.header if line['bbox'][3] <= page_h / 2 else section.footer, line, page_w)
        done += 1
    d.save(docx_path)
    return done


# ── 2. Nameless fonts ────────────────────────────────────────────────────────

def _needs_font(name):
    return not name or name.startswith('Type3') or name.lower().startswith('unnamed')


def _classify_fonts(doc, max_samples=12):
    """{pdf font name: {'name': 'Georgia'|'Arial', 'bold': bool, 'italic': bool}} for nameless fonts."""
    import fitz
    samples = defaultdict(list)
    for page in doc:
        for b in page.get_text('rawdict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    if not _needs_font(s['font']) or len(samples[s['font']]) >= max_samples:
                        continue
                    for c in s['chars']:
                        if c['c'] in 'lI' and len(samples[s['font']]) < max_samples:
                            samples[s['font']].append((page.number, c['bbox'], s['size']))
    result = {}
    for font, ss in samples.items():
        votes = Counter()
        for pno, bbox, size in ss:
            zoom = 400 / max(size, 1)
            pix = doc[pno].get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=fitz.Rect(bbox), colorspace=fitz.csGRAY)
            w, h, px = pix.width, pix.height, pix.samples
            rows = []
            for y in range(h):
                xs = [x for x in range(w) if px[y * w + x] < 128]
                rows.append((min(xs), max(xs)) if xs else None)
            ink = [i for i, r in enumerate(rows) if r]
            if len(ink) < 10:
                continue
            top, bot = ink[0], ink[-1]
            mid = rows[(top + bot) // 2]
            if not mid:
                continue
            width = lambda r: r[1] - r[0] + 1
            foot = max(width(rows[i]) for i in ink[-max(2, (bot - top) // 15):])
            upper, lower = rows[top + (bot - top) // 4], rows[bot - (bot - top) // 4]
            slant = ((upper[0] + upper[1]) - (lower[0] + lower[1])) / 2 / max(bot - top, 1) if upper and lower else 0
            votes['n'] += 1
            votes['serif'] += foot / width(mid) > 1.4
            votes['bold'] += width(mid) / zoom / size > 0.12
            votes['italic'] += slant > 0.08
        n = votes['n']
        if n:
            result[font] = {'name': 'Georgia' if votes['serif'] * 2 > n else 'Arial',
                            'bold': votes['bold'] * 2 > n, 'italic': votes['italic'] * 2 > n}
        else:
            result[font] = {'name': 'Arial', 'bold': None, 'italic': None}
    return result


def _fix_fonts(docx_path, fonts):
    """Replace nameless fonts in the .docx. Returns how many runs changed."""
    from docx import Document
    from docx.oxml.ns import qn
    d = Document(docx_path)
    changed = 0
    for rfonts in d.element.body.iter(qn('w:rFonts')):
        name = rfonts.get(qn('w:ascii')) or ''
        if not _needs_font(name):
            continue
        info = fonts.get(name, {'name': 'Arial', 'bold': None, 'italic': None})
        for attr in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
            rfonts.set(qn(attr), info['name'])
        rpr = rfonts.getparent()
        for key, tag in (('bold', 'w:b'), ('italic', 'w:i')):
            if info[key]:
                el = rpr.find(qn(tag))
                if el is None:
                    el = rpr.makeelement(qn(tag), {})
                    rpr.append(el)
                el.set(qn('w:val'), '1')
        changed += 1
    if changed:
        d.save(docx_path)
    return changed


# ── 3. Light text that lost its cell background ──────────────────────────────

def _luma(rgb):
    r, g, b = rgb
    return 0.299 * r + 0.587 * g + 0.114 * b  # 0..1


def _hex_luma(h):
    try:
        return _luma(tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)))
    except Exception:
        return None


def _light_text_fills(doc):
    """{span text: (fill hex, shape width pt, shape height pt)} for light-coloured PDF text sitting on a dark filled shape (e.g. a
    table header bar)."""
    out = {}
    for page in doc:
        spans = []
        for b in page.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                for s in l['spans']:
                    c = s['color']
                    rgb = (((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255)
                    if s['text'].strip() and _luma(rgb) > 0.85:
                        spans.append((s['text'].strip(), s['bbox']))
        if not spans:
            continue
        drawings = page.get_drawings()
        images = [r['bbox'] for r in page.get_image_info()]

        def plain(rect, colour):
            """A bar or panel, not a card carrying artwork: no image over it and no differently coloured shape
            inside it (thin divider lines are fine). Shading a Word cell paints over pictures pdf2docx places
            behind the text (a logo guide's dark cards lost their logos)."""
            for bx0, by0, bx1, by1 in images:
                if min(bx1, rect.x1) - max(bx0, rect.x0) > 1 and min(by1, rect.y1) - max(by0, rect.y0) > 1:
                    return False
            for o in drawings:
                r = o['rect']
                if r == rect or r.width * r.height < 25 or min(r.width, r.height) < 2 or not rect.contains(r):
                    continue
                c = o.get('fill') or o.get('color')
                if c is None or any(abs(u - v) > 0.03 for u, v in zip(c[:3], colour[:3])):
                    return False
            return True

        fills = [(d['rect'], d['fill']) for d in drawings
                 if d.get('fill') and _luma(d['fill'][:3]) < 0.6 and d['rect'].width > 2 and d['rect'].height > 2
                 and plain(d['rect'], d['fill'])]
        for text, (x0, y0, x1, y1) in spans:
            # the shape must cover the whole text (not a small accent under part of it)
            under = [(f.width * f.height, f.width, f.height, fill) for f, fill in fills
                     if f.x0 - 1 <= x0 and x1 <= f.x1 + 1 and f.y0 - 1 <= y0 and y1 <= f.y1 + 1]
            if under:
                _, width, height, fill = min(under, key=lambda u: u[0])
                out.setdefault(text, ('%02x%02x%02x' % tuple(round(v * 255) for v in fill[:3]), width, height))
    return out


_NO_FILL = {'', 'auto', 'ffffff', 'none'}


def _near(a, b, tol=3):
    """Same colour give or take rounding (pdf2docx writes 8b2d2a where PyMuPDF's floats round to 8c2d2b)."""
    try:
        return all(abs(int(a[i:i + 2], 16) - int(b[i:i + 2], 16)) <= tol for i in (0, 2, 4))
    except ValueError:
        return False


def _set_cell_fill(tc, fill, qn):
    tcpr = tc.find(qn('w:tcPr'))
    if tcpr is None:
        tcpr = tc.makeelement(qn('w:tcPr'), {})
        tc.insert(0, tcpr)
    shd = tcpr.find(qn('w:shd'))
    if shd is None:
        shd = tcpr.makeelement(qn('w:shd'), {})
        # schema order: ... tcBorders, shd, noWrap, tcMar, textDirection, tcFitText, vAlign, hideMark
        later_tags = {qn(t) for t in ('w:noWrap', 'w:tcMar', 'w:textDirection', 'w:tcFitText', 'w:vAlign', 'w:hideMark')}
        later = next((el for el in tcpr if el.tag in later_tags), None)
        if later is not None:
            later.addprevious(shd)
        else:
            tcpr.append(shd)
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)


def _cell_width_pt(tc, qn):
    w = tc.find(qn('w:tcPr') + '/' + qn('w:tcW'))
    if w is None or w.get(qn('w:type')) != 'dxa':
        return None
    try:
        return int(w.get(qn('w:w'))) / 20
    except (TypeError, ValueError):
        return None


def _row_height_pt(tc, qn):
    tr = tc.getparent()
    h = tr.find(qn('w:trPr') + '/' + qn('w:trHeight')) if tr is not None else None
    try:
        return int(h.get(qn('w:val'))) / 20 if h is not None else None
    except (TypeError, ValueError):
        return None


def _fits(tc, qn, shape_w, shape_h):
    """The dark shape is about the size of the cell (not a small badge or circle inside a bigger cell)."""
    cell_w, row_h = _cell_width_pt(tc, qn), _row_height_pt(tc, qn)
    if cell_w is None or cell_w > shape_w * 1.5 + 6:
        return False
    return row_h is None or row_h <= shape_h * 1.5 + 6


def _fix_invisible_cells(docx_path, fills):
    """Give a table cell back its background when it holds only light text and has no shading, using the fill
    found behind that text in the PDF (pdf2docx drops the second of two adjacent filled header cells, leaving
    white text on white). A cell with no text of its own that only wraps a shaded nested table (pdf2docx nests
    the first header cell in a narrower table) gets that fill too, so the bar has no white gap.
    Only fills found behind light text in the PDF are used, only when that shape is about as wide as the cell
    (a white digit in a small circle must not paint a whole cell), and never on a cell that wraps other tables
    (it would paint the whole box). Returns how many cells were shaded."""
    if not fills:
        return 0
    from docx import Document
    from docx.oxml.ns import qn
    known = [(f.lower(), w, h) for f, w, h in fills.values()]
    d = Document(docx_path)
    fixed = 0
    for tc in list(d.element.body.iter(qn('w:tc'))):
        shd = tc.find(qn('w:tcPr') + '/' + qn('w:shd'))
        if shd is not None and (shd.get(qn('w:fill')) or '').lower() not in _NO_FILL:
            continue
        runs = [r for p in tc.findall(qn('w:p')) for r in p.findall(qn('w:r'))]  # own runs, not nested tables
        texts = [''.join(t.text or '' for t in r.findall(qn('w:t'))).strip() for r in runs]
        text = ''.join(texts)
        nested = tc.findall(qn('w:tbl'))
        if not text:
            if len(nested) == 1 and len(list(nested[0].iter(qn('w:tc')))) == 1:
                inner = {(s.get(qn('w:fill')) or '').lower() for s in tc.iter(qn('w:shd'))} - _NO_FILL
                if len(inner) == 1:
                    colour = next(iter(inner))
                    if any(_near(colour, k) and _fits(tc, qn, w, h) for k, w, h in known):
                        _set_cell_fill(tc, colour, qn)
                        fixed += 1
            continue
        if nested:
            continue
        colours = [r.find(qn('w:rPr') + '/' + qn('w:color')) for r, t in zip(runs, texts) if t]
        if any(c is None or (_hex_luma(c.get(qn('w:val')) or '') or 0) <= 0.85 for c in colours):
            continue
        hit = fills.get(text) or next((f for t, f in fills.items() if t in text), None)
        if hit and _fits(tc, qn, hit[1], hit[2]):
            _set_cell_fill(tc, hit[0], qn)
            fixed += 1
    if fixed:
        d.save(docx_path)
    return fixed


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: pdf_to_docx.py <input.pdf> <output.docx>"}))
        return 1
    try:
        from pdf2docx import Converter
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"pdf2docx is not installed: {e}", "missing": True}))
        return 1
    src, dst = sys.argv[1], sys.argv[2]
    try:
        import logging
        logging.disable(logging.WARNING)  # pdf2docx logs every page to stderr
        cv = Converter(src)
        notes = []
        try:
            pages = len(cv.fitz_doc)
            settings = cv.default_settings
            settings.update(multi_processing=False)
            cv.parse(**settings)
            fixed, no_stream, bands = [], [], {}
            try:
                fixed, no_stream, bands = _repair_sliced_pages(Converter, src, dst + '.tmp.pdf', cv, settings)
            except Exception as e:  # repairs are best-effort; the plain conversion still stands
                notes.append(f'table repair skipped: {str(e)[:200]}')
            cv.make_docx(dst, **settings)
            fonts = {}
            try:
                fonts = _classify_fonts(cv.fitz_doc)
            except Exception as e:
                notes.append(f'font detection skipped: {str(e)[:200]}')
            fills = {}
            try:
                fills = _light_text_fills(cv.fitz_doc)
            except Exception as e:
                notes.append(f'cell fill detection skipped: {str(e)[:200]}')
            page_rects = [(p.rect.width, p.rect.height) for p in cv.fitz_doc]
        finally:
            cv.close()
        runs = cells = running = 0
        if fixed:
            try:
                running = _add_running_text(dst, set(fixed), bands, fonts, page_rects)
            except Exception as e:
                notes.append(f'header/footer restore skipped: {str(e)[:200]}')
        try:
            runs = _fix_fonts(dst, fonts)
        except Exception as e:
            notes.append(f'font fix skipped: {str(e)[:200]}')
        try:
            cells = _fix_invisible_cells(dst, fills)
        except Exception as e:
            notes.append(f'cell fill fix skipped: {str(e)[:200]}')
        print(json.dumps({"ok": True, "pages": pages,
                          "footerRetryPages": [i + 1 for i in fixed], "noStreamTablePages": [i + 1 for i in no_stream],
                          "fontsReplaced": {k: v['name'] for k, v in fonts.items()}, "fontRuns": runs,
                          "cellsShaded": cells, "headerFooterPages": running, "notes": notes}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)[:500]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
