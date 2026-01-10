#!/usr/bin/env python3
"""Extract the COMPLETE finance prompt from Python file"""

from pathlib import Path

# Read the Python file
py_file = Path('services/prompts/finance_prompt.py')
content = py_file.read_text(encoding='utf-8')

# Find the function definition
func_start = content.find('def get_finance_prompt(text):')
if func_start == -1:
    print("ERROR: Could not find function")
    exit(1)

# Find the return statement with f"""
return_pos = content.find('return f"""', func_start)
if return_pos == -1:
    print("ERROR: Could not find return f\"\"\"")
    exit(1)

# Get the text after 'return f"""'
prompt_start = return_pos + len('return f"""')

# Find the closing """
# The closing """ should be after prompt_start and on its own line or with just whitespace
remaining = content[prompt_start:]

# Find the last """ that's not part of a code block
# Look for """ on its own line (with optional whitespace)
import re
match = re.search(r'^\s*"""', remaining, re.MULTILINE)
if match:
    prompt_end = prompt_start + match.start()
    prompt_text = content[prompt_start:prompt_end].rstrip()
else:
    # Fallback: find any """ after prompt_start
    prompt_end = content.find('"""', prompt_start)
    if prompt_end == -1:
        print("ERROR: Could not find closing \"\"\"")
        exit(1)
    prompt_text = content[prompt_start:prompt_end].rstrip()

print(f"Extracted prompt: {len(prompt_text):,} characters")
print(f"First 200 chars:\n{prompt_text[:200]}")
print(f"\nLast 200 chars:\n{prompt_text[-200:]}")

# Verify it's not truncated
if len(prompt_text) < 10000:
    print(f"\nWARNING: Prompt seems too short! Expected ~10,000+ chars, got {len(prompt_text)}")
    print("Checking Python file structure...")
    print(f"Function starts at position: {func_start}")
    print(f"Return statement at: {return_pos}")
    print(f"Prompt starts at: {prompt_start}")
    print(f"Prompt ends at: {prompt_end}")
    print(f"Content length: {len(content)}")
    
    # Show what's around the end
    print(f"\nContent around prompt_end (last 500 chars of file):")
    print(content[-500:])

# Generate SQL
sql = f"""UPDATE prompt_templates
SET 
    prompt_text = $FINANCE_FULL$
{prompt_text}
$FINANCE_FULL$,
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'finance_extraction_rules'
  AND scope = 'document_type';

-- Verify the update worked:
SELECT name, doc_type, LENGTH(prompt_text) as prompt_length, 
       is_active, updated_at,
       CASE 
           WHEN LENGTH(prompt_text) < 10000 THEN 'TOO SMALL - Update failed'
           WHEN LENGTH(prompt_text) BETWEEN 10000 AND 11000 THEN 'CORRECT SIZE'
           ELSE 'UNEXPECTED SIZE'
       END as status
FROM prompt_templates
WHERE name = 'finance_extraction_rules';
"""

output_file = Path('UPDATE_finance_COMPLETE.sql')
output_file.write_text(sql, encoding='utf-8')

print(f"\n{'='*80}")
print(f"SQL file created: {output_file}")
print(f"Total SQL file size: {len(sql):,} characters")
print(f"Prompt content in SQL: {len(prompt_text):,} characters")
print(f"{'='*80}")
print("\nThe prompt in SQL should be 10,279 characters.")
print("Execute this file in DBeaver and check the SELECT result.")
