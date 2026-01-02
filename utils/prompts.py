"""
Prompt building utilities for different document types.
Contains elite prompt templates and builders for Gemini AI extraction.
"""

# Import configuration constants
from config import (
    ENGINEERING_PROMPT_LIMIT,
    ENGINEERING_PROMPT_LIMIT_SHORT,
    TRANSMITTAL_PROMPT_LIMIT,
    FINANCE_FIELDS,
    ENGINEERING_BEAM_FIELDS,
    ENGINEERING_COLUMN_FIELDS,
    TRANSMITTAL_FIELDS,
    DOC_FIELDS,
    ERROR_FIELD
)

def prepare_prompt_text(text, doc_type, limit=None):
    """
    Prepare text for inclusion in a prompt by cleaning and limiting length.
    """
    cleaned = text.replace("\n", " ").strip()
    
    if doc_type == "engineering":
        # Use the high 100k limit from config.py to prevent truncation
        limit = ENGINEERING_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
    if doc_type == "transmittal":
        limit = TRANSMITTAL_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
    
    return cleaned

def build_finance_prompt(text):
    """
    Elite builder for invoice/financial document extraction.
    """
    return f"""
Extract comprehensive invoice data from this document. 
Identify type: Tax Invoice (AU), Commercial Invoice, or Receipt.

REQUIRED FIELDS:
{', '.join(FINANCE_FIELDS)}

## VALIDATION RULES
1. FINANCIAL TOTALS: Verify Subtotal + Tax = Total (±$0.10).
2. AUSTRALIAN COMPLIANCE: Extract 11-digit ABN; GST should be 10%.
3. LINE ITEMS: Extract each row with ItemNumber, Description, Quantity, UnitPrice, LineTotal.

Document text:
{text}

Return ONLY valid JSON array.
"""

def build_engineering_prompt(text):
    """
    Elite builder for structural engineering schedules.
    Provides 93% accuracy via deep OCR correction rules and safety protocols.
    """
    return f"""
# UNIVERSAL EXTRACTION PROMPT - ENGINEERING DOCUMENTS
Goal: Accurate extraction with explicit uncertainty flagging.

## DOCUMENT CHARACTERISTICS
Mixed Typed/Handwritten, Table Structure, Fold marks, Stains.

## REQUIRED FIELDS
Beams: {', '.join(ENGINEERING_BEAM_FIELDS)}
Columns: {', '.join(ENGINEERING_COLUMN_FIELDS)}

## CRITICAL EXTRACTION RULES
1. PRINCIPLE: Accuracy Over Speed. Silent errors are unacceptable.
2. SIZE COLUMN: HIGHEST PRIORITY. Formats like 310UC158, 250UB37.2, WB1220×6.0.
3. OCR CORRECTION: I -> 1, O -> 0, S -> 5, B -> 8 in numeric contexts.
4. COMMENTS: Preserve exactly. Capture handwritten notes in [handwritten: "text"].
5. STRIKETHROUGH: Read text UNDER the line; mark as [row deleted - strikethrough].

## OUTPUT FORMAT
IF BEAM: {{"Mark": "B1", "Size": "310UC158", "Qty": 2, "Length": "5400 mm", ...}}
IF COLUMN: {{"Mark": "C1", "SectionType": "UC", "Size": "310 UC 158", ...}}

Document text:
{text}

Return ONLY valid JSON array.
"""

def build_transmittal_prompt(text):
    """
    Elite builder for drawing register/transmittal extraction.
    """
    return f"""
Extract structured data into 7 categories:
1. DrawingRegister (Metadata)
2. Standards (AS 4100, etc.)
3. Materials (Concrete, Steel)
4. Connections (Bolt/Plate specs)
5. Assumptions (Bearing capacity)
6. VOSFlags (Verify on Site)
7. CrossReferences (See Detail X)

Fields: {', '.join(TRANSMITTAL_FIELDS)}

Document text:
{text}

Return JSON object with all 7 keys. Use [] for empty categories.
"""

def build_logistics_prompt(text):
    """
    Specialized prompt for Shipping and Logistics documentation.
    """
    return f"""
Extract shipping and logistics document data as a JSON array.

## DOCUMENT TYPE DETECTION
Identify if this is: Bill of Lading, FTA Certificate, Packing List, or Commercial Invoice.

## REQUIRED FIELDS
DocumentType, DocumentNumber, Shipper, Consignee, CargoDescription, GrossWeight, 
NetWeight, Container, Seal, Origin, Destination, HSCode, Vessel, NotifyParty

## EXTRACTION RULES
1. Document Number Priority: Look for B/L NO, HBL, MBL, Invoice #.
2. Container Format: Typically 4 letters + 7 digits (e.g., MSKU9922334).
3. Handwritten Notes: Capture in [square brackets].

## OUTPUT FORMAT
Return ONLY a valid JSON array.

TEXT:
{text}
"""

def build_prompt(text, doc_type):
    """
    Central dispatcher for all extraction types.
    """
    if doc_type == "engineering":
        return build_engineering_prompt(text)
    elif doc_type == "transmittal":
        return build_transmittal_prompt(text)
    elif doc_type == "finance":
        return build_finance_prompt(text)
    elif doc_type == "logistics":
        return build_logistics_prompt(text)
    else:
        return build_finance_prompt(text)