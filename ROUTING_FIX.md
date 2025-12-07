# Routing Structure - Curam-Ai Website

## Current Route Structure

```
/                           → Homepage (marketing site) - Curam-Ai Protocol
/homepage                   → Homepage (alternative route)
/contact                    → Contact page
/how-it-works               → How it works page (demo showcase)
/automater                  → Document extraction tool (automater)
/demo                       → Document extraction tool (alias)
/extract                    → Document extraction tool (alias)
/roi-calculator/            → ROI Calculator
/assets/*                   → Static assets (CSS, JS, images, videos)
```

## Route Details

### Marketing Website Routes

- **`/`** (Root): Serves `homepage.html` - Main marketing homepage
- **`/homepage`**: Alternative route to homepage
- **`/contact`**: Contact form and booking page
- **`/how-it-works`**: Demo showcase and process explanation

### Application Routes

- **`/automater`**: Main route for document extraction tool
  - Alternative routes: `/demo`, `/extract`
  - Requires `GEMINI_API_KEY` environment variable
  
- **`/roi-calculator/`**: ROI calculation tool
  - Blueprint registered from `roi_calculator_flask.py`
  - Requires plotly, reportlab, pandas dependencies

### Static Assets

- **`/assets/css/styles.css`**: Main stylesheet
- **`/assets/js/main.js`**: JavaScript for interactivity
- **`/assets/images/*`**: Logo and image assets
- **`/assets/videos/*`**: Video background files (optional)

## Implementation

All routes are handled by Flask app (`main.py`):

```python
# Root route - serves homepage
@app.route('/')
def root():
    return send_file('homepage.html')

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
   - Automater: http://localhost:5000/automater
   - ROI Calculator: http://localhost:5000/roi-calculator/
   - Contact: http://localhost:5000/contact

### Production (Railway)

- Homepage: `https://protocol.curam-ai.com.au/`
- Automater: `https://protocol.curam-ai.com.au/automater`
- ROI Calculator: `https://protocol.curam-ai.com.au/roi-calculator/`

## Troubleshooting

### ROI Calculator Not Working

1. Check Railway logs for: "✓ ROI Calculator blueprint registered successfully"
2. Verify dependencies: `plotly`, `reportlab`, `pandas`
3. Check that `roi_calculator_flask.py` exists and imports correctly

### Automater Not Accessible

1. Verify route is `/automater` (not `/`)
2. Check `GEMINI_API_KEY` is set
3. Ensure sample PDFs exist in `invoices/` and `drawings/` directories

### Static Assets Not Loading

1. Verify `assets/` directory structure
2. Check route registration in `main.py`
3. Ensure file paths match exactly (case-sensitive)

## Notes

- Root route (`/`) serves the marketing homepage, not the automater
- Automater is intentionally at `/automater` to separate marketing from tools
- All static files are served by Flask, no separate web server needed
- Video background is optional - site works without it
