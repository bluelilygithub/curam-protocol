import os
import base64
import requests
from flask import render_template_string, request, session, send_file, Response, url_for, redirect
import pandas as pd
import plotly.graph_objects as go
import plotly.utils
import json
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
import io
from database import capture_email_request, mark_email_sent, log_roi_report

# Configuration
BOOKING_URL = "/booking.html"
COMPANY_NAME = "Curam AI"

# Create Flask Blueprint for ROI calculator
from flask import Blueprint
roi_app = Blueprint('roi_calculator', __name__, template_folder=None)

# Industry-specific AI automation opportunities
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

# Industry configurations
INDUSTRIES = {
    "Architecture & Building Services": {
        "context": "Architecture and building services firms (10-100 staff)",
        # Conservative v3.1 fields with firm size scaling
        "doc_staff_percentage_base": 0.75,  # Base percentage (medium firm) - will be scaled
        "doc_staff_hours_per_week": 5.0,
        "doc_staff_typical_rate": 130,
        "proven_tasks": {
            "transmittals": 0.25,
            "specifications": 0.20,
            "drawing_registers": 0.18,
            "site_diaries": 0.22,
            "other": 0.15
        },
        "tasks": [
            {
                "id": "transmittals",
                "name": "Document Transmittals",
                "complexity": 10,
                "complexity_label": "High (Proven ROI)",
                "description": "Manual PDF creation, tracking, distribution - highly repetitive",
                "automation_potential": 0.50,
                "multiplier": 1.35,
                "proven_success_rate": 0.90,
                "is_low_hanging_fruit": True
            },
            {
                "id": "specifications",
                "name": "Specification Writing",
                "complexity": 7,
                "complexity_label": "Medium-High (Proven ROI)",
                "description": "Template-based spec generation from Masterspec/Natspec",
                "automation_potential": 0.45,
                "multiplier": 1.20,
                "proven_success_rate": 0.85
            },
            {
                "id": "drawing_registers",
                "name": "Drawing Register Compilation",
                "complexity": 6,
                "complexity_label": "Medium (Proven ROI)",
                "description": "Manual Excel compilation from title blocks and metadata",
                "automation_potential": 0.40,
                "multiplier": 1.00,
                "proven_success_rate": 0.88
            },
            {
                "id": "site_diaries",
                "name": "Site Diary Digitization",
                "complexity": 4,
                "complexity_label": "Medium (Requires Validation)",
                "description": "Converting handwritten notes to digital - requires judgment",
                "automation_potential": 0.30,
                "multiplier": 0.85,
                "proven_success_rate": 0.75,
                "requires_phase_1": True
            },
            {
                "id": "other",
                "name": "Other Documentation",
                "complexity": 5,
                "complexity_label": "Medium (Varies)",
                "description": "Various administrative tasks",
                "automation_potential": 0.35,
                "multiplier": 1.00,
                "proven_success_rate": 0.80
            }
        ],
        # Legacy fields for backward compatibility
        "hours_per_staff_per_week": 4.0,
        "task_breakdown": {
            "transmittals": 0.23,
            "specifications": 0.18,
            "drawing_registers": 0.15,
            "site_diaries": 0.28,
            "other": 0.16
        },
        "demo_documents": "drawing registers, BIM schedules, or document transmittals",
        "automation_potential": 0.40,
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
    },
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
        "q2_range": (0, 20)
    },
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
        }
    },
    "Environmental Consulting": {
        "context": "ESG Tables, Air Quality Reports, Compliance",
        "q1_label": "How do you update recurring compliance reports (e.g., ISO tables, quarterly monitoring)?",
        "q1_options": {
            "Automated data pipeline (Low pain)": 0,
            "Rolling forward last year's Word Doc & finding/replacing numbers (High pain)": 10
        },
        "q2_label": "Hours per week spent verifying data accuracy across tables?",
        "q2_type": "slider",
        "q2_range": (0, 20)
    },
    "Accounting & Advisory": {
        "context": "Australian accounting firms (15-100 staff)",
        "pain_point_question": "What's your biggest manual processing pain point?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Invoice Data Entry (Typing vendor invoices into Xero/MYOB)",
                "description": "Low-medium pain - repetitive but straightforward"
            },
            {
                "value": 6,
                "label": "Complex GL Coding (Multi-line invoices requiring judgment)",
                "description": "Medium pain - requires accounting knowledge"
            },
            {
                "value": 8,
                "label": "Trust Account Reconciliations (Matching deposits to matter files)",
                "description": "Medium-high pain - high-stakes, time-consuming"
            },
            {
                "value": 10,
                "label": "Inter-Entity Transaction Matching (Consolidation reconciliations)",
                "description": "High pain - complex, error-prone, senior staff time"
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
    },
    "Legal Services": {
        "context": "Legal practices and law firms (10-100 staff)",
        "pain_point_question": "What's your biggest administrative bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Time Entry & Billing (Manual time sheet entry)",
                "description": "Low-medium pain - tedious but straightforward"
            },
            {
                "value": 6,
                "label": "Matter File Management (Creating and organizing client files)",
                "description": "Medium pain - time-consuming setup"
            },
            {
                "value": 8,
                "label": "Contract Review (Reading and extracting key terms)",
                "description": "Medium-high pain - requires legal judgment"
            },
            {
                "value": 10,
                "label": "Document Discovery (Searching and indexing large document sets)",
                "description": "High pain - extremely time-consuming, paralegal work"
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
    },
    "Construction": {
        "context": "Civil engineering and construction firms (15-100 staff)",
        "pain_point_question": "What's your biggest documentation bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Site Diary Entry (Digital forms, minimal typing)",
                "description": "Low-medium pain - mostly digital"
            },
            {
                "value": 6,
                "label": "Tender Specification Analysis (Reading and extracting requirements)",
                "description": "Medium pain - time-consuming but straightforward"
            },
            {
                "value": 8,
                "label": "Subcontractor Compliance Tracking (Manual cert checks)",
                "description": "Medium-high pain - critical for WHS, error-prone"
            },
            {
                "value": 10,
                "label": "Tender Response Assembly (Manual compilation from 500+ page specs)",
                "description": "High pain - 15-20 hours per tender, competitive disadvantage"
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
    },
    "Mining Services": {
        "context": "Mining services and Bowen Basin operations (15-100 staff)",
        "pain_point_question": "What's your biggest operational documentation bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Equipment Logs (Digital systems, minimal manual entry)",
                "description": "Low-medium pain - mostly automated"
            },
            {
                "value": 6,
                "label": "Shift Handover Documentation (Typing handwritten logs)",
                "description": "Medium pain - time-consuming transcription"
            },
            {
                "value": 8,
                "label": "Safety Incident Reporting (Manual form completion and classification)",
                "description": "Medium-high pain - critical for compliance, time-consuming"
            },
            {
                "value": 10,
                "label": "Regulatory Compliance Documentation (Manual compilation for audits)",
                "description": "High pain - complex, error-prone, audit-critical"
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
    },
    "Property Management": {
        "context": "Property management agencies (10-100 staff)",
        "pain_point_question": "What's your biggest administrative bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Lease Data Entry (Typing basic lease terms into PMS)",
                "description": "Low-medium pain - straightforward but repetitive"
            },
            {
                "value": 6,
                "label": "Maintenance Order Processing (Matching requests with invoices)",
                "description": "Medium pain - time-consuming matching and approval"
            },
            {
                "value": 8,
                "label": "Lease Document Review (Extracting key dates and terms)",
                "description": "Medium-high pain - requires property manager judgment"
            },
            {
                "value": 10,
                "label": "Compliance Certificate Tracking (Manual expiry monitoring across portfolio)",
                "description": "High pain - critical for compliance, error-prone, portfolio-wide"
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
    },
    "Logistics & Freight": {
        "context": "Logistics and freight forwarding firms (10-100 staff)",
        "pain_point_question": "What's your biggest operational bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "BOL Data Entry (Typing basic shipment details)",
                "description": "Low-medium pain - straightforward but repetitive"
            },
            {
                "value": 6,
                "label": "POD Matching (Matching delivery receipts with invoices)",
                "description": "Medium pain - time-consuming matching process"
            },
            {
                "value": 8,
                "label": "Customs Documentation (Manual customs entry creation)",
                "description": "Medium-high pain - error-prone, fines for mistakes"
            },
            {
                "value": 10,
                "label": "Complex Customs Entries (Multi-line items, tariff classification)",
                "description": "High pain - one error = $5-50K fines + demurrage, requires expertise"
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
    },
    "Healthcare Admin": {
        "context": "Healthcare administration and practice management (10-100 staff)",
        "pain_point_question": "What's your biggest administrative bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Patient Data Entry (Typing basic patient information)",
                "description": "Low-medium pain - straightforward but repetitive"
            },
            {
                "value": 6,
                "label": "Referral Processing (Typing referral details into systems)",
                "description": "Medium pain - time-consuming data entry"
            },
            {
                "value": 8,
                "label": "Medicare/Private Claiming (Manual claim form completion)",
                "description": "Medium-high pain - error-prone, claim rejections costly"
            },
            {
                "value": 10,
                "label": "Complex Referral Triage (Reading and classifying referral urgency)",
                "description": "High pain - requires clinical judgment, time-consuming"
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
    },
    "Government Contractors": {
        "context": "Government contractors and service providers (10-100 staff)",
        "pain_point_question": "What's your biggest compliance documentation bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Contract Data Entry (Typing basic contract terms)",
                "description": "Low-medium pain - straightforward but repetitive"
            },
            {
                "value": 6,
                "label": "Grant Report Assembly (Compiling data from multiple sources)",
                "description": "Medium pain - time-consuming compilation"
            },
            {
                "value": 8,
                "label": "Tender Compliance Documentation (Matching requirements to responses)",
                "description": "Medium-high pain - critical for winning tenders, error-prone"
            },
            {
                "value": 10,
                "label": "NDIS Audit Trail Generation (Manual compilation of service delivery evidence)",
                "description": "High pain - complex, audit-critical, portfolio-wide tracking"
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
    },
    "Wealth Management": {
        "context": "Wealth management and financial advisory firms (10-100 staff)",
        "pain_point_question": "What's your biggest administrative bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Client Data Entry (Typing basic client information)",
                "description": "Low-medium pain - straightforward but repetitive"
            },
            {
                "value": 6,
                "label": "Statement Processing (Manual entry from client statements)",
                "description": "Medium pain - time-consuming data entry"
            },
            {
                "value": 8,
                "label": "SOA Generation (Manual compilation of Statement of Advice)",
                "description": "Medium-high pain - error-prone, compliance-critical"
            },
            {
                "value": 10,
                "label": "Performance Attribution & Reporting (Complex calculation and compilation)",
                "description": "High pain - requires financial expertise, time-consuming, client-facing"
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
    },
    "Insurance Underwriting": {
        "context": "Insurance underwriting and risk assessment firms (10-100 staff)",
        "pain_point_question": "What's your biggest operational bottleneck?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Application Data Entry (Typing basic application information)",
                "description": "Low-medium pain - straightforward but repetitive"
            },
            {
                "value": 6,
                "label": "Risk Assessment Data Collection (Gathering data from multiple sources)",
                "description": "Medium pain - time-consuming data gathering"
            },
            {
                "value": 8,
                "label": "Policy Application Review (Reading and extracting key information)",
                "description": "Medium-high pain - requires underwriting judgment, time-consuming"
            },
            {
                "value": 10,
                "label": "Claims Documentation Processing (Complex claim file compilation and analysis)",
                "description": "High pain - complex, error-prone, critical for claims decisions"
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
}

def format_currency(value):
    """Format number as currency"""
    return f"${value:,.0f}"

def generate_automation_roadmap(industry, staff_count, avg_rate, weekly_waste):
    """Generate a 3-phase automation roadmap based on industry and inputs"""
    if industry not in AI_OPPORTUNITIES:
        return []
    
    # Get high-potential tasks for this industry
    high_potential_tasks = [t for t in AI_OPPORTUNITIES[industry] if t['potential'] == 'HIGH']
    
    # Calculate per-staff hours, then scale to total staff
    roadmap = []
    cumulative_savings = 0
    
    for idx, task in enumerate(high_potential_tasks[:3]):  # Top 3 high-potential tasks
        phase_num = idx + 1
        hours_per_week_per_staff = task['hours_per_week']
        total_hours_per_year = hours_per_week_per_staff * staff_count * 52
        revenue_reclaimed = total_hours_per_year * avg_rate
        cumulative_savings += revenue_reclaimed
        
        phase_names = {
            1: "Quick Wins",
            2: "High-Impact",
            3: "Full Automation"
        }
        
        week_ranges = {
            1: "Weeks 1-8",
            2: "Weeks 9-16",
            3: "Weeks 17-24"
        }
        
        payback_periods = {
            1: "6 weeks",
            2: "3 months",
            3: "4 months"
        }
        
        roadmap.append({
            "phase": phase_num,
            "name": f"Phase {phase_num}: {phase_names[phase_num]}",
            "weeks": week_ranges[phase_num],
            "task": task['task'],
            "description": task['description'],
            "hours_per_year": total_hours_per_year,
            "revenue_reclaimed": revenue_reclaimed,
            "cumulative_savings": cumulative_savings,
            "payback": payback_periods[phase_num]
        })
    
    return roadmap

def generate_automation_roadmap_v3(task_analysis, staff_count, avg_rate):
    """Generate prioritized roadmap from task analysis (already sorted by ROI)"""
    
    roadmap = []
    cumulative_savings = 0
    
    # Take top 3 tasks by annual savings (already sorted)
    top_tasks = task_analysis[:3]
    
    phase_names = {
        1: "Quick Wins",
        2: "High-Impact",
        3: "Full Automation"
    }
    
    week_ranges = {
        1: "Weeks 1-8",
        2: "Weeks 9-16",
        3: "Weeks 17-24"
    }
    
    payback_periods = {
        1: "6 weeks",
        2: "3 months",
        3: "4 months"
    }
    
    for idx, task in enumerate(top_tasks):
        phase_num = idx + 1
        cumulative_savings += task['annual_savings']
        
        # Calculate annual hours from weekly hours
        annual_hours = task['recoverable_hours_per_week'] * 48
        
        roadmap.append({
            "phase": phase_num,
            "name": f"Phase {phase_num}: {phase_names[phase_num]}",
            "weeks": week_ranges[phase_num],
            "task": task['name'],
            "complexity": task['complexity'],
            "description": task['description'],
            "hours_per_year": annual_hours,
            "revenue_reclaimed": task['annual_savings'],
            "cumulative_savings": cumulative_savings,
            "payback": payback_periods[phase_num],
            "automation_potential": task['automation_potential']
        })
    
    return roadmap

def get_readiness_response(selection):
    """Get response message based on data storage readiness selection"""
    responses = {
        "structured": {
            "title": "Great! You're AI-Ready",
            "message": "Your structured data infrastructure means we can start automation quickly. Let's discuss which high-value tasks to automate first to maximize your ROI.",
            "icon": "✅"
        },
        "mixed": {
            "title": "Needs Preparation (Most Common)",
            "message": "Like 70% of firms, your data needs some preparation. We can show you the fastest path to AI-ready infrastructure—typically 2-4 weeks of data structuring before automation begins.",
            "icon": "⚠️"
        },
        "chaotic": {
            "title": "High Friction (Not Uncommon)",
            "message": "You're not alone—many firms start here. The good news: we've helped 50+ companies go from chaos to automated in 8-12 weeks. The key is a structured migration plan.",
            "icon": "🚨"
        }
    }
    return responses.get(selection, responses["mixed"])

def get_doc_staff_percentage(total_staff, industry_config):
    """
    Calculate documentation staff percentage with firm size scaling.
    
    Rationale:
    - Small firms (<20): Flat structure, everyone does everything → +10%
    - Medium firms (20-50): Baseline structure → use base %
    - Large firms (50-100): More management layers → -5%
    - Very large (100+): Significant hierarchy → -10%
    
    Args:
        total_staff: Total number of technical staff
        industry_config: Industry configuration dictionary
    
    Returns:
        float: Scaled documentation staff percentage (0.0-1.0)
    """
    base_percentage = industry_config.get('doc_staff_percentage_base', 0.75)
    
    # Apply firm size scaling
    if total_staff < 20:
        # Small firm: flat structure, most people do documentation
        scaled_percentage = base_percentage + 0.10
        # Cap at 90% (always have some senior staff)
        return min(scaled_percentage, 0.90)
        
    elif total_staff < 50:
        # Medium firm: use baseline
        return base_percentage
        
    elif total_staff < 100:
        # Large firm: more management, fewer doing documentation
        scaled_percentage = base_percentage - 0.05
        # Floor at 65% (always need significant documentation staff)
        return max(scaled_percentage, 0.65)
        
    else:
        # Very large firm: significant hierarchy
        scaled_percentage = base_percentage - 0.10
        # Floor at 60%
        return max(scaled_percentage, 0.60)

