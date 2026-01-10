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

# Import prompts from separate modules
try:
    from services.xprompts.xfinance_prompt import get_finance_prompt
    from services.xprompts.xengineering_prompt import get_engineering_prompt
    from services.xprompts.xtransmittal_prompt import get_transmittal_prompt
    from services.xprompts.xlogistics_prompt import get_logistics_prompt
except ImportError as e:
    # Fallback if prompts module not available
    print(f"⚠️ WARNING: Failed to import hardcoded prompts: {e}")
    get_finance_prompt = None
    get_engineering_prompt = None
    get_transmittal_prompt = None
    get_logistics_prompt = None

# Import template sections from separate modules
try:
    from services.templates.logistics_template import get_logistics_template
    from services.templates.transmittal_template import get_transmittal_template
    from services.templates.engineering_template import get_engineering_template
    from services.templates.finance_template import get_finance_template
except ImportError:
    # Fallback if templates module not available
    get_logistics_template = None
    get_transmittal_template = None
    get_engineering_template = None
    get_finance_template = None

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
    """
    Build a prompt tailored to the selected department.
    
    Args:
        text: Document text (already processed/truncated if needed)
        doc_type: Document type (engineering, finance, logistics, transmittal)
        sector_slug: Optional sector slug for sector-specific prompts
    """
    # Validate input text
    if not text or (isinstance(text, str) and not text.strip()):
        print(f"⚠️ WARNING: Empty or None text provided to build_prompt for {doc_type}")
        text = ""
    
    # Map code doc_type values to database doc_type values
    DOC_TYPE_MAP = {
        'engineering': 'beam-schedule',
        'transmittal': 'drawing-register',
        'logistics': 'fta-list',
        'finance': 'vendor-invoice'
    }
    db_doc_type = DOC_TYPE_MAP.get(doc_type, doc_type)
    
    # Try database first
    try:
        from database import build_combined_prompt
        print(f"🔍 [build_prompt] Attempting to load database prompts for doc_type='{doc_type}' -> db_doc_type='{db_doc_type}'")
        print(f"🔍 [build_prompt] Input text length: {len(text) if text else 0} chars")
        db_prompt = build_combined_prompt(db_doc_type, sector_slug, text)
        if db_prompt:
            # Verify the document text is actually in the prompt
            if text and text.strip():
                if text not in db_prompt and text[:100] not in db_prompt:
                    print(f"⚠️ WARNING: Document text not found in generated prompt! Text length: {len(text)}")
                    print(f"🔍 First 100 chars of text: {text[:100]}")
                    print(f"🔍 Prompt contains text marker: {'TEXT:' in db_prompt}")
                else:
                    print(f"✓ Document text verified in prompt (found in prompt)")
            
            print(f"✓ Using database prompt for {doc_type} (db: {db_doc_type}) - length: {len(db_prompt)} chars")
            # Check if test marker is in the FULL prompt (not just first 500 chars)
            test_markers = ["TEST_MARKER", "admin_test", "TEST INSTRUCTION", "TEST:", "CRITICAL TEST"]
            found_markers = [m for m in test_markers if m in db_prompt]
            if found_markers:
                print(f"✅ TEST MARKER(S) FOUND IN DATABASE PROMPT: {', '.join(found_markers)}")
                # Also show first 200 chars of each prompt section
                prompt_sections = db_prompt.split("\n\n---\n\n")
                for i, section in enumerate(prompt_sections[:3], 1):  # First 3 sections
                    if any(m in section for m in test_markers):
                        print(f"  → Test marker found in section {i}: {section[:200]}...")
            else:
                print(f"⚠️ No test markers found in combined prompt (searched for: {', '.join(test_markers)})")
            return db_prompt
        else:
            print(f"⚠️ Database prompt lookup returned None for {doc_type} (db: {db_doc_type})")
    except Exception as e:
        print(f"⚠ Database prompt lookup failed for {doc_type}: {e}")
        import traceback
        traceback.print_exc()
    
    print(f"→ Using hardcoded fallback for {doc_type}")
    
    if doc_type == "engineering":
        # Use modular engineering prompt
        if get_engineering_prompt:
            return get_engineering_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract engineering schedule data from: {text}"
    elif doc_type == "transmittal":
        # Use modular transmittal prompt
        if get_transmittal_prompt:
            return get_transmittal_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract drawing register data from: {text}"
    elif doc_type == "logistics":
        # Use modular logistics prompt
        if get_logistics_prompt:
            return get_logistics_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract Bill of Lading data from: {text}"
    else:
        # Use modular finance prompt
        if get_finance_prompt:
            return get_finance_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract invoice data from: {text}"


