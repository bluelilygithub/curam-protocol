# Curam-Ai Protocol™ Website

A professional, responsive website showcasing The Curam-Ai Protocol™ - a systematised AI implementation framework for professional services firms, including accounting, engineering, legal, logistics, and built environment sectors.

## File Structure

```
.
├── homepage.html                    # Main homepage with all sections
├── about.html                      # About page
├── services.html                   # Services overview
├── target-markets.html             # Target markets overview
├── accounting.html                 # Accounting firms page
├── professional-services.html      # Professional services page (legal, accounting, wealth, insurance)
├── logistics-compliance.html       # Logistics & compliance page (logistics, healthcare, NDIS)
├── built-environment.html          # Built environment page (engineering, architecture, construction)
├── how-it-works.html               # Demo and process page
├── contact.html                    # Contact form and booking
├── faq.html                        # FAQ page
├── blog.html                       # Blog listing page
├── search-results.html             # RAG search results page
├── roi.html                        # ROI calculator page (embeds Flask calculator)
├── sitemap.html                    # Sitemap page
├── case-study.html                 # Case study page
├── demo.html                       # Demo page
├── index.html                      # Entry point (redirects to homepage)
├── phase-1-feasibility.html        # Phase 1 details
├── phase-2-roadmap.html            # Phase 2 details
├── phase-3-compliance.html         # Phase 3 details
├── phase-2-reports.html            # Phase 2 reports overview
├── phase-2-exec-summary.html       # Phase 2 executive summary
├── phase-2-discovery-baseline-report.html  # Phase 2 discovery report
├── phase-2-metric-agreement.html   # Phase 2 metric agreement
├── feasibility-sprint-report.html  # Feasibility sprint report
├── risk-audit-report.html          # Risk audit report
├── gate2-sample-report.html        # Gate 2 sample report
├── tier-one-feasibility-report.html # Tier 1 feasibility report
├── tier2-report.html               # Tier 2 report
├── curam-ai-protocol.html          # Protocol overview
├── commercial-guarantee.html       # Commercial guarantee page
├── assets/
│   ├── css/
│   │   └── styles.css              # Main stylesheet (Navy Blue & Gold theme)
│   ├── js/
│   │   ├── main.js                 # Interactive features, search, FAQ accordion
│   │   ├── navbar-loader.js       # Dynamic navbar loading and active state management
│   │   ├── scripts.js              # Mobile menu, scroll effects, hero interactions
│   │   ├── hero_rotation.js        # Hero background rotation
│   │   └── hero-text-rotation.js   # Hero text rotation
│   ├── images/                     # Image assets (Curam-Ai logo)
│   ├── includes/
│   │   └── navbar.html             # Reusable navigation bar component
│   ├── samples/                    # Sample PDF files
│   └── videos/                     # Video background assets
├── main.py                         # Flask app (serves website + automater + ROI calculator + APIs)
├── roi_calculator_flask.py         # Flask ROI calculator application
├── roi_calculator.py               # Streamlit ROI calculator (legacy)
├── Procfile                        # Railway deployment configuration
├── runtime.txt                     # Python version specification
└── requirements.txt                # Python dependencies
```

## Design Features

