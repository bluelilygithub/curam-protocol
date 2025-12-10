# Routing Structure - Curam-Ai Website

## Current Route Structure

```
/                           → Homepage (marketing site) - Curam-Ai Protocol
/homepage                   → Homepage (alternative route)
/about                      → About page
/services                   → Services page
/target-markets             → Target markets overview
/accounting                 → Accounting firms page
/professional-services      → Professional services page
/logistics-compliance       → Logistics & compliance page
/built-environment          → Built environment page
/contact                    → Contact page
/how-it-works               → How it works page (demo showcase)
/faq                        → FAQ page
/blog                       → Blog listing page
/blog.html                  → Blog listing page (alternative)
/search-results             → RAG search results page
/roi                        → ROI calculator page (embeds Flask calculator)
/roi.html                   → ROI calculator page (alternative)
/roi-calculator/            → ROI calculator Flask blueprint
/sitemap.html               → Sitemap page
/sitemap.xml                → Sitemap XML
/case-study                 → Case study page
/demo                       → Demo page
/automater                  → Document extraction tool (automater)
/extract                    → Document extraction tool (alias)
/curam-ai-protocol.html     → Protocol overview
/tier2-report.html          → Tier 2 report
/tier-one-feasibility-report → Tier 1 feasibility report
/phase-1-feasibility        → Phase 1 details
/phase-2-roadmap            → Phase 2 details
/phase-3-compliance         → Phase 3 details
/phase-2-reports            → Phase 2 reports overview
/phase-2-exec-summary       → Phase 2 executive summary
/phase-2-discovery-baseline-report → Phase 2 discovery report
/phase-2-metric-agreement   → Phase 2 metric agreement
/feasibility-sprint-report   → Feasibility sprint report
/risk-audit-report          → Risk audit report
/gate2-sample-report        → Gate 2 sample report
/commercial-guarantee.html  → Commercial guarantee page
/assets/*                   → Static assets (CSS, JS, images, videos)
/invoices/*                 → Sample invoice PDFs
/drawings/*                 → Sample drawing PDFs
```

## Route Details

### Marketing Website Routes

- **`/`** (Root): Serves `homepage.html` - Main marketing homepage
- **`/homepage`**: Alternative route to homepage
- **`/about`**: About page
- **`/services`**: Services overview page
- **`/target-markets`**: Target markets overview page
- **`/accounting`**: Accounting firms industry page
- **`/professional-services`**: Professional services industry page (legal, accounting, wealth, insurance)
- **`/logistics-compliance`**: Logistics & compliance industry page (logistics, healthcare, NDIS)
- **`/built-environment`**: Built environment industry page (engineering, architecture, construction)
- **`/contact`**: Contact form and booking page
- **`/how-it-works`**: Demo showcase and process explanation
- **`/faq`**: FAQ page
- **`/blog`**: Blog listing page
- **`/search-results`**: RAG search results page
- **`/sitemap.html`**: Sitemap page
- **`/sitemap.xml`**: Sitemap XML for search engines
- **`/case-study`**: Case study page
- **`/demo`**: Demo page

### ROI Calculator Routes

- **`/roi`**: ROI calculator page (embeds Flask calculator via iframe)
- **`/roi.html`**: Alternative route to ROI calculator page
- **`/roi-calculator/`**: Flask blueprint for ROI calculator application
  - Supports URL parameters: `?industry=<name>` and `?section=<name>`
  - Example: `/roi.html?industry=accounting` pre-selects accounting industry
  - Example: `/roi.html?section=professional-services` shows industry group selector

### Application Routes

- **`/automater`**: Main route for document extraction tool
  - Alternative routes: `/demo`, `/extract`
  - Requires `GEMINI_API_KEY` environment variable
  - Supports Finance, Engineering, and Transmittal workflows

### API Routes

- **`/api/search-blog`** (POST): RAG search endpoint
  - Searches blog content from www.curam-ai.com.au WordPress API
  - Uses Gemini AI to generate contextual answers
  - Requires `GEMINI_API_KEY` environment variable
  
