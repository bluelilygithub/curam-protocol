# -*- coding: utf-8 -*-
"""
UTF-8 Encoding Sanitizer - Clean corrupt characters after data extraction

This module provides utilities to fix garbled UTF-8 characters that commonly
appear after PDF extraction, OCR, or double-encoding issues.

Usage:
    from utils.encoding_fix import sanitize_text, sanitize_dict
    
    # Clean a string
    clean_text = sanitize_text("Curam\\xe2\\x84\\xa2")  # Returns "Curam™"
    
    # Clean all strings in a dict/list structure
    clean_data = sanitize_dict({"name": "Curam\\xe2\\x84\\xa2"})
"""

import re
import json
from typing import Any, Dict, List, Union

# Try to import ftfy for advanced encoding fixes (optional)
try:
    import ftfy
    HAS_FTFY = True
except ImportError:
    HAS_FTFY = False


# Common UTF-8 corruption patterns - using byte sequences
def get_encoding_fixes():
    """Build encoding fixes dict to avoid file encoding issues"""
    fixes = {}
    
    # Trademark and copyright
    fixes['\xe2\x84\xa2'] = '\u2122'  # TM
    fixes['\xc2\xa9'] = '\xa9'  # Copyright
    fixes['\xc2\xae'] = '\xae'  # Registered
    
    # Check marks and bullets
    fixes['\xc3\x83\xc2\xa2\xc3\x85\xe2\x80\x9c\xc3\xa2\xe2\x82\xac\xc5\x93'] = '\u2713'  # Check mark
    fixes['\xc3\xa2\xc5\x93\xe2\x80\x9c'] = '\u2713'  # Check mark
    fixes['\xc3\xa2\xc3\xaf\xe2\x80\x9a\xc2\xbf\xc3\x82\xc5\x93\xc3\xa2\xc5\x93\xe2\x80\x9c'] = '\u2713'  # Check mark (another variant)
    fixes['\xc3\x83\xc2\xa2\xc3\xa2\xe2\x82\xac\xc2\xa0\xc3\xa2\xe2\x82\xac\xe2\x84\xa2'] = '\u2022'  # Bullet
    fixes['\xc3\xa2\xe2\x80\xa2'] = '\u2022'  # Bullet
    fixes['\xc2\xa2'] = '\u2022'  # Bullet
    
    # Quotes and apostrophes
    fixes['\xc3\xa2\xe2\x82\xac\xe2\x84\xa2'] = "'"  # Right single quote
    fixes['\xe2\x80\x99'] = "'"  # Right single quote
    fixes['\xe2\x80\x9c'] = '"'  # Left double quote
    fixes['\xe2\x80\x9d'] = '"'  # Right double quote
    
    # Dashes
    fixes['\xc3\xa2\xe2\x82\xac\xe2\x80\x9c'] = '\u2013'  # En dash
    fixes['\xc3\xa2\xe2\x82\xac\xe2\x80\x9d'] = '\u2014'  # Em dash
    fixes['\xc3\xa2\xe2\x82\xac\xe2\x80\x9c\xc3\x82'] = '-'  # Dash corruption variant
    fixes['\xe2\x80\x93'] = '\u2013'  # En dash
    fixes['\xe2\x80\x94'] = '\u2014'  # Em dash
    
    # Common spacing issues
    fixes['\xc2\xa0'] = ' '  # Non-breaking space
    fixes['\xa0'] = ' '  # Non-breaking space
    fixes['\u200b'] = ''  # Zero-width space
    fixes['\u200c'] = ''  # Zero-width non-joiner
    fixes['\u200d'] = ''  # Zero-width joiner
    fixes['\ufeff'] = ''  # Zero-width no-break space (BOM)
    
    return fixes


ENCODING_FIXES = get_encoding_fixes()


def sanitize_text(text: str) -> str:
    """
    Clean a single text string of UTF-8 encoding corruption.
    
    Args:
        text: The string to sanitize
        
    Returns:
        Cleaned string with proper UTF-8 characters
    """
    if not isinstance(text, str):
        return text
    
    if not text:
        return text
    
    # Use ftfy if available (catches edge cases)
    if HAS_FTFY:
        try:
            text = ftfy.fix_text(text)
        except Exception:
            pass  # Fall back to manual fixes
    
    # Apply manual fixes
    for corrupt, correct in ENCODING_FIXES.items():
        if corrupt in text:
            text = text.replace(corrupt, correct)
    
    # Aggressive cleanup: Remove common corruption prefixes that slip through
    # Using byte-based patterns to avoid encoding issues in the source file
    try:
        # Remove common corruption byte sequences
        text = text.replace('\xc3\xa2\xe2\x82\xac\xe2\x80\x9c\xc3\x82', '')  # Dash corruption
        text = text.replace('\xc3\xa2\xc3\xaf\xe2\x80\x9a\xc2\xbf\xc3\x82\xc5\x93', '')  # Garbled check/bullet
        text = text.replace('\xc3\xa2\xc2', '')  # Partial corruption prefix
        text = text.replace('\xc3\x82\xc2', '')  # Partial corruption prefix
        text = text.replace('\xc3\x83\xe2\x80', '')  # Partial corruption prefix
        
        # Remove orphaned high-bytes that indicate corruption
        text = re.sub(r'[\xc2-\xc3][\x80-\xbf]*(?=\s|$)', '', text)
    except Exception:
        pass  # If cleanup fails, continue with basic sanitization
    
    # Remove any remaining control characters (except newlines, tabs)
    text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', text)
    
    # Normalize multiple spaces to single space
    text = re.sub(r' +', ' ', text)
    
    return text.strip()


