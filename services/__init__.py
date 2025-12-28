"""
Services Package - Business Logic Layer

This package contains service modules that encapsulate business logic
and operations separated from route handlers.

Modules:
- validation_service: Data validation and OCR error detection

Usage:
    from services.validation_service import detect_low_confidence
    
    # Or import the whole module:
    from services import validation_service
    
    confidence = validation_service.detect_low_confidence(text)

Phase 3 Extraction Status:
- Phase 3.1: validation_service ✅ Complete (323 lines)
- Phase 3.2: pdf_service ⏳ Pending (88 lines)
- Phase 3.3: gemini_service ⏳ Pending (2,138 lines)
"""

# Optionally, you can expose commonly-used functions at package level
# This allows: from services import detect_low_confidence
# Instead of: from services.validation_service import detect_low_confidence

from services.validation_service import (
    detect_low_confidence,
    correct_ocr_errors,
    detect_ocr_character_errors,
    validate_engineering_field
)

__all__ = [
    'detect_low_confidence',
    'correct_ocr_errors', 
    'detect_ocr_character_errors',
    'validate_engineering_field',
]

# Package metadata
__version__ = '0.1.0'
__author__ = 'Curam AI'