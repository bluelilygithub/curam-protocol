"""
Finance Department CSV Export

Handles CSV export formatting for Finance department invoices.
Includes currency formatting, array serialization, and column mapping.
"""

import json
import pandas as pd
from utils.formatting import format_currency


def export_finance_csv(df, saved):
    """
    Export finance department data to CSV format
    
    Args:
        df: pandas DataFrame with finance invoice data
        saved: Session data dictionary
        
    Returns:
        pandas DataFrame formatted for CSV export
    """
    df_export = df.copy()
    
    # Format currency columns
    for currency_col in ['Cost', 'GST', 'FinalAmount']:
        if currency_col in df_export.columns:
            df_export[currency_col] = df_export[currency_col].apply(
                lambda x: format_currency(x) if x and x not in ("N/A", "") else "N/A"
            )
        else:
            df_export[currency_col] = "N/A"
    
    # Select and order columns
    columns = [
        'Filename', 'Vendor', 'Date', 'InvoiceNum', 'Currency', 
        'Cost', 'GST', 'FinalAmount', 'Summary', 'ABN', 
        'POReference', 'PaymentTerms', 'DueDate', 'ShippingTerms', 
        'PortOfLoading', 'PortOfDischarge', 'VesselVoyage', 
        'BillOfLading', 'HSCodes', 'LineItems', 'Flags'
    ]
    df_export = df_export[[col for col in columns if col in df_export.columns]]
    
    # Convert arrays to strings for CSV
    if 'HSCodes' in df_export.columns:
        df_export['HSCodes'] = df_export['HSCodes'].apply(
            lambda x: ', '.join(x) if isinstance(x, list) else (x or '')
        )
    if 'LineItems' in df_export.columns:
        df_export['LineItems'] = df_export['LineItems'].apply(
            lambda x: json.dumps(x) if isinstance(x, list) else (x or '')
        )
    if 'Flags' in df_export.columns:
        df_export['Flags'] = df_export['Flags'].apply(
            lambda x: '; '.join(x) if isinstance(x, list) else (x or '')
        )
    
    # Rename columns for better readability
    df_export.columns = [
        'Filename', 'Vendor', 'Date', 'Invoice #', 'Currency', 
        'Cost', 'GST', 'Final Amount', 'Summary', 'ABN', 
        'PO Reference', 'Payment Terms', 'Due Date', 'Shipping Terms', 
        'Port of Loading', 'Port of Discharge', 'Vessel/Voyage', 
        'Bill of Lading', 'HS Codes', 'Line Items', 'Flags'
    ]
    
    return df_export