# --- HTML TEMPLATE ---

# Import base template
try:
    from services.templates.base_template import get_base_template
    HTML_TEMPLATE = get_base_template()
except ImportError:
    # Fallback: empty template if base_template not available
    HTML_TEMPLATE = ""

# Get template sections
_template_sections = {}
try:
    from services.templates.logistics_template import get_logistics_template
    from services.templates.transmittal_template import get_transmittal_template
    from services.templates.engineering_template import get_engineering_template
    from services.templates.finance_template import get_finance_template
    
    _template_sections['logistics'] = get_logistics_template()
    _template_sections['transmittal'] = get_transmittal_template()
    _template_sections['engineering'] = get_engineering_template()
    _template_sections['finance'] = get_finance_template()
except ImportError:
    # Fallback: will use inline templates
    pass

# Inject modular template sections into HTML_TEMPLATE
import re

def replace_template_section(template, section_name, section_template):
    """Replace a department section in the template with modular version"""
    if not section_template:
        return template
    
    # Find where section starts - try multiple patterns
    start_markers = [
        f"        {{% if department == '{section_name}' %}}",
        f"        {{% if department == '{section_name}' and transmittal_data %}}",  # For transmittal
    ]
    
    start_pos = -1
    start_marker = None
    
    for marker in start_markers:
        pos = template.find(marker)
        if pos != -1:
            start_pos = pos
            start_marker = marker
            break
    
    if start_pos == -1:
        return template  # Section not found, skip replacement
    
    # Find the matching {% endif %} by counting nested if/endif blocks
    # Start from the position after the opening {% if %}
    search_start = start_pos + len(start_marker)
    depth = 1  # We start inside one {% if %} block
    pos = search_start
    
    while pos < len(template) and depth > 0:
        # Look for {% if %} or {% endif %} patterns
        if_match = template.find("{% if", pos)
        endif_match = template.find("{% endif %}", pos)
        
        # Also check for {% elif %} which doesn't change depth
        elif_match = template.find("{% elif", pos)
        
        # Find the earliest match
        matches = []
        if if_match != -1:
            matches.append(('if', if_match))
        if endif_match != -1:
            matches.append(('endif', endif_match))
        if elif_match != -1:
            matches.append(('elif', elif_match))
        
        if not matches:
            break  # No more matches found
        
        # Get the earliest match
        matches.sort(key=lambda x: x[1])
        match_type, match_pos = matches[0]
        
        if match_type == 'if':
            depth += 1
            pos = match_pos + 5
        elif match_type == 'endif':
            depth -= 1
            if depth == 0:
                # Found the matching {% endif %}
                end_pos = match_pos + len("{% endif %}")
                # Replace the section (keep the same indentation)
                template = (
                    template[:start_pos] + 
                    section_template.rstrip() + "\n        " + 
                    template[end_pos:]
                )
                return template
            pos = match_pos + 11
        else:  # elif
            pos = match_pos + 6
    
    # If we didn't find a matching endif, don't replace (safety)
    return template

