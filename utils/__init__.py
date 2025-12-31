"""
Utility functions for the Curam-Ai automater application.
"""

from .formatting import format_currency, format_text_to_html, clean_text, normalize_whitespace
from .prompts import build_finance_prompt, build_engineering_prompt, build_transmittal_prompt
from .encoding_fix import (
    sanitize_text,
    sanitize_dict,
    sanitize_json_response,
    create_safe_template_filter,
    sanitize_response_middleware,
    sanitize_csv_export,
    sanitize_database_record
)

__all__ = [
    'format_currency',
    'format_text_to_html',
    'clean_text',
    'normalize_whitespace',
    'build_finance_prompt',
    'build_engineering_prompt',
    'build_transmittal_prompt',
    'sanitize_text',
    'sanitize_dict',
    'sanitize_json_response',
    'create_safe_template_filter',
    'sanitize_response_middleware',
    'sanitize_csv_export',
    'sanitize_database_record',
]

