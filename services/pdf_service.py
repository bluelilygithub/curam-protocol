"""
PDF Service - PDF text extraction and processing

This module provides PDF text extraction and text preparation
for AI processing.

Functions:
- extract_text(): Extract text from PDF files or detect image files
- prepare_prompt_text(): Clean and truncate text for AI prompts

Usage:
    from services.pdf_service import extract_text, prepare_prompt_text
    
    # Extract text from PDF
    text = extract_text("invoice.pdf")
    
    # Prepare for AI processing
    prepared = prepare_prompt_text(text, "finance")

Created: Phase 3.2 - PDF Service Extraction
Lines: 88 (extracted from main.py)
"""

import os
import pdfplumber


# Constants for prompt limits (from main.py)
ENGINEERING_PROMPT_LIMIT = 6000
ENGINEERING_PROMPT_LIMIT_SHORT = 3200
TRANSMITTAL_PROMPT_LIMIT = 3200


def prepare_prompt_text(text, doc_type, limit=None):
    """
    Prepare and truncate text for AI processing.
    
    Args:
        text (str): Raw text to prepare
        doc_type (str): Document type ('engineering', 'transmittal', or other)
        limit (int, optional): Custom character limit. Defaults based on doc_type.
    
    Returns:
        str: Cleaned and truncated text
    
    Examples:
        >>> prepare_prompt_text("Line 1\\nLine 2", "finance")
        'Line 1 Line 2'
        
        >>> long_text = "word " * 10000
        >>> result = prepare_prompt_text(long_text, "engineering")
        >>> len(result) <= ENGINEERING_PROMPT_LIMIT_SHORT
        True
    """
    cleaned = text.replace("\n", " ").strip()
    if doc_type == "engineering":
        limit = ENGINEERING_PROMPT_LIMIT_SHORT if limit is None else limit
        return cleaned[:limit]
    if doc_type == "transmittal":
        limit = TRANSMITTAL_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
    return cleaned


def extract_text(file_obj):
    """
    Extract text from PDF files.
    For images, returns a special marker that indicates the file should 
    be sent directly to Gemini vision API.
    
    Args:
        file_obj: Either a file path (str) or file object
    
    Returns:
        str: Extracted text, error message, or image marker
        
        Special returns:
        - "[IMAGE_FILE:path]" - For image files (jpg, png, gif, bmp)
        - "Error: ..." - If extraction fails
    
    Examples:
        >>> text = extract_text("invoice.pdf")
        >>> "Invoice" in text or "Error" in text
        True
        
        >>> marker = extract_text("drawing.jpg")
        >>> marker.startswith("[IMAGE_FILE:")
        True
    
    Notes:
        - Supports PDF files via pdfplumber
        - Detects image files by extension: .jpg, .jpeg, .png, .gif, .bmp
        - Image files return marker for vision API processing
        - Returns error message if PDF has no extractable text
    """
    # Check if file_obj is a string path or file object
    file_path = None
    if isinstance(file_obj, str):
        file_path = file_obj
        # Check file extension
        file_ext = os.path.splitext(file_path)[1].lower()
        if file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
            # Return special marker for image files - will be handled by Gemini vision API
            return f"[IMAGE_FILE:{file_path}]"
    
    # PDF processing
    text = ""
    try:
        with pdfplumber.open(file_obj) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        if not text.strip():
            return f"Error: No text extracted from PDF"
    except Exception as e:
        print(f"PDF Extraction Error: {type(e).__name__}: {str(e)}")
        return f"Error: {e}"
    return text