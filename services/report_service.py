"""
Report Generation Service for Phase 1 Feasibility Sprint Reports

Generates comprehensive PDF reports including:
- Executive summary
- Technical validation results
- Accuracy metrics by document type
- Edge case analysis
- ROI/Value assessment
- Limitations and assumptions
- Phase 2 recommendations
"""

import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from io import BytesIO

from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.units import mm, inch
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, ListFlowable, ListItem
)
from reportlab.pdfgen import canvas

BRAND_NAVY = HexColor('#0B1221')
BRAND_GOLD = HexColor('#D4AF37')
BRAND_LIGHT_GOLD = HexColor('#FFFBF0')
BRAND_SUCCESS = HexColor('#10B981')
BRAND_WARNING = HexColor('#F59E0B')
BRAND_ERROR = HexColor('#EF4444')
BRAND_GRAY = HexColor('#6B7280')
BRAND_LIGHT_GRAY = HexColor('#F3F4F6')


def calculate_trial_metrics(trial: Dict, documents: List[Dict], results: List[Dict]) -> Dict:
    """Calculate all metrics for the feasibility report"""
    
    total_docs = len(documents) if documents else 0
    processed_docs = len([d for d in documents if d.get('status') == 'completed'])
    
    total_fields = 0
    correct_fields = 0
    flagged_fields = 0
    false_positives = 0
    exception_docs = 0
    edge_cases = []
    category_metrics = {}
    
    for doc in documents:
        doc_fields_extracted = doc.get('fields_extracted', 0) or 0
        doc_fields_correct = doc.get('fields_correct', 0) or 0
        doc_fields_flagged = doc.get('fields_flagged', 0) or 0
        doc_false_positives = doc.get('false_positives', 0) or 0
        
        total_fields += doc_fields_extracted
        correct_fields += doc_fields_correct
        flagged_fields += doc_fields_flagged
        false_positives += doc_false_positives
        
        if doc_fields_flagged > 0:
            exception_docs += 1
        
        if doc.get('is_edge_case'):
            edge_cases.append({
                'filename': doc.get('original_filename', 'Unknown'),
                'category': doc.get('document_category', 'Unknown'),
                'notes': doc.get('notes', '')
            })
        
        category = doc.get('document_category', 'Uncategorized')
        if category not in category_metrics:
            category_metrics[category] = {
                'doc_count': 0,
                'fields_extracted': 0,
                'fields_correct': 0,
                'fields_flagged': 0
            }
        category_metrics[category]['doc_count'] += 1
        category_metrics[category]['fields_extracted'] += doc_fields_extracted
        category_metrics[category]['fields_correct'] += doc_fields_correct
        category_metrics[category]['fields_flagged'] += doc_fields_flagged
    
    overall_accuracy = (correct_fields / total_fields * 100) if total_fields > 0 else 0
    stp_rate = ((correct_fields - flagged_fields) / total_fields * 100) if total_fields > 0 else 0
    stp_rate = max(0, stp_rate)
    
    staff_count = trial.get('staff_count', 50)
    doc_staff_count = trial.get('doc_staff_count', staff_count)
    hourly_rate = trial.get('blended_hourly_rate', 55)
    weekly_volume = trial.get('weekly_doc_volume', 100)
    manual_minutes = trial.get('manual_process_minutes', 12)
    error_rate = trial.get('current_error_rate', 4) / 100
    error_cost = trial.get('error_correction_cost', 85)
    target_stp = (trial.get('target_stp_rate', 75) or 75) / 100
    
    annual_docs = weekly_volume * 52
    manual_hours = annual_docs * (manual_minutes / 60)
    manual_cost = manual_hours * hourly_rate
    
    tier1_savings = manual_cost * target_stp
    
    error_reduction = 0.03
    tier2_savings = annual_docs * error_rate * error_reduction * error_cost
    
    total_value = tier1_savings + tier2_savings
    
    return {
        'total_documents': total_docs,
        'processed_documents': processed_docs,
        'total_fields': total_fields,
        'correct_fields': correct_fields,
        'flagged_fields': flagged_fields,
        'false_positives': false_positives,
        'overall_accuracy': overall_accuracy,
        'stp_rate': stp_rate,
        'edge_cases': edge_cases,
        'edge_case_count': len(edge_cases),
        'category_metrics': category_metrics,
        'business_profile': {
            'staff_count': staff_count,
            'doc_staff_count': doc_staff_count,
            'hourly_rate': hourly_rate,
            'weekly_volume': weekly_volume,
            'annual_docs': annual_docs,
            'manual_minutes': manual_minutes,
            'error_rate': error_rate * 100,
            'error_cost': error_cost,
            'target_stp': target_stp * 100
        },
        'value_assessment': {
            'tier1_savings': tier1_savings,
            'tier2_savings': tier2_savings,
            'total_value': total_value,
            'manual_hours': manual_hours,
            'manual_cost': manual_cost
        },
        'test_results': {
            'accuracy_pass': overall_accuracy >= 90,
            'stp_pass': stp_rate >= 60,
            'exceptions_count': exception_docs
        },
        'exception_docs': exception_docs,
        'recommendation': 'proceed' if (overall_accuracy >= 90 and stp_rate >= 60) else 'review'
    }


