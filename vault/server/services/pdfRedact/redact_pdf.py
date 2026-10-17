"""
True redaction of rectangles in a PDF: the text under each rectangle is REMOVED from the file (not just
covered by a black box), the box is filled black, and the document metadata is cleared.

Input (JSON on stdin):
  { "input": "<path>", "output": "<path>",
    "pages": { "1": [[x0, y0, x1, y1], ...], ... },           # 1-based pages, PDF points, origin bottom-left
    "summary": { "title": "...", "lines": ["...", ...] } }    # optional: a plain page added at the end
Output (JSON on stdout): { "ok": true, "pages": n, "rects": n }
Exit code 1 with { "ok": false, "error": "..." } on failure.

PyMuPDF (AGPL) is used here as an external tool of this private app; see server/services/pdfRedact/requirements.txt.
"""
import json
import sys


def main():
    try:
        import fitz  # PyMuPDF
    except Exception as e:  # pragma: no cover
        print(json.dumps({"ok": False, "error": f"PyMuPDF is not installed: {e}"}))
        return 1
    try:
        job = json.load(sys.stdin)
        doc = fitz.open(job["input"])
        total = 0
        for key, rects in (job.get("pages") or {}).items():
            idx = int(key) - 1
            if idx < 0 or idx >= doc.page_count:
                raise ValueError(f"page {key} is out of range")
            page = doc[idx]
            height = page.rect.height
            for x0, y0, x1, y1 in rects:
                # PDF coordinates (origin bottom-left) -> MuPDF page coordinates (origin top-left)
                page.add_redact_annot(fitz.Rect(x0, height - y1, x1, height - y0), fill=(0, 0, 0))
                total += 1
            # remove text and line art under the boxes; leave images alone unless they are covered
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS, graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
        summary = job.get("summary")
        if summary and summary.get("lines"):
            last = doc[doc.page_count - 1].rect
            page = doc.new_page(width=last.width, height=last.height)
            y = 72
            page.insert_text((56, y), str(summary.get("title") or ""), fontsize=14, fontname="helv")
            y += 30
            for text in summary["lines"]:
                page.insert_textbox(fitz.Rect(56, y, last.width - 56, y + 48), str(text), fontsize=10.5, fontname="helv")
                y += 24 if len(str(text)) < 90 else 40
        doc.set_metadata({})
        try:
            doc.del_xml_metadata()
        except Exception:
            pass
        doc.save(job["output"], garbage=4, deflate=True, clean=True)
        doc.close()
        print(json.dumps({"ok": True, "pages": len(job.get("pages") or {}), "rects": total}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
