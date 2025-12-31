"""
Engineering-specific validation for extracted beam/column schedules
Validates against AS 4100 Australian Standards patterns
Provides auto-correction for common OCR errors
"""

import re
from typing import Dict, List, Any, Tuple, Optional

# AS 4100 standard section patterns
VALID_UC_PATTERN = r'^\d{2,3}UC\d{2,3}\.?\d*$'  # e.g., 310UC158, 250UC89.5
VALID_UB_PATTERN = r'^\d{2,3}UB\d{2,3}\.?\d*$'  # e.g., 460UB82.1, 250UB37.2
VALID_WB_PATTERN = r'^WB\d{3,4}[×x]\d{1,2}\.?\d*$'  # e.g., WB1220×6.0
VALID_PFC_PATTERN = r'^\d{2,3}PFC$'  # e.g., 250PFC, 150PFC
VALID_SHS_PATTERN = r'^\d{2,3}[×x]\d{2,3}[×x]\d{1,2}\.?\d*\s*SHS$'  # e.g., 75×75×4 SHS
VALID_RHS_PATTERN = r'^\d{2,3}[×x]\d{2,3}[×x]\d{1,2}\.?\d*\s*RHS$'  # e.g., 100×50×3 RHS

# Valid grade patterns
VALID_GRADES = ['250', '300', '300PLUS', '350', '350L0', '400', '450', 'HA350', 'C300', 'G300', 'Not marked']