def get_phase2_questions(trial: Dict, metrics: Dict) -> List[str]:
    """Generate tailored Phase 2 questions based on trial results"""
    questions = []
    
    if metrics['edge_case_count'] > 0:
        questions.append(f"How should the system handle the {metrics['edge_case_count']} edge-case document format(s) identified?")
    
    if metrics['stp_rate'] < 75:
        questions.append("Would you like to explore additional validation rules to increase the straight-through processing rate?")
    
    if metrics['business_profile']['weekly_volume'] > 200:
        questions.append("Given your high document volume, should we prioritize batch processing capabilities in the solution architecture?")
    
    infrastructure = trial.get('infrastructure_type', '')
    if infrastructure in ['M365 E3', 'M365 E5']:
        questions.append("Should we leverage your Microsoft 365 environment for Power Automate integration and SharePoint document storage?")
    elif infrastructure == 'Google Workspace':
        questions.append("Would Google Drive integration for document staging be beneficial for your workflow?")
    
    questions.extend([
        "What ERP/accounting systems would require direct API integration for extracted data?",
        "Are there approval workflows that should be built into the exception handling process?",
        "What security/compliance requirements (ISO 27001, SOC 2, etc.) need to be addressed in the architecture?"
    ])
    
    return questions[:8]


def get_limitations_text(trial: Dict, metrics: Dict) -> List[str]:
    """Generate limitations and assumptions based on trial data"""
    limitations = []
    
    limitations.append(f"Accuracy metrics based on {metrics['total_documents']} sample documents; production accuracy may vary with document diversity.")
    
    if metrics['total_documents'] < 10:
        limitations.append("Small sample size (< 10 documents) may not fully represent production document variability.")
    
    if metrics['edge_case_count'] > 3:
        limitations.append(f"High edge-case ratio ({metrics['edge_case_count']}/{metrics['total_documents']} documents) suggests additional document preprocessing may be required.")
    
    bp = metrics['business_profile']
    limitations.extend([
        f"ROI calculations assume {bp['weekly_volume']} documents/week at current volume; actual savings scale with volume changes.",
        f"Blended hourly rate of ${bp['hourly_rate']:.0f}/hr includes on-costs; validate this aligns with internal cost models.",
        f"Error reduction projections assume 3% of flagged documents prevent costly downstream errors; adjust based on actual error impact.",
        f"Target STP rate of {bp['target_stp']:.0f}% is achievable with current document quality; may require improvement for edge cases."
    ])
    
    custom_limitations = trial.get('limitations_notes', '')
    if custom_limitations:
        limitations.append(custom_limitations)
    
    return limitations