def calculate_conservative_roi(total_staff, industry_config):
    """
    Calculate CONSERVATIVE ROI based on proven low-hanging fruit only.
    Includes firm size scaling for documentation staff percentage.
    
    Philosophy: Show minimum proven savings on known repetitive tasks,
    not aspirational total opportunity. Focus on documentation staff
    (junior/mid-level) who actually do the work.
    """
    
    # Calculate documentation staff with FIRM SIZE SCALING
    base_percentage = industry_config.get('doc_staff_percentage_base', 0.75)
    doc_staff_percentage = get_doc_staff_percentage(total_staff, industry_config)
    doc_staff_count = int(total_staff * doc_staff_percentage)
    
    # Store both base and scaled for transparency
    base_doc_staff = int(total_staff * base_percentage)
    
    # Use conservative hours and rate
    hours_per_doc_staff = industry_config.get('doc_staff_hours_per_week', 5.0)
    typical_doc_rate = industry_config.get('doc_staff_typical_rate', 130)
    
    # Calculate totals
    total_weekly_hours = doc_staff_count * hours_per_doc_staff
    annual_cost = total_weekly_hours * typical_doc_rate * 48
    
    # Get proven task breakdown
    proven_tasks = industry_config.get('proven_tasks', {})
    tasks = industry_config.get('tasks', [])
    
    # Calculate per-task conservative savings
    task_analysis = []
    total_recoverable_hours = 0
    total_proven_savings = 0
    
    for task in tasks:
        task_id = task['id']
        task_percentage = proven_tasks.get(task_id, 0)
        task_hours = total_weekly_hours * task_percentage
        
        # Use conservative automation potential
        automation_potential = task['automation_potential']
        
        # Apply success rate (conservative adjustment)
        proven_success_rate = task.get('proven_success_rate', 0.85)
        conservative_potential = automation_potential * proven_success_rate
        
        recoverable_hours = task_hours * conservative_potential
        annual_savings = recoverable_hours * typical_doc_rate * 48
        
        task_analysis.append({
            'id': task_id,
            'name': task['name'],
            'complexity': task['complexity'],
            'complexity_label': task['complexity_label'],
            'description': task['description'],
            'hours_per_week': task_hours,
            'percentage_of_total': task_percentage * 100,
            'automation_potential': automation_potential,
            'proven_success_rate': proven_success_rate,
            'conservative_potential': conservative_potential,
            'recoverable_hours_per_week': recoverable_hours,
            'annual_savings': annual_savings,
            'multiplier': task['multiplier'],
            'is_low_hanging_fruit': task.get('is_low_hanging_fruit', False),
            'requires_phase_1': task.get('requires_phase_1', False)
        })
        
        total_recoverable_hours += recoverable_hours
        total_proven_savings += annual_savings
    
    # Sort by annual savings (highest proven ROI first)
    task_analysis.sort(key=lambda x: x['annual_savings'], reverse=True)
    
    # Calculate weighted average (conservative)
    weighted_potential = total_recoverable_hours / total_weekly_hours if total_weekly_hours > 0 else 0
    
    # Tier 2 is aspirational - show but don't emphasize
    tier_2_potential = min(weighted_potential + 0.25, 0.70)  # More conservative
    tier_2_savings = total_weekly_hours * tier_2_potential * typical_doc_rate * 48
    
    # Determine firm size category for display
    if total_staff < 20:
        firm_size_category = "Small"
        scaling_note = "Flat structure: most staff do documentation"
    elif total_staff < 50:
        firm_size_category = "Medium"
        scaling_note = "Typical structure: baseline percentage"
    elif total_staff < 100:
        firm_size_category = "Large"
        scaling_note = "More management: fewer staff do documentation"
    else:
        firm_size_category = "Very Large"
        scaling_note = "Significant hierarchy: much less documentation staff"
    
    return {
        "mode": "conservative_proven",
        "total_staff": total_staff,
        "doc_staff_count": doc_staff_count,
        "doc_staff_percentage": doc_staff_percentage * 100,
        "base_doc_staff_percentage": base_percentage * 100,
        "base_doc_staff_count": base_doc_staff,
        "firm_size_category": firm_size_category,
        "scaling_note": scaling_note,
        "hours_per_doc_staff": hours_per_doc_staff,
        "typical_doc_rate": typical_doc_rate,
        "total_weekly_hours": total_weekly_hours,
        "annual_cost": annual_cost,
        "task_analysis": task_analysis,
        "total_recoverable_hours": total_recoverable_hours,
        "weighted_potential": weighted_potential,
        "proven_tier_1_savings": total_proven_savings,
        "tier_2_potential": tier_2_potential,
        "tier_2_savings": tier_2_savings,
        "capacity_hours": total_recoverable_hours * 48,
        "potential_revenue": total_proven_savings,
        # Legacy fields for backward compatibility
        "annual_burn": annual_cost,
        "tier_1_savings": total_proven_savings
    }

def calculate_metrics_v3(staff_count, avg_rate, industry_config):
    """
    Calculate ROI across all document types using industry defaults.
    No user input for hours - auto-calculated based on staff + industry.
    """
    
    # Auto-calculate total hours
    hours_per_staff = industry_config.get('hours_per_staff_per_week', 4.0)
    total_weekly_hours = staff_count * hours_per_staff
    
    # Get task breakdown
    task_breakdown = industry_config.get('task_breakdown', {})
    tasks = industry_config.get('tasks', [])
    
    # Calculate per-task metrics
    task_analysis = []
    total_recoverable_hours = 0
    
    for task in tasks:
        task_id = task['id']
        task_percentage = task_breakdown.get(task_id, 0)
        task_hours = total_weekly_hours * task_percentage
        automation_potential = task['automation_potential']
        recoverable_hours = task_hours * automation_potential
        annual_savings = recoverable_hours * avg_rate * 48
        
        task_analysis.append({
            'id': task_id,
            'name': task['name'],
            'complexity': task['complexity'],
            'complexity_label': task['complexity_label'],
            'description': task['description'],
            'hours_per_week': task_hours,
            'percentage_of_total': task_percentage * 100,
            'automation_potential': automation_potential,
            'recoverable_hours_per_week': recoverable_hours,
            'annual_savings': annual_savings,
            'multiplier': task['multiplier'],
            'is_highest_roi': task.get('is_highest_roi', False)
        })
        
        total_recoverable_hours += recoverable_hours
    
    # Sort by annual savings (highest ROI first)
    task_analysis.sort(key=lambda x: x['annual_savings'], reverse=True)
    
    # Mark highest ROI task
    if task_analysis:
        task_analysis[0]['is_highest_roi'] = True
    
    # Calculate totals
    annual_burn = total_weekly_hours * avg_rate * 48
    weighted_automation_potential = total_recoverable_hours / total_weekly_hours if total_weekly_hours > 0 else 0
    tier_1_savings = total_recoverable_hours * avg_rate * 48
    
    # Tier 2 (expanded automation - add 30% more)
    tier_2_potential = min(weighted_automation_potential + 0.30, 0.85)
    tier_2_recoverable_hours = total_weekly_hours * tier_2_potential
    tier_2_savings = tier_2_recoverable_hours * avg_rate * 48
    
    return {
        "mode": "weighted_analysis",
        "hours_per_staff_per_week": hours_per_staff,
        "total_weekly_hours": total_weekly_hours,
        "annual_burn": annual_burn,
        "task_analysis": task_analysis,
        "total_recoverable_hours_per_week": total_recoverable_hours,
        "weighted_automation_potential": weighted_automation_potential,
        "tier_1_savings": tier_1_savings,
        "tier_2_potential": tier_2_potential,
        "tier_2_savings": tier_2_savings,
        "tier_2_cost": annual_burn - tier_2_savings,
        "capacity_hours": total_recoverable_hours * 48,
        "potential_revenue": tier_1_savings
    }

# Keep old function for backward compatibility (deprecated)
def calculate_metrics(staff_count, avg_rate, weekly_waste, pain_point, industry_config):
    """DEPRECATED: Use calculate_metrics_v3() instead"""
    base_automation_potential = industry_config.get('automation_potential', 0.40)
    pain_multipliers = {0: 0.85, 3: 0.90, 5: 1.00, 6: 1.05, 7: 1.15, 8: 1.25, 10: 1.35}
    multiplier = pain_multipliers.get(pain_point, 1.00)
    automation_potential = min(base_automation_potential * multiplier, 0.70)
    annual_burn = weekly_waste * avg_rate * 48
    tier_1_savings = annual_burn * automation_potential
    tier_2_potential = min(automation_potential + 0.30, 0.70)
    tier_2_savings = annual_burn * tier_2_potential
    capacity_hours = weekly_waste * 48
    hours_per_staff_per_week = weekly_waste / staff_count if staff_count > 0 else 0
    return {
        "annual_burn": annual_burn,
        "tier_1_savings": tier_1_savings,
        "tier_1_cost": annual_burn - tier_1_savings,
        "tier_2_savings": tier_2_savings,
        "tier_2_cost": annual_burn - tier_2_savings,
        "capacity_hours": capacity_hours,
        "potential_revenue": capacity_hours * avg_rate,
        "pain_point": pain_point,
        "weekly_waste": weekly_waste,
        "hours_per_staff_per_week": hours_per_staff_per_week,
        "automation_potential": automation_potential,
        "base_automation_potential": base_automation_potential,
        "pain_multiplier": multiplier,
        "tier_2_potential": tier_2_potential
    }

def generate_pdf_report(industry, staff_count, avg_rate, platform, calculations):
    """Generate branded PDF report"""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    story = []
    
    # Styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#0B1221'),
        spaceAfter=30,
        alignment=1
    )
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=16,
        textColor=colors.HexColor('#0B1221'),
        spaceAfter=12
    )
    normal_style = styles['Normal']
    
    # Title
    story.append(Paragraph("Automation ROI Business Case", title_style))
    story.append(Spacer(1, 0.3*inch))
    
    # Date
    story.append(Paragraph(f"Generated: {datetime.now().strftime('%B %d, %Y')}", normal_style))
    story.append(Spacer(1, 0.5*inch))
    
    # Client Inputs
    story.append(Paragraph("Client Inputs", heading_style))
    inputs_data = [
        ["Industry", industry],
        ["Billable Technical Staff Count", str(staff_count)],
        ["Average Billable Rate (AUD)", format_currency(avg_rate)]
    ]
    inputs_table = Table(inputs_data, colWidths=[3*inch, 4*inch])
    inputs_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#F8F9FA')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#4B5563')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#E5E7EB'))
    ]))
    story.append(inputs_table)
    story.append(Spacer(1, 0.3*inch))
    
    # Calculations
    story.append(Paragraph("Financial Analysis", heading_style))
    automation_potential_pct = int(calculations.get('automation_potential', 0.40) * 100)
    tier_2_potential_pct = int(calculations.get('tier_2_potential', 0.70) * 100)
    calc_data = [
        ["Metric", "Value"],
        ["Annual Revenue Leakage", format_currency(calculations['annual_burn'])],
        [f"Tier 1 Opportunity (Immediate Opportunity - {automation_potential_pct}% Reduction)", format_currency(calculations['tier_1_savings'])],
        [f"Tier 2 Opportunity (Expanded Automation - {tier_2_potential_pct}% Reduction)", format_currency(calculations['tier_2_savings'])],
        ["Capacity Hours Unlocked", f"{calculations['capacity_hours']:,.0f} hours"],
        ["Potential Revenue Opportunity", format_currency(calculations['potential_revenue'])]
    ]
    calc_table = Table(calc_data, colWidths=[3.5*inch, 3.5*inch])
    calc_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0B1221')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#D4AF37')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#E5E7EB')),
        ('BACKGROUND', (0, 1), (-1, -1), colors.white)
    ]))
    story.append(calc_table)
    story.append(Spacer(1, 0.3*inch))
    
    # Recommendations
    story.append(Paragraph("Recommended Next Steps", heading_style))
    automation_potential_pct = int(calculations.get('automation_potential', 0.40) * 100)
    tier_2_potential_pct = int(calculations.get('tier_2_potential', 0.70) * 100)
    recommendations = [
        f"<b>Tier 1 Implementation ({automation_potential_pct}% Reduction):</b> Focus on automated data extraction to achieve immediate savings of {format_currency(calculations['tier_1_savings'])} annually.",
        f"<b>Tier 2 Implementation ({tier_2_potential_pct}% Reduction):</b> Expand automation to unlock {calculations['capacity_hours']:,.0f} billable hours, representing {format_currency(calculations['potential_revenue'])} in revenue capacity.",
        "<b>Next Action:</b> Book a Discovery Call to validate these numbers and discuss implementation roadmap."
    ]
    for rec in recommendations:
        story.append(Paragraph(rec, normal_style))
        story.append(Spacer(1, 0.15*inch))
    
    story.append(PageBreak())
    story.append(Paragraph(f"About {COMPANY_NAME}", heading_style))
    story.append(Paragraph(
        f"{COMPANY_NAME} specializes in automating manual workflows for technical consulting firms. "
        "Our solutions reduce administrative overhead and unlock billable capacity by eliminating "
        "time-consuming data entry and document processing tasks.",
        normal_style
    ))
    
    doc.build(story)
    buffer.seek(0)
    return buffer

