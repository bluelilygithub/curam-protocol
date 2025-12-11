# Flask Route Configuration for Legal Services

## Add to `main.py`

Add these routes alongside the existing industry page routes:

```python
@app.route('/legal-services')
@app.route('/legal-services.html')
@app.route('/legal')
def legal_services_page():
    """Legal services industry page"""
    return send_file('legal-services.html')
```

## Update Navigation (if navbar has industry dropdown)

In `assets/includes/navbar.html`, add legal services to the dropdown:

```html
<div class="dropdown">
    <a href="#" class="dropdown-toggle">Target Markets</a>
    <div class="dropdown-menu">
        <a href="/accounting">Accounting Firms</a>
        <a href="/legal-services">Legal Services</a>
        <a href="/professional-services">Professional Services</a>
        <a href="/logistics-compliance">Logistics & Compliance</a>
        <a href="/built-environment">Built Environment</a>
    </div>
</div>
```

## Update Sitemap

Add to `sitemap.html`:

```html
<li><a href="/legal-services">Legal Services</a> - AI automation for law firms</li>
```

## Deployment Checklist

- [ ] Copy `legal-services.html` to project root
- [ ] Add routes to `main.py`
- [ ] Update navbar dropdown (if needed)
- [ ] Add legal industry config to `roi_calculator_flask.py`
- [ ] Test local: `http://localhost:5000/legal-services`
- [ ] Test ROI calculator: `http://localhost:5000/roi.html?industry=legal`
- [ ] Deploy to Railway
- [ ] Test production: `https://curam-protocol.curam-ai.com.au/legal-services`

## Quick Test Commands

```bash
# Local testing
python main.py
# Navigate to http://localhost:5000/legal-services

# Test ROI calculator integration
# Navigate to http://localhost:5000/roi.html?industry=legal
```

## Files Modified

1. `legal-services.html` (NEW)
2. `main.py` (ADD ROUTES)
3. `roi_calculator_flask.py` (ADD LEGAL CONFIG)
4. `assets/includes/navbar.html` (UPDATE DROPDOWN - optional)
5. `sitemap.html` (ADD LINK - optional)

---

**Total Implementation Time:** ~15 minutes
