#!/usr/bin/env python3
"""Verify the actual prompt content in SQL file"""

from pathlib import Path
import re

sql_file = Path('UPDATE_finance_COMPLETE.sql')
content = sql_file.read_text(encoding='utf-8')

print(f"Total SQL file size: {len(content):,} characters")
print(f"Total SQL file size: {sql_file.stat().st_size:,} bytes\n")

# Extract prompt between dollar-quote tags
pattern = r'\$FINANCE_FULL\$(.*?)\$FINANCE_FULL\$'
match = re.search(pattern, content, re.DOTALL)

if match:
    prompt_text = match.group(1)
    print(f"Prompt text BETWEEN tags: {len(prompt_text):,} characters")
    print(f"Lines in prompt: {len(prompt_text.split(chr(10)))}")
    print(f"\nFirst 300 characters:")
    print(repr(prompt_text[:300]))
    print(f"\nLast 300 characters:")
    print(repr(prompt_text[-300:]))
    
    # Count characters excluding newlines
    chars_without_nl = len(prompt_text.replace('\n', '').replace('\r', ''))
    print(f"\nCharacters excluding newlines: {chars_without_nl:,}")
    
    if len(prompt_text) < 10000:
        print(f"\n*** ERROR: Prompt is only {len(prompt_text):,} chars, expected ~10,284! ***")
    else:
        print(f"\n✓ Prompt size looks correct: {len(prompt_text):,} characters")
else:
    print("ERROR: Could not find prompt between dollar-quote tags!")
    # Try to find the tags
    start_tag_pos = content.find('$FINANCE_FULL$')
    end_tag_pos = content.rfind('$FINANCE_FULL$')
    print(f"Found start tag at position: {start_tag_pos}")
    print(f"Found end tag at position: {end_tag_pos}")
    if start_tag_pos >= 0 and end_tag_pos > start_tag_pos:
        prompt_text = content[start_tag_pos+len('$FINANCE_FULL$'):end_tag_pos]
        print(f"Text between positions: {len(prompt_text):,} characters")
