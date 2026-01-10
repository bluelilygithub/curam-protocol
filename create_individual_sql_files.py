#!/usr/bin/env python3
"""
Split the combined SQL file into individual files for easier execution in DBeaver.
"""

from pathlib import Path
import re

# Read the combined file
combined_file = Path('UPDATE_ALL_PROMPTS_CORRECT.sql')
content = combined_file.read_text(encoding='utf-8')

# Split by UPDATE statements
# Pattern: -- ============================================================================
#          -- UPDATE [PROMPT_NAME]
#          -- Prompt Length: [NUMBER] characters
#          -- ============================================================================
#          [blank line]
#          UPDATE prompt_templates...

pattern = r'(-- ============================================================================\n-- UPDATE (.+?)\n-- Prompt Length: (\d+,?\d*) characters\n-- ============================================================================\n\nUPDATE prompt_templates.*?(?=\n-- ============================================================================|$)'

matches = re.finditer(pattern, content, re.DOTALL)

prompts = []
for match in matches:
    full_sql = match.group(1)
    prompt_name = match.group(2).strip().replace(' ', '_').lower()
    prompt_length = match.group(3)
    
    prompts.append({
        'name': prompt_name,
        'sql': full_sql.strip(),
        'length': prompt_length
    })

# Create individual files
for prompt in prompts:
    filename = f"UPDATE_{prompt['name']}.sql"
    Path(filename).write_text(prompt['sql'] + '\n', encoding='utf-8')
    print(f"Created: {filename} ({prompt['length']} chars)")

print(f"\nCreated {len(prompts)} individual SQL files for DBeaver execution.")