# HTML Template
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Curam AI - ROI Calculator</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #F8F9FA;
            color: #4B5563;
            line-height: 1.6;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 2rem;
        }
        h1 {
            color: #0B1221;
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            margin-bottom: 0.5rem;
            font-size: 2.5rem;
        }
        h2 {
            color: #0B1221;
            font-family: 'Montserrat', sans-serif;
            font-weight: 600;
            margin-top: 2rem;
            margin-bottom: 1rem;
        }
        h3 {
            color: #0B1221;
            font-weight: 600;
            margin-top: 1.5rem;
        }
        .step-indicator {
            display: flex;
            justify-content: center;
            padding: 1.5rem 0;
            gap: 1rem;
            background: white;
            border-bottom: 1px solid #E5E7EB;
            position: sticky;
            top: 0;
            z-index: 1000;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        .step {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            color: white;
            background-color: #E5E7EB;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
        }
        .step:hover {
            transform: scale(1.1);
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .step.active {
            background-color: #D4AF37;
            color: #0B1221;
        }
        .step.completed {
            background-color: #0B1221;
            color: #D4AF37;
        }
        .step.completed:hover {
            background-color: #1a2332;
        }
        .important-notice {
            background: #FFF4E6;
            border-left: 4px solid #D4AF37;
            padding: 1rem 1.5rem;
            margin: 1.5rem 0;
            border-radius: 6px;
        }
        .important-notice p {
            color: #4B5563;
            margin: 0;
            line-height: 1.6;
        }
        .important-notice strong {
            color: #0B1221;
        }
        .explanation-box {
            background: #FFFBF0;
            border-left: 4px solid #D4AF37;
            padding: 1.5rem;
            margin: 2rem 0;
            border-radius: 6px;
        }
        .explanation-box h4 {
            color: #0B1221;
            font-weight: 700;
            margin-bottom: 1rem;
            font-size: 1.1rem;
        }
        .explanation-box p {
            color: #4B5563;
            margin-bottom: 0.75rem;
            line-height: 1.7;
        }
        .explanation-box ul {
            margin: 0.75rem 0;
            padding-left: 1.5rem;
            color: #4B5563;
        }
        .explanation-box li {
            margin-bottom: 0.5rem;
            line-height: 1.6;
        }
        .explanation-box strong {
            color: #0B1221;
        }
        .heatmap-container {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            border: 1px solid #E5E7EB;
            margin: 2rem 0;
        }
        .heatmap-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        .heatmap-table th {
            background-color: #0B1221;
            color: white;
            padding: 0.75rem;
            text-align: left;
            font-weight: 600;
            font-size: 0.9rem;
        }
        .heatmap-table td {
            padding: 0.75rem;
            border-bottom: 1px solid #E5E7EB;
        }
        .heatmap-table tr:hover {
            background-color: #F8F9FA;
        }
        .potential-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 12px;
            font-weight: 600;
            font-size: 0.85rem;
        }
        .potential-high {
            background-color: #FEE2E2;
            color: #991B1B;
        }
        .potential-medium {
            background-color: #FEF3C7;
            color: #92400E;
        }
        .potential-low {
            background-color: #D1FAE5;
            color: #065F46;
        }
        .reality-check-box {
            background: #FFFBF0;
            border-left: 4px solid #D4AF37;
            padding: 1.5rem;
            margin: 2rem 0;
            border-radius: 6px;
        }
        .reality-check-response {
            margin-top: 1rem;
            padding: 1rem;
            background: white;
            border-radius: 4px;
            border: 1px solid #E5E7EB;
        }
        .roadmap-container {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            border: 1px solid #E5E7EB;
            margin: 2rem 0;
        }
        .roadmap-phase {
            border-left: 3px solid #D4AF37;
            padding: 1rem 1.5rem;
            margin: 1rem 0;
            background: #F8F9FA;
            border-radius: 4px;
        }
        .roadmap-phase h4 {
            color: #0B1221;
            margin-bottom: 0.5rem;
        }
        .roadmap-phase ul {
            margin: 0.5rem 0;
            padding-left: 1.5rem;
            color: #4B5563;
        }
        .roadmap-phase li {
            margin-bottom: 0.25rem;
        }
        .scroll-indicator {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            background: #D4AF37;
            color: #0B1221;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 100;
            transition: all 0.3s ease;
            opacity: 0;
            pointer-events: none;
        }
        .scroll-indicator.visible {
            opacity: 1;
            pointer-events: all;
        }
        .scroll-indicator:hover {
            background: #B8941F;
            transform: translateY(-3px);
            box-shadow: 0 6px 16px rgba(0,0,0,0.3);
        }
        .scroll-indicator svg {
            width: 24px;
            height: 24px;
        }
        .industry-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
            margin: 2rem 0;
        }
        .industry-card {
            border: 2px solid #E5E7EB;
            border-radius: 8px;
            padding: 1.5rem;
            cursor: pointer;
            transition: all 0.3s ease;
            background-color: white;
        }
        .industry-card:hover {
            border-color: #D4AF37;
            box-shadow: 0 4px 12px rgba(212, 175, 55, 0.2);
        }
        .industry-card.selected {
            border-color: #D4AF37;
            background-color: #FFFBF0;
        }
        .form-group {
            margin: 1.5rem 0;
        }
        label {
            display: block;
            color: #0B1221;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }
        input[type="number"], input[type="range"], select {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #E5E7EB;
            border-radius: 6px;
            font-size: 1rem;
        }
        input[type="radio"] {
            margin-right: 0.5rem;
            vertical-align: middle;
        }
        .radio-group {
            margin: 0.5rem 0;
            display: flex;
            align-items: center;
        }
        .radio-group label {
            display: inline;
            font-weight: normal;
            margin-left: 0.5rem;
            cursor: pointer;
        }
        /* Horizontal radio groups on desktop */
        .form-group {
            display: flex;
            flex-direction: column;
        }
        .form-group > label {
            margin-bottom: 0.75rem;
        }
        .form-group .radio-group-container {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        @media (min-width: 768px) {
            .form-group .radio-group-container {
                flex-direction: row;
                gap: 2rem;
                flex-wrap: wrap;
            }
            .form-group .radio-group {
                margin: 0;
            }
        }
        .slider-container {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        .slider-container input[type="range"] {
            flex: 1;
        }
        .slider-container input[type="number"] {
            width: 100px;
            flex-shrink: 0;
        }
        .slider-container output {
            min-width: 60px;
            text-align: right;
            font-weight: 600;
            color: #0B1221;
        }
        .btn {
            background-color: #D4AF37;
            color: #0B1221;
            font-weight: 600;
            border: none;
            border-radius: 6px;
            padding: 0.75rem 2rem;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }
        .btn:hover {
            background-color: #B8941F;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .btn-secondary {
            background-color: #0B1221;
            color: #D4AF37;
        }
        .btn-group {
            display: flex;
            gap: 1rem;
            margin-top: 2rem;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1rem;
            margin: 2rem 0;
        }
        .metric-card {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            border: 1px solid #E5E7EB;
        }
        .metric-value {
            font-size: 2rem;
            font-weight: 700;
            color: #0B1221;
        }
        .metric-label {
            color: #4B5563;
            font-size: 0.9rem;
            margin-top: 0.5rem;
        }
        .chart-container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            margin: 2rem 0;
        }
        .input-summary {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            border: 1px solid #E5E7EB;
            margin: 1.5rem 0;
        }
        .input-summary h3 {
            color: #0B1221;
            margin-bottom: 1rem;
            font-size: 1.1rem;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.75rem;
            margin-top: 0.5rem;
        }
        @media (max-width: 768px) {
            .summary-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        .summary-item {
            color: #4B5563;
            padding: 0.5rem 0.75rem;
            background: #F8F9FA;
            border-radius: 4px;
            font-size: 0.9rem;
        }
        .summary-item strong {
            color: #0B1221;
            display: inline;
            margin-right: 0.5rem;
            font-size: 0.85rem;
        }
        .analysis-box {
            background: #FFFBF0;
            border-left: 4px solid #D4AF37;
            padding: 1rem;
            margin: 0;
            border-radius: 4px;
            flex: 1;
        }
        .analysis-row {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
            margin: 1rem 0;
        }
        hr {
            border: none;
            border-top: 1px solid #E5E7EB;
            margin: 2rem 0;
        }
        .section-headline {
            color: #0B1221;
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            font-size: 2rem;
            margin-top: 2rem;
            margin-bottom: 0.5rem;
        }
        .section-subhead {
            color: #4B5563;
            font-size: 1rem;
            margin-bottom: 1.5rem;
        }
        .roi-results-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1rem;
            margin-top: 1.5rem;
            margin-bottom: 2rem;
        }
        @media (max-width: 1024px) {
            .roi-results-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        @media (max-width: 640px) {
            .roi-results-grid {
                grid-template-columns: 1fr;
            }
        }
        .roi-result-card {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            text-align: center;
            border: 1px solid #E5E7EB;
            transition: all 0.3s ease;
        }
        .roi-result-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
            border-color: #D4AF37;
        }
        .roi-result-stat {
            font-size: 3rem;
            font-weight: 800;
            background: linear-gradient(135deg, #D4AF37, #0B1221);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 0.5rem;
        }
        .roi-result-label {
            font-size: 1rem;
            font-weight: 600;
            color: #0B1221;
            margin-bottom: 0.5rem;
        }
        .roi-result-description {
            font-size: 0.875rem;
            color: #4B5563;
            line-height: 1.5;
            margin: 0;
        }
        .highlight-box {
            display: flex;
            align-items: flex-start;
            gap: 1rem;
            background: rgba(0, 212, 255, 0.08);
            border: 1px solid #00D4FF;
            border-radius: 8px;
            padding: 1.5rem;
            margin-top: 2rem;
            text-align: left;
        }
        .highlight-box.footnote {
            margin-top: 1.5rem;
            background: #FFFBF0;
            border-color: #D4AF37;
        }
        .highlight-box p {
            margin: 0;
            color: #4B5563;
            line-height: 1.6;
        }
        .highlight-box strong {
            color: #0B1221;
        }
        .task-breakdown {
            display: grid;
            gap: 1.5rem;
            margin: 2rem 0;
        }
        .task-card {
            background: white;
            border: 2px solid #E5E7EB;
            border-radius: 12px;
            padding: 1.5rem;
            transition: all 0.3s ease;
        }
        .task-card:hover {
            border-color: #D4AF37;
            box-shadow: 0 4px 12px rgba(212, 175, 55, 0.1);
        }
        .task-card-highlight {
            border-color: #D4AF37;
            background: linear-gradient(to bottom, #FFFBF0, white);
        }
        .task-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        .complexity-badge {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        .complexity-10, .complexity-9, .complexity-8 {
            background: #10B981;
            color: white;
        }
        .complexity-7, .complexity-6, .complexity-5 {
            background: #F59E0B;
            color: white;
        }
        .complexity-4, .complexity-3, .complexity-2, .complexity-1 {
            background: #6B7280;
            color: white;
        }
        .roi-badge {
            display: inline-block;
            background: #D4AF37;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .task-details {
            display: grid;
            gap: 0.75rem;
        }
        .task-stat {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            border-bottom: 1px solid #F3F4F6;
        }
        .task-stat:last-child {
            border-bottom: none;
        }
        .stat-label {
            font-weight: 600;
            color: #4B5563;
        }
        .stat-value {
            color: #0B1221;
            text-align: right;
        }
        .complexity-legend {
            background: #F8F9FA;
            border: 1px solid #E5E7EB;
            border-radius: 12px;
            padding: 2rem;
            margin: 2rem 0;
        }
        .legend-grid {
            display: grid;
            gap: 1.5rem;
            margin-top: 1rem;
        }
        .legend-item {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .profile-summary {
            background: #F8F9FA;
            border: 1px solid #E5E7EB;
            border-radius: 12px;
            padding: 1.5rem;
            margin: 1rem 0 2rem 0;
        }
        .profile-item {
            display: flex;
            justify-content: space-between;
            padding: 0.75rem 0;
            border-bottom: 1px solid #E5E7EB;
        }
        .profile-item:last-child {
            border-bottom: none;
        }
        .profile-label {
            font-weight: 600;
            color: #4B5563;
        }
        .profile-value {
            color: #0B1221;
            font-weight: 600;
        }
        .conservative-framing-notice {
            background: linear-gradient(135deg, #FFFBF0, #FFF9E6);
            border: 2px solid #D4AF37;
            border-radius: 12px;
            padding: 2rem;
            margin: 2rem 0;
            text-align: center;
        }
        .conservative-framing-notice h2 {
            color: #0B1221;
            margin-bottom: 1rem;
        }
        .methodology-notice {
            background: #F8F9FA;
            border-left: 4px solid #4B5563;
            padding: 1rem 1.5rem;
            margin: 1.5rem 0;
            font-size: 0.9rem;
            color: #4B5563;
        }
        .info-callout {
            background: #EFF6FF;
            border: 1px solid #3B82F6;
            border-radius: 8px;
            padding: 1.5rem;
            margin: 2rem 0;
        }
        .info-callout h4 {
            color: #1E40AF;
            margin-bottom: 0.5rem;
        }
        .info-callout ul {
            margin: 0.5rem 0 0.5rem 1.5rem;
        }
        .insight-callout {
            background: #F0FDF4;
            border-left: 4px solid #10B981;
            padding: 1.5rem;
            margin: 1.5rem 0;
        }
        .conservative-summary-box {
            background: white;
            border: 2px solid #E5E7EB;
            border-radius: 12px;
            padding: 2rem;
            margin: 2rem 0;
        }
        .conservative-summary-box ul {
            margin: 0.5rem 0 1rem 1.5rem;
        }
        .conservative-summary-box li {
            margin: 0.5rem 0;
        }
        .validation-badge {
            display: inline-block;
            background: #F59E0B;
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .task-warning {
            background: #FEF3C7;
            border: 1px solid #F59E0B;
            border-radius: 6px;
            padding: 1rem;
            margin-top: 1rem;
            font-size: 0.875rem;
        }
        .roi-result-card-primary {
            border: 3px solid #D4AF37;
            background: linear-gradient(to bottom, #FFFBF0, white);
        }
        .tier-2-note {
            background: #F3F4F6;
            border: 1px dashed #9CA3AF;
            border-radius: 8px;
            padding: 1.5rem;
            margin: 2rem 0;
            text-align: center;
        }
        .tier-2-note h4 {
            color: #4B5563;
            margin-bottom: 0.5rem;
        }
        .scaling-insight {
            background: #EFF6FF;
            border-left: 4px solid #3B82F6;
            padding: 1.5rem;
            margin: 1.5rem 0;
            border-radius: 0 8px 8px 0;
        }
        .scaling-insight h4 {
            color: #1E40AF;
            margin-bottom: 0.75rem;
        }
        .scaling-insight p {
            margin: 0.5rem 0;
            color: #1E3A8A;
        }
        
        /* ============================================================================
           CSS-ONLY FIXES FOR IMPROVED UX (Phase 1)
           Reorder visual hierarchy without changing HTML structure
           ============================================================================ */
        
        /* FIX 1: REORDER VISUAL HIERARCHY WITH CSS */
        /* Hide the big scary number initially */
        .annual-burn-section {
            order: 999 !important;
            font-size: 0.85rem !important;
            padding: 1.5rem !important;
            margin-top: 3rem !important;
            background: #F8F9FA !important;
            border: 1px solid #E5E7EB !important;
        }
        
        .annual-burn-section > div:first-child {
            font-size: 0.85rem !important;
            color: #6B7280 !important;
        }
        
        .annual-burn-section > div:nth-child(2) {
            font-size: 1.5rem !important;
            background: none !important;
            -webkit-background-clip: unset !important;
            -webkit-text-fill-color: #4B5563 !important;
            color: #4B5563 !important;
        }
        
        .annual-burn-section > div:last-child {
            font-size: 0.8rem !important;
        }
        
        /* Promote the ROI results to hero position */
        .roi-results-grid {
            order: -999 !important;
            margin-top: 0 !important;
            margin-bottom: 3rem !important;
        }
        
        /* Make the primary card REALLY stand out */
        .roi-result-card-primary {
            grid-column: 1 / -1 !important;
            border: 4px solid #D4AF37 !important;
            background: linear-gradient(135deg, #0B1221, #1a2332) !important;
            padding: 3rem 2rem !important;
            box-shadow: 0 20px 60px rgba(212, 175, 55, 0.3) !important;
        }
        
        .roi-result-card-primary .roi-result-stat {
            font-size: 5rem !important;
            background: linear-gradient(135deg, #D4AF37, #FFD700) !important;
            -webkit-background-clip: text !important;
            -webkit-text-fill-color: transparent !important;
        }
        
        .roi-result-card-primary .roi-result-label {
            color: #D4AF37 !important;
            font-size: 1.3rem !important;
            text-transform: uppercase !important;
            letter-spacing: 2px !important;
        }
        
        .roi-result-card-primary .roi-result-description {
            color: rgba(255, 255, 255, 0.8) !important;
            font-size: 1rem !important;
        }
        
        /* Make other cards smaller and supportive */
        .roi-results-grid .roi-result-card:not(.roi-result-card-primary) {
            border: 1px solid #E5E7EB !important;
        }
        
        .roi-results-grid .roi-result-card:not(.roi-result-card-primary) .roi-result-stat {
            font-size: 2rem !important;
            background: linear-gradient(135deg, #D4AF37, #B8941F) !important;
        }
        
        /* FIX 2: ADD CONTEXT LABEL TO $1,092,000 */
        /* Removed redundant CONTEXT label */
        
        .annual-burn-section > div:first-child {
            font-size: 0 !important;
        }
        
        .annual-burn-section > div:first-child::after {
            content: 'Current Documentation Spend';
            font-size: 0.9rem !important;
            color: #6B7280 !important;
            font-weight: 600 !important;
        }
        
        /* FIX 3: REORDER SECTIONS WITH FLEXBOX */
        .container {
            display: flex;
            flex-direction: column;
        }
        
        .conservative-framing-notice {
            order: -998 !important;
        }
        
        .methodology-notice {
            order: -997 !important;
        }
        
        .profile-summary {
            /* order removed - stays in natural HTML position */
        }
        
        .scaling-insight {
            order: 101 !important;
        }
        
        .insight-callout {
            order: 102 !important;
        }
        
        .task-breakdown {
            order: 50 !important;
        }
        
        .phase1-explainer {
            order: 10 !important;
            border: 4px solid #D4AF37 !important;
            background: linear-gradient(135deg, rgba(212, 175, 55, 0.15), rgba(212, 175, 55, 0.05)) !important;
        }
        
        .reality-check-box {
            order: 5 !important;
        }
        
        /* FIX: CTA SECTION AT THE VERY END */
        .cta-section-end {
            order: 1000 !important;
        }
        
        .back-button-final {
            order: 1001 !important;
        }
        
        /* FIX 4: IMPROVE READABILITY & HIERARCHY */
        .conservative-framing-notice {
            background: #F8F9FA !important;
            border: 1px solid #E5E7EB !important;
            padding: 1rem !important;
        }
        
        .conservative-framing-notice h2 {
            font-size: 1.2rem !important;
            margin-bottom: 0.5rem !important;
        }
        
        .methodology-notice {
            background: transparent !important;
            border-left: 2px solid #E5E7EB !important;
            padding: 0.75rem 1rem !important;
            font-size: 0.85rem !important;
        }
        
        /* FIX 5: IMPROVE CTA VISIBILITY */
        .btn-primary-huge {
            font-size: 1.5rem !important;
            padding: 1.5rem 3rem !important;
            box-shadow: 0 8px 24px rgba(212, 175, 55, 0.4) !important;
            animation: pulse-cta 2s ease-in-out infinite !important;
        }
        
        @keyframes pulse-cta {
            0%, 100% {
                box-shadow: 0 8px 24px rgba(212, 175, 55, 0.4);
            }
            50% {
                box-shadow: 0 12px 32px rgba(212, 175, 55, 0.6);
            }
        }
        
        .btn-primary-huge:hover {
            transform: translateY(-3px) !important;
            box-shadow: 0 16px 40px rgba(212, 175, 55, 0.5) !important;
        }
        
        /* FIX 6: FEATURED TASK HIGHLIGHTING */
        .task-breakdown .task-card:first-child {
            border: 3px solid #D4AF37 !important;
            background: linear-gradient(to bottom, #FFFBF0, white) !important;
            box-shadow: 0 8px 24px rgba(212, 175, 55, 0.2) !important;
        }
        
        .task-breakdown .task-card:first-child::before {
            content: '🎯 HIGHEST ROI';
            display: block;
            background: #D4AF37;
            color: #0B1221;
            font-weight: 700;
            font-size: 0.75rem;
            text-align: center;
            padding: 0.5rem;
            margin: -1.5rem -1.5rem 1rem -1.5rem;
            border-radius: 10px 10px 0 0;
        }
        
        /* FIX 7: IMPROVE METRIC CARDS */
        .metrics-grid {
            order: 998 !important;
            opacity: 0.6;
        }
        
        .metrics-grid:hover {
            opacity: 1;
        }
        
        /* FIX 8: MOBILE RESPONSIVENESS */
        @media (max-width: 768px) {
            .roi-results-grid {
                grid-template-columns: 1fr !important;
            }
            
            .roi-result-card-primary .roi-result-stat {
                font-size: 3rem !important;
            }
            
            .primary-metric {
                font-size: 3rem !important;
            }
            
            .annual-burn-section > div:nth-child(2) {
                font-size: 1.2rem !important;
            }
            
            .btn-primary-huge {
                font-size: 1.2rem !important;
                padding: 1rem 2rem !important;
            }
        }
        
        /* FIX 9: ADD SCROLL HINTS */
        .conservative-framing-notice::after {
            content: '↓ See your top 3 opportunities below';
            display: block;
            text-align: center;
            margin-top: 1rem;
            color: #D4AF37;
            font-weight: 600;
            font-size: 0.9rem;
            animation: bounce 2s ease-in-out infinite;
        }
        
        @keyframes bounce {
            0%, 100% {
                transform: translateY(0);
            }
            50% {
                transform: translateY(-5px);
            }
        }
        
        /* FIX 10: IMPROVE CONSERVATIVE SUMMARY */
        .conservative-summary-box {
            background: linear-gradient(to right, #F0FDF4, white) !important;
            border-left: 4px solid #10B981 !important;
        }
        
        .conservative-summary-box ul {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 0.5rem;
        }
        
        @media (max-width: 768px) {
            .conservative-summary-box ul {
                grid-template-columns: 1fr;
            }
            
            /* CTA Grid Mobile */
            .cta-grid {
                grid-template-columns: 1fr !important;
            }
        }
        
        /* FIX 11: TIER 2 DE-EMPHASIS */
        .tier-2-note {
            opacity: 0.8;
            font-size: 0.9rem !important;
            background: #F8F9FA;
        }
        
        .tier-2-note h4 {
            color: #374151;
            font-weight: 600;
        }
        
        .tier-2-note:hover {
            opacity: 1;
        }
        
        /* FIX 12: IMPROVE STEP INDICATOR */
        .step.active {
            width: 50px !important;
            height: 50px !important;
            font-size: 1.2rem !important;
            box-shadow: 0 4px 12px rgba(212, 175, 55, 0.4) !important;
        }
        
        /* FIX 13: IMPROVE BUTTON HIERARCHY */
        .btn-secondary {
            opacity: 0.6 !important;
            font-size: 0.9rem !important;
        }
        
        .btn-secondary:hover {
            opacity: 1 !important;
        }
        
        /* CTA Section Button Hover Effects */
        .cta-section-end .cta-grid a.btn:hover {
            opacity: 0.9;
            box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);
        }
        
        .cta-section-end .cta-grid a.btn[style*="transparent"]:hover {
            background: rgba(255, 255, 255, 0.08) !important;
            border-color: #D4AF37 !important;
            color: #D4AF37 !important;
        }
    </style>
</head>
<body>
    {% if step == 1 %}
    <!-- Breadcrumb moved outside container -->
    <div class="step-indicator">
        <a href="{{ url_for('roi_calculator.roi_calculator', step=1) }}" class="step active">1</a>
        <span class="step">2</span>
        <span class="step">3</span>
        <span class="step">4</span>
    </div>
    {% endif %}
    
    {% if step == 3 %}
    <!-- Step 3 Breadcrumb - Outside Container -->
    <div class="step-indicator">
        <a href="{{ url_for('roi_calculator.roi_calculator', step=1) }}" class="step completed">1</a>
        <a href="{{ url_for('roi_calculator.roi_calculator', step=2, industry=industry) }}" class="step completed">2</a>
        <span class="step active">3</span>
        <span class="step">4</span>
    </div>
    {% endif %}
    
    <div class="container">
        {% if step == 1 %}
        <h1>Calculate Your Automation ROI</h1>
        <h2>See how much margin you are losing to manual workflows.</h2>
        <hr>
        <h3>Select Your Industry</h3>
        <form method="POST" action="{{ url_for('roi_calculator.roi_calculator') }}">
            <input type="hidden" name="step" value="1">
            <div class="industry-grid">
                {% for industry_name, config in industries.items() %}
                <div class="industry-card {% if selected_industry == industry_name %}selected{% endif %}">
                    <input type="radio" name="industry" value="{{ industry_name }}" id="industry_{{ loop.index }}" 
                           {% if selected_industry == industry_name %}checked{% endif %} 
                           onchange="this.form.submit()" style="display: none;">
                    <label for="industry_{{ loop.index }}" style="cursor: pointer; width: 100%;">
                        <strong>{{ industry_name }}</strong><br>
                        <small>{{ config.context }}</small>
                    </label>
                </div>
                {% endfor %}
            </div>
            {% if selected_industry %}
            <div class="btn-group">
                <button type="submit" name="action" value="continue" class="btn">Continue to Data Entry →</button>
            </div>
            {% endif %}
        </form>
        
        {% elif step == 2 %}
        <h1>Your Firm Profile</h1>
        <h2>We'll calculate savings on proven, repetitive documentation tasks</h2>
        <hr>
        <form method="POST" action="{{ url_for('roi_calculator.roi_calculator') }}">
            <input type="hidden" name="step" value="2">
            <input type="hidden" name="industry" value="{{ industry }}">
            
            <div class="form-group">
                <label>Total Technical Staff 
                    <small style="color: #4B5563; font-weight: normal;">
                        (includes all billable staff - we'll calculate documentation staff from this)
                    </small>
                </label>
                <div class="slider-container">
                    <input type="range" name="staff_count_slider" id="staff_count_slider" 
                           value="{{ staff_count }}" min="10" max="500" step="5">
                    <input type="number" name="staff_count" id="staff_count" 
                           value="{{ staff_count }}" min="10" max="500" step="5" required>
                </div>
                <div id="doc-staff-estimate" style="margin-top: 0.5rem; color: #4B5563; font-size: 0.875rem;">
                    <!-- Auto-populated by JavaScript -->
                </div>
            </div>
            
            <div class="info-callout">
                <h4>💡 What We're Calculating</h4>
                <p>This calculator estimates savings on <strong>proven, repetitive documentation tasks</strong> that we know exist in {{ industry }} firms:</p>
                <ul>
                    <li>Manual transmittal creation and tracking</li>
                    <li>Specification writing from templates</li>
                    <li>Drawing register compilation</li>
                    <li>Other routine documentation</li>
                </ul>
                <p><strong>This is LOW-HANGING FRUIT only.</strong> There may be additional opportunities, but we're showing what we KNOW we can help with based on 80+ similar implementations.</p>
            </div>
            
            <div class="btn-group">
                <a href="{{ url_for('roi_calculator.roi_calculator') }}" class="btn btn-secondary">← Back</a>
                <button type="submit" name="action" value="calculate" class="btn">Calculate Conservative ROI →</button>
            </div>
        </form>
        
        <script>
        function getDocStaffPercentage(totalStaff, basePercentage) {
            // Firm size scaling logic
            if (totalStaff < 20) {
                return Math.min(basePercentage + 0.10, 0.90);
            } else if (totalStaff < 50) {
                return basePercentage;
            } else if (totalStaff < 100) {
                return Math.max(basePercentage - 0.05, 0.65);
            } else {
                return Math.max(basePercentage - 0.10, 0.60);
            }
        }
        
        function updateStaffCalculation(totalStaff) {
            // Industry-specific documentation staff base percentage
            const basePercentage = {{ industry_config.get('doc_staff_percentage_base', 0.75) }};
            
            // Apply firm size scaling
            const scaledPercentage = getDocStaffPercentage(totalStaff, basePercentage);
            
            const docStaff = Math.round(totalStaff * scaledPercentage);
            const nonDocStaff = totalStaff - docStaff;
            const percentDisplay = Math.round(scaledPercentage * 100);
            
            // Determine firm size category
            let firmSize, scalingReason;
            if (totalStaff < 20) {
                firmSize = "Small firm";
                scalingReason = "flat structure, most staff do documentation";
            } else if (totalStaff < 50) {
                firmSize = "Medium firm";
                scalingReason = "typical structure";
            } else if (totalStaff < 100) {
                firmSize = "Large firm";
                scalingReason = "more management, fewer doing documentation";
            } else {
                firmSize = "Very large firm";
                scalingReason = "significant hierarchy";
            }
            
            const estimateDiv = document.getElementById('doc-staff-estimate');
            if (estimateDiv) {
                estimateDiv.innerHTML = `
                    <strong>${firmSize} (${scalingReason}):</strong><br>
                    → ${docStaff} documentation staff (${percentDisplay}%): junior/mid-level coordinators, admin<br>
                    → ${nonDocStaff} senior staff/partners (${100-percentDisplay}%): primarily review/approve<br>
                    <br>
                    <em>We calculate savings based on the ${docStaff} staff who do repetitive documentation work.</em>
                `;
            }
        }
        
        // Sync slider and number input bidirectionally
        document.addEventListener('DOMContentLoaded', function() {
            const staffSlider = document.getElementById('staff_count_slider');
            const staffInput = document.getElementById('staff_count');
            
            if (staffSlider && staffInput) {
                // When slider changes, update number input
                staffSlider.addEventListener('input', function() {
                    staffInput.value = this.value;
                    updateStaffCalculation(parseInt(this.value));
                });
                
                // When number input changes, update slider
                staffInput.addEventListener('input', function() {
                    staffSlider.value = this.value;
                    updateStaffCalculation(parseInt(this.value));
                });
                
                // Initialize on page load
                updateStaffCalculation(parseInt(staffInput.value) || {{ staff_count }});
            }
        });
        </script>
        
        {% endif %}
        
        {% if step == 3 %}
        <div class="conservative-framing-notice">
            <h2>🎯 Your Low-Hanging Fruit Opportunity</h2>
            <p><strong>Conservative Estimate:</strong> This analysis shows savings on <strong>proven, repetitive tasks</strong> that we KNOW exist in {{ industry }} firms. This is the minimum opportunity - there may be additional savings once we analyze YOUR specific workflows in Phase 1.</p>
        </div>
        
        <div class="methodology-notice">
            <p><strong>⚠️ Methodology:</strong> Based on {{ calculations.doc_staff_count }} documentation staff ({{ calculations.doc_staff_percentage|round(0)|int }}% of your {{ calculations.total_staff }} total staff). We estimate these junior/mid-level staff spend ~{{ calculations.hours_per_doc_staff }} hours/week on routine documentation at an average rate of ${{ calculations.typical_doc_rate }}/hr. <strong>Senior staff and partners who only review/approve are excluded.</strong></p>
        </div>
        
        <hr>
        
        <h2>Your Documentation Staff Profile</h2>
        <div class="profile-summary">
            <div class="profile-item">
                <span class="profile-label">Total Technical Staff:</span>
                <span class="profile-value">{{ calculations.total_staff }}</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Firm Size Category:</span>
                <span class="profile-value">{{ calculations.firm_size_category }}</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Documentation Staff:</span>
                <span class="profile-value">{{ calculations.doc_staff_count }} ({{ calculations.doc_staff_percentage|round(0)|int }}%)</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Excluded (Senior/Partners):</span>
                <span class="profile-value">{{ calculations.total_staff - calculations.doc_staff_count }} ({{ (100 - calculations.doc_staff_percentage)|round(0)|int }}%)</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Doc Staff Typical Rate:</span>
                <span class="profile-value">${{ calculations.typical_doc_rate }}/hour</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Hours/Week per Doc Staff:</span>
                <span class="profile-value">{{ calculations.hours_per_doc_staff }} hours</span>
            </div>
            <div class="profile-item">
                <span class="profile-label">Total Documentation Time:</span>
                <span class="profile-value">{{ calculations.total_weekly_hours|round(0)|int }} hours/week firm-wide</span>
            </div>
        </div>
        
        <div class="scaling-insight">
            <h4>📊 Firm Size Adjustment Applied</h4>
            <p><strong>{{ calculations.scaling_note }}</strong></p>
            {% if calculations.firm_size_category == "Small" %}
                <p>In smaller firms (<20 staff), organizational structures are flatter. Most technical staff are involved in documentation because there are fewer specialized administrative roles. We've adjusted the documentation staff percentage <strong>upward</strong> to {{ calculations.doc_staff_percentage|round(0)|int }}% (from {{ calculations.base_doc_staff_percentage|round(0)|int }}% industry baseline).</p>
            {% elif calculations.firm_size_category == "Medium" %}
                <p>Your firm size represents typical industry structure. We're using the baseline {{ calculations.doc_staff_percentage|round(0)|int }}% for documentation staff in {{ industry }}.</p>
            {% elif calculations.firm_size_category == "Large" %}
                <p>In larger firms (50-100 staff), there are more management layers and specialized roles. Senior staff and team leads spend proportionally less time on manual documentation. We've adjusted the documentation staff percentage <strong>downward</strong> to {{ calculations.doc_staff_percentage|round(0)|int }}% (from {{ calculations.base_doc_staff_percentage|round(0)|int }}% industry baseline).</p>
            {% else %}
                <p>In very large firms (100+ staff), organizational hierarchy is significant. Senior staff, principals, and managers form a substantial portion of headcount but primarily focus on oversight and client relationships. We've adjusted the documentation staff percentage <strong>downward</strong> to {{ calculations.doc_staff_percentage|round(0)|int }}% (from {{ calculations.base_doc_staff_percentage|round(0)|int }}% industry baseline).</p>
            {% endif %}
        </div>
        
        <div class="insight-callout">
            <h4>💡 Why We Focus on Documentation Staff</h4>
            <p>Partners and senior staff ({{ calculations.total_staff - calculations.doc_staff_count }} people in your firm) primarily review and approve work - they don't spend significant time on <strong>repetitive manual tasks</strong> like data entry, formatting, or compilation.</p>
            <p>The {{ calculations.doc_staff_count }} documentation staff (coordinators, junior/mid-level engineers, admin) are where the automation opportunity exists. <strong>These are conservative estimates based on proven implementations.</strong></p>
        </div>
        <hr>
        <!-- BIG SCARY NUMBER -->
        <div class="annual-burn-section" style="background: linear-gradient(135deg, #0B1221, #1a2332); border-radius: 16px; padding: 3rem 2rem; text-align: center; margin: 2rem 0; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);">
            <div style="color: #D4AF37; font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">Estimated Annual Documentation Cost</div>
            <div style="font-size: 4rem; font-weight: 800; background: linear-gradient(135deg, #D4AF37, #FFD700); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-bottom: 1rem; line-height: 1;">{{ format_currency(calculations.annual_burn) }}</div>
            <div style="color: rgba(255, 255, 255, 0.7); font-size: 0.95rem; font-style: italic;">Based on your inputs</div>
        </div>
        
        <hr>
        
        <h2>Proven Low-Hanging Fruit Tasks</h2>
        <p class="section-subhead">These are repetitive tasks we KNOW exist in {{ industry }} firms and have proven automation success:</p>
        
        <p style="background: #EFF6FF; border-left: 4px solid #3B82F6; padding: 1rem 1.5rem; border-radius: 0 8px 8px 0; font-weight: 600; color: #1E40AF; margin-bottom: 1.5rem;">
            💡 We've analyzed all 5 tasks and ranked them by ROI potential. Your #1 quick-win opportunity is highlighted below.
        </p>
        
        <div class="task-breakdown">
            {% if calculations.get('task_analysis') %}
                {% for task in calculations.task_analysis %}
                <div class="task-card {% if task.is_low_hanging_fruit %}task-card-highlight{% endif %}">
                    <div class="task-header">
                        <h3>
                            {{ task.name }} 
                            <span class="complexity-badge complexity-{{ task.complexity }}">
                                [{{ task.complexity }}/10]
                            </span>
                            {% if task.is_low_hanging_fruit %}
                            <span class="roi-badge">🎯 LOW-HANGING FRUIT</span>
                            {% endif %}
                            {% if task.requires_phase_1 %}
                            <span class="validation-badge">⚠️ NEEDS VALIDATION</span>
                            {% endif %}
                        </h3>
                    </div>
                    <div class="task-details">
                        <div class="task-stat">
                            <span class="stat-label">Estimated Time:</span>
                            <span class="stat-value">{{ task.hours_per_week|round(1) }} hrs/week ({{ task.percentage_of_total|round(0)|int }}% of doc time)</span>
                        </div>
                        <div class="task-stat">
                            <span class="stat-label">Description:</span>
                            <span class="stat-value">{{ task.description }}</span>
                        </div>
                        <div class="task-stat">
                            <span class="stat-label">Automation Potential (Lab Testing):</span>
                            <span class="stat-value">{{ (task.automation_potential * 100)|round(0)|int }}%</span>
                        </div>
                        <div class="task-stat">
                            <span class="stat-label">Proven Success Rate:</span>
                            <span class="stat-value">{{ (task.proven_success_rate * 100)|round(0)|int }}% of implementations succeed</span>
                        </div>
                        <div class="task-stat">
                            <span class="stat-label">Conservative Estimate:</span>
                            <span class="stat-value">{{ (task.conservative_potential * 100)|round(0)|int }}% (potential × success rate)</span>
                        </div>
                        <div class="task-stat">
                            <span class="stat-label">Recoverable Time:</span>
                            <span class="stat-value">{{ task.recoverable_hours_per_week|round(1) }} hrs/week</span>
                        </div>
                        <div class="task-stat">
                            <span class="stat-label">Minimum Annual Value:</span>
                            <span class="stat-value">${{ "{:,.0f}".format(task.annual_savings) }}</span>
                        </div>
                    </div>
                    {% if task.requires_phase_1 %}
                    <div class="task-warning">
                        <strong>⚠️ Validation Required:</strong> This task requires human judgment. Phase 1 will test if YOUR specific documents are suitable for automation.
                    </div>
                    {% endif %}
                </div>
                {% endfor %}
            {% else %}
                <p>Task breakdown not available for this industry.</p>
            {% endif %}
        </div>
        
        <hr>
        
        <h2>Conservative Opportunity Summary</h2>
        
        <div class="conservative-summary-box">
            <p><strong>What This Represents:</strong></p>
            <ul>
                <li>✅ Proven repetitive tasks (not aspirational)</li>
                <li>✅ Conservative automation rates (actual success rates applied)</li>
                <li>✅ Documentation staff only (excludes senior/partners)</li>
                <li>✅ Low-hanging fruit (quick wins, not total transformation)</li>
            </ul>
            <p><strong>What This DOESN'T Include:</strong></p>
            <ul>
                <li>❌ Additional tasks we haven't identified yet</li>
                <li>❌ Workflow improvements beyond automation</li>
                <li>❌ Time savings for senior staff (review/approval time)</li>
                <li>❌ Aspirational "maximum potential" scenarios</li>
            </ul>
        </div>
        
        <div class="roi-result-grid">
            <div class="roi-result-card">
                <div class="roi-result-stat">${{ "{:,.0f}".format(calculations.get('annual_cost', calculations.get('annual_burn', 0))) }}</div>
                <div class="roi-result-label">Annual Documentation Cost</div>
                <p class="roi-result-description">{{ calculations.doc_staff_count }} doc staff × {{ calculations.hours_per_doc_staff }} hrs/week × ${{ calculations.typical_doc_rate }}/hr</p>
            </div>
            
            <div class="roi-result-card roi-result-card-primary">
                <div class="roi-result-stat">${{ "{:,.0f}".format(calculations.get('proven_tier_1_savings', calculations.get('tier_1_savings', 0))) }}</div>
                <div class="roi-result-label">Proven Low-Hanging Fruit ({{ (calculations.weighted_potential * 100)|round(0)|int }}%)</div>
                <p class="roi-result-description"><strong>Conservative estimate</strong> on tasks we KNOW we can automate</p>
            </div>
            
            <div class="roi-result-card">
                <div class="roi-result-stat">{{ calculations.get('total_recoverable_hours', calculations.get('total_recoverable_hours_per_week', 0))|round(0)|int }}</div>
                <div class="roi-result-label">Hours Recoverable per Week</div>
                <p class="roi-result-description">Time that can be redirected to billable work</p>
            </div>
            
            <div class="roi-result-card">
                <div class="roi-result-stat">${{ "{:,.0f}".format(calculations.get('potential_revenue', 0)) }}</div>
                <div class="roi-result-label">Revenue Opportunity</div>
                <p class="roi-result-description">If recovered hours are billed to clients</p>
            </div>
        </div>
        
        <div class="tier-2-note">
            <h4>📈 Tier 2 Opportunity: ${{ "{:,.0f}".format(calculations.get('tier_2_savings', 0)) }}</h4>
            <p>With expanded automation and workflow optimization (typically 12-18 months), firms achieve {{ (calculations.get('tier_2_potential', 0.70) * 100)|round(0)|int }}% efficiency gains. <strong>But let's prove Phase 1 first.</strong></p>
        </div>
        
        <div class="complexity-legend">
            <h3>What do the complexity scores mean?</h3>
            <div class="legend-grid">
                <div class="legend-item">
                    <span class="complexity-badge complexity-8">[8-10]</span>
                    <strong>High Complexity = High Automation Potential</strong>
                    <p>Highly repetitive, rule-based tasks with structured formats. 50-55% of work can be automated.</p>
                </div>
                <div class="legend-item">
                    <span class="complexity-badge complexity-5">[5-7]</span>
                    <strong>Medium Complexity = Moderate Automation Potential</strong>
                    <p>Semi-structured tasks with some judgment required. 40-48% of work can be automated.</p>
                </div>
                <div class="legend-item">
                    <span class="complexity-badge complexity-3">[1-4]</span>
                    <strong>Low Complexity = Lower Automation Potential</strong>
                    <p>Requires significant human judgment. 30-40% of work can be automated.</p>
                </div>
            </div>
            <p><em>Higher complexity scores indicate better targets for automation—these are your Phase 1 priorities.</em></p>
        </div>
        
        <!-- REALITY CHECK BOX -->
        <div class="reality-check-box" style="background: linear-gradient(135deg, rgba(255, 165, 0, 0.1), rgba(255, 165, 0, 0.05)); border: 2px solid rgba(255, 165, 0, 0.4); border-radius: 12px; padding: 2rem; margin: 2rem 0;">
            <h3 style="color: #FF8C00; font-size: 1.5rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">⚠️ Important: This is an ESTIMATE</h3>
            <p style="color: #4B5563; font-size: 1rem; line-height: 1.7; margin-bottom: 1rem;">
                This calculator uses <strong style="color: #0B1221;">industry averages</strong> and 
                <strong style="color: #0B1221;">generic assumptions</strong>. We don't actually know:
            </p>
            <ul style="list-style: none; padding: 0; margin: 1rem 0;">
                <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; color: #4B5563; line-height: 1.6;">
                    <span style="position: absolute; left: 0; color: #FF8C00; font-weight: 700;">✗</span>
                    How YOUR firm actually works (your unique workflows and processes)
                </li>
                <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; color: #4B5563; line-height: 1.6;">
                    <span style="position: absolute; left: 0; color: #FF8C00; font-weight: 700;">✗</span>
                    Which of YOUR tasks can realistically be automated (vs require human judgment)
                </li>
                <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; color: #4B5563; line-height: 1.6;">
                    <span style="position: absolute; left: 0; color: #FF8C00; font-weight: 700;">✗</span>
                    Whether YOUR documents are suitable for AI extraction (format, quality, complexity)
                </li>
                <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; color: #4B5563; line-height: 1.6;">
                    <span style="position: absolute; left: 0; color: #FF8C00; font-weight: 700;">✗</span>
                    If YOUR staff will adopt new workflows (change management is the #1 risk)
                </li>
                <li style="padding: 0.5rem 0; padding-left: 1.5rem; position: relative; color: #4B5563; line-height: 1.6;">
                    <span style="position: absolute; left: 0; color: #FF8C00; font-weight: 700;">✗</span>
                    What YOUR specific baseline efficiency is (you might already be more efficient than average)
                </li>
            </ul>
            <div style="background: white; padding: 1rem; border-radius: 8px; border-left: 4px solid #FF8C00; margin-top: 1rem; font-weight: 600; color: #0B1221;">
                That's why Phase 1 exists: to replace these guesses with proof using YOUR actual documents.
            </div>
        </div>
        
        <!-- Utilization Disclaimer -->
        <p class="disclaimer" style="font-size: 0.9em; color: #cbd5e1; margin-bottom: 20px; padding: 1rem; background: rgba(203, 213, 225, 0.1); border-left: 3px solid #cbd5e1; border-radius: 6px;">
            *Assumes 70% of recovered time converts to billable work. Actual results depend on 
            firm capacity and client demand.
        </p>
        
        <hr>
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">{{ format_currency(calculations.annual_burn) }}</div>
                <div class="metric-label">Annual Revenue Leakage</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{{ format_currency(calculations.tier_1_savings) }}</div>
                <div class="metric-label">Tier 1 Opportunity</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{{ "{:,.0f}".format(calculations.capacity_hours) }}</div>
                <div class="metric-label">Capacity Hours</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{{ format_currency(calculations.potential_revenue) }}</div>
                <div class="metric-label">Revenue Opportunity</div>
            </div>
        </div>
        <hr>
        {% if industry == "Accounting & Advisory" %}
        <!-- Phase 1 Proof → Year 1 Revenue for Accounting -->
        <h2 class="section-headline">Phase 1 Proof → Year 1 Revenue</h2>
        <p class="section-subhead">Real results from $1,500 Feasibility Sprints (scales firm-wide)</p>
        
        <div class="roi-results-grid">
            <div class="roi-result-card">
                <div class="roi-result-stat">40+</div>
                <div class="roi-result-label">Hours saved per month</div>
                <p class="roi-result-description">Average time recovered from document processing automation</p>
            </div>
            
            <div class="roi-result-card">
                <div class="roi-result-stat">95%</div>
                <div class="roi-result-label">Extraction accuracy</div>
                <p class="roi-result-description">Validated benchmark achieved in Phase 1 testing</p>
            </div>
            
            <div class="roi-result-card">
                <div class="roi-result-stat">6-12</div>
                <div class="roi-result-label">Month payback period</div>
                <p class="roi-result-description">Typical ROI timeline for full implementation</p>
            </div>
            
            <div class="roi-result-card">
                <div class="roi-result-stat">$500k+</div>
                <div class="roi-result-label">Year 1 Revenue (15-staff firms)</div>
                <p class="roi-result-description">Proven from $80k Phase 1 trust recon wins</p>
            </div>
        </div>
        
        <div class="highlight-box footnote">
            <p><strong>Phase 1 ($1,500):</strong> $80k trust recon proof → <strong>Phases 2-4:</strong> $420k+ from GL coding, inter-entity matching</p>
        </div>
        <hr>
        {% endif %}
        
        <!-- PHASE 1 EXPLAINER (UNIVERSAL) -->
        {% set demo_docs = industry_config.get('demo_documents', 'your documents') if industry_config else 'your documents' %}
        <div class="phase1-explainer" style="background: linear-gradient(135deg, rgba(212, 175, 55, 0.1), rgba(212, 175, 55, 0.05)); border: 2px solid rgba(212, 175, 55, 0.3); border-radius: 12px; padding: 2.5rem; margin: 3rem 0;">
            <h2 style="color: #0B1221; font-size: 2rem; margin-bottom: 1.5rem; text-align: center;">Replace This Estimate With Proof: $1,500 Feasibility Sprint</h2>
            
            <div class="phase1-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin: 2rem 0;">
                <div class="phase1-column" style="background: white; border-radius: 8px; padding: 1.5rem; border: 1px solid #E5E7EB;">
                    <h4 style="color: #0B1221; font-size: 1.1rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">📋 What We'll Test (48 hours):</h4>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6; border-bottom: 1px solid #F8F9FA;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            15 of YOUR documents (including 5 receipts, plus {{ demo_docs }})
                        </li>
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6; border-bottom: 1px solid #F8F9FA;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            AI extraction accuracy on YOUR specific document formats
                        </li>
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6; border-bottom: 1px solid #F8F9FA;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            Time savings based on YOUR baseline process (not industry averages)
                        </li>
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            Integration feasibility with YOUR systems
                        </li>
                    </ul>
                </div>
                
                <div class="phase1-column" style="background: white; border-radius: 8px; padding: 1.5rem; border: 1px solid #E5E7EB;">
                    <h4 style="color: #0B1221; font-size: 1.1rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">✅ What You Get:</h4>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6; border-bottom: 1px solid #F8F9FA;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            Accuracy report showing extraction results on your docs
                        </li>
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6; border-bottom: 1px solid #F8F9FA;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            ROI calculation using YOUR data (not generic estimates)
                        </li>
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6; border-bottom: 1px solid #F8F9FA;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            Feasibility assessment: "Will this work for us?"
                        </li>
                        <li style="padding: 0.75rem 0; padding-left: 2rem; position: relative; color: #4B5563; font-size: 0.95rem; line-height: 1.6;">
                            <span style="position: absolute; left: 0; color: #4CAF50; font-weight: 700;">✓</span>
                            Decision point: Proceed to Phase 2 or walk away with full refund
                        </li>
                    </ul>
                </div>
            </div>
            
            <!-- Guarantee Box -->
            <div class="guarantee-box" style="background: white; border: 2px solid #4CAF50; border-radius: 12px; padding: 2rem; margin: 2rem 0;">
                <h4 style="color: #4CAF50; font-size: 1.3rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">🛡️ Zero-Risk Guarantee:</h4>
                <p style="color: #4B5563; font-size: 1rem; line-height: 1.7; margin-bottom: 1rem;">
                    If we don't achieve <strong style="color: #0B1221;">90%+ accuracy</strong> on your documents, 
                    you get a <strong style="color: #0B1221;">full refund</strong>. No questions asked. No fine print.
                </p>
                <div style="font-size: 0.9rem; color: #6B7280; background: #F8F9FA; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                    <strong>Only condition:</strong> You provide 30 {% if industry_config.demo_documents %}{{ industry_config.demo_documents }}{% else %}documents{% endif %} and respond 
                    to clarification questions promptly. We can't test if you don't participate.
                </div>
            </div>
            
            <!-- PRIMARY CTA -->
            <div class="primary-cta-section" style="text-align: center; margin: 3rem 0; padding: 2rem; background: white; border-radius: 12px; border: 2px solid #D4AF37;">
                <a href="/contact" class="btn-primary-huge" style="display: inline-block; background: linear-gradient(135deg, #D4AF37, #B8941F); color: #0B1221; font-size: 1.3rem; font-weight: 700; padding: 1.25rem 3rem; border-radius: 8px; text-decoration: none; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);">
                    Book $1,500 Feasibility Test →
                </a>
                <p style="margin-top: 1rem; color: #4B5563; font-size: 0.95rem; font-style: italic;">
                    3 hours of your time. 48-hour turnaround. Full refund if accuracy <90%.
                </p>
            </div>
        </div>
        
        <h3>Your Cost Reduction Roadmap</h3>
        <p style="color: #6B7280; font-size: 0.95rem; margin-bottom: 1rem;">
            Annual documentation costs after each automation phase (bars show remaining cost):
        </p>
        <div class="chart-container">
            <div id="chart"></div>
        </div>
        <h3>Analysis</h3>
        {% if analysis_text|length > 0 %}
        <div class="analysis-row">
            {% for analysis in analysis_text %}
            <div class="analysis-box">{{ analysis|safe }}</div>
            {% endfor %}
        </div>
        {% endif %}
        <hr>
        
        <!-- AI Opportunity Heatmap -->
        <div class="heatmap-container">
            <h3>🎯 Your AI Automation Opportunities</h3>
            <p style="color: #4B5563; margin-bottom: 1rem;">Specific tasks in your industry with high automation potential:</p>
            <table class="heatmap-table">
                <thead>
                    <tr>
                        <th>Task</th>
                        <th>AI Potential</th>
                        <th>Time per Week</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    {% for task in ai_opportunities %}
                    <tr>
                        <td><strong>{{ task.task }}</strong></td>
                        <td>
                            {% if task.potential == 'HIGH' %}
                            <span class="potential-badge potential-high">🔥 HIGH</span>
                            {% elif task.potential == 'MEDIUM' %}
                            <span class="potential-badge potential-medium">🟡 MEDIUM</span>
                            {% else %}
                            <span class="potential-badge potential-low">🟢 LOW</span>
                            {% endif %}
                        </td>
                        <td>{{ task.hours_per_week }} hrs/week</td>
                        <td style="color: #4B5563; font-size: 0.9rem;">{{ task.description }}</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
            <p style="margin-top: 1rem; color: #4B5563; font-size: 0.9rem;"><strong>💡 High-potential tasks</strong> = Best ROI for automation investment</p>
        </div>
        <hr>
        
        <!-- Custom Automation Roadmap -->
        <div class="roadmap-container">
            <h3>🚀 Your Recommended Automation Roadmap</h3>
            {% for phase in roadmap %}
            <div class="roadmap-phase">
                <h4>{{ phase.name }} ({{ phase.weeks }})</h4>
                <ul>
                    <li><strong>Automate:</strong> {{ phase.task }}</li>
                    <li><strong>Time Saved:</strong> {{ "{:,.0f}".format(phase.hours_per_year) }} hours/year</li>
                    <li><strong>Revenue Reclaimed:</strong> {{ format_currency(phase.revenue_reclaimed) }}/year</li>
                    {% if phase.phase == 1 %}
                    <li><strong>Payback:</strong> {{ phase.payback }}</li>
                    {% else %}
                    <li><strong>Cumulative Savings:</strong> {{ format_currency(phase.cumulative_savings) }}/year</li>
                    {% endif %}
                </ul>
            </div>
            {% endfor %}
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #E5E7EB;">
                <p style="color: #4B5563; margin-bottom: 1rem;"><strong>💡 Most firms see ROI by end of Phase 1</strong></p>
                <div class="btn-group">
                    <a href="{{ booking_url }}" class="btn">📞 Book Consultation Call</a>
                </div>
            </div>
        </div>
        <hr>
        <div class="explanation-box">
            <h4>How These Numbers Are Calculated</h4>
            <p><strong>Annual Revenue Leakage (Efficiency Loss):</strong></p>
            <p>This represents the total cost of wasted time spent on manual administrative tasks. Calculated as:</p>
            <ul>
                <li><strong>Staff Count</strong> × <strong>Weekly Waste Hours</strong> × <strong>Billable Rate</strong> × <strong>48 weeks</strong></li>
                <li>Example: 50 staff × 5 hours/week × $185/hour × 48 weeks = $2,220,000 annually</li>
            </ul>
            <p><strong>Capacity Hours:</strong></p>
            <p>The total billable hours currently lost to non-billable administrative work:</p>
            <ul>
                <li><strong>Staff Count</strong> × <strong>Weekly Waste Hours</strong> × <strong>48 weeks</strong></li>
                <li>Example: 50 staff × 5 hours/week × 48 weeks = 12,000 hours/year</li>
            </ul>
            <p><strong>Potential Revenue Opportunity:</strong></p>
            <p>If these hours were freed up and could be billed to clients:</p>
            <ul>
                <li><strong>Capacity Hours</strong> × <strong>Billable Rate</strong></li>
                <li>Example: 12,000 hours × $185/hour = $2,220,000 in potential revenue</li>
            </ul>
            <p><strong>Tier 1 Opportunity (Immediate Opportunity - {{ tier1_percentage }}% Reduction):</strong></p>
            <p>A conservative estimate assuming {{ tier1_percentage }}% reduction in administrative time through Phase 1 automation (e.g., automated data extraction, document processing):</p>
            <ul>
                <li><strong>Annual Revenue Leakage</strong> × <strong>{{ tier1_percentage }}%</strong></li>
                <li>This represents the "low-hanging fruit" - quick wins that can be implemented in the first 3-6 months</li>
            </ul>
            <p><strong>Tier 2 Opportunity (Expanded Automation - 70% Reduction):</strong></p>
            <p>Further automation and workflow optimization, expanding beyond initial use cases:</p>
            <ul>
                <li><strong>Annual Revenue Leakage</strong> × <strong>70%</strong></li>
                <li>Includes Tier 1 benefits plus advanced automation, process redesign, and integration across systems</li>
                <li>Typically achieved within 12-18 months of implementation</li>
            </ul>
            <p><strong>Why This Matters:</strong></p>
            <p>These numbers reveal hidden costs in your organization. Every hour spent on manual data entry, document formatting, or repetitive administrative tasks is an hour that could be:</p>
            <ul>
                <li><strong>Billed to clients</strong> - directly increasing revenue</li>
                <li><strong>Spent on strategic work</strong> - improving project quality and client satisfaction</li>
                <li><strong>Invested in growth</strong> - allowing you to take on more projects without hiring</li>
            </ul>
            <p>Automation doesn't just save time—it unlocks capacity that can be redirected to revenue-generating activities, giving you a competitive advantage and improving your bottom line.</p>
        </div>
        
        <!-- NEXT STEPS CTA SECTION -->
        <div class="cta-section-end" style="background: linear-gradient(135deg, #0B1221, #1a2332); border-radius: 16px; padding: 3rem 2rem; margin: 3rem 0; text-align: center;">
            <h2 style="color: #D4AF37; font-size: 2rem; margin-bottom: 1rem;">Ready to Prove This Works?</h2>
            <p style="color: rgba(255, 255, 255, 0.9); font-size: 1.1rem; max-width: 600px; margin: 0 auto 2rem auto; line-height: 1.6;">
                This calculator shows <strong>${{ "{:,.0f}".format(calculations['tier_1_savings']) }} in potential savings</strong> based on industry averages. 
                Want to test this on YOUR actual documents?
            </p>
            
            <div class="cta-grid" style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; max-width: 900px; margin: 0 auto;">
                <!-- Email me the report Button -->
                <button onclick="emailPhase1Report()" class="btn" style="background: linear-gradient(135deg, #D4AF37, #B8941F); color: #0B1221; padding: 1rem 2rem; font-size: 1rem; font-weight: 600; border-radius: 8px; text-decoration: none; transition: all 0.2s ease; border: 1px solid #D4AF37; cursor: pointer;">
                    Email me the report
                </button>
                
                <!-- See It In Action Button -->
                <a href="/contact.html?option=phase-1" class="btn" style="background: transparent; color: rgba(255, 255, 255, 0.9); padding: 1rem 2rem; font-size: 1rem; font-weight: 600; border-radius: 8px; text-decoration: none; transition: all 0.2s ease; border: 2px solid rgba(255, 255, 255, 0.3);">
                    See It In Action
                </a>
                
                <!-- Request Information Button -->
                <a href="/feasibility-preview.html" class="btn" style="background: transparent; color: rgba(255, 255, 255, 0.9); padding: 1rem 2rem; font-size: 1rem; font-weight: 600; border-radius: 8px; text-decoration: none; transition: all 0.2s ease; border: 2px solid rgba(255, 255, 255, 0.3);">
                    Request Information
                </a>
            </div>
            
            <!-- Email Modal for Phase-1 Report -->
            <div id="phase1EmailModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
                <div style="background: white; padding: 2rem; border-radius: 12px; max-width: 500px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
                    <h3 style="color: #0B1221; margin-top: 0; margin-bottom: 0.5rem;">Email Phase-1 Report</h3>
                    <p style="color: #4B5563; margin-bottom: 1.5rem;">Enter your email address to receive the Phase-1 Feasibility Sprint PDF report.</p>
                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label for="phase1EmailInput" style="display: block; color: #0B1221; font-weight: 600; margin-bottom: 0.5rem;">Email Address</label>
                        <input type="email" id="phase1EmailInput" placeholder="your.email@company.com" style="width: 100%; padding: 0.75rem; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 1rem; box-sizing: border-box;" required>
                    </div>
                    <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                        <button onclick="closePhase1EmailModal()" style="background: #E5E7EB; color: #4B5563; border: none; border-radius: 6px; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 600; cursor: pointer;">
                            Cancel
                        </button>
                        <button onclick="sendPhase1Email()" style="background: #D4AF37; color: #0B1221; border: none; border-radius: 6px; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 600; cursor: pointer;">
                            📧 Send Report
                        </button>
                    </div>
                    <div id="phase1EmailError" style="display: none; color: #DC2626; background: #FEE2E2; padding: 0.75rem; border-radius: 6px; margin-top: 1rem; font-size: 0.9rem;"></div>
                </div>
            </div>
            
            <!-- Success Modal for Phase-1 Report -->
            <div id="phase1SuccessModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
                <div style="background: white; padding: 2rem; border-radius: 12px; max-width: 450px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.2); text-align: center;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">✅</div>
                    <h3 style="color: #0B1221; margin-top: 0; margin-bottom: 0.5rem;">Report Sent Successfully!</h3>
                    <p id="phase1SuccessMessage" style="color: #4B5563; margin-bottom: 1.5rem;">Check your inbox for the Phase-1 Feasibility Sprint PDF.</p>
                    <button onclick="closePhase1SuccessModal()" style="background: #D4AF37; color: #0B1221; border: none; border-radius: 6px; padding: 0.75rem 2rem; font-size: 1rem; font-weight: 600; cursor: pointer;">
                        Got it!
                    </button>
                </div>
            </div>
            
            <script>
            function emailPhase1Report() {
                document.getElementById('phase1EmailModal').style.display = 'flex';
                document.getElementById('phase1EmailInput').focus();
            }
            
            function closePhase1EmailModal() {
                document.getElementById('phase1EmailModal').style.display = 'none';
                document.getElementById('phase1EmailInput').value = '';
                document.getElementById('phase1EmailError').style.display = 'none';
            }
            
            function closePhase1SuccessModal() {
                document.getElementById('phase1SuccessModal').style.display = 'none';
            }
            
            function sendPhase1Email() {
                const emailInput = document.getElementById('phase1EmailInput');
                const email = emailInput.value.trim();
                const errorDiv = document.getElementById('phase1EmailError');
                const sendBtn = document.querySelector('#phase1EmailModal button[onclick="sendPhase1Email()"]');
                
                // Basic validation
                if (!email) {
                    errorDiv.textContent = 'Please enter an email address.';
                    errorDiv.style.display = 'block';
                    return;
                }
                
                if (!email.includes('@') || !email.includes('.')) {
                    errorDiv.textContent = 'Please enter a valid email address.';
                    errorDiv.style.display = 'block';
                    return;
                }
                
                // Hide error and disable button
                errorDiv.style.display = 'none';
                const originalText = sendBtn.textContent;
                sendBtn.textContent = 'Sending...';
                sendBtn.disabled = true;
                
                // Send email
                fetch('{{ url_for("roi_calculator.email_phase1_report") }}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        email: email
                    })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        closePhase1EmailModal();
                        document.getElementById('phase1SuccessMessage').textContent = 'The Phase-1 Feasibility Sprint report has been sent to ' + email;
                        document.getElementById('phase1SuccessModal').style.display = 'flex';
                    } else {
                        errorDiv.textContent = data.error || 'Failed to send email. Please try again.';
                        errorDiv.style.display = 'block';
                        sendBtn.textContent = originalText;
                        sendBtn.disabled = false;
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    errorDiv.textContent = 'Network error. Please check your connection and try again.';
                    errorDiv.style.display = 'block';
                    sendBtn.textContent = originalText;
                    sendBtn.disabled = false;
                });
            }
            
            // Allow Enter key to submit
            document.addEventListener('DOMContentLoaded', function() {
                const emailInput = document.getElementById('phase1EmailInput');
                if (emailInput) {
                    emailInput.addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            sendPhase1Email();
                        }
                    });
                }
            });
            
            // Close modal on outside click
            const phase1Modal = document.getElementById('phase1EmailModal');
            if (phase1Modal) {
                phase1Modal.addEventListener('click', function(e) {
                    if (e.target === this) {
                        closePhase1EmailModal();
                    }
                });
            }
            
            const phase1SuccessModal = document.getElementById('phase1SuccessModal');
            if (phase1SuccessModal) {
                phase1SuccessModal.addEventListener('click', function(e) {
                    if (e.target === this) {
                        closePhase1SuccessModal();
                    }
                });
            }
            </script>
            
            <p style="color: rgba(255, 255, 255, 0.7); font-size: 0.9rem; margin-top: 2rem;">
                90%+ accuracy guarantee • Full refund if we miss the target • 48-hour turnaround
            </p>
        </div>

        <!-- Back Button -->
        <div class="btn-group back-button-final" style="justify-content: center; margin-top: 2rem;">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=2, industry=industry) }}" class="btn btn-secondary" style="opacity: 0.6;">← Adjust Your Inputs</a>
        </div>
        <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
        <script>
            var chartData = {{ chart_json|safe }};
            Plotly.newPlot('chart', chartData.data, chartData.layout);
            
            // Scroll indicator functionality
            function scrollToNext() {
                window.scrollBy({
                    top: window.innerHeight * 0.8,
                    behavior: 'smooth'
                });
            }
            
            function updateScrollIndicator() {
                var indicator = document.getElementById('scrollIndicator');
                if (!indicator) return;
                
                var windowHeight = window.innerHeight;
                var documentHeight = document.documentElement.scrollHeight;
                var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                
                // Show indicator if there's more content below and user hasn't scrolled to bottom
                if (documentHeight > windowHeight && scrollTop < documentHeight - windowHeight - 100) {
                    indicator.classList.add('visible');
                } else {
                    indicator.classList.remove('visible');
                }
            }
            
            // Update scroll indicator on scroll and load
            window.addEventListener('scroll', updateScrollIndicator);
            window.addEventListener('load', updateScrollIndicator);
            window.addEventListener('resize', updateScrollIndicator);
            
        </script>
        
        {% elif step == 4 %}
        <div class="step-indicator">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=1) }}" class="step completed">1</a>
            <a href="{{ url_for('roi_calculator.roi_calculator', step=2, industry=industry) }}" class="step completed">2</a>
            <a href="{{ url_for('roi_calculator.roi_calculator', step=3) }}" class="step completed">3</a>
            <span class="step active">4</span>
        </div>
        <h1>Get Your Business Case Report</h1>
        <hr>
        <h3>Your ROI Report is Ready</h3>
        <p>Enter your email address below to receive your personalized ROI Business Case PDF report.</p>
        <div class="btn-group">
            <button onclick="emailPDF()" style="background: #D4AF37; color: #0B1221; padding: 16px 32px; border: none; border-radius: 8px; cursor: pointer; font-size: 1.1rem; font-weight: 700; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: all 0.3s ease;">
                📧 Email Report to Me
            </button>
        </div>
        
        <!-- Email Modal -->
        <div id="emailModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
            <div style="background: white; padding: 2rem; border-radius: 12px; max-width: 500px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
                <h3 style="color: #0B1221; margin-top: 0; margin-bottom: 0.5rem;">Email Your ROI Report</h3>
                <p style="color: #4B5563; margin-bottom: 1.5rem;">Enter your email address to receive your personalized ROI Business Case PDF.</p>
                <div class="form-group" style="margin-bottom: 1.5rem;">
                    <label for="emailInput" style="display: block; color: #0B1221; font-weight: 600; margin-bottom: 0.5rem;">Email Address</label>
                    <input type="email" id="emailInput" placeholder="your.email@company.com" style="width: 100%; padding: 0.75rem; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 1rem; box-sizing: border-box;" required>
                </div>
                <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                    <button onclick="closeEmailModal()" style="background: #E5E7EB; color: #4B5563; border: none; border-radius: 6px; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 600; cursor: pointer;">
                        Cancel
                    </button>
                    <button onclick="sendEmail()" style="background: #D4AF37; color: #0B1221; border: none; border-radius: 6px; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 600; cursor: pointer;">
                        📧 Send Report
                    </button>
                </div>
                <div id="emailError" style="display: none; color: #DC2626; background: #FEE2E2; padding: 0.75rem; border-radius: 6px; margin-top: 1rem; font-size: 0.9rem;"></div>
            </div>
        </div>
        
        <!-- Success Modal -->
        <div id="successModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
            <div style="background: white; padding: 2rem; border-radius: 12px; max-width: 450px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.2); text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">✅</div>
                <h3 style="color: #0B1221; margin-top: 0; margin-bottom: 0.5rem;">Report Sent Successfully!</h3>
                <p id="successMessage" style="color: #4B5563; margin-bottom: 1.5rem;">Check your inbox for your ROI Business Case PDF.</p>
                <button onclick="closeSuccessModal()" style="background: #D4AF37; color: #0B1221; border: none; border-radius: 6px; padding: 0.75rem 2rem; font-size: 1rem; font-weight: 600; cursor: pointer;">
                    Got it!
                </button>
            </div>
        </div>
        
        <script>
        function emailPDF() {
            document.getElementById('emailModal').style.display = 'flex';
            document.getElementById('emailInput').focus();
        }
        
        function closeEmailModal() {
            document.getElementById('emailModal').style.display = 'none';
            document.getElementById('emailInput').value = '';
            document.getElementById('emailError').style.display = 'none';
        }
        
        function closeSuccessModal() {
            document.getElementById('successModal').style.display = 'none';
        }
        
        function sendEmail() {
            const emailInput = document.getElementById('emailInput');
            const email = emailInput.value.trim();
            const errorDiv = document.getElementById('emailError');
            
            // Basic validation
            if (!email) {
                errorDiv.textContent = 'Please enter an email address.';
                errorDiv.style.display = 'block';
                return;
            }
            
            if (!email.includes('@') || !email.includes('.')) {
                errorDiv.textContent = 'Please enter a valid email address.';
                errorDiv.style.display = 'block';
                return;
            }
            
            // Hide error and disable button
            errorDiv.style.display = 'none';
            const sendBtn = event.target;
            sendBtn.textContent = 'Sending...';
            sendBtn.disabled = true;
            
            // Send email
            fetch('{{ url_for("roi_calculator.email_report") }}', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    email: email,
                    industry: '{{ industry }}'
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    closeEmailModal();
                    document.getElementById('successMessage').textContent = 'Your ROI Business Case has been sent to ' + email;
                    document.getElementById('successModal').style.display = 'flex';
                } else {
                    errorDiv.textContent = data.error || 'Failed to send email. Please try again.';
                    errorDiv.style.display = 'block';
                    sendBtn.textContent = '📧 Send Report';
                    sendBtn.disabled = false;
                }
            })
            .catch(error => {
                console.error('Error:', error);
                errorDiv.textContent = 'Network error. Please check your connection and try again.';
                errorDiv.style.display = 'block';
                sendBtn.textContent = '📧 Send Report';
                sendBtn.disabled = false;
            });
        }
        
        // Allow Enter key to submit
        document.addEventListener('DOMContentLoaded', function() {
            const emailInput = document.getElementById('emailInput');
            if (emailInput) {
                emailInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        sendEmail();
                    }
                });
            }
        });
        
        // Close modal on outside click
        document.getElementById('emailModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeEmailModal();
            }
        });
        
        document.getElementById('successModal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeSuccessModal();
            }
        });
        </script>
        <hr>
        <h3>Next Steps</h3>
        <ol>
            <li><strong>Review the Report:</strong> Share this business case with your leadership team</li>
            <li><strong>Book Discovery Call:</strong> Validate these numbers with our automation experts</li>
            <li><strong>Plan Implementation:</strong> Discuss Tier 1 and Tier 2 automation roadmap</li>
        </ol>
        <hr>
        <h3>Book Your Discovery Call</h3>
        <p>Ready to validate these numbers? <a href="{{ booking_url }}">Book a Discovery Call</a> to discuss your automation opportunities.</p>
        <div class="btn-group">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=3) }}" class="btn btn-secondary">← Back to Results</a>
            <a href="{{ url_for('roi_calculator.roi_calculator') }}" class="btn">Start New Assessment</a>
        </div>
        {% endif %}
    </div>
