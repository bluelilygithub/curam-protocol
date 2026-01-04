"""
Gemini AI Service - AI document analysis

Complete Gemini service with all 3 functions.

Functions:
- get_available_models(): Get list of available Gemini models
- build_prompt(): Build AI prompts for each document type
- analyze_gemini(): Call Gemini API with retry logic

Usage:
    from services.gemini_service import analyze_gemini
    
    entries, error, model, attempts, actions, schedule = analyze_gemini(
        text="Invoice text here...",
        doc_type="finance"
    )

Created: Phase 3.3c - Gemini Service Complete (FIXED)
"""

import os
import json
import time
import google.generativeai as genai

# Try to import grpc
try:
    import grpc
except ImportError:
    grpc = None

# Try to import specific exception types
try:
    from google.api_core import exceptions as google_exceptions
except ImportError:
    google_exceptions = None

# Import from other services
from services.pdf_service import prepare_prompt_text

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

# Configure Gemini API
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Global cache for available models
_available_models = None


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


def build_prompt(text, doc_type, sector_slug=None):
    """Build a prompt tailored to the selected department."""
    # Try database first
    try:
        from database import build_combined_prompt
        db_prompt = build_combined_prompt(doc_type, sector_slug, text)
        if db_prompt:
            print(f"✓ Using database prompt for {doc_type}")
            return db_prompt
    except Exception as e:
        print(f"⚠ Database failed: {e}")
    
    print(f"⚠ Using hardcoded fallback for {doc_type}")
    
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

## PRE-EXTRACTION IMAGE ANALYSIS (FOR IMAGE FILES ONLY)

**IMPORTANT**: If processing an image/photo file (not a text-based PDF), perform this analysis FIRST:

### STEP 1: TABLE STRUCTURE IDENTIFICATION
1. Locate the table headers row (usually bold or in a box)
2. Count total number of columns
3. Identify which column is which:
   - Column 1: Usually "Mark" or "Item"
   - Column 2 or 3: Usually "Size" or "Section" ← CRITICAL
   - Find "Qty", "Length", "Grade", "Comments"
4. Note column positions for accurate extraction

### STEP 2: SIZE COLUMN LOCATION VERIFICATION
The "Size" column is THE MOST IMPORTANT:
- Scan headers for "Size", "Section", "Member Size"
- Note which column number it is (e.g., "Column 2")
- Verify by checking first data row - should contain patterns like:
  - "310UC158" (column sections)
  - "250UB37.2" (beam sections)
  - "WB1220×6.0" (welded beams)
  - "250PFC" (parallel flange channels)

### STEP 3: ROW BOUNDARY DETECTION
- Look for horizontal lines separating rows
- If no lines, use vertical alignment of text
- Note any merged cells or multi-line entries

### CRITICAL PRE-FLIGHT CHECK:
Before starting extraction, verify:
□ I can see the table headers
□ I've identified which column is "Size"
□ I can see at least one size value (e.g., "310UC158")
□ I understand the row boundaries

If you CANNOT see size values:
→ Look more carefully in column 2 or 3
→ Check if image is rotated
→ Check if size is split across lines (e.g., "310 / UC / 158")

### STEP 4: MULTI-PASS EXTRACTION FOR IMAGES

For image files, use a three-pass approach:

**PASS 1: Full Table Scan**
- Extract all rows you can see clearly
- Mark uncertain cells as [unclear] but attempt extraction
- Flag any rows where Size = "N/A" for re-examination

**PASS 2: Size Column Deep Dive**
If ANY Size cells show "N/A" after Pass 1:
- Re-examine those specific rows
- Look for size information that might be:
  - Split across multiple lines
  - In a different font/size
  - Partially obscured but partially visible
  - In adjacent cells (column misalignment)
- Only mark "N/A" if genuinely no text visible

**PASS 3: Final Validation**
- Check: Does every row have at least Mark + Size?
- Check: Are all Size values in valid format?
- Check: Do quantities/lengths make sense?
- Flag any anomalies for human review

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
Good: "Install per specification ABC-123 [remainder obscured by stain]"
Bad: "[Comment illegible - manual transcription required]"

Good: "Verify dimensions on site. [handwritten: 'APPROVED - JMc 5/12']"
Bad: "[Comment illegible - manual review required]"

**STEP 3: USE [illegible] ONLY FOR TRULY UNREADABLE TEXT**
- If ANY words are readable extract them
- Use specific markers:
  - [word illegible]
  - [coffee stain obscures text]
  - [smudged]
  - [faded text - partially readable]
  - [remainder obscured]
- Reserve [Comment illegible - manual review required] for when NOTHING can be read

**EXAMPLES:**

Scenario: "Install with [smudge] gasket material"
Extract: "Install with [smudged word] gasket material"
Don't: "[Comment illegible]"

Scenario: Stain covers last 3 words
Extract: "Check actual dimensions before fabrication [coffee stain obscures remainder]"
Don't: "[coffee stain obscures remainder]" as entire comment

Scenario: Handwritten note is clear
Extract: "Original specification. [handwritten: 'CHANGED TO TYPE B - PMG']"
Don't: "[Comment illegible - manual review required]"

**VALIDATION:**
If you marked something [illegible], ask yourself:
- Can I read ANY words? Then extract them + mark specific gap
- Is the entire field truly unreadable? Then use full illegible marker

**Step 2: Read as Phrases, Not Characters**

CHARACTER SOUP DETECTION:

If your extraction looks like: "H o l d 4 O m m g r o u t u n d e r..."
STOP - This is character-level OCR failure
Re-attempt reading as connected words
Try reading at higher magnification
Use context from field type and adjacent data

If still garbled after retry:
Mark: "[Field illegible - OCR failed]"
Do NOT output character soup

UNACCEPTABLE OUTPUTS:
Ã¢ÂÅ’ "H o l d 4 O m g r o u t"
Ã¢ÂÅ’ "W p e e b r b A e S a 1"
Ã¢ÂÅ’ "o x n i s s t i i t n e g"

If your output looks like these You failed. Try again or mark as illegible.

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
- If field ends mid-word Mark as incomplete
- If field seems short for important item Check for continuation
- If unclear portion Use marker: "[coffee stain obscures text]" not "(coffee sta"

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

## ENHANCED OCR ERROR CORRECTION (FOR IMAGES AND POOR SCANS)

When processing images or poor-quality scans, apply these OCR error corrections:

### Common Number/Letter Confusions:

**In numeric contexts** (sizes, quantities, lengths):
- "I" or "l" (lowercase L) → "1" (one)
- "O" (letter O) → "0" (zero)
- "S" → "5" (five) when surrounded by numbers
- "B" → "8" (eight) in numbers
- "Z" → "2" (two) in numbers

