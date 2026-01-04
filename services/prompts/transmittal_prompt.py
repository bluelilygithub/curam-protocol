"""
Transmittal/drafting department prompt for drawing register extraction
Extracted from gemini_service.py for better maintainability
"""

def get_transmittal_prompt(text):
    """
    Generate the transmittal extraction prompt
    
    Args:
        text: Extracted text from PDF document
        
    Returns:
        Formatted prompt string for Gemini API
    """
    return f"""
    You are an advanced structural engineering document analyzer extracting comprehensive structured data from drawing PDFs.
    
    Extract data into these categories and return a JSON object with these keys:
    
    1. "DrawingRegister" - Basic drawing metadata (always extract):
       - "DwgNo": Drawing number (e.g., S-001, S-100, S-101)
       - "Rev": Revision (e.g., A, 0, C)
       - "Title": Drawing title (e.g., "GENERAL NOTES", "FOUNDATION PLAN")
       - "Scale": Scale (e.g., "1:100", "N.T.S")
    
    2. "Standards" - Array of standards referenced:
       - "Standard": Standard name (e.g., "AS 4100", "AS 3600", "AS/NZS 1170.1")
       - "Clause": Clause/section numbers (e.g., "Cl. 9.2, 13.4")
       - "Applicability": What it applies to (e.g., "Structural Steel Design")
    
    3. "Materials" - Array of material specifications:
       - "MaterialType": Type (e.g., "Concrete", "Steel Grade", "Bolts", "Grout")
       - "GradeSpec": Specification (e.g., "32 MPa", "300PLUS", "M24 Grade 8.8")
       - "Applications": Where used (e.g., "Slabs Zones A1/A2", "Columns C1-C2")
    
    4. "Connections" - Array of connection details:
       - "DetailMark": Connection mark (e.g., "CBP-01", "BCC-2", "BR-3")
       - "ConnectionType": Type description
       - "BoltSpec": Bolt specifications
       - "PlateSpec": Plate/member specifications
       - "WeldTorque": Weld or torque requirements
       - "DrawingRef": Reference to detail drawing
    
    5. "Assumptions" - Array of design assumptions:
       - "Assumption": What is assumed (e.g., "Foundation bearing capacity")
       - "Value": The value (e.g., "250 kPa minimum")
       - "Location": Where it applies (e.g., "All footings", "Zones B1/B2")
       - "Critical": Criticality level (e.g., "CRITICAL", "HIGH")
       - "VerificationMethod": How to verify
    
    6. "VOSFlags" - Array of "Verify on Site" items:
       - "FlagID": Identifier (e.g., "V.O.S.-01")
       - "Item": What needs verification
       - "Issue": The issue or requirement
       - "ActionRequired": What action is needed
       - "ResponsibleParty": Who is responsible
    
    7. "CrossReferences" - Array of cross-references:
       - "Reference": The reference text (e.g., "See Detail D1/S-500")
       - "ReferencedIn": Which drawing contains the reference
       - "RefersTo": What it refers to (e.g., "Detail D1 on S-500")
    
    EXTRACTION RULES:
    - Extract ALL standards mentioned (AS, AS/NZS, NCC codes)
    - Extract ALL material grades and specifications
    - Extract ALL connection detail marks and their specs
    - Extract ALL design assumptions, bearing capacities, slab thicknesses, grid spacing, FRL requirements
    - Extract ALL "V.O.S.", "Verify on Site", "Check", or similar flags
    - Extract ALL "See Detail", "Ref:", "Refer to" cross-references
    - For standards: Look in notes, specifications, detail callouts
    - For materials: Extract from schedules, notes, detail specifications
    - For connections: Extract from detail marks, connection tables, specifications
    - For assumptions: Extract from notes, plan annotations, general notes
    - For VOS: Look for explicit "V.O.S.", "Verify", "Check on site" text
    - For cross-refs: Extract all "See Detail X", "Ref: Detail Y", "Refer to Z" mentions
    
    Return a JSON object with all 7 keys. Use empty arrays [] if a category has no data.
    Return ONLY valid JSON (no markdown, no explanation, no code blocks).

    TEXT: {text}
    """