# Replace all department sections (order matters - do transmittal first as it's largest)
for dept in ['transmittal', 'engineering', 'finance', 'logistics']:
    if dept in _template_sections:
        HTML_TEMPLATE = replace_template_section(HTML_TEMPLATE, dept, _template_sections[dept])

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
    # For logistics and finance, we should NOT truncate or heavily process the text
    # For engineering and transmittal, we need to limit text length
    if doc_type in ["engineering", "transmittal"]:
        prompt_text = prepare_prompt_text(text or "", doc_type, prompt_limit) if text else ""
    else:
        # For logistics and finance, use original text (just ensure it's not None)
        prompt_text = text if text else ""
    
    # Log text length for debugging
    if prompt_text:
        action_log.append(f"Document text length: {len(prompt_text)} chars (doc_type: {doc_type})")
    else:
        action_log.append(f"[WARNING] Empty text provided for {doc_type} document")
    
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
                        action_log.append(f"[ERROR] Image file not found: {image_path}")
                        continue
                    
                    # ENHANCED: Table-optimized image preprocessing
                    try:
                        from services.image_preprocessing import process_image_for_extraction
                        
                        # Process image: enhance for tables, assess quality
                        enhanced_path, ocr_text, quality = process_image_for_extraction(image_path)
                        action_log.append(f"[IMAGE] Image quality: {quality['quality_level']} (sharpness: {quality['sharpness']:.1f})")
                        
                        # Use enhanced image
                        img = Image.open(enhanced_path)
                        
                        # For engineering docs, use focused vision prompt
                        if doc_type == "engineering":
                            vision_prompt = """Extract data from this structural schedule table into JSON.

CRITICAL - COLUMN MAPPING:
Look at the table carefully. Identify these columns by their headers:
1. Mark (member ID like "B1", "NB-01", "C1")
2. Size/Section (CRITICAL - formats like "310UC158", "250UB37.2", "WB1220Ã—6.0")
3. Qty (quantity - numbers)
4. Length (in mm)
5. Grade (steel grade like "300", "300PLUS", "350L0")
6. Paint System (coating type)
7. Comments/Remarks

THE SIZE COLUMN IS CRITICAL:
- Never mark Size as "N/A" unless the cell is truly empty
- Common patterns: "310UC158", "250UB37.2", "200PFC", "WB1220Ã—6.0"
- Extract EXACTLY what you see in each Size cell
- The Size column is usually the 2nd column after Mark

Extract ALL visible rows. Return JSON array only, no markdown.
"""
                            content_parts = [img, vision_prompt]
                        else:
                            # Use regular prompt for other document types
                            content_parts = [img, prompt]
                        
                        response = model.generate_content(content_parts, request_options={"timeout": timeout_seconds})
                        action_log.append(f"Vision API (table-optimized) succeeded with {model_name}")
                        
                    except ImportError:
                        # Fallback: use original image without preprocessing
                        action_log.append("Image preprocessing unavailable - using original")
                        img = Image.open(image_path)
                        content_parts = [img, prompt]
                        response = model.generate_content(content_parts, request_options={"timeout": timeout_seconds})
                        action_log.append(f"Vision API call succeeded with {model_name}")
                    except Exception as img_error:
                        attempt_detail["status"] = "error"
                        attempt_detail["message"] = f"Failed to process image: {img_error}"
                        action_log.append(f"[ERROR] Failed to process image: {img_error}")
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
                    # Logistics returns {document_type: "...", rows: [...]} OR flat array
                    if isinstance(parsed, dict) and "rows" in parsed:
                        entries = parsed["rows"]
                        # Add document_type to each row for display purposes
                        document_type = parsed.get('document_type', 'unknown')
                        for entry in entries:
                            if isinstance(entry, dict):
                                entry['_document_type'] = document_type
                        action_log.append(f"Detected logistics document type: {document_type}")
                    else:
                        # Fallback: treat as regular array and detect document type from fields
                        entries = parsed if isinstance(parsed, list) else [parsed] if isinstance(parsed, dict) else []
                        # Auto-detect document type from field names for backward compatibility
                        if entries and isinstance(entries[0], dict):
                            first_entry = entries[0]
                            detected_type = 'unknown'
                            
                            # Normalize field names: convert snake_case to PascalCase where needed
                            # Also detect document type from field presence
                            
                            # Check for Bill of Lading fields (snake_case or PascalCase)
                            bol_fields = ['bol_number', 'BLNumber', 'waybill_type', 'shipper', 'Shipper', 'consignee', 'Consignee', 
                                         'vessel', 'Vessel', 'container_number', 'ContainerNumber', 'cargo_description']
                            if any(field in first_entry for field in bol_fields):
                                detected_type = 'bill_of_lading'
                                # Normalize field names to PascalCase for template compatibility
                                field_mapping = {
                                    'bol_number': 'BLNumber',
                                    'waybill_type': 'WaybillType',
                                    'shipper': 'Shipper',
                                    'consignee': 'Consignee',
                                    'vessel': 'Vessel',
                                    'container_number': 'ContainerNumber',
                                    'seal_number': 'SealNumber',
                                    'cargo_description': 'CargoDescription',
                                    'gross_weight_kg': 'GrossWeight',
                                    'net_weight_kg': 'NetWeight',
                                    'package_count': 'PackageCount',
                                    'package_type': 'PackageType',
                                    'port_of_loading': 'PortOfLoading',
                                    'port_of_discharge': 'PortOfDischarge'
                                }
                                for entry in entries:
                                    if isinstance(entry, dict):
                                        # Create normalized copy of fields
                                        for old_key, new_key in field_mapping.items():
                                            if old_key in entry and new_key not in entry:
                                                entry[new_key] = entry[old_key]
                            
                            # Check for FTA List fields
                            elif any(field in first_entry for field in ['FTAAgreement', 'fta_agreement', 'CountryOfOrigin', 'country_of_origin', 
                                                                        'ShipmentRef', 'shipment_ref', 'ItemDescription', 'item_description']):
                                detected_type = 'fta_list'
                            
                            # Check for Packing List fields
                            elif any(field in first_entry for field in ['CartonNumber', 'carton_number', 'PONumber', 'po_number', 
                                                                        'Dimensions', 'dimensions', 'Volume', 'volume']):
                                detected_type = 'packing_list'
                            
                            # Set _document_type for all entries
                            for entry in entries:
                                if isinstance(entry, dict):
                                    entry['_document_type'] = detected_type
                            
                            if detected_type != 'unknown':
                                action_log.append(f"Auto-detected logistics document type: {detected_type} from field names")
                            else:
                                action_log.append(f"[WARNING] Could not auto-detect logistics document type. Fields: {list(first_entry.keys())}")
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
                            action_log.append(f"[VALIDATION] Validation: {validation_report['valid_rows']}/{validation_report['total_rows']} rows valid")
                            
                            if validation_report['rows_with_corrections'] > 0:
                                action_log.append(f"Applied {validation_report['rows_with_corrections']} auto-correction(s)")
                                # Use corrected entries
                                entries = validation_report['corrected_entries']
                                
                                # Log specific corrections
                                for row_val in validation_report['row_validations']:
                                    if row_val['corrections']:
                                        mark = row_val['corrected_row'].get('Mark', f"Row {row_val['row_index']}")
                                        for correction in row_val['corrections']:
                                            action_log.append(f"  - {mark}: {correction}")
                            
                            if validation_report['rows_with_errors'] > 0:
                                action_log.append(f"{validation_report['rows_with_errors']} row(s) have errors requiring manual review")
                            
                            if validation_report['rows_with_warnings'] > 0:
                                action_log.append(f"{validation_report['rows_with_warnings']} row(s) have warnings")
                                
                        except ImportError:
                            action_log.append("Engineering validator unavailable - skipping validation")
                        except Exception as val_error:
                            action_log.append(f"Validation error: {val_error}")
                    
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