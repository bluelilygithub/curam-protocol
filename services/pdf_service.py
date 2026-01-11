"""
PDF Service - Optimized PDF text extraction and processing

Performance optimizations:
- PyMuPDF (fitz) as primary extractor (faster than pdfplumber)
- pdfplumber as fallback for complex layouts
- Parallel page processing for multi-page documents

Functions:
- extract_text(): Extract text from PDF files or detect image files
- extract_text_fast(): Optimized extraction using PyMuPDF
- prepare_prompt_text(): Clean and truncate text for AI prompts

Created: Phase 3.2 - PDF Service Extraction (optimized)
"""

import os
import concurrent.futures
from typing import Optional, List, Tuple

ENGINEERING_PROMPT_LIMIT = 10000
ENGINEERING_PROMPT_LIMIT_SHORT = 3200
TRANSMITTAL_PROMPT_LIMIT = 3200

try:
    import fitz
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False
    fitz = None

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    pdfplumber = None


def prepare_prompt_text(text, doc_type, limit=None):
    """
    Prepare and truncate text for AI processing.
    
    Args:
        text (str): Raw text to prepare
        doc_type (str): Document type ('engineering', 'transmittal', or other)
        limit (int, optional): Custom character limit. Defaults based on doc_type.
    
    Returns:
        str: Cleaned and truncated text
    """
    cleaned = text.replace("\n", " ").strip()
    if doc_type == "engineering":
        limit = ENGINEERING_PROMPT_LIMIT_SHORT if limit is None else limit
        return cleaned[:limit]
    if doc_type == "transmittal":
        limit = TRANSMITTAL_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
    return cleaned


def _extract_page_pymupdf(page) -> str:
    """Extract text from a single PyMuPDF page"""
    try:
        return page.get_text("text") or ""
    except Exception:
        return ""


def _extract_page_pdfplumber(page) -> str:
    """Extract text from a single pdfplumber page"""
    try:
        return page.extract_text() or ""
    except Exception:
        return ""


def extract_text_fast(file_path: str, use_parallel: bool = True) -> Tuple[str, str]:
    """
    Fast PDF text extraction using PyMuPDF with pdfplumber fallback.
    
    Args:
        file_path: Path to PDF file
        use_parallel: Use parallel processing for multi-page docs (default True)
    
    Returns:
        Tuple of (extracted_text, extraction_method)
        extraction_method is 'pymupdf', 'pdfplumber', or 'error'
    """
    try:
        from utils.encoding_fix import sanitize_text
    except ImportError:
        sanitize_text = lambda x: x
    
    if PYMUPDF_AVAILABLE:
        try:
            doc = fitz.open(file_path)
            pages = list(doc)
            
            if use_parallel and len(pages) > 3:
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                    page_texts = list(executor.map(_extract_page_pymupdf, pages))
            else:
                page_texts = [_extract_page_pymupdf(page) for page in pages]
            
            text = "\n".join(page_texts)
            doc.close()
            
            if text.strip():
                return sanitize_text(text), 'pymupdf'
        except Exception as e:
            print(f"PyMuPDF extraction failed: {e}")
    
    if PDFPLUMBER_AVAILABLE:
        try:
            with pdfplumber.open(file_path) as pdf:
                pages = pdf.pages
                
                if use_parallel and len(pages) > 3:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                        page_texts = list(executor.map(_extract_page_pdfplumber, pages))
                else:
                    page_texts = [_extract_page_pdfplumber(page) for page in pages]
                
                text = "\n".join(page_texts)
                
                if text.strip():
                    return sanitize_text(text), 'pdfplumber'
        except Exception as e:
            print(f"pdfplumber extraction failed: {e}")
    
    return "Error: No text extracted from PDF", 'error'


def extract_text(file_obj):
    """
    Extract text from PDF files.
    For images, returns a special marker for vision API processing.
    
    Uses optimized extraction: PyMuPDF first, pdfplumber fallback.
    
    Args:
        file_obj: Either a file path (str) or file object
    
    Returns:
        str: Extracted text, error message, or image marker
        
        Special returns:
        - "[IMAGE_FILE:path]" - For image files (jpg, png, gif, bmp)
        - "Error: ..." - If extraction fails
    """
    file_path = None
    if isinstance(file_obj, str):
        file_path = file_obj
        file_ext = os.path.splitext(file_path)[1].lower()
        if file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
            return f"[IMAGE_FILE:{file_path}]"
    
    if file_path:
        text, method = extract_text_fast(file_path)
        if method != 'error':
            print(f"PDF extracted via {method}: {len(text)} chars")
        return text
    
    try:
        from utils.encoding_fix import sanitize_text
    except ImportError:
        sanitize_text = lambda x: x
    
    text = ""
    if PDFPLUMBER_AVAILABLE:
        try:
            with pdfplumber.open(file_obj) as pdf:
                for page in pdf.pages:
                    extracted = page.extract_text()
                    if extracted:
                        text += sanitize_text(extracted) + "\n"
            if text.strip():
                return text
        except Exception as e:
            print(f"PDF Extraction Error: {type(e).__name__}: {str(e)}")
            return f"Error: {e}"
    
    if not text.strip():
        return "Error: No text extracted from PDF"
    
    return text


def get_pdf_info(file_path: str) -> dict:
    """
    Get PDF metadata and page count without full extraction.
    Useful for progress indication.
    """
    info = {
        'page_count': 0,
        'has_text': False,
        'extraction_method': None
    }
    
    if PYMUPDF_AVAILABLE:
        try:
            doc = fitz.open(file_path)
            info['page_count'] = len(doc)
            first_page_text = doc[0].get_text("text") if len(doc) > 0 else ""
            info['has_text'] = bool(first_page_text.strip())
            info['extraction_method'] = 'pymupdf'
            doc.close()
            return info
        except Exception:
            pass
    
    if PDFPLUMBER_AVAILABLE:
        try:
            with pdfplumber.open(file_path) as pdf:
                info['page_count'] = len(pdf.pages)
                first_page_text = pdf.pages[0].extract_text() if pdf.pages else ""
                info['has_text'] = bool(first_page_text and first_page_text.strip())
                info['extraction_method'] = 'pdfplumber'
        except Exception:
            pass
    
    return info
