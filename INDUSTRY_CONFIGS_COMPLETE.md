# Industry Configurations - Complete Reference

**Date:** December 22, 2024  
**Purpose:** Copy-paste ready industry configurations with multipliers

---

## Overview

This document contains complete industry configurations for all 14 industries. Each configuration includes:
- Pain point options with multipliers
- Automation notes for each option
- Ready to copy-paste into `roi_calculator_flask.py`

**Note:** The multiplier system is already implemented in `calculate_metrics()`. These configs add explicit `multiplier` and `automation_note` fields for better UI display (optional enhancement).

---

## How to Use

1. Find your industry below
2. Copy the entire configuration block
3. Replace the existing industry config in `roi_calculator_flask.py`
4. The `pain_point_options` array includes multiplier and automation_note fields

---

## Architecture & Building Services

```python
"Architecture & Building Services": {
    "context": "Architecture and engineering firms (15-100 staff)",
    "pain_point_question": "What's your biggest documentation bottleneck?",
    "pain_point_options": [
        {
            "value": 0,
            "label": "Drawing Registers (Automated BIM export)",
            "description": "Low pain - mostly automated",
            "multiplier": 0.85,
            "automation_note": "Lower automation potential - process already optimized"
        },
        {
            "value": 5,
            "label": "Drawing Registers (Export to Excel, manual formatting)",
            "description": "Medium pain - significant manual cleanup",
            "multiplier": 1.00,
            "automation_note": "Moderate automation potential - good ROI opportunity"
        },
        {
            "value": 7,
            "label": "Specification Writing (Copy-paste from Masterspec/Natspec)",
            "description": "Medium-high pain - repetitive but requires judgment",
            "multiplier": 1.15,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 10,
            "label": "Document Transmittals (Manual creation and tracking)",
            "description": "High pain - fully manual, time-consuming",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total firm-wide hours per week on manual documentation (all staff combined)",
    "weekly_hours_range": [10, 200, 80],
    "weekly_hours_help_text": "Example: 25 staff × 4 hours each = 100 hours/week",
    "demo_documents": "drawing registers, BIM schedules, or document transmittals",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest documentation bottleneck?",
    "q1_options": {
        "Drawing Registers (Automated BIM export)": 0,
        "Drawing Registers (Export to Excel, manual formatting)": 5,
        "Specification Writing (Copy-paste from Masterspec/Natspec)": 7,
        "Document Transmittals (Manual creation and tracking)": 10
    },
    "q2_label": "Total firm-wide hours per week on manual documentation (all staff combined)",
    "q2_type": "slider",
    "q2_range": (10, 200)
}
```

---

## Civil & Surveying

```python
"Civil & Surveying": {
    "context": "Bore-hole logs, Lab reports, Drone photogrammetry",
    "q1_label": "How are bore-hole logs and lab results transferred to client reports?",
    "q1_options": {
        "API / Database link (Low pain)": 0,
        "Copy-pasting from PDF/CSV to Excel (Medium pain)": 5,
        "Manual re-typing from field notes (High pain)": 10
    },
    "q2_label": "Hours per week, per surveyor, spent compiling site data into final reports?",
    "q2_type": "slider",
    "q2_range": (0, 20),
    "automation_potential": 0.40
}
```

---

## Manufacturing (Design-to-Order)

```python
"Manufacturing (Design-to-Order)": {
    "context": "RFQs, Quoting, Nesting, BOMs",
    "q1_label": "What is your current process for incoming PDF RFQs?",
    "q1_options": {
        "Optical Character Recognition (OCR) software (Low pain)": 0,
        "Estimator measures & types into ERP (High pain)": 10
    },
    "q2_label": "Average time to generate a full quote for a complex order?",
    "q2_type": "dropdown",
    "q2_options": {
        "< 1 Hour": 1,
        "2-4 Hours": 3,
        "1+ Days": 8
    },
    "automation_potential": 0.40
}
```

---

## Environmental Consulting

```python
"Environmental Consulting": {
    "context": "ESG Tables, Air Quality Reports, Compliance",
    "q1_label": "How do you update recurring compliance reports (e.g., ISO tables, quarterly monitoring)?",
    "q1_options": {
        "Automated data pipeline (Low pain)": 0,
        "Rolling forward last year's Word Doc & finding/replacing numbers (High pain)": 10
    },
    "q2_label": "Hours per week spent verifying data accuracy across tables?",
    "q2_type": "slider",
    "q2_range": (0, 20),
    "automation_potential": 0.40
}
```

