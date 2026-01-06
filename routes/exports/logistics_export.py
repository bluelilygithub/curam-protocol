"""
Logistics Department CSV Export

Handles CSV export formatting for Logistics department documents.
Supports FTA Lists, Bills of Lading, and Packing Lists.
"""

import pandas as pd


def export_logistics_csv(df, saved):
    """
    Export logistics department data to CSV format
    
    Args:
        df: pandas DataFrame with logistics document data
        saved: Session data dictionary
        
    Returns:
        pandas DataFrame formatted for CSV export
    """
    df_export = df.copy()
    
    # Default columns for logistics (can be customized per document type)
    # This is a basic implementation - can be expanded based on document type
    columns = [
        'Filename', 'ShipmentRef', 'InvoiceNumber', 'ItemDescription',
        'CountryOfOrigin', 'FTAAgreement', 'TariffCode', 'Notes',
        'BLNumber', 'Shipper', 'Consignee', 'Vessel', 'ContainerNumber',
        'PortOfLoading', 'PortOfDischarge', 'CargoDescription', 'GrossWeight',
        'CartonNumber', 'PONumber', 'Quantity', 'Dimensions', 'NetWeight', 'Volume'
    ]
    
    # Only include columns that exist in the dataframe
    df_export = df_export[[col for col in columns if col in df_export.columns]]
    
    return df_export
