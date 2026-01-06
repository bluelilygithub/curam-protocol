"""
Logistics Department CSV Export

Handles CSV export formatting for Logistics department documents.
Supports FTA Lists, Bills of Lading, and Packing Lists.
Groups columns by document type for cleaner exports.
"""

import pandas as pd


def export_logistics_csv(df, saved):
    """
    Export logistics department data to CSV format
    
    Intelligently selects columns based on document type to create
    cleaner, more focused CSV exports.
    
    Args:
        df: pandas DataFrame with logistics document data
        saved: Session data dictionary
        
    Returns:
        pandas DataFrame formatted for CSV export
    """
    if df.empty:
        return df
    
    df_export = df.copy()
    
    # Check if we have document type information
    has_document_type = '_document_type' in df_export.columns
    
    if has_document_type:
        # Group by document type and select appropriate columns
        # This creates separate column sets for each document type
        
        # FTA List columns
        fta_columns = [
            'Filename', 'ShipmentRef', 'InvoiceNumber', 'ItemDescription',
            'CountryOfOrigin', 'FTAAgreement', 'TariffCode', 'Notes'
        ]
        
        # Bill of Lading columns
        bol_columns = [
            'Filename', 'BLNumber', 'Shipper', 'Consignee', 'Vessel',
            'ContainerNumber', 'PortOfLoading', 'PortOfDischarge',
            'CargoDescription', 'Description', 'GrossWeight', 'Weight',
            'PackageCount'
        ]
        
        # Packing List columns
        packing_columns = [
            'Filename', 'CartonNumber', 'PONumber', 'ItemDescription',
            'Description', 'Quantity', 'Dimensions', 'GrossWeight',
            'NetWeight', 'Volume'
        ]
        
        # Get all unique document types in the data
        doc_types = df_export['_document_type'].unique() if '_document_type' in df_export.columns else []
        
        # Collect all relevant columns based on document types present
        all_columns = ['Filename']  # Always include filename
        
        if 'fta_list' in doc_types:
            all_columns.extend([col for col in fta_columns if col not in all_columns])
        
        if 'bill_of_lading' in doc_types:
            all_columns.extend([col for col in bol_columns if col not in all_columns])
        
        if 'packing_list' in doc_types:
            all_columns.extend([col for col in packing_columns if col not in all_columns])
        
        # Add document type column if present
        if '_document_type' in df_export.columns:
            all_columns.append('_document_type')
        
        # Only include columns that exist in the dataframe
        available_columns = [col for col in all_columns if col in df_export.columns]
        
        # Reorder columns: Filename first, then document type, then type-specific columns
        if '_document_type' in available_columns:
            available_columns.remove('_document_type')
            available_columns.insert(1, '_document_type')
        
        df_export = df_export[available_columns]
        
    else:
        # Fallback: Include all common logistics columns
        # This handles cases where document type isn't available
        columns = [
            'Filename', 'ShipmentRef', 'InvoiceNumber', 'ItemDescription',
            'CountryOfOrigin', 'FTAAgreement', 'TariffCode', 'Notes',
            'BLNumber', 'Shipper', 'Consignee', 'Vessel', 'ContainerNumber',
            'PortOfLoading', 'PortOfDischarge', 'CargoDescription', 'Description',
            'GrossWeight', 'Weight', 'CartonNumber', 'PONumber', 'Quantity',
            'Dimensions', 'NetWeight', 'Volume', 'PackageCount'
        ]
        
        # Only include columns that exist in the dataframe
        available_columns = [col for col in columns if col in df_export.columns]
        df_export = df_export[available_columns]
    
    return df_export
