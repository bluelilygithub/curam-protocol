#!/usr/bin/env python3
"""
Cleanup Script - Remove Commented Functions from main.py

This script removes all the commented code blocks from Phase 3.1, 3.2, and 3.3a.
Run this AFTER 48-72 hours of stable operation.

Usage:
    python cleanup_phase3.py

This will:
1. Remove all Phase 3.1 commented validation functions
2. Remove all Phase 3.2 commented PDF functions
3. Remove all Phase 3.3a commented Gemini functions
4. Create a backup: main.py.backup
5. Show before/after line counts
"""

import re
import shutil
from datetime import datetime

def cleanup_main_py():
    """Remove all commented Phase 3 code blocks"""
    
    # Create backup
    backup_name = f"main.py.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy('main.py', backup_name)
    print(f"✓ Created backup: {backup_name}")
    
    # Read file
    with open('main.py', 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_lines = content.count('\n')
    print(f"Original file: {original_lines} lines")
    
    # Pattern to match our comment blocks:
    # ################################################################################
    # # MOVED TO services/... - Phase 3.X
    # ... (multiple comment lines)
    # ################################################################################
    
    pattern = r'#{80,}\n# MOVED TO services/.*?- Phase 3\.\d+.*?\n.*?\n.*?\n#{80,}\n(#[^\n]*\n)+'
    
    # Remove all matching blocks
    cleaned_content = re.sub(pattern, '', content, flags=re.MULTILINE)
    
    cleaned_lines = cleaned_content.count('\n')
    removed_lines = original_lines - cleaned_lines
    
    # Write cleaned version
    with open('main.py', 'w', encoding='utf-8') as f:
        f.write(cleaned_content)
    
    print(f"✓ Cleaned file: {cleaned_lines} lines")
    print(f"✓ Removed: {removed_lines} lines of commented code")
    print(f"✓ Reduction: {(removed_lines / original_lines * 100):.1f}%")
    print(f"\nBackup saved as: {backup_name}")
    print("Review the changes, then commit to git!")

if __name__ == "__main__":
    print("Phase 3 Cleanup Script")
    print("=" * 60)
    print("\nThis will remove all commented Phase 3 code from main.py")
    print("A backup will be created automatically.")
    
    response = input("\nProceed with cleanup? (yes/no): ")
    
    if response.lower() in ['yes', 'y']:
        cleanup_main_py()
        print("\n✓ Cleanup complete!")
        print("\nNext steps:")
        print("1. Review main.py to ensure it looks correct")
        print("2. Test locally: python main.py")
        print("3. Commit: git add main.py")
        print("4. Commit: git commit -m 'Phase 3 cleanup: Remove commented code'")
        print("5. Deploy: git push origin main")
    else:
        print("Cleanup cancelled.")