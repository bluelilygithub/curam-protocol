"""
Test script for UTF-8 encoding sanitizer

Run this to verify the encoding sanitizer is working correctly.

Usage:
    python test_encoding_sanitizer.py
"""

from utils.encoding_fix import (
    sanitize_text,
    sanitize_dict,
    sanitize_json_response,
    test_sanitizer
)


def test_basic_sanitization():
    """Test basic text sanitization"""
    print("=" * 70)
    print("TEST 1: Basic Text Sanitization")
    print("=" * 70)
    
    test_cases = [
        ("Curam-Ai Protocol\u00e2\u0084\u00a2", "Curam-Ai Protocol\u2122"),
        ("\u00c3\u0083\u00c2\u00a2\u00c3\u0085\u00e2\u0080\u009c\u00c3\u00a2\u00e2\u0082\u00ac\u00c5\u0093 Database connected", "\u2713 Database connected"),
        ("\u00c3\u0083\u00c2\u00a2\u00c3\u00a2\u00e2\u0082\u00ac\u00c2\u00a0\u00c3\u00a2\u00e2\u0082\u00ac\u00e2\u0084\u00a2 First item", "\u2022 First item"),
        ("It\u00e2\u0080\u0099s working", "It's working"),
        ("Price: $1,000\u00e2\u0080\u0093$2,000", "Price: $1,000\u2014$2,000"),
        ("\u00c3\u00b0\u00c5\u0093\u00e2\u0080\u0093\u00c2\u00a5 Upload complete", "\U0001f4e5 Upload complete"),
    ]
    
    passed = 0
    failed = 0
    
    for corrupt, expected in test_cases:
        result = sanitize_text(corrupt)
        if result == expected:
            status = "PASS"
            passed += 1
            print(f"{status}: '{corrupt}' -> '{result}'")
        else:
            status = "FAIL"
            failed += 1
            print(f"{status}: '{corrupt}'")
            print(f"  Expected: '{expected}'")
            print(f"  Got:      '{result}'")
    
    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


def test_dict_sanitization():
    """Test dictionary sanitization"""
    print("\n" + "=" * 70)
    print("TEST 2: Dictionary Sanitization")
    print("=" * 70)
    
    corrupt_data = {
        "name": "Curam\u00e2\u0084\u00a2",
        "status": "\u00c3\u0083\u00c2\u00a2\u00c3\u0085\u00e2\u0080\u009c\u00c3\u00a2\u00e2\u0082\u00ac\u00c5\u0093 Complete",
        "items": [
            "First item\u00e2\u0080\u0099s value",
            "Second item\u00e2\u0080\u0094ready"
        ],
        "nested": {
            "field": "\u00c3\u00b0\u00c5\u0093\u00e2\u0080\u0093\u00c2\u00a5 Uploaded"
        }
    }
    
    expected_data = {
        "name": "Curam\u2122",
        "status": "\u2713 Complete",
        "items": [
            "First item's value",
            "Second item\u2014ready"
        ],
        "nested": {
            "field": "\U0001f4e5 Uploaded"
        }
    }
    
    result = sanitize_dict(corrupt_data)
    
    if result == expected_data:
        print("PASS: Dictionary sanitization works correctly")
        print(f"  Input:  {corrupt_data}")
        print(f"  Output: {result}")
        return True
    else:
        print("FAIL: Dictionary sanitization failed")
        print(f"  Input:    {corrupt_data}")
        print(f"  Expected: {expected_data}")
        print(f"  Got:      {result}")
        return False


def test_json_response_sanitization():
    """Test JSON response sanitization"""
    print("\n" + "=" * 70)
    print("TEST 3: JSON Response Sanitization")
    print("=" * 70)
    
    corrupt_json = '''```json
    {
        "vendor": "ABC Company\u00e2\u0084\u00a2",
        "status": "\u00c3\u0083\u00c2\u00a2\u00c3\u0085\u00e2\u0080\u009c\u00c3\u00a2\u00e2\u0082\u00ac\u00c5\u0093",
        "note": "It\u00e2\u0080\u0099s ready"
    }
    ```'''
    
    expected_start = '{"vendor": "ABC Company\u2122"'
    
    result = sanitize_json_response(corrupt_json)
    
    # Check if markdown removed and text sanitized
    if "```" not in result and "ABC Company\u2122" in result and "It's ready" in result:
        print("PASS: JSON response sanitization works")
        print(f"  Input:  {repr(corrupt_json[:50])}...")
        print(f"  Output: {result[:100]}...")
        return True
    else:
        print("FAIL: JSON response sanitization failed")
        print(f"  Input:  {corrupt_json}")
        print(f"  Output: {result}")
        return False


