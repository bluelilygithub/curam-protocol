"""
Formatting utilities for text and currency display.
"""
import re


def format_currency(value):
    """
    Format a number as currency with dollar sign and commas.
    
    Args:
        value: Number or string to format as currency
        
    Returns:
        Formatted currency string (e.g., "$1,234.56") or empty string if invalid
    """
    if not value or value == "" or value == "N/A":
        return ""
    try:
        # Try to convert to float
        num_value = float(str(value))
        # Format with dollar sign, commas, and 2 decimal places
        return f"${num_value:,.2f}"
    except (ValueError, TypeError):
        # If conversion fails, return as is
        return str(value) if value else ""


def clean_text(text):
    """
    Clean and normalize text by removing excessive whitespace.
    
    Args:
        text: Input text string
        
    Returns:
        Cleaned text string
    """
    if not text:
        return ""
    
    # Remove excessive whitespace
    text = re.sub(r'\s+', ' ', text.strip())
    return text


def normalize_whitespace(text):
    """
    Normalize whitespace in text - replace multiple spaces with single space.
    
    Args:
        text: Input text string
        
    Returns:
        Text with normalized whitespace
    """
    if not text:
        return ""
    
    return re.sub(r' +', ' ', text.strip())


def format_text_to_html(text):
    """
    Convert plain text to HTML with paragraph breaks and basic formatting.
    Handles double newlines as paragraph breaks, single newlines as line breaks.
    Also handles sentences that end with periods followed by newlines as paragraph breaks.
    
    Args:
        text: Plain text string
        
    Returns:
        HTML formatted string with <p> tags
    """
    if not text:
        return ""
    
    # First, normalize whitespace - replace multiple spaces with single space
    text = re.sub(r' +', ' ', text.strip())
    
    # Split by double newlines (paragraphs)
    paragraphs = re.split(r'\n\s*\n', text)
    
    # If no double newlines, try to intelligently split into paragraphs
    # Look for sentence endings followed by capital letters (likely new paragraph)
    if len(paragraphs) == 1:
        # Pattern: sentence ending (. ! ?) followed by space and capital letter
        # This helps identify natural paragraph breaks
        parts = re.split(r'([.!?])\s+([A-Z][a-z])', text)
        
        if len(parts) > 3:  # If we found potential breaks
            # Reconstruct paragraphs intelligently
            paragraphs = []
            current_para = parts[0] if parts[0] else ""
            
            for i in range(1, len(parts), 3):
                if i + 1 < len(parts):
                    punctuation = parts[i] if i < len(parts) else ""
                    next_sentence = parts[i + 1] if i + 1 < len(parts) else ""
                    
                    # If current paragraph is substantial and next starts a new thought, break
                    if len(current_para.strip()) > 50 and next_sentence:
                        if current_para.strip():
                            paragraphs.append((current_para.strip() + punctuation).strip())
                        current_para = next_sentence
                    else:
                        current_para += punctuation + " " + next_sentence
                else:
                    current_para += parts[i] if i < len(parts) else ""
            
            if current_para.strip():
                paragraphs.append(current_para.strip())
        else:
            # Fallback: if text has single newlines, use those
            if '\n' in text:
                paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
    
    html_parts = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Replace single newlines with <br> within paragraphs (but preserve intentional breaks)
        para = para.replace('\n', '<br>')
        
        # Wrap in paragraph tag
        html_parts.append(f'<p>{para}</p>')
    
    return '\n'.join(html_parts)


def detect_low_confidence(text):
    """
    Detect low confidence text patterns that indicate OCR errors, garbled text, or incomplete extraction.
    
    Args:
        text: Text to analyze
        
    Returns:
        Confidence level: 'high', 'medium', or 'low'
    """
    if not text or text == "N/A":
        return 'high'  # N/A is expected, not an error
    
    text_str = str(text).strip()
    if len(text_str) < 3:
        return 'high'  # Short text is usually fine
    
    # Check for garbled text (excessive spaces between characters)
    # Pattern: "H H o o t l d d" - characters separated by spaces
    words = text_str.split()
    if len(words) > len(text_str) * 0.4:  # More than 40% of chars are word separators
        # Check if it looks like garbled OCR (many single-character "words")
        single_char_words = sum(1 for w in words if len(w) == 1)
        if single_char_words > len(words) * 0.3:  # More than 30% are single characters
            return 'low'
    
    # Check for incomplete text (starts with bracket but doesn't close, or truncated)
    if text_str.startswith('[') and not text_str.endswith(']'):
        # Check if it looks truncated (ends abruptly)
        if len(text_str) < 20 or text_str.endswith(' sta') or text_str.endswith(' sta '):
            return 'low'
    
    # Check for excessive mixed case inappropriately (OCR error pattern)
    # Pattern like "H H o o t l d d i 4 p O m g m"
    if len(text_str) > 10:
        alternating_case = sum(1 for i in range(len(text_str)-1) 
                              if text_str[i].isupper() != text_str[i+1].isupper())
        if alternating_case > len(text_str) * 0.6:  # More than 60% case changes
            return 'low'
    
    # Check for repeated characters with spaces (OCR splitting)
    # Pattern: "H H o o t l d d"
    if ' ' in text_str:
        chars_with_spaces = text_str.split()
        if len(chars_with_spaces) > 5:
            # Check if many are single characters
            single_chars = sum(1 for c in chars_with_spaces if len(c) == 1)
            if single_chars > len(chars_with_spaces) * 0.4:
                return 'low'
    
    # Check for incomplete words (common OCR truncation patterns)
    incomplete_patterns = [' sta ', ' sta', ' coffe', ' handwrit', ' delet']
    if any(pattern in text_str.lower() for pattern in incomplete_patterns):
        return 'low'
    
    return 'high'

