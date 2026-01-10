"""
Logistics department prompt for trade document extraction
Follows engineering_prompt.py coding techniques for consistency
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
# UNIVERSAL EXTRACTION PROMPT - LOGISTICS/TRADE DOCUMENTS

Your primary goal: Accurate extraction with explicit field naming. Consistency is critical for downstream processing.

## DOCUMENT CHARACTERISTICS

You will encounter:

- Trade documents: FTA lists, Bills of Lading, Packing Lists, Customs declarations
- Tabular data: Multiple rows/items with consistent column structure
- Mixed formats: Typed text, stamps, handwritten annotations
- International standards: Country codes, FTA agreements, HS codes, Incoterms
- Multiple items: One document may contain 3-50 line items

## CORE PRINCIPLES - ALWAYS FOLLOW

**Principle 1: Exact Field Names**
Use ONLY the field names specified in this prompt. Do not substitute synonyms or abbreviations.

**Principle 2: Flat Structure, Not Nested**
Each item/row is a separate JSON object. No nesting under "items" or "products".

**Principle 3: Preserve As Written**
Extract country codes, FTA names, reference numbers exactly as they appear.

**Principle 4: Use N/A for Missing Data**
If a field is not present in the document, use "N/A". Never invent data.

## DOCUMENT TYPE DETECTION

First, identify the document type:

**FTA (FREE TRADE AGREEMENT) LIST:**
- Contains: FTA agreement names (CPTPP, USMCA, ChAFTA, AI-ECTA, RCEP, AANZFTA)
- Contains: Country of origin fields
- Contains: ABF (Australian Border Force) references or duty concession language
- Set: document_type = "fta_list"

**BILL OF LADING:**
- Contains: Shipper/Consignee fields
- Contains: Vessel name, Voyage number
- Contains: Container numbers (format: ABCD1234567)
- Contains: Port of Loading/Discharge
- Set: document_type = "bill_of_lading"

**PACKING LIST:**
- Contains: Carton/box numbers
- Contains: Dimensions (L x W x H format)
- Contains: Package counts per line
- Header says: "Packing List"
- Set: document_type = "packing_list"

**CUSTOMS DECLARATION:**
- Contains: Entry number, Declaration number
- Contains: Duty amounts, Tax calculations
- Contains: Importer/Exporter of record
- Set: document_type = "customs_declaration"

## FIELD DEFINITIONS

### FOR FTA LISTS (document_type: "fta_list")

Extract these fields for EACH item/row:

- **ShipmentRef**: Shipment reference number (or "N/A" if not present)
- **InvoiceNumber**: Invoice number (or "N/A" if not present)
- **ItemDescription**: Full item/product description as written
- **CountryOfOrigin**: Country code (VIETNAM, CHINA, INDIA, etc.) - uppercase
- **FTAAgreement**: FTA agreement name (CPTPP, ChAFTA, AI-ECTA, RCEP, USMCA, AANZFTA, etc.)
- **TariffCode**: HS/Tariff classification code (or "N/A")
- **Notes**: Any verification notes, ABF references, or special conditions (or "N/A")

### FOR BILLS OF LADING (document_type: "bill_of_lading")

Extract these fields for EACH container/shipment:

- **BLNumber**: Bill of Lading number
- **Shipper**: Shipper company name
- **Consignee**: Consignee company name
- **Vessel**: Vessel name and voyage number
- **ContainerNumber**: Container number (e.g., MSKU1234567)
- **PortOfLoading**: Port of loading with code
- **PortOfDischarge**: Port of discharge with code
- **CargoDescription**: Description of goods
- **GrossWeight**: Weight with unit (e.g., "24,500 KG")
- **PackageCount**: Number of packages

### FOR PACKING LISTS (document_type: "packing_list")

Extract these fields for EACH carton/package:

- **CartonNumber**: Carton/box number
- **PONumber**: Purchase order reference
- **ItemDescription**: Contents description
- **Quantity**: Quantity in this carton
- **Dimensions**: L x W x H (or "N/A")
- **GrossWeight**: Gross weight with unit
- **NetWeight**: Net weight (or "N/A")
- **Volume**: Volume in CBM or CFT (or "N/A")

## EXTRACTION PROTOCOL

**Step 1: Identify Document Type**
- Examine headers, field names, and content patterns
- Set document_type field accordingly

**Step 2: Locate Table/List Structure**
- Identify column headers
- Count total number of rows/items
- Note any multi-page continuation

**Step 3: Extract Each Row**
For each item/row in the document:
- Create ONE object in the rows array
- Use EXACT field names from the field definitions above
- Extract data as written
- Use "N/A" for missing fields
- Preserve formatting of reference numbers, codes

**Step 4: Validation**
- Verify each row has all required fields
- Check field names match specifications exactly
- Confirm no nested structures (no "items" arrays)
- Ensure consistent data types

## COMMON PATTERNS AND CORRECTIONS

**FTA Agreement Names:**
- Standard names: CPTPP, USMCA, ChAFTA, AI-ECTA, RCEP, AANZFTA, SAFTA
- Extract exactly as shown in document
- Do NOT abbreviate (e.g., don't change "CPTPP" to "TPP")

**Country Codes:**
- Use full name in uppercase: VIETNAM (not VN), CHINA (not CN), INDIA (not IN)
- Extract as written in origin column

**Reference Numbers:**
- Preserve exact formatting: GRA-2025-09, INV-8899
- Don't remove dashes or modify format

**Multiple Items:**
- If document has 5 items, return 5 objects in rows array
- Each item is a separate object
- Do NOT group under "items" key

## OUTPUT FORMAT

Return data in this structure:

{{
  "document_type": "fta_list",
  "rows": [
    {{
      "ShipmentRef": "GRA-2025-09",
      "InvoiceNumber": "INV-8899",
      "ItemDescription": "Cotton T-Shirts",
      "CountryOfOrigin": "VIETNAM",
      "FTAAgreement": "CPTPP",
      "TariffCode": "N/A",
      "Notes": "Verified for ABF Duty Concessions"
    }},
    {{
      "ShipmentRef": "GRA-2025-09",
      "InvoiceNumber": "INV-8899",
      "ItemDescription": "Denim Jeans",
      "CountryOfOrigin": "INDIA",
      "FTAAgreement": "AI-ECTA",
      "TariffCode": "N/A",
      "Notes": "N/A"
    }}
  ]
}}

**CRITICAL:**
- Top level must have: document_type and rows
- rows is an array of objects
- Each object represents one item/row
- Use EXACT field names shown above
- No nested "items" arrays

## INCORRECT EXAMPLES - DO NOT DO THIS

**WRONG - Using different field names:**
{{
  "shipment_id": "GRA-2025-09",
  "description": "Cotton T-Shirts"
}}
↑ Wrong field names (shipment_id, description)

**WRONG - Nested structure:**
{{
  "shipment_id": "GRA-2025-09",
  "items": [
    {{"description": "Cotton T-Shirts"}}
  ]
}}
↑ Items should not be nested

**WRONG - Missing document_type:**
{{
  "rows": [...]
}}
↑ Must include document_type

**CORRECT EXAMPLE:**
{{
  "document_type": "fta_list",
  "rows": [
    {{
      "ShipmentRef": "GRA-2025-09",
      "InvoiceNumber": "INV-8899",
      "ItemDescription": "Cotton T-Shirts",
      "CountryOfOrigin": "VIETNAM",
      "FTAAgreement": "CPTPP",
      "TariffCode": "N/A",
      "Notes": "N/A"
    }}
  ]
}}

## CRITICAL REMINDERS

✓ Use document_type and rows at top level
✓ One object per item in rows array
✓ Exact field names: ShipmentRef, InvoiceNumber, ItemDescription, CountryOfOrigin, FTAAgreement, TariffCode, Notes
✓ Never use: shipment_id, invoice_id, description, origin, fta, items
✓ "N/A" for missing data
✓ No nested structures

Begin extraction. For each row/item, apply field naming rules and output in the specified JSON format.

Return ONLY a valid JSON object with document_type and rows (no markdown, no explanation, no code blocks).

TEXT: {text}
    """