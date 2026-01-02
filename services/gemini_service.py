"""
Gemini AI Service - AI document analysis
Refactored to use centralized prompts and global configuration.
"""

import os
import json
import time
import google.generativeai as genai
from typing import List, Dict, Any, Tuple, Optional

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

# Import Elite Prompt logic from centralized file
from utils.prompts import build_prompt

# Import from other services
from services.pdf_service import prepare_prompt_text

# Import configuration constants from global config
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
        models_list = list(models)
        for m in models_list:
            try:
                model_name = m.name
                if model_name.startswith('models/'):
                    model_name = model_name.replace('models/', '')
                
                supported_methods = getattr(m, 'supported_generation_methods', [])
                methods = list(supported_methods) if hasattr(supported_methods, '__iter__') else []
                
                if 'generateContent' in methods or len(methods) == 0:
                    _available_models.append(model_name)
            except Exception:
                continue
        return _available_models
    except Exception as e:
        print(f"Error listing models: {e}")
        return ['gemini-2.0-flash-exp', 'gemini-1.5-flash-latest']

def analyze_gemini(text, doc_type, image_path=None, sector_slug=None):
    """Call Gemini with a doc-type-specific prompt and centralized validation."""
    
    # Initialize fields based on detected type
    if doc_type == "engineering":
        fields = ENGINEERING_BEAM_FIELDS
    else:
        fields = DOC_FIELDS.get(doc_type, FINANCE_FIELDS)
    
    error_field = ERROR_FIELD.get(doc_type, fields[-1])

    def error_entry(message):
        return {field: (message if field == error_field else "AI Error") for field in fields}

    if not api_key:
        return [error_entry("MISSING API KEY")], "MISSING API KEY", None, [], [], None

    # Handle image file markers
    if text and text.startswith("[IMAGE_FILE:"):
        image_path = text.replace("[IMAGE_FILE:", "").rstrip("]")
        text = None
    
    available_models = get_available_models()
    # Updated preferred model order
    stable_preferred = ['gemini-2.0-flash-exp', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest']
    model_names = [m for m in stable_preferred if m in available_models] or stable_preferred[:2]
    
    action_log = [f"Model selection: using {', '.join(model_names)}"]

    # Use 100k limit from config.py
    prompt_limit = ENGINEERING_PROMPT_LIMIT if doc_type == "engineering" else TRANSMITTAL_PROMPT_LIMIT
    
    # Prepare text and build prompt using the Elite logic from prompts.py
    prompt_text = prepare_prompt_text(text or "", doc_type, prompt_limit)
    
    # Logic to merge Database refinements with Python Elite prompts
    try:
        from database import build_combined_prompt
        db_prompt = build_combined_prompt(doc_type, sector_slug, prompt_text)
        if db_prompt:
            prompt = db_prompt
            action_log.append("Using database-augmented prompt")
        else:
            prompt = build_prompt(prompt_text, doc_type)
            action_log.append(f"Using Elite Python prompt for {doc_type}")
    except Exception:
        prompt = build_prompt(prompt_text, doc_type)
        action_log.append("Database check failed, using Elite Python fallback")

    last_error = None
    resolved_model = None
    attempt_log = []

    for model_name in model_names:
        for attempt in range(3):
            attempt_detail = {"model": model_name, "attempt": attempt + 1, "status": "pending"}
            try:
                model_instance = genai.GenerativeModel(model_name)
                timeout = 90 if doc_type == "engineering" else 30

                if image_path and os.path.exists(image_path):
                    from PIL import Image
                    from services.image_preprocessing import process_image_for_extraction
                    
                    # Apply table-optimized preprocessing
                    enhanced_path, _, quality = process_image_for_extraction(image_path)
                    img = Image.open(enhanced_path)
                    
                    # For Vision, we use the Elite prompt logic as the instruction
                    response = model_instance.generate_content([prompt, img], request_options={"timeout": timeout})
                else:
                    response = model_instance.generate_content(prompt, request_options={"timeout": timeout})

                if not response or not response.text:
                    continue

                # Sanitization and JSON parsing
                from utils.encoding_fix import sanitize_json_response, sanitize_dict
                clean_json = sanitize_json_response(response.text)
                parsed = json.loads(clean_json)
                entries = sanitize_dict(parsed) if isinstance(parsed, (list, dict)) else []
                
                # Normalize structure
                if not isinstance(entries, list): entries = [entries]

                # Detection of Engineering schedule types
                schedule_type = "beam"
                if doc_type == "engineering" and entries:
                    if any(k in entries[0] for k in ["SectionType", "BasePlate", "CapPlate"]):
                        schedule_type = "column"
                
                # External Engineering Validation (AS 4100)
                if doc_type == "engineering":
                    try:
                        from services.engineering_validator import validate_schedule
                        report = validate_schedule(entries, schedule_type)
                        entries = report['corrected_entries']
                        action_log.append(f"Applied {report['rows_with_corrections']} engineering corrections")
                    except Exception as e:
                        action_log.append(f"Validator skipped: {e}")

                return entries, None, model_name, attempt_log, action_log, schedule_type

            except Exception as e:
                last_error = str(e)
                time.sleep(2 ** attempt)
                continue
    
    return [error_entry(last_error)], last_error, None, attempt_log, action_log, Nonegei