# How to Access Your Applications

## Production URLs (Railway Deployment)

### Marketing Website
- **Homepage**: `https://curam-protocol.curam-ai.com.au/`
- **About**: `https://curam-protocol.curam-ai.com.au/about`
- **Services**: `https://curam-protocol.curam-ai.com.au/services`
- **Target Markets**: `https://curam-protocol.curam-ai.com.au/target-markets`
- **Contact**: `https://curam-protocol.curam-ai.com.au/contact`
- **How It Works**: `https://curam-protocol.curam-ai.com.au/how-it-works`
- **FAQ**: `https://curam-protocol.curam-ai.com.au/faq`
- **Blog**: `https://curam-protocol.curam-ai.com.au/blog`
- **Case Study**: `https://curam-protocol.curam-ai.com.au/case-study`
- **Sitemap**: `https://curam-protocol.curam-ai.com.au/sitemap.html`

### Industry-Specific Pages
- **Accounting**: `https://curam-protocol.curam-ai.com.au/accounting`
- **Professional Services**: `https://curam-protocol.curam-ai.com.au/professional-services`
- **Logistics & Compliance**: `https://curam-protocol.curam-ai.com.au/logistics-compliance`
- **Built Environment**: `https://curam-protocol.curam-ai.com.au/built-environment`

### Document Extraction Tool (Automater/Assessment)
- **Main Route**: `https://curam-protocol.curam-ai.com.au/automater`
- **Alternative Routes**: 
  - `https://curam-protocol.curam-ai.com.au/demo`
  - `https://curam-protocol.curam-ai.com.au/extract`

### ROI Calculator
- **Embedded Page**: `https://curam-protocol.curam-ai.com.au/roi.html`
- **Flask App**: `https://curam-protocol.curam-ai.com.au/roi-calculator/`
- **With Industry Pre-selection**: 
  - `https://curam-protocol.curam-ai.com.au/roi.html?industry=accounting`
  - `https://curam-protocol.curam-ai.com.au/roi.html?industry=engineering`
- **With Section Selector**: 
  - `https://curam-protocol.curam-ai.com.au/roi.html?section=professional-services`
  - `https://curam-protocol.curam-ai.com.au/roi.html?section=built-environment`
  - `https://curam-protocol.curam-ai.com.au/roi.html?section=logistics-compliance`

### Search & Results
- **Search Results**: `https://curam-protocol.curam-ai.com.au/search-results`

### Phase & Report Pages
- **Phase 1 Feasibility**: `https://curam-protocol.curam-ai.com.au/phase-1-feasibility`
- **Phase 2 Roadmap**: `https://curam-protocol.curam-ai.com.au/phase-2-roadmap`
- **Phase 3 Compliance**: `https://curam-protocol.curam-ai.com.au/phase-3-compliance`
- **Phase 2 Reports**: `https://curam-protocol.curam-ai.com.au/phase-2-reports`
- **Feasibility Sprint Report**: `https://curam-protocol.curam-ai.com.au/feasibility-sprint-report`
- **Risk Audit Report**: `https://curam-protocol.curam-ai.com.au/risk-audit-report`
- **Tier 1 Feasibility Report**: `https://curam-protocol.curam-ai.com.au/tier-one-feasibility-report`
- **Tier 2 Report**: `https://curam-protocol.curam-ai.com.au/tier2-report.html`
- **Curam AI Protocol**: `https://curam-protocol.curam-ai.com.au/curam-ai-protocol.html`

## Quick Reference

- 🏠 **Homepage**: `/` - Curam-Ai Protocol marketing site
- 🏢 **Industry Pages**: `/accounting`, `/professional-services`, `/logistics-compliance`, `/built-environment`
- 🔧 **Automater**: `/automater` - Document extraction tool
- 📊 **ROI Calculator**: `/roi.html` or `/roi-calculator/` - ROI calculation tool
- 📧 **Contact**: `/contact` - Contact form and booking
- ℹ️ **How It Works**: `/how-it-works` - Demo showcase
- 📝 **Blog**: `/blog` - Blog listing page
- 🔍 **Search**: `/search-results` - RAG search results page
- 📋 **Sitemap**: `/sitemap.html` - Site structure overview

## Homepage Features

