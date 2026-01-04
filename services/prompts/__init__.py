"""
Prompts package for Curam-AI document extraction
Each department has its own prompt file for better maintainability
"""

from .finance_prompt import get_finance_prompt
from .engineering_prompt import get_engineering_prompt

__all__ = ['get_finance_prompt', 'get_engineering_prompt']