</body>
</html>
"""

@roi_app.route('/', methods=['GET', 'POST'])
@roi_app.route('', methods=['GET', 'POST'])  # Also handle without trailing slash
def roi_calculator():
    try:
        step = int(request.args.get('step', request.form.get('step', 1)))
        
        # Clear session industry if not provided in URL (don't assume from cache)
        industry_from_url = request.args.get('industry')
        industry_from_form = request.form.get('industry')
        
        # Only use session industry if there's no URL parameter and we're continuing from a form
        if industry_from_url:
            # Industry provided in URL - use it and save to session
            industry = industry_from_url
            session['industry'] = industry
        elif industry_from_form:
            # Industry from form submission - use it and save to session
            industry = industry_from_form
            session['industry'] = industry
        elif request.method == 'GET' and step == 1:
            # Fresh page load on step 1 - clear any cached industry
            industry = None
            if 'industry' in session:
                del session['industry']
        else:
            # For other cases (e.g., continuing from previous step), use session if available
            industry = session.get('industry')
        
        # Normalize industry name (strip whitespace, handle URL encoding)
        if industry:
            industry = industry.strip()
            # Flask automatically decodes URL encoding, but ensure we have the exact key
            # Handle common URL encoding issues
            industry = industry.replace('+', ' ')
        
        selected_industry = industry
        
        # If industry is provided via URL parameter and we're on step 1, auto-advance to step 2
        if industry and step == 1 and request.method == 'GET':
            # Validate industry exists in INDUSTRIES (case-sensitive match required)
            if industry in INDUSTRIES:
                session['industry'] = industry
                step = 2
            else:
                # Log for debugging - industry not found
                print(f"Warning: Industry '{industry}' not found in INDUSTRIES. Available industries: {list(INDUSTRIES.keys())}")
        
        if request.method == 'POST':
            action = request.form.get('action', '')
            if action == 'continue' or request.form.get('industry'):
                industry = request.form.get('industry')
                session['industry'] = industry
                step = 2
            elif action == 'calculate':
                step = 3
        
        # Step 1: Industry Selection
        if step == 1:
            return render_template_string(HTML_TEMPLATE, 
                step=1, 
                industries=INDUSTRIES,
                selected_industry=selected_industry)
        
        # Step 2: Data Entry
        if step == 2:
            if not industry:
                return render_template_string(HTML_TEMPLATE, step=1, industries=INDUSTRIES)
            
            # Validate industry exists before accessing
            if industry not in INDUSTRIES:
                # If industry not found, redirect to step 1 with error message
                return render_template_string(HTML_TEMPLATE, step=1, industries=INDUSTRIES, error=f"Industry '{industry}' not found. Please select from the list below.")
            
            industry_config = INDUSTRIES[industry]
            
            # Handle form submission
            if request.method == 'POST' and action == 'calculate':
                # Get values from form - prioritize form values over session/defaults
                staff_count_str = request.form.get('staff_count', '').strip()
                staff_count = int(staff_count_str) if staff_count_str else int(session.get('staff_count', 50))
                
                platform = request.form.get('platform', '').strip() or session.get('platform', 'M365/SharePoint')
                
                # Save to session (removed pain_point, weekly_waste, and avg_rate)
                session['staff_count'] = staff_count
                session['platform'] = platform
                session['industry'] = industry
                
                # Clean up old session variables
                if 'pain_point' in session:
                    del session['pain_point']
                if 'weekly_waste' in session:
                    del session['weekly_waste']
                if 'avg_rate' in session:
                    del session['avg_rate']
                
                # Redirect to step 3 with values in URL as backup (in case session doesn't persist)
                return redirect(url_for('roi_calculator.roi_calculator', 
                                      step=3,
                                      staff_count=staff_count,
                                      platform=platform,
                                      industry=industry))
            
            # Get values from session or defaults
            staff_count = int(request.form.get('staff_count', session.get('staff_count', 50)))
            platform = request.form.get('platform', session.get('platform', 'M365/SharePoint'))
            
            return render_template_string(HTML_TEMPLATE,
                step=2,
                industry=industry,
                industry_config=industry_config,
                staff_count=staff_count,
                platform=platform)
        
        # Step 3: Results
        if step == 3:
            # Get values from form first (if submitted), then session, then defaults
            # This ensures we use the actual submitted values
            staff_count = int(request.form.get('staff_count') or request.args.get('staff_count') or session.get('staff_count') or 50)
            avg_rate = float(request.form.get('avg_rate') or request.args.get('avg_rate') or session.get('avg_rate') or 185)
            platform = request.form.get('platform') or request.args.get('platform') or session.get('platform') or 'M365/SharePoint'
            
            # Validate values are within acceptable ranges (but don't reset to defaults if they're valid)
            if staff_count < 10:
                staff_count = max(10, staff_count)  # Ensure minimum, but don't override user input
            
            # Clean up old session variables
            if 'weekly_waste' in session:
                del session['weekly_waste']
            if 'pain_point' in session:
                del session['pain_point']
            if 'avg_rate' in session:
                del session['avg_rate']  # No longer needed - uses industry default
            
            # Save to session to ensure persistence
            session['staff_count'] = staff_count
            session['platform'] = platform
            
            # Get industry config for automation potential
            industry_config = INDUSTRIES.get(industry, {})
            
            # Check if industry has full configuration (proven_tasks + tasks)
            # Import here to avoid circular imports
            from roi_calculator.calculations import has_full_roi_config, calculate_simple_roi
            
            # Use appropriate calculation based on config availability
            if has_full_roi_config(industry_config):
                # Full config available - use detailed conservative calculation
                calculations = calculate_conservative_roi(staff_count, industry_config)
            else:
                # Fallback for industries without full config
                # Use industry-specific automation_potential and basic assumptions
                avg_rate = session.get('avg_rate', 130)  # Get rate from session or use default
                calculations = calculate_simple_roi(staff_count, avg_rate, industry_config)
            session['calculations'] = calculations
            
            # Format automation potential as percentage for display
            weighted_potential = calculations.get('weighted_potential', 0.40)
            tier1_percentage = int(weighted_potential * 100)
            
            # Create chart data with proper formatting
            tier2_percentage = int(calculations.get('tier_2_potential', 0.70) * 100)
            chart_data = {
                "data": [{
                    "x": ["Today's<br>Cost", f"After Phase 1<br>(Save {format_currency(calculations.get('proven_tier_1_savings', calculations.get('tier_1_savings', 0)))})", f"After Phase 2<br>(Save {format_currency(calculations.get('tier_2_savings', 0))})"],
                    "y": [
                        calculations.get('annual_cost', calculations.get('annual_burn', 0)),
                        calculations.get('annual_cost', calculations.get('annual_burn', 0)) - calculations.get('proven_tier_1_savings', calculations.get('tier_1_savings', 0)),
                        calculations.get('annual_cost', calculations.get('annual_burn', 0)) - calculations.get('tier_2_savings', 0)
                    ],
                    "type": "bar",
                    "marker": {"color": ["#0B1221", "#D4AF37", "#B8941F"]},
                    "text": [format_currency(calculations.get('annual_cost', calculations.get('annual_burn', 0))), 
                            format_currency(calculations.get('annual_cost', calculations.get('annual_burn', 0)) - calculations.get('proven_tier_1_savings', calculations.get('tier_1_savings', 0))),
                            format_currency(calculations.get('annual_cost', calculations.get('annual_burn', 0)) - calculations.get('tier_2_savings', 0))],
                    "textposition": "outside",
                    "hovertemplate": "%{y:$,.0f}<extra></extra>",
                    "textfont": {"size": 12}
                }],
                "layout": {
                    "title": "",
                    "xaxis": {
                        "title": "",
                        "tickangle": 0,
                        "tickfont": {"size": 11}
                    },
                    "yaxis": {
                        "title": "Annual Cost (AUD)",
                        "tickformat": "$,.0f"
                    },
                    "showlegend": False,
                    "height": 450,
                    "margin": {"t": 60, "b": 100, "l": 80, "r": 40},
                    "plot_bgcolor": "white",
                    "paper_bgcolor": "white"
                }
            }
            
            # Analysis text
            analysis_text = []
            
            # Business insights based on conservative calculation
            annual_cost = calculations.get('annual_cost', calculations.get('annual_burn', 0))
            if annual_cost > 100000:
                analysis_text.append(f"💰 <strong>Conservative Opportunity:</strong> With an annual documentation cost of {format_currency(annual_cost)}, proven automation could deliver substantial ROI within the first year.")
            
            # Find highest ROI task (low-hanging fruit)
            highest_roi_task = None
            if calculations.get('task_analysis'):
                highest_roi_task = calculations['task_analysis'][0]  # Already sorted by ROI
                if highest_roi_task.get('is_low_hanging_fruit'):
                    analysis_text.append(f"🎯 <strong>Low-Hanging Fruit:</strong> {highest_roi_task['name']} is a proven repetitive task with {int(highest_roi_task['conservative_potential'] * 100)}% conservative automation potential, saving {format_currency(highest_roi_task['annual_savings'])} annually.")
                else:
                    analysis_text.append(f"⭐ <strong>Highest ROI Opportunity:</strong> {highest_roi_task['name']} has the highest proven savings at {format_currency(highest_roi_task['annual_savings'])} annually.")
            
            if not analysis_text:
                analysis_text.append("✅ Your organization shows moderate efficiency opportunities. Automation can still deliver meaningful improvements.")
            
            # Get platform and other values for display
            platform = session.get('platform', 'M365/SharePoint')
            
            # Get AI opportunities for this industry
            ai_opportunities = AI_OPPORTUNITIES.get(industry, [])
            
            # Generate automation roadmap from task analysis
            roadmap = generate_automation_roadmap_v3(
                calculations.get('task_analysis', []),
                calculations.get('doc_staff_count', staff_count),
                calculations.get('typical_doc_rate', 130)
            )
            
            # Calculate additional metrics for universal template
            total_weekly_hours = calculations.get('total_weekly_hours', 0)
            total_annual_hours = total_weekly_hours * 48
            tier1_savings = calculations.get('proven_tier_1_savings', calculations.get('tier_1_savings', 0))
            
            # Industry slug for URL
            industry_slug = industry.lower().replace(' & ', '-').replace(' ', '-')
            
            return render_template_string(HTML_TEMPLATE,
                step=3,
                industry=industry,
                industry_config=industry_config,
                industry_slug=industry_slug,
                staff_count=staff_count,
                avg_rate=calculations.get('typical_doc_rate', 130),  # Use doc staff rate
                platform=platform,
                calculations=calculations,
                total_weekly_hours=total_weekly_hours,
                total_annual_hours=total_annual_hours,
                tier1_savings=tier1_savings,
                tier1_percentage=tier1_percentage,
                automation_potential=weighted_potential,
                chart_json=json.dumps(chart_data, cls=plotly.utils.PlotlyJSONEncoder),
                analysis_text=analysis_text,
                ai_opportunities=ai_opportunities,
                roadmap=roadmap,
                booking_url=BOOKING_URL,
                format_currency=format_currency,
                INDUSTRIES=INDUSTRIES)
        
        # Step 4: PDF Download
        if step == 4:
            # Get industry from session for email button
            industry = session.get('industry', '')
            return render_template_string(HTML_TEMPLATE,
                step=4,
                industry=industry,
                booking_url=BOOKING_URL)
    
    except Exception as e:
        # Log the error for debugging
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        print(f"Error in roi_calculator route: {error_msg}")
        
        # Return a user-friendly error page
        return f"""
        <html>
        <head><title>ROI Calculator Error</title></head>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
            <h1>Error Loading ROI Calculator</h1>
            <p>We encountered an error while loading the calculator. Please try again.</p>
            <p style="color: #666; font-size: 0.9em;">Error: {error_msg}</p>
            <p><a href="/roi.html">Return to ROI Calculator</a></p>
        </body>
        </html>
        """, 500

@roi_app.route('/email-report', methods=['POST'])
def email_report():
    """Email PDF report to user using MailChannels API"""
    from flask import jsonify, current_app
    import requests
    import base64
    
    capture_id = None  # Initialize for email tracking
    
    try:
        data = request.get_json()
        email = data.get('email')
        industry = data.get('industry')
        
        if not email:
            return jsonify({"success": False, "error": "Email is required"}), 400
        
        # Get session data
        if not industry:
            industry = session.get('industry')
        staff_count = session.get('staff_count', 50)
        avg_rate = session.get('avg_rate', 185)
        platform = session.get('platform', 'M365/SharePoint')
        calculations = session.get('calculations')
        
        if not calculations:
            return jsonify({"success": False, "error": "No calculations found. Please complete the calculator first."}), 400
        
        # Capture email request for tracking
        capture_id = capture_email_request(
            email_address=email,
            report_type='roi_calculator',
            source_page='/roi-calculator/results',
            request_data={
                'industry': industry,
                'staff_count': staff_count,
                'avg_rate': avg_rate,
                'platform': platform,
                'calculations': calculations
            },
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            session_id=session.get('_id')
        )
        
        # Also log as ROI report generation
        log_roi_report(
            report_type='email_report',
            industry=industry,
            staff_count=staff_count,
            avg_rate=avg_rate,
            calculations=calculations,
            delivery_method='email',
            email_address=email,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            session_id=session.get('_id'),
            source_page='/roi-calculator/results'
        )
        
        # Generate PDF
        pdf_buffer = generate_pdf_report(industry, staff_count, avg_rate, platform, calculations)
        pdf_bytes = pdf_buffer.getvalue()
        
        # Encode PDF as base64 for MailChannels
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        
        # Get MailChannels API key
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        
        # Prepare email data for MailChannels
        email_data = {
            "personalizations": [
                {
                    "to": [{"email": email}],
                    "cc": [{"email": "michaelbarrett@bluelily.com.au"}]
                }
            ],
            "from": {
                "email": "noreply@curam-ai.com.au",
                "name": "Curam AI"
            },
            "subject": f"Your ROI Business Case Report - {industry}",
            "content": [
                {
                    "type": "text/plain",
                    "value": f"Thank you for using the Curam AI ROI Calculator.\n\nPlease find your personalized ROI Business Case report attached.\n\nIndustry: {industry}\nStaff Count: {staff_count}\nAverage Rate: ${avg_rate}/hour\n\nNext Steps:\n1. Review the report with your leadership team\n2. Book a discovery call to validate these numbers\n3. Discuss implementation roadmap\n\nBest regards,\nThe Curam AI Team"
                },
                {
                    "type": "text/html",
                    "value": f"""
                    <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #4B5563;">
                        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #0B1221;">Your ROI Business Case Report</h2>
                            <p>Thank you for using the Curam AI ROI Calculator.</p>
                            <p>Please find your personalized ROI Business Case report attached.</p>
                            
                            <div style="background: #F8F9FA; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="color: #0B1221; margin-top: 0;">Report Details:</h3>
                                <ul style="list-style: none; padding: 0;">
                                    <li><strong>Industry:</strong> {industry}</li>
                                    <li><strong>Staff Count:</strong> {staff_count}</li>
                                    <li><strong>Average Rate:</strong> ${avg_rate}/hour</li>
                                </ul>
                            </div>
                            
                            <h3 style="color: #0B1221;">Next Steps:</h3>
                            <ol>
                                <li>Review the report with your leadership team</li>
                                <li>Book a discovery call to validate these numbers</li>
                                <li>Discuss implementation roadmap</li>
                            </ol>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
                                <p style="color: #6B7280; font-size: 0.9em;">
                                    Best regards,<br>
                                    <strong>The Curam AI Team</strong>
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                    """
                }
            ],
            "attachments": [
                {
                    "content": pdf_base64,
                    "filename": f"Curam_AI_ROI_Report_{datetime.now().strftime('%Y%m%d')}.pdf",
                    "type": "application/pdf",
                    "disposition": "attachment"
                }
            ]
        }
        
        # Set headers
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        # Send email via MailChannels API
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        response = requests.post(mailchannels_url, json=email_data, headers=headers, timeout=30)
        
        if response.status_code == 202:
            # Mark email as sent successfully
            if capture_id:
                mark_email_sent(capture_id, success=True)
            
            current_app.logger.info(f"ROI report sent successfully to {email} (CC: michaelbarrett@bluelily.com.au)")
            return jsonify({"success": True, "message": "Report sent successfully! Check your email."})
        else:
            # Mark email as failed
            if capture_id:
                mark_email_sent(capture_id, success=False, error_message=f"MailChannels error: {response.status_code}")
            
            current_app.logger.error(f"MailChannels API error: {response.status_code} - {response.text}")
            return jsonify({"success": False, "error": "Failed to send email. Please try again later."}), 500
        
    except Exception as e:
        # Mark email as failed with error
        if capture_id:
            mark_email_sent(capture_id, success=False, error_message=str(e))
        
        current_app.logger.error(f"Error sending email report: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@roi_app.route('/email-phase1-report', methods=['POST'])
def email_phase1_report():
    """Email Phase-1 Feasibility Sprint PDF to user using MailChannels API"""
    from flask import jsonify, current_app
    
    capture_id = None  # Initialize for email tracking
    
    try:
        data = request.get_json()
        email = data.get('email')
        
        if not email:
            return jsonify({"success": False, "error": "Email is required"}), 400
        
        # Capture email request for tracking
        capture_id = capture_email_request(
            email_address=email,
            report_type='phase1_sample',
            source_page=request.referrer or '/roi-calculator/results',
            request_data={
                'industry': session.get('industry'),
                'source': 'roi_calculator_results_page'
            },
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            session_id=session.get('_id')
        )
        
        # Also log as ROI report generation
        log_roi_report(
            report_type='phase1_report',
            industry=session.get('industry'),
            staff_count=session.get('staff_count'),
            avg_rate=session.get('avg_rate'),
            calculations=session.get('calculations'),
            delivery_method='email',
            email_address=email,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            session_id=session.get('_id'),
            source_page=request.referrer or '/roi-calculator/results'
        )
        
        # Read the Phase-1 PDF file
        # The assets folder is in the root directory (same as main.py and roi_calculator_flask.py)
        # Try multiple possible paths
        possible_paths = [
            os.path.join(current_app.root_path, 'assets', 'downloads', 'Phase-1-feasibility-sprint.pdf'),
            os.path.join(os.path.dirname(__file__), 'assets', 'downloads', 'Phase-1-feasibility-sprint.pdf'),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets', 'downloads', 'Phase-1-feasibility-sprint.pdf'),
            'assets/downloads/Phase-1-feasibility-sprint.pdf'
        ]
        
        pdf_path = None
        for path in possible_paths:
            abs_path = os.path.abspath(path)
            if os.path.exists(abs_path):
                pdf_path = abs_path
                break
        
        if not pdf_path:
            # Mark email as failed - PDF not found
            if capture_id:
                mark_email_sent(capture_id, success=False, error_message="PDF file not found")
            
            current_app.logger.error(f"Phase-1 PDF not found. Tried paths: {possible_paths}")
            current_app.logger.error(f"Current working directory: {os.getcwd()}")
            current_app.logger.error(f"App root path: {current_app.root_path}")
            current_app.logger.error(f"File location: {__file__}")
            return jsonify({"success": False, "error": "PDF file not found. Please contact support."}), 500
        
        with open(pdf_path, 'rb') as f:
            pdf_bytes = f.read()
        
        # Encode PDF as base64 for MailChannels
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        
        # Get MailChannels API key
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        
        # Get from email address
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Prepare email data for MailChannels
        email_data = {
            "personalizations": [
                {
                    "to": [{"email": email}],
                    "cc": [{"email": "michaelbarrett@bluelily.com.au"}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam AI"
            },
            "subject": "Phase 1 Feasibility Sprint Report",
            "content": [
                {
                    "type": "text/plain",
                    "value": """Thank you for your interest in the Curam-Ai Protocol™.