def validate_size(size_value: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validate beam/column size against AS 4100 patterns
    
    Returns:
        (is_valid, corrected_value, error_message)
    """
    if not size_value or size_value in ['N/A', '-', '']:
        return False, None, "Size is empty"
    
    size = size_value.strip()
    
    # Check against all valid patterns
    patterns = [
        (VALID_UC_PATTERN, "UC section"),
        (VALID_UB_PATTERN, "UB section"),
        (VALID_WB_PATTERN, "Welded beam"),
        (VALID_PFC_PATTERN, "PFC section"),
        (VALID_SHS_PATTERN, "SHS section"),
        (VALID_RHS_PATTERN, "RHS section")
    ]
    
    for pattern, section_type in patterns:
        if re.match(pattern, size, re.IGNORECASE):
            return True, size, None
    
    # Attempt common corrections
    corrected, correction_msg = attempt_size_correction(size)
    if corrected:
        return False, corrected, f"✓ Auto-corrected: '{size}' → '{corrected}' ({correction_msg})"
    
    return False, None, f"⚠ Invalid format: '{size}' doesn't match AS 4100 pattern"


def attempt_size_correction(size: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Attempt to correct common OCR errors in size values
    
    Returns:
        (corrected_value, correction_message) or (None, None)
    """
    original = size
    corrections = []
    
    # Remove extra spaces
    size = size.replace(' ', '')
    if ' ' in original:
        corrections.append("removed spaces")
    
    # Fix common OCR errors
    # I → 1 in numbers
    if 'I' in size and any(c.isdigit() for c in size):
        size = size.replace('I', '1')
        corrections.append("I→1")
    
    # O → 0 after digits or WB
    size_temp = re.sub(r'(\d)O(\d)', r'\g<1>0\g<2>', size)
    size_temp = re.sub(r'(WB\d+)O', r'\g<1>0', size_temp)
    if size_temp != size:
        size = size_temp
        corrections.append("O→0")
    
    # S → 5 before digits (e.g., "2SOPFC" → "250PFC")
    if 'S' in size and any(c.isdigit() for c in size):
        # Only replace S with 5 if followed by digits or before PFC/UC/UB
        size_temp = re.sub(r'^(\d*)S(\d)', r'\g<1>5\g<2>', size)
        size_temp = re.sub(r'^(\d{2})S(PFC|UC|UB)', r'\g<1>5\g<2>', size_temp)
        if size_temp != size:
            size = size_temp
            corrections.append("S→5")
    
    # Fix × symbol variations
    if 'x' in size.lower() and 'x' not in size:
        size = size.replace('x', '×').replace('X', '×')
        corrections.append("x→×")
    
    # Check if correction helped
    if size != original:
        # Verify corrected value matches a pattern
        patterns = [VALID_UC_PATTERN, VALID_UB_PATTERN, VALID_WB_PATTERN, VALID_PFC_PATTERN, VALID_SHS_PATTERN, VALID_RHS_PATTERN]
        for pattern in patterns:
            if re.match(pattern, size, re.IGNORECASE):
                correction_msg = ", ".join(corrections)
                return size, correction_msg
    
    return None, None


def validate_grade(grade_value: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validate steel grade
    
    Returns:
        (is_valid, corrected_value, error_message)
    """
    if not grade_value or grade_value in ['N/A', '-', '']:
        return True, grade_value, None  # Grade can be empty
    
    grade = grade_value.strip().upper()
    
    # Check if it matches known grades
    if grade in VALID_GRADES:
        return True, grade, None
    
    # Check for "Not marked" or similar
    if 'NOT' in grade.upper() or 'MARKED' in grade.upper():
        return True, "Not marked", None
    
    # Attempt corrections
    # Remove spaces from compound grades
    grade_no_space = grade.replace(' ', '')
    if grade_no_space in VALID_GRADES:
        return False, grade_no_space, f"✓ Auto-corrected: '{grade}' → '{grade_no_space}'"
    
    # Common OCR errors
    if 'L0' in grade or 'LO' in grade:  # L zero vs L O
        grade_corrected = grade.replace('LO', 'L0')
        if grade_corrected in VALID_GRADES:
            return False, grade_corrected, f"✓ Auto-corrected: '{grade}' → '{grade_corrected}'"
    
    return False, None, f"⚠ Unknown grade: '{grade}'"


def validate_length(length_value: Any) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validate length field
    
    Returns:
        (is_valid, corrected_value, error_message)
    """
    if not length_value or length_value in ['N/A', '-']:
        return False, None, "Length is missing"
    
    length = str(length_value).strip()
    
    # Check for VARIES
    if 'VARIES' in length.upper() or 'VAR' in length.upper():
        return True, length, None
    
    # Check if it has units
    if 'mm' in length.lower() or 'm' in length.lower():
        # Extract number
        number = re.search(r'\d+', length)
        if number:
            return True, length, None
    
    # If no units, check if it's a valid number
    if re.match(r'^\d+$', length):
        # Add mm units
        corrected = f"{length} mm"
        return False, corrected, f"✓ Added units: '{length}' → '{corrected}'"
    
    return False, None, f"⚠ Invalid length format: '{length}'"


def validate_quantity(qty_value: Any) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validate quantity field
    
    Returns:
        (is_valid, corrected_value, error_message)
    """
    if not qty_value or qty_value in ['N/A', '-', '']:
        return False, None, "Quantity is missing"
    
    qty = str(qty_value).strip()
    
    # Check if it's a valid integer
    if re.match(r'^\d+$', qty):
        qty_int = int(qty)
        # Sanity check
        if qty_int > 0 and qty_int < 1000:  # Reasonable range
            return True, qty, None
        else:
            return False, None, f"⚠ Quantity {qty_int} seems unusual (expected 1-999)"
    
    return False, None, f"⚠ Invalid quantity format: '{qty}'"


def validate_row(row_data: Dict[str, Any], row_index: int, schedule_type: str = 'beam') -> Dict[str, Any]:
    """
    Validate entire row and return validation report
    
    Returns:
        dict with validation results and suggested corrections
    """
    validations = {
        'row_index': row_index,
        'is_valid': True,
        'errors': [],
        'warnings': [],
        'corrections': [],
        'corrected_row': row_data.copy()
    }
    
    # Validate Mark (must exist)
    if not row_data.get('Mark') or row_data['Mark'] in ['N/A', '-']:
        validations['errors'].append("Mark is missing")
        validations['is_valid'] = False
    
    # Validate Size (CRITICAL)
    size = row_data.get('Size', '')
    is_valid, corrected, msg = validate_size(size)
    if not is_valid:
        if corrected:
            validations['corrections'].append(f"Size: {msg}")
            validations['corrected_row']['Size'] = corrected
            validations['warnings'].append(f"Size auto-corrected: {size} → {corrected}")
        else:
            validations['errors'].append(f"Size: {msg}")
            validations['is_valid'] = False
    
    # Validate Grade
    grade = row_data.get('Grade', '')
    is_valid, corrected, msg = validate_grade(grade)
    if not is_valid:
        if corrected:
            validations['corrections'].append(f"Grade: {msg}")
            validations['corrected_row']['Grade'] = corrected
        else:
            validations['warnings'].append(f"Grade: {msg}")
    
    # Validate Length
    length = row_data.get('Length', '')
    is_valid, corrected, msg = validate_length(length)
    if not is_valid:
        if corrected:
            validations['corrections'].append(f"Length: {msg}")
            validations['corrected_row']['Length'] = corrected
        else:
            validations['errors'].append(f"Length: {msg}")
            validations['is_valid'] = False
    
    # Validate Quantity (if beam schedule)
    if schedule_type == 'beam':
        qty = row_data.get('Qty', '')
        is_valid, corrected, msg = validate_quantity(qty)
        if not is_valid:
            if corrected:
                validations['corrections'].append(f"Qty: {msg}")
                validations['corrected_row']['Qty'] = corrected
            else:
                validations['errors'].append(f"Qty: {msg}")
                validations['is_valid'] = False
    
    return validations


def validate_schedule(entries: List[Dict[str, Any]], schedule_type: str = 'beam') -> Dict[str, Any]:
    """
    Validate entire schedule and return comprehensive report
    
    Args:
        entries: List of extracted row dictionaries
        schedule_type: 'beam' or 'column'
    
    Returns:
        Validation report with corrections and statistics
    """
    report = {
        'total_rows': len(entries),
        'valid_rows': 0,
        'rows_with_errors': 0,
        'rows_with_warnings': 0,
        'rows_with_corrections': 0,
        'row_validations': [],
        'corrected_entries': []
    }
    
    for idx, entry in enumerate(entries):
        validation = validate_row(entry, idx, schedule_type)
        report['row_validations'].append(validation)
        
        if validation['is_valid']:
            report['valid_rows'] += 1
        else:
            report['rows_with_errors'] += 1
        
        if validation['warnings']:
            report['rows_with_warnings'] += 1
        
        if validation['corrections']:
            report['rows_with_corrections'] += 1
        
        report['corrected_entries'].append(validation['corrected_row'])
    
    return report
