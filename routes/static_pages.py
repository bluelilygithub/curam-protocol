"""
Static Pages Blueprint

This module contains all the static marketing website page routes,
including homepage, industry pages, phase/report pages, and other
informational pages.

All routes simply serve HTML files using send_file() or render_template().
"""

import os
from flask import Blueprint, send_file, send_from_directory, render_template, redirect

# Create blueprint
static_pages_bp = Blueprint('static_pages', __name__)


# =============================================================================
# SAMPLE FILE ROUTES (samples directory)
# =============================================================================

@static_pages_bp.route('/samples/<department>/<path:filename>')
def sample_file(department, filename):
    """Serve sample PDF files from samples directory"""
    return send_from_directory(f'samples/{department}', filename)

# Legacy routes for backward compatibility (redirect to new structure)
@static_pages_bp.route('/invoices/<path:filename>')
def invoices(filename):
    """Legacy route - redirects to samples/finance"""
    return send_from_directory('samples/finance', filename)


@static_pages_bp.route('/drawings/<path:filename>')
def drawings(filename):
    """Legacy route - serves from samples/engineering or samples/transmittal"""
    # Try engineering first, then transmittal
    if os.path.exists(os.path.join('samples/engineering', filename)):
        return send_from_directory('samples/engineering', filename)
    elif os.path.exists(os.path.join('samples/transmittal', filename)):
        return send_from_directory('samples/transmittal', filename)
    else:
        from flask import abort
        abort(404)


# =============================================================================
# MAIN WEBSITE PAGES
# =============================================================================

@static_pages_bp.route('/homepage')
@static_pages_bp.route('/homepage.html')
def homepage():
    """Serve the marketing homepage"""
    try:
        return send_file('homepage.html')
    except:
        return "Homepage not found.", 404


@static_pages_bp.route('/contact')
@static_pages_bp.route('/contact.html')
def contact_page():
    """Serve the contact page"""
    try:
        return send_file('contact.html')
    except:
        return "Contact page not found.", 404


@static_pages_bp.route('/about')
@static_pages_bp.route('/about.html')
def about_page():
    """Serve the about page"""
    try:
        return send_file('about.html')
    except:
        return "About page not found.", 404


@static_pages_bp.route('/search')
@static_pages_bp.route('/search.html')
def search_page():
    """Serve the RAG Search Demo page"""
    try:
        return send_file('search.html')
    except:
        return "Search page not found.", 404


@static_pages_bp.route('/services')
@static_pages_bp.route('/services.html')
def services_page():
    """Serve the services page"""
    try:
        return send_file('services.html')
    except:
        return "Services page not found.", 404


@static_pages_bp.route('/faq')
@static_pages_bp.route('/faq.html')
def faq_page():
    """Serve the FAQ page"""
    try:
        return send_file('faq.html')
    except:
        return "FAQ page not found.", 404


@static_pages_bp.route('/target-markets')
@static_pages_bp.route('/target-markets.html')
def target_markets():
    """Serve the target markets page"""
    try:
        return send_file('target-markets.html')
    except:
        return "Target Markets page not found.", 404


@static_pages_bp.route('/case-study')
@static_pages_bp.route('/case-study.html')
def case_study_page():
    """Serve the case study page"""
    try:
        return send_file('case-study.html')
    except:
        return "Case study page not found.", 404


@static_pages_bp.route('/search-results')
@static_pages_bp.route('/search-results.html')
def search_results_page():
    """Serve the search results page"""
    try:
        return send_file('search-results.html')
    except:
        return "Search results page not found.", 404


# =============================================================================
# SECTOR/CATEGORY PAGES
# =============================================================================

@static_pages_bp.route('/professional-services')
@static_pages_bp.route('/professional-services.html')
def professional_services_page():
    """Serve the professional services sector page"""
    try:
        return send_file('professional-services.html')
    except:
        return "Professional Services page not found.", 404


@static_pages_bp.route('/logistics-compliance')
@static_pages_bp.route('/logistics-compliance.html')
def logistics_compliance_page():
    """Serve the logistics compliance sector page"""
    try:
        return send_file('logistics-compliance.html')
    except:
        return "Logistics Compliance page not found.", 404


@static_pages_bp.route('/built-environment')
@static_pages_bp.route('/built-environment.html')
def built_environment_page():
    """Serve the built environment sector page"""
    try:
        return send_file('built-environment.html')
    except:
        return "Built Environment page not found.", 404


# =============================================================================
# INDUSTRY PAGES (uses render_template for Jinja2 templates)
# =============================================================================

@static_pages_bp.route('/accounting')
@static_pages_bp.route('/accounting.html')
@static_pages_bp.route('/industries/accounting.html')
def accounting_page():
    """Serve the accounting industry page"""
    try:
        return render_template('industries/accounting.html')
    except:
        return "Accounting page not found.", 404


@static_pages_bp.route('/legal-services')
@static_pages_bp.route('/legal-services.html')
@static_pages_bp.route('/industries/legal-services.html')
def legal_services_page():
    """Serve the legal services industry page"""
    try:
        return render_template('industries/legal-services.html')
    except:
        return "Legal Services page not found.", 404


