"""
Industry-specific AI automation opportunities configuration.
"""

AI_OPPORTUNITIES = {
    "Architecture & Building Services": [
        {"task": "Drawing Register Compilation", "potential": "HIGH", "hours_per_week": 6, "description": "Automated extraction from title blocks"},
        {"task": "Specification Writing", "potential": "HIGH", "hours_per_week": 8, "description": "AI-assisted spec generation from templates"},
        {"task": "Door/Window Schedules", "potential": "MEDIUM", "hours_per_week": 4, "description": "Schedule generation from BIM data"},
        {"task": "Energy Modelling Data Entry", "potential": "MEDIUM", "hours_per_week": 3, "description": "Automated data transfer to modelling software"},
        {"task": "Meeting Minutes & Action Items", "potential": "LOW", "hours_per_week": 2, "description": "AI transcription and summarization"}
    ],
    "Civil & Surveying": [
        {"task": "Bore-hole Log Compilation", "potential": "HIGH", "hours_per_week": 7, "description": "Automated extraction from field notes"},
        {"task": "Lab Report Data Transfer", "potential": "HIGH", "hours_per_week": 6, "description": "PDF to database automation"},
        {"task": "Site Survey Data Processing", "potential": "MEDIUM", "hours_per_week": 5, "description": "Drone/photogrammetry data integration"},
        {"task": "Client Report Assembly", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated report generation"},
        {"task": "Compliance Documentation", "potential": "LOW", "hours_per_week": 2, "description": "Template-based compliance forms"}
    ],
    "Manufacturing (Design-to-Order)": [
        {"task": "RFQ Data Extraction", "potential": "HIGH", "hours_per_week": 8, "description": "PDF RFQ to ERP automation"},
        {"task": "Quote Generation", "potential": "HIGH", "hours_per_week": 6, "description": "Automated pricing calculations"},
        {"task": "BOM Compilation", "potential": "MEDIUM", "hours_per_week": 5, "description": "Material list generation"},
        {"task": "Nesting Optimization", "potential": "MEDIUM", "hours_per_week": 4, "description": "AI-assisted material layout"},
        {"task": "Order Processing", "potential": "LOW", "hours_per_week": 3, "description": "Order entry automation"}
    ],
    "Environmental Consulting": [
        {"task": "ESG Table Updates", "potential": "HIGH", "hours_per_week": 7, "description": "Automated data pipeline from sources"},
        {"task": "Compliance Report Generation", "potential": "HIGH", "hours_per_week": 6, "description": "Template-based report automation"},
        {"task": "Air Quality Data Processing", "potential": "MEDIUM", "hours_per_week": 4, "description": "Sensor data to reports"},
        {"task": "Quarterly Monitoring Reports", "potential": "MEDIUM", "hours_per_week": 3, "description": "Recurring report automation"},
        {"task": "Data Verification", "potential": "LOW", "hours_per_week": 2, "description": "Cross-table accuracy checks"}
    ],
    "Accounting & Advisory": [
        {"task": "Trust Account Reconciliations", "potential": "HIGH", "hours_per_week": 8, "description": "Automated transaction matching and exception flagging"},
        {"task": "Inter-Entity Reconciliations", "potential": "HIGH", "hours_per_week": 7, "description": "Cross-entity loan accounts and management fee matching"},
        {"task": "Complex Invoice GL Coding", "potential": "HIGH", "hours_per_week": 6, "description": "Multi-line invoice splitting across cost centers"},
        {"task": "Three-Way Match (PO/Docket/Invoice)", "potential": "MEDIUM", "hours_per_week": 5, "description": "Automated variance detection and approval routing"},
        {"task": "Fraud Detection (Bank Details)", "potential": "MEDIUM", "hours_per_week": 3, "description": "BSB/account verification against master records"},
        {"task": "Bank Reconciliation", "potential": "LOW", "hours_per_week": 2, "description": "Automated bank statement matching"}
    ],
    "Legal Services": [
        {"task": "Contract Review & Term Extraction", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction of key terms, dates, parties, and obligations from contracts"},
        {"task": "Matter Intake Automation", "potential": "HIGH", "hours_per_week": 7, "description": "Extract client data from intake forms and ID documents, auto-create matter files"},
        {"task": "Legal Research Indexing", "potential": "MEDIUM", "hours_per_week": 5, "description": "AI-powered search across past matters and research memos"},
        {"task": "Time Entry Automation", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated time sheet entry from calendar and email data"},
        {"task": "Document Discovery", "potential": "LOW", "hours_per_week": 3, "description": "Indexing and searching large document sets for discovery"}
    ],
    "Construction": [
        {"task": "Tender Specification Extraction", "potential": "HIGH", "hours_per_week": 10, "description": "Automated extraction from 500-page tender packs with compliance validation"},
        {"task": "Site Diary Digitization", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction from handwritten site logs with WHS compliance tracking"},
        {"task": "Subcontractor Compliance Tracking", "potential": "HIGH", "hours_per_week": 6, "description": "Automated certificate monitoring with expiry alerts"},
        {"task": "SWMS Processing", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated safety method statement extraction and validation"},
        {"task": "Project Documentation Assembly", "potential": "MEDIUM", "hours_per_week": 3, "description": "Automated compilation of project reports and submissions"}
    ],
    "Mining Services": [
        {"task": "Safety Incident Reporting", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction from incident forms with regulatory classification"},
        {"task": "Shift Handover Log Processing", "potential": "HIGH", "hours_per_week": 7, "description": "Automated extraction from handwritten shift logs with continuity tracking"},
        {"task": "Equipment Maintenance Tracking", "potential": "HIGH", "hours_per_week": 6, "description": "Automated compliance monitoring with expiry alerts"},
        {"task": "Environmental Compliance Documentation", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated extraction from environmental monitoring reports"},
        {"task": "Regulatory Report Generation", "potential": "MEDIUM", "hours_per_week": 3, "description": "Template-based compliance report automation"}
    ],
    "Property Management": [
        {"task": "Lease Document Extraction", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction from lease agreements with key date tracking"},
        {"task": "Maintenance Order Matching", "potential": "HIGH", "hours_per_week": 7, "description": "Automated matching of maintenance requests with invoices and approvals"},
        {"task": "Compliance Certificate Tracking", "potential": "HIGH", "hours_per_week": 6, "description": "Automated monitoring with expiry alerts"},
        {"task": "Tenant Application Processing", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated extraction from tenant application forms"},
        {"task": "Property Condition Reports", "potential": "MEDIUM", "hours_per_week": 3, "description": "Automated compilation of condition report data"}
    ],
    "Logistics & Freight": [
        {"task": "BOL Processing", "potential": "HIGH", "hours_per_week": 10, "description": "Automated extraction from bills of lading with accuracy validation"},
        {"task": "Customs Documentation", "potential": "HIGH", "hours_per_week": 9, "description": "Automated customs entry creation with compliance checking"},
        {"task": "POD Matching", "potential": "HIGH", "hours_per_week": 7, "description": "Automated proof of delivery matching with invoice reconciliation"},
        {"task": "Freight Manifest Processing", "potential": "MEDIUM", "hours_per_week": 5, "description": "Automated extraction from freight manifests"},
        {"task": "Compliance Certificate Tracking", "potential": "MEDIUM", "hours_per_week": 3, "description": "Automated monitoring of transport licenses and insurance"}
    ],
    "Healthcare Admin": [
        {"task": "Patient Intake Processing", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction from patient intake forms and ID documents"},
        {"task": "Referral Triage Automation", "potential": "HIGH", "hours_per_week": 7, "description": "Automated extraction from referral letters with priority classification"},
        {"task": "Medicare/Private Claiming", "potential": "HIGH", "hours_per_week": 6, "description": "Automated claim form generation from consultation notes"},
        {"task": "Compliance Documentation", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated extraction from compliance certificates and audits"},
        {"task": "Medical Record Indexing", "potential": "MEDIUM", "hours_per_week": 3, "description": "Automated indexing and search across patient records"}
    ],
    "Government Contractors": [
        {"task": "Grant Acquittal Processing", "potential": "HIGH", "hours_per_week": 9, "description": "Automated extraction from grant reports with compliance validation"},
        {"task": "Tender Compliance Documentation", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction from tender responses with requirement matching"},
        {"task": "NDIS Audit Trail Generation", "potential": "HIGH", "hours_per_week": 7, "description": "Automated compilation of service delivery evidence with compliance tracking"},
        {"task": "Contract Compliance Monitoring", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated tracking of contract milestones and deliverables"},
        {"task": "Regulatory Report Generation", "potential": "MEDIUM", "hours_per_week": 3, "description": "Template-based compliance report automation"}
    ],
    "Wealth Management": [
        {"task": "Client Statement Processing", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction from client statements with transaction matching"},
        {"task": "SOA Generation", "potential": "HIGH", "hours_per_week": 7, "description": "Automated compilation of Statement of Advice from client data"},
        {"task": "Performance Attribution & Reporting", "potential": "HIGH", "hours_per_week": 6, "description": "Automated calculation and compilation of performance reports"},
        {"task": "Compliance Documentation", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated extraction from compliance certificates and audits"},
        {"task": "Client Onboarding Processing", "potential": "MEDIUM", "hours_per_week": 3, "description": "Automated extraction from client onboarding forms and ID documents"}
    ],
    "Insurance Underwriting": [
        {"task": "Application Data Extraction", "potential": "HIGH", "hours_per_week": 8, "description": "Automated extraction from policy applications with accuracy validation"},
        {"task": "Risk Scoring Automation", "potential": "HIGH", "hours_per_week": 7, "description": "Automated risk assessment from application data"},
        {"task": "Claims Documentation Intelligence", "potential": "HIGH", "hours_per_week": 6, "description": "Automated extraction and analysis from claims documentation"},
        {"task": "Compliance Documentation", "potential": "MEDIUM", "hours_per_week": 4, "description": "Automated extraction from compliance certificates and audits"},
        {"task": "Policy Renewal Processing", "potential": "MEDIUM", "hours_per_week": 3, "description": "Automated extraction from renewal forms and client correspondence"}
    ]
}

