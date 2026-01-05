"""
Logistics department prompt - SIMPLIFIED VERSION
Returns plain array format that works with existing code (no gemini_service.py changes needed)
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
Extract data from this logistics document and return as a JSON array.

**DOCUMENT TYPE DETECTION:**

1. **FTA (Free Trade Agreement) Document** - Look for:
   - FTA names (CPTPP, USMCA, ChAFTA, AI-ECTA, RCEP, etc.)
   - Country of Origin fields
   - ABF (Australian Border Force) references
   - Tariff preference indicators

2. **Bill of Lading** - Look for:
   - Shipper, Consignee fields
   - Vessel name, Voyage number
   - Container numbers (format: ABCD1234567)
   - Port of Loading/Discharge
   - B/L Number

3. **Packing List** - Look for:
   - Carton numbers
   - Dimensions (L x W x H)
   - Package counts
   - "Packing List" header

**EXTRACTION RULES:**

For FTA Documents, extract these fields per item:
- "ShipmentRef": Shipment reference number
- "InvoiceNumber": Invoice number  
- "ItemDescription": Item/product description
- "CountryOfOrigin": Country (e.g., VIETNAM, CHINA, INDIA)
- "FTAAgreement": FTA name (e.g., CPTPP, ChAFTA, AI-ECTA)
- "TariffCode": HS/Tariff code (or "N/A")
- "Notes": Any verification notes (or "N/A")

For Bills of Lading, extract these fields per container:
- "BLNumber": Bill of Lading number
- "Shipper": Shipper company name
- "Consignee": Consignee company name
- "Vessel": Vessel name and voyage
- "ContainerNumber": Container number
- "SealNumber": Seal number (or "N/A")
- "Description": Cargo description
- "Weight": Gross weight with unit

For Packing Lists, extract these fields per carton:
- "CartonNumber": Carton/package number
- "PONumber": Purchase order number
- "ItemDescription": Contents description
- "Quantity": Quantity in carton
- "Dimensions": L x W x H (or "N/A")
- "Weight": Gross weight with unit

**OUTPUT FORMAT:**

Return a JSON array with one object per row/item:

[
  {{
    "ShipmentRef": "value",
    "InvoiceNumber": "value",
    "ItemDescription": "value",
    "CountryOfOrigin": "value",
    "FTAAgreement": "value",
    "TariffCode": "value",
    "Notes": "value"
  }},
  {{
    ...second item...
  }}
]

**CRITICAL REQUIREMENTS:**
- Return ONLY the JSON array
- Start with [ and end with ]
- One object per item/row/container/carton
- Use "N/A" for any missing fields
- NO outer wrapper object
- NO "document_type" field
- NO markdown code blocks (no ```json)
- NO explanations or extra text

If document has multiple items, create multiple objects in the array.

DOCUMENT TEXT:
{text}
"""