@static_pages_bp.route('/wealth-management')
@static_pages_bp.route('/wealth-management.html')
@static_pages_bp.route('/industries/wealth-management.html')
def wealth_management_page():
    """Serve the wealth management industry page"""
    try:
        return render_template('industries/wealth-management.html')
    except:
        return "Wealth Management page not found.", 404


@static_pages_bp.route('/insurance-underwriting')
@static_pages_bp.route('/insurance-underwriting.html')
@static_pages_bp.route('/industries/insurance-underwriting.html')
def insurance_underwriting_page():
    """Serve the insurance underwriting industry page"""
    try:
        return render_template('industries/insurance-underwriting.html')
    except:
        return "Insurance Underwriting page not found.", 404


@static_pages_bp.route('/logistics-freight')
@static_pages_bp.route('/logistics-freight.html')
@static_pages_bp.route('/logistics')
@static_pages_bp.route('/logistics.html')
@static_pages_bp.route('/industries/logistics-freight.html')
def logistics_freight_page():
    """Serve the logistics & freight industry page"""
    try:
        return render_template('industries/logistics-freight.html')
    except:
        return "Logistics & Freight page not found.", 404


@static_pages_bp.route('/healthcare-admin')
@static_pages_bp.route('/healthcare-admin.html')
@static_pages_bp.route('/healthcare')
@static_pages_bp.route('/healthcare.html')
@static_pages_bp.route('/industries/healthcare-admin.html')
def healthcare_admin_page():
    """Serve the healthcare admin industry page"""
    try:
        return render_template('industries/healthcare-admin.html')
    except:
        return "Healthcare Admin page not found.", 404


@static_pages_bp.route('/government-contractors')
@static_pages_bp.route('/government-contractors.html')
@static_pages_bp.route('/government')
@static_pages_bp.route('/government.html')
@static_pages_bp.route('/industries/government-contractors.html')
def government_contractors_page():
    """Serve the government contractors industry page"""
    try:
        return render_template('industries/government-contractors.html')
    except:
        return "Government Contractors page not found.", 404


@static_pages_bp.route('/construction')
@static_pages_bp.route('/construction.html')
@static_pages_bp.route('/industries/construction.html')
def construction_page():
    """Serve the construction industry page"""
    try:
        return render_template('industries/construction.html')
    except:
        return "Construction page not found.", 404


@static_pages_bp.route('/architecture')
@static_pages_bp.route('/architecture.html')
@static_pages_bp.route('/industries/architecture.html')
def architecture_page():
    """Serve the architecture industry page"""
    try:
        return render_template('industries/architecture.html')
    except:
        return "Architecture page not found.", 404


@static_pages_bp.route('/engineering')
@static_pages_bp.route('/engineering.html')
@static_pages_bp.route('/industries/engineering.html')
def engineering_page():
    """Serve the engineering industry page"""
    try:
        return render_template('industries/engineering.html')
    except:
        return "Engineering page not found.", 404


@static_pages_bp.route('/mining-services')
@static_pages_bp.route('/mining-services.html')
@static_pages_bp.route('/mining')
@static_pages_bp.route('/mining.html')
@static_pages_bp.route('/industries/mining-services.html')
def mining_services_page():
    """Serve the mining services industry page"""
    try:
        return render_template('industries/mining-services.html')
    except:
        return "Mining Services page not found.", 404


@static_pages_bp.route('/property-management')
@static_pages_bp.route('/property-management.html')
@static_pages_bp.route('/property')
@static_pages_bp.route('/property.html')
@static_pages_bp.route('/industries/property-management.html')
def property_management_page():
    """Serve the property management industry page"""
    try:
        return render_template('industries/property-management.html')
    except:
        return "Property Management page not found.", 404


# =============================================================================
# PROTOCOL & HOW-IT-WORKS PAGES
# =============================================================================

@static_pages_bp.route('/how-it-works')
@static_pages_bp.route('/how-it-works.html')
def how_it_works():
    """Serve the how it works page"""
    try:
        return send_file('how-it-works.html')
    except:
        return "How it works page not found.", 404


@static_pages_bp.route('/curam-ai-protocol.html')
def curam_ai_protocol():
    """Serve the protocol overview page"""
    try:
        return send_file('curam-ai-protocol.html')
    except:
        return "Protocol page not found.", 404


# =============================================================================
# REPORT & TIER PAGES
# =============================================================================

@static_pages_bp.route('/tier2-report.html')
def tier2_report():
    """Serve the Tier 2 report HTML file"""
    try:
        html_file = 'tier2-report.html'
        
        if not os.path.exists(html_file):
            return f"Tier 2 report not found. Looking for: {html_file}", 404
        
        # Use absolute path to ensure we get the right file
        file_path = os.path.abspath(html_file)
        return send_file(file_path, mimetype='text/html')
    except Exception as e:
        return f"Error serving report: {str(e)}", 500


