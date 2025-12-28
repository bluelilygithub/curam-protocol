"""
Gemini AI Service - AI document analysis

Phase 3.3a: Starting with get_available_models() only
This is a safe, incremental extraction approach.

Functions in this file (Phase 3.3a):
- get_available_models(): Get list of available Gemini models

Functions to be added later:
- build_prompt() - Phase 3.3b (Week 2)
- analyze_gemini() - Phase 3.3c (Week 3)

Usage:
    from services.gemini_service import get_available_models
    
    models = get_available_models()

Created: Phase 3.3a - Gemini Service Extraction (Incremental)
Lines: ~80 (just one function + setup)
"""

import os
import google.generativeai as genai

# Configure Gemini API
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Global cache for available models
_available_models = None


def get_available_models():
    """Get list of available Gemini models"""
    global _available_models
    if _available_models is not None:
        return _available_models
    
    if not api_key:
        return []
    
    _available_models = []
    try:
        models = genai.list_models()
        models_list = list(models)  # Convert to list once
        print(f"Found {len(models_list)} total models")
        
        # Extract model names, removing 'models/' prefix
        for m in models_list:
            try:
                model_name = m.name
                if model_name.startswith('models/'):
                    model_name = model_name.replace('models/', '')
                
                # Check if model supports generateContent
                supported_methods = getattr(m, 'supported_generation_methods', [])
                if hasattr(supported_methods, '__iter__'):
                    methods = list(supported_methods)
                else:
                    methods = [str(supported_methods)] if supported_methods else []
                
                if 'generateContent' in methods or len(methods) == 0:
                    _available_models.append(model_name)
                    print(f"  - {model_name} (methods: {methods})")
            except Exception as e:
                print(f"Error processing model {m}: {e}")
                continue
        
        print(f"Available models for generateContent: {_available_models}")
        return _available_models if _available_models else None
    except Exception as e:
        print(f"Error listing models: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        # Return None to use fallback
        return None