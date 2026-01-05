"""
Logistics department prompt for multiple document types
Handles: Bills of Lading, FTA Lists, Customs Declarations, Packing Lists, etc.
"""

def get_logistics_prompt(text):
    """
    Generate the universal logistics extraction prompt
    
    Args:
        text: Extracted text from PDF document
        
    Returns:
        Formatted prompt string for Gemini API
    """
    return f"""
You are a logistics document analyzer. Extract structured data from trade and shipping documents.

## STEP 1: DOCUMENT TYPE DETECTION

Identify the document type by examining headers, field names, and content:

**BILL OF LADING (B/L)** - Contains:
- Shipper, Consignee, Notify Party
- Vessel name, Voyage number
- Container numbers (e.g., MSKU1234567)
- Port of Loading/Discharge
- B/L Number

**FTA (FREE TRADE AGREEMENT) LIST** - Contains:
- FTA agreement names (CPTPP, USMCA, RCEP, ChAFTA, AI-ECTA, etc.)
- Country of origin
- Tariff preference indicators
- ABF/Duty concession references
- Item descriptions with origin countries

**CUSTOMS DECLARATION** - Contains:
- Customs entry number
- HS/Tariff codes
- Duty amounts
- Importer/Exporter of record
- Customs value declarations

**PACKING LIST** - Contains:
- Carton/package counts
- Dimensions (L x W x H)
- Individual package weights
- PO numbers per carton
- "Packing List" header

**COMMERCIAL INVOICE** - Contains:
- Invoice number
- Incoterms (FOB, CIF, EXW, etc.)
- Line items with unit prices
- Payment terms
- "Commercial Invoice" header

## STEP 2: EXTRACT DATA BASED ON TYPE

### FOR BILL OF LADING:
Return this exact JSON structure:
{{
  "document_type": "bill_of_lading",
  "rows": [
    {{
      "BLNumber": "Bill of Lading number",
      "Shipper": "Shipper company name",
      "Consignee": "Consignee company name",
      "NotifyParty": "Notify party (or N/A)",
      "Vessel": "Vessel name and voyage",
      "PortOfLoading": "Port of loading with code",
      "PortOfDischarge": "Port of discharge with code",
      "ContainerNumber": "Container number",
      "SealNumber": "Seal number (or N/A)",
      "PackageCount": "Number of packages",
      "GrossWeight": "Weight with unit",
      "Description": "Cargo description"
    }}
  ]
}}

### FOR FTA LIST:
Return this exact JSON structure:
{{
  "document_type": "fta_list",
  "rows": [
    {{
      "ShipmentRef": "Shipment reference number",
      "InvoiceNumber": "Invoice number",
      "ItemDescription": "Item/product description",
      "CountryOfOrigin": "Country code (e.g., VIETNAM, CHINA, INDIA)",
      "FTAAgreement": "FTA name (e.g., CPTPP, ChAFTA, AI-ECTA)",
      "TariffCode": "HS/Tariff code (or N/A)",
      "DutyConcession": "Duty concession status (or N/A)",
      "ABFReference": "ABF reference if mentioned (or N/A)",
      "Notes": "Any verification or special notes"
    }}
  ]
}}

### FOR CUSTOMS DECLARATION:
Return this exact JSON structure:
{{
  "document_type": "customs_declaration",
  "rows": [
    {{
      "EntryNumber": "Customs entry number",
      "ImporterName": "Importer of record",
      "ExporterName": "Exporter name",
      "ItemDescription": "Description of goods",
      "TariffCode": "HS/Tariff classification",
      "OriginCountry": "Country of origin",
      "CustomsValue": "Declared value",
      "Currency": "Currency code",
      "DutyAmount": "Duty/tax amount (or N/A)",
      "EntryDate": "Entry date (or N/A)"
    }}
  ]
}}

### FOR PACKING LIST:
Return this exact JSON structure:
{{
  "document_type": "packing_list",
  "rows": [
    {{
      "CartonNumber": "Carton/package number",
      "PONumber": "Purchase order number",
      "ItemDescription": "Contents description",
      "Quantity": "Quantity in carton",
      "Dimensions": "L x W x H (or N/A)",
      "GrossWeight": "Gross weight with unit",
      "NetWeight": "Net weight with unit (or N/A)",
      "Volume": "Volume (CBM or CFT, or N/A)"
    }}
  ]
}}

### FOR COMMERCIAL INVOICE (Logistics Context):
Return this exact JSON structure:
{{
  "document_type": "commercial_invoice",
  "rows": [
    {{
      "InvoiceNumber": "Invoice number",
      "PONumber": "PO reference",
      "ItemDescription": "Item description",
      "HSCode": "HS/Tariff code",
      "OriginCountry": "Country of origin",
      "Quantity": "Quantity",
      "UnitPrice": "Unit price",
      "TotalValue": "Line total",
      "Incoterms": "Incoterms (FOB, CIF, etc.)",
      "ShippingMarks": "Shipping marks (or N/A)"
    }}
  ]
}}

## STEP 3: EXTRACTION RULES

**Multi-Row Documents:**
- If document contains multiple containers → Multiple rows in B/L
- If document contains multiple items → Multiple rows in FTA
- If document contains multiple entries → Multiple rows in Customs
- If document contains multiple cartons → Multiple rows in Packing List

**Missing Data:**
- Use "N/A" for any field not present in document
- Don't invent or guess data
- Extract exactly as written

**Special Handling:**
- **FTA Agreements:** Extract exact names (CPTPP, USMCA, RCEP, ChAFTA, AANZFTA, AI-ECTA, etc.)
- **Container Numbers:** Preserve format (e.g., TCLU1234567, MSKU9988776)
- **HS Codes:** Preserve dots and formatting (e.g., 6204.62.00)
- **Weights:** Include units (KG, LBS, MT, etc.)
- **Dates:** Format as YYYY-MM-DD if possible

**Document Type Detection Priority:**
1. Check for explicit headers ("Bill of Lading", "FTA List", etc.)
2. Look for signature field combinations
3. Analyze content patterns
4. Default to most appropriate type based on fields present

## STEP 4: VALIDATION

Before returning:
- ✓ Verify `document_type` is set correctly
- ✓ Verify `rows` array exists and contains data
- ✓ Check all required fields for detected type are present
- ✓ Confirm no fields from wrong document type are included

## OUTPUT FORMAT

Return ONLY valid JSON with this structure:
{{
  "document_type": "bill_of_lading|fta_list|customs_declaration|packing_list|commercial_invoice",
  "rows": [ /* array of row objects matching the document type */ ]
}}

**CRITICAL:**
- Return ONLY the JSON object
- NO markdown code blocks (no ```json)
- NO explanations or commentary
- NO additional text before or after JSON
- Structure must match EXACTLY one of the formats above

DOCUMENT TEXT:
{text}
"""