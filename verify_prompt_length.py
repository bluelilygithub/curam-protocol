#!/usr/bin/env python3
"""Verify prompt lengths in SQL files and Python files"""

from pathlib import Path
import re

def extract_prompt_from_sql(sql_content, tag):
    """Extract prompt text from SQL dollar-quote block"""
    pattern = rf'\${tag}\$(.*?)\${tag}\$'
    match = re.search(pattern, sql_content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None

def extract_prompt_from_python(py_content):
    """Extract prompt text from Python function"""
    pattern = r'return\s+f"""\s*\n(.*?)"""'
    match = re.search(pattern, py_content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None

# Check finance prompt
print("=" * 80)
print("FINANCE PROMPT VERIFICATION")
print("=" * 80)

sql_file = Path('UPDATE_finance_CORRECT.sql')
py_file = Path('services/prompts/finance_prompt.py')

sql_content = sql_file.read_text(encoding='utf-8')
py_content = py_file.read_text(encoding='utf-8')

sql_prompt = extract_prompt_from_sql(sql_content, 'FINANCE_FULL')
py_prompt = extract_prompt_from_python(py_content)

if sql_prompt:
    print(f"SQL file prompt: {len(sql_prompt):,} characters")
    print(f"First 150 chars: {repr(sql_prompt[:150])}")
    print(f"Last 150 chars: {repr(sql_prompt[-150:])}")
else:
    print("ERROR: Could not extract prompt from SQL file")

print()

if py_prompt:
    print(f"Python file prompt: {len(py_prompt):,} characters")
    print(f"First 150 chars: {repr(py_prompt[:150])}")
    print(f"Last 150 chars: {repr(py_prompt[-150:])}")
else:
    print("ERROR: Could not extract prompt from Python file")

print()

if sql_prompt and py_prompt:
    if sql_prompt == py_prompt:
        print("✓ SQL and Python prompts match exactly!")
    else:
        print("✗ SQL and Python prompts DO NOT match!")
        print(f"Difference: {abs(len(sql_prompt) - len(py_prompt))} characters")
        
        # Find first difference
        for i, (s, p) in enumerate(zip(sql_prompt, py_prompt)):
            if s != p:
                print(f"\nFirst difference at position {i}:")
                print(f"  SQL: {repr(sql_prompt[max(0,i-20):i+20])}")
                print(f"  PY:  {repr(py_prompt[max(0,i-20):i+20])}")
                break