**Pattern-Based Auto-Correction Examples:**

If you see "WB I22O× 6 . O":
1. Recognize pattern: WB[depth]×[thickness]
2. Apply corrections: I→1, O→0, remove spaces
3. Result: "WB1220×6.0"
4. Flag: ⚠️ Corrected from OCR: 'WB I22O× 6 . O' → 'WB1220×6.0'

If you see "3IOUCIS8":
1. Recognize pattern: [depth]UC[weight]
2. Apply corrections: I→1, S→5
3. Result: "310UC158"
4. Flag: ⚠️ Corrected from OCR: '3IOUCIS8' → '310UC158'

If you see "2SOPFC" or "25OPFC":
1. Recognize pattern: [depth]PFC
2. Apply corrections: S→5, O→0
3. Result: "250PFC"
4. Flag: ⚠️ Corrected from OCR: '2SOPFC' → '250PFC'

If you see "25O UB 37 . 2":
1. Recognize pattern: [depth]UB[weight]
2. Apply corrections: O→0, remove spaces
3. Result: "250UB37.2"
4. Flag: ⚠️ Corrected from OCR: '25O UB 37 . 2' → '250UB37.2'

**Spacing Errors - Auto-Remove:**
- "250 UB 37 . 2" → "250UB37.2"
- "4 5 0 0" → "4500" (in length column)
- "3 0 0 PLUS" → "300PLUS" (in grade column)
- "WB 1220 × 6 . 0" → "WB1220×6.0"

### Correction Protocol:

1. **Identify the pattern** - What type of value is this (beam size, quantity, etc.)?
2. **Apply known corrections** - Fix obvious OCR errors
3. **Validate result** - Does it match expected format?
4. **Flag the correction** - Always note what was corrected for transparency

### Confidence Scoring After Correction:

- **HIGH confidence**: Pattern clear, single correction applied, result valid
- **MEDIUM confidence**: Multiple corrections needed, result plausible
- **LOW confidence**: Heavy corrections or result uncertain → Flag for review

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
- "CHANGED TO [new specification]" Common
- "MODIFIED TO [new specification]" Common
- "REVISED TO [new specification]" Common
- "UPDATED TO [new specification]" Common
- "APPROVED - [initials] [date]" Common
- "DELETED - NOT REQ'D" Common

Invalid patterns (make no technical sense):
- "CORRODED TO [specification]" Makes no sense
- "DAMAGED TO [specification]" Makes no sense
- "BROKEN TO [specification]" Makes no sense
- "CHEVROLET YO [specification]" Makes no sense
- Any nonsensical phrase Ã¢Å“â€”

**CONSERVATIVE VALIDATION PROTOCOL:**

When handwritten text is unclear:

**STEP 1: Extract what OCR provides**
- Get raw OCR text first
- Don't modify yet

**STEP 2: Check if it makes technical sense**
- Does the phrase make sense in engineering context?
- Do the words form a logical instruction?
- YES: Accept it (even if slightly unclear)
- NO: Go to Step 3

**STEP 3: Try common patterns (only if confident >95%)**
- Match against known patterns: "CHANGED TO [spec]", "DELETED - NOT REQ'D", etc.
- Check if verb makes technical sense:
  - "Changed to", "Modified to", "Revised to" Yes Ã¢Å“â€œ
  - "Corroded to", "Damaged to", "Broken to", "Chevrolet" No Ã¢Å“â€”
- If pattern matches AND confident (>95%):
  - Apply correction
  - Flag: ⚠️ Corrected '[original]' to '[corrected]' (handwriting interpretation)

**STEP 4: If still nonsensical or uncertain:**
- **DO NOT force a correction**
- **DO NOT "correct" to another nonsensical phrase**
- Mark: [handwritten annotation unclear - appears to say "[OCR text]"]
- Flag: ⚠ CRITICAL: Handwritten text unclear - manual verification required
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
- Flag: ⚠ CRITICAL: Handwritten annotation illegible - manual verification required
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
"Original size 250mm. [handwritten: 'CHANGED TO 300mm - approval JD 5/12/19']"
"310UC158 [handwritten: 'CHANGED TO 310UC137 - PMG'] ⚠️ Handwriting partially unclear, size inferred from context"
"310UC158 [handwritten: 'CHANGED TO 310UC137 - PMG'] ⚠️ Corrected 'CORRODED TO' to 'CHANGED TO' (handwriting interpretation)"
"Pending approval [handwritten signature - illegible]"
"[handwritten in red pen: 'DELETED - NOT REQ'D']"

## STRIKETHROUGH TEXT HANDLING - CRITICAL

STRIKETHROUGH TEXT EXTRACTION:

Visual strikethrough lines (red or black) can interfere with OCR but text is still readable.

**CRITICAL RULE: Strikethrough  Illegible**

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
- Strikethrough  illegible
- Text is readable, just marked for deletion
- Extract the data + note deletion status

EXAMPLE:

NB-03 row has red strikethrough:

WRONG: Mark all fields [illegible]

RIGHT:
  Mark: NB-03
  Size: 310UC97
  Qty: 6
  Length: 4500 mm
  Grade: 300PLUS
  Comments: "[row deleted - red strikethrough] [handwritten: 'DELETED - NOT REQ'D']"

VALIDATION CHECK:

If entire row is [illegible] but you can see ANY text:
STOP - re-attempt extraction
Look for strikethrough line interfering
Read text underneath the line
Extract data + note deletion status

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
YES: Attempt extraction (even if uncertain)
NO: Check if strikethrough/markup
  YES: Look underneath, extract + note deletion
  NO: Mark [illegible]

## COLUMN BOUNDARY AWARENESS

CRITICAL RULE - Issues Stay in Their Columns:

COLUMN ISOLATION PROTOCOL:

When encountering issues (stains, damage, illegibility):
Identify WHICH COLUMN contains the issue
Note the issue ONLY in that column
Don't let issues leak into adjacent columns

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
- Cell contains: "" or "-" or "Ã¢â‚¬â€œ"
- Common meanings:
  - Engineering docs: Usually "not applicable"
  - Financial docs: Often "zero" or "TBD"
  - Medical docs: May mean "normal" or "not tested"
- Action: Check document context or legend
- Default: Convert to N/A unless legend specifies otherwise

**Type 4: SPECIAL SYMBOLS**
- *, Ã¢â‚¬Â , Ã¢â‚¬Â¡, (a), (b): Usually reference notes/footnotes
- Extract: The symbol + look for footnote explanation

VALIDATION:
If you extract "" or "-" as a literal value:
STOP and reconsider
Check if document defines what dashes mean
Usually convert to "N/A" unless certain it means something else