class ReportGenerator:
    """Generates PDF reports for Phase 1 feasibility sprints"""
    
    def __init__(self, trial: Dict, documents: List[Dict], results: List[Dict]):
        self.trial = trial
        self.documents = documents or []
        self.results = results or []
        self.metrics = calculate_trial_metrics(trial, documents, results)
        self.styles = self._create_styles()
    
    def _create_styles(self):
        """Create custom paragraph styles"""
        styles = getSampleStyleSheet()
        
        styles.add(ParagraphStyle(
            'CoverTitle',
            parent=styles['Heading1'],
            fontSize=32,
            textColor=BRAND_GOLD,
            alignment=TA_CENTER,
            spaceAfter=12
        ))
        
        styles.add(ParagraphStyle(
            'CoverSubtitle',
            parent=styles['Normal'],
            fontSize=18,
            textColor=white,
            alignment=TA_CENTER,
            spaceAfter=24
        ))
        
        styles.add(ParagraphStyle(
            'SectionTitle',
            parent=styles['Heading1'],
            fontSize=18,
            textColor=BRAND_NAVY,
            spaceBefore=20,
            spaceAfter=12,
            borderColor=BRAND_GOLD,
            borderWidth=2,
            borderPadding=6
        ))
        
        styles.add(ParagraphStyle(
            'SubsectionTitle',
            parent=styles['Heading2'],
            fontSize=14,
            textColor=BRAND_NAVY,
            spaceBefore=16,
            spaceAfter=8
        ))
        
        styles.add(ParagraphStyle(
            'BodyText',
            parent=styles['Normal'],
            fontSize=11,
            textColor=black,
            spaceBefore=6,
            spaceAfter=6,
            leading=16
        ))
        
        styles.add(ParagraphStyle(
            'MetricValue',
            parent=styles['Normal'],
            fontSize=28,
            textColor=BRAND_NAVY,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        ))
        
        styles.add(ParagraphStyle(
            'MetricLabel',
            parent=styles['Normal'],
            fontSize=10,
            textColor=BRAND_GRAY,
            alignment=TA_CENTER,
            spaceAfter=8
        ))
        
        return styles
    
    def generate_pdf(self) -> BytesIO:
        """Generate the complete PDF report"""
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=20*mm,
            leftMargin=20*mm,
            topMargin=20*mm,
            bottomMargin=20*mm
        )
        
        story = []
        
        story.extend(self._build_cover_page())
        story.append(PageBreak())
        
        story.extend(self._build_executive_summary())
        story.append(PageBreak())
        
        story.extend(self._build_technical_validation())
        story.append(PageBreak())
        
        story.extend(self._build_accuracy_by_category())
        story.append(PageBreak())
        
        story.extend(self._build_value_assessment())
        story.append(PageBreak())
        
        story.extend(self._build_limitations())
        story.append(PageBreak())
        
        story.extend(self._build_phase2_questions())
        story.append(PageBreak())
        
        story.extend(self._build_conclusion())
        
        doc.build(story)
        buffer.seek(0)
        return buffer
    
    def _build_cover_page(self) -> List:
        """Build the cover page"""
        elements = []
        
        elements.append(Spacer(1, 80*mm))
        
        elements.append(Paragraph("CURAM-AI", self.styles['CoverTitle']))
        elements.append(Spacer(1, 5*mm))
        elements.append(Paragraph("Phase 1 – Feasibility Sprint Report", self.styles['SubsectionTitle']))
        elements.append(Spacer(1, 20*mm))
        
        company = self.trial.get('customer_company', 'Client')
        elements.append(Paragraph(f"<b>{company}</b>", self.styles['Heading1']))
        elements.append(Spacer(1, 5*mm))
        
        industry = self.trial.get('industry', 'Professional Services')
        elements.append(Paragraph(f"{industry} Sector Analysis", self.styles['Normal']))
        elements.append(Spacer(1, 30*mm))
        
        date_str = datetime.now().strftime('%B %Y')
        elements.append(Paragraph(f"Generated: {date_str}", self.styles['Normal']))
        elements.append(Paragraph(f"Trial Code: {self.trial.get('trial_code', 'N/A')}", self.styles['Normal']))
        
        return elements
    
    def _build_executive_summary(self) -> List:
        """Build executive summary section"""
        elements = []
        
        elements.append(Paragraph("1. Executive Summary", self.styles['SectionTitle']))
        elements.append(Spacer(1, 5*mm))
        
        metrics = self.metrics
        accuracy = metrics['overall_accuracy']
        stp = metrics['stp_rate']
        total_value = metrics['value_assessment']['total_value']
        
        summary_text = f"""
        This feasibility sprint tested {metrics['total_documents']} documents from 
        {self.trial.get('customer_company', 'the client')} to validate AI-powered document extraction 
        accuracy and straight-through processing rates.
        """
        elements.append(Paragraph(summary_text, self.styles['BodyText']))
        elements.append(Spacer(1, 5*mm))
        
        results_data = [
            ['Metric', 'Result', 'Threshold', 'Status'],
            ['Field Accuracy', f"{accuracy:.1f}%", '≥ 90%', 'PASS' if accuracy >= 90 else 'FAIL'],
            ['STP Rate', f"{stp:.1f}%", '≥ 60%', 'PASS' if stp >= 60 else 'FAIL'],
            ['Exceptions', str(metrics['exception_docs']), '< 8', 'PASS' if metrics['exception_docs'] < 8 else 'REVIEW']
        ]
        
        results_table = Table(results_data, colWidths=[80*mm, 35*mm, 30*mm, 25*mm])
        results_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), BRAND_NAVY),
            ('TEXTCOLOR', (0, 0), (-1, 0), white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), BRAND_LIGHT_GRAY),
            ('GRID', (0, 0), (-1, -1), 1, BRAND_GRAY),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, BRAND_LIGHT_GRAY])
        ]))
        
        elements.append(results_table)
        elements.append(Spacer(1, 8*mm))
        
        elements.append(Paragraph("Indicative Value Assessment", self.styles['SubsectionTitle']))
        
        value_data = [
            ['Tier 1: Time Savings', 'Tier 2: Error Reduction', 'Total Annual Value'],
            [f"${metrics['value_assessment']['tier1_savings']:,.0f}", 
             f"${metrics['value_assessment']['tier2_savings']:,.0f}",
             f"${total_value:,.0f}"]
        ]
        
        value_table = Table(value_data, colWidths=[60*mm, 60*mm, 60*mm])
        value_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), BRAND_NAVY),
            ('TEXTCOLOR', (0, 0), (-1, 0), white),
            ('BACKGROUND', (0, 1), (-1, 1), BRAND_LIGHT_GOLD),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 1), (-1, 1), 14),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('GRID', (0, 0), (-1, -1), 1, BRAND_GOLD)
        ]))
        
        elements.append(value_table)
        elements.append(Spacer(1, 5*mm))
        
        if metrics['recommendation'] == 'proceed':
            rec_text = "<b>Recommendation:</b> All tests passed. Proceed to Phase 2 deep-dive analysis."
        else:
            rec_text = "<b>Recommendation:</b> Results require review. Consider document quality improvements before Phase 2."
        
        elements.append(Paragraph(rec_text, self.styles['BodyText']))
        
        return elements
    
    def _build_technical_validation(self) -> List:
        """Build technical validation section"""
        elements = []
        
        elements.append(Paragraph("2. Technical Validation", self.styles['SectionTitle']))
        elements.append(Spacer(1, 5*mm))
        
        elements.append(Paragraph("2.1 Test Methodology", self.styles['SubsectionTitle']))
        methodology = f"""
        The feasibility sprint tested {self.metrics['total_documents']} documents provided by the client, 
        distributed across {len(self.metrics['category_metrics'])} document categories. Each document was 
        processed through the Curam-Ai extraction pipeline using Google Gemini 2.5 Flash for text extraction 
        and structured data parsing.
        """
        elements.append(Paragraph(methodology, self.styles['BodyText']))
        elements.append(Spacer(1, 3*mm))
        
        elements.append(Paragraph("2.2 Accuracy Criteria", self.styles['SubsectionTitle']))
        criteria = [
            "Pass Threshold: ≥ 90% field-level accuracy",
            "STP Threshold: ≥ 60% straight-through processing rate",
            "Exception Threshold: < 8 documents requiring manual review"
        ]
        for c in criteria:
            elements.append(Paragraph(f"• {c}", self.styles['BodyText']))
        
        elements.append(Spacer(1, 3*mm))
        
        elements.append(Paragraph("2.3 Processing Results", self.styles['SubsectionTitle']))
        results_text = f"""
        Total Fields Extracted: {self.metrics['total_fields']}<br/>
        Correct Extractions: {self.metrics['correct_fields']} ({self.metrics['overall_accuracy']:.1f}%)<br/>
        Flagged for Review: {self.metrics['flagged_fields']}<br/>
        False Positives: {self.metrics['false_positives']}
        """
        elements.append(Paragraph(results_text, self.styles['BodyText']))
        
        return elements
    
    def _build_accuracy_by_category(self) -> List:
        """Build accuracy by document category section"""
        elements = []
        
        elements.append(Paragraph("3. Accuracy by Document Category", self.styles['SectionTitle']))
        elements.append(Spacer(1, 5*mm))
        
        cat_data = [['Category', 'Documents', 'Fields', 'Correct', 'Accuracy', 'Status']]
        
        for cat_name, cat_metrics in self.metrics['category_metrics'].items():
            accuracy = (cat_metrics['fields_correct'] / cat_metrics['fields_extracted'] * 100) if cat_metrics['fields_extracted'] > 0 else 0
            status = 'PASS' if accuracy >= 90 else 'REVIEW'
            cat_data.append([
                cat_name,
                str(cat_metrics['doc_count']),
                str(cat_metrics['fields_extracted']),
                str(cat_metrics['fields_correct']),
                f"{accuracy:.1f}%",
                status
            ])
        
        cat_table = Table(cat_data, colWidths=[50*mm, 25*mm, 25*mm, 25*mm, 25*mm, 25*mm])
        cat_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), BRAND_NAVY),
            ('TEXTCOLOR', (0, 0), (-1, 0), white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 1, BRAND_GRAY),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, BRAND_LIGHT_GRAY])
        ]))
        
        elements.append(cat_table)
        elements.append(Spacer(1, 8*mm))
        
        if self.metrics['edge_cases']:
            elements.append(Paragraph("3.1 Edge Cases Identified", self.styles['SubsectionTitle']))
            elements.append(Paragraph(
                f"{len(self.metrics['edge_cases'])} documents were flagged as edge cases requiring special handling:",
                self.styles['BodyText']
            ))
            
            for ec in self.metrics['edge_cases']:
                ec_text = f"• <b>{ec['filename']}</b> ({ec['category']})"
                if ec.get('notes'):
                    ec_text += f" - {ec['notes']}"
                elements.append(Paragraph(ec_text, self.styles['BodyText']))
        
        return elements
    
    def _build_value_assessment(self) -> List:
        """Build value assessment section"""
        elements = []
        
        elements.append(Paragraph("4. Value Assessment", self.styles['SectionTitle']))
        elements.append(Spacer(1, 5*mm))
        
        bp = self.metrics['business_profile']
        va = self.metrics['value_assessment']
        
        elements.append(Paragraph("4.1 Business Profile", self.styles['SubsectionTitle']))
        profile_data = [
            ['Parameter', 'Value', 'Notes'],
            ['Total Staff', str(bp['staff_count']), 'Firm headcount'],
            ['Documentation Staff', str(bp['doc_staff_count']), 'Staff handling documents'],
            ['Blended Hourly Rate', f"${bp['hourly_rate']:.0f}", 'Including on-costs'],
            ['Weekly Document Volume', str(bp['weekly_volume']), 'Documents per week'],
            ['Annual Volume', f"{bp['annual_docs']:,}", 'Projected annual throughput'],
            ['Manual Processing Time', f"{bp['manual_minutes']} min", 'Per document'],
            ['Current Error Rate', f"{bp['error_rate']:.1f}%", 'Estimated baseline'],
            ['Target STP Rate', f"{bp['target_stp']:.0f}%", 'Automation target']
        ]
        
        profile_table = Table(profile_data, colWidths=[60*mm, 40*mm, 70*mm])
        profile_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), BRAND_NAVY),
            ('TEXTCOLOR', (0, 0), (-1, 0), white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, BRAND_GRAY),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, BRAND_LIGHT_GRAY])
        ]))
        elements.append(profile_table)
        elements.append(Spacer(1, 8*mm))
        
        elements.append(Paragraph("4.2 ROI Calculation", self.styles['SubsectionTitle']))
        
        tier1_text = f"""
        <b>Tier 1: Time Savings from Straight-Through Processing</b><br/>
        Annual documents ({bp['annual_docs']:,}) × Manual time ({bp['manual_minutes']} min) × Hourly rate (${bp['hourly_rate']:.0f}/hr) × STP rate ({bp['target_stp']:.0f}%)<br/>
        = <b>${va['tier1_savings']:,.0f}</b> annual savings
        """
        elements.append(Paragraph(tier1_text, self.styles['BodyText']))
        elements.append(Spacer(1, 3*mm))
        
        tier2_text = f"""
        <b>Tier 2: Error Reduction Savings</b><br/>
        Annual documents ({bp['annual_docs']:,}) × Error rate ({bp['error_rate']:.1f}%) × Error reduction (3%) × Correction cost (${bp.get('error_cost', 85):.0f})<br/>
        = <b>${va['tier2_savings']:,.0f}</b> annual savings
        """
        elements.append(Paragraph(tier2_text, self.styles['BodyText']))
        elements.append(Spacer(1, 5*mm))
        
        total_text = f"""
        <b>Total Indicative Annual Value: ${va['total_value']:,.0f}</b>
        """
        elements.append(Paragraph(total_text, self.styles['BodyText']))
        
        return elements
    
    def _build_limitations(self) -> List:
        """Build limitations section"""
        elements = []
        
        elements.append(Paragraph("5. Limitations & Assumptions", self.styles['SectionTitle']))
        elements.append(Spacer(1, 5*mm))
        
        limitations = get_limitations_text(self.trial, self.metrics)
        for i, limitation in enumerate(limitations, 1):
            elements.append(Paragraph(f"{i}. {limitation}", self.styles['BodyText']))
        
        return elements
    
    def _build_phase2_questions(self) -> List:
        """Build Phase 2 questions section"""
        elements = []
        
        elements.append(Paragraph("6. Phase 2 Discovery Questions", self.styles['SectionTitle']))
        elements.append(Spacer(1, 5*mm))
        
        intro = """
        The following questions will be addressed in the Phase 2 deep-dive analysis to develop 
        a board-ready business case and implementation roadmap:
        """
        elements.append(Paragraph(intro, self.styles['BodyText']))
        elements.append(Spacer(1, 3*mm))
        
        questions = get_phase2_questions(self.trial, self.metrics)
        for i, question in enumerate(questions, 1):
            elements.append(Paragraph(f"{i}. {question}", self.styles['BodyText']))
        
        return elements
    
    def _build_conclusion(self) -> List:
        """Build conclusion section"""
        elements = []
        
        elements.append(Paragraph("7. Conclusion & Next Steps", self.styles['SectionTitle']))
        elements.append(Spacer(1, 5*mm))
        
        if self.metrics['recommendation'] == 'proceed':
            conclusion = f"""
            Based on the feasibility sprint results, <b>{self.trial.get('customer_company', 'the client')}</b> 
            has achieved the required accuracy thresholds for AI-powered document automation. 
            With {self.metrics['overall_accuracy']:.1f}% field accuracy and {self.metrics['stp_rate']:.1f}% 
            straight-through processing rate, the technology is ready for Phase 2 implementation planning.
            <br/><br/>
            The indicative annual value of <b>${self.metrics['value_assessment']['total_value']:,.0f}</b> 
            represents conservative estimates based on the business profile provided. Phase 2 will 
            refine these calculations with detailed process mapping and integration requirements.
            """
        else:
            conclusion = f"""
            The feasibility sprint results indicate that additional optimization may be required 
            before proceeding to full implementation. While the technology successfully processed 
            the test documents, the current accuracy of {self.metrics['overall_accuracy']:.1f}% and 
            STP rate of {self.metrics['stp_rate']:.1f}% fall below the recommended thresholds.
            <br/><br/>
            We recommend reviewing the edge cases identified and considering document quality 
            improvements before proceeding to Phase 2. Alternatively, a targeted pilot program 
            could focus on the document types that achieved the highest accuracy.
            """
        
        elements.append(Paragraph(conclusion, self.styles['BodyText']))
        elements.append(Spacer(1, 8*mm))
        
        elements.append(Paragraph("<b>Next Steps:</b>", self.styles['BodyText']))
        next_steps = [
            "Schedule Phase 2 discovery call to review detailed requirements",
            "Provide additional sample documents for any new document types",
            "Identify key stakeholders for the implementation project",
            "Review integration requirements with IT/operations teams"
        ]
        for step in next_steps:
            elements.append(Paragraph(f"• {step}", self.styles['BodyText']))
        
        elements.append(Spacer(1, 15*mm))
        
        elements.append(Paragraph("For questions about this report:", self.styles['BodyText']))
        elements.append(Paragraph("<b>Curam-Ai Protocol</b>", self.styles['BodyText']))
        elements.append(Paragraph("www.curam-ai.com.au", self.styles['BodyText']))
        
        return elements


def generate_phase1_report(trial_id: int) -> Optional[BytesIO]:
    """Generate a Phase 1 feasibility report for a given trial"""
    from database import get_phase1_trial, get_trial_documents, get_trial_results
    
    trial = get_phase1_trial(trial_id=trial_id)
    if not trial:
        return None
    
    documents = get_trial_documents(trial_id)
    results = get_trial_results(trial_id)
    
    generator = ReportGenerator(trial, documents, results)
    return generator.generate_pdf()
