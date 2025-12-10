# Deployment Guide for Curam-Ai Applications

## Current Setup

The **Flask App** (`main.py`) serves everything in a unified deployment:

1. **Marketing Website**:
   - Homepage at `/` (root)
   - About page at `/about`
   - Services page at `/services`
   - Target Markets at `/target-markets`
   - Industry pages:
     - `/accounting`
     - `/professional-services`
     - `/logistics-compliance`
     - `/built-environment`
   - Contact page at `/contact`
   - How It Works at `/how-it-works`
   - FAQ at `/faq`
   - Blog at `/blog`
   - Search Results at `/search-results`
   - Sitemap at `/sitemap.html`
   - Case Study at `/case-study`
   - Multiple phase and report pages

2. **Document Extraction Tool (Automater)**:
   - Main route: `/automater`
   - Alternative routes: `/demo`, `/extract`

3. **ROI Calculator**:
   - Embedded page: `/roi.html`
   - Flask blueprint: `/roi-calculator/`

4. **API Endpoints**:
   - RAG Search: `/api/search-blog` (POST)
   - Contact Assistant: `/api/contact-assistant` (POST)
   - Contact Form: `/api/contact` (POST)
   - Message Relevance: `/api/check-message-relevance` (POST)
   - Email Chat Log: `/api/email-chat-log` (POST)

## Railway Deployment Steps

1. **Go to Railway Dashboard**: https://railway.app
2. **Create New Project** (or use existing)
3. **Connect GitHub Repository**: Your repository
4. **Select Branch**: Main branch (or your deployment branch)

5. **Configure Service**:
   - Railway should auto-detect Python from `requirements.txt`
   - **Start Command**: `gunicorn -w 4 -t 120 --bind 0.0.0.0:$PORT main:app`
   - Railway will use the `Procfile` automatically

6. **Set Environment Variables**:
   - `GEMINI_API_KEY` - Your Google Gemini API key (required for automater, RAG search, contact assistant)
   - `SECRET_KEY` - Flask session secret (generate a random string)
   - `PORT` - Automatically set by Railway

7. **Deploy**: Railway will build and deploy automatically

## Access Your Applications

Once deployed, your Railway URL (e.g., `https://curam-protocol.curam-ai.com.au`) will serve:

- **Homepage (Marketing Site)**: `https://your-url.railway.app/`
- **Industry Pages**: 
  - `https://your-url.railway.app/accounting`
  - `https://your-url.railway.app/professional-services`
  - `https://your-url.railway.app/logistics-compliance`
  - `https://your-url.railway.app/built-environment`
- **Automater (Extraction Tool)**: `https://your-url.railway.app/automater`
- **ROI Calculator**: 
  - `https://your-url.railway.app/roi.html`
  - `https://your-url.railway.app/roi-calculator/`
- **Contact Page**: `https://your-url.railway.app/contact`
- **How It Works**: `https://your-url.railway.app/how-it-works`
- **Blog**: `https://your-url.railway.app/blog`
- **Search Results**: `https://your-url.railway.app/search-results`

## Dependencies

### Required Python Packages

Ensure `requirements.txt` includes:
- `flask` - Web framework
- `gunicorn` - WSGI server for production
- `google-generativeai` - Gemini API client
- `pdfplumber` - PDF text extraction
- `pandas` - Data processing
- `requests` - HTTP requests (for RAG search, WordPress API)
- `plotly` - Charts for ROI calculator
- `reportlab` - PDF generation for ROI calculator

### Optional Dependencies

- `python-dotenv` - For local environment variable management

## Troubleshooting

### ROI Calculator Not Working

If `/roi-calculator/` or `/roi.html` returns 404 or errors:

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

4. **Try Both Routes**: Test both `/roi.html` and `/roi-calculator/`

### RAG Search Not Working

If search functionality fails:

