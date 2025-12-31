"""
Image Preprocessing Service - Ready for Production
Enhances image quality for better AI extraction accuracy

Installation:
    pip install pillow opencv-python-headless pytesseract numpy
    
Railway deployment:
    Add to railway.toml aptPkgs: ["tesseract-ocr", "tesseract-ocr-eng", "libsm6", "libxext6"]
    
Usage:
    from services.image_preprocessing import process_image_for_extraction
    
    enhanced_path, ocr_text, quality = process_image_for_extraction("scan.jpg")
    # Use enhanced_path with Gemini Vision API
    # Use ocr_text for cross-validation
"""

import os
import sys
from PIL import Image, ImageEnhance, ImageFilter
import numpy as np

# Optional CV2 - graceful degradation if not available
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("WARNING: opencv-python not installed. Advanced image enhancement disabled.")

# Optional Tesseract - graceful degradation
try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    print("WARNING: pytesseract not installed. OCR backup disabled.")


def enhance_image_basic(image_path, output_dir="/tmp"):
    """
    Basic image enhancement using only PIL (no CV2 required)
    Fallback method when opencv is not available
    """
    try:
        # Load image
        img = Image.open(image_path)
        
        # Convert to RGB if needed
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Increase sharpness (helps with blurry scans)
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(2.0)
        
        # Increase contrast (helps with faded text)
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)
        
        # Increase brightness slightly if image is too dark
        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(1.1)
        
        # Apply unsharp mask filter for better edge definition
        img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
        
        # Save enhanced image
        enhanced_path = os.path.join(output_dir, "enhanced_" + os.path.basename(image_path))
        img.save(enhanced_path, quality=95)
        
        return enhanced_path
    
    except Exception as e:
        print(f"Basic image enhancement failed: {e}")
        return image_path  # Return original if enhancement fails


def enhance_image_advanced(image_path, output_dir="/tmp"):
    """
    Advanced image enhancement using OpenCV
    Better quality but requires opencv-python
    """
    if not CV2_AVAILABLE:
        return enhance_image_basic(image_path, output_dir)
    
    try:
        # Load image
        img = Image.open(image_path)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Apply basic PIL enhancements first
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(1.5)
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.3)
        
        # Convert to OpenCV format
        img_array = np.array(img)
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        
        # Denoise
        denoised = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
        
        # Adaptive thresholding for better text contrast
        binary = cv2.adaptiveThreshold(
            denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 11, 2
        )
        
        # Morphological operations to clean up
        kernel = np.ones((2,2), np.uint8)
        cleaned = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        
        # Save enhanced image
        enhanced_path = os.path.join(output_dir, "enhanced_" + os.path.basename(image_path))
        cv2.imwrite(enhanced_path, cleaned)
        
        return enhanced_path
    
    except Exception as e:
        print(f"Advanced image enhancement failed: {e}, falling back to basic")
        return enhance_image_basic(image_path, output_dir)


def extract_text_with_ocr(image_path):
    """
    Extract text using Tesseract OCR as backup/validation
    Returns: extracted text string or None
    """
    if not TESSERACT_AVAILABLE:
        return None
    
    try:
        # Use Tesseract with custom config for tables
        # PSM 6 = assume uniform block of text
        # OEM 3 = default OCR Engine Mode (best for text)
        custom_config = r'--oem 3 --psm 6'
        img = Image.open(image_path)
        text = pytesseract.image_to_string(img, config=custom_config)
        return text.strip() if text else None
    except Exception as e:
        print(f"OCR extraction failed: {e}")
        return None


def assess_image_quality(image_path):
    """
    Assess image quality and return recommendation
    Returns: dict with quality metrics
    """
    try:
        img = Image.open(image_path)
        
        # Basic quality assessment using PIL only
        img_gray = img.convert('L')
        img_array = np.array(img_gray)
        
        # Calculate basic metrics
        brightness = float(np.mean(img_array))
        contrast = float(np.std(img_array))
        
        # Advanced metrics if CV2 available
        if CV2_AVAILABLE:
            try:
                # Sharpness using Laplacian variance
                laplacian = cv2.Laplacian(img_array, cv2.CV_64F)
                sharpness = float(laplacian.var())
            except:
                sharpness = 100.0  # Default if calculation fails
        else:
            # Estimate sharpness from contrast
            sharpness = contrast * 2.0
        
        # Determine quality level
        if sharpness < 50:
            quality_level = "POOR"
            needs_enhancement = True
        elif sharpness < 100:
            quality_level = "FAIR"
            needs_enhancement = True
        else:
            quality_level = "GOOD"
            needs_enhancement = False
        
        quality = {
            "sharpness": sharpness,
            "brightness": brightness,
            "contrast": contrast,
            "needs_enhancement": needs_enhancement,
            "quality_level": quality_level,
            "image_size": img.size
        }
        
        return quality
    
    except Exception as e:
        print(f"Quality assessment failed: {e}")
        # Return conservative defaults
        return {
            "sharpness": 50.0,
            "brightness": 128.0,
            "contrast": 30.0,
            "needs_enhancement": True,
            "quality_level": "UNKNOWN",
            "image_size": (0, 0)
        }


