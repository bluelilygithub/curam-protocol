"""
Automater Routes Blueprint

This module contains the main document extraction routes:
- /automater (GET, POST) - Main extraction interface
- /extract (GET, POST) - Alias for automater

The core extraction logic is in the index_automater() function.
"""

import os
import time
from flask import Blueprint, request, render_template_string, session
from werkzeug.utils import secure_filename

# Import configuration
from config import (
    FINANCE_UPLOAD_DIR,
    DEFAULT_DEPARTMENT,
    DEPARTMENT_SAMPLES,
    ROUTINE_DESCRIPTIONS,
    ROUTINE_SUMMARY
)
# SAMPLE_TO_DEPT now built dynamically via utils.sample_loader

# Import database functions
# Sample loading now handled by utils.sample_loader

# Import services
from services.pdf_service import extract_text
from services.gemini_service import analyze_gemini, HTML_TEMPLATE
from services.validation_service import (
    detect_low_confidence,
    correct_ocr_errors,
    validate_engineering_field
)

# Import utilities
from utils.formatting import format_currency

# Create blueprint
automater_bp = Blueprint('automater', __name__)


@automater_bp.route('/automater', methods=['GET', 'POST'])
@automater_bp.route('/extract', methods=['GET', 'POST'])
def automater():
    """Main extraction route - calls index_automater()"""
    return index_automater()