Please find attached the Phase 1 Feasibility Sprint report, which outlines our proven methodology for validating AI automation on your documents.

This report demonstrates:
• How we achieve 90%+ accuracy on YOUR documents
• The $1,500 Phase 1 Sprint process
• Real results from similar organizations
• Next steps to get started

Next Steps:
1. Review the report to understand the Phase 1 process
2. Book a consultation call to discuss your specific needs
3. Start your Phase 1 Sprint to validate AI on your documents

Best regards,
The Curam AI Team"""
                },
                {
                    "type": "text/html",
                    "value": """
                    <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #4B5563;">
                        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #0B1221;">Phase 1 Feasibility Sprint Report</h2>
                            <p>Thank you for your interest in the Curam-Ai Protocol™.</p>
                            <p>Please find attached the Phase 1 Feasibility Sprint report, which outlines our proven methodology for validating AI automation on your documents.</p>
                            
                            <div style="background: #F8F9FA; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="color: #0B1221; margin-top: 0;">This report demonstrates:</h3>
                                <ul style="list-style: none; padding: 0;">
                                    <li>• How we achieve <strong>90%+ accuracy</strong> on YOUR documents</li>
                                    <li>• The <strong>$1,500 Phase 1 Sprint</strong> process</li>
                                    <li>• Real results from similar organizations</li>
                                    <li>• Next steps to get started</li>
                                </ul>
                            </div>
                            
                            <h3 style="color: #0B1221;">Next Steps:</h3>
                            <ol>
                                <li>Review the report to understand the Phase 1 process</li>
                                <li>Book a consultation call to discuss your specific needs</li>
                                <li>Start your Phase 1 Sprint to validate AI on your documents</li>
                            </ol>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
                                <p style="color: #6B7280; font-size: 0.9em;">
                                    Best regards,<br>
                                    <strong>The Curam AI Team</strong>
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                    """
                }
            ],
            "attachments": [
                {
                    "content": pdf_base64,
                    "filename": "Phase-1-feasibility-sprint.pdf",
                    "type": "application/pdf",
                    "disposition": "attachment"
                }
            ]
        }
        
        # Set headers
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        # Send email via MailChannels API
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        response = requests.post(mailchannels_url, json=email_data, headers=headers, timeout=30)
        
        if response.status_code == 202:
            # Mark email as sent successfully
            if capture_id:
                mark_email_sent(capture_id, success=True)
            
            current_app.logger.info(f"Phase-1 report sent successfully to {email} (CC: michaelbarrett@bluelily.com.au)")
            return jsonify({"success": True, "message": "Report sent successfully! Check your email."})
        else:
            # Mark email as failed
            if capture_id:
                mark_email_sent(capture_id, success=False, error_message=f"MailChannels error: {response.status_code}")
            
            current_app.logger.error(f"MailChannels API error: {response.status_code} - {response.text}")
            return jsonify({"success": False, "error": "Failed to send email. Please try again later."}), 500
        
    except Exception as e:
        # Mark email as failed with error
        if capture_id:
            mark_email_sent(capture_id, success=False, error_message=str(e))
        
        current_app.logger.error(f"Error sending Phase-1 email report: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@roi_app.route('/send-roadmap-email', methods=['POST'])
def send_roadmap_email():
    """Send roadmap email to user"""
    from flask import jsonify
    
    try:
        data = request.get_json()
        email = data.get('email')
        company = data.get('company', '')
        
        if not email:
            return jsonify({"success": False, "error": "Email is required"}), 400
        
        # Get session data
        industry = session.get('industry')
        staff_count = session.get('staff_count', 50)
        avg_rate = session.get('avg_rate', 185)
        platform = session.get('platform', 'M365/SharePoint')
        calculations = session.get('calculations')
        weekly_waste = session.get('weekly_waste', 5.0)
        
        if not calculations:
            return jsonify({"success": False, "error": "No calculations found"}), 400
        
        # Log roadmap email generation
        log_roi_report(
            report_type='roadmap_email',
            industry=industry,
            staff_count=staff_count,
            avg_rate=avg_rate,
            calculations=calculations,
            delivery_method='email',
            email_address=email,
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            session_id=session.get('_id'),
            source_page=request.referrer or '/roi-calculator/results'
        )
        
        # Generate roadmap
        roadmap = generate_automation_roadmap(industry, staff_count, avg_rate, weekly_waste)
        ai_opportunities = AI_OPPORTUNITIES.get(industry, [])
        
        # Generate email content (HTML)
        email_html = generate_roadmap_email_html(
            email, company, industry, staff_count, avg_rate, platform,
            calculations, roadmap, ai_opportunities
        )
        
        # TODO: Integrate with your email service (SendGrid, AWS SES, etc.)
        # For now, just log it
        print(f"ROADMAP EMAIL REQUEST:")
        print(f"  To: {email}")
        print(f"  Company: {company}")
        print(f"  Industry: {industry}")
        print(f"  Roadmap phases: {len(roadmap)}")
        
        # In production, send email here
        # send_email(email, "Your Custom Automation Roadmap", email_html)
        
        return jsonify({"success": True, "message": "Roadmap email sent successfully"})
        
    except Exception as e:
        print(f"Error sending roadmap email: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

def generate_roadmap_email_html(email, company, industry, staff_count, avg_rate, platform, calculations, roadmap, ai_opportunities):
    """Generate HTML email content for roadmap"""
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            h1 {{ color: #0B1221; }}
            .section {{ margin: 20px 0; padding: 15px; background: #F8F9FA; border-radius: 6px; }}
            .phase {{ margin: 15px 0; padding: 10px; background: white; border-left: 3px solid #D4AF37; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Your Custom Automation Roadmap</h1>
            <p>Thank you for using the Curam AI ROI Calculator. Here's your personalized automation roadmap.</p>
            
            <div class="section">
                <h2>Your Inputs</h2>
                <p><strong>Industry:</strong> {industry}</p>
                <p><strong>Billable Technical Staff:</strong> {staff_count}</p>
                <p><strong>Billable Rate:</strong> ${avg_rate:,.0f}/hour</p>
            </div>
            
            <div class="section">
                <h2>ROI Summary</h2>
                <p><strong>Annual Efficiency Loss:</strong> ${calculations['annual_burn']:,.0f}</p>
                <p><strong>Tier 1 Savings ({int(calculations.get('automation_potential', 0.40) * 100)}%):</strong> ${calculations['tier_1_savings']:,.0f}/year</p>
                <p><strong>Capacity Hours:</strong> {calculations['capacity_hours']:,.0f} hours/year</p>
                <p><strong>Revenue Opportunity:</strong> ${calculations['potential_revenue']:,.0f}/year</p>
            </div>
            
            <div class="section">
                <h2>Recommended Automation Roadmap</h2>
    """
    
    for phase in roadmap:
        html += f"""
                <div class="phase">
                    <h3>{phase['name']} ({phase['weeks']})</h3>
                    <ul>
                        <li><strong>Automate:</strong> {phase['task']}</li>
                        <li><strong>Time Saved:</strong> {phase['hours_per_year']:,.0f} hours/year</li>
                        <li><strong>Revenue Reclaimed:</strong> ${phase['revenue_reclaimed']:,.0f}/year</li>
                        <li><strong>Payback:</strong> {phase['payback']}</li>
                    </ul>
                </div>
        """
    
    html += f"""
            </div>
            
            <div class="section">
                <h2>Next Steps</h2>
                <p>Ready to discuss Phase 1 implementation? <a href="{BOOKING_URL}">Book a consultation call</a> to validate these numbers and create your implementation plan.</p>
            </div>
            
            <p>Best regards,<br>Curam AI Team</p>
        </div>
    </body>
    </html>
    """
    return html