---

## Accounting & Advisory

```python
"Accounting & Advisory": {
    "context": "Australian accounting firms (15-100 staff)",
    "pain_point_question": "What's your biggest manual processing pain point?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Invoice Data Entry (Typing vendor invoices into Xero/MYOB)",
            "description": "Low-medium pain - repetitive but straightforward",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Complex GL Coding (Multi-line invoices requiring judgment)",
            "description": "Medium pain - requires accounting knowledge",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Trust Account Reconciliations (Matching deposits to matter files)",
            "description": "Medium-high pain - high-stakes, time-consuming",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Inter-Entity Transaction Matching (Consolidation reconciliations)",
            "description": "High pain - complex, error-prone, senior staff time",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total firm-wide hours per week on manual processing (all staff combined)",
    "weekly_hours_range": [10, 200, 60],
    "weekly_hours_help_text": "Example: 15 staff × 4 hours each = 60 hours/week. Include: data entry, reconciliations, GL coding, trust account matching.",
    "demo_documents": "invoices, bank statements, trust account transactions, or inter-entity reconciliations",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest manual processing pain point?",
    "q1_options": {
        "Invoice Data Entry (Typing vendor invoices into Xero/MYOB)": 3,
        "Complex GL Coding (Multi-line invoices requiring judgment)": 6,
        "Trust Account Reconciliations (Matching deposits to matter files)": 8,
        "Inter-Entity Transaction Matching (Consolidation reconciliations)": 10
    },
    "q2_label": "Total firm-wide hours per week on manual processing (all staff combined)",
    "q2_type": "slider",
    "q2_range": (10, 200)
}
```

---

## Legal Services

```python
"Legal Services": {
    "context": "Legal practices and law firms (10-100 staff)",
    "pain_point_question": "What's your biggest administrative bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Time Entry & Billing (Manual time sheet entry)",
            "description": "Low-medium pain - tedious but straightforward",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Matter File Management (Creating and organizing client files)",
            "description": "Medium pain - time-consuming setup",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Contract Review (Reading and extracting key terms)",
            "description": "Medium-high pain - requires legal judgment",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Document Discovery (Searching and indexing large document sets)",
            "description": "High pain - extremely time-consuming, paralegal work",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total firm-wide hours per week on administrative tasks (all staff combined)",
    "weekly_hours_range": [10, 150, 50],
    "weekly_hours_help_text": "Example: 20 staff × 2.5 hours each = 50 hours/week. Include: time entry, file management, document review.",
    "demo_documents": "contracts, matter files, time sheets, or discovery documents",
    "automation_potential": 0.35,
    # Legacy support
    "q1_label": "What's your biggest administrative bottleneck?",
    "q1_options": {
        "Time Entry & Billing (Manual time sheet entry)": 3,
        "Matter File Management (Creating and organizing client files)": 6,
        "Contract Review (Reading and extracting key terms)": 8,
        "Document Discovery (Searching and indexing large document sets)": 10
    },
    "q2_label": "Total firm-wide hours per week on administrative tasks (all staff combined)",
    "q2_type": "slider",
    "q2_range": (10, 150)
}
```

---

## Construction

```python
"Construction": {
    "context": "Civil engineering and construction firms (15-100 staff)",
    "pain_point_question": "What's your biggest documentation bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Site Diary Entry (Digital forms, minimal typing)",
            "description": "Low-medium pain - mostly digital",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Tender Specification Analysis (Reading and extracting requirements)",
            "description": "Medium pain - time-consuming but straightforward",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Subcontractor Compliance Tracking (Manual cert checks)",
            "description": "Medium-high pain - critical for WHS, error-prone",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Tender Response Assembly (Manual compilation from 500+ page specs)",
            "description": "High pain - 15-20 hours per tender, competitive disadvantage",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total firm-wide hours per week on manual documentation (all staff combined)",
    "weekly_hours_range": [20, 200, 100],
    "weekly_hours_help_text": "Example: 30 engineers × 3 hours each = 90 hours/week. Include: tender analysis, site diaries, compliance tracking.",
    "demo_documents": "tender specifications, site diaries, SWMS, or subcontractor certificates",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest documentation bottleneck?",
    "q1_options": {
        "Site Diary Entry (Digital forms, minimal typing)": 3,
        "Tender Specification Analysis (Reading and extracting requirements)": 6,
        "Subcontractor Compliance Tracking (Manual cert checks)": 8,
        "Tender Response Assembly (Manual compilation from 500+ page specs)": 10
    },
    "q2_label": "Total firm-wide hours per week on manual documentation (all staff combined)",
    "q2_type": "slider",
    "q2_range": (20, 200)
}
```

