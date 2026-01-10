#!/usr/bin/env python3
"""Check what's in the database for logistics prompt"""

import sys
sys.path.insert(0, '.')

try:
    from database import engine
    from sqlalchemy import text
    
    if not engine:
        print("ERROR: Database engine not available")
        sys.exit(1)
    
    with engine.connect() as conn:
        # Check for logistics/fta-list prompts
        query = text("""
            SELECT 
                id,
                name,
                scope,
                doc_type,
                LENGTH(prompt_text) as prompt_length,
                LEFT(prompt_text, 200) as prompt_preview,
                is_active,
                created_at
            FROM prompt_templates
            WHERE (doc_type = 'fta-list' OR doc_type = 'logistics' OR name LIKE '%Logistics%' OR name LIKE '%logistics%')
            ORDER BY created_at DESC
        """)
        
        results = conn.execute(query).fetchall()
        
        if not results:
            print("=" * 80)
            print("❌ NO LOGISTICS PROMPTS FOUND IN DATABASE")
            print("=" * 80)
            print()
            print("This confirms why logistics is using the hardcoded fallback!")
            print("The logistics prompt was never fully migrated to the database.")
            print()
            print("Solution: Run database_insert_logistics_prompt.sql to insert it.")
        else:
            print("=" * 80)
            print(f"Found {len(results)} logistics-related prompt(s):")
            print("=" * 80)
            print()
            
            for i, row in enumerate(results, 1):
                print(f"Prompt {i}:")
                print(f"  ID: {row[0]}")
                print(f"  Name: {row[1]}")
                print(f"  Scope: {row[2]}")
                print(f"  Doc Type: {row[3]}")
                print(f"  Length: {row[4]:,} characters")
                print(f"  Active: {row[6]}")
                print(f"  Created: {row[7]}")
                print(f"  Preview: {row[5][:150]}...")
                
                # Check if it's a placeholder
                if '[Insert FULL' in row[5] or '[Continue with full' in row[5] or '[Insert FULL' in str(row[5]):
                    print()
                    print("  ⚠️  WARNING: This appears to be a PLACEHOLDER, not the full prompt!")
                    print("     This explains why it's not working properly.")
                
                print()
                print("-" * 80)
                print()
            
            # Check active status
            active_count = sum(1 for r in results if r[6])
            if active_count == 0:
                print("⚠️  All logistics prompts are INACTIVE")
                print("   This is why the database lookup returns None!")
            else:
                print(f"✓ {active_count} logistics prompt(s) are ACTIVE")
                
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
