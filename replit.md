# Curam-AI Website

## Overview
This is a Flask-based website for Curam-AI, an AI-powered document automation platform targeting Australian businesses. The application includes:
- Marketing website with multiple pages (About, Services, Contact, etc.)
- AI-powered document processing demo (invoice extraction, engineering schedules, transmittals)
- ROI Calculator tool

## Project Structure
- `main.py` - Main Flask application with routes and AI document processing
- `roi_calculator_flask.py` - ROI Calculator blueprint
- `assets/` - Static assets (CSS, JS, images, videos)
- `invoices/` - Sample invoice PDFs for demo
- `drawings/` - Sample engineering drawing PDFs for demo

## Running the Application
The Flask server runs on port 5000 with `python main.py`

## Environment Variables
- `GEMINI_API_KEY` - Google Gemini API key for AI document processing
- `SECRET_KEY` - Flask session secret key (has default for development)

## Deployment
Configured for autoscale deployment using gunicorn:
```
gunicorn --bind=0.0.0.0:5000 --workers=4 --timeout=120 main:app
```

## Recent Changes
- 2026-01-10: Initial Replit environment setup, configured Flask to bind to 0.0.0.0:5000