---

## Mining Services

```python
"Mining Services": {
    "context": "Mining services and Bowen Basin operations (15-100 staff)",
    "pain_point_question": "What's your biggest operational documentation bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Equipment Logs (Digital systems, minimal manual entry)",
            "description": "Low-medium pain - mostly automated",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Shift Handover Documentation (Typing handwritten logs)",
            "description": "Medium pain - time-consuming transcription",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Safety Incident Reporting (Manual form completion and classification)",
            "description": "Medium-high pain - critical for compliance, time-consuming",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Regulatory Compliance Documentation (Manual compilation for audits)",
            "description": "High pain - complex, error-prone, audit-critical",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total operation-wide hours per week on manual documentation (all staff combined)",
    "weekly_hours_range": [15, 150, 60],
    "weekly_hours_help_text": "Example: 20 site supervisors × 3 hours each = 60 hours/week. Include: incident reports, shift logs, compliance docs.",
    "demo_documents": "safety incident reports, shift handover logs, equipment maintenance records, or regulatory compliance documents",
    "automation_potential": 0.35,
    # Legacy support
    "q1_label": "What's your biggest operational documentation bottleneck?",
    "q1_options": {
        "Equipment Logs (Digital systems, minimal manual entry)": 3,
        "Shift Handover Documentation (Typing handwritten logs)": 6,
        "Safety Incident Reporting (Manual form completion and classification)": 8,
        "Regulatory Compliance Documentation (Manual compilation for audits)": 10
    },
    "q2_label": "Total operation-wide hours per week on manual documentation (all staff combined)",
    "q2_type": "slider",
    "q2_range": (15, 150)
}
```

---

## Property Management

```python
"Property Management": {
    "context": "Property management agencies (10-100 staff)",
    "pain_point_question": "What's your biggest administrative bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Lease Data Entry (Typing basic lease terms into PMS)",
            "description": "Low-medium pain - straightforward but repetitive",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Maintenance Order Processing (Matching requests with invoices)",
            "description": "Medium pain - time-consuming matching and approval",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Lease Document Review (Extracting key dates and terms)",
            "description": "Medium-high pain - requires property manager judgment",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Compliance Certificate Tracking (Manual expiry monitoring across portfolio)",
            "description": "High pain - critical for compliance, error-prone, portfolio-wide",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total agency-wide hours per week on manual processing (all staff combined)",
    "weekly_hours_range": [10, 120, 45],
    "weekly_hours_help_text": "Example: 15 property managers × 3 hours each = 45 hours/week. Include: lease processing, maintenance orders, compliance tracking.",
    "demo_documents": "lease agreements, maintenance invoices, compliance certificates, or tenant applications",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest administrative bottleneck?",
    "q1_options": {
        "Lease Data Entry (Typing basic lease terms into PMS)": 3,
        "Maintenance Order Processing (Matching requests with invoices)": 6,
        "Lease Document Review (Extracting key dates and terms)": 8,
        "Compliance Certificate Tracking (Manual expiry monitoring across portfolio)": 10
    },
    "q2_label": "Total agency-wide hours per week on manual processing (all staff combined)",
    "q2_type": "slider",
    "q2_range": (10, 120)
}
```

---

## Logistics & Freight