@roi_app.route('/pdf')
def download_pdf():
    industry = session.get('industry')
    staff_count = session.get('staff_count', 50)
    avg_rate = session.get('avg_rate', 185)
    platform = session.get('platform', 'M365/SharePoint')
    calculations = session.get('calculations')
    
    if not calculations:
        return "No calculations found. Please complete the assessment first.", 400
    
    # Log PDF download to database
    log_roi_report(
        report_type='pdf_download',
        industry=industry,
        staff_count=staff_count,
        avg_rate=avg_rate,
        calculations=calculations,
        delivery_method='download',
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        session_id=session.get('_id'),
        source_page=request.referrer or '/roi-calculator/results'
    )
    
    pdf_buffer = generate_pdf_report(industry, staff_count, avg_rate, platform, calculations)
    
    return send_file(
        pdf_buffer,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'Curam_AI_ROI_Report_{datetime.now().strftime("%Y%m%d")}.pdf'
    )

# Test route to verify blueprint is working
@roi_app.route('/test')
def test_route():
    """Test endpoint to verify ROI calculator blueprint is registered"""
    return {
        "status": "ok",
        "message": "ROI Calculator blueprint is working",
        "available_industries": list(INDUSTRIES.keys())
    }

@roi_app.route('/results-improved')
def results_improved():
    """Improved results page with inverted pyramid structure"""
    from flask import render_template
    from datetime import datetime
    
    industry = session.get('industry')
    staff_count = session.get('staff_count', 50)
    calculations = session.get('calculations')
    
    if not calculations:
        return redirect(url_for('roi_calculator.roi_calculator', step=1))
    
    # Get industry config
    industry_config = INDUSTRIES.get(industry, {})
    
    # Calculate firm size and doc staff percentage
    if staff_count <= 20:
        firm_size = "Small"
        doc_staff_percentage = 0.80
    elif staff_count <= 50:
        firm_size = "Medium"
        doc_staff_percentage = 0.75
    else:
        firm_size = "Large"
        doc_staff_percentage = 0.70
    
    doc_staff_count = int(staff_count * doc_staff_percentage)
    
    # Get hours per week and avg rate from industry config
    hours_per_week = industry_config.get('hours_per_week', 5.0)
    avg_rate = industry_config.get('avg_rate', 130.0)
    
    # Generate roadmap
    roadmap = generate_roadmap(industry_config, doc_staff_count, hours_per_week, avg_rate)
    
    return render_template('roi_results_improved.html',
                         industry=industry,
                         staff_count=staff_count,
                         doc_staff_count=doc_staff_count,
                         firm_size=firm_size,
                         hours_per_week=hours_per_week,
                         avg_rate=avg_rate,
                         calculations=calculations,
                         roadmap=roadmap)

