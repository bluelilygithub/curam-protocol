#!/usr/bin/env python3
"""
Diagnose prompt sizes in the database to check if they're placeholders or full prompts.
Expected sizes:
- Engineering: ~14,000+ characters
- Finance: ~10,000+ characters
- Logistics: ~7,191 characters
- Transmittal: ~1,500-2,000 characters
"""

import sys
sys.path.insert(0, '.')

try:
    from database import engine
    from sqlalchemy import text
    
    if not engine:
        print("ERROR: Database engine not available")
        sys.exit(1)
    
    print("=" * 80)
    print("PROMPT SIZE DIAGNOSIS")
    print("=" * 80)
    print()
    
    with engine.connect() as conn:
        # Get all prompts with their actual lengths
        query = text("""
            SELECT 
                id,
                name,
                scope,
                doc_type,
                LENGTH(prompt_text) as prompt_length,
                LEFT(prompt_text, 300) as prompt_preview,
                is_active,
                created_at
            FROM prompt_templates
            ORDER BY scope, doc_type, name
        """)
        
        results = conn.execute(query).fetchall()
        
        if not results:
            print("❌ No prompts found in database!")
            sys.exit(0)
        
        print(f"Found {len(results)} prompt(s) in database:")
        print()
        print("-" * 80)
        
        for row in results:
            prompt_id = row[0]
            name = row[1]
            scope = row[2]
            doc_type = row[3] or 'N/A'
            length = row[4]
            preview = row[5]
            is_active = row[6]
            created = row[7]
            
            print(f"\nID: {prompt_id}")
            print(f"Name: {name}")
            print(f"Scope: {scope} | Doc Type: {doc_type}")
            print(f"Length: {length:,} characters")
            print(f"Status: {'✓ ACTIVE' if is_active else '✗ INACTIVE'}")
            print(f"Created: {created}")
            
            # Check if it's a placeholder or full prompt
            status_icon = "❌"
            status_msg = "PLACEHOLDER (too short)"
            
            if 'Hardcoded Migration' in name or 'Migration' in name:
                if length < 500:
                    status_icon = "❌"
                    status_msg = f"PLACEHOLDER - Only {length} chars (should be 1,000+)"
                elif '[Insert FULL' in preview or '[Continue with full' in preview:
                    status_icon = "❌"
                    status_msg = "PLACEHOLDER - Contains placeholder text"
                elif length >= 1000:
                    # Check against expected sizes
                    if 'Engineering' in name and length < 10000:
                        status_icon = "⚠️"
                        status_msg = f"INCOMPLETE - Only {length:,} chars (Engineering should be ~14,000+)"
                    elif 'Finance' in name and length < 8000:
                        status_icon = "⚠️"
                        status_msg = f"INCOMPLETE - Only {length:,} chars (Finance should be ~10,000+)"
                    elif 'Logistics' in name and length < 6000:
                        status_icon = "⚠️"
                        status_msg = f"INCOMPLETE - Only {length:,} chars (Logistics should be ~7,191)"
                    elif 'Transmittal' in name and length < 1500:
                        status_icon = "⚠️"
                        status_msg = f"INCOMPLETE - Only {length:,} chars (Transmittal should be ~1,500+)"
                    else:
                        status_icon = "✓"
                        status_msg = f"FULL PROMPT - {length:,} chars looks correct"
                else:
                    status_icon = "⚠️"
                    status_msg = f"SUSPICIOUSLY SHORT - {length} chars (might be incomplete)"
            
            print(f"{status_icon} {status_msg}")
            print(f"\nPreview (first 300 chars):")
            print(f"  {preview[:300]}...")
            
            if '[Insert FULL' in preview or '[Continue with full' in preview:
                print("\n  ⚠️  WARNING: Contains placeholder marker!")
            
            print("-" * 80)
        
        print()
        print("=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print()
        
        # Group by document type
        by_doc_type = {}
        for row in results:
            doc_type = row[3] or 'N/A'
            length = row[4]
            name = row[1]
            
            if doc_type not in by_doc_type:
                by_doc_type[doc_type] = []
            by_doc_type[doc_type].append((name, length))
        
        for doc_type, prompts in by_doc_type.items():
            print(f"\n{doc_type}:")
            for name, length in prompts:
                status = "✓" if length >= 1000 else "❌"
                print(f"  {status} {name}: {length:,} chars")
        
        print()
        print("=" * 80)
        print("EXPECTED SIZES:")
        print("=" * 80)
        print("  Engineering: ~14,000+ characters")
        print("  Finance: ~10,000+ characters")
        print("  Logistics: ~7,191 characters")
        print("  Transmittal: ~1,500-2,000 characters")
        print()
        print("If prompts are much smaller, they are PLACEHOLDERS and need to be replaced!")
        print("=" * 80)
        
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
