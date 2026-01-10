"""






Engineering department prompt for structural schedule extraction






Extracted from gemini_service.py for better maintainability






"""













def get_engineering_prompt(text):






    """






    Generate the engineering extraction prompt






    






    Args:






        text: Extracted text from PDF document






        






    Returns:






        Formatted prompt string for Gemini API






    """






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






✗ "H o l d 4 O m g r o u t"






✗ "W p e e b r b A e S a 1"






✗ "o x n i s s t i i t n e g"













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






- Any nonsensical phrase ✓













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






  - "Changed to", "Modified to", "Revised to" Yes ✓






  - "Corroded to", "Damaged to", "Broken to", "Chevrolet" No ✓






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






- Cell contains: "" or "-" or "—"






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






- OCR character confusion you can verify (7→1, 3→8, O→0)






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






2. Flag: "🔍 Corrected from X to Y - VERIFY THIS"






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






Flag: "🔍 New item missing expected specifications - verify complete"













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






✓ All readable text extracted? (Used partial extraction before marking illegible)






✓ Multi-part fields complete? (Checked for continuation after periods)






✓ Handwritten annotations captured? (In [brackets] with original)






✓ All columns filled? (Empty cells properly marked as N/A or —)













**Accuracy Checks**






✓ Format validation passed? (Data matches expected patterns)






✓ Cross-field validation done? (Values consistent within row)






✓ Section context checked? (Values appropriate for section)






✓ Column boundaries respected? (Issues in correct columns)













**Error Handling Checks**






✓ Confident corrections applied? (Fixed obvious OCR errors)






✓ Uncertainties flagged? (All doubts explicitly marked)






✓ No character soup? (No "H o l d 4 O..." output)






✓ No invented data? (Only extracted what exists)













**Flag Quality Checks**






✓ Each flag has specific reason? (Not generic "check this")






✓ Critical issues marked ⚠? (Safety/compliance impacts)






✓ Corrections explained? (Showed original + fixed value)






✓ Suggested fixes provided? (When confident about correction)













**Consistency Checks**






✓ All "Corrected X to Y" flags have corresponding corrected text?






✓ Text matches flags? (No flag/text mismatches)






✓ Handwriting corrections only applied if confident >95%?






✓ Uncertain handwriting marked as unclear (not forced corrections)?






✓ No mid-word truncation? (Fields complete, not cut off)






✓ All corrections actually applied to text (not just flagged)?













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






   - Watch for: "NB-OI" should be "NB-01" (0→O, 1→I confusion)






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













- If Size contains "WB" Must have format WB[number]×[number.number]






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






- 0 (zero) → O (letter O) → D (letter D)






- 1 (one) → I (letter I) → l (lowercase L)






- 5 (five) → S (letter S)






- 8 (eight) → B (letter B)













VALIDATION FOR MEASUREMENTS:













**Pattern Detection:**






- "4Dmm" Check context






  - Grout dimensions typically: 10mm, 20mm, 30mm, 40mm, 50mm






  - "4Dmm" unlikely (D not a digit)






  - Correct to: "40mm"






  - Flag: ⚠️ Corrected '4Dmm' to '40mm' (OCR D→0)













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






- "4Dmm grout" "40mm grout" ⚠️ Corrected D→0






- "grows under base" "grout under base" ⚠️ Corrected OCR error






- "calvanited" "galvanised" (if context suggests galvanizing)













### Domain-Specific Word Validation - CRITICAL













CONSTRUCTION/ENGINEERING TERM VALIDATION:













Construction/Engineering terms often get OCR errors. Validate against known vocabulary.













**COATING/FINISH TERMS:**













Common OCR errors:






- "calvanited" "galvanised" ✓






- "galvinized" "galvanised" ✓






- "galvanized" "galvanised" (US spelling, but use Australian "galvanised")






- "stell" "steel" ✓






- "concreat" "concrete" ✓






- "paint" common term ✓













**MATERIAL/SUBSTANCE TERMS:**













- "grows" near "plate/base" likely "grout" ✓






- "epoy" "epoxy" ✓






- "resin" common term ✓






- "mortor" "mortar" ✓






- "compund" "compound" ✓






- "cement" common term ✓













**INSTALLATION TERMS:**













- "torqe" "torque" ✓






- "weld" common term ✓






- "brase" "brace" ✓






- "supplies" "supplier" (in context of "verify with supplier")






- "instal" "install" ✓






- "ancho" "anchor" ✓













**VALIDATION PROTOCOL:**













1. Extract text as-is from OCR






2. Check if term exists in technical dictionary/known terms






3. If not found, look for close matches:






   - Edit distance < 3 characters






   - Phonetically similar






   - Common OCR character substitutions (r→n, i→l, etc.)






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













"Hot dip calvanited" →






- "calvanited" not in dictionary






- Check similar: "galvanised" (edit distance: 3, common term in context)






- Correction: "Hot dip galvanised"






- Flag: ⚠️ Corrected 'calvanited' to 'galvanised' (OCR error)













"40mm grows under base plate" →






- "grows" is valid word BUT contextually wrong






- Pattern: "[number]mm [substance] under base"






- Expected substances: grout, mortar, compound, epoxy






- "grows" "grout" (edit distance: 1, contextually correct)






- Correction: "40mm grout under base plate"






- Flag: ⚠️ Corrected 'grows' to 'grout' (likely OCR error)













"verify with supplies" →






- Context: "verify with [entity]"






- Expected: supplier, engineer, site, manufacturer






- "supplies" "supplier" (edit distance: 1, contextually correct)






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













✓ All readable content extracted (nothing missed due to premature [illegible] marking)






✓ All format rules followed for engineering documents






✓ All uncertainties explicitly flagged with specific reasons






✓ No character soup in output






✓ Issues noted in correct columns






✓ Complete multi-part fields captured






✓ Corrections explained transparently






✓ Zero silent errors













Remember: This output will be used for critical decisions. Accuracy and transparency are more important than completeness. When in doubt, FLAG IT.













Begin extraction. For each row, apply all validation rules and output in the specified JSON format.













Return ONLY a valid JSON array (no markdown, no explanation, no code blocks).













TEXT: {text}






    """