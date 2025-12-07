# Curam-Ai Protocol™ Website

A professional, responsive website showcasing The Curam-Ai Protocol™ - a systematised AI implementation framework for structural engineers.

## File Structure

```
.
├── homepage.html          # Main homepage with all sections
├── how-it-works.html      # Demo and process page
├── contact.html           # Contact form and booking
├── index.html             # Entry point (redirects to homepage)
├── assets/
│   ├── css/
│   │   └── styles.css     # Main stylesheet (Navy Blue & Gold theme)
│   ├── js/
│   │   └── main.js        # Interactive features and animations
│   ├── images/            # Image assets (Curam-Ai logo)
│   └── videos/            # Video background assets
├── main.py                # Flask app (serves website + automater + ROI calculator)
├── Procfile               # Railway deployment configuration
├── runtime.txt            # Python version specification
└── requirements.txt       # Python dependencies
```

## Design Features

- **Color Scheme**: Deep Navy Blue (#0F172A) and Gold (#D4AF37)
- **Typography**: Inter (sans-serif) for all text - clean, modern, professional
- **Responsive**: Mobile-first design with breakpoints
- **Sections**: Hero (with video background), Methodology, Selector, Products, Trust, FAQ
- **Branding**: Curam-Ai with logo integration

## Current Deployment

The website is deployed via **Flask app** (`main.py`) which serves:
- Marketing website pages (homepage, contact, how-it-works)
- Document extraction tool (automater) at `/automater`
- ROI Calculator at `/roi-calculator/`

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

## Links & Integration

- **Assessment Demo**: `/automater` - Document extraction tool
- **ROI Calculator**: `/roi-calculator/` - ROI calculation tool
- **Contact Form**: `/contact` - Contact and booking
- **How It Works**: `/how-it-works` - Demo showcase

## Customization

### Colors
Edit CSS variables in `assets/css/styles.css`:
```css
:root {
    --color-navy: #0F172A;
    --color-gold: #D4AF37;
}
```

### Content
- Edit `homepage.html` for main content
- Update timelines in the Protocol section
- Modify metrics in Trust section
- Update product descriptions

### Logo
Logo file: `assets/images/curam-ai-logo.png` (already integrated)

### Video Background
Add video files to `assets/videos/`:
- `hero-background.mp4` (primary)
- `hero-background.webm` (fallback)

See `assets/videos/README.md` for specifications.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Notes

- Website is integrated with Flask app for unified deployment
- Contact form requires backend integration for actual submission
- Booking calendar integration needed for "Book a Diagnostic" CTA
- Australian English spelling used throughout (e.g., "modelling", "standardised")
