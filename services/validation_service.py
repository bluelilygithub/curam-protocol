"""
Validation Service - Data validation and error detection

This module provides validation functions for OCR data quality,
character error detection, and engineering field validation.

Functions:
- detect_low_confidence(): Detect low confidence OCR text patterns
- correct_ocr_errors(): Correct common OCR character substitutions
- detect_ocr_character_errors(): Detect potential OCR character errors
- validate_engineering_field(): Validate engineering field values

Usage:
    from services.validation_service import (
        detect_low_confidence,
        correct_ocr_errors,
        validate_engineering_field
    )
    
    confidence = detect_low_confidence("H H o o t l d d")
    # Returns: 'low'
    
    corrected, conf = correct_ocr_errors("310UB77.2", "Size", [])
    # Returns corrected value and confidence level
    
    result = validate_engineering_field("Size", "WB 612.200", {})
    # Returns: {'confidence': 'low', 'errors': [...]}

Created: Phase 3.1 - Validation Service Extraction
Lines: 323 (extracted from main.py lines 3124-3449)
"""

import re


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
        
        # Universal Columns (UC) - correct 8→5, 1→5 errors
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