@roi_app.route('/pdf-improved')
def pdf_improved():
    """Generate PDF using improved template"""
    from flask import render_template
    from datetime import datetime
    
    industry = session.get('industry')
    staff_count = session.get('staff_count', 50)
    calculations = session.get('calculations')
    company_name = request.args.get('company', 'Your Company')
    
    if not calculations:
        return "No calculations found. Please complete the assessment first.", 400
    
    # Get industry config
    industry_config = INDUSTRIES.get(industry, {})
    
    # Calculate firm size and doc staff percentage
    if staff_count <= 20:
        firm_size = "Small"
        doc_staff_percentage = 0.80
    elif staff_count <= 50:
        firm_size = "Medium"
        doc_staff_percentage = 0.75
    else:
        firm_size = "Large"
        doc_staff_percentage = 0.70
    
    doc_staff_count = int(staff_count * doc_staff_percentage)
    
    # Get hours per week and avg rate from industry config
    hours_per_week = industry_config.get('hours_per_week', 5.0)
    avg_rate = industry_config.get('avg_rate', 130.0)
    
    # Generate roadmap
    roadmap = generate_roadmap(industry_config, doc_staff_count, hours_per_week, avg_rate)
    
    # Add additional task metadata for PDF
    for i, task in enumerate(roadmap):
        task['success_rate'] = ['90', '85', '88', '75', '80'][min(i, 4)]
        task['complexity'] = ['High', 'Medium', 'Medium', 'Low', 'Medium'][min(i, 4)]
        task['score'] = [10, 7, 6, 4, 5][min(i, 4)]
        task['why_it_works'] = [
            'Highly repetitive, rule-based task with structured formats.',
            'Semi-structured task with proven templates.',
            'Structured data extraction from standardized formats.',
            'Task requires human judgment - Phase 1 validation needed.',
            'Various administrative tasks with moderate automation potential.'
        ][min(i, 4)]
    
    return render_template('roi_report_pdf.html',
                         industry=industry,
                         staff_count=staff_count,
                         doc_staff_count=doc_staff_count,
                         firm_size=firm_size,
                         hours_per_week=hours_per_week,
                         avg_rate=avg_rate,
                         calculations=calculations,
                         roadmap=roadmap,
                         company_name=company_name,
                         report_date=datetime.now().strftime('%B %d, %Y'))