- **Color Scheme**: Deep Navy Blue (#0F172A) and Gold (#D4AF37)
- **Typography**: Inter (sans-serif) for all text - clean, modern, professional
- **Responsive**: Mobile-first design with breakpoints
- **Sections**: Hero (with video background), Methodology, Selector, Products, Trust, FAQ
- **Branding**: Curam-Ai with logo integration
- **Dark Theme**: Consistent dark backgrounds throughout with accent colors

## Current Deployment

The website is deployed via **Flask app** (`main.py`) which serves:
- Marketing website pages (homepage, contact, how-it-works, industry pages, etc.)
- Document extraction tool (automater) at `/automater`
- ROI Calculator at `/roi-calculator/` and `/roi.html`
- RAG Search API at `/api/search-blog`
- Contact Assistant API at `/api/contact-assistant`
- Contact form API at `/api/contact`

## Homepage Sections

1. **Hero**: Above-the-fold with video background, 3 CTAs (Assessment Demo, Book a Diagnostic, Calculate Your ROI)
2. **Methodology**: 4-phase Protocol diagram with timelines in gold (no pricing shown)
3. **Selector**: Self-segmentation tool (Objection → Solution)
4. **Products**: Product cards with timelines and Fixed Fee language (no visible pricing)
5. **Trust**: Social proof metrics
6. **FAQ**: Common objections and answers

## Key Features

### Protocol Diagram
- 4 uniform cards (250px × 280px) displayed in one row
- Timelines highlighted in gold (48-Hour, 3-Week, 2-Week, 30-Day)
- Icons: Magnifying Glass, Map, Shield, Rocket

### Products Section
- Phase 1: Low Fixed Fee (48 Hours)
- Phase 2: Standardised Fixed Fee (3 Weeks) - Featured
- Phase 3: Custom Fixed Scope (2 Weeks)
- Phase 4: Scoped per Workflow (30-Day Sprints)

### Interactive Features
- Smooth scrolling navigation
- Bouncing down arrow on "View The Protocol" link
- Hover effects on selector rows
- Protocol phase animations
- Product card interactions
- Mobile-responsive menu
- Video background with fallback
- Dynamic navbar loading with active state management
- RAG search functionality (searches blog content and generates AI answers)
- Contact assistant chat (AI-powered contact guidance)
- FAQ accordion functionality
- Hero text and background rotation

### Industry-Specific Pages
- **Accounting**: Targeted at Australian accounting firms (15-100 staff)
- **Professional Services**: Legal, Accounting, Wealth Management, Insurance Brokers
- **Logistics & Compliance**: Logistics, Healthcare Administration, NDIS/Defence Contractors
- **Built Environment**: Engineering, Architecture, Construction, Mining, Real Estate

### Navigation System
- Dynamic navbar loaded from `assets/includes/navbar.html`
- Dropdown menus for "Target Markets" and "Resources"
- Active state highlighting based on current page
- Mobile hamburger menu with smooth animations

## Links & Integration

- **Assessment Demo**: `/automater` - Document extraction tool
- **ROI Calculator**: `/roi-calculator/` or `/roi.html` - ROI calculation tool
- **Contact Form**: `/contact` - Contact and booking
- **How It Works**: `/how-it-works` - Demo showcase
- **Blog**: `/blog` - Blog listing page
- **Search**: `/search-results` - RAG search results page
- **Sitemap**: `/sitemap.html` - Site structure overview

## API Endpoints

- **`/api/search-blog`** (POST): RAG search that queries blog content and generates AI answers
- **`/api/contact-assistant`** (POST): AI contact assistant for user guidance
- **`/api/contact`** (POST): Contact form submission
- **`/api/check-message-relevance`** (POST): Checks message relevance for contact assistant
- **`/api/email-chat-log`** (POST): Emails chat log from contact assistant

## Customization

### Colors
Edit CSS variables in `assets/css/styles.css`:
```css
:root {
    --color-navy: #0F172A;
    --color-gold: #D4AF37;
    --navy-deep: #0a1628;
    --text-primary: #f8f9fa;
    --text-secondary: #cbd5e1;
    --border-subtle: rgba(255, 255, 255, 0.1);
}
```

### Content
- Edit HTML files for main content
- Update timelines in the Protocol section
- Modify metrics in Trust section
- Update product descriptions
- Industry pages can be customized in their respective HTML files

### Logo
Logo file: `assets/images/curam-ai-logo.png` (already integrated)

### Video Background
Add video files to `assets/videos/`:
- `hero-background.mp4` (primary)
- `hero-background.webm` (fallback)

See `assets/videos/README.md` for specifications.

### Navigation
Edit `assets/includes/navbar.html` to modify navigation structure. The navbar is dynamically loaded by `assets/js/navbar-loader.js`.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Notes

- Website is integrated with Flask app for unified deployment
- Contact form requires backend integration (already implemented via `/api/contact`)
- RAG search requires `GEMINI_API_KEY` environment variable
- Contact assistant requires `GEMINI_API_KEY` environment variable
- ROI calculator is available both as Flask blueprint (`/roi-calculator/`) and embedded page (`/roi.html`)
- Australian English spelling used throughout (e.g., "modelling", "standardised")
- All pages use consistent dark theme with navy backgrounds
- Dynamic navbar ensures consistent navigation across all pages
