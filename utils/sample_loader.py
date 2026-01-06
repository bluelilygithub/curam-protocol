"""
Sample File Loader Utility

Centralized function to load sample files for departments.
Handles both hardcoded (config.py) and database sources.
"""

from config import DEPARTMENT_SAMPLES


def get_department_samples(department, use_database=True):
    """
    Get sample files for a department from config.py or database.
    
    This is the single source of truth for loading samples.
    Database samples take priority if available, otherwise falls back to config.py.
    
    Args:
        department: Department name (e.g., 'finance', 'engineering')
        use_database: Whether to attempt database lookup (default: True)
        
    Returns:
        dict: Department config with 'label', 'description', 'folder', 'samples'
              Returns None if department not found
    """
    # Get base config from config.py (always available)
    base_config = DEPARTMENT_SAMPLES.get(department)
    if not base_config:
        return None
    
    # Try database override if enabled
    if use_database:
        try:
            from database import get_samples_for_template
            db_samples = get_samples_for_template(department)
            
            if db_samples:
                # Database samples found - use them but keep label/description from config
                return {
                    "label": base_config.get("label", "Samples"),
                    "description": base_config.get("description", ""),
                    "folder": base_config.get("folder", ""),
                    "samples": db_samples
                }
        except Exception as e:
            # Database not available or error - fall back to config
            print(f"Database sample lookup failed for {department}: {e}")
    
    # Return config.py samples (fallback)
    return base_config.copy()


def get_all_department_samples(use_database=True):
    """
    Get sample files for all departments.
    
    Automatically discovers departments from config.py, so no hardcoded list needed.
    
    Args:
        use_database: Whether to attempt database lookup (default: True)
        
    Returns:
        dict: {department: config_dict} for all departments in config.py
    """
    result = {}
    
    # Automatically discover departments from config.py
    for department in DEPARTMENT_SAMPLES.keys():
        config = get_department_samples(department, use_database=use_database)
        if config:
            result[department] = config
    
    return result


def get_sample_paths_for_department(department, use_database=True):
    """
    Get just the file paths (not full config) for a department.
    
    Useful for validation or filtering.
    
    Args:
        department: Department name
        use_database: Whether to attempt database lookup
        
    Returns:
        list: List of file path strings
    """
    config = get_department_samples(department, use_database=use_database)
    if not config:
        return []
    
    return [sample.get("path") for sample in config.get("samples", []) if sample.get("path")]


def build_sample_to_dept_mapping(use_database=True):
    """
    Build the reverse mapping: sample path -> department.
    
    This replaces the hardcoded SAMPLE_TO_DEPT in config.py.
    
    Args:
        use_database: Whether to attempt database lookup
        
    Returns:
        dict: {sample_path: department_name}
    """
    mapping = {}
    
    all_samples = get_all_department_samples(use_database=use_database)
    for dept, config in all_samples.items():
        for sample in config.get("samples", []):
            path = sample.get("path")
            if path:
                mapping[path] = dept
    
    return mapping


def get_allowed_sample_paths(use_database=True):
    """
    Get set of all allowed sample paths for security validation.
    
    Args:
        use_database: Whether to attempt database lookup
        
    Returns:
        set: Set of allowed file paths
    """
    all_samples = get_all_department_samples(use_database=use_database)
    allowed = set()
    
    for config in all_samples.values():
        for sample in config.get("samples", []):
            path = sample.get("path")
            if path:
                allowed.add(path)
    
    return allowed
