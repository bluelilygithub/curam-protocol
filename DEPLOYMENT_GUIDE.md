# Deployment Guide for Curam-Ai Applications

## Current Setup

The **Flask App** (`main.py`) serves everything in a unified deployment:

1. **Marketing Website**:
   - Homepage at `/` (root)
   - Contact page at `/contact`
   - How It Works at `/how-it-works`

2. **Document Extraction Tool (Automater)**:
   - Main route: `/automater`
   - Alternative routes: `/demo`, `/extract`

3. **ROI Calculator**:
   - Route: `/roi-calculator/`

## Railway Deployment Steps

1. **Go to Railway Dashboard**: https://railway.app
2. **Create New Project** (or use existing)
3. **Connect GitHub Repository**: `bluelilygithub/Fsace-Invoices`
4. **Select Branch**: `create-website` (or merge to main first)

5. **Configure Service**:
   - Railway should auto-detect Python from `requirements.txt`
   - **Start Command**: `gunicorn -w 4 -t 120 --bind 0.0.0.0:$PORT main:app`
   - Railway will use the `Procfile` automatically

6. **Set Environment Variables**:
   - `GEMINI_API_KEY` - Your Google Gemini API key (required for automater)
   - `SECRET_KEY` - Flask session secret (generate a random string)
   - `PORT` - Automatically set by Railway

7. **Deploy**: Railway will build and deploy automatically

## Access Your Applications

Once deployed, your Railway URL (e.g., `https://protocol.curam-ai.com.au`) will serve:

- **Homepage (Marketing Site)**: `https://your-url.railway.app/`
- **Automater (Extraction Tool)**: `https://your-url.railway.app/automater`
- **ROI Calculator**: `https://your-url.railway.app/roi-calculator/`
- **Contact Page**: `https://your-url.railway.app/contact`
- **How It Works**: `https://your-url.railway.app/how-it-works`

## Troubleshooting

### ROI Calculator Not Working

If `/roi-calculator/` returns 404 or errors:

1. **Check Dependencies**: Ensure `requirements.txt` includes:
   - `plotly>=5.17.0`
   - `reportlab>=4.0.0`
   - `pandas`

2. **Check Import**: The ROI calculator is imported in `main.py`:
   ```python
   from roi_calculator_flask import roi_app as roi_calculator_app
   app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
   ```

3. **Check Logs**: In Railway dashboard, look for "✓ ROI Calculator blueprint registered successfully"

### Automater Not Accessible

- The automater is at `/automater` (not root)
- Make sure `GEMINI_API_KEY` is set in Railway environment variables
- Check that sample PDFs exist in `invoices/` and `drawings/` directories

### Static Assets Not Loading

- Ensure `assets/` directory is in the repository
- Check that routes are properly configured in `main.py`:
  ```python
  @app.route('/assets/<path:filename>')
  def assets(filename):
      return send_from_directory('assets', filename)
  ```

### Video Background Not Showing

- Video files are optional - site will use fallback gradient if not present
- Add `assets/videos/hero-background.mp4` and `.webm` files
- See `assets/videos/README.md` for specifications

## Local Testing

To test the Flask app locally:

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variable
export GEMINI_API_KEY="your-key-here"
export SECRET_KEY="your-secret-key"

# Run the app
python main.py
# Or with gunicorn:
gunicorn -w 4 -t 120 main:app
```

Then visit:
- http://localhost:5000/ - Homepage
- http://localhost:5000/automater - Automater
- http://localhost:5000/roi-calculator/ - ROI Calculator
- http://localhost:5000/contact - Contact page

## Important Notes

- **No Node.js Required**: The website is served by Flask, not Node.js
- **Unified Deployment**: Everything runs from one Flask app
- **Static Files**: All HTML, CSS, JS, images served by Flask
- **Environment Variables**: Required for automater functionality
