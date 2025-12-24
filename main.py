import os
import json
import re
from flask import Flask, request, render_template_string, session, Response, send_file, abort, url_for, send_from_directory, redirect, jsonify
import google.generativeai as genai
import pdfplumber
import pandas as pd
import io
try:
    import grpc
except ImportError:
    grpc = None
import time
from werkzeug.utils import secure_filename
import requests
from urllib.parse import quote

# Try to import specific exception types
try:
    from google.api_core import exceptions as google_exceptions
except ImportError:
    google_exceptions = None

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# --- CONFIGURATION ---
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

FINANCE_UPLOAD_DIR = os.path.join('uploads', 'finance')
os.makedirs(FINANCE_UPLOAD_DIR, exist_ok=True)

# --- DEPARTMENT CONFIG ---
DEFAULT_DEPARTMENT = "finance"
DEPARTMENT_SAMPLES = {
    "finance": {
        "label": "Sample invoices",
        "description": "Finance department samples",
        "folder": "invoices",
        "samples": [
            {"path": "invoices/Bne.pdf", "label": "Bne.pdf"},
            {"path": "invoices/CloudRender.pdf", "label": "CloudRender.pdf"},
            {"path": "invoices/Tingalpa.pdf", "label": "Tingalpa.pdf"},
            {"path": "invoices/John Deere Construction & Forestry Commercial Invoice.pdf", "label": "John Deere Construction & Forestry Commercial Invoice.pdf"},
            {"path": "invoices/Lenovo Global Logistics Commercial Invoice.pdf", "label": "Lenovo Global Logistics Commercial Invoice.pdf"},
            {"path": "invoices/Shenzhen Fast-Circuit Co Commercial Invoice.pdf", "label": "Shenzhen Fast-Circuit Co Commercial Invoice.pdf"}
        ]
    },
    "engineering": {
        "label": "Structural drawings",
        "description": "Engineering department samples",
        "folder": "drawings",
        "samples": [
            {"path": "drawings/schedule_cad.pdf", "label": "beam_schedule_CLEAN_cad.pdf"},
            {"path": "drawings/schedule_revit.pdf", "label": "column_schedule_CLEAN_revit.pdf"},
            {"path": "drawings/beam_messy_scan.pdf", "label": "beam_schedule_MESSY_scan.pdf"},
            {"path": "drawings/column_complex_vector.jpeg", "label": "column_schedule_MESSY_scan.jpeg"}
        ]
    },
    "transmittal": {
        "label": "Drawing register samples",
        "description": "Structural drafter transmittal samples",
        "folder": "drawings",
        "samples": [
            {"path": "drawings/s001_general_notes.pdf", "label": "S-001 General Notes"},
            {"path": "drawings/s100_foundation_plan.pdf", "label": "S-100 Foundation Plan"},
            {"path": "drawings/s101_ground_floor_plan.pdf", "label": "S-101 Ground Floor"},
            {"path": "drawings/s102_framing_plan.pdf", "label": "S-102 Framing Plan"},
            {"path": "drawings/s500_standard_details.pdf", "label": "S-500 Details"}
        ]
    }
}
SAMPLE_TO_DEPT = {
    sample["path"]: dept_key
    for dept_key, group in DEPARTMENT_SAMPLES.items()
    for sample in group["samples"]
}
ROUTINE_DESCRIPTIONS = {
    "finance": [
        ("Finance / Admin: \"The Invoice Gatekeeper\"",
         """<p><strong>What it does:</strong> It acts as an <strong>Intelligent Document Processing (IDP)</strong> engine, translating raw incoming PDF bills (from subcontractors, hardware stores, software subscriptions, etc.) into structured data. It ignores layout variations and reliably extracts the core financial fields required to push the bill into your accounting platform (Xero/MYOB).</p>
         <p><strong>The Current Grind:</strong> The workflow involves excessive manual repetition: an admin staff member opens an email, saves the PDF, manually types the Vendor name, Date, Total, and Invoice ID into the accounting platform, and cross-checks for errors.</p>
         <p><strong>Frequency:</strong> Daily volume for a 70-staff firm is typically <strong>70–100 documents</strong> every week (external vendor invoices alone). We will initially focus the pilot on vendor invoices.</p>
         <p><strong>The Saving (Vendor Invoices Only):</strong><br>Manual: 3 minutes per document × 70 docs = <strong>3.5 hours/week</strong>.<br>AI: Near-instant. Accuracy is the new focus.<br><strong>Value:</strong> This immediate saving frees the Office Manager to focus on strategic tasks like staff culture, cost centre analysis, and debt recovery rather than transactional data entry.</p>
         <hr style="margin: 20px 0;">
         <p><strong>Future Impact: Internal Documents (Phase 2 Upside)</strong><br>The greatest opportunity lies in extending this capability to <strong>internal documents</strong>. By proving the engine on external invoices, the firm gains a validated tool ready to automate staff timesheets, project expense receipts, and internal cost allocations. This dramatically expands efficiency and eliminates manual project coding errors.</p>"""),
    ],
    "engineering": [
        ("Structural Engineer: \"The Schedule Digitiser\"",
         """<p><strong>What it does:</strong> It converts "dead" data (text inside a PDF drawing) into "live" data (Excel cells). It takes a list of beams or columns from a drawing and prepares it for calculation or ordering.</p>
         <p><strong>The Current Grind:</strong> An engineer needs to check the capacity of 50 columns or prepare a bill of materials. They look at the PDF schedule on the left screen and manually type member details (e.g., "310UC158") into a spreadsheet on the right screen, one by one.</p>
         <p><strong>Frequency:</strong> Project-Based (Bursts). This happens heavily at the start of a project, during major design revisions, and when preparing tender packages.</p>
         <p><strong>The Saving:</strong><br>Manual: 45–60 minutes per major schedule.<br>AI: 30 seconds.<br><strong>Value:</strong> The AI eliminates <strong>Transcription Error</strong>—a catastrophic risk in capacity checking or steel ordering. It guarantees data integrity for calculation or fabrication takeoff.</p>
         <p><strong>Note:</strong> This demo is tuned for the two structural schedules provided (`schedule_cad.pdf` and `schedule_revit.pdf`). Upload files with the same fields (Mark/Size/Qty/Length/Grade/PaintSystem/Comments), even if the layout is slightly different, so the extraction schema still applies.</p>""")
    ],
    "transmittal": [
        ("Structural Drafter: \"Automated Drawing Register\"",
         """<p><strong>Current Grind:</strong> Drafters spend hours opening drawing PDFs, manually recording drawing numbers, revisions, titles, scales, and approval dates into a transmittal register. For a 50-drawing package, this takes 30-45 minutes of repetitive clicking and typing across inconsistent title block layouts.</p>
         <p><strong>The Demo:</strong> Upload the five drawing PDFs supplied (S-001, S-100, S-101, S-102, S-500). The AI scans the title block and extracts Drawing Number, Revision, Drawing Title, and Scale from each, handling mixed title block layouts automatically.</p>
         <p><strong>Input Constraint:</strong> Files must contain the same metadata fields (Drawing Number, Revision, Title, Scale, Date, Status, Sheet Count, Project) even if the layout differs. The extraction schema normalizes across variations.</p>
         <p><strong>Outcome:</strong> A "Document Register" that your team can email or drop into Excel as a transmittal—ready for client distribution, RFI tracking, or compliance audits.</p>
         <p><strong>The Saving:</strong><br>Manual: 30-45 min per transmittal.<br>AI: 20 seconds.<br><strong>Value:</strong> Zero transcription errors (no mismatched rev letters, drawing numbers, or dates) + auditable extraction trail for compliance.</p>""")
    ]
}

ROUTINE_SUMMARY = {
    "finance": [
        ("Grind", "Admin opens email, saves the PDF, opens Xero, manually types Vendor, Date, Total, and checks for typos."),
        ("Frequency", "Daily; more realistic volume of <strong>70 documents</strong> per week for a 70-person firm (Vendor Invoices only)."),
        ("Saving", "Manual: 3 min/document × 70 docs = <strong>3.5 hours/week</strong>. AI: Near-instant."),
        ("Value", "Immediate efficiency frees up Office Manager time for strategic tasks (culture, billing), enabling a capacity reallocation upside of up to <strong>$1.44 M</strong> annually (Tier 4).")
    ],
    "engineering": [
        ("Grind", "Engineers read 50 column/beam entries, manually typing 310UC158 into Excel for each."),
        ("Frequency", "Project bursts—during project start and major revisions."),
        ("Saving", "Manual: 45–60 min per schedule. AI: 30 seconds."),
        ("Value", "Eliminates transcription errors (e.g., 310UB vs 310UC).")
    ],
    "transmittal": [
        ("Grind", "Drafters open 20–50 drawings, copying Drawing No/Rev/Title/Scale by hand."),
        ("Frequency", "Weekly to help compile client transmittals."),
        ("Saving", "Manual: hours of typing. AI: builds the register instantly."),
        ("Value", "Avoids Friday-afternoon typos and keeps registers accurate.")
    ]
}

ENGINEERING_PROMPT_LIMIT = 6000
ENGINEERING_PROMPT_LIMIT_SHORT = 3200
TRANSMITTAL_PROMPT_LIMIT = 3200

def prepare_prompt_text(text, doc_type, limit=None):
    cleaned = text.replace("\n", " ").strip()
    if doc_type == "engineering":
        limit = ENGINEERING_PROMPT_LIMIT_SHORT if limit is None else limit
        return cleaned[:limit]
    if doc_type == "transmittal":
        limit = TRANSMITTAL_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
    return cleaned

ALLOWED_SAMPLE_PATHS = {
    sample["path"]
    for group in DEPARTMENT_SAMPLES.values()
    for sample in group["samples"]
}

# Cache for available models
_available_models = None
FINANCE_FIELDS = ["Vendor", "Date", "InvoiceNum", "Cost", "GST", "FinalAmount", "Summary", "LineItems", "ShippingTerms", "HSCodes", "Currency", "ABN", "POReference", "PaymentTerms", "DueDate", "PortOfLoading", "PortOfDischarge", "VesselVoyage", "BillOfLading", "Flags"]
ENGINEERING_BEAM_FIELDS = ["Mark", "Size", "Qty", "Length", "Grade", "PaintSystem", "Comments"]
ENGINEERING_COLUMN_FIELDS = ["Mark", "SectionType", "Size", "Length", "Grade", "BasePlate", "CapPlate", "Finish", "Comments"]
TRANSMITTAL_FIELDS = ["DwgNo", "Rev", "Title", "Scale"]
DOC_FIELDS = {
    "finance": FINANCE_FIELDS,
    "engineering": ENGINEERING_BEAM_FIELDS,  # Default, will be overridden based on detected type
    "transmittal": TRANSMITTAL_FIELDS
}
ERROR_FIELD = {"finance": "Summary", "engineering": "Comments", "transmittal": "Title"}