### Hero Section
- Video background (with fallback gradient)
- 3 Call-to-Action buttons:
  1. **Assessment Demo** (Gold button) → `/automater`
  2. **Book a Diagnostic** (White border) → `/contact`
  3. **Calculate Your ROI** (White border) → `/roi.html`
- Bouncing down arrow on "View The Protocol" link
- Rotating hero text and background

### Protocol Diagram
- 4 uniform cards in one row
- Timelines in gold (no pricing shown):
  - Phase 1: 48-Hour Turnaround
  - Phase 2: 3-Week Engagement
  - Phase 3: 2-Week Audit
  - Phase 4: 30-Day Sprints

### Products Section
- Fixed Fee language (no visible pricing)
- Timelines highlighted
- Phase 2 (Roadmap) featured as "Most Popular"

### Navigation
- Dynamic navbar with dropdown menus
- "Target Markets" dropdown includes:
  - Professional Services
  - Logistics & Compliance
  - Built Environment
- "Resources" dropdown includes:
  - ROI Calculator
  - Demo
  - Case Study
  - How It Works
  - Reports

## API Endpoints

### RAG Search API
- **Endpoint**: `POST /api/search-blog`
- **Purpose**: Searches blog content and generates AI-powered answers
- **Requires**: `GEMINI_API_KEY` environment variable
- **Usage**: Used by search functionality on homepage and search-results page

### Contact Assistant API
- **Endpoint**: `POST /api/contact-assistant`
- **Purpose**: AI-powered contact guidance and conversation
- **Requires**: `GEMINI_API_KEY` environment variable
- **Usage**: Used by contact assistant chat widget

### Contact Form API
- **Endpoint**: `POST /api/contact`
- **Purpose**: Handles contact form submissions
- **Usage**: Used by contact page form

## Troubleshooting

### Can't Access Automater
1. Make sure Railway is running the Flask app (not Node.js)
2. Check Railway logs for errors
3. Verify `GEMINI_API_KEY` environment variable is set
4. Try accessing `/automater` directly (not root `/`)

### ROI Calculator Shows "Cannot GET"
1. Check Railway logs for blueprint registration message
2. Verify `roi_calculator_flask.py` exists
3. Check that dependencies are installed: `plotly`, `reportlab`, `pandas`
4. Look for "✓ ROI Calculator blueprint registered successfully" in logs
5. Try both `/roi.html` and `/roi-calculator/` routes

### RAG Search Not Working
1. Verify `GEMINI_API_KEY` is set in Railway environment variables
2. Check Railway logs for API errors
3. Verify WordPress API is accessible
4. Check browser console for JavaScript errors

### Contact Assistant Not Working
1. Verify `GEMINI_API_KEY` is set in Railway environment variables
2. Check Railway logs for API errors
3. Verify conversation history is being maintained
4. Check browser console for JavaScript errors

### Industry Pages Not Resolving
1. Verify routes are registered in `main.py`
2. Check that HTML files exist in root directory
3. Ensure file names match route names exactly
4. Check Railway logs for 404 errors

### Video Background Not Playing
- This is normal if video files aren't uploaded
- Site uses a gradient fallback automatically
- To add video: place `hero-background.mp4` and `.webm` in `assets/videos/`

### Static Assets Not Loading
- Check that `assets/` directory is in the repository
- Verify routes in `main.py` are correct
- Clear browser cache

### Navbar Not Loading
1. Verify `assets/includes/navbar.html` exists
2. Check `assets/js/navbar-loader.js` is loaded
3. Verify `navbar-placeholder` div exists in HTML pages
4. Check browser console for fetch errors

## Local Development

For local testing, see `DEPLOYMENT_GUIDE.md` for setup instructions.

### Local URLs
- Homepage: `http://localhost:5000/`
- Accounting: `http://localhost:5000/accounting`
- Professional Services: `http://localhost:5000/professional-services`
- ROI Calculator: `http://localhost:5000/roi.html`
- Automater: `http://localhost:5000/automater`
- Contact: `http://localhost:5000/contact`
- Blog: `http://localhost:5000/blog`

## Notes

- All URLs use HTTPS in production
- Industry pages support both `/page` and `/page.html` routes
- ROI calculator supports URL parameters for pre-selection
- RAG search and contact assistant require `GEMINI_API_KEY`
- Navbar is dynamically loaded for consistency
- All pages use consistent dark theme with navy backgrounds