def test_real_world_examples():
    """Test real-world examples from document extraction"""
    print("\n" + "=" * 70)
    print("TEST 4: Real-World Examples")
    print("=" * 70)
    
    examples = [
        # Engineering comments
        ("Hold 40mm grout under base plate per AS3600", "Hold 40mm grout under base plate per AS3600"),
        ("Install per specification ABC-123\u00e2\u0080\u0094see detail D-12", "Install per specification ABC-123\u2014see detail D-12"),
        ("Corrosion noted at base [handwritten: \u00e2\u0080\u0098APPROVED\u00e2\u0080\u0099]", "Corrosion noted at base [handwritten: 'APPROVED']"),
        
        # Finance data
        ("Total: $1,234.56 (includes GST\u00e2\u0084\u00a2)", "Total: $1,234.56 (includes GST\u2122)"),
        ("Payment terms\u00e2\u0080\u0094Net 30 days", "Payment terms\u2014Net 30 days"),
        
        # Status messages
        ("\u00c3\u0083\u00c2\u00a2\u00c3\u0085\u00e2\u0080\u009c\u00c3\u00a2\u00e2\u0082\u00ac\u00c5\u0093 Extraction complete", "\u2713 Extraction complete"),
        ("\u00e2\u009c\u0094 Failed to parse", "\u2713 Failed to parse"),  # Different check mark corruption
        ("\u00e2\u009a\u00a0 Warning: Low confidence", "\u26a0 Warning: Low confidence"),
    ]
    
    passed = 0
    failed = 0
    
    for corrupt, expected in examples:
        result = sanitize_text(corrupt)
        
        if result == expected:
            status = "PASS"
            passed += 1
            print(f"{status}: {corrupt[:50]}...")
        else:
            status = "FAIL"
            failed += 1
            print(f"{status}: {corrupt}")
            print(f"  Expected: {expected}")
            print(f"  Got:      {result}")
    
    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


def main():
    """Run all tests"""
    print("\n" + "=" * 70)
    print("UTF-8 ENCODING SANITIZER TEST SUITE")
    print("=" * 70)
    print()
    
    # Run tests
    test1 = test_basic_sanitization()
    test2 = test_dict_sanitization()
    test3 = test_json_response_sanitization()
    test4 = test_real_world_examples()
    
    # Run built-in tests
    print("\n" + "=" * 70)
    print("TEST 5: Built-in Sanitizer Tests")
    print("=" * 70)
    results = test_sanitizer()
    
    all_passed = all(r['passed'] == '\u2713' for r in results.values())
    for name, result in results.items():
        status = "PASS" if result['passed'] == '\u2713' else "FAIL"
        print(f"{status} {name.capitalize()}: '{result['input']}' -> '{result['output']}'")
        if result['passed'] != '\u2713':
            print(f"  Expected: '{result['expected']}'")
    
    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    
    all_tests_passed = test1 and test2 and test3 and test4 and all_passed
    
    if all_tests_passed:
        print("\u2713 ALL TESTS PASSED")
        print("\nThe encoding sanitizer is working correctly!")
        print("\nIntegration points:")
        print("  \u2713 services/gemini_service.py - Sanitizes AI responses")
        print("  \u2713 services/pdf_service.py - Sanitizes PDF extraction")
        print("  \u2713 main.py - Jinja2 filter and CSV export")
    else:
        print("\u2717 SOME TESTS FAILED")
        print("\nPlease review the failed tests above.")
    
    return all_tests_passed


if __name__ == "__main__":
    import sys
    success = main()
    sys.exit(0 if success else 1)
