#!/usr/bin/env python3
"""
Extract FULL prompts from Python files and create correct SQL UPDATE statements.
This extracts the complete prompt text, not placeholders.
"""

import re
from pathlib import Path

def extract_full_prompt(file_path, function_name):
    """Extract the complete prompt text from a Python function."""
    content = Path(file_path).read_text(encoding='utf-8')
    
    # Find the function
    func_pattern = rf'def {function_name}\(.*?\):'
    func_match = re.search(func_pattern, content, re.DOTALL)
    if not func_match:
        return None
    
    # Get everything after the function definition
    remaining = content[func_match.end():]
    
    # Find return f"""
    return_match = re.search(r'return\s+f"""', remaining, re.MULTILINE)
    if not return_match:
        return None
    
    # Get text after return f"""
    prompt_start_pos = return_match.end()
    prompt_content = remaining[prompt_start_pos:]
    
    # Find the closing """ - it should be on its own line or with just whitespace
    # Look for """ followed by end of line or whitespace then end of line
    closing_match = re.search(r'^\s*"""\s*$', prompt_content, re.MULTILINE)
    if not closing_match:
        # Try without multiline - look for """ at start of line
        closing_match = re.search(r'^\s*"""', prompt_content, re.MULTILINE)
    
    if closing_match:
        prompt_text = prompt_content[:closing_match.start()].rstrip()
        return prompt_text
    
    return None

def generate_update_sql(prompt_name_db, prompt_text, tag_name):
    """Generate SQL UPDATE statement with proper dollar-quoting."""
    # Clean up prompt text - ensure it ends properly
    prompt_text = prompt_text.rstrip()
    
    # The prompt_text should end with "TEXT: {text}" as part of the prompt content
    # The closing dollar-quote tag needs to be on a NEW LINE after the prompt
    
    # Escape single quotes in the prompt name for SQL
    prompt_name_escaped = prompt_name_db.replace("'", "''")
    
    # Format SQL with proper dollar-quoting:
    # UPDATE ... SET prompt_text = $TAG$
    # [prompt text including "TEXT: {text}"]
    # $TAG$,
    sql = f"""UPDATE prompt_templates
SET 
    prompt_text = ${tag_name}$
{prompt_text}
${tag_name}$,
    updated_at = CURRENT_TIMESTAMP
WHERE name = '{prompt_name_escaped}'
  AND scope = 'document_type';

-- Verify:
SELECT name, doc_type, LENGTH(prompt_text) as length, is_active, updated_at
FROM prompt_templates
WHERE name = '{prompt_name_escaped}';
"""
    return sql

# Extract prompts
prompts_to_update = [
    {
        'file': 'services/prompts/finance_prompt.py',
        'function': 'get_finance_prompt',
        'db_name': 'finance_extraction_rules',
        'tag': 'FINANCE_FULL'
    },
    {
        'file': 'services/prompts/logistics_prompt.py',
        'function': 'get_logistics_prompt',
        'db_name': 'logistics_extraction_rules',
        'tag': 'LOGISTICS_FULL'
    },
    {
        'file': 'services/prompts/transmittal_prompt.py',
        'function': 'get_transmittal_prompt',
        'db_name': 'transmittal_extraction_rules',
        'tag': 'TRANSMITTAL_FULL'
    },
    {
        'file': 'services/prompts/engineering_prompt.py',
        'function': 'get_engineering_prompt',
        'db_name': 'engineering_extraction_rules',
        'tag': 'ENGINEERING_FULL'
    }
]

print("=" * 80)
print("EXTRACTING FULL PROMPTS FROM PYTHON FILES")
print("=" * 80)
print()

all_sql = []
all_sql.append("-- ============================================================================\n")
all_sql.append("-- UPDATE PROMPTS WITH FULL CONTENT (CORRECT VERSION)\n")
all_sql.append("-- Execute each UPDATE statement in DBeaver\n")
all_sql.append("-- ============================================================================\n\n")

for config in prompts_to_update:
    print(f"Extracting {config['file']}...")
    
    prompt_text = extract_full_prompt(config['file'], config['function'])
    
    if prompt_text:
        length = len(prompt_text)
        print(f"  [OK] Extracted {length:,} characters")
        
        sql = generate_update_sql(config['db_name'], prompt_text, config['tag'])
        all_sql.append(f"-- ============================================================================\n")
        all_sql.append(f"-- UPDATE {config['db_name'].upper().replace('_', ' ')}\n")
        all_sql.append(f"-- Prompt Length: {length:,} characters\n")
        all_sql.append(f"-- ============================================================================\n\n")
        all_sql.append(sql)
        all_sql.append("\n\n")
    else:
        print(f"  [ERROR] Failed to extract prompt")

# Write combined file
output_file = Path('UPDATE_ALL_PROMPTS_CORRECT.sql')
output_file.write_text(''.join(all_sql), encoding='utf-8')

print()
print("=" * 80)
print(f"SQL saved to: {output_file}")
print("=" * 80)
print()
print("This file contains the FULL prompts extracted directly from Python files.")
print("Execute each UPDATE statement separately in DBeaver.")
