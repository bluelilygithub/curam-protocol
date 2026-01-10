#!/usr/bin/env python3
"""
Execute the logistics prompt SQL file to insert/update the prompt in the database.
This script reads database_insert_logistics_prompt.sql and executes it.
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
        print("For Railway: DATABASE_URL is automatically set.")
        print("For local: Set it in your .env file")
        sys.exit(1)
    
    # Read the SQL file
    sql_file = Path('database_insert_logistics_prompt.sql')
    if not sql_file.exists():
        print(f"ERROR: SQL file not found: {sql_file}")
        sys.exit(1)
    
    sql_content = sql_file.read_text(encoding='utf-8')
    
    print("=" * 80)
    print("Executing Logistics Prompt SQL")
    print("=" * 80)
    print()
    print(f"SQL file: {sql_file}")
    print(f"File size: {len(sql_content):,} characters")
    print()
    
    # Split SQL into individual statements (separated by semicolons)
    # PostgreSQL dollar-quoting makes this tricky, so we'll execute the whole thing
    # But first, remove the verification query at the end
    
    # Find where the INSERT/UPDATE ends and verification starts
    verification_start = sql_content.find('-- Verify the prompt was inserted')
    main_sql = sql_content[:verification_start].strip() if verification_start > 0 else sql_content.strip()
    verification_sql = sql_content[verification_start:].strip() if verification_start > 0 else None
    
    try:
        with engine.connect() as conn:
            # Execute the main INSERT/UPDATE statement
            print("Executing INSERT/UPDATE statement...")
            conn.execute(text(main_sql))
            conn.commit()
            print("✓ SQL executed successfully!")
            print()
            
            # Run verification query if present
            if verification_sql:
                print("Verifying prompt was inserted...")
                # Extract just the SELECT statement
                select_start = verification_sql.find('SELECT')
                if select_start > 0:
                    select_sql = verification_sql[select_start:].strip()
                    # Remove trailing semicolon if present
                    if select_sql.endswith(';'):
                        select_sql = select_sql[:-1]
                    
                    result = conn.execute(text(select_sql))
                    rows = result.fetchall()
                    
                    if rows:
                        print()
                        print("=" * 80)
                        print("VERIFICATION RESULTS:")
                        print("=" * 80)
                        for row in rows:
                            print(f"  ID: {row[0]}")
                            print(f"  Name: {row[1]}")
                            print(f"  Scope: {row[2]}")
                            print(f"  Doc Type: {row[3]}")
                            print(f"  Prompt Length: {row[4]:,} characters")
                            print(f"  Active: {row[5]}")
                            print(f"  Created: {row[6]}")
                            print()
                            
                            if row[4] < 1000:
                                print("  ⚠️  WARNING: Prompt length is very short!")
                                print("     This might indicate a placeholder was inserted instead of full prompt.")
                            elif row[4] >= 7000:
                                print("  ✓ Prompt length looks correct (full prompt inserted)")
                            
                            if row[5]:
                                print("  ✓ Prompt is ACTIVE - will be used by the system")
                            else:
                                print("  ⚠️  Prompt is INACTIVE - will NOT be used (set is_active = true)")
                        print("=" * 80)
                    else:
                        print("⚠️  No prompt found after insertion - something went wrong!")
                else:
                    print("(Verification query not found in SQL file)")
            
            print()
            print("=" * 80)
            print("SUCCESS!")
            print("=" * 80)
            print()
            print("The logistics prompt has been inserted/updated in the database.")
            print("The system will now use the database prompt for logistics documents.")
            print()
            print("To test:")
            print("  1. Run a logistics document extraction")
            print("  2. Check logs for: '✓ Using database prompt for logistics'")
            print("  3. You should see: 'length: ~7,000+ chars' (not ~100-200 if it was a placeholder)")
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
        sys.exit(1)
        
except ImportError as e:
    print(f"ERROR: Could not import required modules: {e}")
    print()
    print("Make sure you have installed dependencies:")
    print("  pip install sqlalchemy psycopg2-binary")
    sys.exit(1)