- **`/api/contact-assistant`** (POST): AI contact assistant endpoint
  - Provides AI-powered guidance for users
  - Maintains conversation history
  - Requires `GEMINI_API_KEY` environment variable
  
- **`/api/contact`** (POST): Contact form submission endpoint
  - Handles contact form submissions
  
- **`/api/check-message-relevance`** (POST): Message relevance checker
  - Checks if user message is relevant for contact assistant
  
- **`/api/email-chat-log`** (POST): Email chat log endpoint
  - Sends chat log from contact assistant via email

### Report & Phase Pages

- **`/phase-1-feasibility`**: Phase 1 Feasibility details
- **`/phase-2-roadmap`**: Phase 2 Roadmap details
- **`/phase-3-compliance`**: Phase 3 Compliance details
- **`/phase-2-reports`**: Phase 2 reports overview
- **`/phase-2-exec-summary`**: Phase 2 executive summary
- **`/phase-2-discovery-baseline-report`**: Phase 2 discovery report
- **`/phase-2-metric-agreement`**: Phase 2 metric agreement
- **`/feasibility-sprint-report`**: Feasibility sprint report
- **`/risk-audit-report`**: Risk audit report
- **`/gate2-sample-report`**: Gate 2 sample report
- **`/tier-one-feasibility-report`**: Tier 1 feasibility report
- **`/tier2-report.html`**: Tier 2 report
- **`/curam-ai-protocol.html`**: Protocol overview
- **`/commercial-guarantee.html`**: Commercial guarantee page

### Static Assets

- **`/assets/css/styles.css`**: Main stylesheet
- **`/assets/js/main.js`**: JavaScript for interactivity, search, FAQ
- **`/assets/js/navbar-loader.js`**: Dynamic navbar loading
- **`/assets/js/scripts.js`**: Mobile menu, scroll effects
- **`/assets/js/hero_rotation.js`**: Hero background rotation
- **`/assets/js/hero-text-rotation.js`**: Hero text rotation
- **`/assets/images/*`**: Logo and image assets
- **`/assets/videos/*`**: Video background files (optional)
- **`/assets/includes/navbar.html`**: Reusable navbar component
- **`/assets/samples/*`**: Sample PDF files

### Sample Files

- **`/invoices/*`**: Sample invoice PDFs for Finance workflow
- **`/drawings/*`**: Sample drawing PDFs for Engineering/Transmittal workflows

## Implementation

All routes are handled by Flask app (`main.py`):

```python
# Root route - serves homepage
@app.route('/')
def root():
    return send_file('homepage.html')

# Industry pages
@app.route('/accounting')
@app.route('/accounting.html')
def accounting_page():
    return send_file('accounting.html')

@app.route('/professional-services')
@app.route('/professional-services.html')
def professional_services_page():
    return send_file('professional-services.html')

@app.route('/logistics-compliance')
@app.route('/logistics-compliance.html')
def logistics_compliance_page():
    return send_file('logistics-compliance.html')

@app.route('/built-environment')
@app.route('/built-environment.html')
def built_environment_page():
    return send_file('built-environment.html')

# ROI Calculator routes
@app.route('/roi.html')
@app.route('/roi')
def roi_page():
    return send_file('roi.html')

# RAG Search API
@app.route('/api/search-blog', methods=['POST'])
def search_blog_rag():
    # Searches blog and generates AI answers
    pass

# Contact Assistant API
@app.route('/api/contact-assistant', methods=['POST'])
def contact_assistant():
    # AI-powered contact guidance
    pass

# Automater route
@app.route('/automater', methods=['GET', 'POST'])
def automater():
    return index_automater()

# Static assets
@app.route('/assets/<path:filename>')
def assets(filename):
    return send_from_directory('assets', filename)

# ROI Calculator (blueprint)
from roi_calculator_flask import roi_app
app.register_blueprint(roi_app, url_prefix='/roi-calculator')
```

## Testing

### Local Testing

1. **Start Flask app**:
   ```bash
   python main.py
   ```

