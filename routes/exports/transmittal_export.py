"""
Transmittal Department CSV Export

Handles CSV export formatting for Transmittal department drawings.
Basic drawing register export.
"""

import pandas as pd


def export_transmittal_csv(df, saved):
    """
    Export transmittal department data to CSV format
    
    Args:
        df: pandas DataFrame with transmittal drawing data
        saved: Session data dictionary
        
    Returns:
        pandas DataFrame formatted for CSV export
    """
    df_export = df.copy()
    
    # Select drawing register columns
    columns = ['Filename', 'DwgNo', 'Rev', 'Title', 'Scale']
    df_export = df_export[[col for col in columns if col in df_export.columns]]
    
    return df_export