def sanitize_dict(data: Any) -> Any:
    """
    Recursively sanitize all string values in a dict, list, or nested structure.
    
    Args:
        data: Dict, list, or any value to sanitize
        
    Returns:
        Sanitized data structure with clean strings
    """
    if isinstance(data, dict):
        return {key: sanitize_dict(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [sanitize_dict(item) for item in data]
    elif isinstance(data, str):
        return sanitize_text(data)
    else:
        return data


def sanitize_json_response(json_text: str) -> str:
    """
    Clean JSON response text before parsing.
    
    Removes common JSON wrapper patterns and sanitizes content.
    
    Args:
        json_text: Raw JSON string from API
        
    Returns:
        Clean JSON string ready to parse
    """
    if not isinstance(json_text, str):
        return json_text
    
    # Remove markdown code fences
    json_text = json_text.replace("```json", "").replace("```", "")
    
    # Sanitize the text
    json_text = sanitize_text(json_text)
    
    return json_text.strip()


def create_safe_template_filter():
    """
    Create a Jinja2 template filter for automatic sanitization.
    
    Usage in Flask:
        app.jinja_env.filters['sanitize'] = create_safe_template_filter()
        
    Usage in template:
        {{ variable | sanitize }}
    
    Returns:
        Template filter function
    """
    def safe_filter(value):
        if isinstance(value, str):
            return sanitize_text(value)
        return value
    
    return safe_filter


def sanitize_response_middleware(response):
    """
    Flask middleware to sanitize all HTML responses.
    
    Usage in Flask:
        app.after_request(sanitize_response_middleware)
    
    Args:
        response: Flask response object
        
    Returns:
        Sanitized response object
    """
    # Only sanitize HTML responses
    if response.content_type and 'text/html' in response.content_type:
        try:
            # Get response data as string
            data = response.get_data(as_text=True)
            
            # Sanitize
            clean_data = sanitize_text(data)
            
            # Set back
            response.set_data(clean_data)
        except Exception as e:
            # Don't break the response if sanitization fails
            print(f"Warning: Response sanitization failed: {e}")
    
    return response


def sanitize_csv_export(df):
    """
    Sanitize all string columns in a pandas DataFrame for CSV export.
    
    Args:
        df: pandas DataFrame
        
    Returns:
        Sanitized DataFrame
    """
    try:
        import pandas as pd
        
        for col in df.columns:
            if df[col].dtype == 'object':  # String columns
                df[col] = df[col].apply(lambda x: sanitize_text(x) if isinstance(x, str) else x)
        
        return df
    except ImportError:
        return df


def sanitize_database_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sanitize a database record before saving.
    
    Args:
        record: Dictionary of database fields
        
    Returns:
        Sanitized record
    """
    return sanitize_dict(record)


# Quick test function
def test_sanitizer():
    """
    Test the sanitizer with common corruption patterns.
    
    Returns:
        Dict of test results
    """
    test_cases = {
        "trademark": ("\xe2\x84\xa2", "\u2122"),
        "checkmark": ("\xc3\x83\xc2\xa2\xc3\x85\xe2\x80\x9c\xc3\xa2\xe2\x82\xac\xc5\x93", "\u2713"),
        "bullet": ("\xc3\x83\xc2\xa2\xc3\xa2\xe2\x82\xac\xc2\xa0\xc3\xa2\xe2\x82\xac\xe2\x84\xa2", "\u2022"),
        "quote": ("\xe2\x80\x99", "'"),
        "dash": ("\xe2\x80\x94", "\u2014"),
    }
    
    results = {}
    for name, (corrupt, expected) in test_cases.items():
        cleaned = sanitize_text(corrupt)
        passed = cleaned == expected
        results[name] = {
            "input": corrupt,
            "expected": expected,
            "output": cleaned,
            "passed": "\u2713" if passed else "\u2717"
        }
    
    return results


if __name__ == "__main__":
    # Run tests if executed directly
    print("Testing UTF-8 Encoding Sanitizer\n")
    results = test_sanitizer()
    
    for name, result in results.items():
        status = result['passed']
        print(f"{status} {name.capitalize()}: '{result['input']}' -> '{result['output']}'")
        if result['passed'] == '\u2717':
            print(f"  Expected: '{result['expected']}'")
