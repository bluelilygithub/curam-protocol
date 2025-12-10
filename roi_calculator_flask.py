import os
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
    ]
}

# Industry configurations
INDUSTRIES = {
    "Architecture & Building Services": {
        "context": "Specification writing, Drawing registers, Energy modelling",
        "q1_label": "How do you currently compile Drawing Registers and Window/Door Schedules?",
        "q1_options": {
            "Automated BIM export (Low pain)": 0,
            "Export to Excel, then manual formatting (Medium pain)": 5,
            "Manual typing in CAD title blocks (High pain)": 10
        },
        "q2_label": "Hours per week, per engineer, spent on spec writing & manual data entry?",
        "q2_type": "slider",
        "q2_range": (0, 20)
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
        "context": "Trust account audits, Inter-entity reconciliations, Complex GL coding",
        "q1_label": "How do you currently handle trust account reconciliations and inter-entity matching?",
        "q1_options": {
            "Automated reconciliation software (Low pain)": 0,
            "Manual transaction-by-transaction matching in Excel (Medium pain)": 5,
            "Manual typing from bank statements (High pain)": 10
        },
        "q2_label": "Hours per week, per accountant, spent on reconciliations & complex invoice coding?",
        "q2_type": "slider",
        "q2_range": (0, 20)
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

def calculate_metrics(staff_count, avg_rate, weekly_waste, pain_point):
    """Calculate all financial metrics"""
    # Annual burn rate
    annual_burn = staff_count * weekly_waste * avg_rate * 48
    
    # Tier 1 Opportunity (40% reduction) - Immediate savings from basic automation
    tier_1_savings = annual_burn * 0.40
    tier_1_cost = annual_burn - tier_1_savings
    
    # Tier 2 Opportunity (70% reduction) - Expanded automation, workflow optimization
    tier_2_savings = annual_burn * 0.70
    tier_2_cost = annual_burn - tier_2_savings
    
    # Revenue capacity (if all hours were billable)
    capacity_hours = staff_count * weekly_waste * 48
    potential_revenue = capacity_hours * avg_rate
    
    return {
        "annual_burn": annual_burn,
        "tier_1_savings": tier_1_savings,
        "tier_1_cost": tier_1_cost,
        "tier_2_savings": tier_2_savings,
        "tier_2_cost": tier_2_cost,
        "capacity_hours": capacity_hours,
        "potential_revenue": potential_revenue,
        "pain_point": pain_point,
        "weekly_waste": weekly_waste
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
        ["Average Billable Rate (AUD)", format_currency(avg_rate)],
        ["Core Tech Stack", platform]
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
    calc_data = [
        ["Metric", "Value"],
        ["Annual Efficiency Loss (Burn Rate)", format_currency(calculations['annual_burn'])],
        ["Tier 1 Opportunity (Immediate Savings)", format_currency(calculations['tier_1_savings'])],
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
    recommendations = [
        f"<b>Tier 1 Implementation:</b> Focus on automated data extraction to achieve immediate savings of {format_currency(calculations['tier_1_savings'])} annually.",
        f"<b>Tier 2 Implementation:</b> Expand automation to unlock {calculations['capacity_hours']:,.0f} billable hours, representing {format_currency(calculations['potential_revenue'])} in revenue capacity.",
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
            margin: 2rem 0;
            gap: 1rem;
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
        .email-capture-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }
        .email-capture-modal.active {
            display: flex;
        }
        .email-capture-content {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            max-width: 500px;
            width: 90%;
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
    </style>
</head>
<body>
    <div class="container">
        {% if step == 1 %}
        <div class="step-indicator">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=1) }}" class="step active">1</a>
            <span class="step">2</span>
            <span class="step">3</span>
            <span class="step">4</span>
        </div>
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
        <div class="step-indicator">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=1) }}" class="step completed">1</a>
            <span class="step active">2</span>
            <span class="step">3</span>
            <span class="step">4</span>
        </div>
        <h1>Input Your Baseline Data</h1>
        <hr>
        <form method="POST" action="{{ url_for('roi_calculator.roi_calculator') }}">
            <input type="hidden" name="step" value="2">
            <input type="hidden" name="industry" value="{{ industry }}">
            <h3>Universal Inputs</h3>
            <div class="form-group">
                <label>Number of Billable Technical Staff <small style="color: #4B5563; font-weight: normal;">(includes senior, mid-level, and entry-level billable staff)</small></label>
                <div class="slider-container">
                    <input type="range" name="staff_count_slider" id="staff_count_slider" 
                           value="{{ staff_count }}" min="10" max="500" step="5" 
                           oninput="document.getElementById('staff_count').value = this.value">
                    <input type="number" name="staff_count" id="staff_count" 
                           value="{{ staff_count }}" min="10" max="500" step="5" required
                           oninput="document.getElementById('staff_count_slider').value = this.value">
                </div>
            </div>
            <div class="form-group">
                <label>Average Billable Rate (AUD)</label>
                <div class="slider-container">
                    <input type="range" name="avg_rate_slider" id="avg_rate_slider" 
                           value="{{ avg_rate }}" min="50" max="500" step="1" 
                           oninput="document.getElementById('avg_rate').value = Math.round(this.value)">
                    <input type="number" name="avg_rate" id="avg_rate" 
                           value="{{ avg_rate }}" min="50" max="500" step="1" required
                           oninput="document.getElementById('avg_rate_slider').value = this.value">
                </div>
            </div>
            <div class="form-group">
                <label>Core Tech Stack</label>
                {% for option in ['M365/SharePoint', 'Google Workspace', 'Other'] %}
                <div class="radio-group">
                    <input type="radio" name="platform" value="{{ option }}" id="platform_{{ loop.index }}" 
                           {% if platform == option %}checked{% endif %}>
                    <label for="platform_{{ loop.index }}">{{ option }}</label>
                </div>
                {% endfor %}
            </div>
            <hr>
            <h3>{{ industry }} - Specific Questions</h3>
            <div class="form-group">
                <label>{{ industry_config.q1_label }}</label>
                {% for option, value in industry_config.q1_options.items() %}
                <div class="radio-group">
                    <input type="radio" name="pain_point" value="{{ value }}" id="pain_{{ loop.index }}" 
                           {% if pain_point == value %}checked{% endif %} required>
                    <label for="pain_{{ loop.index }}">{{ option }}</label>
                </div>
                {% endfor %}
            </div>
            <div class="form-group">
                <label>{{ industry_config.q2_label }}</label>
                {% if industry_config.q2_type == "slider" %}
                <div class="slider-container">
                    <input type="range" name="weekly_waste_slider" id="weekly_waste_slider" 
                           value="{{ weekly_waste }}" 
                           min="{{ industry_config.q2_range[0] }}" max="{{ industry_config.q2_range[1] }}" 
                           step="0.5" 
                           oninput="document.getElementById('weekly_waste').value = this.value">
                    <input type="number" name="weekly_waste" id="weekly_waste" 
                           value="{{ weekly_waste }}" 
                           min="{{ industry_config.q2_range[0] }}" max="{{ industry_config.q2_range[1] }}" 
                           step="0.5" required
                           oninput="document.getElementById('weekly_waste_slider').value = this.value">
                    <span>hours</span>
                </div>
                {% else %}
                <select name="weekly_waste" required>
                    {% for option, value in industry_config.q2_options.items() %}
                    <option value="{{ value }}" {% if weekly_waste == value %}selected{% endif %}>{{ option }}</option>
                    {% endfor %}
                </select>
                {% endif %}
            </div>
            <div class="btn-group">
                <a href="{{ url_for('roi_calculator.roi_calculator') }}" class="btn btn-secondary">← Back</a>
                <button type="submit" name="action" value="calculate" class="btn">Calculate ROI →</button>
            </div>
        </form>
        
        {% elif step == 3 %}
        <div class="step-indicator">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=1) }}" class="step completed">1</a>
            <a href="{{ url_for('roi_calculator.roi_calculator', step=2, industry=industry) }}" class="step completed">2</a>
            <span class="step active">3</span>
            <span class="step">4</span>
        </div>
        <h1>Your ROI Analysis</h1>
        <hr>
        <div class="scroll-indicator" id="scrollIndicator" onclick="scrollToNext()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
            </svg>
        </div>
        <div class="important-notice">
            <p><strong>⚠️ Important:</strong> This analysis calculates costs based on <strong>technical billable staff only</strong>. Administrative and support staff costs are not included in these calculations. The billable rates and hours reflect the opportunity cost of technical staff time spent on non-billable administrative tasks. <strong>Note that substantial additional savings may be derived from automating finance and administrative tasks</strong>, which are not reflected in these technical staff calculations.</p>
        </div>
        <hr>
        <div class="input-summary" style="margin-bottom: 1rem;">
            <h3 style="margin-bottom: 0.5rem; font-size: 1rem;">Your Inputs</h3>
            <div class="summary-grid">
                <div class="summary-item">
                    <strong>Industry:</strong> {{ industry }}
                </div>
                <div class="summary-item">
                    <strong>Billable Technical Staff:</strong> {{ staff_count }}
                </div>
                <div class="summary-item">
                    <strong>Billable Rate:</strong> {{ format_currency(avg_rate) }}/hour
                </div>
                <div class="summary-item">
                    <strong>Hours per Week (Waste):</strong> {{ calculations.weekly_waste }} hours
                </div>
                <div class="summary-item">
                    <strong>Tech Stack:</strong> {{ platform }}
                </div>
            </div>
        </div>
        <hr>
        <h2>Your Annual Efficiency Loss: {{ format_currency(calculations.annual_burn) }}</h2>
        <hr>
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">{{ format_currency(calculations.annual_burn) }}</div>
                <div class="metric-label">Annual Burn Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{{ format_currency(calculations.tier_1_savings) }}</div>
                <div class="metric-label">Tier 1 Savings</div>
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
        <h3>Current State vs Future State</h3>
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
        
        <!-- Implementation Reality Check -->
        <div class="reality-check-box">
            <h3>⚠️ Implementation Reality Check</h3>
            <p style="margin-bottom: 1rem;">Quick question: How is your technical documentation currently stored?</p>
            <form id="readiness-form" onsubmit="return false;">
                <div class="radio-group" style="margin: 0.75rem 0;">
                    <input type="radio" name="readiness" value="structured" id="readiness_structured" 
                           onchange="showReadinessResponse('structured')">
                    <label for="readiness_structured">
                        <strong>Structured databases/SharePoint libraries</strong> with consistent naming<br>
                        <small style="color: #4B5563;">✓ AI-Ready: Can start automation quickly</small>
                    </label>
                </div>
                <div class="radio-group" style="margin: 0.75rem 0;">
                    <input type="radio" name="readiness" value="mixed" id="readiness_mixed" 
                           onchange="showReadinessResponse('mixed')">
                    <label for="readiness_mixed">
                        <strong>Shared drives</strong> with mixed file formats and inconsistent naming<br>
                        <small style="color: #4B5563;">⚠️ Needs Prep: 2-4 weeks data structuring</small>
                    </label>
                </div>
                <div class="radio-group" style="margin: 0.75rem 0;">
                    <input type="radio" name="readiness" value="chaotic" id="readiness_chaotic" 
                           onchange="showReadinessResponse('chaotic')">
                    <label for="readiness_chaotic">
                        <strong>Individual desktops, email attachments, paper files</strong><br>
                        <small style="color: #4B5563;">🚨 High Friction: Requires data migration</small>
                    </label>
                </div>
            </form>
            <div id="readiness-response" class="reality-check-response" style="display: none;">
                <h4 id="response-title"></h4>
                <p id="response-message" style="margin: 0; color: #4B5563;"></p>
            </div>
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
                    <button onclick="showEmailModal()" class="btn">📧 Email Me This Roadmap</button>
                    <a href="{{ booking_url }}" class="btn btn-secondary">📞 Book Consultation Call</a>
                </div>
            </div>
        </div>
        <hr>
        <div class="explanation-box">
            <h4>How These Numbers Are Calculated</h4>
            <p><strong>Annual Burn Rate (Efficiency Loss):</strong></p>
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
            <p><strong>Tier 1 Savings (Immediate Opportunity - 40% Reduction):</strong></p>
            <p>A conservative estimate assuming 40% reduction in administrative time through Phase 1 automation (e.g., automated data extraction, document processing):</p>
            <ul>
                <li><strong>Annual Burn Rate</strong> × <strong>40%</strong></li>
                <li>This represents the "low-hanging fruit" - quick wins that can be implemented in the first 3-6 months</li>
            </ul>
            <p><strong>Tier 2 Opportunity (Expanded Automation - 70% Reduction):</strong></p>
            <p>Further automation and workflow optimization, expanding beyond initial use cases:</p>
            <ul>
                <li><strong>Annual Burn Rate</strong> × <strong>70%</strong></li>
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
        <div class="btn-group">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=2, industry=industry) }}" class="btn btn-secondary">← Back to Data Entry</a>
            <a href="{{ url_for('roi_calculator.roi_calculator', step=4) }}" class="btn">Generate PDF Report →</a>
        </div>
        <!-- Email Capture Modal -->
        <div id="email-modal" class="email-capture-modal">
            <div class="email-capture-content">
                <h3 style="color: #0B1221; margin-bottom: 1rem;">Get Your Custom Roadmap</h3>
                <p style="color: #4B5563; margin-bottom: 1.5rem;">Enter your email to receive your personalized automation roadmap with all calculations and implementation phases.</p>
                <form id="email-form" onsubmit="submitEmailForm(event)">
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" name="email" id="roadmap-email" required 
                               style="width: 100%; padding: 0.75rem; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 1rem;">
                    </div>
                    <div class="form-group">
                        <label>Company Name (Optional)</label>
                        <input type="text" name="company" id="roadmap-company" 
                               style="width: 100%; padding: 0.75rem; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 1rem;">
                    </div>
                    <div class="btn-group" style="margin-top: 1.5rem;">
                        <button type="submit" class="btn">Send Roadmap</button>
                        <button type="button" onclick="closeEmailModal()" class="btn btn-secondary">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
        
        <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
        <script>
            var chartData = {{ chart_json|safe }};
            Plotly.newPlot('chart', chartData.data, chartData.layout);
            
            // Readiness response data
            var readinessResponses = {
                structured: {
                    title: "✅ Great! You're AI-Ready",
                    message: "Your structured data infrastructure means we can start automation quickly. Let's discuss which high-value tasks to automate first to maximize your ROI."
                },
                mixed: {
                    title: "⚠️ Needs Preparation (Most Common)",
                    message: "Like 70% of firms, your data needs some preparation. We can show you the fastest path to AI-ready infrastructure—typically 2-4 weeks of data structuring before automation begins."
                },
                chaotic: {
                    title: "🚨 High Friction (Not Uncommon)",
                    message: "You're not alone—many firms start here. The good news: we've helped 50+ companies go from chaos to automated in 8-12 weeks. The key is a structured migration plan."
                }
            };
            
            function showReadinessResponse(selection) {
                var response = readinessResponses[selection];
                if (response) {
                    document.getElementById('response-title').textContent = response.title;
                    document.getElementById('response-message').textContent = response.message;
                    document.getElementById('readiness-response').style.display = 'block';
                }
            }
            
            function showEmailModal() {
                document.getElementById('email-modal').classList.add('active');
            }
            
            function closeEmailModal() {
                document.getElementById('email-modal').classList.remove('active');
                document.getElementById('email-form').reset();
            }
            
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
            
            function submitEmailForm(event) {
                event.preventDefault();
                var email = document.getElementById('roadmap-email').value;
                var company = document.getElementById('roadmap-company').value;
                
                // Submit to backend
                fetch('{{ url_for("roi_calculator.send_roadmap_email") }}', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: email,
                        company: company
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert('Roadmap sent! Check your email.');
                        closeEmailModal();
                    } else {
                        alert('Error: ' + (data.error || 'Failed to send email'));
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert('Error sending email. Please try again.');
                });
            }
            
            // Close modal on outside click
            document.getElementById('email-modal').addEventListener('click', function(e) {
                if (e.target === this) {
                    closeEmailModal();
                }
            });
        </script>
        
        {% elif step == 4 %}
        <div class="step-indicator">
            <a href="{{ url_for('roi_calculator.roi_calculator', step=1) }}" class="step completed">1</a>
            <a href="{{ url_for('roi_calculator.roi_calculator', step=2, industry=industry) }}" class="step completed">2</a>
            <a href="{{ url_for('roi_calculator.roi_calculator', step=3) }}" class="step completed">3</a>
            <span class="step active">4</span>
        </div>
        <h1>Download Your Business Case</h1>
        <hr>
        <h3>Your PDF Report is Ready</h3>
        <p>Click the button below to download your personalized ROI Business Case PDF.</p>
        <div class="btn-group">
            <a href="{{ url_for('roi_calculator.download_pdf') }}" class="btn">📥 Download Business Case PDF</a>
        </div>
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
def roi_calculator():
    step = int(request.args.get('step', request.form.get('step', 1)))
    industry = request.args.get('industry') or request.form.get('industry') or session.get('industry')
    selected_industry = industry
    
    # If industry is provided via URL parameter and we're on step 1, auto-advance to step 2
    if industry and step == 1 and request.method == 'GET':
        # Validate industry exists in INDUSTRIES
        if industry in INDUSTRIES:
            session['industry'] = industry
            step = 2
    
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
        
        industry_config = INDUSTRIES[industry]
        
        # Handle form submission
        if request.method == 'POST' and action == 'calculate':
            # Get values from form - prioritize form values over session/defaults
            staff_count_str = request.form.get('staff_count', '').strip()
            staff_count = int(staff_count_str) if staff_count_str else int(session.get('staff_count', 50))
            
            avg_rate_str = request.form.get('avg_rate', '').strip()
            avg_rate = float(avg_rate_str) if avg_rate_str else float(session.get('avg_rate', 185))
            
            platform = request.form.get('platform', '').strip() or session.get('platform', 'M365/SharePoint')
            
            pain_point_str = request.form.get('pain_point', '').strip()
            pain_point = int(pain_point_str) if pain_point_str else int(session.get('pain_point', 5))
            
            weekly_waste_str = request.form.get('weekly_waste', '').strip()
            weekly_waste = float(weekly_waste_str) if weekly_waste_str else float(session.get('weekly_waste', 5.0))
            
            # Save to session
            session['staff_count'] = staff_count
            session['avg_rate'] = avg_rate
            session['platform'] = platform
            session['pain_point'] = pain_point
            session['weekly_waste'] = weekly_waste
            session['industry'] = industry
            
            # Redirect to step 3 with values in URL as backup (in case session doesn't persist)
            return redirect(url_for('roi_calculator.roi_calculator', 
                                  step=3,
                                  staff_count=staff_count,
                                  avg_rate=avg_rate,
                                  weekly_waste=weekly_waste,
                                  pain_point=pain_point,
                                  platform=platform,
                                  industry=industry))
        
        # Get values from session or defaults
        staff_count = int(request.form.get('staff_count', session.get('staff_count', 50)))
        avg_rate = float(request.form.get('avg_rate', session.get('avg_rate', 185)))
        platform = request.form.get('platform', session.get('platform', 'M365/SharePoint'))
        pain_point = request.form.get('pain_point')
        if pain_point:
            pain_point = int(pain_point)
        else:
            pain_point = session.get('pain_point')
        weekly_waste = request.form.get('weekly_waste')
        if weekly_waste:
            weekly_waste = float(weekly_waste)
        else:
            weekly_waste = session.get('weekly_waste', 5.0)
        
        return render_template_string(HTML_TEMPLATE,
            step=2,
            industry=industry,
            industry_config=industry_config,
            staff_count=staff_count,
            avg_rate=avg_rate,
            platform=platform,
            pain_point=pain_point,
            weekly_waste=weekly_waste)
    
    # Step 3: Results
    if step == 3:
        # Get values from form first (if submitted), then session, then defaults
        # This ensures we use the actual submitted values
        staff_count = int(request.form.get('staff_count') or request.args.get('staff_count') or session.get('staff_count') or 50)
        avg_rate = float(request.form.get('avg_rate') or request.args.get('avg_rate') or session.get('avg_rate') or 185)
        weekly_waste = float(request.form.get('weekly_waste') or request.args.get('weekly_waste') or session.get('weekly_waste') or 5.0)
        pain_point = int(request.form.get('pain_point') or request.args.get('pain_point') or session.get('pain_point') or 5)
        platform = request.form.get('platform') or request.args.get('platform') or session.get('platform') or 'M365/SharePoint'
        
        # Validate values are within acceptable ranges (but don't reset to defaults if they're valid)
        if staff_count < 10:
            staff_count = max(10, staff_count)  # Ensure minimum, but don't override user input
        if avg_rate < 50:
            avg_rate = max(50, avg_rate)  # Ensure minimum, but don't override user input
        if weekly_waste < 0:
            weekly_waste = max(0, weekly_waste)  # Ensure non-negative
        
        # Save to session to ensure persistence
        session['staff_count'] = staff_count
        session['avg_rate'] = avg_rate
        session['weekly_waste'] = weekly_waste
        session['pain_point'] = pain_point
        session['platform'] = platform
        
        calculations = calculate_metrics(staff_count, avg_rate, weekly_waste, pain_point)
        session['calculations'] = calculations
        
        # Create chart data with proper formatting
        chart_data = {
            "data": [{
                "x": ["Current<br>State", "Tier 1<br>(40% Reduction)", "Tier 2<br>(70% Reduction)"],
                "y": [
                    calculations['annual_burn'],
                    calculations['tier_1_cost'],
                    calculations['tier_2_cost']
                ],
                "type": "bar",
                "marker": {"color": ["#0B1221", "#D4AF37", "#B8941F"]},
                "text": [format_currency(calculations['annual_burn']), 
                        format_currency(calculations['tier_1_cost']),
                        format_currency(calculations['tier_2_cost'])],
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
        if calculations['pain_point'] >= 8:
            analysis_text.append("⚠️ <strong>High Risk Profile:</strong> You have a high risk profile for transcription errors that could impact project quality and compliance.")
        if calculations['weekly_waste'] > 5:
            waste_percentage = (calculations['weekly_waste'] / 40) * 100
            analysis_text.append(f"📊 <strong>Time Allocation:</strong> Your senior staff are spending {waste_percentage:.1f}%+ of their time on non-billable administrative work.")
        if calculations['annual_burn'] > 100000:
            analysis_text.append(f"💰 <strong>Significant Opportunity:</strong> With an annual burn rate of {format_currency(calculations['annual_burn'])}, automation could deliver substantial ROI within the first year.")
        if not analysis_text:
            analysis_text.append("✅ Your organization shows moderate efficiency opportunities. Automation can still deliver meaningful improvements.")
        
        # Get platform and other values for display
        platform = session.get('platform', 'M365/SharePoint')
        
        # Get AI opportunities for this industry
        ai_opportunities = AI_OPPORTUNITIES.get(industry, [])
        
        # Generate automation roadmap
        roadmap = generate_automation_roadmap(industry, staff_count, avg_rate, weekly_waste)
        
        return render_template_string(HTML_TEMPLATE,
            step=3,
            industry=industry,
            staff_count=staff_count,
            avg_rate=avg_rate,
            platform=platform,
            calculations=calculations,
            chart_json=json.dumps(chart_data, cls=plotly.utils.PlotlyJSONEncoder),
            analysis_text=analysis_text,
            ai_opportunities=ai_opportunities,
            roadmap=roadmap,
            booking_url=BOOKING_URL,
            format_currency=format_currency)
    
    # Step 4: PDF Download
    if step == 4:
        return render_template_string(HTML_TEMPLATE,
            step=4,
            booking_url=BOOKING_URL)

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
                <p><strong>Tech Stack:</strong> {platform}</p>
            </div>
            
            <div class="section">
                <h2>ROI Summary</h2>
                <p><strong>Annual Efficiency Loss:</strong> ${calculations['annual_burn']:,.0f}</p>
                <p><strong>Tier 1 Savings (40%):</strong> ${calculations['tier_1_savings']:,.0f}/year</p>
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
    
    pdf_buffer = generate_pdf_report(industry, staff_count, avg_rate, platform, calculations)
    
    return send_file(
        pdf_buffer,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'Curam_AI_ROI_Report_{datetime.now().strftime("%Y%m%d")}.pdf'
    )

# Note: This blueprint should be registered in main.py
# Example: app.register_blueprint(roi_app, url_prefix='/roi-calculator')

