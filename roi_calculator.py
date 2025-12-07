import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import io

# Configuration
BOOKING_URL = "/booking.html"  # Update this to your actual booking page URL
COMPANY_NAME = "Curam AI"

# Page configuration
st.set_page_config(
    page_title="Curam AI - ROI Calculator",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Custom CSS styling
st.markdown("""
<style>
    /* Main theme colors */
    :root {
        --midnight-blue: #0B1221;
        --gold: #D4AF37;
        --bg-light: #F8F9FA;
        --text-dark: #4B5563;
    }
    
    /* Hide Streamlit default elements */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    
    /* Main container */
    .main .block-container {
        padding-top: 2rem;
        padding-bottom: 2rem;
        max-width: 900px;
    }
    
    /* Headings */
    h1 {
        color: #0B1221;
        font-family: 'Playfair Display', serif;
        font-weight: 700;
        margin-bottom: 0.5rem;
    }
    
    h2 {
        color: #0B1221;
        font-family: 'Playfair Display', serif;
        font-weight: 600;
        margin-top: 2rem;
        margin-bottom: 1rem;
    }
    
    h3 {
        color: #0B1221;
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        margin-top: 1.5rem;
    }
    
    /* Body text */
    .stMarkdown {
        color: #4B5563;
        font-family: 'Inter', sans-serif;
    }
    
    /* Buttons */
    .stButton > button {
        background-color: #D4AF37;
        color: #0B1221;
        font-weight: 600;
        border: none;
        border-radius: 6px;
        padding: 0.5rem 2rem;
        font-family: 'Inter', sans-serif;
        transition: all 0.3s ease;
    }
    
    .stButton > button:hover {
        background-color: #B8941F;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }
    
    /* Secondary button */
    .secondary-button {
        background-color: #0B1221 !important;
        color: #D4AF37 !important;
    }
    
    /* Metric cards */
    [data-testid="stMetricValue"] {
        color: #0B1221;
        font-weight: 700;
    }
    
    [data-testid="stMetricLabel"] {
        color: #4B5563;
        font-weight: 500;
    }
    
    /* Selectbox and inputs */
    .stSelectbox label, .stNumberInput label, .stSlider label {
        color: #0B1221;
        font-weight: 600;
        font-family: 'Inter', sans-serif;
    }
    
    /* Radio buttons */
    .stRadio label {
        color: #4B5563;
        font-family: 'Inter', sans-serif;
    }
    
    /* Industry cards */
    .industry-card {
        border: 2px solid #E5E7EB;
        border-radius: 8px;
        padding: 1.5rem;
        margin: 0.5rem 0;
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
    
    /* Step indicator */
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
    }
    
    .step.active {
        background-color: #D4AF37;
        color: #0B1221;
    }
    
    .step.completed {
        background-color: #0B1221;
        color: #D4AF37;
    }
</style>
""", unsafe_allow_html=True)

# Initialize session state
if 'step' not in st.session_state:
    st.session_state.step = 1
if 'industry' not in st.session_state:
    st.session_state.industry = None
if 'staff_count' not in st.session_state:
    st.session_state.staff_count = 50
if 'avg_rate' not in st.session_state:
    st.session_state.avg_rate = 185
if 'platform' not in st.session_state:
    st.session_state.platform = "M365/SharePoint"
if 'pain_point' not in st.session_state:
    st.session_state.pain_point = None
if 'weekly_waste' not in st.session_state:
    st.session_state.weekly_waste = None
if 'calculations' not in st.session_state:
    st.session_state.calculations = None

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
    }
}

def format_currency(value):
    """Format number as currency"""
    return f"${value:,.0f}"

