"""
Prompt building utilities for different document types.
Contains prompt templates and builders for Gemini AI extraction.
"""

# Prompt length limits
ENGINEERING_PROMPT_LIMIT = 6000
ENGINEERING_PROMPT_LIMIT_SHORT = 3200
TRANSMITTAL_PROMPT_LIMIT = 3200


def prepare_prompt_text(text, doc_type, limit=None):
    """
    Prepare text for inclusion in a prompt by cleaning and limiting length.
    
    Args:
        text: Raw text to prepare
        doc_type: Type of document ('engineering', 'transmittal', 'finance')
        limit: Optional custom character limit
        
    Returns:
        Cleaned and limited text string
    """
    cleaned = text.replace("\n", " ").strip()
    
    if doc_type == "engineering":
        limit = ENGINEERING_PROMPT_LIMIT_SHORT if limit is None else limit
        return cleaned[:limit]
    if doc_type == "transmittal":
        limit = TRANSMITTAL_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
    
    return cleaned


def build_finance_prompt(text):
    """
    Build prompt for invoice/financial document extraction.
    
    Args:
        text: Extracted text from the document
        
    Returns:
        Formatted prompt string for Gemini AI
    """
    return f"""
Extract invoice data from this document. Return JSON with these fields:
- Vendor (company name)
- Date (invoice date in YYYY-MM-DD format)
- InvoiceNum (invoice number)
- Cost (pre-tax amount as number)
- GST (tax amount as number)
- FinalAmount (total including tax as number)
- Currency (3-letter code like AUD, USD)
- ABN (Australian Business Number if present)
- Summary (brief description of items/services)

Document text:
{text}

Return ONLY valid JSON, no other text.
"""


def build_engineering_prompt(text):
    """
    Build prompt for engineering schedule extraction (beams, columns).
    This is a simplified version - the full prompt in main.py contains
    extensive validation rules and examples.
    
    Args:
        text: Extracted text from the engineering drawing
        
    Returns:
        Formatted prompt string for Gemini AI
    """
    # NOTE: This is simplified. The full prompt is ~400 lines in main.py
    # For production, copy the complete ENGINEERING PROMPT from main.py
    return f"""
Extract structural engineering schedule data from this document.

Expected columns (beam schedule):
- Mark (member identification)
- Size (section size like "310UC137")
- Qty (quantity)
- Length (length in mm)
- Grade (steel grade like "300PLUS")
- PaintSystem (paint specification)
- Comments (installation notes, handwritten changes)

Expected columns (column schedule):
- Mark (member identification)
- SectionType (section type like "UC", "UB")
- Size (section size)
- Length (length in mm)
- Grade (steel grade)
- BasePlate (base plate details)
- CapPlate (cap plate details)
- Finish (paint/finish specification)
- Comments (notes)

Return JSON array of objects with these fields.
Mark missing data as "N/A".
Flag uncertain extractions with warning emoji.

Document text:
{text}

Return ONLY valid JSON array, no other text.
"""


def build_transmittal_prompt(text):
    """
    Build prompt for drawing register/transmittal extraction.
    
    Args:
        text: Extracted text from the drawing title block
        
    Returns:
        Formatted prompt string for Gemini AI
    """
    return f"""
Extract drawing register information from this document title block.

Expected fields:
- DwgNo (drawing number like "S-001", "S-100")
- Rev (revision letter/number)
- Title (drawing title)
- Scale (drawing scale like "1:100")

Document text:
{text}

Return JSON with these fields.
Mark missing data as "N/A".

Return ONLY valid JSON, no other text.
"""


def build_prompt(text, doc_type):
    """
    Build a prompt tailored to the selected department/document type.
    
    Args:
        text: Document text
        doc_type: Type of document ('finance', 'engineering', 'transmittal')
        
    Returns:
        Formatted prompt string for Gemini AI
    """
    if doc_type == "engineering":
        return build_engineering_prompt(text)
    elif doc_type == "transmittal":
        return build_transmittal_prompt(text)
    elif doc_type == "finance":
        return build_finance_prompt(text)
    else:
        return build_finance_prompt(text)  # Default to finance

