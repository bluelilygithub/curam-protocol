"""
Quick test runner for Phase 2.
Run this to verify models and config extraction.
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import and run tests
from tests.test_phase2_models import run_all_tests

if __name__ == "__main__":
    success = run_all_tests()
    
    if success:
        print("\n📋 NEXT STEPS:")
        print("1. Review PHASE2_SUMMARY.md for details")
        print("2. Manually test config imports in Python REPL")
        print("3. Proceed to Phase 3 (extract services)")
        print("\n⚠️  Still DO NOT modify main.py - that comes in Phase 4\n")
    else:
        print("\n❌ Tests failed. Please review errors above.\n")
    
    sys.exit(0 if success else 1)