def calculate_metrics():
    """Calculate all financial metrics"""
    staff_count = st.session_state.staff_count
    avg_rate = st.session_state.avg_rate
    weekly_waste = st.session_state.weekly_waste or 0
    pain_point = st.session_state.pain_point or 0
    
    # Annual burn rate
    annual_burn = staff_count * weekly_waste * avg_rate * 48
    
    # Tier 1 Opportunity (40% reduction)
    tier_1_savings = annual_burn * 0.40
    
    # Tier 3 Opportunity (Revenue capacity)
    capacity_hours = staff_count * weekly_waste * 48
    potential_revenue = capacity_hours * avg_rate
    
    return {
        "annual_burn": annual_burn,
        "tier_1_savings": tier_1_savings,
        "capacity_hours": capacity_hours,
        "potential_revenue": potential_revenue,
        "pain_point": pain_point,
        "weekly_waste": weekly_waste
    }

def generate_pdf_report():
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
        alignment=1  # Center
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
        ["Industry", st.session_state.industry],
        ["Technical Staff Count", str(st.session_state.staff_count)],
        ["Average Billable Rate (AUD)", format_currency(st.session_state.avg_rate)],
        ["Core Tech Stack", st.session_state.platform]
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
    calc = st.session_state.calculations
    story.append(Paragraph("Financial Analysis", heading_style))
    calc_data = [
        ["Metric", "Value"],
        ["Annual Efficiency Loss (Burn Rate)", format_currency(calc['annual_burn'])],
        ["Tier 1 Opportunity (Immediate Savings)", format_currency(calc['tier_1_savings'])],
        ["Capacity Hours Unlocked", f"{calc['capacity_hours']:,.0f} hours"],
        ["Potential Revenue Opportunity", format_currency(calc['potential_revenue'])]
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
        f"<b>Tier 1 Implementation:</b> Focus on automated data extraction to achieve immediate savings of {format_currency(calc['tier_1_savings'])} annually.",
        f"<b>Tier 2 Implementation:</b> Expand automation to unlock {calc['capacity_hours']:,.0f} billable hours, representing {format_currency(calc['potential_revenue'])} in revenue capacity.",
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
    story.append(Spacer(1, 0.3*inch))
    story.append(Paragraph(
        f"<b>Next Step:</b> Book a Discovery Call to validate these numbers and discuss implementation roadmap.",
        normal_style
    ))
    
    doc.build(story)
    buffer.seek(0)
    return buffer

def render_step_indicator(current_step):
    """Render step indicator"""
    steps = ["1", "2", "3", "4"]
    html = '<div class="step-indicator">'
    for i, step_num in enumerate(steps, 1):
        if i < current_step:
            html += f'<div class="step completed">{step_num}</div>'
        elif i == current_step:
            html += f'<div class="step active">{step_num}</div>'
        else:
            html += f'<div class="step">{step_num}</div>'
    html += '</div>'
    st.markdown(html, unsafe_allow_html=True)

# Main app
def main():
    # Step 1: Introduction & Industry Selection
    if st.session_state.step == 1:
        render_step_indicator(1)
        st.title("Calculate Your Automation ROI")
        st.markdown("### See how much margin you are losing to manual workflows.")
        st.markdown("---")
        
        st.markdown("### Select Your Industry")
        
        # Create clickable industry cards
        industry_cols = st.columns(2)
        
        for idx, (industry_name, config) in enumerate(INDUSTRIES.items()):
            col = industry_cols[idx % 2]
            with col:
                is_selected = st.session_state.industry == industry_name
                # Create a clickable card using button with custom styling
                button_label = f"**{industry_name}**\n\n{config['context']}"
                if st.button(button_label, key=f"industry_{idx}", use_container_width=True):
                    st.session_state.industry = industry_name
                    st.rerun()
                
                # Visual indicator for selected industry
                if is_selected:
                    st.markdown("✅ Selected", unsafe_allow_html=True)
        
        if st.session_state.industry:
            st.markdown("---")
            if st.button("Continue to Data Entry →", type="primary", use_container_width=True):
                st.session_state.step = 2
                st.rerun()
    
    # Step 2: Data Entry
    elif st.session_state.step == 2:
        render_step_indicator(2)
        st.title("Input Your Baseline Data")
        st.markdown("---")
        
        if not st.session_state.industry:
            st.error("Please select an industry first.")
            if st.button("← Back to Industry Selection"):
                st.session_state.step = 1
                st.rerun()
            return
        
        industry_config = INDUSTRIES[st.session_state.industry]
        
        # Universal Inputs
        st.markdown("### Universal Inputs")
        col1, col2 = st.columns(2)
        
        with col1:
            st.session_state.staff_count = st.slider(
                "Number of Technical Staff",
                min_value=10,
                max_value=500,
                value=st.session_state.staff_count,
                step=5
            )
        
        with col2:
            st.session_state.avg_rate = st.number_input(
                "Average Billable Rate (AUD)",
                min_value=50,
                max_value=500,
                value=st.session_state.avg_rate,
                step=5
            )
        
        st.session_state.platform = st.radio(
            "Core Tech Stack",
            ["M365/SharePoint", "Google Workspace", "Other"],
            index=0 if st.session_state.platform == "M365/SharePoint" else 1 if st.session_state.platform == "Google Workspace" else 2
        )
        
        st.markdown("---")
        
        # Industry-Specific Questions
        st.markdown(f"### {st.session_state.industry} - Specific Questions")
        
        # Q1: Pain Point
        st.markdown(f"**{industry_config['q1_label']}**")
        q1_selected = st.radio(
            "",
            options=list(industry_config['q1_options'].keys()),
            key="pain_point_radio",
            label_visibility="collapsed"
        )
        st.session_state.pain_point = industry_config['q1_options'][q1_selected]
        
        # Q2: Weekly Waste
        st.markdown(f"**{industry_config['q2_label']}**")
        if industry_config['q2_type'] == "slider":
            st.session_state.weekly_waste = st.slider(
                "",
                min_value=industry_config['q2_range'][0],
                max_value=industry_config['q2_range'][1],
                value=st.session_state.weekly_waste or 5,
                step=0.5,
                key="weekly_waste_slider",
                label_visibility="collapsed"
            )
        else:  # dropdown
            q2_selected = st.selectbox(
                "",
                options=list(industry_config['q2_options'].keys()),
                key="weekly_waste_dropdown",
                label_visibility="collapsed"
            )
            st.session_state.weekly_waste = industry_config['q2_options'][q2_selected]
        
        st.markdown("---")
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("← Back", use_container_width=True):
                st.session_state.step = 1
                st.rerun()
        with col2:
            if st.button("Calculate ROI →", type="primary", use_container_width=True):
                st.session_state.calculations = calculate_metrics()
                st.session_state.step = 3
                st.rerun()
    
    # Step 3: Results Dashboard
    elif st.session_state.step == 3:
        render_step_indicator(3)
        st.title("Your ROI Analysis")
        st.markdown("---")
        
        if not st.session_state.calculations:
            st.session_state.calculations = calculate_metrics()
        
        calc = st.session_state.calculations
        
        # Headline Stat
        st.markdown(f"### Your Annual Efficiency Loss: {format_currency(calc['annual_burn'])}")
        st.markdown("---")
        
        # Metrics
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("Annual Burn Rate", format_currency(calc['annual_burn']))
        with col2:
            st.metric("Tier 1 Savings", format_currency(calc['tier_1_savings']))
        with col3:
            st.metric("Capacity Hours", f"{calc['capacity_hours']:,.0f}")
        with col4:
            st.metric("Revenue Opportunity", format_currency(calc['potential_revenue']))
        
        st.markdown("---")
        
        # Bar Chart
        st.markdown("### Current State vs Future State")
        chart_data = pd.DataFrame({
            "State": ["Current State", "Future State (Tier 1)", "Future State (Tier 3)"],
            "Annual Cost": [
                calc['annual_burn'],
                calc['annual_burn'] - calc['tier_1_savings'],
                0
            ]
        })
        
        fig = go.Figure()
        fig.add_trace(go.Bar(
            x=chart_data["State"],
            y=chart_data["Annual Cost"],
            marker_color=['#0B1221', '#D4AF37', '#4B5563'],
            text=[format_currency(x) for x in chart_data["Annual Cost"]],
            textposition='outside'
        ))
        fig.update_layout(
            title="",
            xaxis_title="",
            yaxis_title="Annual Cost (AUD)",
            showlegend=False,
            height=400,
            plot_bgcolor='white',
            paper_bgcolor='white'
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Dynamic Analysis Text
        st.markdown("### Analysis")
        analysis_text = []
        
        if calc['pain_point'] >= 8:
            analysis_text.append("⚠️ **High Risk Profile:** You have a high risk profile for transcription errors that could impact project quality and compliance.")
        
        if calc['weekly_waste'] > 5:
            waste_percentage = (calc['weekly_waste'] / 40) * 100
            analysis_text.append(f"📊 **Time Allocation:** Your senior staff are spending {waste_percentage:.1f}%+ of their time on non-billable administrative work.")
        
        if calc['annual_burn'] > 100000:
            analysis_text.append(f"💰 **Significant Opportunity:** With an annual burn rate of {format_currency(calc['annual_burn'])}, automation could deliver substantial ROI within the first year.")
        
        if not analysis_text:
            analysis_text.append("✅ Your organization shows moderate efficiency opportunities. Automation can still deliver meaningful improvements.")
        
        for text in analysis_text:
            st.markdown(text)
        
        st.markdown("---")
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("← Back to Data Entry", use_container_width=True):
                st.session_state.step = 2
                st.rerun()
        with col2:
            if st.button("Generate PDF Report →", type="primary", use_container_width=True):
                st.session_state.step = 4
                st.rerun()
    
    # Step 4: PDF Report
    elif st.session_state.step == 4:
        render_step_indicator(4)
        st.title("Download Your Business Case")
        st.markdown("---")
        
        st.markdown("### Your PDF Report is Ready")
        st.markdown("Click the button below to download your personalized ROI Business Case PDF.")
        
        # Generate PDF
        pdf_buffer = generate_pdf_report()
        
        st.download_button(
            label="📥 Download Business Case PDF",
            data=pdf_buffer,
            file_name=f"Curam_AI_ROI_Report_{datetime.now().strftime('%Y%m%d')}.pdf",
            mime="application/pdf",
            type="primary",
            use_container_width=True
        )
        
        st.markdown("---")
        st.markdown("### Next Steps")
        st.markdown("""
        1. **Review the Report:** Share this business case with your leadership team
        2. **Book Discovery Call:** Validate these numbers with our automation experts
        3. **Plan Implementation:** Discuss Tier 1 and Tier 2 automation roadmap
        """)
        
        st.markdown("---")
        st.markdown("### Book Your Discovery Call")
        st.markdown(f"Ready to validate these numbers? [Book a Discovery Call]({BOOKING_URL}) to discuss your automation opportunities.")
        
        # Alternative: Direct button to booking
        st.markdown(f"""
        <div style="text-align: center; margin-top: 2rem;">
            <a href="{BOOKING_URL}" style="
                display: inline-block;
                background-color: #D4AF37;
                color: #0B1221;
                padding: 1rem 2rem;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 600;
                font-family: 'Inter', sans-serif;
            ">📅 Book Discovery Call</a>
        </div>
        """, unsafe_allow_html=True)
        
        if st.button("← Back to Results", use_container_width=True):
            st.session_state.step = 3
            st.rerun()
        
        if st.button("Start New Assessment", use_container_width=True):
            # Reset session state
            for key in list(st.session_state.keys()):
                del st.session_state[key]
            st.session_state.step = 1
            st.rerun()

if __name__ == "__main__":
    main()