def generate_roadmap(industry_config, doc_staff_count, hours_per_week, avg_rate):
    """Generate automation roadmap for the improved template"""
    tasks = industry_config.get('tasks', [])
    roadmap = []
    
    total_weekly_hours = doc_staff_count * hours_per_week
    
    for task in tasks:
        task_name = task['task']
        time_percentage = task.get('hours_per_week', 5) / 30  # Normalize to 30 hrs baseline
        task_weekly_hours = total_weekly_hours * time_percentage
        
        # Conservative automation estimates
        automation_potential = 0.45 if task.get('potential') == 'HIGH' else (0.35 if task.get('potential') == 'MEDIUM' else 0.25)
        success_rate = 0.90 if task.get('potential') == 'HIGH' else (0.85 if task.get('potential') == 'MEDIUM' else 0.75)
        conservative_estimate = automation_potential * success_rate
        
        recoverable_hours_per_week = task_weekly_hours * conservative_estimate
        recoverable_hours_per_year = recoverable_hours_per_week * 48  # 48 working weeks
        annual_value = recoverable_hours_per_year * avg_rate
        
        roadmap.append({
            'task': task_name,
            'description': task.get('description', ''),
            'hours_per_year': recoverable_hours_per_year,
            'revenue_reclaimed': annual_value,
            'weeks': '8 weeks',
            'name': f"Phase {len(roadmap) + 1}",
            'automation_potential': automation_potential,
            'success_rate_decimal': success_rate,
            'conservative_estimate': conservative_estimate,
            'potential': task.get('potential', 'MEDIUM')
        })
    
    # Sort by annual value (highest first)
    roadmap.sort(key=lambda x: x['revenue_reclaimed'], reverse=True)
    
    return roadmap[:5]  # Return top 5 tasks

# Note: This blueprint should be registered in main.py
# Example: app.register_blueprint(roi_app, url_prefix='/roi-calculator')