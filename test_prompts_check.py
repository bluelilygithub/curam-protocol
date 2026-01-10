#!/usr/bin/env python3
"""
Quick test to check prompt status using the existing database module
"""

import os
import sys

# Add current directory to path so we can import database module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from database import get_all_prompts, engine
    
    print("=" * 80)
    print("Testing Prompt System")
    print("=" * 80)
    print()
    
    # Test database connection
    if not engine:
        print("❌ ERROR: Database engine not initialized")
        print("Check that DATABASE_URL environment variable is set")
        sys.exit(1)
    
    print("✓ Database engine initialized")
    print()
    
    # Get all prompts
    try:
        prompts = get_all_prompts()
        print(f"✓ Successfully queried prompts: {len(prompts)} found")
        print()
    except Exception as e:
        print(f"❌ ERROR querying prompts: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    if not prompts:
        print("⚠️  WARNING: No prompts found in database!")
        print()
        print("You need to:")
        print("  1. Generate SQL: python extract_prompts_to_sql.py")
        print("  2. Run prompts_migration_generated.sql in your database")
        sys.exit(0)
    
    # Filter migrated prompts
    migrated_prompts = [p for p in prompts if 'Hardcoded Migration' in p.get('name', '')]
    active_prompts = [p for p in migrated_prompts if p.get('is_active', False)]
    inactive_prompts = [p for p in migrated_prompts if not p.get('is_active', False)]
    
    print(f"Total prompts in database: {len(prompts)}")
    print(f"Migrated prompts (Hardcoded Migration): {len(migrated_prompts)}")
    print(f"  - Active: {len(active_prompts)}")
    print(f"  - Inactive: {len(inactive_prompts)}")
    print()
    
    if migrated_prompts:
        print("=" * 80)
        print("Migrated Prompts Details:")
        print("=" * 80)
        for prompt in migrated_prompts:
            status = "✓ ACTIVE" if prompt.get('is_active') else "✗ INACTIVE"
            print(f"\nID: {prompt.get('id')}")
            print(f"  Name: {prompt.get('name')}")
            print(f"  Scope: {prompt.get('scope')}")
            print(f"  Doc Type: {prompt.get('doc_type') or 'N/A'}")
            print(f"  Length: {prompt.get('prompt_length', 0):,} characters")
            print(f"  Priority: {prompt.get('priority', 0)}")
            print(f"  Status: {status}")
    
    print()
    print("=" * 80)
    
    if len(inactive_prompts) > 0:
        print(f"⚠️  You have {len(inactive_prompts)} inactive migrated prompt(s)")
        print()
        print("To activate them, you have 3 options:")
        print()
        print("1. USE ADMIN INTERFACE (Recommended):")
        print("   - Go to: http://your-domain/admin/prompts")
        print("   - Click: 'Activate All Migrated Prompts' button")
        print()
        print("2. USE SQL FILE:")
        print("   - Run: database_enable_prompts.sql in your PostgreSQL database")
        print()
        print("3. ACTIVATE INDIVIDUALLY:")
        print("   - Go to: http://your-domain/admin/prompts")
        print("   - Click 'Activate' button next to each prompt")
        print()
    elif len(active_prompts) > 0:
        print("✓ All migrated prompts are ACTIVE!")
        print()
        print("The system should be using database prompts now.")
        print("You can test by:")
        print("  1. Running a document extraction")
        print("  2. Checking logs for '✓ Using database prompt' messages")
        print("  3. Or checking /admin/prompts to verify status")
    else:
        print("⚠️  No migrated prompts found.")
        print()
        print("You need to migrate prompts first:")
        print("  1. python extract_prompts_to_sql.py")
        print("  2. Run prompts_migration_generated.sql in your database")
    
    print("=" * 80)
    
except ImportError as e:
    print(f"❌ ERROR: Could not import database module: {e}")
    print("Make sure you're running this from the project root directory")
    sys.exit(1)
except Exception as e:
    print(f"❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
