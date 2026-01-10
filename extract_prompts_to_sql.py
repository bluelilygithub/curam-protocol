#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Helper script to extract prompts from Python files and generate SQL INSERT statements.
This automates the migration of hardcoded prompts to the database.

Usage:
    python extract_prompts_to_sql.py

Output:
    - Prints SQL INSERT statements to console
    - Or saves to file: prompts_migration.sql
"""

import re
import os
import sys
from pathlib import Path

# Fix Windows console encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Prompt file locations
PROMPT_FILES = {
    'finance': {
        'path': 'services/prompts/finance_prompt.py',
        'function': 'get_finance_prompt',
        'name': 'Finance - Vendor Invoice (Hardcoded Migration v1.0)',
        'scope': 'document_type',
        'doc_type': 'vendor-invoice',
        'start_line': 16,
        'end_line': 274
    },
    'engineering': {
        'path': 'services/prompts/engineering_prompt.py',
        'function': 'get_engineering_prompt',
        'name': 'Engineering - Beam/Column Schedule (Hardcoded Migration v1.0)',
        'scope': 'document_type',
        'doc_type': 'beam-schedule',
        'start_line': 16,
        'end_line': 1485
    },
    'transmittal': {
        'path': 'services/prompts/transmittal_prompt.py',
        'function': 'get_transmittal_prompt',
        'name': 'Transmittal - Drawing Register (Hardcoded Migration v1.0)',
        'scope': 'document_type',
        'doc_type': 'drawing-register',
        'start_line': 16,
        'end_line': 82
    },
    'logistics': {
        'path': 'services/prompts/logistics_prompt.py',
        'function': 'get_logistics_prompt',
        'name': 'Logistics - Trade Documents (Hardcoded Migration v1.0)',
        'scope': 'document_type',
        'doc_type': 'fta-list',
        'start_line': 16,
        'end_line': 251
    }
}


def extract_prompt_from_function(file_path, function_name):
    """
    Extract the prompt text from a Python function that returns an f-string.
    Handles triple-quoted strings and f-string formatting.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"[WARNING] File not found: {file_path}")
        return None
    
    # Find function definition
    func_pattern = rf'def {function_name}\(.*?\):'
    func_match = re.search(func_pattern, content, re.DOTALL)
    
    if not func_match:
        print(f"[WARNING] Function {function_name} not found in {file_path}")
        return None
    
    # Find return f""" after function definition
    remaining = content[func_match.end():]
    return_match = re.search(r'return\s+f"""', remaining, re.MULTILINE)
    
    if not return_match:
        print(f"[WARNING] return f\"\"\" not found after {function_name} in {file_path}")
        return None
    
    # Extract everything after f""" until the closing """
    prompt_start = return_match.end()
    prompt_content = remaining[prompt_start:]
    
    # Find the closing """ - look for """ that's not part of the prompt content
    # The closing """ should be on its own line or at the start of a line (with indentation)
    # Use a simple approach: find the next """ that appears at the start of a line (after whitespace)
    lines = prompt_content.split('\n')
    prompt_lines = []
    
    for i, line in enumerate(lines):
        # Check if this line contains closing """
        stripped = line.strip()
        
        # Check if line starts with """ (after stripping)
        if stripped.startswith('"""'):
            # This is the closing quote
            # Extract any content before """ if it exists
            before_quote = line.split('"""')[0]
            if before_quote.strip():
                prompt_lines.append(before_quote)
            break
        elif '"""' in line:
            # """ might be in the middle or end of line
            # Extract content before """
            before_quote = line.split('"""')[0]
            if before_quote.strip() or prompt_lines:  # Include if we have content
                prompt_lines.append(before_quote)
            break
        
        prompt_lines.append(line)
    
    prompt_text = '\n'.join(prompt_lines).strip()
    
    # Remove trailing whitespace and empty lines
    prompt_text = re.sub(r'\n\s*\n\s*\n', '\n\n', prompt_text)  # Remove excessive blank lines
    prompt_text = prompt_text.strip()
    
    return prompt_text