```python
"Logistics & Freight": {
    "context": "Logistics and freight forwarding firms (10-100 staff)",
    "pain_point_question": "What's your biggest operational bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "BOL Data Entry (Typing basic shipment details)",
            "description": "Low-medium pain - straightforward but repetitive",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "POD Matching (Matching delivery receipts with invoices)",
            "description": "Medium pain - time-consuming matching process",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Customs Documentation (Manual customs entry creation)",
            "description": "Medium-high pain - error-prone, fines for mistakes",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Complex Customs Entries (Multi-line items, tariff classification)",
            "description": "High pain - one error = $5-50K fines + demurrage, requires expertise",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total firm-wide hours per week on manual processing (all staff combined)",
    "weekly_hours_range": [15, 150, 70],
    "weekly_hours_help_text": "Example: 20 operations staff × 3.5 hours each = 70 hours/week. Include: BOL processing, customs entries, POD matching.",
    "demo_documents": "bills of lading, customs declarations, proof of delivery documents, or freight manifests",
    "automation_potential": 0.45,
    # Legacy support
    "q1_label": "What's your biggest operational bottleneck?",
    "q1_options": {
        "BOL Data Entry (Typing basic shipment details)": 3,
        "POD Matching (Matching delivery receipts with invoices)": 6,
        "Customs Documentation (Manual customs entry creation)": 8,
        "Complex Customs Entries (Multi-line items, tariff classification)": 10
    },
    "q2_label": "Total firm-wide hours per week on manual processing (all staff combined)",
    "q2_type": "slider",
    "q2_range": (15, 150)
}
```

---

## Healthcare Admin

```python
"Healthcare Admin": {
    "context": "Healthcare administration and practice management (10-100 staff)",
    "pain_point_question": "What's your biggest administrative bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Patient Data Entry (Typing basic patient information)",
            "description": "Low-medium pain - straightforward but repetitive",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Referral Processing (Typing referral details into systems)",
            "description": "Medium pain - time-consuming data entry",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Medicare/Private Claiming (Manual claim form completion)",
            "description": "Medium-high pain - error-prone, claim rejections costly",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Complex Referral Triage (Reading and classifying referral urgency)",
            "description": "High pain - requires clinical judgment, time-consuming",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total practice-wide hours per week on manual processing (all staff combined)",
    "weekly_hours_range": [10, 120, 50],
    "weekly_hours_help_text": "Example: 15 admin staff × 3 hours each = 45 hours/week. Include: patient intake, referral processing, claiming.",
    "demo_documents": "patient intake forms, referral letters, Medicare claim forms, or compliance certificates",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest administrative bottleneck?",
    "q1_options": {
        "Patient Data Entry (Typing basic patient information)": 3,
        "Referral Processing (Typing referral details into systems)": 6,
        "Medicare/Private Claiming (Manual claim form completion)": 8,
        "Complex Referral Triage (Reading and classifying referral urgency)": 10
    },
    "q2_label": "Total practice-wide hours per week on manual processing (all staff combined)",
    "q2_type": "slider",
    "q2_range": (10, 120)
}
```

---

## Government Contractors

```python
"Government Contractors": {
    "context": "Government contractors and service providers (10-100 staff)",
    "pain_point_question": "What's your biggest compliance documentation bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Contract Data Entry (Typing basic contract terms)",
            "description": "Low-medium pain - straightforward but repetitive",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Grant Report Assembly (Compiling data from multiple sources)",
            "description": "Medium pain - time-consuming compilation",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Tender Compliance Documentation (Matching requirements to responses)",
            "description": "Medium-high pain - critical for winning tenders, error-prone",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "NDIS Audit Trail Generation (Manual compilation of service delivery evidence)",
            "description": "High pain - complex, audit-critical, portfolio-wide tracking",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total organization-wide hours per week on manual documentation (all staff combined)",
    "weekly_hours_range": [15, 150, 60],
    "weekly_hours_help_text": "Example: 20 staff × 3 hours each = 60 hours/week. Include: grant acquittals, tender compliance, audit trails.",
    "demo_documents": "grant reports, tender responses, NDIS service delivery records, or contract compliance documents",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest compliance documentation bottleneck?",
    "q1_options": {
        "Contract Data Entry (Typing basic contract terms)": 3,
        "Grant Report Assembly (Compiling data from multiple sources)": 6,
        "Tender Compliance Documentation (Matching requirements to responses)": 8,
        "NDIS Audit Trail Generation (Manual compilation of service delivery evidence)": 10
    },
    "q2_label": "Total organization-wide hours per week on manual documentation (all staff combined)",
    "q2_type": "slider",
    "q2_range": (15, 150)
}
```

---

## Wealth Management

