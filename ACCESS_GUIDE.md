# How to Access Your Applications

## Production URLs (Railway Deployment)

### Marketing Website
- **Homepage**: `https://protocol.curam-ai.com.au/`
- **Contact**: `https://protocol.curam-ai.com.au/contact`
- **How It Works**: `https://protocol.curam-ai.com.au/how-it-works`

### Document Extraction Tool (Automater/Assessment)
- **Main Route**: `https://protocol.curam-ai.com.au/automater`
- **Alternative Routes**: 
  - `https://protocol.curam-ai.com.au/demo`
  - `https://protocol.curam-ai.com.au/extract`

### ROI Calculator
- **Route**: `https://protocol.curam-ai.com.au/roi-calculator/`

## Quick Reference

- 🏠 **Homepage**: `/` - Curam-Ai Protocol marketing site
- 🔧 **Automater**: `/automater` - Document extraction tool
- 📊 **ROI Calculator**: `/roi-calculator/` - ROI calculation tool
- 📧 **Contact**: `/contact` - Contact form and booking
- ℹ️ **How It Works**: `/how-it-works` - Demo showcase

## Homepage Features

### Hero Section
- Video background (with fallback gradient)
- 3 Call-to-Action buttons:
  1. **Assessment Demo** (Gold button) → `/automater`
  2. **Book a Diagnostic** (White border) → `/contact`
  3. **Calculate Your ROI** (White border) → `/roi-calculator/`
- Bouncing down arrow on "View The Protocol" link

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

### Video Background Not Playing
- This is normal if video files aren't uploaded
- Site uses a gradient fallback automatically
- To add video: place `hero-background.mp4` and `.webm` in `assets/videos/`

### Static Assets Not Loading
- Check that `assets/` directory is in the repository
- Verify routes in `main.py` are correct
- Clear browser cache

## Local Development

For local testing, see `DEPLOYMENT_GUIDE.md` for setup instructions.
