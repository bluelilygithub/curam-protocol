"""
Logistics department prompt for Bill of Lading extraction
Extracted from gemini_service.py for better maintainability
"""

def get_logistics_prompt(text):
    """
    Generate the logistics extraction prompt
    
    Args:
        text: Extracted text from PDF document
        
    Returns:
        Formatted prompt string for Gemini API
    """
    return f"""
Extract data from this Bill of Lading / shipping document and return structured data.

Extract multiple rows if the document contains multiple containers or shipment lines.

Return ONLY valid JSON in this exact format:
{{
  "rows": [
    {{
      "Shipper": "Shipper company name",
      "Consignee": "Consignee company name",
      "BLNumber": "Bill of Lading number",
      "Vessel": "Vessel name and voyage number",
      "ContainerNumber": "Container number (e.g., MSKU9922334)",
      "SealNumber": "Seal number",
      "Description": "Cargo description",
      "Quantity": "Number of packages/units",
      "Weight": "Gross weight with unit (e.g., 24,500 KG)"
    }}
  ]
}}

EXTRACTION RULES:
- Extract one row per container or shipment line
- If document has multiple containers, create multiple rows
- Use "N/A" for any missing fields
- Preserve exact formatting of B/L numbers, container numbers, and seal numbers
- Include units with weight (KG, LBS, MT, etc.)

Return ONLY the JSON, no markdown, no explanation, no code blocks.

DOCUMENT TEXT:
{text}
"""