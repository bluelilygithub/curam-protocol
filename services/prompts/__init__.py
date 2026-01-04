"""
Prompts package for Curam-AI document extraction
Each department has its own prompt file for better maintainability
"""

from .finance_prompt import get_finance_prompt

__all__ = ['get_finance_prompt']