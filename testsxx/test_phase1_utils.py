"""
Tests for Phase 1 utility functions.
Run these tests to verify the refactoring worked correctly.
"""

def test_format_currency():
    """Test currency formatting"""
    from utils.formatting import format_currency
    
    print("Testing format_currency...")
    
    # Test valid numbers
    assert format_currency(1234.56) == "$1,234.56", "Failed: decimal number"
    assert format_currency("1234.56") == "$1,234.56", "Failed: string number"
    assert format_currency(1000000) == "$1,000,000.00", "Failed: large number"
    
    # Test edge cases
    assert format_currency("") == "", "Failed: empty string"
    assert format_currency(None) == "", "Failed: None"
    assert format_currency("N/A") == "", "Failed: N/A"
    assert format_currency("invalid") == "invalid", "Failed: invalid string"
    
    print("✓ format_currency tests passed")


def test_clean_text():
    """Test text cleaning"""
    from utils.formatting import clean_text
    
    print("Testing clean_text...")
    
    assert clean_text("  hello   world  ") == "hello world", "Failed: whitespace"
    assert clean_text("hello\n\nworld") == "hello world", "Failed: newlines"
    assert clean_text("") == "", "Failed: empty"
    assert clean_text(None) == "", "Failed: None"
    
    print("✓ clean_text tests passed")


def test_normalize_whitespace():
    """Test whitespace normalization"""
    from utils.formatting import normalize_whitespace
    
    print("Testing normalize_whitespace...")
    
    assert normalize_whitespace("  hello   world  ") == "hello world", "Failed: multiple spaces"
    assert normalize_whitespace("test") == "test", "Failed: single word"
    
    print("✓ normalize_whitespace tests passed")


def test_detect_low_confidence():
    """Test low confidence detection"""
    from utils.formatting import detect_low_confidence
    
    print("Testing detect_low_confidence...")
    
    # High confidence (normal text)
    assert detect_low_confidence("Normal text") == "high", "Failed: normal text"
    assert detect_low_confidence("N/A") == "high", "Failed: N/A"
    
    # Low confidence (garbled OCR)
    assert detect_low_confidence("H H o o t l d d") == "low", "Failed: character soup"
    assert detect_low_confidence("[ sta") == "low", "Failed: truncated"
    
    print("✓ detect_low_confidence tests passed")


def test_format_text_to_html():
    """Test text to HTML conversion"""
    from utils.formatting import format_text_to_html
    
    print("Testing format_text_to_html...")
    
    # Single paragraph
    result = format_text_to_html("Hello world")
    assert "<p>Hello world</p>" in result, "Failed: single paragraph"
    
    # Multiple paragraphs
    result = format_text_to_html("Paragraph one.\n\nParagraph two.")
    assert "<p>Paragraph one.</p>" in result, "Failed: first paragraph"
    assert "<p>Paragraph two.</p>" in result, "Failed: second paragraph"
    
    # Empty input
    assert format_text_to_html("") == "", "Failed: empty input"
    
    print("✓ format_text_to_html tests passed")


def test_prepare_prompt_text():
    """Test prompt text preparation"""
    from utils.prompts import prepare_prompt_text
    
    print("Testing prepare_prompt_text...")
    
    # Test text cleaning
    text = "Hello\n\nWorld  with   spaces"
    result = prepare_prompt_text(text, "finance")
    assert "\n" not in result, "Failed: should remove newlines"
    
    # Test engineering limit
    long_text = "x" * 10000
    result = prepare_prompt_text(long_text, "engineering")
    assert len(result) <= 3200, "Failed: engineering limit"
    
    # Test transmittal limit
    result = prepare_prompt_text(long_text, "transmittal")
    assert len(result) <= 3200, "Failed: transmittal limit"
    
    print("✓ prepare_prompt_text tests passed")


def test_build_prompts():
    """Test prompt building functions"""
    from utils.prompts import build_prompt, build_finance_prompt, build_engineering_prompt, build_transmittal_prompt
    
    print("Testing prompt builders...")
    
    test_text = "Test document text"
    
    # Test finance prompt
    finance = build_finance_prompt(test_text)
    assert "invoice" in finance.lower() or "vendor" in finance.lower(), "Failed: finance prompt"
    assert test_text in finance, "Failed: finance text inclusion"
    
    # Test engineering prompt
    engineering = build_engineering_prompt(test_text)
    assert "mark" in engineering.lower() or "size" in engineering.lower(), "Failed: engineering prompt"
    
    # Test transmittal prompt
    transmittal = build_transmittal_prompt(test_text)
    assert "drawing" in transmittal.lower() or "dwgno" in transmittal.lower(), "Failed: transmittal prompt"
    
    # Test build_prompt router
    assert "vendor" in build_prompt(test_text, "finance").lower(), "Failed: finance routing"
    assert "mark" in build_prompt(test_text, "engineering").lower(), "Failed: engineering routing"
    assert "drawing" in build_prompt(test_text, "transmittal").lower(), "Failed: transmittal routing"
    
    print("✓ prompt builder tests passed")


def test_imports():
    """Test that all imports work correctly"""
    print("Testing imports...")
    
    try:
        from utils import (
            format_currency,
            format_text_to_html,
            clean_text,
            normalize_whitespace,
            build_finance_prompt,
            build_engineering_prompt,
            build_transmittal_prompt
        )
        print("✓ All imports successful")
        return True
    except ImportError as e:
        print(f"✗ Import failed: {e}")
        return False


def run_all_tests():
    """Run all Phase 1 tests"""
    print("\n" + "="*60)
    print("PHASE 1 REFACTORING TESTS")
    print("Testing utils module extraction")
    print("="*60 + "\n")
    
    try:
        # Test imports first
        if not test_imports():
            print("\n✗ TESTS FAILED: Import errors detected")
            return False
        
        # Run all tests
        test_format_currency()
        test_clean_text()
        test_normalize_whitespace()
        test_detect_low_confidence()
        test_format_text_to_html()
        test_prepare_prompt_text()
        test_build_prompts()
        
        print("\n" + "="*60)
        print("✓ ALL TESTS PASSED!")
        print("Phase 1 refactoring successful.")
        print("="*60 + "\n")
        return True
        
    except AssertionError as e:
        print(f"\n✗ TEST FAILED: {e}")
        return False
    except Exception as e:
        print(f"\n✗ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)

