#!/usr/bin/env python3
"""
Split UPDATE_ALL_PROMPTS_CORRECT.sql into individual files for DBeaver.
"""

from pathlib import Path

# Read the combined file
content = Path('UPDATE_ALL_PROMPTS_CORRECT.sql').read_text(encoding='utf-8')

# Split by the section markers
sections = content.split('-- ============================================================================\n-- UPDATE ')

# Process each section (skip the header)
prompts_map = {
    'FINANCE EXTRACTION RULES': 'finance',
    'LOGISTICS EXTRACTION RULES': 'logistics',
    'TRANSMITTAL EXTRACTION RULES': 'transmittal',
    'ENGINEERING EXTRACTION RULES': 'engineering'
}

created_files = []

for i, section in enumerate(sections[1:], 1):  # Skip the first header section
    # Extract the prompt name from the header
    lines = section.split('\n')
    if len(lines) < 5:
        continue
    
    header_line = lines[0]  # First line should be "FINANCE EXTRACTION RULES" etc.
    
    # Find which prompt this is
    prompt_type = None
    for key, value in prompts_map.items():
        if key in header_line:
            prompt_type = value
            break
    
    if not prompt_type:
        print(f"Could not identify prompt type for section {i}")
        continue
    
    # Find where the SQL ends (before the next section or end of file)
    sql_lines = []
    in_sql = False
    for line in lines:
        if line.strip().startswith('UPDATE prompt_templates'):
            in_sql = True
        if in_sql:
            sql_lines.append(line)
            # Stop at the next section marker or end
            if line.strip() == '-- ============================================================================' and len(sql_lines) > 10:
                sql_lines = sql_lines[:-1]  # Remove the marker
                break
    
    if not sql_lines:
        continue
    
    sql_content = '\n'.join(sql_lines).strip()
    
    # Create individual file
    filename = f"UPDATE_{prompt_type}_CORRECT.sql"
    Path(filename).write_text(sql_content + '\n', encoding='utf-8')
    created_files.append(filename)
    print(f"Created: {filename} ({len(sql_content):,} chars)")

print(f"\nCreated {len(created_files)} individual SQL files for DBeaver.")
