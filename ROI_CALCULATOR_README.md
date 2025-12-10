# Curam AI ROI Calculator / Readiness Assessment

A dynamic ROI Calculator and Readiness Assessment tool designed to help potential clients understand the financial value of automation by calculating their annual efficiency loss and ROI opportunities. Available both as a standalone Flask application and embedded in the main website.

## Features

- **Multi-Step Interactive Flow**: 4-step process (Industry Selection → Data Entry → Results → PDF Report)
- **Industry-Specific Questions**: Tailored questions for multiple industries including:
  - Architecture & Building Services
  - Surveying & Spatial Services
  - Manufacturing & Engineering
  - Environmental Consulting
  - Accounting & Advisory
  - And more...
- **Real-Time Calculations**: Instant ROI calculations based on user inputs
- **Visual Dashboard**: Bar charts and metrics showing current vs future state
- **PDF Report Generation**: Branded business case PDF for download
- **Responsive Design**: Midnight Blue (#0B1221) & Gold (#D4AF37) theme
- **URL Parameter Support**: Pre-select industries via URL parameters
- **Industry Group Selection**: Display industry groups (professional-services, built-environment, logistics-compliance)

## Installation

### Standalone Flask Application

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the Flask app:
```bash
python roi_calculator_flask.py
```

3. Access the app at `http://localhost:5000/`

### Integration with Main Website

The ROI calculator is integrated into the main Flask app (`main.py`) as a blueprint:

```python
from roi_calculator_flask import roi_app as roi_calculator_app
app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
```

This makes it available at:
- `/roi-calculator/` - Direct Flask app access
- `/roi.html` - Embedded page with iframe

## Deployment

### Railway (Current Production)

The ROI calculator is deployed as part of the main Flask application on Railway:

1. The main `main.py` imports and registers the ROI calculator blueprint
2. Railway automatically deploys when code is pushed
3. Accessible at:
   - `https://curam-protocol.curam-ai.com.au/roi-calculator/`
   - `https://curam-protocol.curam-ai.com.au/roi.html`

### Other Platforms

- **Heroku**: Use Procfile with `web: gunicorn main:app`
- **AWS/Azure/GCP**: Deploy as containerized app
- **Self-hosted**: Run behind nginx reverse proxy

## Embedding in HTML

The ROI calculator is embedded in `roi.html` using an iframe:

```html
<iframe 
    id="roi-calculator-iframe"
    src="/roi-calculator/" 
    width="100%" 
    height="800px" 
    frameborder="0"
></iframe>
```

JavaScript handles URL parameters to pre-select industries:

```javascript
// Pre-select industry from URL parameter
const urlParams = new URLSearchParams(window.location.search);
const industry = urlParams.get('industry');
if (industry) {
    // Update iframe src with industry parameter
    iframe.src = `/roi-calculator/?industry=${encodeURIComponent(industry)}`;
}
```

## URL Parameters

### Industry Pre-Selection

- **`?industry=<name>`**: Pre-selects an industry in the calculator
  - Example: `/roi.html?industry=accounting`
  - Example: `/roi.html?industry=engineering`
  - Valid values: Industry names from `INDUSTRIES` dictionary in `roi_calculator_flask.py`

### Industry Group Selection

- **`?section=<name>`**: Shows industry group selector instead of calculator
  - Example: `/roi.html?section=professional-services`
  - Example: `/roi.html?section=built-environment`
  - Example: `/roi.html?section=logistics-compliance`
  - Displays cards for industries within that section

## Configuration

### Industry Questions

Edit the `INDUSTRIES` dictionary in `roi_calculator_flask.py` to customize:
- Industry names and contexts
- Question labels (`q1_label`, `q2_label`)
- Question types (`q2_type`: `'slider'` or `'dropdown'`)
- Input ranges (`q2_range`)
- Question options (`q1_options`)

Example:
```python
INDUSTRIES = {
    "Accounting & Advisory": {
        "context": "Australian accounting firms (15-100 staff)",
        "q1_label": "What's your biggest pain point?",
        "q1_options": [
            "Manual data entry into Xero/MYOB",
            "Inter-entity reconciliation",
            "Trust account audits",
            "GL coding errors"
        ],
        "q2_label": "Average billable rate ($/hr)",
        "q2_type": "slider",
        "q2_range": [100, 500, 250]
    }
}
```

### AI Opportunities

Edit the `AI_OPPORTUNITIES` dictionary to customize:
- Tasks that can be automated
- Potential time savings
- Hours per week saved
- Task descriptions

Example:
```python
AI_OPPORTUNITIES = {
    "Accounting & Advisory": {
        "tasks": [
            "Invoice data entry into Xero/MYOB",
            "Inter-entity reconciliation",
            "Trust account audit preparation",
            "GL coding automation"
        ],
        "potential": 0.40,  # 40% capacity recovery
        "hours_per_week": 4,
        "description": "Automated document processing for accounting workflows"
    }
}
```

### Styling

Modify the CSS in the `HTML_TEMPLATE`'s `<style>` block to match your brand colors. The current theme uses:
- Background: Midnight Blue (#0B1221)
- Accent: Gold (#D4AF37)
- Text: Light colors for contrast

### PDF Report

Customize the PDF template in the `generate_pdf_report()` function to match your branding. The report includes:
- Company logo (if available)
- Industry-specific content
- Calculation results
- Visual charts
- Business case summary

## Calculation Logic

### Annual Burn Rate
```
annual_burn = staff_count × weekly_waste × avg_rate × 48 weeks
```

### Tier 1 Savings (40% reduction)
```
tier1_savings = annual_burn × 0.40
```

### Capacity Hours
```
capacity_hours = staff_count × weekly_waste × 48 weeks
```

### Potential Revenue
```
potential_revenue = capacity_hours × avg_rate
```

### Industry-Specific Calculations

Each industry can have custom calculation logic. The base calculation uses:
- Staff count
- Weekly waste hours
- Average billable rate
- Industry-specific potential percentage

## File Structure

```
.
├── roi_calculator_flask.py    # Main Flask application (blueprint)
├── roi_calculator.py          # Streamlit version (legacy, not used)
├── roi.html                   # Embedded page with iframe
├── requirements.txt           # Python dependencies
└── ROI_CALCULATOR_README.md   # This file
```

## Dependencies

Required Python packages:
- `flask` - Web framework
- `plotly` - Charts and visualizations
- `reportlab` - PDF generation
- `pandas` - Data processing
- `werkzeug` - URL utilities

## Industry-Specific Results

### Accounting & Advisory

When `industry == "Accounting & Advisory"`, the results page displays a special "Phase 1 Proof → Year 1 Revenue" section with:
- Hours saved per month
- Extraction accuracy
- Payback period
- Year 1 Revenue estimate
- Footnote with phase breakdown

This section replaces the standard "Typical Client Results" for accounting firms.

## Dynamic Headings

The Step 2 heading is dynamic based on selected industry:
```python
<h1>Input Your Baseline Data{% if industry %}: {{ industry }}{% endif %}</h1>
```

This provides context about which industry the user is calculating for.

## Integration with Main Website

### Navigation Links

Industry pages link to ROI calculator with pre-selected industries:
- Accounting page: `/roi.html?industry=accounting`
- Professional Services page: `/roi.html?section=professional-services`
- Built Environment page: `/roi.html?section=built-environment`
- Logistics Compliance page: `/roi.html?section=logistics-compliance`

### Blueprint Registration

The ROI calculator is registered in `main.py`:
```python
from roi_calculator_flask import roi_app as roi_calculator_app
app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
```

This allows the calculator to be accessed at `/roi-calculator/` while maintaining separation of concerns.

## Troubleshooting

### Calculator Not Loading

1. Check Railway logs for: "✓ ROI Calculator blueprint registered successfully"
2. Verify dependencies are installed: `plotly`, `reportlab`, `pandas`
3. Check that `roi_calculator_flask.py` exists and imports correctly
4. Try both `/roi.html` and `/roi-calculator/` routes

### Industry Not Pre-Selecting

1. Check URL parameter format: `?industry=accounting` (not `?industry=Accounting & Advisory`)
2. Verify industry name matches exactly in `INDUSTRIES` dictionary
3. Check browser console for JavaScript errors
4. Verify iframe `src` is being updated correctly

### PDF Generation Failing

1. Check that `reportlab` is installed
2. Verify file permissions for PDF generation
3. Check Railway logs for PDF generation errors
4. Ensure all required data is present in calculation results

### Calculations Not Matching

1. Verify input values are being captured correctly
2. Check calculation formulas in `calculate_roi()` function
3. Verify industry-specific potential percentages
4. Check for rounding errors in display

## Support

For questions or issues, contact the development team or refer to:
- `TECHNICAL_DOCUMENTATION.md` - Technical implementation details
- `DEPLOYMENT_GUIDE.md` - Deployment instructions
- `ROUTING_FIX.md` - Route structure documentation

## Notes

- The calculator supports both standalone and embedded usage
- URL parameters allow deep linking to specific industries
- Industry groups enable navigation between related industries
- PDF reports are generated on-demand and include all calculation details
- All calculations are performed server-side for accuracy
- The calculator uses session storage to maintain state across steps
