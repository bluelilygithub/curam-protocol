"""
Export Routes Blueprint

This module contains CSV export routes:
- /export_csv - General CSV export for all departments
- /export_transmittal_csv - Transmittal-specific category CSV export

Future: Can easily add JSON, Excel, and other export formats here.
"""

import io
import json
from flask import Blueprint, request, session, Response
import pandas as pd

# Import configuration
from config import DEFAULT_DEPARTMENT

# Import utilities
from utils.formatting import format_currency
from utils.encoding_fix import sanitize_csv_export

# Create blueprint
export_bp = Blueprint('export', __name__)


@export_bp.route('/export_csv')
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

    # Sanitize all string columns to fix corrupt UTF-8 characters before CSV export
    df_export = sanitize_csv_export(df_export)

    output = io.StringIO()
    df_export.to_csv(output, index=False)
    csv_string = output.getvalue()

    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=takeoff_results.csv'}
    )
    return response


@export_bp.route('/export_transmittal_csv')
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
    
    # Sanitize all string columns to fix corrupt UTF-8 characters before CSV export
    df = sanitize_csv_export(df)
    
    output = io.StringIO()
    df.to_csv(output, index=False)
    csv_string = output.getvalue()
    
    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename={filename}.csv'}
    )
    return response
