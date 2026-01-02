"""
Tests for Phase 2 models and configuration.
Run these tests to verify the refactoring worked correctly.
"""


def test_department_config_imports():
    """Test that all config data imports correctly"""
    print("Testing department config imports...")
    
    from models.department_config import (
        DEFAULT_DEPARTMENT,
        DEPARTMENT_SAMPLES,
        ROUTINE_DESCRIPTIONS,
        ROUTINE_SUMMARY,
        ALLOWED_SAMPLE_PATHS,
        SAMPLE_TO_DEPT,
        FINANCE_FIELDS,
        ENGINEERING_BEAM_FIELDS,
        DOC_FIELDS,
        ERROR_FIELD
    )
    
    # Test DEFAULT_DEPARTMENT
    assert DEFAULT_DEPARTMENT == "finance", "Failed: default department"
    
    # Test DEPARTMENT_SAMPLES structure
    assert "finance" in DEPARTMENT_SAMPLES, "Failed: finance department missing"
    assert "engineering" in DEPARTMENT_SAMPLES, "Failed: engineering department missing"
    assert "transmittal" in DEPARTMENT_SAMPLES, "Failed: transmittal department missing"
    
    # Test finance samples
    finance_samples = DEPARTMENT_SAMPLES["finance"]["samples"]
    assert len(finance_samples) > 0, "Failed: no finance samples"
    assert finance_samples[0]["path"].endswith(".pdf"), "Failed: sample path format"
    
    # Test SAMPLE_TO_DEPT mapping
    assert len(SAMPLE_TO_DEPT) > 0, "Failed: empty sample mapping"
    assert "invoices/Bne.pdf" in SAMPLE_TO_DEPT, "Failed: sample mapping"
    assert SAMPLE_TO_DEPT["invoices/Bne.pdf"] == "finance", "Failed: sample dept mapping"
    
    # Test ALLOWED_SAMPLE_PATHS
    assert len(ALLOWED_SAMPLE_PATHS) > 0, "Failed: empty allowed paths"
    assert "invoices/Bne.pdf" in ALLOWED_SAMPLE_PATHS, "Failed: allowed path"
    
    # Test ROUTINE_DESCRIPTIONS
    assert "finance" in ROUTINE_DESCRIPTIONS, "Failed: finance description missing"
    assert len(ROUTINE_DESCRIPTIONS["finance"]) > 0, "Failed: empty finance description"
    
    # Test ROUTINE_SUMMARY
    assert "finance" in ROUTINE_SUMMARY, "Failed: finance summary missing"
    assert len(ROUTINE_SUMMARY["finance"]) > 0, "Failed: empty finance summary"
    
    # Test field schemas
    assert "Vendor" in FINANCE_FIELDS, "Failed: Vendor field missing"
    assert "Mark" in ENGINEERING_BEAM_FIELDS, "Failed: Mark field missing"
    
    # Test DOC_FIELDS mapping
    assert "finance" in DOC_FIELDS, "Failed: finance fields mapping"
    assert DOC_FIELDS["finance"] == FINANCE_FIELDS, "Failed: finance fields match"
    
    # Test ERROR_FIELD mapping
    assert ERROR_FIELD["finance"] == "Summary", "Failed: error field mapping"
    
    print("✓ Department config tests passed")


def test_models_package_imports():
    """Test importing from models package"""
    print("Testing models package imports...")
    
    from models import (
        DEPARTMENT_SAMPLES,
        ROUTINE_DESCRIPTIONS,
        ROUTINE_SUMMARY,
        ALLOWED_SAMPLE_PATHS,
        SAMPLE_TO_DEPT
    )
    
    # Test that imports work from package level
    assert "finance" in DEPARTMENT_SAMPLES, "Failed: package import"
    assert len(ROUTINE_DESCRIPTIONS) > 0, "Failed: routine descriptions"
    
    print("✓ Models package import tests passed")