2. **Access routes**:
   - Homepage: http://localhost:5000/
   - Accounting: http://localhost:5000/accounting
   - Professional Services: http://localhost:5000/professional-services
   - Logistics Compliance: http://localhost:5000/logistics-compliance
   - Built Environment: http://localhost:5000/built-environment
   - ROI Calculator: http://localhost:5000/roi.html
   - ROI Calculator (Flask): http://localhost:5000/roi-calculator/
   - Automater: http://localhost:5000/automater
   - Contact: http://localhost:5000/contact
   - Blog: http://localhost:5000/blog
   - Search Results: http://localhost:5000/search-results

### Production (Railway)

- Homepage: `https://curam-protocol.curam-ai.com.au/`
- Accounting: `https://curam-protocol.curam-ai.com.au/accounting`
- Professional Services: `https://curam-protocol.curam-ai.com.au/professional-services`
- Logistics Compliance: `https://curam-protocol.curam-ai.com.au/logistics-compliance`
- Built Environment: `https://curam-protocol.curam-ai.com.au/built-environment`
- ROI Calculator: `https://curam-protocol.curam-ai.com.au/roi.html`
- Automater: `https://curam-protocol.curam-ai.com.au/automater`
- Blog: `https://curam-protocol.curam-ai.com.au/blog`

## URL Parameters

### ROI Calculator Parameters

- **`?industry=<name>`**: Pre-selects an industry in the ROI calculator
  - Example: `/roi.html?industry=accounting`
  - Example: `/roi.html?industry=engineering`
  - Valid values: Industry names from `roi_calculator_flask.py`

- **`?section=<name>`**: Shows industry group selector
  - Example: `/roi.html?section=professional-services`
  - Example: `/roi.html?section=built-environment`
  - Example: `/roi.html?section=logistics-compliance`
  - Displays cards for industries within that section

## Troubleshooting

### ROI Calculator Not Working

1. Check Railway logs for: "✓ ROI Calculator blueprint registered successfully"
2. Verify dependencies: `plotly`, `reportlab`, `pandas`
3. Check that `roi_calculator_flask.py` exists and imports correctly
4. Verify both `/roi.html` and `/roi-calculator/` routes are accessible

### RAG Search Not Working

1. Verify `GEMINI_API_KEY` is set in Railway environment variables
2. Check Railway logs for API errors
3. Verify WordPress API is accessible: `https://www.curam-ai.com.au/wp-json/wp/v2/posts`
4. Check browser console for JavaScript errors

### Contact Assistant Not Working

1. Verify `GEMINI_API_KEY` is set in Railway environment variables
2. Check Railway logs for API errors
3. Verify conversation history is being maintained correctly
4. Check browser console for JavaScript errors

### Industry Pages Not Resolving

1. Verify routes are registered in `main.py`
2. Check that HTML files exist in root directory
3. Ensure file names match route names exactly
4. Check Railway logs for 404 errors

### Automater Not Accessible

1. Verify route is `/automater` (not `/`)
2. Check `GEMINI_API_KEY` is set
3. Ensure sample PDFs exist in `invoices/` and `drawings/` directories

### Static Assets Not Loading

1. Verify `assets/` directory structure
2. Check route registration in `main.py`
3. Ensure file paths match exactly (case-sensitive)
4. Clear browser cache

### Navbar Not Loading

1. Verify `assets/includes/navbar.html` exists
2. Check `assets/js/navbar-loader.js` is loaded
3. Verify `navbar-placeholder` div exists in HTML pages
4. Check browser console for fetch errors

## Notes

- Root route (`/`) serves the marketing homepage, not the automater
- Automater is intentionally at `/automater` to separate marketing from tools
- All static files are served by Flask, no separate web server needed
- Video background is optional - site works without it
- ROI calculator is available at both `/roi.html` (embedded) and `/roi-calculator/` (direct Flask app)
- Industry pages support both `/page` and `/page.html` routes for flexibility
- RAG search and contact assistant require `GEMINI_API_KEY` environment variable
- Navbar is dynamically loaded to ensure consistency across all pages
