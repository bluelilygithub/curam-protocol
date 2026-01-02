"""
PDF Service - PDF text extraction and processing
Synchronized with global config for high-capacity technical extraction.
"""

import os
import pdfplumber

# Import the centralized limits from config to ensure 100k character capacity
from config import (
    ENGINEERING_PROMPT_LIMIT,
    ENGINEERING_PROMPT_LIMIT_SHORT,
    TRANSMITTAL_PROMPT_LIMIT
)

def prepare_prompt_text(text, doc_type, limit=None):
    """
    Prepare and truncate text for AI processing using centralized config limits.
    
    Args:
        text (str): Raw text to prepare
        doc_type (str): Document type ('engineering', 'transmittal', 'logistics', etc.)
        limit (int, optional): Custom character limit. Defaults based on doc_type.
    
    Returns:
        str: Cleaned and truncated text
    """
    # Clean newlines to normalize text for LLM processing
    cleaned = text.replace("\n", " ").strip()
    
    if doc_type == "engineering" or doc_type == "logistics":
        # Use the high 100k limit from config.py to prevent data loss
        limit = ENGINEERING_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
        
    if doc_type == "transmittal":
        limit = TRANSMITTAL_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
        
    return cleaned

def extract_text(file_obj):
    """
    Extract text from PDF files.
    For images, returns a special marker for Gemini vision API processing.
    """
    # Check if file_obj is an image path
    if isinstance(file_obj, str):
        file_ext = os.path.splitext(file_obj)[1].lower()
        if file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
            return f"[IMAGE_FILE:{file_obj}]"
    
    # PDF processing
    text = ""
    try:
        # Import sanitization logic to fix corrupt UTF-8 characters immediately
        from utils.encoding_fix import sanitize_text
        
        with pdfplumber.open(file_obj) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    # Fix mojibake (e.g., â„¢ -> ™) during the extraction stream
                    text += sanitize_text(extracted) + "\n"
                    
        if not text.strip():
            return f"Error: No text extracted from PDF"
            
    except Exception as e:
        print(f"PDF Extraction Error: {type(e).__name__}: {str(e)}")
        return f"Error: {e}"
        
    return text