def escape_for_sql_dollar_quote(text, tag='PROMPT'):
    """
    Generate a unique dollar-quote tag for PostgreSQL.
    Dollar-quoting doesn't need escaping, but we should use a unique tag per prompt.
    """
    # Use a unique tag based on tag name and first few chars of content
    # This ensures uniqueness without being too long
    import hashlib
    content_hash = text[:50].encode('utf-8') if isinstance(text, str) else text[:50]
    tag_hash = hashlib.md5(content_hash).hexdigest()[:8]
    unique_tag = f'{tag}_{tag_hash}'
    return unique_tag


def generate_sql_insert(prompt_config, prompt_text):
    """Generate SQL INSERT statement for a prompt."""
    if not prompt_text:
        return None
    
    # Use dollar-quoting with unique tag
    tag = escape_for_sql_dollar_quote(prompt_text, prompt_config['doc_type'].upper().replace('-', '_'))
    
    # Escape single quotes in the config values for SQL
    name = prompt_config['name'].replace("'", "''")
    scope = prompt_config['scope'].replace("'", "''")
    doc_type = prompt_config['doc_type'].replace("'", "''")
    
    sql = f"""-- ============================================================================
-- {prompt_config['name']}
-- Source: {prompt_config['path']} -> {prompt_config['function']}()
-- Prompt Length: {len(prompt_text)} characters
-- ============================================================================

INSERT INTO prompt_templates (name, scope, doc_type, prompt_text, priority, is_active)
VALUES (
    '{name}',
    '{scope}',
    '{doc_type}',
    ${tag}${prompt_text}${tag}$,
    1,
    false  -- Keep inactive initially - enable after testing
)
ON CONFLICT (name) DO UPDATE SET
    prompt_text = EXCLUDED.prompt_text,
    updated_at = CURRENT_TIMESTAMP;

"""
    return sql


def main():
    """Main function to extract all prompts and generate SQL."""
    print("=" * 80)
    print("Extracting prompts from Python files and generating SQL INSERT statements")
    print("=" * 80)
    print()
    
    base_dir = Path(__file__).parent
    all_sql = []
    
    # Header SQL
    header_sql = """-- Migration: Upload Hardcoded Prompts to Database
-- Generated by extract_prompts_to_sql.py
-- Date: Auto-generated
--
-- IMPORTANT: Run this SQL in your PostgreSQL database to migrate prompts.
-- All prompts will be inserted with is_active = false (disabled).
-- Enable them after testing: UPDATE prompt_templates SET is_active = true WHERE name LIKE '%Hardcoded Migration%';

-- Disable all existing prompts first (safety measure)
UPDATE prompt_templates SET is_active = false WHERE is_active = true;

"""
    all_sql.append(header_sql)
    
    # Extract each prompt
    for prompt_type, config in PROMPT_FILES.items():
        print(f"Extracting {prompt_type} prompt...")
        file_path = base_dir / config['path']
        
        prompt_text = extract_prompt_from_function(str(file_path), config['function'])
        
        if prompt_text:
            sql = generate_sql_insert(config, prompt_text)
            if sql:
                all_sql.append(sql)
                print(f"  [OK] Extracted {len(prompt_text)} characters")
            else:
                print(f"  [ERROR] Failed to generate SQL")
        else:
            print(f"  [ERROR] Failed to extract prompt")
        print()
    
    # Footer SQL with verification queries
    footer_sql = """-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify inserted prompts
SELECT 
    id,
    name,
    scope,
    doc_type,
    LENGTH(prompt_text) as prompt_length_characters,
    priority,
    is_active,
    created_at
FROM prompt_templates
WHERE name LIKE '%Hardcoded Migration%'
ORDER BY created_at DESC;

-- Count prompts by scope and status
SELECT 
    scope,
    COUNT(*) as total_count,
    SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_count,
    AVG(LENGTH(prompt_text)) as avg_length,
    MAX(LENGTH(prompt_text)) as max_length
FROM prompt_templates
WHERE name LIKE '%Hardcoded Migration%'
GROUP BY scope;
"""
    all_sql.append(footer_sql)
    
    # Output
    full_sql = '\n'.join(all_sql)
    
    # Print to console
    print("=" * 80)
    print("Generated SQL:")
    print("=" * 80)
    print()
    print(full_sql)
    
    # Also save to file
    output_file = base_dir / 'prompts_migration_generated.sql'
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(full_sql)
    
    print()
    print("=" * 80)
    print(f"[SUCCESS] SQL saved to: {output_file}")
    print("=" * 80)


if __name__ == '__main__':
    main()
