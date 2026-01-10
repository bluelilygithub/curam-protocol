#!/usr/bin/env python3
"""Generate SQL for finance prompt directly from Python file"""

from pathlib import Path
import re

# Read the Python file
py_file = Path('services/prompts/finance_prompt.py')
content = py_file.read_text(encoding='utf-8')

# Extract the prompt text
pattern = r'return\s+f"""\s*\n(.*?)"""'
match = re.search(pattern, content, re.DOTALL)
if not match:
    print("ERROR: Could not extract prompt from Python file")
    exit(1)

prompt_text = match.group(1)

print(f"Extracted prompt: {len(prompt_text):,} characters")
print(f"First 100 chars: {prompt_text[:100]}...")
print(f"Last 100 chars: ...{prompt_text[-100:]}")

# Generate SQL with proper dollar-quoting
sql = f"""UPDATE prompt_templates
SET 
    prompt_text = $FINANCE_FULL$
{prompt_text}
$FINANCE_FULL$,
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'finance_extraction_rules'
  AND scope = 'document_type';

-- Verify:
SELECT name, doc_type, LENGTH(prompt_text) as prompt_length, 
       LENGTH(prompt_text) as character_count,
       is_active, updated_at
FROM prompt_templates
WHERE name = 'finance_extraction_rules';
"""

output_file = Path('UPDATE_finance_FINAL.sql')
output_file.write_text(sql, encoding='utf-8')

print(f"\nSQL file created: {output_file}")
print(f"SQL file size: {len(sql):,} characters")
print(f"\nThe prompt text in SQL is: {len(prompt_text):,} characters")
print("\nExecute this in DBeaver. After execution, the SELECT should show:")
print(f"  prompt_length: 10,279 (or very close to that)")
print("\nIf it shows 1,342 or less, the UPDATE did not execute correctly.")
