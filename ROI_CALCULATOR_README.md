# Curam AI ROI Calculator / Readiness Assessment

A dynamic ROI Calculator and Readiness Assessment tool designed to be embedded in a static HTML website. This tool helps potential clients understand the financial value of automation by calculating their annual efficiency loss and ROI opportunities.

## Features

- **Multi-Step Interactive Flow**: 4-step process (Industry Selection → Data Entry → Results → PDF Report)
- **Industry-Specific Questions**: Tailored questions for Architecture, Surveying, Manufacturing, and Environmental Consulting
- **Real-Time Calculations**: Instant ROI calculations based on user inputs
- **Visual Dashboard**: Bar charts and metrics showing current vs future state
- **PDF Report Generation**: Branded business case PDF for download
- **Responsive Design**: Midnight Blue (#0B1221) & Gold (#D4AF37) theme

## Installation

1. Install dependencies:
```bash
pip install -r requirements_roi.txt
```

2. Run the Streamlit app:
```bash
streamlit run roi_calculator.py
```

3. Access the app at `http://localhost:8501`

## Deployment

### Streamlit Cloud (Recommended)

1. Push your code to GitHub
2. Go to [Streamlit Cloud](https://streamlit.io/cloud)
3. Connect your repository
4. Set the main file to `roi_calculator.py`
5. Deploy!

### Other Platforms

- **Heroku**: Use Procfile with `web: streamlit run roi_calculator.py --server.port=$PORT --server.address=0.0.0.0`
- **AWS/Azure/GCP**: Deploy as containerized app
- **Self-hosted**: Run behind nginx reverse proxy

## Embedding in HTML

Use the provided `embed_snippet.html` code snippet. Replace the iframe `src` URL with your deployed Streamlit app URL.

Example:
```html
<iframe 
    src="https://your-app.streamlit.app" 
    width="100%" 
    height="800px" 
    frameborder="0"
></iframe>
```

## Configuration

### Industry Questions

Edit the `INDUSTRIES` dictionary in `roi_calculator.py` to customize:
- Industry names and contexts
- Question labels
- Pain point scoring
- Input types (slider vs dropdown)

### Styling

Modify the CSS in the `st.markdown()` block at the top of `roi_calculator.py` to match your brand colors.

### PDF Report

Customize the PDF template in the `generate_pdf_report()` function to match your branding.

## Calculation Logic

- **Annual Burn Rate**: `staff_count × weekly_waste × avg_rate × 48 weeks`
- **Tier 1 Savings**: `annual_burn × 0.40` (40% reduction)
- **Capacity Hours**: `staff_count × weekly_waste × 48 weeks`
- **Potential Revenue**: `capacity_hours × avg_rate`

## File Structure

```
.
├── roi_calculator.py          # Main Streamlit application
├── requirements_roi.txt       # Python dependencies
├── embed_snippet.html         # HTML embed code
└── ROI_CALCULATOR_README.md   # This file
```

## Support

For questions or issues, contact the development team.

