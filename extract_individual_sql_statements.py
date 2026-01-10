#!/usr/bin/env python3
"""
Extract individual UPDATE statements from the full SQL file.
Creates separate SQL files for each prompt that DBeaver can execute easily.
"""

from pathlib import Path
import re

def extract_sql_section(sql_content, section_name):
    """Extract a specific UPDATE section from the SQL file."""
    # Find the section header
    pattern = rf'-- ============================================================================\n-- UPDATE {section_name}.*?\n-- ============================================================================\n\n(.*?)(?=\n-- ============================================================================|\Z)'
    match = re.search(pattern, sql_content, re.DOTALL)
    
    if match:
        section_sql = match.group(1).strip()
        # Find the UPDATE statement up to the semicolon
        # But need to handle dollar-quoting properly
        update_match = re.search(r'(UPDATE prompt_templates.*?WHERE name = .*?AND scope = .*?document_type.*?;)', section_sql, re.DOTALL)
        if update_match:
            return update_match.group(1)
    
    return None

def split_sql_file(sql_file_path):
    """Split the full SQL file into individual UPDATE statements."""
    sql_content = Path(sql_file_path).read_text(encoding='utf-8')
    
    # Find each UPDATE section by looking for dollar-quoted blocks
    sections = []
    
    # Pattern to find UPDATE statements with dollar-quoted prompts
    # Format: UPDATE ... SET prompt_text = $TAG$...$TAG$, ... WHERE ...;
    pattern = r'(UPDATE prompt_templates\s+SET\s+prompt_text\s*=\s*\$[A-Z_0-9]+\$.*?\$[A-Z_0-9]+\$,\s*updated_at\s*=\s*CURRENT_TIMESTAMP\s+WHERE name\s*=\s*\'[^\']+\'\s+AND scope\s*=\s*\'document_type\'\s*;)'
    
    matches = re.finditer(pattern, sql_content, re.DOTALL)
    
    for i, match in enumerate(matches):
        update_statement = match.group(1)
        
        # Extract prompt name from WHERE clause
        name_match = re.search(r"WHERE name\s*=\s*'([^']+)'", update_statement)
        if name_match:
            prompt_name = name_match.group(1)
            
            # Clean up prompt name for filename
            file_name = prompt_name.replace('_extraction_rules', '').replace('_', '_')
            
            sections.append({
                'name': prompt_name,
                'sql': update_statement,
                'filename': f'UPDATE_{file_name}.sql'
            })
    
    return sections

def main():
    """Main function to split SQL file."""
    sql_file = Path('update_prompts_to_full.sql')
    
    if not sql_file.exists():
        print(f"ERROR: {sql_file} not found!")
        print("First run: python update_existing_prompts_to_full.py")
        return
    
    print("=" * 80)
    print("Extracting individual UPDATE statements for DBeaver")
    print("=" * 80)
    print()
    
    sections = split_sql_file(sql_file)
    
    if not sections:
        print("WARNING: Could not parse SQL sections automatically.")
        print("The file uses PostgreSQL dollar-quoting which is complex to parse.")
        print()
        print("Alternative: Manually copy each UPDATE section from update_prompts_to_full.sql")
        print("Each section starts with '-- UPDATE [NAME] PROMPT' and ends with ';'")
        return
    
    print(f"Found {len(sections)} UPDATE statements")
    print()
    
    # Create individual files
    for section in sections:
        filename = section['filename']
        output_file = Path(filename)
        
        # Add verification query
        full_sql = f"""-- Update {section['name']}
-- Execute this statement in DBeaver

{section['sql']}

-- Verify the update worked:
SELECT name, doc_type, LENGTH(prompt_text) as length, is_active, updated_at
FROM prompt_templates
WHERE name = '{section['name']}';
"""
        
        output_file.write_text(full_sql, encoding='utf-8')
        print(f"Created: {filename}")
    
    print()
    print("=" * 80)
    print("Individual SQL files created!")
    print("=" * 80)
    print()
    print("In DBeaver:")
    print("  1. Open each file (UPDATE_engineering.sql, etc.)")
    print("  2. Execute each one separately")
    print("  3. Check the verification query results")
    print()

if __name__ == '__main__':
    main()