1. **Check API Key**: Verify `GEMINI_API_KEY` is set in Railway environment variables
2. **Check WordPress API**: Verify `https://www.curam-ai.com.au/wp-json/wp/v2/posts` is accessible
3. **Check Logs**: Look for API errors in Railway logs
4. **Check Browser Console**: Look for JavaScript errors

### Contact Assistant Not Working

If contact assistant chat fails:

1. **Check API Key**: Verify `GEMINI_API_KEY` is set in Railway environment variables
2. **Check Logs**: Look for API errors in Railway logs
3. **Check Browser Console**: Look for JavaScript errors
4. **Verify Model**: Check that `gemini-2.0-flash-exp` is available (or update to available model)

### Automater Not Accessible

- The automater is at `/automater` (not root)
- Make sure `GEMINI_API_KEY` is set in Railway environment variables
- Check that sample PDFs exist in `invoices/` and `drawings/` directories

### Industry Pages Not Resolving

1. **Verify Routes**: Check that routes are registered in `main.py`:
   ```python
   @app.route('/accounting')
   @app.route('/accounting.html')
   def accounting_page():
       return send_file('accounting.html')
   ```

2. **Check Files**: Ensure HTML files exist in root directory
3. **Check Logs**: Look for 404 errors in Railway logs

### Static Assets Not Loading

- Ensure `assets/` directory is in the repository
- Check that routes are properly configured in `main.py`:
  ```python
  @app.route('/assets/<path:filename>')
  def assets(filename):
      return send_from_directory('assets', filename)
  ```

### Navbar Not Loading

1. **Check File**: Verify `assets/includes/navbar.html` exists
2. **Check JavaScript**: Verify `assets/js/navbar-loader.js` is loaded
3. **Check HTML**: Ensure pages have `<div id="navbar-placeholder"></div>`
4. **Check Browser Console**: Look for fetch errors

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
- http://localhost:5000/accounting - Accounting page
- http://localhost:5000/professional-services - Professional Services page
- http://localhost:5000/automater - Automater
- http://localhost:5000/roi.html - ROI Calculator
- http://localhost:5000/roi-calculator/ - ROI Calculator (direct)
- http://localhost:5000/contact - Contact page
- http://localhost:5000/blog - Blog page

## Production Checklist

- [ ] Set `SECRET_KEY` environment variable (don't use dev key)
- [ ] Set `GEMINI_API_KEY` environment variable
- [ ] Configure Gunicorn workers (4 workers recommended)
- [ ] Set appropriate timeout (120s for Gunicorn, 60s for Gemini API)
- [ ] Enable HTTPS (required for production)
- [ ] Set up error monitoring/logging
- [ ] Configure quota alerts for Gemini API
- [ ] Verify all routes are accessible
- [ ] Test RAG search functionality
- [ ] Test contact assistant functionality
- [ ] Test ROI calculator with all industries
- [ ] Verify navbar loads on all pages
- [ ] Check mobile responsiveness
- [ ] Verify static assets load correctly

## Important Notes

- **No Node.js Required**: The website is served by Flask, not Node.js
- **Unified Deployment**: Everything runs from one Flask app
- **Static Files**: All HTML, CSS, JS, images served by Flask
- **Environment Variables**: Required for automater, RAG search, and contact assistant functionality
- **API Dependencies**: RAG search requires WordPress API to be accessible
- **Model Availability**: Contact assistant uses `gemini-2.0-flash-exp` - may need to update if model changes
- **Multiple Routes**: Industry pages support both `/page` and `/page.html` routes for flexibility

## Scaling Considerations

### Current Limitations

- Single Flask app handles all routes (marketing, tools, APIs)
- Session storage in memory (not shared across workers)
- No database for result persistence
- No queue system for async processing
- RAG search queries WordPress API on every request

### Future Improvements

- Move to Redis for session storage
- Add database for result history and analytics
- Implement Celery/Redis queue for async PDF processing
- Add caching layer for RAG search results
- Implement rate limiting per user/IP
- Add CDN for static assets
- Separate marketing site from tools (microservices)