def index_automater():
    """
    Main document extraction logic
    
    Handles:
    - File uploads and sample selection
    - Text extraction from PDFs/images
    - AI analysis via Gemini API
    - Result formatting and validation
    - Session management
    - Template rendering
    """
    department = request.form.get('department') or request.args.get('department')
    results = []  # Flat list for UI display (grouped by document type)
    results_by_file = {}  # Grouped by file for API integration
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
        elif department == 'logistics':
            selected_samples = request.form.getlist('samples')
            model_actions.append(f"Logistics mode: selected_samples from form = {selected_samples}")
        else:
            selected_samples = request.form.getlist('samples')
            model_actions.append(f"Non-engineering mode: selected_samples from form = {selected_samples}")
        
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
                    model_actions.append(f"ERROR: {filename} rejected (not a PDF)")
                    break
                unique_name = f"{int(time.time() * 1000)}_{filename}"
                file_path = os.path.join(FINANCE_UPLOAD_DIR, unique_name)
                file_storage.save(file_path)
                finance_uploaded_paths.append(file_path)
                model_actions.append(f"Uploaded invoice saved: {file_path}")
            selected_samples.extend(finance_uploaded_paths)

        # Filter samples to only those matching the current department (skip for auto-select departments)
        if department == 'transmittal':
            samples = [sample for sample in selected_samples if sample]
        else:
            # Simple check: path must start with samples/{department}/
            expected_prefix = f"samples/{department}/"
            samples = [
                sample for sample in selected_samples
                if sample and sample.startswith(expected_prefix)
            ]
        # Log what was selected for debugging
        if selected_samples:
            model_actions.append(f"Selected samples: {selected_samples}")
            for sample in selected_samples:
                if sample:
                    # Extract department from path (samples/{dept}/...)
                    dept_match = "NOT FOUND"
                    if sample.startswith("samples/"):
                        parts = sample.split("/")
                        if len(parts) >= 2:
                            dept_match = parts[1]  # Extract department from path
                    model_actions.append(f"  - {sample}: mapped to department '{dept_match}'")
            model_actions.append(f"Filtered to department '{department}': {samples}")
        else:
            model_actions.append("No samples selected in form")

        # Check if there's anything to process
        if not samples:
            if selected_samples:
                error_message = f"No samples matched department '{department}'. Selected: {selected_samples}"
                model_actions.append(f"ERROR: {error_message}")
            else:
                error_message = "Please select at least one sample file."
                model_actions.append(f"ERROR: {error_message}")

        if not error_message:
            if samples:
                model_actions.append(f"Processing {len(samples)} sample file(s)")
                for sample_path in samples:
                    if not os.path.exists(sample_path):
                        error_msg = f"File not found: {sample_path}"
                        model_actions.append(f"{error_msg}")
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
                            model_actions.append(f"Text extraction failed for {filename}: {text}")
                            if not error_message:
                                error_message = f"Text extraction failed for {filename}"
                            continue
                        else:
                            model_actions.append(f"Text extracted successfully ({len(text)} characters)")
                    
                    model_actions.append(f"Analyzing {filename} with AI models")
                    sector_slug = request.args.get("sector", "professional-services")
                    entries, api_error, model_used, attempt_log, file_action_log, schedule_type = analyze_gemini(
                        text, department, image_path, sector_slug=sector_slug
                    )
                    if file_action_log:
                        model_actions.extend(file_action_log)
                    if model_used:
                        last_model_used = model_used
                        model_actions.append(f"Successfully processed {filename} with {model_used}")
                    if attempt_log:
                        model_attempts.extend(attempt_log)
                    if api_error:
                        model_actions.append(f"Failed to process {filename}: {api_error}")
                        if not error_message:
                            error_message = api_error
                    
                    # Debug logging for logistics before processing entries
                    if department == "logistics":
                        print(f"🔍 LOGISTICS DEBUG: analyze_gemini returned:")
                        print(f"  - entries type: {type(entries)}")
                        print(f"  - entries length: {len(entries) if entries else 0}")
                        print(f"  - api_error: {api_error}")
                        if entries and len(entries) > 0:
                            print(f"  - first entry type: {type(entries[0])}")
                            if isinstance(entries[0], dict):
                                print(f"  - first entry keys: {list(entries[0].keys())}")
                    
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
                                model_actions.append(f"Extracted structured data from {filename}")
                            else:
                                # Fallback to old format
                                for entry in entries if isinstance(entries, list) else [entries]:
                                    entry['Filename'] = filename
                                    results.append(entry)
                                model_actions.append(f"Extracted {len(entries)} row(s) from {filename}")
                        elif department == "logistics":
                            # Logistics returns multiple rows like finance/engineering
                            model_actions.append(f"Extracted {len(entries)} row(s) from {filename}")
                            print(f"🔍 LOGISTICS DEBUG: Processing {len(entries)} entries from {filename}")
                            if entries:
                                print(f"🔍 LOGISTICS DEBUG: First entry type: {type(entries[0])}, keys: {list(entries[0].keys()) if isinstance(entries[0], dict) else 'Not a dict'}")
                            
                            # Determine document type from first entry
                            document_type = 'unknown'
                            if entries and isinstance(entries[0], dict):
                                document_type = entries[0].get('_document_type', 'unknown')
                            
                            # Initialize file entry in results_by_file
                            if filename not in results_by_file:
                                results_by_file[filename] = {
                                    "document_type": document_type,
                                    "rows": []
                                }
                            
                            for entry in entries:
                                if not isinstance(entry, dict):
                                    print(f"⚠️ LOGISTICS WARNING: Entry is not a dict: {type(entry)}")
                                    continue
                                entry['Filename'] = filename
                                results.append(entry)  # Add to flat list for UI
                                results_by_file[filename]["rows"].append(entry)  # Add to file-grouped structure
                            
                            print(f"🔍 LOGISTICS DEBUG: Total results after processing {filename}: {len(results)}")
                            print(f"🔍 LOGISTICS DEBUG: File-grouped structure: {len(results_by_file[filename]['rows'])} rows for {filename}")
                        else:
                            model_actions.append(f"Extracted {len(entries)} row(s) from {filename}")
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
                                    
                                    # Debug: Log if admin_test field is present (for prompt testing)
                                    if 'admin_test' in entry:
                                        print(f"✅ admin_test FIELD FOUND IN EXTRACTED JSON: {entry.get('admin_test')}")
                                    else:
                                        print(f"⚠️ admin_test field NOT found in extracted JSON. Available fields: {list(entry.keys())}")
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
                                                higher_qty_entries = [e for e in similar_entries if int(e.get('Qty') or 0) > 1]
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
                        model_actions.append(f"⚠️ No data extracted from {filename}")

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
            
            # Debug logging for logistics session storage
            if department == "logistics":
                # Store file-grouped structure for API integration
                if results_by_file:
                    session_data["results_by_file"] = results_by_file
                print(f"🔍 LOGISTICS DEBUG: Storing in session:")
                print(f"  - rows count: {len(results)}")
                print(f"  - files count: {len(results_by_file)}")
                print(f"  - department: {department}")
                for filename, file_data in results_by_file.items():
                    print(f"    - {filename}: {len(file_data['rows'])} rows, type: {file_data['document_type']}")
            
            session['last_results'] = session_data
        else:
            if department == "logistics":
                print(f"⚠️ LOGISTICS WARNING: No results to store in session!")
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
    
    # Build sample_files using centralized loader (automatically discovers all departments)
    # NOTE: use_database=False to use config.py paths (database has old paths)
    from utils.sample_loader import get_all_department_samples
    sample_files_merged = get_all_department_samples(use_database=False)
    
    # Debug: Show sample counts
    for dept, config in sample_files_merged.items():
        sample_count = len(config.get('samples', []))
        print(f"Sample count for {dept}: {sample_count}")
    
    print(f"🔍 RENDERING: department={repr(department)}, results_count={len(results) if results else 0}")
    
    # Debug logging for logistics department
    if department == "logistics":
        print(f"🔍 LOGISTICS RENDER DEBUG:")
        print(f"  - department: {repr(department)}")
        print(f"  - results type: {type(results)}")
        print(f"  - results length: {len(results) if results else 0}")
        print(f"  - results is truthy: {bool(results)}")
        if results and len(results) > 0:
            print(f"  - first result type: {type(results[0])}")
            if isinstance(results[0], dict):
                print(f"  - first result keys: {list(results[0].keys())}")
                print(f"  - first result sample: {dict(list(results[0].items())[:5])}")  # First 5 items
            else:
                print(f"  - first result value: {results[0]}")
        else:
            print(f"  - ⚠️ WARNING: results is empty or None!")
    
    return render_template_string(
        HTML_TEMPLATE,
        results=results if results else [],
        results_by_file=results_by_file if department == 'logistics' else {},  # File-grouped structure for API
        grouped_engineering_results=grouped_engineering_results if department == 'engineering' else {},
        grouped_finance_results=grouped_finance_results if department == 'finance' else {},
        department=department,
        selected_samples=selected_samples,
        sample_files=sample_files_merged,
        error=error_message,
        routine_descriptions=ROUTINE_DESCRIPTIONS,
        routine_summary=ROUTINE_SUMMARY.get(department, []),
        model_in_use=last_model_used,
        model_attempts=model_attempts,
        model_actions=model_actions,
        schedule_type=schedule_type,
        transmittal_data=transmittal_data
    )
