#!/usr/bin/env python3
"""
Quick script to check prompt status in the database
This helps verify prompts are loaded and check their status
"""

import os
import sys
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    print("❌ ERROR: DATABASE_URL not set")
    print("Please set your DATABASE_URL environment variable")
    sys.exit(1)

print("=" * 80)
print("Checking Prompt Status in Database")
print("=" * 80)
print()

try:
    engine = create_engine(DATABASE_URL)
    
    with engine.connect() as conn:
        # Check if prompt_templates table exists
        table_check = conn.execute(text("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'prompt_templates'
            )
        """))
        table_exists = table_check.scalar()
        
        if not table_exists:
            print("❌ ERROR: prompt_templates table does not exist!")
            print("You need to run the database setup SQL first.")
            sys.exit(1)
        
        print("✓ prompt_templates table exists")
        print()
        
        # Count all prompts
        count_query = conn.execute(text("""
            SELECT COUNT(*) as total
            FROM prompt_templates
        """))
        total_count = count_query.scalar()
        print(f"Total prompts in database: {total_count}")
        print()
        
        # Count migrated prompts
        migrated_query = conn.execute(text("""
            SELECT COUNT(*) as count
            FROM prompt_templates
            WHERE name LIKE '%Hardcoded Migration%'
        """))
        migrated_count = migrated_query.scalar()
        print(f"Migrated prompts (Hardcoded Migration): {migrated_count}")
        print()
        
        # Count active vs inactive migrated prompts
        status_query = conn.execute(text("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN NOT is_active THEN 1 ELSE 0 END) as inactive
            FROM prompt_templates
            WHERE name LIKE '%Hardcoded Migration%'
        """))
        status = status_query.fetchone()
        total_migrated = status[0] or 0
        active_count = status[1] or 0
        inactive_count = status[2] or 0
        
        print(f"Migrated prompts status:")
        print(f"  Active: {active_count}")
        print(f"  Inactive: {inactive_count}")
        print()
        
        # List all migrated prompts with details
        if migrated_count > 0:
            prompts_query = conn.execute(text("""
                SELECT 
                    id,
                    name,
                    scope,
                    doc_type,
                    LENGTH(prompt_text) as prompt_length,
                    priority,
                    is_active,
                    created_at
                FROM prompt_templates
                WHERE name LIKE '%Hardcoded Migration%'
                ORDER BY doc_type, priority
            """))
            prompts = prompts_query.fetchall()
            
            print("=" * 80)
            print("Migrated Prompts Details:")
            print("=" * 80)
            for prompt in prompts:
                status_badge = "✓ ACTIVE" if prompt[6] else "✗ INACTIVE"
                print(f"\nID: {prompt[0]}")
                print(f"  Name: {prompt[1]}")
                print(f"  Scope: {prompt[2]}")
                print(f"  Doc Type: {prompt[3] or 'N/A'}")
                print(f"  Length: {prompt[4]:,} characters")
                print(f"  Priority: {prompt[5]}")
                print(f"  Status: {status_badge}")
                print(f"  Created: {prompt[7]}")
        else:
            print("⚠️  WARNING: No migrated prompts found!")
            print("You need to run prompts_migration_generated.sql first.")
            print()
            print("To migrate prompts, run:")
            print("  python extract_prompts_to_sql.py  # Generate SQL")
            print("  # Then run prompts_migration_generated.sql in your database")
        
        print()
        print("=" * 80)
        
        if inactive_count > 0:
            print(f"⚠️  You have {inactive_count} inactive migrated prompt(s)")
            print("To activate them:")
            print("  1. Use the admin interface: /admin/prompts → Click 'Activate All Migrated Prompts'")
            print("  2. Or run SQL: UPDATE prompt_templates SET is_active = true WHERE name LIKE '%Hardcoded Migration%';")
        elif active_count > 0:
            print("✓ All migrated prompts are ACTIVE!")
            print("The system should be using database prompts now.")
        else:
            print("⚠️  No migrated prompts found. You may need to run the migration SQL.")
        
        print("=" * 80)

except Exception as e:
    print(f"❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
