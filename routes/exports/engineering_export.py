"""
Engineering Department CSV Export

Handles CSV export formatting for Engineering department schedules.
Supports both beam and column schedule types.
"""

import pandas as pd


def export_engineering_csv(df, saved):
    """
    Export engineering department data to CSV format
    
    Args:
        df: pandas DataFrame with engineering schedule data
        saved: Session data dictionary (contains schedule_type)
        
    Returns:
        pandas DataFrame formatted for CSV export
    """
    df_export = df.copy()
    schedule_type = saved.get('schedule_type')
    
    # Select columns based on schedule type
    if schedule_type == 'column':
        columns = [
            'Filename', 'Mark', 'SectionType', 'Size', 'Length', 
            'Grade', 'BasePlate', 'CapPlate', 'Finish', 'Comments'
        ]
    else:
        # Default to beam schedule columns
        columns = [
            'Filename', 'Mark', 'Size', 'Qty', 'Length', 
            'Grade', 'PaintSystem', 'Comments'
        ]
    
    df_export = df_export[[col for col in columns if col in df_export.columns]]
    
    return df_export
