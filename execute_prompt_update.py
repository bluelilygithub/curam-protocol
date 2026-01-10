#!/usr/bin/env python3
"""
Execute update_prompts_to_full.sql to update existing prompts with full content.
This script reads the SQL file and executes it directly against the database.
"""

import sys
import os
from pathlib import Path

# Add current directory to path
sys.path.insert(0, '.')

try:
    from database import engine
    from sqlalchemy import text
    
    if not engine:
        print("=" * 80)
        print("ERROR: Database engine not available")
        print("=" * 80)
        print()
        print("Make sure DATABASE_URL environment variable is set.")
        print("For Railway: DATABASE_URL is automatically set in production.")
        print("For local: Set it in your .env file")
        sys.exit(1)
    
    # Read the SQL file
    sql_file = Path('update_prompts_to_full.sql')
    if not sql_file.exists():
        print(f"ERROR: SQL file not found: {sql_file}")
        print()
        print("First, generate the SQL file:")
        print("  python update_existing_prompts_to_full.py")
        sys.exit(1)
    
    sql_content = sql_file.read_text(encoding='utf-8')
    
    print("=" * 80)
    print("UPDATING PROMPTS WITH FULL CONTENT")
    print("=" * 80)
    print()
    print(f"SQL file: {sql_file}")
    print(f"File size: {len(sql_content):,} characters")
    print()
    
    # Split SQL into individual statements (separated by semicolons)
    # But PostgreSQL dollar-quoting makes this tricky, so we'll execute statements carefully
    
    # Extract UPDATE statements and verification queries
    # The SQL file has sections separated by comments, each with UPDATE + verification
    
    statements = []
    current_statement = []
    in_dollar_quote = False
    dollar_tag = None
    
    lines = sql_content.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Skip comments (but keep them for context)
        if line.strip().startswith('--'):
            i += 1
            continue
        
        # Check for dollar-quoting start
        if '$' in line and not in_dollar_quote:
            # Find dollar quote tag (e.g., $ENGINEERING_PROMPT_7879$)
            parts = line.split('$')
            if len(parts) >= 3:
                dollar_tag = '$' + parts[1] + '$'
                in_dollar_quote = True
                current_statement.append(line)
        elif in_dollar_quote:
            current_statement.append(line)
            # Check for dollar-quoting end
            if dollar_tag and dollar_tag in line:
                in_dollar_quote = False
                dollar_tag = None
        else:
            current_statement.append(line)
            # If we hit a semicolon and not in dollar quote, it's end of statement
            if ';' in line and not in_dollar_quote:
                statement_text = '\n'.join(current_statement).strip()
                if statement_text:
                    statements.append(statement_text)
                current_statement = []
        
        i += 1
    
    # If there's a leftover statement, add it
    if current_statement:
        statement_text = '\n'.join(current_statement).strip()
        if statement_text:
            statements.append(statement_text)
    
    # Alternative: Just execute the whole file as-is (PostgreSQL can handle it)
    # But we need to split by semicolons that aren't inside dollar quotes
    
    print(f"Found {len(statements)} SQL statements to execute")
    print()
    
    try:
        with engine.connect() as conn:
            # Actually, let's just execute the entire file - PostgreSQL dollar-quoting
            # makes it safer to execute as one transaction
            print("Executing UPDATE statements...")
            print()
            
            # Split by sections (each section is: UPDATE + verification SELECT)
            # Use a simpler approach: execute each section separately
            
            # Find each UPDATE section
            sections = []
            current_section = []
            
            for line in sql_content.split('\n'):
                if line.strip().startswith('-- UPDATE') and current_section:
                    sections.append('\n'.join(current_section))
                    current_section = [line]
                else:
                    current_section.append(line)
            if current_section:
                sections.append('\n'.join(current_section))
            
            # Actually, PostgreSQL can handle the whole file if we execute it properly
            # Let's try executing the whole thing as one transaction
            
            # Remove the verification SELECTs for now (we'll do those separately)
            main_sql = sql_content
            
            # Execute main updates
            print("Updating prompts...")
            conn.execute(text(main_sql))
            conn.commit()
            print("[OK] Updates executed successfully!")
            print()
            
            # Now run verification queries
            print("Verifying updates...")
            print()
            
            verification_query = text("""
                SELECT 
                    name,
                    doc_type,
                    LENGTH(prompt_text) as prompt_length,
                    is_active,
                    updated_at
                FROM prompt_templates
                WHERE scope = 'document_type'
                ORDER BY doc_type
            """)
            
            results = conn.execute(verification_query).fetchall()
            
            print("=" * 80)
            print("VERIFICATION RESULTS:")
            print("=" * 80)
            print()
            
            expected_sizes = {
                'engineering': 48000,
                'finance': 10000,
                'logistics': 7000,
                'transmittal': 3000
            }
            
            all_good = True
            for row in results:
                name = row[0]
                doc_type = row[1]
                length = row[2]
                is_active = row[3]
                updated = row[4]
                
                expected = expected_sizes.get(doc_type, 0)
                status = "OK" if length >= expected * 0.9 else "TOO SMALL"
                
                if length < expected * 0.9:
                    all_good = False
                
                print(f"{name}")
                print(f"  Doc Type: {doc_type}")
                print(f"  Length: {length:,} chars (expected: ~{expected:,})")
                print(f"  Status: {status}")
                print(f"  Active: {is_active}")
                print(f"  Updated: {updated}")
                print()
            
            print("=" * 80)
            if all_good:
                print("SUCCESS! All prompts updated with full content.")
            else:
                print("WARNING: Some prompts may still be placeholders.")
                print("Check the lengths above - they should be much larger than before.")
            print("=" * 80)
            print()
            
    except Exception as e:
        print()
        print("=" * 80)
        print("ERROR: Failed to execute SQL")
        print("=" * 80)
        print(f"Error: {e}")
        print()
        import traceback
        traceback.print_exc()
        print()
        print("Common issues:")
        print("  1. Table 'prompt_templates' doesn't exist - run database migrations first")
        print("  2. Permission denied - check database user permissions")
        print("  3. Connection error - check DATABASE_URL is correct")
        print("  4. Dollar-quoting issue - try running SQL manually via Railway dashboard")
        sys.exit(1)
        
except ImportError as e:
    print(f"ERROR: Could not import required modules: {e}")
    print()
    print("Make sure you have installed dependencies:")
    print("  pip install sqlalchemy psycopg2-binary")
    sys.exit(1)