def get_available_models():
    """Get list of available Gemini models"""
    global _available_models
    if _available_models is not None:
        return _available_models
    
    if not api_key:
        return []
    
    _available_models = []
    try:
        models = genai.list_models()
        models_list = list(models)  # Convert to list once
        print(f"Found {len(models_list)} total models")
        
        # Extract model names, removing 'models/' prefix
        for m in models_list:
            try:
                model_name = m.name
                if model_name.startswith('models/'):
                    model_name = model_name.replace('models/', '')
                
                # Check if model supports generateContent
                supported_methods = getattr(m, 'supported_generation_methods', [])
                if hasattr(supported_methods, '__iter__'):
                    methods = list(supported_methods)
                else:
                    methods = [str(supported_methods)] if supported_methods else []
                
                if 'generateContent' in methods or len(methods) == 0:
                    _available_models.append(model_name)
                    print(f"  - {model_name} (methods: {methods})")
            except Exception as e:
                print(f"Error processing model {m}: {e}")
                continue
        
        print(f"Available models for generateContent: {_available_models}")
        return _available_models if _available_models else None
    except Exception as e:
        print(f"Error listing models: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        # Return None to use fallback
        return None

def build_prompt(text, doc_type):
    """Build a prompt tailored to the selected department."""
    if doc_type == "engineering":
        return f"""
# UNIVERSAL EXTRACTION PROMPT - ENGINEERING DOCUMENTS

Your primary goal: Accurate extraction with explicit uncertainty flagging. Silent errors are worse than flagged unknowns.

## DOCUMENT CHARACTERISTICS

You will encounter:

- Mixed content: Typed text + handwritten annotations
- Table structure: Rows and columns with specific data types
- OCR challenges: Stains, smudges, low resolution (150-200 dpi), fold marks, fading
- Technical nomenclature: Domain-specific formats and codes
- Section headers: Category dividers (often ALL CAPS) that separate data groups
- Handwritten notes: Changes, deletions, site notes (often in brackets or margins)

## CORE PRINCIPLES - ALWAYS FOLLOW

**Principle 1: Accuracy Over Speed**
Extract correctly, not quickly. One wrong specification can cascade into major problems.

**Principle 2: Explicit Uncertainty Over Silent Errors**
Better to flag 10 items for review than miss 1 critical error.

**Principle 3: Preserve Technical Language**
Don't paraphrase specifications, standards, or technical terms. Extract exactly as written.

**Principle 4: Extract What Exists, Flag What Doesn't**
Never invent data to fill gaps. Mark missing/unclear data explicitly.

## UNIVERSAL EXTRACTION STRATEGY

### PASS 1: Structure Analysis

1. Identify table structure (rows, columns, headers)
2. Detect section headers (category dividers)
3. Map grid layout (which cells belong to which columns)
4. Identify handwritten vs typed content
5. Note damaged areas (stains, tears, fading)
6. Flag any structural anomalies

### PASS 2: Data Extraction with Validation

For each cell:

**Step A: Extract Raw Content**
- Read the cell content as-is
- Don't clean up or normalize yet

**Step B: Apply Format Validation**
- Check against expected format for that column type
- Validate data type (number, text, code, etc.)
- Cross-check against known valid values if applicable

**Step C: Cross-Field Validation**
- Check if value makes sense given other fields in same row
- Verify consistency with section context
- Flag anomalies (e.g., quantity seems wrong for item type)

### PASS 3: Complex Fields - Special Handling

For narrative/comment fields (highest failure rate):

**Step 1: Extract All Readable Portions FIRST**

CRITICAL RULE - Partial Extraction Before Marking Illegible:

BEFORE marking anything as [illegible]:

**STEP 1: ATTEMPT PARTIAL EXTRACTION**
- Read what IS clear first
- Extract all readable portions
- Only mark SPECIFIC unclear parts

**STEP 2: FORMAT PARTIAL EXTRACTIONS**
✓ Good: "Install per specification ABC-123 [remainder obscured by stain]"
✗ Bad: "[Comment illegible - manual transcription required]"

✓ Good: "Verify dimensions on site. [handwritten: 'APPROVED - JMc 5/12']"
✗ Bad: "[Comment illegible - manual review required]"

**STEP 3: USE [illegible] ONLY FOR TRULY UNREADABLE TEXT**
- If ANY words are readable → extract them
- Use specific markers:
  - [word illegible]
  - [coffee stain obscures text]
  - [smudged]
  - [faded text - partially readable]
  - [remainder obscured]
- Reserve [Comment illegible - manual review required] for when NOTHING can be read

**EXAMPLES:**

Scenario: "Install with [smudge] gasket material"
✓ Extract: "Install with [smudged word] gasket material"
✗ Don't: "[Comment illegible]"

Scenario: Stain covers last 3 words
✓ Extract: "Check actual dimensions before fabrication [coffee stain obscures remainder]"
✗ Don't: "[coffee stain obscures remainder]" as entire comment

Scenario: Handwritten note is clear
✓ Extract: "Original specification. [handwritten: 'CHANGED TO TYPE B - PMG']"
✗ Don't: "[Comment illegible - manual review required]"

**VALIDATION:**
If you marked something [illegible], ask yourself:
- Can I read ANY words? → Then extract them + mark specific gap
- Is the entire field truly unreadable? → Then use full illegible marker

**Step 2: Read as Phrases, Not Characters**

CHARACTER SOUP DETECTION:

If your extraction looks like: "H o l d 4 O m m g r o u t u n d e r..."
→ STOP - This is character-level OCR failure
→ Re-attempt reading as connected words
→ Try reading at higher magnification
→ Use context from field type and adjacent data

If still garbled after retry:
→ Mark: "[Field illegible - OCR failed]"
→ Do NOT output character soup

UNACCEPTABLE OUTPUTS:
❌ "H o l d 4 O m g r o u t"
❌ "W p e e b r b A e S a 1"
❌ "o x n i s s t i i t n e g"

If your output looks like these → You failed. Try again or mark as illegible.

**Step 3: Extract Complete Multi-Part Content**

MULTI-SENTENCE/MULTI-PART EXTRACTION:

Many complex fields contain multiple pieces of information:
- Instruction + specification reference
- Status + action required
- Description + drawing/detail reference
- Multiple specifications separated by periods

EXTRACTION PROTOCOL:

**Step 1: Scan entire field area**
- Don't stop after first sentence/element
- Look for: periods, semicolons, line breaks
- Check for reference codes (standards, drawing numbers)

**Step 2: Extract all components**
Common patterns:
- "[Primary info]. [Secondary info]"
- "[Description]. [Reference]"
- "[Specification A]; [Specification B]"

**Step 3: Preserve structure**
- Keep sentences together
- Maintain separation (periods, semicolons)
- Don't merge distinct specifications

**Step 4: OUTPUT COMPLETENESS CHECK - CRITICAL**

Before finalizing each field:

**TRUNCATION DETECTION:**
- Check if output appears cut off (ends mid-word)
- Check if sentence ends abruptly without punctuation
- Check if field seems incomplete
- Look for partial words like "(coffee sta" or "at bas"

**If truncated:**
- Complete the field if possible
- Or mark as [truncated] or [remainder unclear]
- NEVER leave partial words like "(coffee sta"
- Use proper markers: "[coffee stain obscures text]" or "[remainder unclear]"

**VALIDATION:**
- If field ends mid-word → Mark as incomplete
- If field seems short for important item → Check for continuation
- If unclear portion → Use marker: "[coffee stain obscures text]" not "(coffee sta"

EXAMPLES:

Wrong: "Install anchor bolts"
Right: "Install anchor bolts. Torque to 150 ft-lbs per spec XYZ-789"

Wrong: "Main support element"
Right: "Main support element. Fly brace @ 1500 centres. See detail D-12"

Wrong: "(coffee sta"
Right: "[coffee stain obscures text]" or "Paint System A required [coffee stain obscures remainder]"

Wrong: "Corrosion noted st moore"
Right: "Corrosion noted at base" ⚠️ Corrected 'st moore' to 'at base' (OCR error)

VALIDATION:
If field seems short for an important/complex item:
→ Check for text after periods
→ Look for references to standards/drawings
→ Verify you captured complete information
→ Check for mid-word truncation

**Step 4: Handle Handwritten Annotations**

HANDWRITTEN CONTENT PROTOCOL - ENHANCED:

Handwritten notes are critical - often indicate changes or approvals.

FORMAT:
- Mark clearly: [handwritten: "exact text"]
- Include context clues if visible:
  - [handwritten in red: "..."]
  - [handwritten in margin: "..."]
  - [handwritten signature: "..."]

PLACEMENT:
- Keep WITH the row/field they modify
- Don't separate into different column

LEGIBILITY - ENHANCED PROTOCOL:

When handwritten text is unclear, use this multi-step approach:

**Step 1: USE CONTEXT CLUES**
- What type of change makes sense?
- Cross-reference with typed content (e.g., current beam size)
- Look for pattern in similar annotations
- Common patterns: "CHANGED TO [specification]", "DELETED - NOT REQ'D", "APPROVED - [initials]"

**Step 2: CHARACTER-BY-CHARACTER ANALYSIS**
For unclear characters:
- Compare to same character elsewhere in document
- Use technical context (beam sizes follow patterns like "310UC137", not random numbers)
- Flag if multiple interpretations possible

**Step 3: EXTRACTION WITH UNCERTAINTY**
If partially legible after context analysis:
- Extract best interpretation based on context
- Flag: ⚠️ Handwritten text partially unclear - interpretation based on context
- Example: [handwritten: 'CHANGED TO 310UC137 - PMG'] ⚠️ Partially unclear, "310UC137" inferred from context

**Step 4: HANDWRITTEN CONTEXT VALIDATION - CONSERVATIVE APPROACH**

**CRITICAL RULE: Better to mark as uncertain than extract wrong information**

**COMMON PATTERNS IN ENGINEERING CHANGES:**

Valid patterns (make technical sense):
- "CHANGED TO [new specification]" ✓ Common
- "MODIFIED TO [new specification]" ✓ Common
- "REVISED TO [new specification]" ✓ Common
- "UPDATED TO [new specification]" ✓ Common
- "APPROVED - [initials] [date]" ✓ Common
- "DELETED - NOT REQ'D" ✓ Common

Invalid patterns (make no technical sense):
- "CORRODED TO [specification]" ✗ Makes no sense
- "DAMAGED TO [specification]" ✗ Makes no sense
- "BROKEN TO [specification]" ✗ Makes no sense
- "CHEVROLET YO [specification]" ✗ Makes no sense
- Any nonsensical phrase ✗

**CONSERVATIVE VALIDATION PROTOCOL:**

When handwritten text is unclear:

**STEP 1: Extract what OCR provides**
- Get raw OCR text first
- Don't modify yet

**STEP 2: Check if it makes technical sense**
- Does the phrase make sense in engineering context?
- Do the words form a logical instruction?
- → YES: Accept it (even if slightly unclear)
- → NO: Go to Step 3

**STEP 3: Try common patterns (only if confident >95%)**
- Match against known patterns: "CHANGED TO [spec]", "DELETED - NOT REQ'D", etc.
- Check if verb makes technical sense:
  - "Changed to", "Modified to", "Revised to" → Yes ✓
  - "Corroded to", "Damaged to", "Broken to", "Chevrolet" → No ✗
- If pattern matches AND confident (>95%):
  - Apply correction
  - Flag: ⚠️ Corrected '[original]' to '[corrected]' (handwriting interpretation)

**STEP 4: If still nonsensical or uncertain:**
- **DO NOT force a correction**
- **DO NOT "correct" to another nonsensical phrase**
- Mark: [handwritten annotation unclear - appears to say "[OCR text]"]
- Flag: 🚫 CRITICAL: Handwritten text unclear - manual verification required
- Better to mark as uncertain than extract wrong information

**EXAMPLES:**

**Example 1: Clear enough to correct**
OCR: "CORRODED TO 310UC137 - PMG"
Analysis:
- "CORRODED TO" makes no technical sense
- Common pattern: "CHANGED TO [beam size]"
- Confident: >95% (single character confusion)
- Correction: "CHANGED TO 310UC137 - PMG"
- Flag: ⚠️ Corrected 'CORRODED TO' to 'CHANGED TO' (handwriting interpretation)

**Example 2: Too unclear - mark as uncertain**
OCR: "CHEVROLET YO 376UC137 - PMG"
Analysis:
- "CHEVROLET YO" makes no technical sense
- Common pattern match? Likely "CHANGED TO 3?0UC137" but multiple uncertainties
- Confident: <70% (too many character uncertainties)
- Action: [handwritten annotation unclear - appears to reference beam size change]
- Flag: 🚫 CRITICAL: Handwritten annotation illegible - manual verification required
- **DO NOT attempt correction - too uncertain**

**Example 3: Partially clear**
OCR: "CHANGED TO 3?0UC137 - PMG" (one unclear digit)
Analysis:
- Pattern matches "CHANGED TO [beam size]"
- One digit uncertain (could be 310UC137 or 360UC137)
- Action: [handwritten: 'CHANGED TO 310UC137 - PMG'] ⚠️ Digit partially unclear, inferred from context
- Flag: ⚠️ Handwritten text partially unclear - "310UC137" interpretation based on context

**NEVER:**
- "Correct" handwriting to another nonsensical phrase
- Apply corrections when confidence <90%
- Force interpretations when multiple characters are uncertain

If truly illegible after analysis:
- [handwritten annotation present but illegible - appears to reference [type of change]]
- Don't mark entire row as illegible

EXAMPLES:
✓ "Original size 250mm. [handwritten: 'CHANGED TO 300mm - approval JD 5/12/19']"
✓ "310UC158 [handwritten: 'CHANGED TO 310UC137 - PMG'] ⚠️ Handwriting partially unclear, size inferred from context"
✓ "310UC158 [handwritten: 'CHANGED TO 310UC137 - PMG'] ⚠️ Corrected 'CORRODED TO' to 'CHANGED TO' (handwriting interpretation)"
✓ "Pending approval [handwritten signature - illegible]"
✓ "[handwritten in red pen: 'DELETED - NOT REQ'D']"

## STRIKETHROUGH TEXT HANDLING - CRITICAL

STRIKETHROUGH TEXT EXTRACTION:

Visual strikethrough lines (red or black) can interfere with OCR but text is still readable.

**CRITICAL RULE: Strikethrough ≠ Illegible**

PROTOCOL FOR STRIKETHROUGH ROWS:

**Step 1: DETECT strikethrough**
- Row has line through it (red, black, or other color)
- Often accompanies deletion notes
- Text underneath is usually still legible

**Step 2: EXTRACT UNDERLYING TEXT**
- Read the text UNDER the line
- Ignore the strikethrough visual
- Extract data normally (Mark, Size, Qty, Length, Grade, etc.)

**Step 3: MARK AS DELETED**
- Add to comments: "[row deleted - strikethrough]"
- If handwritten deletion note exists: "[row deleted - strikethrough] [handwritten: 'DELETED - NOT REQ'D']"
- Keep extraction for reference
- Cross-reference with deletion notes

**Step 4: NEVER mark as [illegible]**
- Strikethrough ≠ illegible
- Text is readable, just marked for deletion
- Extract the data + note deletion status

EXAMPLE:

NB-03 row has red strikethrough:

❌ WRONG: Mark all fields [illegible]

✓ RIGHT:
  Mark: NB-03
  Size: 310UC97
  Qty: 6
  Length: 4500 mm
  Grade: 300PLUS
  Comments: "[row deleted - red strikethrough] [handwritten: 'DELETED - NOT REQ'D']"

VALIDATION CHECK:

If entire row is [illegible] but you can see ANY text:
→ STOP - re-attempt extraction
→ Look for strikethrough line interfering
→ Read text underneath the line
→ Extract data + note deletion status

## TEXT QUALITY ASSESSMENT BEFORE MARKING ILLEGIBLE

Before marking [illegible], assess WHY text is unclear:

**Type 1: STRIKETHROUGH / MARKUP**
- Text readable but has lines through it
- Action: Extract text + note markup (see Strikethrough Handling above)

**Type 2: STAIN / DAMAGE**
- Physical obstruction (coffee, water, etc.)
- Action: Extract visible portions + note obstruction

**Type 3: FADED / LOW CONTRAST**
- Text light but letters discernible
- Action: Extract with low confidence flag

**Type 4: TRULY ILLEGIBLE**
- Smudged beyond recognition
- Torn/missing paper
- Complete OCR failure with no pattern
- Action: Mark [illegible]

DECISION TREE:

Can you see letter shapes?
→ YES: Attempt extraction (even if uncertain)
→ NO: Check if strikethrough/markup
  → YES: Look underneath, extract + note deletion
  → NO: Mark [illegible]

## COLUMN BOUNDARY AWARENESS

CRITICAL RULE - Issues Stay in Their Columns:

COLUMN ISOLATION PROTOCOL:

When encountering issues (stains, damage, illegibility):
→ Identify WHICH COLUMN contains the issue
→ Note the issue ONLY in that column
→ Don't let issues leak into adjacent columns

WRONG BEHAVIOR EXAMPLE:
Column A (actual): Empty/N/A
Column B (actual): "Check specifications [coffee stain]"
WRONG: Column A = "[coffee stain obscures text]"

CORRECT BEHAVIOR:
Column A: N/A (column is empty)
Column B: "Check specifications [coffee stain obscures remainder]"

VISUAL CHECK:
Before finalizing a row:
1. Which column has the stain/damage?
2. Is my note in the SAME column as the issue?
3. Have I left other columns as-is?

NEVER:
- Move damage notes to wrong columns
- Apply one column's issues to adjacent columns
- Assume empty column has same issue as neighbor

## CELL STATE INTERPRETATION

EMPTY vs N/A vs DASH vs EXPLICIT TEXT:

Different cell states have different meanings. Check document conventions first.

**Type 1: EXPLICIT TEXT**
- Cell contains written value: "Not specified", "TBD", "See notes"
- Extract: Exactly as written

**Type 2: EMPTY/BLANK CELL**
- Cell is white space, completely empty
- Extract: N/A (or document's convention)
- Check: Does document have a legend defining empty cells?

**Type 3: DASH OR HYPHEN**
- Cell contains: "—" or "-" or "–"
- Common meanings:
  - Engineering docs: Usually "not applicable"
  - Financial docs: Often "zero" or "TBD"
  - Medical docs: May mean "normal" or "not tested"
- Action: Check document context or legend
- Default: Convert to N/A unless legend specifies otherwise

**Type 4: SPECIAL SYMBOLS**
- *, †, ‡, (a), (b): Usually reference notes/footnotes
- Extract: The symbol + look for footnote explanation

VALIDATION:
If you extract "—" or "-" as a literal value:
→ STOP and reconsider
→ Check if document defines what dashes mean
→ Usually convert to "N/A" unless certain it means something else

CONSISTENCY CHECK:
If some rows have "N/A" and others have "—" in same column:
→ Likely they mean the same thing
→ Normalize to one format (prefer N/A)

## ACTIVE ERROR CORRECTION

FIX WHAT YOU CAN CONFIDENTLY IDENTIFY:

When you detect an error, decide your confidence level:

**HIGH CONFIDENCE (90%+) → FIX IT**
Examples:
- OCR character confusion you can verify (7→1, 3→8, O→0)
- Format errors with clear patterns (spaces in numbers)
- Column misalignment you can verify
- Dash → N/A conversion
- Obvious typos in standard terms

Actions:
1. Make the correction
2. Flag it: "⚠️ Corrected from X to Y based on [reason]"
3. Show original OCR in notes for transparency

**MEDIUM CONFIDENCE (60-89%) → FIX WITH STRONG FLAG**
Examples:
- Quantity seems wrong based on item context
- Format unusual but could be correct
- Abbreviation unclear

Actions:
1. Make best-guess correction
2. Flag: "🔍 Corrected from X to Y - VERIFY THIS"
3. Explain reasoning

**LOW CONFIDENCE (<60%) → FLAG, DON'T FIX**
Examples:
- True ambiguity in handwriting
- Completely unclear OCR
- Multiple possible interpretations

Actions:
1. Extract what you see
2. Flag: "🚫 CRITICAL: Value uncertain - MANUAL VERIFICATION REQUIRED"
3. Explain the issue and possible interpretations

WHEN TO CORRECT:
✓ Number confusion if you can see actual digit
✓ Format errors with clear correct pattern
✓ Column misalignment with clear evidence
✓ Standard term with obvious misspelling
✓ Missing unit when context is clear

WHEN NOT TO CORRECT:
✗ True ambiguity you can't resolve
✗ Handwriting too unclear to read
✗ Missing data (never invent)
✗ Unfamiliar terminology (might be correct)

## SECTION-AWARE VALIDATION

USE DOCUMENT STRUCTURE FOR VALIDATION:

Many engineering documents divide data into categorical sections.

**STEP 1: IDENTIFY SECTIONS**
Common section types:
- Status-based: Existing/New/Modified, Original/Replacement
- Category-based: Primary/Secondary/Backup, Type A/B/C
- Location-based: Building 1/2/3, Floor 1/2/3
- Phase-based: Phase 1/2/3, Stage A/B/C

Visual markers:
- ALL CAPS headers
- Bold/underlined text
- Horizontal lines/separators
- Different background shading

**STEP 2: UNDERSTAND SECTION EXPECTATIONS**
For each section type, certain values are more/less expected:

Example - Construction:
- "Existing" section → Minimal new specifications
- "New" section → Complete specifications required
- "Modified" section → Mix of existing + new details

**STEP 3: VALIDATE AGAINST SECTION CONTEXT**
If extraction seems inconsistent with section:
→ Double-check the value
→ Verify you're reading correct section
→ Flag if anomaly confirmed

EXAMPLES:

Item in "EXISTING" section with extensive new specifications:
→ Flag: "⚠️ Item in existing section but has new specs - verify correct section"

Item in "NEW" section missing key specifications:
→ Flag: "🔍 New item missing expected specifications - verify complete"

## ERROR FLAGGING SYSTEM

Use three-tier flagging:

**⚠️ WARNING (Likely correct but verify)**
Use when: Minor uncertainty, probably correct but worth double-checking

Examples:
- "Value appears unusual - please verify"
- "Format slightly non-standard - check if correct"
- "Corrected from X to Y (OCR confusion)"

Format:
⚠️ [Specific issue]: [Explanation]

**🔍 REVIEW REQUIRED (Uncertain extraction)**
Use when: Moderate uncertainty, could go either way

Examples:
- "Format unclear - manual verification recommended"
- "Handwritten annotation partially illegible"
- "Value seems inconsistent with context - verify"

Format:
🔍 [What's uncertain]: [Why uncertain] - [Suggested action]

**🚫 CRITICAL ERROR (Must fix before use)**
Use when: High certainty something is wrong, or critical field is unclear

Examples:
- "Field illegible - OCR failed completely"
- "Format invalid - MANUAL VERIFICATION REQUIRED before use"
- "Column alignment corrupted - values may be wrong"

Format:
🚫 CRITICAL: [Issue] - [Impact] - MANUAL VERIFICATION REQUIRED

For Every Flag Provide:
- What you extracted
- Why it's flagged (specific reason)
- What the correct value might be (if you have suggestion)
- Impact if error not caught (for critical flags)

## QUALITY VALIDATION CHECKLIST

BEFORE SUBMITTING EXTRACTION, VERIFY:

**✓ Completeness Checks**
□ All readable text extracted? (Used partial extraction before marking illegible)
□ Multi-part fields complete? (Checked for continuation after periods)
□ Handwritten annotations captured? (In [brackets] with original)
□ All columns filled? (Empty cells properly marked as N/A or —)

**✓ Accuracy Checks**
□ Format validation passed? (Data matches expected patterns)
□ Cross-field validation done? (Values consistent within row)
□ Section context checked? (Values appropriate for section)
□ Column boundaries respected? (Issues in correct columns)

**✓ Error Handling Checks**
□ Confident corrections applied? (Fixed obvious OCR errors)
□ Uncertainties flagged? (All doubts explicitly marked)
□ No character soup? (No "H o l d 4 O..." output)
□ No invented data? (Only extracted what exists)

**✓ Flag Quality Checks**
□ Each flag has specific reason? (Not generic "check this")
□ Critical issues marked 🚫? (Safety/compliance impacts)
□ Corrections explained? (Showed original + fixed value)
□ Suggested fixes provided? (When confident about correction)

**✓ Consistency Checks**
□ All "Corrected X to Y" flags have corresponding corrected text?
□ Text matches flags? (No flag/text mismatches)
□ Handwriting corrections only applied if confident >95%?
□ Uncertain handwriting marked as unclear (not forced corrections)?
□ No mid-word truncation? (Fields complete, not cut off)
□ All corrections actually applied to text (not just flagged)?

## IMAGE PROCESSING - CRITICAL FOR JPEG/PNG FILES

When processing image files (JPEG, PNG, etc.) instead of PDFs:

**CRITICAL DIFFERENCES:**

1. **Table Structure Detection**
   - Images require visual table recognition
   - Look for column headers visually
   - Identify row boundaries by visual lines/spacing
   - Map each cell to its column header

2. **Size Column - HIGHEST PRIORITY**
   - The Size column is THE MOST CRITICAL field
   - NEVER extract Size as "N/A" unless cell is truly empty
   - Size column typically contains: "310UC158", "250UB37.2", "WB1220×6.0", "250PFC"
   - If you see ANY text in the Size column area, extract it
   - Common patterns to look for:
     - UC/UB sections: Numbers + "UC" or "UB" + numbers
     - Welded beams: "WB" + numbers + "×" + numbers
     - PFC sections: Numbers + "PFC"

3. **Visual Column Mapping**
   - Identify columns by their HEADER labels (Mark, Size, Qty, Length, Grade, Paint System, Comments)
   - Map each cell to the correct column based on vertical alignment
   - Don't confuse columns - Size is separate from Mark, Qty, etc.

4. **Multi-line Cell Handling**
   - Some cells may span multiple lines visually
   - Read ALL lines in a cell before moving to next cell
   - Example: "250 UB / 37.2" should become "250UB37.2"

5. **Length Units**
   - Length column should include units: "5400 mm" not just "5400"
   - If units are missing, add " mm" based on context

**VALIDATION FOR IMAGES:**

Before finalizing extraction, verify:
- [ ] Size column has actual values (not all "N/A")
- [ ] Length includes units ("mm" or "m")
- [ ] Mark values match visible text (check for OCR errors like "NB-OI" → "NB-01")
- [ ] Comments column checked (may contain important notes)

**IF SIZE COLUMN IS ALL "N/A":**
→ This is a CRITICAL ERROR
→ Re-examine the image for Size column
→ Look for beam size patterns in the table
→ Size column is usually 2nd or 3rd column after Mark

## IMAGE PROCESSING - CRITICAL FOR JPEG/PNG FILES

When processing image files (JPEG, PNG, etc.) instead of PDFs:

**CRITICAL DIFFERENCES:**

1. **Table Structure Detection**
   - Images require visual table recognition
   - Look for column headers visually (Mark, Size, Qty, Length, Grade, Paint System, Comments)
   - Identify row boundaries by visual lines/spacing
   - Map each cell to its column header based on vertical alignment

2. **Size Column - HIGHEST PRIORITY**
   - The Size column is THE MOST CRITICAL field for engineering use
   - NEVER extract Size as "N/A" unless cell is truly empty (white space)
   - Size column typically contains: "310UC158", "250UB37.2", "WB1220×6.0", "250PFC"
   - If you see ANY text in the Size column area, extract it
   - Common patterns to look for:
     - UC/UB sections: Numbers + "UC" or "UB" + numbers (e.g., "310UC158", "250UB37.2")
     - Welded beams: "WB" + numbers + "×" + numbers (e.g., "WB1220×6.0")
     - PFC sections: Numbers + "PFC" (e.g., "250PFC")
   - Size column is usually 2nd or 3rd column after Mark
   - If Size appears empty, look more carefully - it may be split across lines or have formatting

3. **Visual Column Mapping**
   - Identify columns by their HEADER labels at the top
   - Map each cell to the correct column based on vertical alignment
   - Don't confuse columns - Size is separate from Mark, Qty, Length, etc.
   - Each row should have data in multiple columns

4. **Multi-line Cell Handling**
   - Some cells may span multiple lines visually
   - Read ALL lines in a cell before moving to next cell
   - Example: "250 UB / 37.2" should become "250UB37.2" (consolidate)

5. **Length Units**
   - Length column should include units: "5400 mm" not just "5400"
   - If units are missing in the image, add " mm" based on engineering context

6. **Mark Column OCR Errors**
   - Watch for: "NB-OI" → should be "NB-01" (0→O, 1→I confusion)
   - Verify mark values match visible text

**VALIDATION FOR IMAGES:**

Before finalizing extraction, verify:
- [ ] Size column has actual values (not all "N/A")
- [ ] Length includes units ("mm" or "m")
- [ ] Mark values match visible text (check for OCR errors)
- [ ] Comments column checked (may contain important notes)

**IF SIZE COLUMN IS ALL "N/A":**
→ This is a CRITICAL ERROR
→ Re-examine the image for Size column
→ Look for beam size patterns in the table
→ Size column is usually 2nd or 3rd column after Mark
→ Check if sizes are split across multiple lines
→ Verify you're reading the correct column

**IMAGE-SPECIFIC EXTRACTION PROTOCOL:**

1. First, identify all column headers visually
2. For each row, read across horizontally:
   - Mark (first column)
   - Size (CRITICAL - usually 2nd column)
   - Qty (quantity)
   - Length (with units)
   - Grade
   - Paint System
   - Comments
3. If Size appears empty, look more carefully:
   - Check if text is split across lines
   - Check if formatting makes it hard to see
   - Check adjacent columns - Size might be misaligned

## DOMAIN-SPECIFIC CUSTOMIZATION - ENGINEERING DOCUMENTS

### Format Validation Rules

**BEAM SCHEDULE FORMATS:**

**Mark Column:**
- Pattern: [B/NB]-[01-99] or [B/NB][01-99]
- Examples: "B1", "NB-02", "B3", "NB-01"
- Flag if: Doesn't match pattern, or unusual format

**Size Column:**
- UC/UB Universal Sections: [size][type][weight]
  - Format: [number][UC/UB][number or number.number]
  - Examples: "310UC137", "250UB37.2", "460UB82.1", "200UC46.2"
  - Invalid: "310UC15" (too short), "250UB77.2" (check 7→3 OCR error)
  
- Welded Beams (WB): WB[depth]×[thickness]
  - Format: WB[number]×[number.number]
  - Examples: "WB1220×6.0", "WB610×8.0"
  - Invalid: "WB 610 x 27" (spaces), "WB 612.2" (missing ×), "WB1220x6.0" (lowercase x)
  
- PFC Sections: [size]PFC
  - Format: [number]PFC
  - Examples: "250PFC", "200PFC"

**Quantity Column:**
- Must be integer between 1-20
- Typical range: 1-10 for most beams
- Flag if: Not a number, >20, or 0

**Length Column:**
- Format: [number] mm or [number]m
- Typical range: 1000-10000mm (1-10m)
- Must include units
- Flag if: Missing units, unrealistic values

**Grade Column:**
- Known values: 300, 300PLUS, C300, HA350, AS1594, G300, "Not marked", "N/A", "-"
- Flag if: Decimal number (likely misaligned from Size), unusual format

**Paint System Column:**
- Known values: "P1 (2 coats)", "HD Galv", "Paint System A", "N/A", "-"
- Flag if: Unusual format

**Comments Column:**
- Free text field - preserve exactly as shown
- May contain: Installation instructions, specifications, references, handwritten notes
- Flag if: Character soup detected, completely illegible

**COLUMN SCHEDULE FORMATS:**

**Mark Column:**
- Pattern: [C/COL]-[01-99] or similar
- Examples: "C1", "COL-02"

**Section Type Column:**
- Values: "UC", "UB", "PFC", "WB", or similar
- Standard structural section types

**Size Column:**
- Format: [number] [type] [number] or [number][type][number]
- Examples: "310 UC 158", "310UC158"

**Base Plate / Cap Plate Columns:**
- Specifications or "N/A"
- May include dimensions, material, thickness

**Finish Column:**
- Values: "HD Galv", "Paint System A", "N/A", or similar

### Field-Specific Validation Logic

**CONDITIONAL RULES:**

- If Size contains "WB" → Must have format WB[number]×[number.number]
- If Size contains "UC" or "UB" → Must have format [number][type][number or number.number]
- If Grade is a decimal number (e.g., "37.2") → Likely misaligned from Size column
- If Qty = 1 and Size is large beam (e.g., 460UB+) → Flag for verification (large beams rarely solo)
- If Comments contains "[handwritten:" → Preserve exactly, don't attempt to clean up
- If section header is "EXISTING" → Comments may reference existing conditions
- If section header is "NEW" → Complete specifications expected

### Known Value Lists

**GRADE VALUES:**
- 300
- 300PLUS
- C300
- HA350
- AS1594
- G300
- Not marked
- N/A
- - (dash)

**PAINT SYSTEM VALUES:**
- P1 (2 coats)
- HD Galv
- Paint System A
- N/A
- - (dash)

**SECTION TYPES (Column Schedules):**
- UC (Universal Column)
- UB (Universal Beam)
- PFC (Parallel Flange Channel)
- WB (Welded Beam)

### Common OCR Errors in Engineering Documents

| Actual | Often Misread As | Context Clue |
|--------|------------------|--------------|
| 3 | 8 | Beam sizes: 310UC not 810UC |
| 7 | 1 or I | 250UB37.2 not 250UB11.2 |
| O (letter) | 0 (zero) | "COLOUR" not "C0L0UR" |
| × (multiply) | x (letter) | WB1220×6.0 not WB1220x6.0 |
| 1220 | 12 20 or 122 0 | Spaces inserted in numbers |
| 2 (quantity) | 1 | Major beams rarely solo |
| HA350 | JSO, JS0, J50 | Grade column context |
| 37.2 | 77.2 | Size weight - check for 7→3 error |
| 0 (zero) | D (letter) | "40mm" not "4Dmm" - measurements context |
| 0 (zero) | O (letter) | Numbers vs letters in measurements |

### Number OCR Validation - CRITICAL

NUMBER EXTRACTION VALIDATION:

Common OCR errors in numbers and measurements:
- 0 (zero) ↔ O (letter O) ↔ D (letter D)
- 1 (one) ↔ I (letter I) ↔ l (lowercase L)
- 5 (five) ↔ S (letter S)
- 8 (eight) ↔ B (letter B)

VALIDATION FOR MEASUREMENTS:

**Pattern Detection:**
- "4Dmm" → Check context
  - Grout dimensions typically: 10mm, 20mm, 30mm, 40mm, 50mm
  - "4Dmm" unlikely (D not a digit)
  - Correct to: "40mm"
  - Flag: ⚠️ Corrected '4Dmm' to '40mm' (OCR D→0)

**Word Context Validation:**
- "grows" → Check context
  - Near "40mm under base plate"
  - Structural term: "grout" (fills gaps)
  - "grows" makes no technical sense
  - Correct to: "grout"
  - Flag: ⚠️ Corrected 'grows' to 'grout' (OCR error)

**PROTOCOL:**
1. Extract raw OCR text
2. Check if makes technical sense in context
3. If nonsensical → look for OCR character confusion
4. Apply correction based on context and known patterns
5. Flag the correction with explanation

**EXAMPLES:**
- "4Dmm grout" → "40mm grout" ⚠️ Corrected D→0
- "grows under base" → "grout under base" ⚠️ Corrected OCR error
- "calvanited" → "galvanised" (if context suggests galvanizing)

### Domain-Specific Word Validation - CRITICAL

CONSTRUCTION/ENGINEERING TERM VALIDATION:

Construction/Engineering terms often get OCR errors. Validate against known vocabulary.

**COATING/FINISH TERMS:**

Common OCR errors:
- "calvanited" → "galvanised" ✓
- "galvinized" → "galvanised" ✓
- "galvanized" → "galvanised" (US spelling, but use Australian "galvanised")
- "stell" → "steel" ✓
- "concreat" → "concrete" ✓
- "paint" → common term ✓

**MATERIAL/SUBSTANCE TERMS:**

- "grows" near "plate/base" → likely "grout" ✓
- "epoy" → "epoxy" ✓
- "resin" → common term ✓
- "mortor" → "mortar" ✓
- "compund" → "compound" ✓
- "cement" → common term ✓

**INSTALLATION TERMS:**

- "torqe" → "torque" ✓
- "weld" → common term ✓
- "brase" → "brace" ✓
- "supplies" → "supplier" (in context of "verify with supplier")
- "instal" → "install" ✓
- "ancho" → "anchor" ✓

**VALIDATION PROTOCOL:**

1. Extract text as-is from OCR
2. Check if term exists in technical dictionary/known terms
3. If not found, look for close matches:
   - Edit distance < 3 characters
   - Phonetically similar
   - Common OCR character substitutions (r→n, i→l, etc.)
4. Check context:
   - "[number]mm [substance] under base" → expect: grout, mortar, compound, epoxy
   - "Hot dip [coating]" → expect: galvanised, painted, coated
   - "verify with [entity]" → expect: supplier, engineer, site
5. If high-confidence match found (>90% similar + contextually correct):
   - **APPLY THE CORRECTION TO THE EXTRACTED TEXT** (see Correction Application Protocol below)
   - Flag: ⚠️ Corrected '[original]' to '[corrected]' (OCR error)

**CORRECTION APPLICATION PROTOCOL - CRITICAL:**

**MANDATORY SYNCHRONIZATION: Flags and Text MUST Match**

When you identify a correction:

**STEP 1: Decide if you will apply it**
- High confidence (>90%): APPLY IT to text
- Medium confidence (70-90%): APPLY IT to text with strong flag
- Low confidence (<70%): DON'T apply, flag as uncertain instead

**STEP 2: Apply correction to text FIRST**
- Write the CORRECTED version in the extracted text
- NOT the original OCR error
- Replace the incorrect term with the corrected version
- The extracted text MUST show the corrected version

**STEP 3: Document in flag (only if correction was applied)**
- Flag: ⚠️ Corrected '[original OCR]' to '[corrected]' ([reason])
- This provides transparency, verification path, and confidence indicator
- **NEVER create a "Corrected X to Y" flag if text still shows X**

**STEP 4: Show original in flag for transparency**
- The flag preserves the original OCR text for reference
- Engineer can verify if correction was appropriate

**IF YOU CANNOT APPLY THE CORRECTION:**
- Don't create a flag saying you did
- Instead: Flag as uncertain
- Example: "⚠️ Handwritten text unclear - appears to say 'CORRODED TO' but likely means 'CHANGED TO' - verify"
- Text shows: [handwritten annotation unclear - appears to reference beam size change]

**FORMAT:**

✓ CORRECT:
Text: "Main support beam. Fly brace @ 1500 centres."
Flag: "⚠️ Corrected 'brase' to 'brace' (OCR error)"

✗ WRONG (Missing Flag):
Text: "Main support beam. Fly brace @ 1500 centres."
Flag: [none]
[Correction applied but no transparency - engineer can't verify]

✗ WRONG (Flag but No Correction):
Text: "Main support beam. Fly brase @ 1500 centres."
Flag: "⚠️ Corrected 'brase' to 'brace' (OCR error)"
[Text still shows error even though flag says corrected]

**CONSISTENCY RULE:**

If flag says "Corrected X to Y" → Text MUST show Y, not X
If text shows corrected version → Flag MUST explain what was changed

**TRANSPARENCY REQUIREMENT:**

Every correction MUST have a corresponding flag. This is mandatory for:
- Engineer verification
- Audit trail
- Confidence assessment
- Trust building

**CORRECTION FLAG vs TEXT CONSISTENCY CHECK - CRITICAL:**

**MANDATORY VALIDATION BEFORE OUTPUT:**

Before finalizing each row, check:

1. Review all flags that say "Corrected X to Y"
2. Verify text actually shows Y, not X
3. If mismatch found:
   - **MANDATORY: FIX THE TEXT** to match the flag (apply the correction)
   - The text MUST show the corrected version
   - DO NOT leave text showing X when flag says Y
   - DO NOT remove the flag - fix the text instead
4. Ensure every "Corrected X to Y" flag has corresponding corrected text

**SYNCHRONIZATION RULE:**

If flag says "Corrected X to Y" → Text MUST show Y
If text shows X but flag says corrected → FIX THE TEXT (mandatory)
If you can't fix the text → Change flag to "uncertain" instead of "corrected"

**EXAMPLES:**

✓ CORRECT (Flag/Text Match):
Flag: ⚠️ Corrected 'supplies' to 'supplier' (OCR error)
Text: "Verify with supplier"
[Flag and text match - correction applied]

✗ WRONG (Flag/Text Mismatch):
Flag: ⚠️ Corrected 'supplies' to 'supplier' (OCR error)
Text: "Verify with supplies"
[Flag says corrected but text still shows original - FIX THIS]

**MANDATORY RULE:**
If flag says "Corrected X to Y" → Text MUST show Y
If text shows Y but no flag → Add flag explaining correction
Every correction MUST have a corresponding flag. No exceptions.

**EXAMPLES:**

✓ "Hot dip galvanised per AS/NZS 4680"
Flag: "⚠️ Corrected 'calvanited' to 'galvanised' (OCR error)"
[Correction applied + flag shown]

✓ "40mm grout under base plate"
Flag: "⚠️ Corrected 'grows' to 'grout' (OCR error)"
[Correction applied + flag shown]

✓ "verify with supplier"
Flag: "⚠️ Corrected 'supplies' to 'supplier' (OCR error)"
[Correction applied + flag shown]

✗ WRONG (Missing Flag):
"Hot dip galvanised per AS/NZS 4680"
Flag: [none]
[Correction applied but no transparency - engineer can't verify what changed]

**SPECIFIC EXAMPLES:**

"Hot dip calvanited" →
- "calvanited" not in dictionary
- Check similar: "galvanised" (edit distance: 3, common term in context)
- Correction: "Hot dip galvanised"
- Flag: ⚠️ Corrected 'calvanited' to 'galvanised' (OCR error)

"40mm grows under base plate" →
- "grows" is valid word BUT contextually wrong
- Pattern: "[number]mm [substance] under base"
- Expected substances: grout, mortar, compound, epoxy
- "grows" → "grout" (edit distance: 1, contextually correct)
- Correction: "40mm grout under base plate"
- Flag: ⚠️ Corrected 'grows' to 'grout' (likely OCR error)

"verify with supplies" →
- Context: "verify with [entity]"
- Expected: supplier, engineer, site, manufacturer
- "supplies" → "supplier" (edit distance: 1, contextually correct)
- Correction: "verify with supplier"
- Flag: ⚠️ Corrected 'supplies' to 'supplier' (OCR error)

"fly brase @ 1500 centres" →
- "brase" not in dictionary
- Check similar: "brace" (edit distance: 1, common structural term)
- Correction: "fly brace @ 1500 centres"
- Flag: ⚠️ Corrected 'brase' to 'brace' (OCR error)

**KNOWN TECHNICAL TERMS (Reference List):**

**Coatings/Finishes:**
- galvanised, galvanized, painted, coated, epoxy, resin

**Materials:**
- steel, concrete, grout, mortar, compound, epoxy, resin, cement

**Structural Terms:**
- brace, anchor, weld, torque, install, verify, supplier, engineer

**Installation Terms:**
- install, anchor, bolt, weld, torque, verify, check, hold, support

**IMPORTANT NOTES:**

- Only correct if confidence is high (>90%) AND contextually makes sense
- Preserve technical standards exactly: "AS/NZS 4680" not "AS NZS 4680"
- Don't correct valid variations: "galvanized" (US) vs "galvanised" (AU) - prefer Australian spelling
- Flag all corrections for transparency
- If uncertain, flag but don't correct

### Standards and Reference Patterns

**STANDARD REFERENCES:**

Format: [Standard body]-[number] or [Standard body]/[Standard body] [number]

Examples:
- AS 4100 (Australian Standard)
- AS/NZS 4680 (Australian/New Zealand Standard)
- AS 3600
- AS/NZS 1170.1
- AS1594

**STANDARD REFERENCE VALIDATION - CRITICAL:**

Common engineering standards follow patterns:
- AS/NZS [4-5 digits] (Australian/New Zealand)
- AS [4-5 digits] (Australian Standard)
- ASTM [letter][digits] (American)
- ISO [digits]:[year] (International)
- EN [digits] (European)

**VALIDATION PROTOCOL:**

If you see standard reference with unusual numbers:
1. Check if it's a known standard
2. Look for OCR character confusion (9→7, 0→O, 1→I, etc.)
3. If similar to known standard (edit distance ≤ 1):
   - Apply correction if confident (>90%)
   - Flag: ⚠️ Corrected '[original]' to '[corrected]' (OCR error - standard reference)
4. If uncertain, flag for verification

**COMMON STANDARD OCR ERRORS:**

| Actual | Often Misread As | Context Clue |
|--------|------------------|--------------|
| AS1594 | AS1574 | Steel standard (9→7 confusion) |
| AS/NZS 4680 | AS/NZS 468O | Galvanising standard (0→O) |
| AS 4100 | AS 4IOO | Steel design (1→I, 0→O) |

**EXAMPLES:**

"AS1574" →
- Not a common standard
- Similar: "AS1594" (known steel standard, edit distance: 1)
- Likely: OCR 9→7 confusion
- Correction: "AS1594"
- Flag: ⚠️ Corrected 'AS1574' to 'AS1594' (OCR error - standard reference)
- **IMPORTANT: Apply correction to extracted text, not just flag it**

"AS/NZS 4680" →
- Known standard (galvanising)
- Action: Accept as-is

"AS/NZS 468O" →
- "468O" unusual (O instead of 0)
- Correction: "AS/NZS 4680"
- Flag: ⚠️ Corrected '468O' to '4680' (OCR error - standard reference)
- **IMPORTANT: Apply correction to extracted text**

**DETAIL REFERENCES:**

Format: "See Detail [mark]/[drawing]" or "Detail [mark]"

Examples:
- "See Detail D-12/S-500"
- "Detail D-12"
- "Ref: Detail CBP-01"

### Special Cases

**NB-02 Welded Beam:**
- Common misreadings:
  - Size: "WB 610 x 27", "WB 612.2", "WB1220x6.0"
  - Quantity: 1 (should be 2)
- Correct values:
  - Size: WB1220×6.0 (1220mm deep, 6mm web)
  - Qty: 2
  - Grade: HA350
  - Comment: Should mention "Web beam", "non-standard section per AS1594", "See Detail D-12/S-500"
- Validation: If extracting this beam, double-check these fields

**Grade vs. Size Confusion:**
- Problem: Size weight gets misread as grade
- Wrong: Size: 250UB77.2, Grade: 37.2
- Right: Size: 250UB37.2, Grade: Not marked
- Detection: If grade is a decimal number matching part of size → column misalignment

**"Not marked" vs "N/A":**
- "Not marked" = explicitly stated in document (usually Grade column)
- "N/A" = empty cell or dash (—)
- Don't convert one to the other. Check actual PDF cell content.

## OUTPUT FORMAT

Return data in this structure for each row:

IF BEAM SCHEDULE:
{{
  "Mark": "B1",
  "Size": "310UC158",
  "Qty": 2,
  "Length": "5400 mm",
  "Grade": "300",
  "PaintSystem": "N/A",
  "Comments": "Existing steel. Column conversion deferred. [handwritten: 'CHANGED TO 310UC137 - PMG']"
}}

IF COLUMN SCHEDULE:
{{
  "Mark": "C1",
  "SectionType": "UC",
  "Size": "310 UC 158",
  "Length": "5400 mm",
  "Grade": "300",
  "BasePlate": "N/A",
  "CapPlate": "N/A",
  "Finish": "HD Galv",
  "Comments": "Existing column"
}}

**Confidence levels:**
- `high`: 95%+ confident, minimal ambiguity
- `medium`: 70-94% confident, some uncertainty
- `low`: <70% confident, needs verification

## CRITICAL REMINDERS

**NEVER output character soup ("H o l d 4 O m...")**
If garbled → mark [illegible]
Don't give unusable output

**Extract partial before marking illegible**
"Install anchor bolts [remainder obscured]"
NOT "[Comment illegible]"

**Issues stay in their columns**
Stain in column B doesn't affect column A
Each column independent

**Multi-sentence fields need complete extraction**
Don't stop at first period
Get full specification

**Fix what you're confident about**
Obvious OCR errors → correct + flag
Uncertain → flag, don't fix

**Use document structure for validation**
Section context matters
Validate against expectations

**Never invent data**
Missing = N/A or [missing]
Don't fill gaps with assumptions

## SUCCESS CRITERIA

Your extraction is successful when:

✅ All readable content extracted (nothing missed due to premature [illegible] marking)
✅ All format rules followed for engineering documents
✅ All uncertainties explicitly flagged with specific reasons
✅ No character soup in output
✅ Issues noted in correct columns
✅ Complete multi-part fields captured
✅ Corrections explained transparently
✅ Zero silent errors

Remember: This output will be used for critical decisions. Accuracy and transparency are more important than completeness. When in doubt, FLAG IT.

Begin extraction. For each row, apply all validation rules and output in the specified JSON format.

Return ONLY a valid JSON array (no markdown, no explanation, no code blocks).

TEXT: {text}
        """
    if doc_type == "transmittal":
        return f"""
        You are an advanced structural engineering document analyzer extracting comprehensive structured data from drawing PDFs.
        
        Extract data into these categories and return a JSON object with these keys:
        
        1. "DrawingRegister" - Basic drawing metadata (always extract):
           - "DwgNo": Drawing number (e.g., S-001, S-100, S-101)
           - "Rev": Revision (e.g., A, 0, C)
           - "Title": Drawing title (e.g., "GENERAL NOTES", "FOUNDATION PLAN")
           - "Scale": Scale (e.g., "1:100", "N.T.S")
        
        2. "Standards" - Array of standards referenced:
           - "Standard": Standard name (e.g., "AS 4100", "AS 3600", "AS/NZS 1170.1")
           - "Clause": Clause/section numbers (e.g., "Cl. 9.2, 13.4")
           - "Applicability": What it applies to (e.g., "Structural Steel Design")
        
        3. "Materials" - Array of material specifications:
           - "MaterialType": Type (e.g., "Concrete", "Steel Grade", "Bolts", "Grout")
           - "GradeSpec": Specification (e.g., "32 MPa", "300PLUS", "M24 Grade 8.8")
           - "Applications": Where used (e.g., "Slabs Zones A1/A2", "Columns C1-C2")
        
        4. "Connections" - Array of connection details:
           - "DetailMark": Connection mark (e.g., "CBP-01", "BCC-2", "BR-3")
           - "ConnectionType": Type description
           - "BoltSpec": Bolt specifications
           - "PlateSpec": Plate/member specifications
           - "WeldTorque": Weld or torque requirements
           - "DrawingRef": Reference to detail drawing
        
        5. "Assumptions" - Array of design assumptions:
           - "Assumption": What is assumed (e.g., "Foundation bearing capacity")
           - "Value": The value (e.g., "250 kPa minimum")
           - "Location": Where it applies (e.g., "All footings", "Zones B1/B2")
           - "Critical": Criticality level (e.g., "CRITICAL", "HIGH")
           - "VerificationMethod": How to verify
        
        6. "VOSFlags" - Array of "Verify on Site" items:
           - "FlagID": Identifier (e.g., "V.O.S.-01")
           - "Item": What needs verification
           - "Issue": The issue or requirement
           - "ActionRequired": What action is needed
           - "ResponsibleParty": Who is responsible
        
        7. "CrossReferences" - Array of cross-references:
           - "Reference": The reference text (e.g., "See Detail D1/S-500")
           - "ReferencedIn": Which drawing contains the reference
           - "RefersTo": What it refers to (e.g., "Detail D1 on S-500")
        
        EXTRACTION RULES:
        - Extract ALL standards mentioned (AS, AS/NZS, NCC codes)
        - Extract ALL material grades and specifications
        - Extract ALL connection detail marks and their specs
        - Extract ALL design assumptions, bearing capacities, slab thicknesses, grid spacing, FRL requirements
        - Extract ALL "V.O.S.", "Verify on Site", "Check", or similar flags
        - Extract ALL "See Detail", "Ref:", "Refer to" cross-references
        - For standards: Look in notes, specifications, detail callouts
        - For materials: Extract from schedules, notes, detail specifications
        - For connections: Extract from detail marks, connection tables, specifications
        - For assumptions: Extract from notes, plan annotations, general notes
        - For VOS: Look for explicit "V.O.S.", "Verify", "Check on site" text
        - For cross-refs: Extract all "See Detail X", "Ref: Detail Y", "Refer to Z" mentions
        
        Return a JSON object with all 7 keys. Use empty arrays [] if a category has no data.
        Return ONLY valid JSON (no markdown, no explanation, no code blocks).

        TEXT: {text}
        """
    return f"""
    Extract comprehensive invoice data from this document as JSON.
    
    ## DOCUMENT TYPE DETECTION
    
    First, identify the document type:
    
    **INVOICE/COMMERCIAL INVOICE:**
    - Contains: Invoice number, vendor, amounts, line items
    - Purpose: Payment request, customs clearance
    - Extract: Full details including line items
    
    **RECEIPT:**
    - Contains: Transaction completed, payment method
    - Purpose: Proof of payment
    - Extract: Summary level sufficient (line items optional if < 5 items)
    
    **TAX INVOICE (Australian):**
    - Contains: ABN, GST breakdown
    - Purpose: Tax compliance
    - Extract: ABN mandatory, GST details critical
    
    **PRO FORMA INVOICE:**
    - Flag as: "Pro Forma - Not for payment"
    - Extract same fields but note status
    
    ## CORE FIELDS - ALWAYS EXTRACT
    
    **Header Information (Required):**
    - "Vendor": Vendor/supplier name (clean, no extra text)
    - "InvoiceNum": Invoice number/reference (or "N/A" if receipt)
    - "Date": Invoice date (standardize to YYYY-MM-DD format)
    - "Currency": Document currency (default to AUD if Australian vendor, or extract from document)
    
    **Financial Totals (Required):**
    - "Cost": Subtotal (before tax, numeric, no currency symbols)
    - "GST": Tax/GST amount (numeric, use "N/A" if exempt/international/not listed)
    - "FinalAmount": Total amount payable (numeric, no currency symbols)
    
    **Financial Validation:**
    - Verify: Subtotal + Tax = Total (within $0.01 tolerance)
    - If Australian vendor: Check for ABN and GST
    - If international: Currency must be specified
    
    ## LINE ITEMS EXTRACTION - CRITICAL ENHANCEMENT
    
    **When to Extract Line Items:**
    Extract line items when:
    - Invoice has itemized table/list
    - More than 2 distinct products/services
    - Quantities and unit prices are listed
    
    Skip line items when:
    - Simple receipt (< 5 items)
    - Only summary available
    - User requests summary only
    
    **Line Item Format:**
    Each line item object should contain:
    - "ItemNumber": Line/item number (if present, otherwise auto-number: "001", "002", etc.)
    - "PartNumber": Part/product number/SKU (critical for inventory, use "N/A" if not present)
    - "HSCode": HS/tariff code per line item (format: "XXXX.XX.XX", optional)
    - "Description": Item description/product name (clean, no formatting artifacts)
    - "Quantity": Quantity (numeric only, extract unit if separate)
    - "UnitPrice": Unit price (decimal format, numeric)
    - "LineTotal": Line total amount (Qty × Unit Price, numeric)
    - "Currency": Currency for this line (if different from invoice total)
    
    **Line Item Extraction Protocol:**
    
    STEP 1: Identify table structure
    - Locate headers: Line/Item #, Part #, Description, Qty, Unit Price, Total
    - Map columns (may have different names: "Item", "Product", "SKU", "Part No", etc.)
    - Note multi-page continuation markers
    
    STEP 2: Extract each row
    For each line item:
    - Extract all available fields
    - Handle merged cells/wrapped text (combine continuation lines into single description)
    - Don't create duplicate line items from subtotals
    
    STEP 3: Validate extraction
    - Calculate: Σ(line totals) should equal invoice subtotal
    - Check: All required fields populated
    - Flag: Missing part numbers or quantities
    - Warn: If calculated total ≠ invoice total (>$0.50 difference)
    
    STEP 4: Handle pagination
    - Note "CONTINUED ON PAGE X" markers
    - Consolidate items across pages
    - Verify total line count matches invoice claim
    
    **Common Line Item Challenges:**
    - MULTI-PAGE INVOICES: Track continuation across pages, aggregate all items
    - MERGED CELLS: Description may span multiple rows, combine into single description
    - SUBTOTALS: Ignore intermediate subtotals, only extract individual line items
    - MISSING COLUMNS: If no Part #, use "N/A"; if no HS code, skip (optional); if no Line #, auto-number
    
    ## BUSINESS CONTEXT EXTRACTION
    
    **Tax Compliance Fields:**
    For Australian Invoices:
    - "ABN": Extract 11-digit number (format: XX XXX XXX XXX, use "N/A" if not present)
    - "GSTIncluded": Note if "GST Included" or separate line (boolean or "N/A")
    - "TaxInvoice": Flag if explicitly stated "Tax Invoice" (boolean)
    
    For International Invoices:
    - "CountryOfOrigin": Country of origin (if specified)
    - "HSCodes": Array of HS codes (per line item or overall)
    - "CustomsDeclaration": Customs declaration statements (if present)
    
    **Purchase Order Tracking:**
    - "POReference": PO Number (look for "PO Ref", "PO #", "Purchase Order", clean format: "AU-PO-77441" not "PO REF: AU-PO-77441")
    - "CustomerReference": Customer reference number (if present)
    - "ProjectNumber": Project number (if present)
    
    **Payment Terms:**
    - "PaymentTerms": Payment terms (e.g., "NET 30 DAYS", "60 DAYS FROM B/L DATE")
    - "DueDate": Due date (calculate from invoice date + terms, format YYYY-MM-DD)
    - "PaymentMethod": Payment method if specified (Wire, LC, etc.)
    
    **Shipping Information (International):**
    For commercial invoices with shipping:
    - "ShippingTerms": Incoterms (FOB, CIF, DAP, EXW, DDP, FCA, CFR, CPT, etc.)
    - "PortOfLoading": Port of loading with code (e.g., "SHENZHEN (CNSZN)")
    - "PortOfDischarge": Port of discharge with code (e.g., "BRISBANE (AUBNE)")
    - "VesselVoyage": Vessel/voyage number (e.g., "MAERSK BRISBANE V.240W")
    - "BillOfLading": Bill of Lading reference
    - "AirWaybill": Air Waybill number (if airfreight)
    
    ## VALIDATION & QUALITY CHECKS
    
    **Mandatory Validation:**
    
    FINANCIAL VALIDATION:
    ✓ Subtotal + Tax = Total (tolerance: ±$0.10)
    ✓ All line totals sum to subtotal (tolerance: ±$1.00)
    ✓ Unit price × Quantity = Line total (per line)
    ✓ Currency consistent throughout
    
    FLAG IF:
    ⚠️ Totals don't match → Add to flags: "Calculation mismatch - verify manually"
    ⚠️ Missing currency → Add to flags: "Currency not specified - assumed [X]"
    ⚠️ Tax rate unusual → Add to flags: "GST 10% expected for AU, found X%"
    
    CRITICAL IF:
    🚫 Total amount missing → "CRITICAL: Cannot determine payable amount"
    🚫 Vendor name unclear → "CRITICAL: Vendor identification uncertain"
    
    **Business Rule Validation:**
    
    AUSTRALIAN INVOICES:
    - Must have ABN if > $82.50 (GST threshold)
    - GST should be 10% of subtotal
    - "Tax Invoice" required for GST claims
    
    INTERNATIONAL INVOICES:
    - Currency must be specified
    - HS codes required for customs (flag if missing)
    - Incoterms should be present (flag if missing)
    
    PAYMENT TERMS:
    - If "Net X Days": Calculate due date
    - If date-specific: Extract as-is
    - If missing: Flag as "Payment terms not specified"
    
    ## SUMMARY GENERATION
    
    **Intelligent Summary Rules:**
    Instead of generic descriptions, create intelligent summaries:
    
    For invoices with line items:
    - Mention item count
    - Categorize items logically (e.g., "Hydraulic components, Engine parts, Mechanical")
    - Highlight 2-3 most expensive items
    - Keep under 100 characters if possible
    
    Example:
    ❌ DON'T: "Construction and forestry parts"
    ✅ DO: "20 line items: Hydraulic components (filters, cylinders), Engine parts (gaskets, pistons). Major: Hydraulic cylinders ($4,000), Bearings ($2,400)"
    
    For simple receipts:
    - Brief description of transaction type
    - Payment method if relevant
    
    ## ERROR HANDLING & EDGE CASES
    
    **Missing Information:**
    - Invoice Number: Try "Receipt #", "Ref #", or mark "N/A"
    - Date: Try multiple formats, flag if ambiguous
    - Total: CRITICAL - must find or flag for manual review
    - Currency: Infer from vendor location if not stated
    
    **Calculation Mismatches:**
    If totals don't add up:
    1. Re-check extraction (common: missed a line item)
    2. Check for shipping/handling fees
    3. Check for discounts/adjustments
    4. If still mismatch > $1.00:
       → Flag: "⚠️ Calculation discrepancy: Calculated $X vs Invoice $Y"
       → Use invoice stated total (assume correct)
       → Note for manual verification
    
    **Multi-Currency:**
    If line items in different currency than total:
    - Note exchange rate if provided
    - Flag conversion if not clear
    - Example: "Items in EUR, Total in USD @ 1.08 rate"
    
    ## OUTPUT FORMAT
    
    Return a JSON object with this structure:
    
    {{
      "Vendor": "vendor name",
      "Date": "YYYY-MM-DD",
      "InvoiceNum": "invoice number or N/A",
      "Currency": "AUD/USD/etc",
      "Cost": numeric_subtotal,
      "GST": numeric_tax_or_N/A,
      "FinalAmount": numeric_total,
      "Summary": "intelligent summary with item count and categorization",
      "LineItems": [
        {{
          "ItemNumber": "001",
          "PartNumber": "part number or N/A",
          "HSCode": "XXXX.XX.XX or N/A",
          "Description": "item description",
          "Quantity": numeric_quantity,
          "UnitPrice": numeric_price,
          "LineTotal": numeric_total,
          "Currency": "currency if different"
        }}
      ],
      "ABN": "11-digit ABN or N/A",
      "POReference": "PO number or N/A",
      "PaymentTerms": "payment terms or N/A",
      "DueDate": "YYYY-MM-DD or N/A",
      "ShippingTerms": "Incoterms or N/A",
      "PortOfLoading": "port with code or N/A",
      "PortOfDischarge": "port with code or N/A",
      "VesselVoyage": "vessel info or N/A",
      "BillOfLading": "B/L reference or N/A",
      "HSCodes": ["array of HS codes if present"],
      "Flags": ["array of validation flags and warnings"]
    }}
    
    **Important:**
    - Use empty array [] for LineItems if no line items present
    - Use empty array [] for HSCodes if none present
    - Use empty array [] for Flags if no issues
    - Use "N/A" for missing string fields
    - Calculate line item totals and validate against invoice subtotal
    - Include validation flags for any discrepancies or uncertainties
    
    Return ONLY valid JSON (no markdown, no explanation, no code blocks).

    TEXT: {text}
    """


# --- HTML TEMPLATE ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Consultancy  Takeoff Automator</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            max-width: 1200px;
            margin: 20px auto;
            padding: 20px;
            line-height: 1.5;
            background: #F8F9FA;
            color: #4B5563;
            font-size: 14px;
        }
        .container {
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #0B1221;
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            border-bottom: 2px solid #D4AF37;
            padding-bottom: 10px;
            margin-top: 0;
            font-size: 24px;
        }
        h3 {
            font-size: 16px;
            margin: 20px 0 10px;
            color: #0B1221;
            font-weight: 600;
        }
        .toggle-group {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .toggle-group label {
            cursor: pointer;
            font-weight: 600;
        }
        .toggle-group input {
            margin-right: 6px;
        }
        .sample-group {
            padding: 15px;
            background: #eef;
            border-radius: 4px;
            margin-bottom: 15px;
            display: none;
        }
        .sample-group label {
            display: block;
            margin-bottom: 4px;
            font-size: 14px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            font-size: 13px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        th, td {
            border: 1px solid #ddd;
            padding: 10px 8px;
            text-align: left;
        }
        th {
            background-color: #0B1221;
            color: white;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        td {
            font-size: 13px;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        tr:hover {
            background-color: #f5f5f5;
        }
        .currency {
            text-align: right;
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        .btn {
            background: #D4AF37;
            color: #0B1221;
            font-weight: 600;
            border: none;
            padding: 10px 20px;
            font-size: 14px;
            border-radius: 6px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
        }
        .btn:hover {
            background: #B8941F;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .btn-secondary {
            background: #0B1221;
            color: #D4AF37;
        }
        .btn-secondary:hover {
            background: #1a2332;
        }
        .btn-export {
            background: #28a745;
        }
        .btn-export:hover {
            background: #218838;
        }
        .button-group {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .error {
            color: red;
            font-weight: bold;
            margin-top: 10px;
        }
        .info {
            font-size: 12px;
            color: #666;
        }
        .upload-wrapper {
            margin-top: 10px;
        }
        .file-label {
            display: inline-block;
            border-radius: 6px;
            padding: 10px 20px;
            background: #D4AF37;
            border: none;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            color: #0B1221;
            transition: all 0.3s ease;
            text-align: center;
        }
        .file-label:hover {
            background: #B8941F;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .file-label input {
            display: none;
        }
        .finance-sample-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .finance-sample-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #e0f2ff;
            color: #0f172a;
            padding: 4px 10px;
            border-radius: 999px;
            font-weight: 600;
            font-size: 13px;
        }
        .transmittal-sample-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .transmittal-sample-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #fef3c7;
            color: #78350f;
            padding: 4px 10px;
            border-radius: 999px;
            font-weight: 600;
            font-size: 13px;
        }
        .instruction-text {
            font-size: 12px;
            color: #475569;
        }
        .upload-list {
            margin-top: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: 12px;
            color: #0f172a;
        }
        .upload-item {
            padding: 6px 10px;
            border-radius: 6px;
            background: #e2e8f0;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .routine-description {
            border: 1px dashed #cbd5e1;
            padding: 12px 16px;
            border-radius: 6px;
            background: #f8fafc;
            margin-bottom: 10px;
            font-size: 13px;
            display: none;
        }
        #processing-spinner {
            display: none;
            margin-top: 16px;
            padding: 10px 14px;
            background: #eef4ff;
            border: 1px solid #9ac6ff;
            border-radius: 6px;
            color: #1d4ed8;
            font-weight: 600;
        }
        #processing-spinner.visible {
            display: block;
        }
        #processing-spinner .spinner-icon {
            width: 16px;
            height: 16px;
            margin-right: 8px;
            border: 3px solid rgba(37, 120, 195, 0.3);
            border-top-color: #1d4ed8;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            display: inline-block;
            vertical-align: middle;
        }
        .model-info {
            margin-top: 6px;
            font-size: 12px;
            color: #1d4ed8;
        }
        .attempt-log {
            margin-top: 16px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 10px 14px;
            background: #f8fafc;
            font-size: 12px;
        }
        .attempt-log ul {
            margin: 6px 0 0;
            padding-left: 16px;
        }
        .action-log {
            margin-top: 20px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 12px 16px;
            background: #f8fafc;
            font-size: 13px;
        }
        .action-log ol {
            margin: 6px 0 0;
            padding-left: 18px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .summary-card {
            margin-top: 20px;
            padding: 12px 16px;
            border-radius: 6px;
            border: 1px solid #dbeafe;
            background: #f0f9ff;
            font-size: 13px;
        }
        .low-confidence {
            background-color: #fef3c7;
            border-left: 3px solid #f59e0b;
            padding: 4px 8px;
            border-radius: 3px;
            display: inline-block;
        }
        .low-confidence::before {
            content: "⚠️ ";
            font-weight: 600;
        }
        .low-confidence-text {
            background-color: #fee2e2;
            border-left: 3px solid #ef4444;
            padding: 6px 10px;
            border-radius: 4px;
            display: block;
            position: relative;
        }
        .low-confidence-text::before {
            content: "⚠️ LOW CONFIDENCE - REVIEW REQUIRED";
            display: block;
            font-size: 10px;
            font-weight: 700;
            color: #dc2626;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .critical-error {
            background-color: #fee2e2;
            border: 2px solid #ef4444;
            padding: 8px 12px;
            border-radius: 4px;
            margin: 4px 0;
            font-size: 12px;
        }
        .critical-error-header {
            font-weight: 700;
            color: #dc2626;
            margin-bottom: 4px;
            font-size: 11px;
            text-transform: uppercase;
        }
        .critical-error-item {
            margin: 2px 0;
            padding-left: 12px;
            position: relative;
        }
        .critical-error-item::before {
            content: "❌";
            position: absolute;
            left: 0;
        }
        tr.has-critical-errors {
            background-color: #fef2f2 !important;
        }
        tr.has-critical-errors:hover {
            background-color: #fee2e2 !important;
        }
        .requires-manual-verification {
            background-color: #fff3cd !important;
            border: 3px solid #ffc107 !important;
            position: relative;
        }
        .requires-manual-verification::before {
            content: "⚠️ MANUAL VERIFICATION REQUIRED - DO NOT USE EXTRACTED VALUES";
            display: block;
            background-color: #dc3545;
            color: white;
            font-weight: 700;
            padding: 8px 12px;
            text-align: center;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        .rejection-notice {
            background-color: #dc3545;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            font-weight: 600;
            margin: 8px 0;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ Consultancy  Takeoff Automator</h1>
        
        {% if error %}
        <p class="error">{{ error }}</p>
        {% endif %}

        <form method="post" enctype="multipart/form-data" novalidate>
            <div class="toggle-group">
                <label>
                    <input type="radio" name="department" value="finance" {% if department == 'finance' %}checked{% endif %}>
                    Finance Dept
                </label>
                <label>
                    <input type="radio" name="department" value="engineering" {% if department == 'engineering' %}checked{% endif %}>
                    Engineering Dept
                </label>
                <label>
                    <input type="radio" name="department" value="transmittal" {% if department == 'transmittal' %}checked{% endif %}>
                    Drafter Transmittal
                </label>
            </div>

            <h3>1. Select Sample Files</h3>
            {% for dept_key, group in sample_files.items() %}
            <div class="sample-group" data-department="{{ dept_key }}">
                <strong>{{ group.label }}</strong> · {{ group.description }}
                <div style="margin-top: 10px;">
                    {% for sample in group.samples %}
                    {% if dept_key == 'transmittal' %}
                    <div class="transmittal-sample-row">
                        <span class="transmittal-sample-pill">✅ {{ sample.label }}</span>
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">🔗</a>
                        <input type="hidden" name="transmittal_defaults" value="{{ sample.path }}">
                    </div>
                    {% else %}
                    <label>
                        <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples or ((dept_key == 'engineering' or dept_key == 'finance') and not selected_samples) %}checked{% endif %}>
                        {{ sample.label }}
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">🔗</a>
                    </label>
                    {% endif %}
                    {% endfor %}
                </div>
                {% if dept_key == 'finance' %}
                <div class="upload-wrapper" data-upload="finance">
                    <label class="file-label">
                        <span>📤 Upload invoice PDFs</span>
                        <input type="file" name="finance_uploads" accept=".pdf" multiple>
                    </label>
                    <p class="instruction-text">PDF invoices only. Uploaded files run alongside the finance samples.</p>
                    <div class="upload-list" id="finance-upload-list" style="display: none;"></div>
                </div>
                {% endif %}
            </div>
            {% endfor %}

            {% for dept_key, description in routine_descriptions.items() %}
            <div class="routine-description" data-department="{{ dept_key }}">
                {% for heading, body in description %}
                <strong>{{ heading }}</strong>
                {{ body|safe }}
                {% endfor %}
            </div>
            {% endfor %}

            <div class="button-group">
                <button type="submit" class="btn">🚀 Generate Output</button>
            </div>
            <div id="processing-spinner"><span class="spinner-icon"></span>Processing files…</div>
        </form>

        {% if results %}
        <div id="results-section">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 30px;">
            <h3 style="margin: 0;">Extraction Results</h3>
            <span class="info">{{ results|length }} row(s) processed</span>
        </div>
        
        {% if department == 'transmittal' and transmittal_data %}
        <!-- Enhanced Transmittal Report with Multiple Categories -->
        <div style="background: #e8f4f8; border-left: 4px solid #3498db; padding: 12px; margin: 20px 0; border-radius: 4px; font-size: 13px; color: #2c3e50;">
            <strong>What this demonstrates:</strong> The LLM extracts semi-structured & narrative data from {{ (results or [])|length }} PDF document(s) and produces 6 clean CSV tables that engineers can immediately use in Excel, BIM coordination, fabrication workflows, and quality audits. Each CSV can be exported individually.
        </div>
        
        <!-- 1. Drawing Register -->
        {% if transmittal_data and transmittal_data.DrawingRegister %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">1. Drawing Register</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Basic drawing metadata | Use Case: Document control, revision tracking</div>
            </div>
            <div style="overflow-x: auto; max-height: 300px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Filename</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing No</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Revision</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing Title</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Scale</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for reg in transmittal_data.DrawingRegister %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ reg.Filename or reg.get('Filename', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.DwgNo or reg.get('DwgNo', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Rev or reg.get('Rev', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Title or reg.get('Title', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Scale or reg.get('Scale', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=DrawingRegister" class="btn btn-export" style="text-decoration: none;">📥 Export Drawing Register to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 2. Standards & Compliance Matrix -->
        {% if transmittal_data and transmittal_data.Standards %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">2. Standards & Compliance Matrix</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Compliance audits, subcontractor briefing</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Standard</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Clause/Section</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Applicability</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source Document</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for std in transmittal_data.Standards %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px; font-weight: 500;">{{ std.Standard or std.get('Standard', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ std.Clause or std.get('Clause', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ std.Applicability or std.get('Applicability', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ std.SourceDocument or std.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Standards" class="btn btn-export" style="text-decoration: none;">📥 Export Standards to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 3. Material Specifications Inventory -->
        {% if transmittal_data and transmittal_data.Materials %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">3. Material Specifications Inventory</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Procurement, quality control, consistency checks</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Material Type</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Grade/Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Applications</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source References</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for mat in transmittal_data.Materials %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><strong>{{ mat.MaterialType or mat.get('MaterialType', 'N/A') }}</strong></td>
                            <td style="padding: 10px 12px;">{{ mat.GradeSpec or mat.get('GradeSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ mat.Applications or mat.get('Applications', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ mat.SourceDocument or mat.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Materials" class="btn btn-export" style="text-decoration: none;">📥 Export Materials to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 4. Connection Detail Registry -->
        {% if transmittal_data and transmittal_data.Connections %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">4. Connection Detail Registry</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Fabricator briefing, design consistency checks, RFI prevention</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Detail Mark</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Connection Type</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Bolt Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Plate/Member Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Weld/Torque</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing Ref</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for conn in transmittal_data.Connections %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><strong>{{ conn.DetailMark or conn.get('DetailMark', 'N/A') }}</strong></td>
                            <td style="padding: 10px 12px;">{{ conn.ConnectionType or conn.get('ConnectionType', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.BoltSpec or conn.get('BoltSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.PlateSpec or conn.get('PlateSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.WeldTorque or conn.get('WeldTorque', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.DrawingRef or conn.get('DrawingRef', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Connections" class="btn btn-export" style="text-decoration: none;">📥 Export Connections to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 5. Design Assumptions & Verification Points -->
        {% if transmittal_data and transmittal_data.Assumptions %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">5. Design Assumptions & Verification Checklist</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Site engineer verification, BIM coordination, design review</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Assumption/Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Value</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Location/Zones</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Critical?</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Verification Method</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for assump in transmittal_data.Assumptions %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ assump.Assumption or assump.get('Assumption', 'N/A') }}</td>
                            <td style="padding: 10px 12px;"><span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px; font-weight: 500;">{{ assump.Value or assump.get('Value', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ assump.Location or assump.get('Location', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">
                                {% set crit = assump.Critical or assump.get('Critical', '') %}
                                {% if 'CRITICAL' in crit|upper %}
                                <strong style="color: #e74c3c;">CRITICAL</strong>
                                {% elif 'HIGH' in crit|upper %}
                                <strong style="color: #f39c12;">HIGH</strong>
        {% else %}
                                {{ crit }}
                                {% endif %}
                            </td>
                            <td style="padding: 10px 12px;">{{ assump.VerificationMethod or assump.get('VerificationMethod', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ assump.SourceDocument or assump.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Assumptions" class="btn btn-export" style="text-decoration: none;">📥 Export Assumptions to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 6. V.O.S. Flags & Coordination Points -->
        {% if transmittal_data and transmittal_data.VOSFlags %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">6. V.O.S. Flags & On-Site Coordination Points</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Site management, design coordination, decision log</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Flag ID</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Item</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Issue</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Action Required</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Responsible Party</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for vos in transmittal_data.VOSFlags %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><span style="background: #e74c3c; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: 600;">{{ vos.FlagID or vos.get('FlagID', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ vos.Item or vos.get('Item', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.Issue or vos.get('Issue', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.ActionRequired or vos.get('ActionRequired', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.ResponsibleParty or vos.get('ResponsibleParty', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.Status or vos.get('Status', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=VOSFlags" class="btn btn-export" style="text-decoration: none;">📥 Export V.O.S. Flags to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 7. Cross-Reference Validation -->
        {% if transmittal_data and transmittal_data.CrossReferences %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">7. Cross-Reference Validation & Missing Details Report</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Quality assurance, drawing completeness audit, RFI prevention</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Reference</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Referenced In</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Refers To</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Found?</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for xref in transmittal_data.CrossReferences %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ xref.Reference or xref.get('Reference', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ xref.ReferencedIn or xref.get('ReferencedIn', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ xref.RefersTo or xref.get('RefersTo', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">
                                {% set found = xref.Found or xref.get('Found', '') %}
                                {% if 'yes' in found|lower or 'true' in found|lower %}
                                <span style="color: #27ae60; font-weight: 600;">✓ Found</span>
                                {% elif 'no' in found|lower or 'false' in found|lower %}
                                <span style="color: #e74c3c; font-weight: 600;">✗ Missing</span>
                                {% else %}
                                {{ found or 'N/A' }}
                                {% endif %}
                            </td>
                            <td style="padding: 10px 12px;">{{ xref.Status or xref.get('Status', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=CrossReferences" class="btn btn-export" style="text-decoration: none;">📥 Export Cross-References to CSV</a>
            </div>
        </div>
        {% endif %}
        
        {% if model_actions %}
        <div class="action-log" style="margin-top: 30px;">
            <div><strong>Action log</strong></div>
            <ol>
                {% for action in model_actions %}
                <li>{{ action }}</li>
                {% endfor %}
            </ol>
        </div>
        {% endif %}
        
        {% endif %}
        
        {% if department == 'transmittal' and not transmittal_data %}
        <!-- Fallback to simple table if aggregated data not available for transmittal -->
        <table>
            <thead>
            <tr>
                <th>Filename</th>
                    <th>Drawing No</th>
                    <th>Revision</th>
                    <th>Drawing Title</th>
                    <th>Scale</th>
                </tr>
            </thead>
            <tbody>
                {% for row in results %}
                <tr>
                    <td>{{ row.Filename }}</td>
                    <td>{{ row.DwgNo }}</td>
                    <td>{{ row.Rev }}</td>
                    <td>{{ row.Title }}</td>
                    <td>{{ row.Scale }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% endif %}
        
        {% if department == 'finance' or department == 'engineering' %}
        {% if department == 'engineering' %}
        {# Render separate table for each document #}
        {% for filename, file_results in grouped_engineering_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                    {% if schedule_type == 'column' %}
                    <th>Mark</th>
                    <th>Section Type</th>
                    <th>Size</th>
                    <th>Length</th>
                    <th>Grade</th>
                    <th>Base Plate</th>
                    <th>Cap Plate</th>
                    <th>Finish</th>
                    <th>Comments</th>
                    {% else %}
                    <th>Mark</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Length</th>
                    <th>Grade</th>
                    <th>Paint System</th>
                    <th>Comments</th>
                    {% endif %}
            </tr>
            </thead>
            <tbody>
            {% for row in file_results %}
            <tr {% if row.get('requires_manual_verification') %}class="requires-manual-verification"{% elif row.get('has_critical_errors') %}class="has-critical-errors"{% endif %}>
                    {% if schedule_type == 'column' %}
                    <td>{% if row.get('Mark_confidence') == 'low' %}<span class="low-confidence">{{ row.Mark }}</span>{% else %}{{ row.Mark }}{% endif %}</td>
                    <td>{{ row.SectionType }}</td>
                    <td>{% if row.get('Size_confidence') == 'low' %}<span class="low-confidence">{{ row.Size }}</span>{% else %}{{ row.Size }}{% endif %}</td>
                    <td>{{ row.Length }}</td>
                    <td>{% if row.get('Grade_confidence') == 'low' %}<span class="low-confidence">{{ row.Grade }}</span>{% else %}{{ row.Grade }}{% endif %}</td>
                    <td>{{ row.BasePlate }}</td>
                    <td>{{ row.CapPlate }}</td>
                    <td>{{ row.Finish }}</td>
                    <td>
                        {% if row.get('Comments_confidence') == 'low' %}<span class="low-confidence-text">{{ row.Comments }}</span>{% else %}{{ row.Comments }}{% endif %}
                        {% if row.get('critical_errors') %}
                        <div class="critical-error">
                            <div class="critical-error-header">Critical Errors Detected:</div>
                            {% for error in row.critical_errors %}
                            <div class="critical-error-item">{{ error }}</div>
                            {% endfor %}
                        </div>
                        {% endif %}
                    </td>
                    {% else %}
                    <td>{% if row.get('Mark_confidence') == 'low' %}<span class="low-confidence">{{ row.Mark }}</span>{% else %}{{ row.Mark }}{% endif %}</td>
                    <td>
                        {% if row.get('Size_confidence') == 'low' %}<span class="low-confidence">{{ row.Size }}</span>{% else %}{{ row.Size }}{% endif %}
                        {% if row.get('corrections_applied') %}
                            {% for correction in row.corrections_applied %}
                                {% if 'Size' in correction %}
                                <div style="background-color: #d1f2eb; border-left: 3px solid #27ae60; padding: 4px 8px; margin-top: 4px; border-radius: 3px; font-size: 11px;">
                                    ✓ {{ correction }}
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Size' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">⚠️ Size Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>
                        {{ row.Qty }}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Quantity' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">⚠️ Quantity Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>{{ row.Length }}</td>
                    <td>
                        {% if row.get('Grade_confidence') == 'low' %}<span class="low-confidence">{{ row.Grade }}</span>{% else %}{{ row.Grade }}{% endif %}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Grade' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">⚠️ Grade Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>{% if row.get('PaintSystem_confidence') == 'low' %}<span class="low-confidence">{{ row.PaintSystem }}</span>{% else %}{{ row.PaintSystem }}{% endif %}</td>
                    <td>
                        {% if row.get('rejection_reason') %}
                        <div class="rejection-notice">
                            🚫 {{ row.rejection_reason }}
                        </div>
                        {% endif %}
                        {% if row.get('Comments_confidence') == 'low' %}<span class="low-confidence-text">{{ row.Comments }}</span>{% else %}{{ row.Comments }}{% endif %}
                        {% if row.get('critical_errors') and row.get('requires_manual_verification') %}
                        <div class="critical-error" style="margin-top: 8px;">
                            <div class="critical-error-header">🚫 Critical Errors - Manual Verification Required:</div>
                            {% for error in row.critical_errors %}
                            <div class="critical-error-item">{{ error }}</div>
                            {% endfor %}
                        </div>
                        {% endif %}
                    </td>
                    {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
        </div>
        {% endfor %}
        
        {# Finance tables - grouped by filename #}
        {% elif department == 'finance' %}
        {# Render separate table for each document #}
        {% for filename, file_results in grouped_finance_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                <th>Vendor</th>
                <th>Date</th>
                <th>Invoice #</th>
                <th>Currency</th>
                    <th class="currency">Cost</th>
                    <th class="currency">GST</th>
                    <th class="currency">Final Amount</th>
                <th>Summary</th>
                {% if file_results[0].get('POReference') and file_results[0].POReference != 'N/A' %}
                <th>PO Ref</th>
                {% endif %}
                {% if file_results[0].get('PaymentTerms') and file_results[0].PaymentTerms != 'N/A' %}
                <th>Payment Terms</th>
                {% endif %}
                {% if file_results[0].get('ShippingTerms') and file_results[0].ShippingTerms != 'N/A' %}
                <th>Shipping Terms</th>
                {% endif %}
            </tr>
            </thead>
            <tbody>
            {% for row in file_results %}
            <tr {% if row.get('requires_manual_verification') %}class="requires-manual-verification"{% elif row.get('has_critical_errors') %}class="has-critical-errors"{% endif %}>
                <td>{{ row.Vendor }}</td>
                <td>{{ row.Date }}</td>
                <td>{{ row.InvoiceNum }}</td>
                <td>{{ row.Currency or 'N/A' }}</td>
                    <td class="currency">{{ row.CostFormatted or row.Cost or 'N/A' }}</td>
                    <td class="currency">{{ row.GSTFormatted if row.GSTFormatted and row.GSTFormatted != 'N/A' else (row.GST or 'N/A') }}</td>
                    <td class="currency">{{ row.FinalAmountFormatted or row.TotalFormatted or row.FinalAmount or row.Total or 'N/A' }}</td>
                <td>{{ row.Summary }}</td>
                {% if file_results[0].get('POReference') and file_results[0].POReference != 'N/A' %}
                <td>{{ row.POReference or 'N/A' }}</td>
                {% endif %}
                {% if file_results[0].get('PaymentTerms') and file_results[0].PaymentTerms != 'N/A' %}
                <td>{{ row.PaymentTerms or 'N/A' }}{% if row.DueDate and row.DueDate != 'N/A' %}<br><small style="color: #666;">Due: {{ row.DueDate }}</small>{% endif %}</td>
                {% endif %}
                {% if file_results[0].get('ShippingTerms') and file_results[0].ShippingTerms != 'N/A' %}
                <td>{{ row.ShippingTerms or 'N/A' }}{% if row.PortOfLoading and row.PortOfLoading != 'N/A' %}<br><small style="color: #666;">{{ row.PortOfLoading }} → {{ row.PortOfDischarge or '' }}</small>{% endif %}</td>
                {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
            {# Display Business Context Information #}
            {% for row in file_results %}
            {% if row.get('ABN') or row.get('VesselVoyage') or row.get('BillOfLading') or (row.get('Flags') and row.Flags|length > 0) %}
            <div style="padding: 15px 20px; border-top: 1px solid #e0e0e0; background: #f9f9f9;">
                <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #2c3e50;">Additional Information</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; font-size: 13px;">
                    {% if row.ABN and row.ABN != 'N/A' %}
                    <div><strong>ABN:</strong> {{ row.ABN }}</div>
                    {% endif %}
                    {% if row.VesselVoyage and row.VesselVoyage != 'N/A' %}
                    <div><strong>Vessel:</strong> {{ row.VesselVoyage }}</div>
                    {% endif %}
                    {% if row.BillOfLading and row.BillOfLading != 'N/A' %}
                    <div><strong>B/L Reference:</strong> {{ row.BillOfLading }}</div>
                    {% endif %}
                </div>
                {% if row.get('Flags') and row.Flags|length > 0 %}
                <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 4px;">
                    <strong style="color: #856404;">⚠️ Flags:</strong>
                    <ul style="margin: 5px 0 0 0; padding-left: 20px; color: #856404;">
                        {% for flag in row.Flags %}
                        <li>{{ flag }}</li>
                        {% endfor %}
                    </ul>
                </div>
                {% endif %}
            </div>
            {% endif %}
            {% endfor %}
            {# Display Line Items if present #}
            {% for row in file_results %}
            {% if row.get('LineItems') and row.LineItems|length > 0 %}
            <div style="padding: 20px; border-top: 2px solid #e0e0e0; background: #f9f9f9;">
                <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #2c3e50;">Line Items</h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Item #</th>
                                {% if row.LineItems[0].get('PartNumber') and row.LineItems[0].PartNumber != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Part #</th>
                                {% endif %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Description</th>
                                {% if row.LineItems[0].get('HSCode') and row.LineItems[0].HSCode != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">HS Code</th>
                                {% endif %}
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Quantity</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Unit Price</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Line Total</th>
                                {% if row.LineItems[0].get('SKU') and row.LineItems[0].SKU != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">SKU</th>
                                {% endif %}
                                {% if row.LineItems[0].get('Category') and row.LineItems[0].Category != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Category</th>
                                {% endif %}
                            </tr>
                        </thead>
                        <tbody>
                            {% for item in row.LineItems %}
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.ItemNumber or '—' }}</td>
                                {% if row.LineItems[0].get('PartNumber') and row.LineItems[0].PartNumber != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.PartNumber or '—' }}</td>
                                {% endif %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Description or 'N/A' }}</td>
                                {% if row.LineItems[0].get('HSCode') and row.LineItems[0].HSCode != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.HSCode or '—' }}</td>
                                {% endif %}
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.Quantity or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.UnitPrice or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd; font-weight: bold;">{{ item.LineTotal or 'N/A' }}</td>
                                {% if row.LineItems[0].get('SKU') and row.LineItems[0].SKU != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.SKU or '—' }}</td>
                                {% endif %}
                                {% if row.LineItems[0].get('Category') and row.LineItems[0].Category != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Category or '—' }}</td>
                                {% endif %}
                            </tr>
                            {% endfor %}
                        </tbody>
                    </table>
                </div>
            </div>
            {% endif %}
            {% endfor %}
        </div>
        {% endfor %}
        {% endif %}
        
        <div class="summary-card">
            <div><strong>Run Summary</strong></div>
            {% for label, text in routine_summary %}
            <div><strong>{{ label }}:</strong> {{ text }}</div>
            {% endfor %}
        </div>
        {% if model_actions %}
        <div class="action-log">
            <div><strong>Action log</strong></div>
            <ol>
                {% for action in model_actions %}
                <li>{{ action }}</li>
                {% endfor %}
            </ol>
        </div>
        {% endif %}
            <div class="button-group">
                <a href="/export_csv" class="btn btn-export">📥 Export to CSV</a>
                <a href="/contact.html?option=phase-1" class="btn btn-secondary" target="_parent">Book Your Phase 1 Sprint</a>
            </div>
        </div>
        {% endif %}
        {% endif %}
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const sampleGroups = document.querySelectorAll('.sample-group');
            const routineDescriptions = document.querySelectorAll('.routine-description');
            const deptRadios = document.querySelectorAll('input[name="department"]');

            function updateSampleVisibility() {
                const checkedRadio = document.querySelector('input[name="department"]:checked');
                if (!checkedRadio) return;
                const active = checkedRadio.value;
                sampleGroups.forEach(group => {
                    group.style.display = group.dataset.department === active ? 'block' : 'none';
                });
            }

        function clearOtherSelections(activeDept) {
            if (!activeDept) return;
            sampleGroups.forEach(group => {
                if (group.dataset.department !== activeDept) {
                    const toggles = group.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                    toggles.forEach(input => {
                        if (input.checked) {
                            input.checked = false;
                        }
                    });
                    const fileInputs = group.querySelectorAll('input[type="file"]');
                    fileInputs.forEach(input => {
                        input.value = '';
                    });
                }
            });
            if (activeDept !== 'finance') {
                updateFinanceUploadList([]);
            }
        }

        const financeUploadInput = document.querySelector('input[name="finance_uploads"]');
        const financeUploadList = document.getElementById('finance-upload-list');

        function updateFinanceUploadList(filesArray) {
            if (!financeUploadList) return;
            const files = filesArray || (financeUploadInput ? Array.from(financeUploadInput.files || []) : []);
            financeUploadList.innerHTML = '';
            if (!files.length) {
                financeUploadList.style.display = 'none';
                return;
            }
            financeUploadList.style.display = 'flex';
            files.forEach(file => {
                const item = document.createElement('div');
                item.className = 'upload-item';
                item.textContent = `📎 ${file.name}`;
                financeUploadList.appendChild(item);
            });
        }

            const resultsSection = document.getElementById('results-section');
            function hideResultsSection() {
                if (resultsSection) {
                    resultsSection.style.display = 'none';
                }
            }

            function updateRoutineVisibility() {
                const checkedRadio = document.querySelector('input[name="department"]:checked');
                if (!checkedRadio) return;
                const active = checkedRadio.value;
                routineDescriptions.forEach(desc => {
                    desc.style.display = desc.dataset.department === active ? 'block' : 'none';
                });
            }

            function handleDepartmentChange() {
                updateSampleVisibility();
                hideResultsSection();
                updateRoutineVisibility();
            const checkedRadio = document.querySelector('input[name="department"]:checked');
            clearOtherSelections(checkedRadio ? checkedRadio.value : null);
            if (checkedRadio && checkedRadio.value === 'finance') {
                updateFinanceUploadList();
            }
            }

            deptRadios.forEach(radio => radio.addEventListener('change', handleDepartmentChange));
            updateSampleVisibility();
            updateRoutineVisibility();
        if (financeUploadInput) {
            financeUploadInput.addEventListener('change', () => updateFinanceUploadList());
            const activeDeptRadio = document.querySelector('input[name="department"]:checked');
            if (activeDeptRadio && activeDeptRadio.value === 'finance') {
                updateFinanceUploadList();
            }
        }
        });

        document.addEventListener('DOMContentLoaded', function() {
            const spinner = document.getElementById('processing-spinner');
            const mainForm = document.querySelector('form');
            if (mainForm) {
                mainForm.addEventListener('submit', () => {
                    spinner?.classList?.add('visible');
                });
            }

            // Smooth scroll to results when they appear (if results exist on page load)
            const resultsSection = document.getElementById('results-section');
            if (resultsSection) {
                setTimeout(() => {
                    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        });
    </script>
</body>
</html>
"""

# --- HELPER FUNCTIONS ---
def format_currency(value):
    """Format a number as currency with dollar sign and commas"""
    if not value or value == "" or value == "N/A":
        return ""
    try:
        # Try to convert to float
        num_value = float(str(value))
        # Format with dollar sign, commas, and 2 decimal places
        return f"${num_value:,.2f}"
    except (ValueError, TypeError):
        # If conversion fails, return as is
        return str(value) if value else ""

def detect_low_confidence(text):
    """
    Detect low confidence text patterns that indicate OCR errors, garbled text, or incomplete extraction.
    Returns a confidence level: 'high', 'medium', or 'low'
    """
    if not text or text == "N/A":
        return 'high'  # N/A is expected, not an error
    
    text_str = str(text).strip()
    if len(text_str) < 3:
        return 'high'  # Short text is usually fine
    
    # Check for garbled text (excessive spaces between characters)
    # Pattern: "H H o o t l d d" - characters separated by spaces
    words = text_str.split()
    if len(words) > len(text_str) * 0.4:  # More than 40% of chars are word separators
        # Check if it looks like garbled OCR (many single-character "words")
        single_char_words = sum(1 for w in words if len(w) == 1)
        if single_char_words > len(words) * 0.3:  # More than 30% are single characters
            return 'low'
    
    # Check for incomplete text (starts with bracket but doesn't close, or truncated)
    if text_str.startswith('[') and not text_str.endswith(']'):
        # Check if it looks truncated (ends abruptly)
        if len(text_str) < 20 or text_str.endswith(' sta') or text_str.endswith(' sta '):
            return 'low'
    
    # Check for excessive mixed case inappropriately (OCR error pattern)
    # Pattern like "H H o o t l d d i 4 p O m g m"
    if len(text_str) > 10:
        alternating_case = sum(1 for i in range(len(text_str)-1) 
                              if text_str[i].isupper() != text_str[i+1].isupper())
        if alternating_case > len(text_str) * 0.6:  # More than 60% case changes
            return 'low'
    
    # Check for repeated characters with spaces (OCR splitting)
    # Pattern: "H H o o t l d d"
    if ' ' in text_str:
        chars_with_spaces = text_str.split()
        if len(chars_with_spaces) > 5:
            # Check if many are single characters
            single_chars = sum(1 for c in chars_with_spaces if len(c) == 1)
            if single_chars > len(chars_with_spaces) * 0.4:
                return 'low'
    
    # Check for incomplete words (common OCR truncation patterns)
    incomplete_patterns = [' sta ', ' sta', ' coffe', ' handwrit', ' delet']
    for pattern in incomplete_patterns:
        if pattern in text_str.lower():
            return 'low'
    
    return 'high'

def correct_ocr_errors(value_str, field_name, context_entries=None):
    """
    Actually correct common OCR character substitution errors.
    Returns corrected value and confidence level.
    """
    if not value_str or value_str == "N/A":
        return value_str, 'high'
    
    original = value_str
    corrected = value_str
    confidence = 'high'
    
    # Common OCR substitutions: 3↔7, 0↔O, 1↔I, 5↔S, 8↔5
    if field_name == 'Size':
        # Universal Beams (UB) - correct 7→3 errors
        if 'UB' in corrected.upper():
            match = re.search(r'(\d+)UB(\d+)\.(\d+)', corrected)
            if match:
                prefix = match.group(1)
                middle = match.group(2)
                suffix = match.group(3)
                # If middle number starts with 7 and is 2 digits, likely should be 3
                if middle.startswith('7') and len(middle) == 2:
                    # Check context - if similar entries have 3x pattern, correct it
                    if context_entries:
                        similar_patterns = [e.get('Size', '') for e in context_entries 
                                          if 'UB' in e.get('Size', '').upper() and 
                                          e.get('Size', '').startswith(prefix)]
                        if similar_patterns:
                            # If other entries show 3x pattern, correct this one
                            if any('3' in p.split('UB')[1][:1] for p in similar_patterns):
                                corrected = corrected.replace(f'UB{middle}', f'UB3{middle[1:]}', 1)
                                confidence = 'medium'
        
        # Universal Columns (UC) - correct 8↔5, 1↔5 errors
        if 'UC' in corrected.upper():
            match = re.search(r'(\d+)UC(\d+)', corrected)
            if match:
                prefix = match.group(1)
                suffix = match.group(2)
                # Common UC sizes: 118, 137, 158, etc.
                # If we see 118, might be 158 (8→5) or 137 (1→3, 8→7)
                # If we see 108, might be 158 (0→5, 8→5)
                if suffix in ['118', '108']:
                    # Check context for common UC sizes
                    if context_entries:
                        similar_sizes = [e.get('Size', '') for e in context_entries 
                                        if 'UC' in e.get('Size', '').upper() and 
                                        e.get('Size', '').startswith(prefix)]
                        # If we see patterns like 158, 137 in context, likely correction
                        if any('158' in s or '137' in s for s in similar_sizes):
                            if suffix == '118':
                                # Could be 158 (8→5) or 137 (1→3, 8→7)
                                # Prefer 158 as more common
                                corrected = corrected.replace('UC118', 'UC158', 1)
                                confidence = 'medium'
                            elif suffix == '108':
                                corrected = corrected.replace('UC108', 'UC158', 1)
                                confidence = 'medium'
        
        # Welded Beams (WB) - correct format errors
        if 'WB' in corrected.upper():
            # Pattern: "WB 610 x 27" or "WB 612.200" → should be "WB1220×6.0"
            # This is complex - need to understand the actual values
            # For now, flag but don't auto-correct (too risky)
            pass
    
    return corrected, confidence

def detect_ocr_character_errors(value_str, field_name):
    """
    Detect common OCR character substitution errors.
    Returns list of potential corrections.
    """
    errors = []
    
    # Common OCR substitutions: 3↔7, 0↔O, 1↔I, 5↔S, 8↔5, 6↔0
    # Check for suspicious patterns in size fields
    if field_name == 'Size':
        # Universal Beams (UB) pattern: "250UB77.2" where 77 might be 37 (3→7 error)
        if 'UB' in value_str.upper():
            match = re.search(r'(\d+)UB(\d+)\.(\d+)', value_str)
            if match:
                prefix = match.group(1)
                middle = match.group(2)
                suffix = match.group(3)
                # If middle number is 77, 70, 73, etc., might be 37, 30, 33
                if middle.startswith('7') and len(middle) == 2:
                    potential = middle.replace('7', '3', 1)
                    errors.append(f"Possible OCR error: '{value_str}' might be '{prefix}UB{potential}.{suffix}' (7→3 substitution)")
        
        # Universal Columns (UC) pattern: "310UC118" where 118 might be 158 (8→5 error, or 1→5)
        if 'UC' in value_str.upper():
            match = re.search(r'(\d+)UC(\d+)', value_str)
            if match:
                prefix = match.group(1)
                suffix = match.group(2)
                # Check for suspicious patterns: 118 (might be 158), 108 (might be 158)
                if suffix in ['118', '108', '128']:
                    # Common UC sizes: 158, 137, etc. - flag for review
                    errors.append(f"Possible OCR error in UC size: '{value_str}' - verify suffix '{suffix}' (common substitutions: 8↔5, 0↔5)")
        
        # Welded Beams (WB) - check for wrong format patterns
        if 'WB' in value_str.upper():
            # Pattern like "WB 612.200" or "WB 610 x 27.2" - wrong format
            if re.search(r'WB\s*\d+\.\d+', value_str) or re.search(r'WB\s*\d+\s+x\s+\d+\.\d+', value_str):
                errors.append(f"Size format appears incorrect: '{value_str}' - welded beam should be format 'WB[depth]×[thickness]' (e.g., 'WB1220×6.0')")
    
    return errors

def validate_engineering_field(field_name, value, entry):
    """
    Validate engineering field values and detect critical errors.
    Returns a dict with 'confidence' and 'errors' list.
    """
    result = {'confidence': 'high', 'errors': []}
    
    if not value or value == "N/A":
        return result
    
    value_str = str(value).strip()
    
    # Note: Grade validation is handled in validate_engineering_field function
    # Don't duplicate validation here to avoid duplicate error messages
    
    # Check for OCR character errors in Size field
    if field_name == 'Size':
        ocr_errors = detect_ocr_character_errors(value_str, field_name)
        if ocr_errors:
            result['errors'].extend(ocr_errors)
            result['confidence'] = 'low'
    
    # Validate Length field
    if field_name == 'Length':
        # Check for obvious OCR errors like "3/2 mm" instead of "4200 mm"
        if '/' in value_str and 'mm' in value_str:
            # Pattern like "3/2 mm" is likely an OCR error
            result['errors'].append(f"Length appears to be OCR error: '{value_str}' (likely should be a 4-digit number)")
            result['confidence'] = 'low'
        
        # Check if length is a reasonable number (typically 2-6 digits, but allow flexibility)
        numbers = re.findall(r'\d+', value_str)
        if numbers:
            main_number = numbers[0]
            # Only flag if extremely unusual (too short or suspiciously long)
            if len(main_number) < 2 or len(main_number) > 6:
                result['errors'].append(f"Length number '{main_number}' seems unusual - please verify")
                if result['confidence'] == 'high':
                    result['confidence'] = 'medium'
        
        # Check for missing units
        if 'mm' not in value_str.lower() and 'm' not in value_str.lower():
            result['errors'].append(f"Length missing units: '{value_str}'")
            if result['confidence'] == 'high':
                result['confidence'] = 'medium'
    
    # Validate Quantity field
    elif field_name == 'Qty':
        try:
            qty = int(value_str)
            # Only flag if extremely unusual (negative or suspiciously high)
            if qty < 1:
                result['errors'].append(f"Quantity '{qty}' is less than 1 - please verify")
                result['confidence'] = 'low'
            elif qty > 200:  # Increased threshold, flag only very high values
                result['errors'].append(f"Quantity '{qty}' seems unusually high - please verify")
                if result['confidence'] == 'high':
                    result['confidence'] = 'medium'
            # Flag quantity of 1 for special attention (often correct, but sometimes misread)
            # This is a soft flag - quantity of 1 is valid, but worth double-checking
            elif qty == 1:
                # Check if this is a structural member that might typically come in pairs
                # This is a heuristic - we can't be certain, but it's worth flagging for review
                mark = entry.get('Mark', '')
                size = entry.get('Size', '')
                # If it's a beam/column that might be duplicated, flag for verification
                if mark and (mark.startswith('B') or mark.startswith('C') or mark.startswith('NB')):
                    # Don't add error, but we could add a note - actually, let's be conservative
                    # Only flag if there are other issues too
                    pass
        except ValueError:
            result['errors'].append(f"Quantity is not a valid number: '{value_str}'")
            result['confidence'] = 'low'
    
    # Validate Grade field
    elif field_name == 'Grade':
        # Check for obvious OCR errors (very specific patterns that are clearly wrong)
        suspicious_patterns = {
            'JSO': 'likely OCR error for HA350',
            'JS0': 'likely OCR error for HA350',
            'J50': 'likely OCR error for HA350',
            'J5O': 'likely OCR error for HA350'
        }
        if value_str.upper() in suspicious_patterns:
            result['errors'].append(f"Grade '{value_str}' appears to be OCR error ({suspicious_patterns[value_str.upper()]}) - please verify")
            result['confidence'] = 'low'
        
        # Grade should NOT be a decimal number (that's likely size data misaligned)
        if re.match(r'^\d+\.\d+$', value_str):
            result['errors'].append(f"Grade '{value_str}' appears to be a number (likely misaligned from Size column) - please verify column alignment")
            result['confidence'] = 'low'
        # Note: "300" as a standalone number IS a valid steel grade designation (Grade 300 steel)
        # Don't flag it - only flag decimal numbers which are clearly wrong
        
        # Only flag if format is completely invalid (contains invalid characters)
        # Allow alphanumeric, spaces, hyphens, periods, slashes (for standards like AS/NZS)
        if not re.match(r'^[A-Z0-9/\s\-\.]+$', value_str.upper()):
            result['errors'].append(f"Grade format seems unusual: '{value_str}' - please verify")
            if result['confidence'] == 'high':
                result['confidence'] = 'medium'
    
    # Validate Size field
    elif field_name == 'Size':
        # Check for OCR character errors first
        ocr_errors = detect_ocr_character_errors(value_str, field_name)
        if ocr_errors:
            result['errors'].extend(ocr_errors)
            result['confidence'] = 'low'
        
        # Only flag obvious format issues, not variations in valid formats
        # Welded beams can have various formats: "WB1220×6.0", "WB 1220 x 6.0", "WB1220 x 6.0", etc.
        if 'WB' in value_str.upper():
            # Check for very suspicious patterns (e.g., "WB86 x 122" where first number is tiny)
            numbers = re.findall(r'\d+', value_str)
            
            # Pattern: "WB 612.200" or "WB 610 x 27.2" - wrong format (should be "WB1220×6.0")
            if re.search(r'WB\s*\d+\.\d+', value_str):
                result['errors'].append(f"Size format appears incorrect: '{value_str}' - welded beam should be format 'WB[depth]×[thickness]' (e.g., 'WB1220×6.0'), not 'WB[number].[number]'")
                result['confidence'] = 'low'
            elif len(numbers) >= 2:
                first_num = int(numbers[0])
                second_num = int(numbers[1])
                # Flag if format looks completely wrong (e.g., "WB 610 x 2 x 27.2" should be "WB1220×6.0")
                # Pattern: multiple small numbers suggests wrong format or column misalignment
                if len(numbers) >= 3:
                    # If we have 3+ numbers and they're all small, this is likely wrong
                    if all(int(n) < 1000 for n in numbers[:3]):
                        result['errors'].append(f"Size format appears incorrect: '{value_str}' - welded beam should be format like 'WB1220×6.0' (depth × thickness, typically 2 numbers). This may indicate column misalignment.")
                        result['confidence'] = 'low'
                    # If pattern is "WB [num] x [num] x [num]" with small numbers, definitely wrong
                    elif ' x ' in value_str or ' X ' in value_str:
                        parts = re.split(r'\s+[xX]\s+', value_str)
                        if len(parts) >= 3 and all(any(c.isdigit() for c in p) for p in parts[:3]):
                            result['errors'].append(f"Size format appears incorrect: '{value_str}' - welded beam format should be 'WB[depth]×[thickness]' (e.g., 'WB1220×6.0'), not multiple dimensions separated by 'x'")
                            result['confidence'] = 'low'
                # Pattern: "WB 610 x 27.2" (2 numbers, but wrong format)
                elif ' x ' in value_str or ' X ' in value_str:
                    if first_num < 1000 and second_num < 100:
                        result['errors'].append(f"Size format appears incorrect: '{value_str}' - welded beam should be 'WB[depth]×[thickness]' where depth is typically 600-2000mm and thickness is 4-20mm (e.g., 'WB1220×6.0')")
                        result['confidence'] = 'low'
                # Only flag if first number is suspiciously small AND second is large (likely reversed)
                elif first_num < 50 and second_num > 1000:
                    result['errors'].append(f"Size format may be incorrect: '{value_str}' (dimensions may be reversed - please verify)")
                    result['confidence'] = 'low'
        
        # Don't flag missing separators - many valid formats don't use × (e.g., "460UB82.1")
        # Only check if it's clearly malformed (multiple numbers with no separator and no context)
        if re.search(r'\d+\s+\d+\s+\d+', value_str) and '×' not in value_str and 'x' not in value_str.lower() and 'UB' not in value_str.upper() and 'UC' not in value_str.upper():
            result['errors'].append(f"Size format may need verification: '{value_str}'")
            if result['confidence'] == 'high':
                result['confidence'] = 'medium'
    
    # Validate Comments field for wrong content
    elif field_name == 'Comments':
        # Check for wrong references (e.g., "NZS 4680 strap" when should be "40mm grout")
        # This is harder to detect automatically, but we can flag suspicious patterns
        if 'NZS 4680' in value_str and 'strap' in value_str.lower():
            # This might be wrong if context suggests grout
            result['errors'].append(f"Comment references NZS 4680 strap - verify this is correct for this member")
            if result['confidence'] == 'high':
                result['confidence'] = 'medium'
    
    return result

def extract_text(file_obj):
    """
    Extract text from PDF files.
    For images, returns a special marker that indicates the file should be sent directly to Gemini vision API.
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

def analyze_gemini(text, doc_type, image_path=None):
    """Call Gemini with a doc-type-specific prompt and return entries, error, model used, attempt log, action log, and schedule_type.
    
    Args:
        text: Text content or [IMAGE_FILE:path] marker
        doc_type: Document type (engineering, finance, transmittal)
        image_path: Optional path to image file for vision processing
    """
    # For engineering, we'll detect schedule type from returned data
    if doc_type == "engineering":
        fields = ENGINEERING_BEAM_FIELDS  # Default, will detect if column schedule
    else:
        fields = DOC_FIELDS.get(doc_type, FINANCE_FIELDS)
    error_field = ERROR_FIELD.get(doc_type, fields[-1])

    def error_entry(message):
        return {
            field: (message if field == error_field else "AI Error")
            for field in fields
        }

    if not api_key:
        return [error_entry("MISSING API KEY")], "MISSING API KEY", None, [], [], None

    # Check if this is an image file marker
    if text and text.startswith("[IMAGE_FILE:"):
        image_path = text.replace("[IMAGE_FILE:", "").rstrip("]")
        if not os.path.exists(image_path):
            return [error_entry(f"Image file not found: {image_path}")], f"Image file not found: {image_path}", None, [], [], None
        text = None  # Will use image instead
    
    if not text and not image_path:
        return [error_entry("No content provided for analysis")], "No content provided for analysis", None, [], [], None
    
    if text and text.startswith("Error:"):
        return [error_entry(f"Text extraction failed: {text}")], f"Text extraction failed: {text}", None, [], [], None

    available_models = get_available_models()
    stable_preferred = ['gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-pro-latest']
    model_names = []
    action_log = []
    
    action_log.append(f"Model selection: Checking {len(available_models) if available_models else 0} available models")
    action_log.append(f"Preferred order: {', '.join(stable_preferred)}")
    
    if available_models and len(available_models) > 0:
        # Prefer stable GA models in defined order
        model_names = [m for m in stable_preferred if m in available_models]
        if model_names:
            action_log.append(f"Found {len(model_names)} preferred model(s): {', '.join(model_names)}")
        if not model_names:
            # Expand to include any available model that contains the GA name
            preview_candidates = []
            for preferred in stable_preferred:
                for m in available_models:
                    if preferred in m and m not in preview_candidates:
                        preview_candidates.append(m)
            if preview_candidates:
                model_names = preview_candidates
                action_log.append(f"Using preview variants: {', '.join(model_names)}")
        if not model_names:
            legacy = [m for m in available_models if m.startswith("gemini-1.5")]
            if legacy:
                model_names = legacy[:2]
                action_log.append(f"Falling back to legacy models: {', '.join(model_names)}")
        if not model_names:
            model_names = available_models[:2]
            action_log.append(f"Using first available models: {', '.join(model_names)}")
        print(f"Using available models from API: {model_names}")
    else:
        model_names = stable_preferred
        action_log.append(f"API listing failed, using fallback: {', '.join(model_names)}")
        print(f"Using fallback models (API listing failed): {model_names}")

    prompt_limit = (
        ENGINEERING_PROMPT_LIMIT if doc_type == "engineering"
        else TRANSMITTAL_PROMPT_LIMIT if doc_type == "transmittal"
        else None
    )
    # For images, we still need prompt text (empty string is fine, prompt will be built)
    prompt_text = prepare_prompt_text(text or "", doc_type, prompt_limit) if text else ""
    prompt = build_prompt(prompt_text, doc_type)
    if prompt_limit:
        action_log.append(f"Prompt truncated to {prompt_limit} characters for {doc_type} document")
    last_error = None
    response = None
    resolved_model = None
    attempt_log = []

    for model_name in model_names:
        for attempt in range(3):
            attempt_detail = {
                "model": model_name,
                "attempt": attempt + 1,
                "status": "pending",
                "message": ""
            }
            action_log.append(f"Trying {model_name} (Attempt {attempt + 1})")
            try:
                print(f"Trying model: {model_name}")
                model = genai.GenerativeModel(model_name)
                # Use longer timeout for engineering (large PDFs), shorter for others
                timeout_seconds = 60 if doc_type == "engineering" else 30
                
                # Prepare content for Gemini
                if image_path:
                    # Use Gemini vision API for images
                    import pathlib
                    from PIL import Image
                    image_file = pathlib.Path(image_path)
                    if not image_file.exists():
                        attempt_detail["status"] = "error"
                        attempt_detail["message"] = f"Image file not found: {image_path}"
                        action_log.append(f"✗ Image file not found: {image_path}")
                        continue
                    
                    # Open image and convert to format Gemini expects
                    try:
                        img = Image.open(image_path)
                        # Create content with image and prompt - Gemini accepts PIL Image objects
                        content_parts = [img, prompt]
                        response = model.generate_content(content_parts, request_options={"timeout": timeout_seconds})
                        action_log.append(f"✓ Vision API call succeeded with {model_name}")
                    except Exception as img_error:
                        attempt_detail["status"] = "error"
                        attempt_detail["message"] = f"Failed to open image: {img_error}"
                        action_log.append(f"✗ Failed to open image: {img_error}")
                        continue
                else:
                    # Regular text-based processing
                    response = model.generate_content(prompt, request_options={"timeout": timeout_seconds})
                    action_log.append(f"✓ API call succeeded with {model_name}")
                
                resolved_model = model_name

                if not response or not hasattr(response, 'text') or not response.text:
                    print(f"Error: Empty response from Gemini API with model {model_name}")
                    attempt_detail["status"] = "no_response"
                    attempt_detail["message"] = "Empty response"
                    attempt_log.append(attempt_detail)
                    action_log.append(f"Empty response from {model_name}")
                    continue

                clean_json = response.text.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(clean_json)
                
                # Handle different return structures
                if doc_type == "transmittal":
                    # Transmittal returns a single object with multiple arrays
                    entries = [parsed] if isinstance(parsed, dict) else parsed if isinstance(parsed, list) else []
                else:
                    entries = parsed if isinstance(parsed, list) else [parsed] if isinstance(parsed, dict) else []

                # Detect schedule type for engineering documents
                schedule_type = None
                if doc_type == "engineering" and entries:
                    first_entry = entries[0] if isinstance(entries[0], dict) else {}
                    # Check if it's a column schedule (has SectionType, BasePlate, or CapPlate)
                    if "SectionType" in first_entry or "BasePlate" in first_entry or "CapPlate" in first_entry:
                        fields = ENGINEERING_COLUMN_FIELDS
                        schedule_type = "column"
                        action_log.append("Detected COLUMN schedule type")
                    else:
                        fields = ENGINEERING_BEAM_FIELDS
                        schedule_type = "beam"
                        action_log.append("Detected BEAM schedule type")
                    error_field = ERROR_FIELD.get(doc_type, fields[-1])
                    
                    # Validate fields for engineering
                    for entry in entries:
                        for field in fields:
                            entry.setdefault(field, "N/A")
                elif doc_type == "transmittal":
                    # For transmittal, ensure required keys exist
                    for entry in entries:
                        if isinstance(entry, dict):
                            for key in ['DrawingRegister', 'Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                                if key not in entry:
                                    entry[key] = [] if key != 'DrawingRegister' else {}

                if entries:
                    attempt_detail["status"] = "success"
                    attempt_detail["message"] = f"Extracted {len(entries)} row(s)"
                    attempt_log.append(attempt_detail)
                    print(f"Successfully extracted {len(entries)} rows with {model_name} for {doc_type}")
                    action_log.append(f"Success with {model_name}: extracted {len(entries)} row(s)")
                    return entries, None, resolved_model, attempt_log, action_log, schedule_type

                attempt_detail["status"] = "no_data"
                attempt_detail["message"] = "No structured data returned"
                attempt_log.append(attempt_detail)
                last_error = "No structured data returned"
                action_log.append(f"No structured data returned from {model_name}")
                continue

            except json.JSONDecodeError as e:
                print(f"JSON Parse Error with {model_name}: {e}")
                response_text = response.text if response and hasattr(response, 'text') else 'No response'
                print(f"Response text: {response_text}")
                last_error = f"JSON parse error: {str(e)}"
                attempt_detail["status"] = "json_error"
                attempt_detail["message"] = str(e)
                attempt_log.append(attempt_detail)
                action_log.append(f"JSON parse error for {model_name}: {str(e)}")
                continue

            except (TimeoutError,) + ((grpc.RpcError,) if grpc else ()) as e:
                error_type = type(e).__name__
                error_msg = str(e)
                print(f"Gemini timeout/error with {model_name}: {error_type}: {error_msg}")
                
                # For timeouts, try shortening prompt once, then move to next model
                is_timeout = "DeadlineExceeded" in error_msg or "504" in error_msg or "timeout" in error_msg.lower() or isinstance(e, TimeoutError)
                
                if is_timeout and doc_type == "engineering" and prompt_limit == ENGINEERING_PROMPT_LIMIT and attempt == 0:
                    # First attempt timeout - shorten prompt and retry once
                    prompt_limit = ENGINEERING_PROMPT_LIMIT_SHORT
                    prompt_text = prepare_prompt_text(text, doc_type, prompt_limit)
                    prompt = build_prompt(prompt_text, doc_type)
                    action_log.append(f"Timeout detected - shortening prompt to {prompt_limit} chars and retrying {model_name}")
                    time.sleep(2)  # Brief delay before retry
                    continue
                
                attempt_detail["status"] = "error"
                attempt_detail["message"] = f"{error_type}: {error_msg}"
                attempt_log.append(attempt_detail)
                action_log.append(f"{model_name} (Attempt {attempt + 1}) error: {error_type}: {error_msg}")
                
                # For timeouts, move to next model immediately (don't retry same model)
                if is_timeout:
                    action_log.append(f"Timeout on {model_name} - moving to next model (timeouts indicate model overload)")
                    last_error = f"{error_type}: {error_msg}"
                    break
                
                # For other errors, retry with backoff
                if attempt < 2:
                    backoff_delay = 2 ** attempt
                    action_log.append(f"Waiting {backoff_delay} second(s) before retry (exponential backoff)")
                    time.sleep(backoff_delay)
                    continue
                action_log.append(f"All retries exhausted for {model_name}, trying next model")
                last_error = f"{error_type}: {error_msg}"
                break

            except Exception as e:
                error_type = type(e).__name__
                error_msg = str(e)
                print(f"Gemini API Error with {model_name}: {error_type}: {error_msg}")
                is_not_found = (
                    'NotFound' in error_type or
                    '404' in error_msg or
                    'not found' in error_msg.lower() or
                    (google_exceptions and isinstance(e, google_exceptions.NotFound))
                )
                attempt_detail["status"] = "error"
                attempt_detail["message"] = f"{error_type}: {error_msg}"
                attempt_log.append(attempt_detail)
                action_log.append(f"{model_name} (Attempt {attempt + 1}) error: {error_type}: {error_msg}")
                if is_not_found and attempt < 2:
                    backoff_delay = 2 ** attempt
                    action_log.append(f"Model not found, waiting {backoff_delay} second(s) before retry")
                    time.sleep(backoff_delay)
                    continue
                last_error = f"API error: {error_type} - {error_msg}"
                action_log.append(f"All retries exhausted for {model_name}, trying next model")
                break
        else:
            continue
        break

    action_log.append(f"✗ All models failed for this document: {last_error or 'Unknown error'}")
    return [error_entry(last_error or "All models failed")], last_error or "All models failed", resolved_model, attempt_log, action_log, None

# --- ROUTES ---
# Serve static assets (CSS, JS, images)
@app.route('/assets/<path:filename>')
def assets(filename):
    return send_from_directory('assets', filename)

# Serve invoice PDFs
@app.route('/invoices/<path:filename>')
def invoices(filename):
    return send_from_directory('invoices', filename)

# Serve drawing PDFs
@app.route('/drawings/<path:filename>')
def drawings(filename):
    return send_from_directory('drawings', filename)

# Serve static website files
@app.route('/homepage')
@app.route('/homepage.html')
def homepage():
    try:
        return send_file('homepage.html')
    except:
        return "Homepage not found.", 404

@app.route('/contact')
@app.route('/contact.html')
def contact_page():
    try:
        return send_file('contact.html')
    except:
        return "Contact page not found.", 404

@app.route('/about')
@app.route('/about.html')
def about_page():
    try:
        return send_file('about.html')
    except:
        return "About page not found.", 404

@app.route('/search')
@app.route('/search.html')
def search_page():
    """Serve the RAG Search Demo page"""
    try:
        return send_file('search.html')
    except:
        return "Search page not found.", 404

@app.route('/services')
@app.route('/services.html')
def services_page():
    try:
        return send_file('services.html')
    except:
        return "Services page not found.", 404

@app.route('/faq')
@app.route('/faq.html')
def faq_page():
    try:
        return send_file('faq.html')
    except:
        return "FAQ page not found.", 404

@app.route('/target-markets')
@app.route('/target-markets.html')
def target_markets():
    try:
        return send_file('target-markets.html')
    except:
        return "Target Markets page not found.", 404

@app.route('/accounting')
@app.route('/accounting.html')
@app.route('/industries/accounting.html')
def accounting_page():
    try:
        return send_file('industries/accounting.html')
    except:
        return "Accounting page not found.", 404

@app.route('/professional-services')
@app.route('/professional-services.html')
def professional_services_page():
    try:
        return send_file('professional-services.html')
    except:
        return "Professional Services page not found.", 404

@app.route('/logistics-compliance')
@app.route('/logistics-compliance.html')
def logistics_compliance_page():
    try:
        return send_file('logistics-compliance.html')
    except:
        return "Logistics Compliance page not found.", 404

@app.route('/built-environment')
@app.route('/built-environment.html')
def built_environment_page():
    try:
        return send_file('built-environment.html')
    except:
        return "Built Environment page not found.", 404

@app.route('/legal-services')
@app.route('/legal-services.html')
@app.route('/industries/legal-services.html')
def legal_services_page():
    try:
        return send_file('industries/legal-services.html')
    except:
        return "Legal Services page not found.", 404

@app.route('/wealth-management')
@app.route('/wealth-management.html')
@app.route('/industries/wealth-management.html')
def wealth_management_page():
    try:
        return send_file('industries/wealth-management.html')
    except:
        return "Wealth Management page not found.", 404

@app.route('/insurance-underwriting')
@app.route('/insurance-underwriting.html')
@app.route('/industries/insurance-underwriting.html')
def insurance_underwriting_page():
    try:
        return send_file('industries/insurance-underwriting.html')
    except:
        return "Insurance Underwriting page not found.", 404

@app.route('/logistics-freight')
@app.route('/logistics-freight.html')
@app.route('/logistics')
@app.route('/logistics.html')
@app.route('/industries/logistics-freight.html')
def logistics_freight_page():
    try:
        return send_file('industries/logistics-freight.html')
    except:
        return "Logistics & Freight page not found.", 404

@app.route('/healthcare-admin')
@app.route('/healthcare-admin.html')
@app.route('/healthcare')
@app.route('/healthcare.html')
@app.route('/industries/healthcare-admin.html')
def healthcare_admin_page():
    try:
        return send_file('industries/healthcare-admin.html')
    except:
        return "Healthcare Admin page not found.", 404

@app.route('/government-contractors')
@app.route('/government-contractors.html')
@app.route('/government')
@app.route('/government.html')
@app.route('/industries/government-contractors.html')
def government_contractors_page():
    try:
        return send_file('industries/government-contractors.html')
    except:
        return "Government Contractors page not found.", 404

@app.route('/construction')
@app.route('/construction.html')
@app.route('/industries/construction.html')
def construction_page():
    try:
        return send_file('industries/construction.html')
    except:
        return "Construction page not found.", 404

@app.route('/architecture')
@app.route('/architecture.html')
@app.route('/industries/architecture.html')
def architecture_page():
    try:
        return send_file('industries/architecture.html')
    except:
        return "Architecture page not found.", 404

@app.route('/engineering')
@app.route('/engineering.html')
@app.route('/industries/engineering.html')
def engineering_page():
    try:
        return send_file('industries/engineering.html')
    except:
        return "Engineering page not found.", 404

@app.route('/mining-services')
@app.route('/mining-services.html')
@app.route('/mining')
@app.route('/mining.html')
@app.route('/industries/mining-services.html')
def mining_services_page():
    try:
        return send_file('industries/mining-services.html')
    except:
        return "Mining Services page not found.", 404

@app.route('/property-management')
@app.route('/property-management.html')
@app.route('/property')
@app.route('/property.html')
@app.route('/industries/property-management.html')
def property_management_page():
    try:
        return send_file('industries/property-management.html')
    except:
        return "Property Management page not found.", 404

@app.route('/case-study')
@app.route('/case-study.html')
def case_study_page():
    try:
        return send_file('case-study.html')
    except:
        return "Case study page not found.", 404

@app.route('/search-results')
@app.route('/search-results.html')
def search_results_page():
    try:
        return send_file('search-results.html')
    except:
        return "Search results page not found.", 404

def extract_text_from_html(file_path):
    """
    Extract text content from an HTML file.
    Returns dict with title, content, and filename.
    """
    import re
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        # Extract title from <title> tag or first <h1>
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else ''
        # Clean title HTML entities
        title = re.sub('<[^<]+?>', '', title)
        title = re.sub(r'\s+', ' ', title).strip()
        
        # Extract content from <main>, <article>, or <body>
        # Try main first, then article, then body
        content_match = None
        for tag in ['<main', '<article', '<body']:
            pattern = rf'{tag}[^>]*>(.*?)</(?:main|article|body)>'
            match = re.search(pattern, html_content, re.IGNORECASE | re.DOTALL)
            if match:
                content_match = match
                break
        
        if not content_match:
            # Fallback: extract from body if no main/article
            body_match = re.search(r'<body[^>]*>(.*?)</body>', html_content, re.IGNORECASE | re.DOTALL)
            if body_match:
                content_html = body_match.group(1)
            else:
                content_html = html_content
        else:
            content_html = content_match.group(1)
        
        # Remove script and style tags completely
        content_html = re.sub(r'<script[^>]*>.*?</script>', '', content_html, flags=re.IGNORECASE | re.DOTALL)
        content_html = re.sub(r'<style[^>]*>.*?</style>', '', content_html, flags=re.IGNORECASE | re.DOTALL)
        
        # Remove HTML tags
        content_clean = re.sub('<[^<]+?>', '', content_html)
        
        # Remove extra whitespace and newlines
        content_clean = re.sub(r'\s+', ' ', content_clean).strip()
        
        # Get filename for link
        filename = os.path.basename(file_path)
        
        return {
            'title': title or filename.replace('.html', '').replace('-', ' ').title(),
            'content': content_clean,
            'link': f'/{filename}',
            'filename': filename
        }
    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
        return None

def calculate_authority_score(source_type, title, content, date_str, query, query_words):
    """
    Calculate an authority score for a source (0-100).
    Higher score = more authoritative/relevant.
    Prioritizes content depth and quality over title optimization.
    """
    from datetime import datetime
    import re
    
    score = 0
    
    # Base score by source type
    if source_type == 'website':
        score += 50  # Protocol pages are more authoritative
    else:  # blog
        score += 30  # Blog posts are less authoritative but still valuable
    
    # Prepare text for analysis
    title_lower = title.lower()
    content_lower = content.lower()
    query_lower = query.lower()
    
    # 1. CONTENT DEPTH SCORING (NEW - prioritizes substance)
    # Count how many times query keywords appear in content
    content_keyword_count = 0
    for word in query_words:
        content_keyword_count += content_lower.count(word)
    
    # Award points for content depth (capped at +15)
    content_depth_score = min(content_keyword_count * 2, 15)
    score += content_depth_score
    
    # 2. TITLE RELEVANCE (REDUCED weight to avoid clickbait favoritism)
    title_keyword_count = 0
    for word in query_words:
        if word in title_lower:
            score += 3  # Reduced from 5
            title_keyword_count += 1
    
    if query_lower in title_lower:
        score += 6  # Reduced from 10 (exact phrase match)
    
    # 3. CONTENT-TO-TITLE RATIO (NEW - rewards substance over headline optimization)
    if content_keyword_count > title_keyword_count and content_keyword_count >= 3:
        score += 5  # Bonus for articles that discuss topic in depth, not just headline
    
    # 4. ENHANCED CONTENT QUALITY (Better gradations for comprehensive articles)
    content_length = len(content)
    if content_length > 1000:
        score += 3   # Basic article
    if content_length > 2000:
        score += 5   # Substantial content
    if content_length > 5000:
        score += 8   # Very detailed content
    if content_length > 10000:
        score += 12  # Comprehensive, in-depth article
    
    # 5. RECENCY BONUS (for blog posts only)
    if date_str and source_type == 'blog':
        try:
            post_date = datetime.strptime(date_str.split('T')[0], '%Y-%m-%d')
            days_old = (datetime.now() - post_date).days
            if days_old < 30:
                score += 10  # Very recent
            elif days_old < 90:
                score += 7   # Recent
            elif days_old < 180:
                score += 5   # Fairly recent
            elif days_old < 365:
                score += 3   # Within last year
        except:
            pass
    
    # Cap at 100
    return min(score, 100)


def search_static_html_pages(query):
    """
    Search static HTML pages in the current directory.
    Returns list of relevant pages with extracted content.
    """
    import re
    
    # Pages to exclude from search (navigation, includes, generic pages, etc.)
    excluded_pages = {
        'navbar.html', 'embed_snippet.html', 'index.html',  # index.html typically redirects
        'sitemap.html',  # Sitemap is not content
        'search-results.html',  # Search results page itself
        'search.html',  # Search demo page
        'about.html',  # Generic about page (rarely relevant to specific queries)
        'contact.html',  # Contact form
        'homepage.html',  # Homepage (too generic)
        'services.html'  # Services overview (too generic)
    }
    
    # Get all HTML files in the root directory
    html_files = []
    root_dir = os.path.dirname(os.path.abspath(__file__))
    
    for filename in os.listdir(root_dir):
        if filename.endswith('.html') and filename not in excluded_pages:
            html_files.append(os.path.join(root_dir, filename))
    
    # Extract content from all HTML files
    pages = []
    for file_path in html_files:
        page_data = extract_text_from_html(file_path)
        if page_data and page_data['content']:
            pages.append(page_data)
    
    if not pages:
        return []
    
    # Rank pages by relevance
    query_lower = query.lower()
    stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
    query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
    
    if not query_words:
        query_words = set(query_lower.split())
    
    def calculate_page_relevance(page):
        score = 0
        title = page.get('title', '').lower()
        content = page.get('content', '').lower()
        filename = page.get('filename', '').lower()
        
        # Title matches are most important
        for word in query_words:
            if word in title:
                score += 10
            if word in filename:
                score += 8
            if word in content:
                score += 1
        
        # Exact phrase match bonus
        if query_lower in title:
            score += 20
        if query_lower in content:
            score += 5
        
        return score
    
    # Sort by relevance
    ranked_pages = sorted(pages, key=calculate_page_relevance, reverse=True)
    
    # Filter out pages with low relevance (require minimum score of 10)
    # This ensures we only return pages that have meaningful matches
    MINIMUM_SCORE = 10  # Require at least one title/filename match, or phrase match in content
    relevant_pages = [p for p in ranked_pages if calculate_page_relevance(p) >= MINIMUM_SCORE][:5]
    
    # Log results for debugging
    if relevant_pages:
        print(f"Static HTML search for '{query}' found {len(relevant_pages)} pages:")
        for p in relevant_pages[:3]:
            score = calculate_page_relevance(p)
            print(f"  - {p.get('filename', 'unknown')} (score: {score})")
    
    return relevant_pages

@app.route('/api/search-blog', methods=['POST'])
def search_blog_rag():
    """
    RAG Search: Fetches blog content from www.curam-ai.com.au and static HTML pages,
    then uses Gemini to generate answers.
    """
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Step 1: Fetch blog content from WordPress REST API
        # Try primary URL first, fallback to www subdomain if needed
        blog_urls = [
            'https://curam-ai.com.au',      # Primary (no www)
            'https://www.curam-ai.com.au'   # Fallback (with www)
        ]
        
        blog_url = None
        wp_api_url = None
        
        # Test which blog URL is accessible
        for test_url in blog_urls:
            try:
                test_response = requests.get(f'{test_url}/wp-json/wp/v2/posts', 
                                            params={'per_page': 1}, 
                                            timeout=5)
                if test_response.status_code == 200:
                    blog_url = test_url
                    wp_api_url = f'{blog_url}/wp-json/wp/v2/posts'
                    print(f"✓ Blog URL accessible: {blog_url}")
                    break
            except requests.RequestException as e:
                print(f"✗ Blog URL failed: {test_url} - {str(e)[:100]}")
                continue
        
        # If neither URL works, return error
        if not blog_url:
            return jsonify({
                'error': 'Unable to reach blog API',
                'answer': 'The blog is currently unavailable. Please try again later or contact us directly.',
                'sources': [],
                'query': query
            }), 503
        
        posts = []
        try:
            # Try multiple search strategies to get most relevant posts
            all_posts = []
            
            # Strategy 1: Search in WordPress API (searches title, content, excerpt)
            try:
                response = requests.get(wp_api_url, params={
                    'per_page': 50, 
                    'search': query,
                    '_fields': 'id,title,content,excerpt,link'
                }, timeout=10)
                if response.status_code == 200:
                    search_results = response.json()
                    if search_results:
                        all_posts.extend(search_results)
            except Exception as e:
                print(f"WordPress search API error: {e}")
                pass
            
            # Strategy 2: Fetch recent posts as backup (WordPress search can be unreliable)
            # Fetch multiple pages to get more content
            try:
                pages_to_fetch = 3  # Fetch 3 pages = 300 posts
                for page in range(1, pages_to_fetch + 1):
                    response = requests.get(wp_api_url, params={
                        'per_page': 100,  # Maximum allowed by WordPress
                        '_fields': 'id,title,content,excerpt,link',
                        'orderby': 'date',
                        'order': 'desc',
                        'page': page
                    }, timeout=15)
                    if response.status_code == 200:
                        page_posts = response.json()
                        if not page_posts:  # No more posts
                            break
                        # Merge with existing, avoiding duplicates
                        existing_ids = {p.get('id') for p in all_posts}
                        for post in page_posts:
                            if post.get('id') not in existing_ids:
                                all_posts.append(post)
                    else:
                        print(f"WordPress API returned status {response.status_code} for page {page}")
                        break
                print(f"Fetched {len(all_posts)} total posts for query: {query}")
            except Exception as e:
                print(f"WordPress recent posts API error: {e}")
                pass
            
            # Rank posts by relevance (simple keyword matching)
            query_lower = query.lower()
            # Remove common stop words for better matching
            stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
            query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
            
            # If all words were stop words, use original query
            if not query_words:
                query_words = set(query_lower.split())
            
            def calculate_relevance(post):
                score = 0
                title = post.get('title', {}).get('rendered', '').lower()
                excerpt = post.get('excerpt', {}).get('rendered', '').lower()
                content = post.get('content', {}).get('rendered', '').lower()
                
                # Title matches are most important
                for word in query_words:
                    if word in title:
                        score += 10
                    if word in excerpt:
                        score += 5
                    if word in content:
                        score += 1
                
                # Exact phrase match bonus
                if query_lower in title:
                    score += 20
                if query_lower in excerpt:
                    score += 10
                if query_lower in content:
                    score += 5
                
                return score
            
            # Sort by relevance and take top 5
            # Don't filter by score - even low scores might have relevant content
            posts_with_scores = [(p, calculate_relevance(p)) for p in all_posts]
            posts_with_scores.sort(key=lambda x: x[1], reverse=True)
            
            # Log top results for debugging
            print(f"Query: {query}")
            print(f"Query words after filtering: {query_words}")
            if posts_with_scores[:3]:
                print("Top 3 results:")
                for p, score in posts_with_scores[:3]:
                    title = p.get('title', {}).get('rendered', 'No title')
                    print(f"  - Score {score}: {title}")
            
            # Take top 5 posts (even with score 0, as they're still most relevant)
            posts = [p for p, score in posts_with_scores[:5]]
            
            # If top post has score 0, try a more lenient search
            if posts and posts_with_scores[0][1] == 0 and len(all_posts) > 5:
                print("Top post has 0 score, trying lenient search...")
                # Try searching for any word in the query (more lenient)
                for word in query_words:
                    matching_posts = [p for p in all_posts 
                                    if word in p.get('title', {}).get('rendered', '').lower() 
                                    or word in p.get('excerpt', {}).get('rendered', '').lower()
                                    or word in p.get('content', {}).get('rendered', '').lower()]
                    if matching_posts:
                        posts = matching_posts[:5]
                        print(f"Found {len(matching_posts)} posts matching word: {word}")
                        break
            
        except requests.RequestException as e:
            print(f"WordPress API request error: {e}")
            posts = []
        
        # Step 1b: Search static HTML pages
        static_pages = []
        try:
            static_pages = search_static_html_pages(query)
        except Exception as e:
            print(f"Error searching static HTML pages: {e}")
            static_pages = []
        
        # Step 2: Prepare context from blog posts and static HTML pages
        import re
        
        context = ""
        sources = []
        
        # Add blog posts to context
        if posts:
            for post in posts[:5]:  # Use top 5 most relevant posts
                title = post.get('title', {}).get('rendered', '')
                content = post.get('content', {}).get('rendered', '')
                link = post.get('link', '')
                excerpt = post.get('excerpt', {}).get('rendered', '')
                date_str = post.get('date', '')
                
                # Clean HTML tags more thoroughly
                content_clean = re.sub('<[^<]+?>', '', content)
                excerpt_clean = re.sub('<[^<]+?>', '', excerpt)
                
                # Remove extra whitespace and newlines
                content_clean = re.sub(r'\s+', ' ', content_clean).strip()
                excerpt_clean = re.sub(r'\s+', ' ', excerpt_clean).strip()
                
                # Calculate authority score
                authority_score = calculate_authority_score(
                    source_type='blog',
                    title=title,
                    content=content_clean,
                    date_str=date_str,
                    query=query,
                    query_words=query_words
                )
                
                # Get more content (up to 4000 chars per post since articles are ~1000 words)
                # 1000 words ≈ 6000 chars, so 4000 gives good coverage
                content_snippet = content_clean[:4000] if len(content_clean) > 4000 else content_clean
                
                context += f"\n\n---\nBlog Post: {title}\nExcerpt: {excerpt_clean}\nFull Content: {content_snippet}\n---\n"
                sources.append({
                    'title': title,
                    'link': link,
                    'excerpt': excerpt_clean[:200] if excerpt_clean else content_clean[:200],
                    'type': 'blog',
                    'authority': authority_score,
                    'date': date_str
                })
        
        # Add static HTML pages to context
        if static_pages:
            for page in static_pages[:5]:  # Use top 5 most relevant pages
                title = page.get('title', '')
                content = page.get('content', '')
                link = page.get('link', '')
                
                # Calculate authority score
                authority_score = calculate_authority_score(
                    source_type='website',
                    title=title,
                    content=content,
                    date_str=None,
                    query=query,
                    query_words=query_words
                )
                
                # Content is already cleaned, just truncate
                content_snippet = content[:4000] if len(content) > 4000 else content
                
                # Extract a snippet for excerpt (first 200 chars of meaningful content)
                excerpt = content[:200] + '...' if len(content) > 200 else content
                
                context += f"\n\n---\nWebsite Page: {title}\nContent: {content_snippet}\n---\n"
                sources.append({
                    'title': title,
                    'link': link,
                    'excerpt': excerpt,
                    'type': 'website',
                    'authority': authority_score
                })
        
        # If no content found, provide a helpful message
        if not context:
            print(f"No context found for query: {query}")
            print(f"Posts fetched: {len(posts)}")
            print(f"Static pages: {len(static_pages)}")
            return jsonify({
                'answer': f"I couldn't find specific information about '{query}' in our blog or website content. This topic might not be directly related to AI document automation, the Curam-Ai Protocol, or our services. Please visit <a href='https://curam-ai.com.au/?s={query}' target='_blank'>curam-ai.com.au</a> to search our full blog, or <a href='contact.html'>contact us</a> if you have questions about our services.",
                'sources': [],
                'query': query
            })
        
        # Step 3: Use Gemini to generate answer based on retrieved context
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            prompt = f"""You are a helpful assistant for Curam-Ai Protocol™, an AI document automation service for engineering firms.

The user asked: "{query}"

Below is relevant content from our WordPress blog (800+ articles) and our website pages. Use this content to provide a comprehensive, informative answer.

Content from Blog and Website:
{context}

Instructions:
1. Provide a direct, comprehensive answer to the user's question using the content above
2. If the question is "what is X", explain what X is clearly and thoroughly
3. Include key details, definitions, and important information from both blog posts and website pages
4. Synthesize information from multiple sources if relevant (combine blog and website content)
5. Reference specific source titles when citing information (mention if it's from a blog post or website page)
6. Be thorough - the user wants to understand the topic, not just get a brief mention
7. If the content discusses comparisons or costs, also explain what the thing itself is
8. Prioritize website pages for information about services, pricing, and processes
9. Use blog posts for detailed explanations, case studies, and technical deep dives

Answer the question comprehensively:"""
            
            response = model.generate_content(prompt)
            answer = response.text if response.text else "I couldn't generate an answer. Please visit curam-ai.com.au for more information."
            
            return jsonify({
                'answer': answer,
                'sources': sources,
                'query': query
            })
            
        except Exception as e:
            return jsonify({
                'answer': f"I encountered an error processing your question. Please visit curam-ai.com.au to search for information about '{query}'.",
                'sources': sources,
                'query': query,
                'error': str(e)
            }), 500
            
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


def format_text_to_html(text):
    """
    Convert plain text to HTML with paragraph breaks and basic formatting.
    Handles double newlines as paragraph breaks, single newlines as line breaks.
    Also handles sentences that end with periods followed by newlines as paragraph breaks.
    """
    if not text:
        return ""
    
    import re
    
    # First, normalize whitespace - replace multiple spaces with single space
    text = re.sub(r' +', ' ', text.strip())
    
    # Split by double newlines (paragraphs)
    paragraphs = re.split(r'\n\s*\n', text)
    
    # If no double newlines, try to intelligently split into paragraphs
    # Look for sentence endings followed by capital letters (likely new paragraph)
    if len(paragraphs) == 1:
        # Pattern: sentence ending (. ! ?) followed by space and capital letter
        # This helps identify natural paragraph breaks
        parts = re.split(r'([.!?])\s+([A-Z][a-z])', text)
        
        if len(parts) > 3:  # If we found potential breaks
            # Reconstruct paragraphs intelligently
            paragraphs = []
            current_para = parts[0] if parts[0] else ""
            
            for i in range(1, len(parts), 3):
                if i + 1 < len(parts):
                    punctuation = parts[i] if i < len(parts) else ""
                    next_sentence = parts[i + 1] if i + 1 < len(parts) else ""
                    
                    # If current paragraph is substantial and next starts a new thought, break
                    if len(current_para.strip()) > 50 and next_sentence:
                        if current_para.strip():
                            paragraphs.append((current_para.strip() + punctuation).strip())
                        current_para = next_sentence
                    else:
                        current_para += punctuation + " " + next_sentence
                else:
                    current_para += parts[i] if i < len(parts) else ""
            
            if current_para.strip():
                paragraphs.append(current_para.strip())
        else:
            # Fallback: if text has single newlines, use those
            if '\n' in text:
                paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
    
    html_parts = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Replace single newlines with <br> within paragraphs (but preserve intentional breaks)
        para = para.replace('\n', '<br>')
        
        # Basic markdown-style formatting
        # Bold: **text** or *text* (but not if it's part of a URL or email)
        para = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', para)
        # Only italicize single asterisks that aren't part of bold
        para = re.sub(r'(?<!\*)\*([^*]+?)\*(?!\*)', r'<em>\1</em>', para)
        
        # Escape any remaining HTML that shouldn't be there
        # (This is a simple escape - more complex sanitization happens in frontend)
        
        # Wrap in paragraph tag
        html_parts.append(f'<p>{para}</p>')
    
    return ''.join(html_parts) if html_parts else f'<p>{text}</p>'


@app.route('/api/contact-assistant', methods=['POST'])
def contact_assistant():
    """
    AI Contact Assistant: Helps users understand their needs and guides them through the contact process.
    """
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        conversation_history = data.get('history', [])  # Array of {role: 'user'|'assistant', content: '...'}
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Build conversation context
        system_prompt = """You are a helpful AI assistant for Curam-Ai Protocol™, an AI document automation service for engineering firms.

Your role is to:
1. Understand the user's needs and challenges
2. Ask clarifying questions to better understand their situation
3. Suggest relevant services (Phase 1 Feasibility Sprint, Phase 2 Roadmap, Phase 3 Compliance Shield, Phase 4 Implementation)
4. Provide helpful information about the protocol and pricing
5. Guide users toward the most appropriate next step

Key information about Curam-Ai Protocol™:
- Phase 1 (Feasibility Sprint): $1,500 - 48-hour proof of concept on their documents
- Phase 2 (The Roadmap): $7,500 - Detailed implementation plan
- Phase 3 (Compliance Shield): $8-12k - Production-ready automation
- Phase 4 (Implementation): $20-30k - Full deployment

Services:
- Finance/Admin: Invoice automation, data entry into Xero
- Engineering: Beam schedule digitization from drawings
- Drafting: Transmittal register automation

IMPORTANT: Format your responses using HTML tags for better readability:
- Use <p> tags for paragraphs
- Use <strong> or <b> for emphasis
- Use <ul> and <li> for lists
- Use <br> for line breaks when needed
- Keep HTML simple and safe (no scripts or complex tags)
- DO NOT wrap your response in markdown code blocks (no ```html or ```)
- Return the HTML directly, not wrapped in code fences

Keep responses concise (2-3 sentences per paragraph), friendly, and focused on understanding their needs. Ask one clarifying question at a time when needed."""
        
        # Build conversation for Gemini
        conversation = [{"role": "user", "parts": [system_prompt]}]
        
        # Add conversation history (limit to last 10 exchanges to avoid token limits)
        recent_history = conversation_history[-10:] if len(conversation_history) > 10 else conversation_history
        for item in recent_history:
            role = "user" if item.get('role') == 'user' else "model"
            conversation.append({"role": role, "parts": [item.get('content', '')]})
        
        # Add current message
        conversation.append({"role": "user", "parts": [message]})
        
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            # Generate response
            response = model.generate_content(conversation)
            assistant_message = response.text if response.text else "I'm here to help! Could you tell me more about what you're looking for?"
            
            # Remove markdown code blocks if present (```html ... ``` or ``` ... ```)
            import re
            if assistant_message:
                # Remove markdown code blocks
                assistant_message = re.sub(r'```html\s*\n?(.*?)\n?```', r'\1', assistant_message, flags=re.DOTALL)
                assistant_message = re.sub(r'```\s*\n?(.*?)\n?```', r'\1', assistant_message, flags=re.DOTALL)
                # Remove any remaining backticks
                assistant_message = assistant_message.strip().strip('`')
                # Clean up any extra whitespace
                assistant_message = re.sub(r'\n\s*\n\s*\n+', '\n\n', assistant_message)
            
            # Always format the response to ensure proper HTML structure
            if assistant_message:
                # Check if response already contains proper HTML paragraph tags
                has_proper_paragraphs = '<p>' in assistant_message and '</p>' in assistant_message
                
                if not has_proper_paragraphs:
                    # Convert plain text to HTML with paragraph breaks
                    # This handles cases where LLM returns plain text or partial HTML
                    assistant_message = format_text_to_html(assistant_message)
                else:
                    # LLM returned HTML with paragraphs, but clean it up
                    import re
                    # Remove extra whitespace between tags
                    assistant_message = re.sub(r'>\s+<', '><', assistant_message)
                    # Normalize whitespace in content
                    assistant_message = re.sub(r'\s+', ' ', assistant_message)
                    # Clean up any unclosed tags or malformed HTML
                    if assistant_message.count('<p>') != assistant_message.count('</p>'):
                        # If paragraphs aren't balanced, extract text and reformat
                        text_only = re.sub(r'<[^>]+>', ' ', assistant_message)
                        assistant_message = format_text_to_html(text_only)
            
            # Try to extract suggested service/interest from the conversation
            suggested_interest = None
            message_lower = message.lower()
            if any(word in message_lower for word in ['phase 1', 'feasibility', 'proof of concept', 'poc', 'test']):
                suggested_interest = 'phase-1'
            elif any(word in message_lower for word in ['phase 2', 'roadmap', 'plan', 'strategy']):
                suggested_interest = 'phase-2'
            elif any(word in message_lower for word in ['phase 3', 'compliance', 'production', 'shield']):
                suggested_interest = 'phase-3'
            elif any(word in message_lower for word in ['phase 4', 'implementation', 'deploy', 'rollout']):
                suggested_interest = 'phase-4'
            elif any(word in message_lower for word in ['roi', 'calculator', 'return on investment', 'cost']):
                suggested_interest = 'roi'
            
            return jsonify({
                'message': assistant_message,
                'suggested_interest': suggested_interest
            })
            
        except Exception as e:
            app.logger.error(f"Gemini generation failed for contact assistant: {e}")
            return jsonify({
                'message': "I'm here to help! Could you tell me more about your document automation needs?",
                'error': str(e)
            }), 500
            
    except Exception as e:
        app.logger.error(f"Contact assistant failed: {e}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


@app.route('/api/check-message-relevance', methods=['POST'])
def check_message_relevance():
    """
    NLP-based check to determine if a contact form message is related to Curam-Ai services.
    Uses the same Gemini model as the contact assistant.
    """
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        if not api_key:
            # Fallback to keyword matching if API key not available
            return jsonify({
                'is_relevant': True,  # Default to relevant if we can't check
                'confidence': 0.5,
                'reason': 'AI service unavailable, defaulting to allow submission'
            })
        
        # System prompt for relevance checking
        relevance_prompt = """You are analyzing a contact form message to determine if it's related to Curam-Ai Protocol™ services.

Curam-Ai Protocol™ provides:
- Document automation and extraction (invoices, CAD schedules, drawings)
- AI implementation for engineering firms
- Workflow automation for structural engineering
- The Protocol: 4-phase framework (Feasibility Sprint, Roadmap, Compliance Shield, Implementation)
- ROI calculations and efficiency improvements
- ISO-27001 compliance and security
- Data entry automation, PDF processing, OCR

Analyze the message and respond with ONLY a JSON object in this exact format:
{
    "is_relevant": true or false,
    "confidence": 0.0 to 1.0,
    "reason": "brief explanation"
}

Consider relevant if the message mentions:
- Document processing, automation, extraction
- AI, machine learning, or technology implementation
- Engineering, structural engineering, or professional services
- Workflow efficiency, time savings, productivity
- Invoices, schedules, drawings, PDFs
- The Protocol, phases, feasibility, compliance
- General inquiries about services, pricing, or next steps

Consider NOT relevant if the message is clearly about:
- Completely unrelated services (e.g., selling products, unrelated consulting)
- Spam or promotional content
- Personal matters unrelated to business services
- Topics completely outside document automation/AI

Message to analyze:
"""
        
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            # Generate relevance analysis
            full_prompt = relevance_prompt + message
            response = model.generate_content(full_prompt)
            response_text = response.text if response.text else ""
            
            # Try to parse JSON from response
            import re
            json_match = re.search(r'\{[^}]+\}', response_text, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return jsonify({
                    'is_relevant': result.get('is_relevant', True),
                    'confidence': result.get('confidence', 0.5),
                    'reason': result.get('reason', 'Analyzed by AI')
                })
            else:
                # Fallback: check if response indicates relevance
                response_lower = response_text.lower()
                is_relevant = not any(word in response_lower for word in ['not relevant', 'unrelated', 'not related', 'cannot help'])
                return jsonify({
                    'is_relevant': is_relevant,
                    'confidence': 0.6,
                    'reason': 'AI analysis completed'
                })
            
        except Exception as e:
            app.logger.error(f"Gemini relevance check failed: {e}")
            # Fallback to allowing submission
            return jsonify({
                'is_relevant': True,
                'confidence': 0.5,
                'reason': 'AI check unavailable, defaulting to allow'
            })
            
    except Exception as e:
        app.logger.error(f"Message relevance check failed: {e}")
        return jsonify({
            'is_relevant': True,
            'confidence': 0.5,
            'reason': 'Error in analysis, defaulting to allow'
        }), 500


@app.route('/api/contact', methods=['POST'])
def contact_form():
    """
    Handle contact form submissions and send emails using MailChannel API.
    """
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        company = data.get('company', '').strip()
        interest = data.get('interest', '').strip()
        message = data.get('message', '').strip()
        
        # Validation
        if not name or not email or not message:
            return jsonify({'error': 'Name, email, and message are required'}), 400
        
        # Get MailChannel API key
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        if not mailchannels_api_key:
            app.logger.error("MAILCHANNELS_API_KEY not configured - email sending disabled")
            return jsonify({
                'error': 'Email service is currently unavailable. Please try again later.',
                'details': 'MAILCHANNELS_API_KEY environment variable is missing'
            }), 503
        
        # Get recipient email (admin/contact email)
        to_email = 'michaelbarrett@bluelily.com.au'
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Interest labels
        interest_labels = {
            'phase-1': 'Phase 1 - Feasibility Sprint',
            'phase-2': 'Phase 2 - The Roadmap',
            'phase-3': 'Phase 3 - Compliance Shield',
            'phase-4': 'Phase 4 - Implementation',
            'roi': 'ROI Calculator',
            'general': 'General Inquiry'
        }
        interest_display = interest_labels.get(interest, interest or 'Not specified')
        
        # Build email content for admin
        email_subject = f"New Contact Form Submission from {name}"
        
        # Prepare message with HTML line breaks (escape newlines for HTML)
        message_html = message.replace(chr(10), '<br>') if message else ''
        company_html = f'<div class="field"><div class="label">Company:</div><div class="value">{company}</div></div>' if company else ''
        
        email_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                h1 {{ color: #0a1628; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }}
                .field {{ margin: 15px 0; }}
                .label {{ font-weight: bold; color: #0a1628; }}
                .value {{ margin-top: 5px; padding: 10px; background: #F8F9FA; border-radius: 4px; }}
                .message-box {{ background: #F8F9FA; padding: 15px; border-left: 3px solid #D4AF37; border-radius: 4px; }}
            </style>
        </head>
        <body>
            <h1>New Contact Form Submission</h1>
            
            <div class="field">
                <div class="label">Name:</div>
                <div class="value">{name}</div>
            </div>
            
            <div class="field">
                <div class="label">Email:</div>
                <div class="value"><a href="mailto:{email}">{email}</a></div>
            </div>
            
            {company_html}
            
            <div class="field">
                <div class="label">Interest:</div>
                <div class="value">{interest_display}</div>
            </div>
            
            <div class="field">
                <div class="label">Message:</div>
                <div class="message-box">{message_html}</div>
            </div>
        </body>
        </html>
        """
        
        # Prepare email text content
        newline = '\n'
        company_line = f'Company: {company}{newline}' if company else ''
        email_text = f"""New Contact Form Submission

Name: {name}
Email: {email}
{company_line}Interest: {interest_display}

Message:
{message}
"""
        
        # Build confirmation email for user
        interest_line_html = f'<p><strong>Interest:</strong> {interest_display}</p>' if interest else ''
        interest_line_text = f'Interest: {interest_display}\n\n' if interest else ''
        
        confirmation_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                h1 {{ color: #0a1628; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }}
                .info-box {{ margin: 20px 0; padding: 15px; background: #F8F9FA; border-radius: 4px; }}
                .message {{ margin: 20px 0; padding: 15px; background: #F8F9FA; border-radius: 4px; }}
                .interest {{ color: #D4AF37; font-weight: bold; }}
            </style>
        </head>
        <body>
            <h1>Thank You for Contacting Curam-Ai</h1>
            <p>Hi {name},</p>
            <p>We've received your inquiry and will get back to you within 24 hours.</p>
            {interest_line_html}
            <div class="message">
                <strong>Your Message:</strong><br>
                {message_html}
            </div>
            <p>Best regards,<br>Curam-Ai Protocol™ Team</p>
        </body>
        </html>
        """
        
        confirmation_text = f"""Thank You for Contacting Curam-Ai

Hi {name},

We've received your inquiry and will get back to you within 24 hours.

{interest_line_text}Your Message:
{message}

Best regards,
Curam-Ai Protocol™ Team
"""
        
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        
        # MailChannel API headers - API key is optional if domain lockdown is configured
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        # Send email to admin
        admin_email_data = {
            "personalizations": [
                {
                    "to": [{"email": to_email}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam-Ai Protocol™ Contact Form"
            },
            "reply_to": {
                "email": email,
                "name": name
            },
            "subject": email_subject,
            "content": [
                {
                    "type": "text/plain",
                    "value": email_text
                },
                {
                    "type": "text/html",
                    "value": email_html
                }
            ]
        }
        
        # Send confirmation email to user
        user_email_data = {
            "personalizations": [
                {
                    "to": [{"email": email, "name": name}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam-Ai Protocol™"
            },
            "subject": "Thank You for Contacting Curam-Ai",
            "content": [
                {
                    "type": "text/plain",
                    "value": confirmation_text
                },
                {
                    "type": "text/html",
                    "value": confirmation_html
                }
            ]
        }
        
        try:
            # Send admin notification
            admin_response = requests.post(mailchannels_url, json=admin_email_data, headers=headers, timeout=10)
            if admin_response.status_code != 202:
                app.logger.error(f"Mailchannels API error (admin email): {admin_response.status_code} - {admin_response.text}")
            
            # Send user confirmation
            user_response = requests.post(mailchannels_url, json=user_email_data, headers=headers, timeout=10)
            if user_response.status_code != 202:
                app.logger.error(f"Mailchannels API error (user confirmation): {user_response.status_code} - {user_response.text}")
            
            if admin_response.status_code == 202:
                app.logger.info(f"Contact form email sent successfully from {email}")
                
                # SMS functionality removed
                
                return jsonify({
                    'success': True,
                    'message': 'Thank you for your message! We will get back to you soon.'
                })
            else:
                app.logger.error(f"Failed to send contact form email: {admin_response.text}")
                return jsonify({
                    'error': 'Failed to send email. Please try again later.',
                    'details': admin_response.text if admin_response.text else 'Unknown error'
                }), 500
                
        except requests.RequestException as e:
            app.logger.error(f"Error sending contact form email via Mailchannels: {e}")
            return jsonify({
                'error': 'Failed to send email. Please try again later.'
            }), 500
        
    except Exception as e:
        app.logger.error(f"Contact form submission failed: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


@app.route('/api/email-chat-log', methods=['POST'])
def email_chat_log():
    """
    Email the chat log from the AI Contact Assistant conversation.
    """
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        conversation_history = data.get('history', [])
        user_name = data.get('name', '')
        company = data.get('company', '')
        
        if not email:
            return jsonify({'error': 'Email address is required'}), 400
        
        if not conversation_history:
            return jsonify({'error': 'No conversation history to email'}), 400
        
        # Generate email content
        email_subject = f"Curam-Ai Contact Assistant Conversation - {user_name or 'Inquiry'}"
        
        # Build HTML email content
        email_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                h1 {{ color: #0B1221; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }}
                .message {{ margin: 15px 0; padding: 12px; border-radius: 6px; }}
                .user-message {{ background: #0B1221; color: white; text-align: right; }}
                .assistant-message {{ background: #F8F9FA; border-left: 3px solid #D4AF37; }}
                .meta {{ color: #666; font-size: 0.9em; margin-top: 20px; padding-top: 20px; border-top: 1px solid #E5E7EB; }}
            </style>
        </head>
        <body>
            <h1>Your Curam-Ai Contact Assistant Conversation</h1>
            <p>Thank you for using our AI Contact Assistant. Here's a transcript of our conversation:</p>
        """
        
        if user_name or company:
            email_html += f"<p><strong>Name:</strong> {user_name or 'Not provided'}<br>"
            email_html += f"<strong>Company:</strong> {company or 'Not provided'}</p>"
        
        email_html += "<div style='margin: 20px 0;'>"
        
        for msg in conversation_history:
            role = msg.get('role', '')
            content = msg.get('content', '')
            if role == 'user':
                email_html += f'<div class="message user-message"><strong>You:</strong> {content}</div>'
            elif role == 'assistant':
                email_html += f'<div class="message assistant-message"><strong>AI Assistant:</strong> {content}</div>'
        
        email_html += """
            </div>
            <div class="meta">
                <p><strong>Next Steps:</strong></p>
                <ul>
                    <li>Fill out our contact form to continue the conversation</li>
                    <li>Book a diagnostic call to discuss your specific needs</li>
                    <li>Try our ROI Calculator to see potential savings</li>
                </ul>
                <p>Visit us at <a href="https://protocol.curam-ai.com.au">protocol.curam-ai.com.au</a></p>
                <p>Best regards,<br>Curam-Ai Protocol™ Team</p>
            </div>
        </body>
        </html>
        """
        
        # Plain text version
        email_text = f"""Your Curam-Ai Contact Assistant Conversation\n\n"""
        if user_name or company:
            email_text += f"Name: {user_name or 'Not provided'}\n"
            email_text += f"Company: {company or 'Not provided'}\n\n"
        email_text += "Conversation:\n\n"
        for msg in conversation_history:
            role = msg.get('role', '')
            content = msg.get('content', '')
            if role == 'user':
                email_text += f"You: {content}\n\n"
            elif role == 'assistant':
                email_text += f"AI Assistant: {content}\n\n"
        email_text += "\nNext Steps:\n"
        email_text += "- Fill out our contact form to continue the conversation\n"
        email_text += "- Book a diagnostic call to discuss your specific needs\n"
        email_text += "- Try our ROI Calculator to see potential savings\n\n"
        email_text += "Visit us at https://protocol.curam-ai.com.au\n\n"
        email_text += "Best regards,\nCuram-Ai Protocol™ Team"
        
        # Send email using Mailchannels API
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        if not mailchannels_api_key:
            app.logger.error("MAILCHANNELS_API_KEY not configured - email sending disabled")
            # Log available env vars for debugging (without exposing sensitive data)
            env_vars = [k for k in os.environ.keys() if 'MAIL' in k.upper() or 'EMAIL' in k.upper()]
            app.logger.info(f"Available email-related env vars: {env_vars}")
            return jsonify({
                'error': 'Email service is currently unavailable. Please fill out the contact form below or try again later.',
                'details': 'MAILCHANNELS_API_KEY environment variable is missing'
            }), 503
        
        # Get from email address (default to noreply, but can be configured)
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Mailchannels API endpoint
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        
        # Prepare email data for Mailchannels
        email_data = {
            "personalizations": [
                {
                    "to": [{"email": email}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam-Ai Protocol™"
            },
            "subject": email_subject,
            "content": [
                {
                    "type": "text/plain",
                    "value": email_text
                },
                {
                    "type": "text/html",
                    "value": email_html
                }
            ]
        }
        
        # Set headers - MailChannel API key is optional if domain lockdown is configured
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        try:
            # Send email via Mailchannels API
            response = requests.post(mailchannels_url, json=email_data, headers=headers, timeout=10)
            
            if response.status_code == 202:
                app.logger.info(f"Chat log email sent successfully to {email}")
                return jsonify({
                    'success': True,
                    'message': 'Chat log email sent successfully'
                })
            else:
                app.logger.error(f"Mailchannels API error: {response.status_code} - {response.text}")
                return jsonify({
                    'error': f'Failed to send email. Please try again later.',
                    'details': response.text if response.text else 'Unknown error'
                }), 500
                
        except requests.RequestException as e:
            app.logger.error(f"Error sending email via Mailchannels: {e}")
            return jsonify({
                'error': 'Failed to send email. Please try again later.'
            }), 500
        
    except Exception as e:
        app.logger.error(f"Email chat log failed: {e}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


@app.route('/how-it-works')
@app.route('/how-it-works.html')
def how_it_works():
    try:
        return send_file('how-it-works.html')
    except:
        return "How it works page not found.", 404

@app.route('/curam-ai-protocol.html')
def curam_ai_protocol():
    try:
        return send_file('curam-ai-protocol.html')
    except:
        return "Protocol page not found.", 404

@app.route('/tier2-report.html')
def tier2_report():
    """Serve the Tier 2 report HTML file"""
    try:
        # Serve the actual Tier 2 report file (tier2-report.html contains the report)
        # The Curam-Ai-Redacted file appears to be homepage content, so use tier2-report.html
        html_file = 'tier2-report.html'
        
        if not os.path.exists(html_file):
            return f"Tier 2 report not found. Looking for: {html_file}", 404
        
        # Use absolute path to ensure we get the right file
        file_path = os.path.abspath(html_file)
        return send_file(file_path, mimetype='text/html')
    except Exception as e:
        return f"Error serving report: {str(e)}", 500

@app.route('/tier-one-feasibility-report')
@app.route('/tier-one-feasibility-report.html')
def tier_one_feasibility_report():
    """Serve the Tier One Feasibility Report HTML file"""
    try:
        return send_file('tier-one-feasibility-report.html')
    except:
        return "Tier One Feasibility Report not found.", 404

@app.route('/phase-1-feasibility')
@app.route('/phase-1-feasibility.html')
def phase_1_feasibility():
    """Serve the Phase 1 Feasibility page"""
    try:
        return send_file('phase-1-feasibility.html')
    except:
        return "Phase 1 Feasibility page not found.", 404

@app.route('/phase-2-roadmap')
@app.route('/phase-2-roadmap.html')
def phase_2_roadmap():
    """Serve the Phase 2 Roadmap page"""
    try:
        return send_file('phase-2-roadmap.html')
    except:
        return "Phase 2 Roadmap page not found.", 404

@app.route('/phase-3-compliance')
@app.route('/phase-3-compliance.html')
def phase_3_compliance():
    """Serve the Phase 3 Compliance Shield page"""
    try:
        return send_file('phase-3-compliance.html')
    except:
        return "Phase 3 Compliance Shield page not found.", 404

@app.route('/phase-4-implementation')
@app.route('/phase-4-implementation.html')
def phase_4_implementation():
    """Serve the Phase 4 Implementation page"""
    try:
        return send_file('phase-4-implementation.html')
    except:
        return "Phase 4 Implementation page not found.", 404

@app.route('/feasibility-sprint-report')
@app.route('/feasibility-sprint-report.html')
@app.route('/gate2-sample-report')
@app.route('/gate2-sample-report.html')
def feasibility_sprint_report():
    """Serve the Phase 1 Feasibility Sprint report slideshow page"""
    try:
        return send_file('feasibility-sprint-report.html')
    except:
        return "Feasibility Sprint report page not found.", 404

@app.route('/risk-audit-report')
@app.route('/risk-audit-report.html')
def risk_audit_report():
    """Serve the Risk Audit Report page"""
    try:
        return send_file('risk-audit-report.html')
    except:
        return "Risk Audit Report page not found.", 404

# Phase 2 Report Routes
@app.route('/phase-2-exec-summary')
@app.route('/phase-2-exec-summary.html')
def phase_2_exec_summary():
    """Serve the Phase 2 Executive Summary report"""
    try:
        return send_file('phase-2-exec-summary.html')
    except:
        return "Phase 2 Executive Summary not found.", 404

@app.route('/phase-2-discovery-baseline-report')
@app.route('/phase-2-discovery-baseline-report.html')
def phase_2_discovery_baseline():
    """Serve the Phase 2 Discovery Baseline report"""
    try:
        return send_file('phase-2-discovery-baseline-report.html')
    except:
        return "Phase 2 Discovery Baseline report not found.", 404

@app.route('/phase-2-metric-agreement')
@app.route('/phase-2-metric-agreement.html')
def phase_2_metric_agreement():
    """Serve the Phase 2 Metric Agreement report"""
    try:
        return send_file('phase-2-metric-agreement.html')
    except:
        return "Phase 2 Metric Agreement not found.", 404

@app.route('/phase-2-reports')
@app.route('/phase-2-reports.html')
def phase_2_reports():
    """Serve the Phase 2 reports index page"""
    try:
        return send_file('phase-2-reports.html')
    except:
        return "Phase 2 reports page not found.", 404

# Root route - serve the marketing homepage
@app.route('/')
def root():
    try:
        return send_file('homepage.html')
    except Exception as e:
        # Fallback message if homepage doesn't exist
        return f"Homepage not found. Error: {str(e)}", 404

# Feasibility Preview HTML page with iframe (serves feasibility-preview.html)
@app.route('/feasibility-preview.html')
def feasibility_preview_html():
    """Serve feasibility-preview.html page with iframe to automater"""
    return send_file('feasibility-preview.html')

@app.route('/feasibility-preview', methods=['GET', 'POST'])
def feasibility_preview_redirect():
    """Redirect /feasibility-preview to /feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

# Legacy demo routes (301 redirects to new name)
@app.route('/demo.html')
def demo_html_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

@app.route('/demo', methods=['GET', 'POST'])
def demo_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

# Automater route (document extraction tool) - moved from root
@app.route('/automater', methods=['GET', 'POST'])
@app.route('/extract', methods=['GET', 'POST'])
def automater():
    # Call the original index function logic
    return index_automater()

# Original index function (document extraction) - renamed
def index_automater():
    department = request.form.get('department') or request.args.get('department')
    results = []
    error_message = None
    last_model_used = None
    model_attempts = []
    model_actions = []
    detected_schedule_type = None
    selected_samples = []

    # Default to DEFAULT_DEPARTMENT if still not set
    if not department:
        department = DEFAULT_DEPARTMENT

    # Load results from session on GET requests (only if department matches)
    if request.method == 'GET':
        saved = session.get('last_results')
        if saved:
            saved_department = saved.get('department')
            # Only load from session if department matches (respect user's selection)
            if saved_department == department:
                session_results = saved.get('rows', [])
                if session_results:
                    results = session_results
                    # Get schedule type for engineering
                    if saved_department == "engineering":
                        detected_schedule_type = saved.get('schedule_type')
                    model_actions.append(f"Loaded {len(results)} row(s) from previous session")

    if request.method == 'POST':
        # Log the department received
        model_actions.append(f"POST request received. Department from form: '{department}'")
        
        finance_defaults = []
        finance_uploaded_paths = []
        transmittal_defaults = []

        # For engineering and finance (now checkboxes), get list of values; for others handle custom logic
        if department == 'engineering' or department == 'finance':
            selected_samples = request.form.getlist('samples')
            model_actions.append(f"{department.capitalize()} mode: selected_samples from form = {selected_samples}")
        elif department == 'transmittal':
            transmittal_defaults = request.form.getlist('transmittal_defaults')
            selected_samples = transmittal_defaults.copy()
            model_actions.append(f"Transmittal mode: auto-selecting {len(transmittal_defaults)} sample drawing(s)")
        else:
            selected_samples = request.form.getlist('samples')
            model_actions.append(f"Non-engineering mode: selected_samples from form = {selected_samples}")
        allowed_folder = DEPARTMENT_SAMPLES.get(department, {}).get("folder", "")
        
        # Handle finance uploads
        if department == 'finance':
            uploaded_files = request.files.getlist('finance_uploads')
            if uploaded_files:
                model_actions.append(f"Finance mode: {len(uploaded_files)} uploaded file(s) received")
            for file_storage in uploaded_files:
                if not file_storage or not file_storage.filename:
                    continue
                filename = secure_filename(file_storage.filename)
                if not filename.lower().endswith('.pdf'):
                    error_message = "Only PDF files can be uploaded for Finance."
                    model_actions.append(f"✗ ERROR: {filename} rejected (not a PDF)")
                    break
                unique_name = f"{int(time.time() * 1000)}_{filename}"
                file_path = os.path.join(FINANCE_UPLOAD_DIR, unique_name)
                file_storage.save(file_path)
                finance_uploaded_paths.append(file_path)
                model_actions.append(f"✓ Uploaded invoice saved: {file_path}")
            selected_samples.extend(finance_uploaded_paths)

        # Filter samples to only those matching the current department (skip for auto-select departments)
        if department == 'transmittal':
            samples = [sample for sample in selected_samples if sample]
        else:
            samples = [
                sample for sample in selected_samples
                if sample and SAMPLE_TO_DEPT.get(sample) == department
            ]
        # Log what was selected for debugging
        if selected_samples:
            model_actions.append(f"Selected samples: {selected_samples}")
            for sample in selected_samples:
                if sample:
                    dept_match = SAMPLE_TO_DEPT.get(sample, "NOT FOUND")
                    model_actions.append(f"  - {sample}: mapped to department '{dept_match}'")
            model_actions.append(f"Filtered to department '{department}': {samples}")
        else:
            model_actions.append("No samples selected in form")

        # Check if there's anything to process
        if not samples:
            if selected_samples:
                error_message = f"No samples matched department '{department}'. Selected: {selected_samples}"
                model_actions.append(f"✗ ERROR: {error_message}")
            else:
                error_message = "Please select at least one sample file."
                model_actions.append(f"✗ ERROR: {error_message}")

        if not error_message:
            if samples:
                model_actions.append(f"Processing {len(samples)} sample file(s)")
                for sample_path in samples:
                    if not os.path.exists(sample_path):
                        error_msg = f"File not found: {sample_path}"
                        model_actions.append(f"✗ {error_msg}")
                        if not error_message:
                            error_message = error_msg
                        continue
                
                    filename = os.path.basename(sample_path)
                    model_actions.append(f"Processing file: {filename} (path: {sample_path})")
                    
                    # Check if it's an image file
                    file_ext = os.path.splitext(sample_path)[1].lower()
                    is_image = file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']
                    
                    image_path = None
                    if is_image:
                        model_actions.append(f"Detected image file: {filename} - will use Gemini vision API")
                        image_path = sample_path
                        text = f"[IMAGE_FILE:{sample_path}]"
                    else:
                        model_actions.append(f"Extracting text from {filename}")
                        text = extract_text(sample_path)
                        if text.startswith("Error:"):
                            model_actions.append(f"✗ Text extraction failed for {filename}: {text}")
                            if not error_message:
                                error_message = f"Text extraction failed for {filename}"
                            continue
                        else:
                            model_actions.append(f"✓ Text extracted successfully ({len(text)} characters)")
                    
                    model_actions.append(f"Analyzing {filename} with AI models")
                    entries, api_error, model_used, attempt_log, file_action_log, schedule_type = analyze_gemini(text, department, image_path)
                    if file_action_log:
                        model_actions.extend(file_action_log)
                    if model_used:
                        last_model_used = model_used
                        model_actions.append(f"✓ Successfully processed {filename} with {model_used}")
                    if attempt_log:
                        model_attempts.extend(attempt_log)
                    if api_error:
                        model_actions.append(f"✗ Failed to process {filename}: {api_error}")
                        if not error_message:
                            error_message = api_error
                    if entries:
                        if department == "transmittal":
                            # Transmittal returns a single object with multiple arrays
                            if isinstance(entries, list) and len(entries) > 0 and isinstance(entries[0], dict):
                                transmittal_data = entries[0]
                                # Add filename to DrawingRegister (handle both dict and list)
                                if 'DrawingRegister' in transmittal_data:
                                    dr = transmittal_data['DrawingRegister']
                                    if isinstance(dr, dict):
                                        dr['Filename'] = filename
                                    elif isinstance(dr, list) and len(dr) > 0:
                                        for item in dr:
                                            if isinstance(item, dict):
                                                item['Filename'] = filename
                                # Add SourceDocument to all sub-arrays
                                for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                                    if key in transmittal_data and isinstance(transmittal_data[key], list):
                                        for item in transmittal_data[key]:
                                            if isinstance(item, dict):
                                                item['SourceDocument'] = filename
                                results.append(transmittal_data)
                                model_actions.append(f"✓ Extracted structured data from {filename}")
                            else:
                                # Fallback to old format
                                for entry in entries if isinstance(entries, list) else [entries]:
                                    entry['Filename'] = filename
                                    results.append(entry)
                                model_actions.append(f"✓ Extracted {len(entries)} row(s) from {filename}")
                        else:
                            model_actions.append(f"✓ Extracted {len(entries)} row(s) from {filename}")
                            for entry in entries:
                                entry['Filename'] = filename
                                if department == "finance":
                                    cost_value = entry.get('Cost')
                                    gst_value = entry.get('GST')
                                    final_value = entry.get('FinalAmount') or entry.get('Total')
                                    if final_value and not entry.get('FinalAmount'):
                                        entry['FinalAmount'] = final_value
                                    entry['CostFormatted'] = format_currency(cost_value) if cost_value not in ("", None, "N/A") else (cost_value or "N/A")
                                    entry['GST'] = gst_value if gst_value not in ("", None) else "N/A"
                                    entry['GSTFormatted'] = format_currency(gst_value) if gst_value not in ("", None, "N/A") else "N/A"
                                    entry['FinalAmountFormatted'] = format_currency(final_value) if final_value not in ("", None, "N/A") else (final_value or "N/A")
                                else:
                                    entry['TotalFormatted'] = format_currency(entry.get('Total', ''))
                                    # Add confidence indicators, validation, and CORRECTION for engineering fields
                                    # CRITICAL: Error flagging system must always be active for safety
                                    if department == "engineering":
                                        entry['critical_errors'] = []
                                        entry['corrections_applied'] = []
                                        
                                        # Get context from other entries for correction
                                        context_entries = [e for e in results if e != entry]
                                        
                                        # Check confidence and validate key fields
                                        # CRITICAL: Comments field must be preserved EXACTLY - no corrections, no processing
                                        for field in ['Comments', 'PaintSystem', 'Size', 'Grade', 'Mark', 'Length', 'Qty']:
                                            if field in entry and entry[field]:
                                                # For Comments field: NO processing, NO validation, NO correction - preserve exactly
                                                if field == 'Comments':
                                                    # Only check if it's garbled for display purposes, but don't modify it
                                                    confidence = detect_low_confidence(entry[field])
                                                    entry[f'{field}_confidence'] = confidence
                                                    # DO NOT validate or correct Comments - preserve exactly as extracted
                                                else:
                                                    # For other fields: check confidence and validate
                                                    confidence = detect_low_confidence(entry[field])
                                                    entry[f'{field}_confidence'] = confidence
                                                    
                                                    # ATTEMPT CORRECTION ONLY for Size field (most critical)
                                                    if field == 'Size':
                                                        corrected_value, correction_confidence = correct_ocr_errors(
                                                            entry[field], field, context_entries
                                                        )
                                                        if corrected_value != entry[field]:
                                                            entry['corrections_applied'].append(
                                                                f"Size corrected: '{entry[field]}' → '{corrected_value}'"
                                                            )
                                                            entry[field] = corrected_value
                                                            if correction_confidence == 'medium':
                                                                entry[f'{field}_confidence'] = 'medium'
                                                    
                                                    # Validate for critical errors (but not Comments)
                                                    validation = validate_engineering_field(field, entry[field], entry)
                                                    if validation['errors']:
                                                        entry['critical_errors'].extend(validation['errors'])
                                                        if validation['confidence'] == 'low':
                                                            entry[f'{field}_confidence'] = 'low'
                                                        elif validation['confidence'] == 'medium' and confidence == 'high':
                                                            entry[f'{field}_confidence'] = 'medium'
                                                
                                                # Then validate for critical errors (after correction)
                                                validation = validate_engineering_field(field, entry[field], entry)
                                                if validation['errors']:
                                                    entry['critical_errors'].extend(validation['errors'])
                                                    # Update confidence if validation found issues
                                                    if validation['confidence'] == 'low':
                                                        entry[f'{field}_confidence'] = 'low'
                                                    elif validation['confidence'] == 'medium' and entry.get(f'{field}_confidence') == 'high':
                                                        entry[f'{field}_confidence'] = 'medium'
                                        
                                        # Mark entry as having critical errors if any found
                                        # This flagging system is essential for safety - never remove it
                                        if entry['critical_errors']:
                                            entry['has_critical_errors'] = True
                                        
                                        # ENGINEERING SAFETY: Reject entries with critical extraction errors
                                        # If Size or Quantity are wrong, this could cause structural failure
                                        critical_fields_with_errors = []
                                        for error in entry.get('critical_errors', []):
                                            if 'Size' in error or 'size' in error.lower():
                                                critical_fields_with_errors.append('Size')
                                            if 'Quantity' in error or 'quantity' in error.lower() or 'Qty' in error:
                                                critical_fields_with_errors.append('Quantity')
                                        
                                        if critical_fields_with_errors:
                                            entry['requires_manual_verification'] = True
                                            entry['rejection_reason'] = f"CRITICAL: {', '.join(critical_fields_with_errors)} extraction appears incorrect - MANUAL VERIFICATION REQUIRED before use"
                                results.append(entry)
                            
                            # Post-processing: Cross-entry validation for engineering
                            if department == "engineering" and len(results) > 1:
                                # Check for quantity anomalies by comparing similar entries
                                for i, entry in enumerate(results):
                                    if entry.get('Qty') == 1:
                                        # Check if similar entries (same mark prefix, similar size) have higher quantities
                                        mark = entry.get('Mark', '')
                                        size = entry.get('Size', '')
                                        if mark:
                                            # Look for similar entries (same prefix like "NB-")
                                            similar_entries = [
                                                r for r in results 
                                                if r != entry and r.get('Mark', '').startswith(mark.split('-')[0] + '-')
                                            ]
                                            if similar_entries:
                                                # Check if any similar entries have quantity > 1
                                                higher_qty_entries = [e for e in similar_entries if int(e.get('Qty', 0)) > 1]
                                                if higher_qty_entries:
                                                    # Flag quantity issues - especially if entry has other problems
                                                    if entry.get('has_critical_errors'):
                                                        entry['critical_errors'].append(f"Quantity is 1, but similar entries (e.g., {higher_qty_entries[0].get('Mark')}) have quantity {higher_qty_entries[0].get('Qty')} - please verify column alignment")
                                                    else:
                                                        # Even if no other errors, flag for review if pattern is clear
                                                        if len(higher_qty_entries) >= 2:  # Multiple similar entries with higher qty
                                                            entry['critical_errors'].append(f"Quantity is 1, but {len(higher_qty_entries)} similar entries have quantity > 1 - please verify")
                                                            entry['has_critical_errors'] = True
                            # Store schedule type for engineering documents (use first detected type)
                            if department == "engineering" and schedule_type and not detected_schedule_type:
                                detected_schedule_type = schedule_type
                    else:
                        model_actions.append(f"⚠ No data extracted from {filename}")

        # Aggregate transmittal data into structured categories
        transmittal_aggregated = None
        if department == "transmittal" and results:
            transmittal_aggregated = {
                "DrawingRegister": [],
                "Standards": [],
                "Materials": [],
                "Connections": [],
                "Assumptions": [],
                "VOSFlags": [],
                "CrossReferences": []
            }
            for result in results:
                if isinstance(result, dict):
                    # Extract drawing register - handle both dict and list
                    if 'DrawingRegister' in result:
                        dr = result['DrawingRegister']
                        if isinstance(dr, dict):
                            transmittal_aggregated["DrawingRegister"].append(dr)
                        elif isinstance(dr, list):
                            transmittal_aggregated["DrawingRegister"].extend(dr)
                    # Aggregate arrays
                    for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                        if key in result and isinstance(result[key], list):
                            transmittal_aggregated[key].extend(result[key])

        if results:
            session_data = {"department": department, "rows": results}
            if department == "engineering" and 'detected_schedule_type' in locals():
                session_data["schedule_type"] = detected_schedule_type
            if transmittal_aggregated:
                session_data["transmittal_aggregated"] = transmittal_aggregated
            session['last_results'] = session_data
        else:
            session.pop('last_results', None)

    # Get schedule type from session or detected value
    schedule_type = None
    if department == "engineering":
        saved = session.get('last_results', {})
        schedule_type = saved.get('schedule_type')
        if not schedule_type and 'detected_schedule_type' in locals() and detected_schedule_type:
            schedule_type = detected_schedule_type
    
    # Get aggregated transmittal data
    transmittal_data = None
    if department == "transmittal":
        saved = session.get('last_results', {})
        transmittal_data = saved.get('transmittal_aggregated')
        if not transmittal_data and 'transmittal_aggregated' in locals():
            transmittal_data = transmittal_aggregated
        # If still no transmittal_data, try to aggregate from results
        if not transmittal_data and results:
            transmittal_data = {
                "DrawingRegister": [],
                "Standards": [],
                "Materials": [],
                "Connections": [],
                "Assumptions": [],
                "VOSFlags": [],
                "CrossReferences": []
            }
            for result in results:
                if isinstance(result, dict):
                    # Extract drawing register - handle both dict and list
                    if 'DrawingRegister' in result:
                        dr = result['DrawingRegister']
                        if isinstance(dr, dict):
                            transmittal_data["DrawingRegister"].append(dr)
                        elif isinstance(dr, list):
                            transmittal_data["DrawingRegister"].extend(dr)
                    # Aggregate arrays
                    for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                        if key in result and isinstance(result[key], list):
                            transmittal_data[key].extend(result[key])
        # Ensure all keys are lists, not None
        if transmittal_data and isinstance(transmittal_data, dict):
            for key in ['DrawingRegister', 'Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                if key not in transmittal_data or transmittal_data[key] is None:
                    transmittal_data[key] = []
    
    # Group engineering and finance results by filename for separate tables
    grouped_engineering_results = {}
    grouped_finance_results = {}
    if department == 'engineering' and results:
        for row in results:
            filename = row.get('Filename', 'Unknown')
            if filename not in grouped_engineering_results:
                grouped_engineering_results[filename] = []
            grouped_engineering_results[filename].append(row)
    elif department == 'finance' and results:
        for row in results:
            filename = row.get('Filename', 'Unknown')
            if filename not in grouped_finance_results:
                grouped_finance_results[filename] = []
            grouped_finance_results[filename].append(row)
    
    return render_template_string(
        HTML_TEMPLATE,
        results=results if results else [],
        grouped_engineering_results=grouped_engineering_results if department == 'engineering' else {},
        grouped_finance_results=grouped_finance_results if department == 'finance' else {},
        department=department,
        selected_samples=selected_samples,
        sample_files=DEPARTMENT_SAMPLES,
        error=error_message,
        routine_descriptions=ROUTINE_DESCRIPTIONS,
        routine_summary=ROUTINE_SUMMARY.get(department, []),
        model_in_use=last_model_used,
        model_attempts=model_attempts,
        model_actions=model_actions,
        schedule_type=schedule_type,
        transmittal_data=transmittal_data
    )

@app.route('/export_csv')
def export_csv():
    """Export results as CSV"""
    saved = session.get('last_results')
    if not saved or not saved.get('rows'):
        return "No data to export", 404

    department = saved.get('department', DEFAULT_DEPARTMENT)
    df = pd.DataFrame(saved['rows'])

    if department == 'finance':
        df_export = df.copy()
        for currency_col in ['Cost', 'GST', 'FinalAmount']:
            if currency_col in df_export.columns:
                df_export[currency_col] = df_export[currency_col].apply(
                    lambda x: format_currency(x) if x and x not in ("N/A", "") else "N/A"
                )
            else:
                df_export[currency_col] = "N/A"
        columns = ['Filename', 'Vendor', 'Date', 'InvoiceNum', 'Currency', 'Cost', 'GST', 'FinalAmount', 'Summary', 'ABN', 'POReference', 'PaymentTerms', 'DueDate', 'ShippingTerms', 'PortOfLoading', 'PortOfDischarge', 'VesselVoyage', 'BillOfLading', 'HSCodes', 'LineItems', 'Flags']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
        # Convert arrays to strings for CSV
        if 'HSCodes' in df_export.columns:
            df_export['HSCodes'] = df_export['HSCodes'].apply(lambda x: ', '.join(x) if isinstance(x, list) else (x or ''))
        if 'LineItems' in df_export.columns:
            df_export['LineItems'] = df_export['LineItems'].apply(lambda x: json.dumps(x) if isinstance(x, list) else (x or ''))
        if 'Flags' in df_export.columns:
            df_export['Flags'] = df_export['Flags'].apply(lambda x: '; '.join(x) if isinstance(x, list) else (x or ''))
        df_export.columns = ['Filename', 'Vendor', 'Date', 'Invoice #', 'Currency', 'Cost', 'GST', 'Final Amount', 'Summary', 'ABN', 'PO Reference', 'Payment Terms', 'Due Date', 'Shipping Terms', 'Port of Loading', 'Port of Discharge', 'Vessel/Voyage', 'Bill of Lading', 'HS Codes', 'Line Items', 'Flags']
    elif department == 'transmittal':
        df_export = df.copy()
        columns = ['Filename', 'DwgNo', 'Rev', 'Title', 'Scale']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
    elif department == 'engineering':
        df_export = df.copy()
        schedule_type = saved.get('schedule_type')
        if schedule_type == 'column':
            columns = ['Filename', 'Mark', 'SectionType', 'Size', 'Length', 'Grade', 'BasePlate', 'CapPlate', 'Finish', 'Comments']
        else:
            columns = ['Filename', 'Mark', 'Size', 'Qty', 'Length', 'Grade', 'PaintSystem', 'Comments']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
    else:
        df_export = df.copy()
        columns = ['Filename', 'Mark', 'Size', 'Qty', 'Length', 'Grade', 'PaintSystem', 'Comments']
        df_export = df_export[[col for col in columns if col in df_export.columns]]

    output = io.StringIO()
    df_export.to_csv(output, index=False)
    csv_string = output.getvalue()

    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=takeoff_results.csv'}
    )
    return response

@app.route('/export_transmittal_csv')
def export_transmittal_csv():
    """Export a specific transmittal category as CSV"""
    saved = session.get('last_results')
    if not saved:
        return "No data to export", 404
    
    category = request.args.get('category')
    if not category:
        return "Category parameter required", 400
    
    transmittal_data = saved.get('transmittal_aggregated')
    if not transmittal_data or not isinstance(transmittal_data, dict):
        return "No transmittal data available", 404
    
    # Map category names to data keys
    category_map = {
        'DrawingRegister': 'DrawingRegister',
        'Standards': 'Standards',
        'Materials': 'Materials',
        'Connections': 'Connections',
        'Assumptions': 'Assumptions',
        'VOSFlags': 'VOSFlags',
        'CrossReferences': 'CrossReferences'
    }
    
    data_key = category_map.get(category)
    if not data_key or data_key not in transmittal_data:
        return f"Category '{category}' not found", 404
    
    category_data = transmittal_data[data_key]
    if not category_data or len(category_data) == 0:
        return f"No data available for category '{category}'", 404
    
    # Convert to DataFrame
    # Handle DrawingRegister which might be a list of dicts or a single dict
    if data_key == 'DrawingRegister':
        if isinstance(category_data, list):
            df = pd.DataFrame(category_data)
        elif isinstance(category_data, dict):
            df = pd.DataFrame([category_data])
        else:
            return "Invalid data format for DrawingRegister", 500
    else:
        df = pd.DataFrame(category_data)
    
    # Generate filename based on category
    filename_map = {
        'DrawingRegister': 'drawing_register',
        'Standards': 'standards_compliance',
        'Materials': 'material_specifications',
        'Connections': 'connection_details',
        'Assumptions': 'design_assumptions',
        'VOSFlags': 'vos_flags',
        'CrossReferences': 'cross_references'
    }
    
    filename = filename_map.get(category, category.lower())
    
    output = io.StringIO()
    df.to_csv(output, index=False)
    csv_string = output.getvalue()
    
    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename={filename}.csv'}
    )
    return response


@app.route('/sample')
def view_sample():
    requested = request.args.get('path')
    if not requested or requested not in ALLOWED_SAMPLE_PATHS:
        abort(404)

    if not os.path.isfile(requested):
        abort(404)

    return send_file(requested)

# ROI calculator HTML page with iframe (serves roi.html)
@app.route('/roi.html')
def roi_html():
    """Serve roi.html page with iframe to ROI calculator"""
    return send_file('roi.html')

# ROI calculator redirect route (for /roi without .html)
@app.route('/roi')
def roi_redirect():
    """Redirect /roi to /roi.html"""
    return redirect('/roi.html', code=301)

# Blog HTML page with iframe (serves blog.html)
@app.route('/blog.html')
def blog_html():
    """Serve blog.html page with iframe to curam-ai.com.au"""
    return send_file('blog.html')

# Blog redirect route (for /blog without .html)
@app.route('/blog')
def blog_redirect():
    """Redirect /blog to /blog.html"""
    return redirect('/blog.html', code=301)

@app.route('/sitemap.html')
def sitemap_html():
    """Serve sitemap.html page"""
    try:
        return send_file('sitemap.html')
    except:
        return "Sitemap not found.", 404

@app.route('/sitemap.xml')
def sitemap_xml():
    """Serve sitemap.xml for search engines"""
    try:
        return send_file('sitemap.xml', mimetype='application/xml')
    except:
        return "Sitemap XML not found.", 404

# Import ROI calculator routes BEFORE running the app
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    # Mount ROI calculator at /roi-calculator (with trailing slash support)
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
    print("✓ ROI Calculator blueprint registered successfully at /roi-calculator")
except ImportError as e:
    print(f"✗ Warning: Could not import ROI calculator: {e}")
    import traceback
    traceback.print_exc()
except Exception as e:
    print(f"✗ Error registering ROI calculator: {e}")
    import traceback
    traceback.print_exc()

if __name__ == '__main__':
    # This allows local testing
    app.run(debug=True, port=5000)