CONSISTENCY CHECK:
If some rows have "N/A" and others have "" in same column:
Likely they mean the same thing
Normalize to one format (prefer N/A)

## ACTIVE ERROR CORRECTION

FIX WHAT YOU CAN CONFIDENTLY IDENTIFY:

When you detect an error, decide your confidence level:

**HIGH CONFIDENCE (90%+) FIX IT**
Examples:
- OCR character confusion you can verify (7Ã¢â€ â€™1, 3Ã¢â€ â€™8, OÃ¢â€ â€™0)
- Format errors with clear patterns (spaces in numbers)
- Column misalignment you can verify
- Dash N/A conversion
- Obvious typos in standard terms

Actions:
1. Make the correction
2. Flag it: "⚠️ Corrected from X to Y based on [reason]"
3. Show original OCR in notes for transparency

**MEDIUM CONFIDENCE (60-89%) FIX WITH STRONG FLAG**
Examples:
- Quantity seems wrong based on item context
- Format unusual but could be correct
- Abbreviation unclear

Actions:
1. Make best-guess correction
2. Flag: "Ã°Å¸â€Â Corrected from X to Y - VERIFY THIS"
3. Explain reasoning

**LOW CONFIDENCE (<60%) \u2192 FLAG, DON'T FIX**
Examples:
- True ambiguity in handwriting
- Completely unclear OCR
- Multiple possible interpretations

Actions:
1. Extract what you see
2. Flag: "\u26a0\ufe0f CRITICAL: Value uncertain - MANUAL VERIFICATION REQUIRED"
3. Explain the issue and possible interpretations

WHEN TO CORRECT:
\u2713 Number confusion if you can see actual digit
\u2713 Format errors with clear correct pattern
\u2713 Column misalignment with clear evidence
\u2713 Standard term with obvious misspelling
\u2713 Missing unit when context is clear

WHEN NOT TO CORRECT:
\u2717 True ambiguity you can't resolve
\u2717 Handwriting too unclear to read
\u2717 Missing data (never invent)
\u2717 Unfamiliar terminology (might be correct)

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
- "Existing" section Minimal new specifications
- "New" section Complete specifications required
- "Modified" section Mix of existing + new details

**STEP 3: VALIDATE AGAINST SECTION CONTEXT**
If extraction seems inconsistent with section:
Double-check the value
Verify you're reading correct section
Flag if anomaly confirmed

EXAMPLES:

Item in "EXISTING" section with extensive new specifications:
Flag: "⚠️ Item in existing section but has new specs - verify correct section"

Item in "NEW" section missing key specifications:
Flag: "Ã°Å¸â€Â New item missing expected specifications - verify complete"

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

**Ã°Å¸â€Â REVIEW REQUIRED (Uncertain extraction)**
Use when: Moderate uncertainty, could go either way

Examples:
- "Format unclear - manual verification recommended"
- "Handwritten annotation partially illegible"
- "Value seems inconsistent with context - verify"