```python
"Wealth Management": {
    "context": "Wealth management and financial advisory firms (10-100 staff)",
    "pain_point_question": "What's your biggest administrative bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Client Data Entry (Typing basic client information)",
            "description": "Low-medium pain - straightforward but repetitive",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Statement Processing (Manual entry from client statements)",
            "description": "Medium pain - time-consuming data entry",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "SOA Generation (Manual compilation of Statement of Advice)",
            "description": "Medium-high pain - error-prone, compliance-critical",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Performance Attribution & Reporting (Complex calculation and compilation)",
            "description": "High pain - requires financial expertise, time-consuming, client-facing",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total firm-wide hours per week on manual processing (all advisors and admin staff combined)",
    "weekly_hours_range": [10, 120, 50],
    "weekly_hours_help_text": "Example: 15 advisors × 3 hours each = 45 hours/week. Include: statement processing, SOA generation, performance reporting.",
    "demo_documents": "client statements, SOA templates, performance reports, or compliance certificates",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest administrative bottleneck?",
    "q1_options": {
        "Client Data Entry (Typing basic client information)": 3,
        "Statement Processing (Manual entry from client statements)": 6,
        "SOA Generation (Manual compilation of Statement of Advice)": 8,
        "Performance Attribution & Reporting (Complex calculation and compilation)": 10
    },
    "q2_label": "Total firm-wide hours per week on manual processing (all advisors and admin staff combined)",
    "q2_type": "slider",
    "q2_range": (10, 120)
}
```

---

## Insurance Underwriting

```python
"Insurance Underwriting": {
    "context": "Insurance underwriting and risk assessment firms (10-100 staff)",
    "pain_point_question": "What's your biggest operational bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Application Data Entry (Typing basic application information)",
            "description": "Low-medium pain - straightforward but repetitive",
            "multiplier": 0.90,
            "automation_note": "Moderate automation potential"
        },
        {
            "value": 6,
            "label": "Risk Assessment Data Collection (Gathering data from multiple sources)",
            "description": "Medium pain - time-consuming data gathering",
            "multiplier": 1.05,
            "automation_note": "Moderate-high automation potential"
        },
        {
            "value": 8,
            "label": "Policy Application Review (Reading and extracting key information)",
            "description": "Medium-high pain - requires underwriting judgment, time-consuming",
            "multiplier": 1.25,
            "automation_note": "High automation potential"
        },
        {
            "value": 10,
            "label": "Claims Documentation Processing (Complex claim file compilation and analysis)",
            "description": "High pain - complex, error-prone, critical for claims decisions",
            "multiplier": 1.35,
            "automation_note": "Maximum ROI opportunity - high automation potential"
        }
    ],
    "weekly_hours_question": "Total firm-wide hours per week on manual processing (all underwriters and admin staff combined)",
    "weekly_hours_range": [10, 120, 50],
    "weekly_hours_help_text": "Example: 15 underwriters × 3 hours each = 45 hours/week. Include: application processing, risk assessment, claims documentation.",
    "demo_documents": "policy applications, risk assessment forms, claims documentation, or compliance certificates",
    "automation_potential": 0.40,
    # Legacy support
    "q1_label": "What's your biggest operational bottleneck?",
    "q1_options": {
        "Application Data Entry (Typing basic application information)": 3,
        "Risk Assessment Data Collection (Gathering data from multiple sources)": 6,
        "Policy Application Review (Reading and extracting key information)": 8,
        "Claims Documentation Processing (Complex claim file compilation and analysis)": 10
    },
    "q2_label": "Total firm-wide hours per week on manual processing (all underwriters and admin staff combined)",
    "q2_type": "slider",
    "q2_range": (10, 120)
}
```

---

## Implementation Notes

### Multiplier Values
All multipliers are already implemented in `calculate_metrics()`. The `multiplier` field in configs is for UI display only (optional enhancement).

### Automation Notes
The `automation_note` field provides user-friendly explanations. If not provided, the system generates generic notes based on pain point value.

### Legacy Support
All configs include `q1_options` dictionary for backward compatibility with existing code.

### Base Automation Potential
Each industry has a `automation_potential` field (typically 0.35-0.45). This is multiplied by the pain score multiplier to get the final automation percentage.

---

**For deployment instructions, see DEPLOYMENT_SUMMARY.md**

