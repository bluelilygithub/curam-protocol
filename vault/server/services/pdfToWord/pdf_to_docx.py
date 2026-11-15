"""
PDF -> Word (.docx) with pdf2docx: real paragraphs, tables and images, a page break per PDF page.
LibreOffice's PDF import was tried first and stacks every page onto page 1 of the .docx, so it is not used for this.

Usage: python3 pdf_to_docx.py <input.pdf> <output.docx>
Output (JSON on stdout): { "ok": true, "pages": n }   or exit 1 with { "ok": false, "error": "..." }

pdf2docx and PyMuPDF are installed from server/services/pdfRedact/requirements.txt (the base image copies that file).
"""
import json
import sys


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
        try:
            pages = len(cv.fitz_doc)
            cv.convert(dst, multi_processing=False)
        finally:
            cv.close()
        print(json.dumps({"ok": True, "pages": pages}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)[:500]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