def test_config_classes():
    """Test configuration classes"""
    print("Testing config classes...")
    
    from config import Config, DevelopmentConfig, ProductionConfig, TestingConfig, get_config
    
    # Test base config
    assert hasattr(Config, 'SECRET_KEY'), "Failed: SECRET_KEY missing"
    assert hasattr(Config, 'GEMINI_API_KEY'), "Failed: GEMINI_API_KEY missing"
    assert hasattr(Config, 'DEFAULT_DEPARTMENT'), "Failed: DEFAULT_DEPARTMENT missing"
    
    # Test development config
    dev_config = DevelopmentConfig()
    assert dev_config.DEBUG is True, "Failed: dev debug mode"
    assert dev_config.TESTING is False, "Failed: dev testing mode"
    
    # Test production config
    prod_config = ProductionConfig()
    assert prod_config.DEBUG is False, "Failed: prod debug mode"
    
    # Test testing config
    test_config = TestingConfig()
    assert test_config.TESTING is True, "Failed: test testing mode"
    
    # Test get_config function
    config = get_config('development')
    assert config == DevelopmentConfig, "Failed: get_config development"
    
    config = get_config('production')
    assert config == ProductionConfig, "Failed: get_config production"
    
    config = get_config('testing')
    assert config == TestingConfig, "Failed: get_config testing"
    
    print("✓ Config class tests passed")


def test_config_values():
    """Test configuration values"""
    print("Testing config values...")
    
    from config import Config
    
    # Test prompt limits
    assert Config.ENGINEERING_PROMPT_LIMIT == 10000, "Failed: engineering limit"
    assert Config.ENGINEERING_PROMPT_LIMIT_SHORT == 3200, "Failed: engineering short limit"
    assert Config.TRANSMITTAL_PROMPT_LIMIT == 3200, "Failed: transmittal limit"
    
    # Test file settings
    assert Config.MAX_CONTENT_LENGTH == 16 * 1024 * 1024, "Failed: max content length"
    assert 'pdf' in Config.ALLOWED_EXTENSIONS, "Failed: allowed extensions"
    
    # Test default department
    assert Config.DEFAULT_DEPARTMENT == "finance", "Failed: default dept"
    
    print("✓ Config value tests passed")


def test_department_samples_structure():
    """Test department samples data structure"""
    print("Testing department samples structure...")
    
    from models.department_config import DEPARTMENT_SAMPLES
    
    # Test each department has required keys
    for dept_key, dept_data in DEPARTMENT_SAMPLES.items():
        assert "label" in dept_data, f"Failed: {dept_key} missing label"
        assert "description" in dept_data, f"Failed: {dept_key} missing description"
        assert "folder" in dept_data, f"Failed: {dept_key} missing folder"
        assert "samples" in dept_data, f"Failed: {dept_key} missing samples"
        
        # Test each sample has required keys
        for sample in dept_data["samples"]:
            assert "path" in sample, f"Failed: {dept_key} sample missing path"
            assert "label" in sample, f"Failed: {dept_key} sample missing label"
    
    print("✓ Department samples structure tests passed")


def test_routine_descriptions_content():
    """Test routine descriptions contain expected content"""
    print("Testing routine descriptions content...")
    
    from models.department_config import ROUTINE_DESCRIPTIONS
    
    # Test finance description contains key terms
    finance_desc = ROUTINE_DESCRIPTIONS["finance"][0][1]
    assert "invoice" in finance_desc.lower() or "vendor" in finance_desc.lower(), \
        "Failed: finance description missing key terms"
    
    # Test engineering description contains key terms
    eng_desc = ROUTINE_DESCRIPTIONS["engineering"][0][1]
    assert "schedule" in eng_desc.lower() or "engineer" in eng_desc.lower(), \
        "Failed: engineering description missing key terms"
    
    # Test transmittal description contains key terms
    trans_desc = ROUTINE_DESCRIPTIONS["transmittal"][0][1]
    assert "drawing" in trans_desc.lower() or "drafter" in trans_desc.lower(), \
        "Failed: transmittal description missing key terms"
    
    print("✓ Routine descriptions content tests passed")


def run_all_tests():
    """Run all Phase 2 tests"""
    print("\n" + "="*60)
    print("PHASE 2 REFACTORING TESTS")
    print("Testing models and config extraction")
    print("="*60 + "\n")
    
    try:
        # Run all tests
        test_department_config_imports()
        test_models_package_imports()
        test_config_classes()
        test_config_values()
        test_department_samples_structure()
        test_routine_descriptions_content()
        
        print("\n" + "="*60)
        print("✓ ALL TESTS PASSED!")
        print("Phase 2 refactoring successful.")
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