@static_pages_bp.route('/tier-one-feasibility-report')
@static_pages_bp.route('/tier-one-feasibility-report.html')
def tier_one_feasibility_report():
    """Serve the Tier One Feasibility Report HTML file"""
    try:
        return send_file('tier-one-feasibility-report.html')
    except:
        return "Tier One Feasibility Report not found.", 404


# =============================================================================
# PHASE PAGES (Feasibility, Roadmap, Compliance, Implementation)
# =============================================================================

@static_pages_bp.route('/phase-1-feasibility')
@static_pages_bp.route('/phase-1-feasibility.html')
def phase_1_feasibility():
    """Serve the Phase 1 Feasibility page"""
    try:
        return send_file('phase-1-feasibility.html')
    except:
        return "Phase 1 Feasibility page not found.", 404


# phase-2-roadmap.html removed - file does not exist

@static_pages_bp.route('/phase-3-compliance')
@static_pages_bp.route('/phase-3-compliance.html')
def phase_3_compliance():
    """Serve the Phase 3 Compliance Shield page"""
    try:
        return send_file('phase-3-compliance.html')
    except:
        return "Phase 3 Compliance Shield page not found.", 404


@static_pages_bp.route('/phase-4-implementation')
@static_pages_bp.route('/phase-4-implementation.html')
def phase_4_implementation():
    """Serve the Phase 4 Implementation page"""
    try:
        return send_file('phase-4-implementation.html')
    except:
        return "Phase 4 Implementation page not found.", 404


# =============================================================================
# SPRINT & REPORT PAGES
# =============================================================================

@static_pages_bp.route('/feasibility-sprint-report')
@static_pages_bp.route('/feasibility-sprint-report.html')
@static_pages_bp.route('/gate2-sample-report')
@static_pages_bp.route('/gate2-sample-report.html')
def feasibility_sprint_report():
    """Serve the Phase 1 Feasibility Sprint report slideshow page"""
    try:
        return send_file('feasibility-sprint-report.html')
    except:
        return "Feasibility Sprint report page not found.", 404


@static_pages_bp.route('/risk-audit-report')
@static_pages_bp.route('/risk-audit-report.html')
def risk_audit_report():
    """Serve the Risk Audit Report page"""
    try:
        return send_file('risk-audit-report.html')
    except:
        return "Risk Audit Report page not found.", 404


# =============================================================================
# PHASE 2 REPORT PAGES
# =============================================================================

@static_pages_bp.route('/phase-2-exec-summary')
@static_pages_bp.route('/phase-2-exec-summary.html')
def phase_2_exec_summary():
    """Serve the Phase 2 Executive Summary report"""
    try:
        return send_file('phase-2-exec-summary.html')
    except:
        return "Phase 2 Executive Summary not found.", 404


@static_pages_bp.route('/phase-2-discovery-baseline-report')
@static_pages_bp.route('/phase-2-discovery-baseline-report.html')
def phase_2_discovery_baseline():
    """Serve the Phase 2 Discovery Baseline report"""
    try:
        return send_file('phase-2-discovery-baseline-report.html')
    except:
        return "Phase 2 Discovery Baseline report not found.", 404


@static_pages_bp.route('/phase-2-metric-agreement')
@static_pages_bp.route('/phase-2-metric-agreement.html')
def phase_2_metric_agreement():
    """Serve the Phase 2 Metric Agreement report"""
    try:
        return send_file('phase-2-metric-agreement.html')
    except:
        return "Phase 2 Metric Agreement not found.", 404


# phase-2-reports.html removed - file does not exist

# =============================================================================
# BLOG & ROI PAGES (iframe wrappers)
# =============================================================================

@static_pages_bp.route('/blog.html')
def blog_html():
    """Serve blog.html page with internal blog article listing"""
    return send_file('blog.html')


@static_pages_bp.route('/blog')
def blog_redirect():
    """Redirect /blog to /blog.html"""
    return redirect('/blog.html', code=301)


@static_pages_bp.route('/roi.html')
def roi_html():
    """Serve roi.html page with iframe to ROI calculator"""
    return send_file('roi.html')


@static_pages_bp.route('/roi')
def roi_redirect():
    """Redirect /roi to /roi.html"""
    return redirect('/roi.html', code=301)


# =============================================================================
# SITEMAP PAGES
# =============================================================================

@static_pages_bp.route('/sitemap.html')
def sitemap_html():
    """Serve sitemap.html page"""
    try:
        return send_file('sitemap.html')
    except:
        return "Sitemap not found.", 404


@static_pages_bp.route('/sitemap.xml')
def sitemap_xml():
    """Serve sitemap.xml for search engines"""
    try:
        return send_file('sitemap.xml', mimetype='application/xml')
    except:
        return "Sitemap XML not found.", 404


# =============================================================================
# ROOT ROUTE
# =============================================================================

@static_pages_bp.route('/')
def root():
    """Root route - serve the marketing homepage"""
    try:
        return send_file('homepage.html')
    except Exception as e:
        return f"Homepage not found. Error: {str(e)}", 404