Format:
Ã°Å¸â€Â [What's uncertain]: [Why uncertain] - [Suggested action]

**⚠ CRITICAL ERROR (Must fix before use)**
Use when: High certainty something is wrong, or critical field is unclear

Examples:
- "Field illegible - OCR failed completely"
- "Format invalid - MANUAL VERIFICATION REQUIRED before use"
- "Column alignment corrupted - values may be wrong"

Format:
⚠ CRITICAL: [Issue] - [Impact] - MANUAL VERIFICATION REQUIRED

For Every Flag Provide:
- What you extracted
- Why it's flagged (specific reason)
- What the correct value might be (if you have suggestion)
- Impact if error not caught (for critical flags)

## QUALITY VALIDATION CHECKLIST

BEFORE SUBMITTING EXTRACTION, VERIFY:

**Completeness Checks**
Ã¢-Â¡ All readable text extracted? (Used partial extraction before marking illegible)
Ã¢-Â¡ Multi-part fields complete? (Checked for continuation after periods)
Ã¢-Â¡ Handwritten annotations captured? (In [brackets] with original)
Ã¢-Â¡ All columns filled? (Empty cells properly marked as N/A or )

**Accuracy Checks**
Ã¢-Â¡ Format validation passed? (Data matches expected patterns)
Ã¢-Â¡ Cross-field validation done? (Values consistent within row)
Ã¢-Â¡ Section context checked? (Values appropriate for section)
Ã¢-Â¡ Column boundaries respected? (Issues in correct columns)

**Error Handling Checks**
Ã¢-Â¡ Confident corrections applied? (Fixed obvious OCR errors)
Ã¢-Â¡ Uncertainties flagged? (All doubts explicitly marked)
Ã¢-Â¡ No character soup? (No "H o l d 4 O..." output)
Ã¢-Â¡ No invented data? (Only extracted what exists)

**Flag Quality Checks**
Ã¢-Â¡ Each flag has specific reason? (Not generic "check this")
Ã¢-Â¡ Critical issues marked ⚠? (Safety/compliance impacts)
Ã¢-Â¡ Corrections explained? (Showed original + fixed value)
Ã¢-Â¡ Suggested fixes provided? (When confident about correction)

**Consistency Checks**
Ã¢-Â¡ All "Corrected X to Y" flags have corresponding corrected text?
Ã¢-Â¡ Text matches flags? (No flag/text mismatches)
Ã¢-Â¡ Handwriting corrections only applied if confident >95%?
Ã¢-Â¡ Uncertain handwriting marked as unclear (not forced corrections)?
Ã¢-Â¡ No mid-word truncation? (Fields complete, not cut off)
Ã¢-Â¡ All corrections actually applied to text (not just flagged)?

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
   - Size column typically contains: "310UC158", "250UB37.2", "WB1220Ãƒâ€”6.0", "250PFC"
   - If you see ANY text in the Size column area, extract it
   - Common patterns to look for:
     - UC/UB sections: Numbers + "UC" or "UB" + numbers
     - Welded beams: "WB" + numbers + "Ãƒâ€”" + numbers
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
- [ ] Mark values match visible text (check for OCR errors like "NB-OI" "NB-01")
- [ ] Comments column checked (may contain important notes)

**IF SIZE COLUMN IS ALL "N/A":**
This is a CRITICAL ERROR
Re-examine the image for Size column
Look for beam size patterns in the table
Size column is usually 2nd or 3rd column after Mark

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
   - Size column typically contains: "310UC158", "250UB37.2", "WB1220Ãƒâ€”6.0", "250PFC"
   - If you see ANY text in the Size column area, extract it
   - Common patterns to look for:
     - UC/UB sections: Numbers + "UC" or "UB" + numbers (e.g., "310UC158", "250UB37.2")
     - Welded beams: "WB" + numbers + "Ãƒâ€”" + numbers (e.g., "WB1220Ãƒâ€”6.0")
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
   - Watch for: "NB-OI" should be "NB-01" (0Ã¢â€ â€™O, 1Ã¢â€ â€™I confusion)
   - Verify mark values match visible text

**VALIDATION FOR IMAGES:**

Before finalizing extraction, verify:
- [ ] Size column has actual values (not all "N/A")
- [ ] Length includes units ("mm" or "m")
- [ ] Mark values match visible text (check for OCR errors)
- [ ] Comments column checked (may contain important notes)

**IF SIZE COLUMN IS ALL "N/A":**
This is a CRITICAL ERROR
Re-examine the image for Size column
Look for beam size patterns in the table
Size column is usually 2nd or 3rd column after Mark
Check if sizes are split across multiple lines
Verify you're reading the correct column

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
  - Invalid: "310UC15" (too short), "250UB77.2" (check 7Ã¢â€ â€™3 OCR error)
  
- Welded Beams (WB): WB[depth]Ãƒâ€”[thickness]
  - Format: WB[number]Ãƒâ€”[number.number]
  - Examples: "WB1220Ãƒâ€”6.0", "WB610Ãƒâ€”8.0"
  - Invalid: "WB 610 x 27" (spaces), "WB 612.2" (missing Ãƒâ€”), "WB1220x6.0" (lowercase x)
  
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

- If Size contains "WB" Must have format WB[number]Ãƒâ€”[number.number]
- If Size contains "UC" or "UB" Must have format [number][type][number or number.number]
- If Grade is a decimal number (e.g., "37.2") Likely misaligned from Size column
- If Qty = 1 and Size is large beam (e.g., 460UB+) Flag for verification (large beams rarely solo)
- If Comments contains "[handwritten:" Preserve exactly, don't attempt to clean up
- If section header is "EXISTING" Comments may reference existing conditions
- If section header is "NEW" Complete specifications expected

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
| Ãƒâ€” (multiply) | x (letter) | WB1220Ãƒâ€”6.0 not WB1220x6.0 |
| 1220 | 12 20 or 122 0 | Spaces inserted in numbers |
| 2 (quantity) | 1 | Major beams rarely solo |
| HA350 | JSO, JS0, J50 | Grade column context |
| 37.2 | 77.2 | Size weight - check for 7Ã¢â€ â€™3 error |
| 0 (zero) | D (letter) | "40mm" not "4Dmm" - measurements context |
| 0 (zero) | O (letter) | Numbers vs letters in measurements |

### Number OCR Validation - CRITICAL

NUMBER EXTRACTION VALIDATION:

Common OCR errors in numbers and measurements:
- 0 (zero) Ã¢â€ â€ O (letter O) Ã¢â€ â€ D (letter D)
- 1 (one) Ã¢â€ â€ I (letter I) Ã¢â€ â€ l (lowercase L)
- 5 (five) Ã¢â€ â€ S (letter S)
- 8 (eight) Ã¢â€ â€ B (letter B)

VALIDATION FOR MEASUREMENTS:

**Pattern Detection:**
- "4Dmm" Check context
  - Grout dimensions typically: 10mm, 20mm, 30mm, 40mm, 50mm
  - "4Dmm" unlikely (D not a digit)
  - Correct to: "40mm"
  - Flag: ⚠️ Corrected '4Dmm' to '40mm' (OCR DÃ¢â€ â€™0)

**Word Context Validation:**
- "grows" Check context
  - Near "40mm under base plate"
  - Structural term: "grout" (fills gaps)
  - "grows" makes no technical sense
  - Correct to: "grout"
  - Flag: ⚠️ Corrected 'grows' to 'grout' (OCR error)

**PROTOCOL:**
1. Extract raw OCR text
2. Check if makes technical sense in context
3. If nonsensical look for OCR character confusion
4. Apply correction based on context and known patterns
5. Flag the correction with explanation

**EXAMPLES:**
- "4Dmm grout" "40mm grout" ⚠️ Corrected DÃ¢â€ â€™0
- "grows under base" "grout under base" ⚠️ Corrected OCR error
- "calvanited" "galvanised" (if context suggests galvanizing)

### Domain-Specific Word Validation - CRITICAL

CONSTRUCTION/ENGINEERING TERM VALIDATION:

Construction/Engineering terms often get OCR errors. Validate against known vocabulary.

**COATING/FINISH TERMS:**

Common OCR errors:
- "calvanited" "galvanised" Ã¢Å“â€œ
- "galvinized" "galvanised" Ã¢Å“â€œ
- "galvanized" "galvanised" (US spelling, but use Australian "galvanised")
- "stell" "steel" Ã¢Å“â€œ
- "concreat" "concrete" Ã¢Å“â€œ
- "paint" common term Ã¢Å“â€œ

**MATERIAL/SUBSTANCE TERMS:**

- "grows" near "plate/base" likely "grout" Ã¢Å“â€œ
- "epoy" "epoxy" Ã¢Å“â€œ
- "resin" common term Ã¢Å“â€œ
- "mortor" "mortar" Ã¢Å“â€œ
- "compund" "compound" Ã¢Å“â€œ
- "cement" common term Ã¢Å“â€œ

**INSTALLATION TERMS:**

- "torqe" "torque" Ã¢Å“â€œ
- "weld" common term Ã¢Å“â€œ
- "brase" "brace" Ã¢Å“â€œ
- "supplies" "supplier" (in context of "verify with supplier")
- "instal" "install" Ã¢Å“â€œ
- "ancho" "anchor" Ã¢Å“â€œ

**VALIDATION PROTOCOL:**

1. Extract text as-is from OCR
2. Check if term exists in technical dictionary/known terms
3. If not found, look for close matches:
   - Edit distance < 3 characters
   - Phonetically similar
   - Common OCR character substitutions (rÃ¢â€ â€™n, iÃ¢â€ â€™l, etc.)
4. Check context:
   - "[number]mm [substance] under base" expect: grout, mortar, compound, epoxy
   - "Hot dip [coating]" expect: galvanised, painted, coated
   - "verify with [entity]" expect: supplier, engineer, site
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

CORRECT:
Text: "Main support beam. Fly brace @ 1500 centres."
Flag: "⚠️ Corrected 'brase' to 'brace' (OCR error)"

WRONG (Missing Flag):
Text: "Main support beam. Fly brace @ 1500 centres."
Flag: [none]
[Correction applied but no transparency - engineer can't verify]

WRONG (Flag but No Correction):
Text: "Main support beam. Fly brase @ 1500 centres."
Flag: "⚠️ Corrected 'brase' to 'brace' (OCR error)"
[Text still shows error even though flag says corrected]

**CONSISTENCY RULE:**

If flag says "Corrected X to Y" Text MUST show Y, not X
If text shows corrected version Flag MUST explain what was changed

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

If flag says "Corrected X to Y" Text MUST show Y
If text shows X but flag says corrected FIX THE TEXT (mandatory)
If you can't fix the text Change flag to "uncertain" instead of "corrected"

**EXAMPLES:**

CORRECT (Flag/Text Match):
Flag: ⚠️ Corrected 'supplies' to 'supplier' (OCR error)
Text: "Verify with supplier"
[Flag and text match - correction applied]

WRONG (Flag/Text Mismatch):
Flag: ⚠️ Corrected 'supplies' to 'supplier' (OCR error)
Text: "Verify with supplies"
[Flag says corrected but text still shows original - FIX THIS]

**MANDATORY RULE:**
If flag says "Corrected X to Y" Text MUST show Y
If text shows Y but no flag Add flag explaining correction
Every correction MUST have a corresponding flag. No exceptions.

**EXAMPLES:**

"Hot dip galvanised per AS/NZS 4680"
Flag: "⚠️ Corrected 'calvanited' to 'galvanised' (OCR error)"
[Correction applied + flag shown]

"40mm grout under base plate"
Flag: "⚠️ Corrected 'grows' to 'grout' (OCR error)"
[Correction applied + flag shown]

"verify with supplier"
Flag: "⚠️ Corrected 'supplies' to 'supplier' (OCR error)"
[Correction applied + flag shown]

WRONG (Missing Flag):
"Hot dip galvanised per AS/NZS 4680"
Flag: [none]
[Correction applied but no transparency - engineer can't verify what changed]

**SPECIFIC EXAMPLES:**

"Hot dip calvanited" Ã¢â€ â€™
- "calvanited" not in dictionary
- Check similar: "galvanised" (edit distance: 3, common term in context)
- Correction: "Hot dip galvanised"
- Flag: ⚠️ Corrected 'calvanited' to 'galvanised' (OCR error)

"40mm grows under base plate" Ã¢â€ â€™
- "grows" is valid word BUT contextually wrong
- Pattern: "[number]mm [substance] under base"
- Expected substances: grout, mortar, compound, epoxy
- "grows" "grout" (edit distance: 1, contextually correct)
- Correction: "40mm grout under base plate"
- Flag: ⚠️ Corrected 'grows' to 'grout' (likely OCR error)

"verify with supplies" Ã¢â€ â€™
- Context: "verify with [entity]"
- Expected: supplier, engineer, site, manufacturer
- "supplies" "supplier" (edit distance: 1, contextually correct)
- Correction: "verify with supplier"
- Flag: ⚠️ Corrected 'supplies' to 'supplier' (OCR error)

"fly brase @ 1500 centres" Ã¢â€ â€™
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
2. Look for OCR character confusion (9Ã¢â€ â€™7, 0Ã¢â€ â€™O, 1Ã¢â€ â€™I, etc.)
3. If similar to known standard (edit distance Ã¢â€°Â¤ 1):
   - Apply correction if confident (>90%)
   - Flag: ⚠️ Corrected '[original]' to '[corrected]' (OCR error - standard reference)
4. If uncertain, flag for verification

**COMMON STANDARD OCR ERRORS:**

| Actual | Often Misread As | Context Clue |
|--------|------------------|--------------|
| AS1594 | AS1574 | Steel standard (9Ã¢â€ â€™7 confusion) |
| AS/NZS 4680 | AS/NZS 468O | Galvanising standard (0Ã¢â€ â€™O) |
| AS 4100 | AS 4IOO | Steel design (1Ã¢â€ â€™I, 0Ã¢â€ â€™O) |

**EXAMPLES:**

"AS1574" Ã¢â€ â€™
- Not a common standard
- Similar: "AS1594" (known steel standard, edit distance: 1)
- Likely: OCR 9Ã¢â€ â€™7 confusion
- Correction: "AS1594"
- Flag: ⚠️ Corrected 'AS1574' to 'AS1594' (OCR error - standard reference)
- **IMPORTANT: Apply correction to extracted text, not just flag it**

"AS/NZS 4680" Ã¢â€ â€™
- Known standard (galvanising)
- Action: Accept as-is

"AS/NZS 468O" Ã¢â€ â€™
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
  - Size: WB1220Ãƒâ€”6.0 (1220mm deep, 6mm web)
  - Qty: 2
  - Grade: HA350
  - Comment: Should mention "Web beam", "non-standard section per AS1594", "See Detail D-12/S-500"
- Validation: If extracting this beam, double-check these fields

**Grade vs. Size Confusion:**
- Problem: Size weight gets misread as grade
- Wrong: Size: 250UB77.2, Grade: 37.2
- Right: Size: 250UB37.2, Grade: Not marked
- Detection: If grade is a decimal number matching part of size column misalignment

**"Not marked" vs "N/A":**
- "Not marked" = explicitly stated in document (usually Grade column)
- "N/A" = empty cell or dash ()
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
If garbled mark [illegible]
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
Obvious OCR errors correct + flag
Uncertain flag, don't fix

**Use document structure for validation**
Section context matters
Validate against expectations

**Never invent data**
Missing = N/A or [missing]
Don't fill gaps with assumptions

## SUCCESS CRITERIA

Your extraction is successful when:

&#9989; All readable content extracted (nothing missed due to premature [illegible] marking)
&#9989; All format rules followed for engineering documents
&#9989; All uncertainties explicitly flagged with specific reasons
&#9989; No character soup in output
&#9989; Issues noted in correct columns
&#9989; Complete multi-part fields captured
&#9989; Corrections explained transparently
&#9989; Zero silent errors

Remember: This output will be used for critical decisions. Accuracy and transparency are more important than completeness. When in doubt, FLAG IT.

Begin extraction. For each row, apply all validation rules and output in the specified JSON format.

Return ONLY a valid JSON array (no markdown, no explanation, no code blocks).

TEXT: {text}
        """
    elif doc_type == "transmittal":
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
    elif doc_type == "logistics":
        return f"""
You are extracting data from logistics/freight forwarding documents. First, identify the document type, then extract accordingly.

## DOCUMENT TYPES

**BILL OF LADING (B/L):**
- Contains: Shipper, Consignee, B/L number, vessel, container details, cargo
- Purpose: Receipt and contract of carriage
- Extract: All shipment and container details

**FTA LIST (Free Trade Agreement):**
- Contains: Item descriptions, origin countries, FTA status, HS codes
- Purpose: Customs duty concessions
- Extract: All items with origin and FTA eligibility

**TALLY SHEET:**
- Contains: Item/bundle descriptions, quantities, dimensions, weights
- Purpose: Physical count verification
- Extract: All items with measurements

## OUTPUT FORMAT

Return ONLY valid JSON in this exact format:

{{
  "DocumentType": "BOL" or "FTA" or "TALLY",
  "rows": [
    {{
      # For BILL OF LADING (all fields):
      "Shipper": "Shipper company name or N/A",
      "Consignee": "Consignee company name or N/A",
      "BLNumber": "Bill of Lading number or N/A",
      "Vessel": "Vessel name and voyage or N/A",
      "ContainerNumber": "Container number or N/A",
      "SealNumber": "Seal number or N/A",
      "Description": "Cargo description or N/A",
      "Quantity": "Number of packages/units or N/A",
      "Weight": "Gross weight with unit or N/A",
      
      # For FTA LIST (add these fields):
      "ItemDescription": "Item description or N/A",
      "OriginCountry": "Country of origin or N/A",
      "FTAAgreement": "FTA name (e.g., CPTPP, ChAFTA) or N/A",
      "HSCode": "Harmonized System code or N/A",
      "FTAStatus": "Eligible/Not Eligible/Pending or N/A",
      
      # For TALLY SHEET (add these fields):
      "BundleID": "Bundle/package identifier or N/A",
      "Dimensions": "Length x Width x Height or N/A",
      "PieceCount": "Number of pieces or N/A"
    }}
  ]
}}

## EXTRACTION RULES

**General:**
- Extract one row per distinct item/container/shipment line
- Use "N/A" for fields that don't apply to the document type
- Preserve exact formatting of codes and numbers
- Include units with measurements

**For BILL OF LADING:**
- One row per container OR per cargo line if containers aren't specified
- Preserve container number format (e.g., MSKU9922334)
- Include vessel voyage number if present
- Extract all seal numbers

**For FTA LIST:**
- One row per item/product
- Extract full FTA agreement name (not abbreviations if possible)
- Capture origin country exactly as stated
- Extract HS codes with all digits
- Note if FTA status is verified/pending/rejected

**For TALLY SHEET:**
- One row per bundle/item/package
- Extract all measurement dimensions
- Preserve bundle/package identifiers exactly
- Include piece counts and totals

Return ONLY the JSON, no markdown, no explanation, no code blocks.

DOCUMENT TEXT:
{text}
"""
    else:
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
    - "LineTotal": Line total amount (Qty Ãƒâ€” Unit Price, numeric)
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
    - Calculate: ÃŽÂ£(line totals) should equal invoice subtotal
    - Check: All required fields populated
    - Flag: Missing part numbers or quantities
    - Warn: If calculated total  invoice total (>$0.50 difference)
    
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
    Subtotal + Tax = Total (tolerance: Ã‚Â±$0.10)
    All line totals sum to subtotal (tolerance: Ã‚Â±$1.00)
    Unit price Ãƒâ€” Quantity = Line total (per line)
    Currency consistent throughout
    
    FLAG IF:
    ⚠️ Totals don't match Add to flags: "Calculation mismatch - verify manually"
    ⚠️ Missing currency Add to flags: "Currency not specified - assumed [X]"
    ⚠️ Tax rate unusual Add to flags: "GST 10% expected for AU, found X%"
    
    CRITICAL IF:
    ⚠ Total amount missing "CRITICAL: Cannot determine payable amount"
    ⚠ Vendor name unclear "CRITICAL: Vendor identification uncertain"
    
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
    Ã¢ÂÅ’ DON'T: "Construction and forestry parts"
    &#9989; DO: "20 line items: Hydraulic components (filters, cylinders), Engine parts (gaskets, pistons). Major: Hydraulic cylinders ($4,000), Bearings ($2,400)"
    
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
       Flag: "⚠️ Calculation discrepancy: Calculated $X vs Invoice $Y"
       Use invoice stated total (assume correct)
       Note for manual verification
    
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
            content: "Ã¢ÂÅ’";
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
        <h1>&#9889; Consultancy  Takeoff Automator</h1>
        
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
                <label>
                <input type="radio" name="department" value="logistics" {% if department == 'logistics' %}checked{% endif %}>
                    Logistics
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
                        <span class="transmittal-sample-pill">&#9989; {{ sample.label }}</span>
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">&#128279;</a>
                        <input type="hidden" name="transmittal_defaults" value="{{ sample.path }}">
                    </div>
                    {% else %}
                    <label>
                        <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples or ((dept_key == 'engineering' or dept_key == 'finance') and not selected_samples) %}checked{% endif %}>
                        {{ sample.label }}
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">&#128279;</a>
                    </label>
                    {% endif %}
                    {% endfor %}
                </div>
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
                <button type="submit" class="btn">&#128640; Generate Output</button>
            </div>
            <div id="processing-spinner"><span class="spinner-icon"></span>Processing files&#8230;</div>
        </form>

        {% if results %}
        <div id="results-section">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 30px;">
            <h3 style="margin: 0;">Extraction Results</h3>
            <span class="info">{{ results|length }} row(s) processed</span>
        </div>
        
        <div style="background: #e3f2fd; border: 2px solid #2196f3; padding: 10px; margin: 10px 0; border-radius: 4px; font-family: monospace; font-size: 14px;">
            <strong>🔍 UNIVERSAL DEBUG:</strong><br>
            <strong>department:</strong> "{{ department }}"<br>
            <strong>results length:</strong> {{ results|length }}<br>
            {% if results and results|length > 0 %}
            <strong>first result:</strong> {{ results[0] }}<br>
            {% endif %}
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
                                <span style="color: #27ae60; font-weight: 600;">Found</span>
                                {% elif 'no' in found|lower or 'false' in found|lower %}
                                <span style="color: #e74c3c; font-weight: 600;">Missing</span>
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
                                    {{ correction }}
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
                            ⚠ {{ row.rejection_reason }}
                        </div>
                        {% endif %}
                        {% if row.get('Comments_confidence') == 'low' %}<span class="low-confidence-text">{{ row.Comments }}</span>{% else %}{{ row.Comments }}{% endif %}
                        {% if row.get('critical_errors') and row.get('requires_manual_verification') %}
                        <div class="critical-error" style="margin-top: 8px;">
                            <div class="critical-error-header">⚠ Critical Errors - Manual Verification Required:</div>
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
                <td>{{ row.ShippingTerms or 'N/A' }}{% if row.PortOfLoading and row.PortOfLoading != 'N/A' %}<br><small style="color: #666;">{{ row.PortOfLoading }} {{ row.PortOfDischarge or '' }}</small>{% endif %}</td>
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
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.ItemNumber or '' }}</td>
                                {% if row.LineItems[0].get('PartNumber') and row.LineItems[0].PartNumber != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.PartNumber or '' }}</td>
                                {% endif %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Description or 'N/A' }}</td>
                                {% if row.LineItems[0].get('HSCode') and row.LineItems[0].HSCode != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.HSCode or '' }}</td>
                                {% endif %}
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.Quantity or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.UnitPrice or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd; font-weight: bold;">{{ item.LineTotal or 'N/A' }}</td>
                                {% if row.LineItems[0].get('SKU') and row.LineItems[0].SKU != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.SKU or '' }}</td>
                                {% endif %}
                                {% if row.LineItems[0].get('Category') and row.LineItems[0].Category != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Category or '' }}</td>
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
        
        {% if department == 'logistics' %}
        {# DEBUG INFO - Remove after testing #}
        <div style="background: #fff3cd; border: 2px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 8px;">
            <strong>🔍 DEBUG - Logistics Data:</strong><br>
            <strong>results length:</strong> {{ results|length if results else 0 }}<br>
            {% if results and results|length > 0 %}
            <strong>First result keys:</strong> {{ results[0].keys()|list if results[0] is mapping else 'Not a dict' }}<br>
            {% endif %}
        </div>
        
        {% if results %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">📦 Logistics Documents Extracted</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ results|length }} document(s) processed</div>
            </div>
            <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                    <th>Filename</th>
                    {# Dynamically show columns based on what fields exist #}
                    {% if results[0].get('Shipper') and results[0].Shipper != 'N/A' %}
                    <th>Shipper</th>
                    <th>Consignee</th>
                    <th>B/L Number</th>
                    <th>Vessel</th>
                    <th>Container #</th>
                    <th>Seal #</th>
                    <th>Description</th>
                    <th>Quantity</th>
                    <th>Weight</th>
                    {% elif results[0].get('ItemDescription') or results[0].get('OriginCountry') %}
                    <th>Item</th>
                    <th>Origin Country</th>
                    <th>FTA Agreement</th>
                    <th>HS Code</th>
                    <th>FTA Status</th>
                    <th>Quantity</th>
                    {% elif results[0].get('BundleID') %}
                    <th>Bundle ID</th>
                    <th>Description</th>
                    <th>Dimensions</th>
                    <th>Piece Count</th>
                    <th>Quantity</th>
                    <th>Weight</th>
                    {% else %}
                    {# Fallback: show all available fields #}
                    {% for key in results[0].keys() if key != 'Filename' and key != 'TotalFormatted' %}
                    <th>{{ key }}</th>
                    {% endfor %}
                    {% endif %}
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
            <tr>
                <td>{{ row.Filename or 'N/A' }}</td>
                {# Show data based on document type #}
                {% if row.get('Shipper') and row.Shipper != 'N/A' %}
                {# Bill of Lading #}
                <td>{{ row.Shipper or 'N/A' }}</td>
                <td>{{ row.Consignee or 'N/A' }}</td>
                <td>{{ row.BLNumber or 'N/A' }}</td>
                <td>{{ row.Vessel or 'N/A' }}</td>
                <td>{{ row.ContainerNumber or 'N/A' }}</td>
                <td>{{ row.SealNumber or 'N/A' }}</td>
                <td>{{ row.Description or 'N/A' }}</td>
                <td>{{ row.Quantity or 'N/A' }}</td>
                <td>{{ row.Weight or 'N/A' }}</td>
                {% elif row.get('ItemDescription') or row.get('OriginCountry') %}
                {# FTA List #}
                <td>{{ row.ItemDescription or row.Description or 'N/A' }}</td>
                <td>{{ row.OriginCountry or 'N/A' }}</td>
                <td>{{ row.FTAAgreement or 'N/A' }}</td>
                <td>{{ row.HSCode or 'N/A' }}</td>
                <td>{{ row.FTAStatus or 'N/A' }}</td>
                <td>{{ row.Quantity or 'N/A' }}</td>
                {% elif row.get('BundleID') %}
                {# Tally Sheet #}
                <td>{{ row.BundleID or 'N/A' }}</td>
                <td>{{ row.Description or 'N/A' }}</td>
                <td>{{ row.Dimensions or 'N/A' }}</td>
                <td>{{ row.PieceCount or 'N/A' }}</td>
                <td>{{ row.Quantity or 'N/A' }}</td>
                <td>{{ row.Weight or 'N/A' }}</td>
                {% else %}
                {# Fallback: show all available fields #}
                {% for key, value in row.items() if key != 'Filename' and key != 'TotalFormatted' %}
                <td>{{ value }}</td>
                {% endfor %}
                {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
        </div>
        {% else %}
        <div style="background: #fee; border: 2px solid #f00; padding: 15px; margin: 20px 0; border-radius: 8px;">
            <strong>⚠️ No results to display</strong>
        </div>
        {% endif %}
        {% endif %}
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
            <tr>
                <td>{{ row.Filename or 'N/A' }}</td>
                {# Show data based on document type #}
                {% if row.get('Shipper') and row.Shipper != 'N/A' %}
                {# Bill of Lading #}
                <td>{{ row.Shipper or 'N/A' }}</td>
                <td>{{ row.Consignee or 'N/A' }}</td>
                <td>{{ row.BLNumber or 'N/A' }}</td>
                <td>{{ row.Vessel or 'N/A' }}</td>
                <td>{{ row.ContainerNumber or 'N/A' }}</td>
                <td>{{ row.SealNumber or 'N/A' }}</td>
                <td>{{ row.Description or 'N/A' }}</td>
                <td>{{ row.Quantity or 'N/A' }}</td>
                <td>{{ row.Weight or 'N/A' }}</td>
                {% elif row.get('ItemDescription') or row.get('OriginCountry') %}
                {# FTA List #}
                <td>{{ row.ItemDescription or row.Description or 'N/A' }}</td>
                <td>{{ row.OriginCountry or 'N/A' }}</td>
                <td>{{ row.FTAAgreement or 'N/A' }}</td>
                <td>{{ row.HSCode or 'N/A' }}</td>
                <td>{{ row.FTAStatus or 'N/A' }}</td>
                <td>{{ row.Quantity or 'N/A' }}</td>
                {% elif row.get('BundleID') %}
                {# Tally Sheet #}
                <td>{{ row.BundleID or 'N/A' }}</td>
                <td>{{ row.Description or 'N/A' }}</td>
                <td>{{ row.Dimensions or 'N/A' }}</td>
                <td>{{ row.PieceCount or 'N/A' }}</td>
                <td>{{ row.Quantity or 'N/A' }}</td>
                <td>{{ row.Weight or 'N/A' }}</td>
                {% else %}
                {# Fallback: show all available fields #}
                {% for key, value in row.items() if key != 'Filename' and key != 'TotalFormatted' %}
                <td>{{ value }}</td>
                {% endfor %}
                {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
        </div>
        {% else %}
        <div style="background: #fee; border: 2px solid #f00; padding: 15px; margin: 20px 0; border-radius: 8px;">
            <strong>⚠️ No results to display</strong>
        </div>
        {% endif %}
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
                item.textContent = `&#128206; ${file.name}`;
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
def analyze_gemini(text, doc_type, image_path=None, sector_slug=None):
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
    prompt = build_prompt(prompt_text, doc_type, sector_slug)
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
                    # Use Gemini vision API for images with table-optimized preprocessing
                    import pathlib
                    from PIL import Image
                    image_file = pathlib.Path(image_path)
                    if not image_file.exists():
                        attempt_detail["status"] = "error"
                        attempt_detail["message"] = f"Image file not found: {image_path}"
                        action_log.append(f"✗ Image file not found: {image_path}")
                        continue
                    
                    # ENHANCED: Table-optimized image preprocessing
                    try:
                        from services.image_preprocessing import process_image_for_extraction
                        
                        # Process image: enhance for tables, assess quality
                        enhanced_path, ocr_text, quality = process_image_for_extraction(image_path)
                        action_log.append(f"📊 Image quality: {quality['quality_level']} (sharpness: {quality['sharpness']:.1f})")
                        
                        # Use enhanced image
                        img = Image.open(enhanced_path)
                        
                        # For engineering docs, use focused vision prompt
                        if doc_type == "engineering":
                            vision_prompt = """Extract data from this structural schedule table into JSON.

CRITICAL - COLUMN MAPPING:
Look at the table carefully. Identify these columns by their headers:
1. Mark (member ID like "B1", "NB-01", "C1")
2. Size/Section (CRITICAL - formats like "310UC158", "250UB37.2", "WB1220×6.0")
3. Qty (quantity - numbers)
4. Length (in mm)
5. Grade (steel grade like "300", "300PLUS", "350L0")
6. Paint System (coating type)
7. Comments/Remarks

THE SIZE COLUMN IS CRITICAL:
- Never mark Size as "N/A" unless the cell is truly empty
- Common patterns: "310UC158", "250UB37.2", "200PFC", "WB1220×6.0"
- Extract EXACTLY what you see in each Size cell
- The Size column is usually the 2nd column after Mark

Extract ALL visible rows. Return JSON array only, no markdown.
"""
                            content_parts = [img, vision_prompt]
                        else:
                            # Use regular prompt for other document types
                            content_parts = [img, prompt]
                        
                        response = model.generate_content(content_parts, request_options={"timeout": timeout_seconds})
                        action_log.append(f"✓ Vision API (table-optimized) succeeded with {model_name}")
                        
                    except ImportError:
                        # Fallback: use original image without preprocessing
                        action_log.append("⚠ Image preprocessing unavailable - using original")
                        img = Image.open(image_path)
                        content_parts = [img, prompt]
                        response = model.generate_content(content_parts, request_options={"timeout": timeout_seconds})
                        action_log.append(f"✓ Vision API call succeeded with {model_name}")
                    except Exception as img_error:
                        attempt_detail["status"] = "error"
                        attempt_detail["message"] = f"Failed to process image: {img_error}"
                        action_log.append(f"✗ Failed to process image: {img_error}")
                        continue
                else:
                    # Regular text-based processing
                    response = model.generate_content(prompt, request_options={"timeout": timeout_seconds})
                    action_log.append(f"API call succeeded with {model_name}")
                
                resolved_model = model_name

                if not response or not hasattr(response, 'text') or not response.text:
                    print(f"Error: Empty response from Gemini API with model {model_name}")
                    attempt_detail["status"] = "no_response"
                    attempt_detail["message"] = "Empty response"
                    attempt_log.append(attempt_detail)
                    action_log.append(f"Empty response from {model_name}")
                    continue

                # Import sanitization utilities
                from utils.encoding_fix import sanitize_json_response, sanitize_dict
                
                # Clean the JSON string before parsing (fixes corrupt UTF-8 characters)
                clean_json = sanitize_json_response(response.text)
                parsed = json.loads(clean_json)
                
                # Sanitize all string values in the parsed data
                parsed = sanitize_dict(parsed)
                
                # Handle different return structures
                if doc_type == "transmittal":
                    # Transmittal returns a single object with multiple arrays
                    entries = [parsed] if isinstance(parsed, dict) else parsed if isinstance(parsed, list) else []
                elif doc_type == "logistics":
                    # Logistics returns multiple rows like finance
                    entries = [parsed] if isinstance(parsed, dict) else [{}]
                    if isinstance(parsed, dict) and "rows" in parsed:
                        entries = parsed["rows"]
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
                    
                    # PHASE 3: Validate and auto-correct engineering extractions
                    if doc_type == "engineering" and entries:
                        try:
                            from services.engineering_validator import validate_schedule
                            
                            # Run validation
                            validation_report = validate_schedule(entries, schedule_type)
                            
                            # Log validation results
                            action_log.append(f"📋 Validation: {validation_report['valid_rows']}/{validation_report['total_rows']} rows valid")
                            
                            if validation_report['rows_with_corrections'] > 0:
                                action_log.append(f"✓ Applied {validation_report['rows_with_corrections']} auto-correction(s)")
                                # Use corrected entries
                                entries = validation_report['corrected_entries']
                                
                                # Log specific corrections
                                for row_val in validation_report['row_validations']:
                                    if row_val['corrections']:
                                        mark = row_val['corrected_row'].get('Mark', f"Row {row_val['row_index']}")
                                        for correction in row_val['corrections']:
                                            action_log.append(f"  • {mark}: {correction}")
                            
                            if validation_report['rows_with_errors'] > 0:
                                action_log.append(f"⚠ {validation_report['rows_with_errors']} row(s) have errors requiring manual review")
                            
                            if validation_report['rows_with_warnings'] > 0:
                                action_log.append(f"⚠ {validation_report['rows_with_warnings']} row(s) have warnings")
                                
                        except ImportError:
                            action_log.append("⚠ Engineering validator unavailable - skipping validation")
                        except Exception as val_error:
                            action_log.append(f"⚠ Validation error: {val_error}")
                    
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
                    prompt = build_prompt(prompt_text, doc_type, sector_slug)
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

    action_log.append(f"All models failed for this document: {last_error or 'Unknown error'}")
    return [error_entry(last_error or "All models failed")], last_error or "All models failed", resolved_model, attempt_log, action_log, None