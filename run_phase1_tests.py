"""
Quick test runner for Phase 1.
Run this to verify the refactoring worked.
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import and run tests
from tests.test_phase1_utils import run_all_tests

if __name__ == "__main__":
    success = run_all_tests()
    
    if success:
        print("\n📋 NEXT STEPS:")
        print("1. Review PHASE1_README.md for details")
        print("2. Manually test a few functions in Python REPL")
        print("3. Proceed to Phase 2 (extract models/config)")
        print("\n⚠️  DO NOT modify main.py yet - that comes in Phase 4\n")
    else:
        print("\n❌ Tests failed. Please review errors above.")
        print("Check PHASE1_README.md for troubleshooting tips.\n")
    
    sys.exit(0 if success else 1)