def process_image_for_extraction(image_path, output_dir="/tmp"):
    """
    Main entry point: assess quality, enhance if needed, extract OCR text
    
    Args:
        image_path: Path to input image file
        output_dir: Directory to save enhanced image (default: /tmp)
    
    Returns:
        tuple: (enhanced_image_path, ocr_text, quality_metrics)
    
    Example:
        enhanced_path, ocr_text, quality = process_image_for_extraction("scan.jpg")
        print(f"Quality: {quality['quality_level']}")
        # Use enhanced_path with Gemini Vision API
    """
    # Validate input
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image file not found: {image_path}")
    
    # Create output directory if needed
    os.makedirs(output_dir, exist_ok=True)
    
    # Step 1: Assess quality
    quality = assess_image_quality(image_path)
    print(f"Image quality assessment: {quality['quality_level']} (sharpness: {quality['sharpness']:.1f})")
    
    # Step 2: Enhance if needed
    if quality["needs_enhancement"]:
        if CV2_AVAILABLE:
            print("Applying advanced image enhancement (OpenCV)...")
            enhanced_path = enhance_image_advanced(image_path, output_dir)
        else:
            print("Applying basic image enhancement (PIL only)...")
            enhanced_path = enhance_image_basic(image_path, output_dir)
    else:
        print("Image quality acceptable, no enhancement needed")
        enhanced_path = image_path
    
    # Step 3: Extract OCR text for validation
    ocr_text = None
    if TESSERACT_AVAILABLE and quality["quality_level"] in ["POOR", "FAIR"]:
        print("Extracting OCR text for validation...")
        ocr_text = extract_text_with_ocr(enhanced_path)
        if ocr_text:
            print(f"OCR extracted {len(ocr_text)} characters")
    
    return enhanced_path, ocr_text, quality


# Utility function for testing
def test_preprocessing(image_path):
    """
    Test preprocessing on an image and display results
    """
    print(f"\n{'='*60}")
    print(f"Testing Image Preprocessing: {os.path.basename(image_path)}")
    print(f"{'='*60}\n")
    
    try:
        enhanced_path, ocr_text, quality = process_image_for_extraction(image_path)
        
        print(f"\n✅ Processing completed successfully!")
        print(f"\nQuality Metrics:")
        print(f"  - Level: {quality['quality_level']}")
        print(f"  - Sharpness: {quality['sharpness']:.2f}")
        print(f"  - Brightness: {quality['brightness']:.2f}")
        print(f"  - Contrast: {quality['contrast']:.2f}")
        print(f"  - Image Size: {quality['image_size']}")
        print(f"\nOutput:")
        print(f"  - Enhanced image: {enhanced_path}")
        if ocr_text:
            print(f"  - OCR text length: {len(ocr_text)} characters")
            print(f"\n  First 200 chars of OCR:")
            print(f"  {ocr_text[:200]}...")
        else:
            print(f"  - OCR: Not extracted (good quality or Tesseract unavailable)")
        
        return True
    
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False


if __name__ == "__main__":
    # Test mode - run from command line
    if len(sys.argv) > 1:
        test_image = sys.argv[1]
        test_preprocessing(test_image)
    else:
        print("Image Preprocessing Service")
        print("\nUsage:")
        print("  python image_preprocessing.py <image_path>")
        print("\nOr import in your code:")
        print("  from services.image_preprocessing import process_image_for_extraction")
        print("\nAvailable components:")
        print(f"  - OpenCV: {'✅ Available' if CV2_AVAILABLE else '❌ Not installed'}")
        print(f"  - Tesseract OCR: {'✅ Available' if TESSERACT_AVAILABLE else '❌ Not installed'}")
        print("\nRecommendation: Install both for best results")
        print("  pip install opencv-python-headless pytesseract")
