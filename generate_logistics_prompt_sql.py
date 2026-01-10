#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate SQL INSERT statement for logistics prompt"""

import re
from pathlib import Path

# Read the logistics prompt file
content = Path('services/prompts/logistics_prompt.py').read_text(encoding='utf-8')

# Extract the prompt text from the f-string
match = re.search(r'return f"""\n(.*?)\n    """', content, re.DOTALL)
if not match:
    print("ERROR: Could not extract prompt text")
    exit(1)

prompt_text = match.group(1)

# Generate SQL with PostgreSQL dollar-quoting
sql = f"""-- Logistics Prompt SQL INSERT
-- This will insert or update the logistics prompt in the database
-- Prompt length: {len(prompt_text)} characters

INSERT INTO prompt_templates (name, scope, doc_type, prompt_text, priority, is_active)
VALUES (
    'Logistics - Trade Documents (Hardcoded Migration v1.0)',
    'document_type',
    'fta-list',
    $LOGISTICS_PROMPT${prompt_text}$LOGISTICS_PROMPT$,
    1,
    true
)
ON CONFLICT (name) DO UPDATE SET
    prompt_text = EXCLUDED.prompt_text,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

-- Verify the prompt was inserted
SELECT 
    id,
    name,
    scope,
    doc_type,
    LENGTH(prompt_text) as prompt_length,
    is_active,
    created_at
FROM prompt_templates
WHERE name = 'Logistics - Trade Documents (Hardcoded Migration v1.0)';
"""

# Write to file
output_file = Path('database_insert_logistics_prompt.sql')
output_file.write_text(sql, encoding='utf-8')
print(f"Generated {output_file}")
print(f"  Prompt length: {len(prompt_text)} characters")
print(f"  SQL file size: {len(sql)} characters")
