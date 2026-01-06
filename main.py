import os
import json
import re
from flask import Flask, request, render_template, render_template_string, session, Response, send_file, abort, url_for, send_from_directory, redirect, jsonify
import google.generativeai as genai
import pdfplumber
import pandas as pd
import io
try:
    import grpc
except ImportError:
    grpc = None
import time
from werkzeug.utils import secure_filename
import requests
from urllib.parse import quote

from database import (
    test_connection, 
    get_document_types_by_sector, 
    engine, 
    get_sectors, 
    get_demo_config_by_department,
    get_samples_for_template,
    get_sector_demo_config
)
from sqlalchemy import text

# Phase 3.1: Validation Service (extracted from main.py lines 3124-3449)
from services.validation_service import (
    detect_low_confidence,
    correct_ocr_errors,
    validate_engineering_field
)

# Formatting utilities
from utils.formatting import format_currency, format_text_to_html

# Phase 3.2: PDF Service (extracted from main.py lines 150-158, 3494-3522)
from services.pdf_service import (
    extract_text,
    prepare_prompt_text
)

# Phase 3.3c: Gemini Service - COMPLETE (all 3 functions extracted)
from services.gemini_service import get_available_models, build_prompt, analyze_gemini, HTML_TEMPLATE

# Phase 3.4: RAG Search Service (extracted from main.py lines 313-797)
from services.rag_service import (
    extract_text_from_html,
    calculate_authority_score,
    search_static_html_pages,
    perform_rag_search
)

# Phase 4.1: Static Pages Blueprint
from routes.static_pages import static_pages_bp

# Phase 4.2: Automater Routes Blueprint
from routes.automater_routes import automater_bp

# Try to import specific exception types
try:
    from google.api_core import exceptions as google_exceptions
except ImportError:
    google_exceptions = None

# Import configuration
from config import (
    SECRET_KEY,
    FINANCE_UPLOAD_DIR,
    DEFAULT_DEPARTMENT,
    DEPARTMENT_SAMPLES,
    SAMPLE_TO_DEPT,
    ALLOWED_SAMPLE_PATHS,
    ROUTINE_DESCRIPTIONS,
    ROUTINE_SUMMARY,
    ENGINEERING_PROMPT_LIMIT,
    ENGINEERING_PROMPT_LIMIT_SHORT,
    TRANSMITTAL_PROMPT_LIMIT,
    FINANCE_FIELDS,
    ENGINEERING_BEAM_FIELDS,
    ENGINEERING_COLUMN_FIELDS,
    TRANSMITTAL_FIELDS,
    DOC_FIELDS,
    ERROR_FIELD
)

app = Flask(__name__, static_folder='assets', static_url_path='/assets')
app.secret_key = SECRET_KEY

# Register blueprints
app.register_blueprint(static_pages_bp)
app.register_blueprint(automater_bp)

# Configure UTF-8 encoding sanitization for corrupt characters
from utils.encoding_fix import create_safe_template_filter, sanitize_response_middleware

# Add Jinja2 filter for automatic sanitization in templates
app.jinja_env.filters['sanitize'] = create_safe_template_filter()

# Add middleware to sanitize all HTML responses (optional - uncomment to enable)
# This will clean ALL HTML responses automatically
# app.after_request(sanitize_response_middleware)

# Error handler for debugging
@app.errorhandler(500)
def internal_error(error):
    """Show detailed error message for debugging"""
    import traceback
    trace = traceback.format_exc()
    app.logger.error(f"500 Internal Server Error:\n{trace}")
    if app.debug:
        return f"<pre>Internal Server Error:\n\n{trace}</pre>", 500
    return "Internal Server Error. Please check the logs.", 500

# Configure Gemini API
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Create upload directories
os.makedirs(FINANCE_UPLOAD_DIR, exist_ok=True)

# Cache for available models
_available_models = None

from services.image_preprocessing import TESSERACT_AVAILABLE, CV2_AVAILABLE


# =============================================================================
# API ROUTES
# =============================================================================

@app.route('/test/dependencies', methods=['GET'])
def test_dependencies():
    """Check Tesseract status - visit this URL in browser"""
    status = {
        "tesseract_ocr": {
            "installed": TESSERACT_AVAILABLE,
            "status": "âœ… Available" if TESSERACT_AVAILABLE else "âŒ Not installed"
        },
        "opencv": {
            "installed": CV2_AVAILABLE,
            "status": "âœ… Available" if CV2_AVAILABLE else "âŒ Not installed"
        }
    }
    
    if TESSERACT_AVAILABLE:
        try:
            import pytesseract
            version = pytesseract.get_tesseract_version()
            status["tesseract_ocr"]["version"] = str(version)
            status["tesseract_ocr"]["test"] = "âœ… Working"
        except Exception as e:
            status["tesseract_ocr"]["test"] = f"âŒ Error: {str(e)}"
    
    return status, 200

@app.route('/api/search-blog', methods=['POST'])
def search_blog_rag():
    """
    TWO-PHASE RAG Search - Fast initial results with static pages.
    Returns immediately with website results, then continues searching blog.
    
    Client should:
    1. Display initial results from this endpoint
    2. Show "Searching 800+ blog articles..." message
    3. Call /api/search-blog-complete for full results with blog posts
    """
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Import the fast search function
        from services.rag_service import perform_rag_search_fast
        
        # Phase 1: Quick search of static pages only (returns in <500ms)
        fast_results = perform_rag_search_fast(query, max_results=5)
        
        # Generate quick answer from static pages only
        initial_answer = ""
        if fast_results['context']:
            try:
                model = genai.GenerativeModel('gemini-2.0-flash-exp')
                
                prompt = f"""You are a helpful assistant for Curam-Ai Protocol™, an AI document automation service.

The user asked: "{query}"

Below is relevant content from our website pages. Provide a helpful answer based on this content.

Content from Website:
{fast_results['context']}

Instructions:
1. Provide a direct answer using the content above
2. Be thorough but concise
3. Reference source titles when citing information
4. Note: This is initial information from our website. We're also searching our 800+ blog articles for more detailed insights.

Answer:"""
                
                response = model.generate_content(prompt)
                initial_answer = response.text if response.text else "Searching for information..."
                
            except Exception as e:
                print(f"Error generating initial answer: {e}")
                initial_answer = "Found relevant pages. Searching our 800+ blog articles for more detailed information..."
        else:
            initial_answer = "Searching our website and 800+ blog articles for information about your query..."
        
        # Return initial results immediately
        return jsonify({
            'answer': initial_answer,
            'sources': fast_results['sources'],
            'query': query,
            'searching_blog': True,
            'message': '🔍 Searching 800+ blog articles for additional information...'
        })
            
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/search-blog-complete', methods=['POST'])
def search_blog_complete():
    """
    COMPLETE RAG Search - Full results including both static pages and blog posts.
    This is slower (3-10 seconds) but includes comprehensive blog search results.
    
    Use this endpoint for:
    - Synchronous full search (simpler implementation)
    - Second call after /api/search-blog to get blog results
    """
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Import the full search function
        from services.rag_service import perform_rag_search
        
        # Perform complete search (both static pages AND blog posts)
        rag_results = perform_rag_search(query, max_results=5)
        
        # Check if there was an error reaching the blog
        if 'error' in rag_results and not rag_results['sources']:
            return jsonify({
                'error': rag_results.get('error'),
                'answer': 'The blog is currently unavailable. Please try again later or contact us directly.',
                'sources': [],
                'query': query
            }), 503
        
        # If no content found, provide a helpful message
        if not rag_results['context']:
            print(f"No context found for query: {query}")
            return jsonify({
                'answer': f"I couldn't find specific information about '{query}' in our blog or website content. This topic might not be directly related to AI document automation, the Curam-Ai Protocol, or our services. Please visit <a href='https://blog.curam-ai.com.au/?s={query}' target='_blank'>blog.curam-ai.com.au</a> to search our full blog, or <a href='contact.html'>contact us</a> if you have questions about our services.",
                'sources': [],
                'query': query,
                'complete': True
            })
        
        # Use Gemini to generate comprehensive answer
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            prompt = f"""You are a helpful assistant for Curam-Ai Protocol™, an AI document automation service for engineering firms.

The user asked: "{query}"

Below is relevant content from our WordPress blog (800+ articles) and our website pages. Use this content to provide a comprehensive, informative answer.

Content from Blog and Website:
{rag_results['context']}

Instructions:
1. Provide a direct, comprehensive answer to the user's question using the content above
2. If the question is "what is X", explain what X is clearly and thoroughly
3. Include key details, definitions, and important information from both blog posts and website pages
4. Synthesize information from multiple sources if relevant (combine blog and website content)
5. Reference specific source titles when citing information (mention if it's from a blog post or website page)
6. Be thorough - the user wants to understand the topic, not just get a brief mention
7. If the content discusses comparisons or costs, also explain what the thing itself is
8. Prioritize website pages for information about services, pricing, and processes
9. Use blog posts for detailed explanations, case studies, and technical deep dives

Answer the question comprehensively:"""
            
            response = model.generate_content(prompt)
            answer = response.text if response.text else "I couldn't generate an answer. Please visit blog.curam-ai.com.au for more information."
            
            return jsonify({
                'answer': answer,
                'sources': rag_results['sources'],
                'query': query,
                'complete': True
            })
            
        except Exception as e:
            return jsonify({
                'answer': f"I encountered an error processing your question. Please visit blog.curam-ai.com.au to search for information about '{query}'.",
                'sources': rag_results['sources'],
                'query': query,
                'error': str(e),
                'complete': True
            }), 500
            
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/contact-assistant', methods=['POST'])
def contact_assistant():
    """AI Contact Assistant with RAG, follow-up questions, visible links"""
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        conversation_history = data.get('history', [])
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Skip RAG for greetings
        simple_msgs = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'okay', 'yes', 'no']
        use_rag = message.lower().strip() not in simple_msgs and len(message.split()) > 2
        
        rag_context = ""
        sources = []
        
        if use_rag:
            try:
                rag_results = perform_rag_search(message, max_results=3)
                if rag_results.get('context'):
                    rag_context = rag_results['context']
                    sources = rag_results['sources']
            except Exception as e:
                print(f"RAG failed: {e}")
        
        # System prompt
        if rag_context:
            system_prompt = f"""You are an AI assistant for Curam-Ai ProtocolÃ¢â€žÂ¢.

User asked: "{message}"

Content from our blog/website:
{rag_context}

Answer using this content. Put source titles in "quotes". Use paragraphs (\n\n).

Services: Phase 1 ($1,500), Phase 2 ($7,500), Phase 3 ($8-12k), Phase 4 ($20-30k)"""
        else:
            system_prompt = """You are an AI assistant for Curam-Ai ProtocolÃ¢â€žÂ¢.

Services: Phase 1 ($1,500), Phase 2 ($7,500), Phase 3 ($8-12k), Phase 4 ($20-30k)

Use paragraphs (\n\n)."""
        
        # Build conversation
        conversation = [{"role": "user", "parts": [system_prompt]}]
        recent = conversation_history[-10:] if len(conversation_history) > 10 else conversation_history
        for item in recent:
            role = "user" if item.get('role') == 'user' else "model"
            conversation.append({"role": role, "parts": [item.get('content', '')]})
        conversation.append({"role": "user", "parts": [message]})
        
        # Get AI response
        model = genai.GenerativeModel('gemini-2.0-flash-exp')
        response = model.generate_content(conversation)
        text = response.text if response.text else "How can I help?"
        
        import re
        
        # Convert quoted titles to links
        if sources:
            urls = {}
            for s in sources:
                t = s.get('title', '').strip()
                u = s.get('link', '')
                if t and u:
                    urls[t] = u
            
            def link_it(match):
                q = match.group(1)
                for title, url in urls.items():
                    if q.lower() in title.lower() or title.lower() in q.lower():
                        return f'<a href="{url}" target="_blank">\"{q}\"</a>'
                return f'\"{q}\"'
            
            text = re.sub(r'\"([^\"]+)\"', link_it, text)
        
        # Format paragraphs
        parts = []
        for para in text.split('\n\n'):
            para = para.strip()
            if not para:
                continue
            # Skip meaningless short content (single punctuation, stray characters)
            if len(para) <= 2 and not para.isalnum():
                continue
            if '- ' in para or 'Ã¢â‚¬Â¢ ' in para:
                items = []
                for line in para.split('\n'):
                    if line.strip().startswith(('-', 'Ã¢â‚¬Â¢')):
                        items.append(f'<li>{line.lstrip("-Ã¢â‚¬Â¢ ").strip()}</li>')
                if items:
                    parts.append(f'<ul>{"".join(items)}</ul>')
            else:
                parts.append(f'<p>{para.replace(chr(10), "<br>")}</p>')
        
        html = ''.join(parts) if parts else f'<p>{text}</p>'
        
        # Generate 3 follow-up questions based on the query and sources
        followup_questions = []
        print(f"DEBUG: use_rag={use_rag}, message='{message}'")
        if use_rag:  # Generate for all substantive queries, not just when sources exist
            # Use Gemini to generate contextual follow-up questions
            try:
                # Build prompt with sources if available
                sources_text = ""
                if sources and len(sources) > 0:
                    source_titles = [f"- {s.get('title', '')}" for s in sources[:3]]
                    sources_text = f"\n\nAnd these available sources:\n" + "\n".join(source_titles)
                
                followup_prompt = f"""Based on this user question: "{message}"{sources_text}

Generate exactly 3 short, specific follow-up questions (max 10 words each) that would help the user learn more. Questions should be directly answerable from our content.

Format: One question per line, no numbering, no punctuation at end.

Example:
How does Phase 1 reduce implementation risk
What industries benefit most from RAG
Can this work with handwritten documents"""
                
                print(f"DEBUG: Generating follow-up questions...")
                fq_model = genai.GenerativeModel('gemini-2.0-flash-exp')
                fq_response = fq_model.generate_content(followup_prompt)
                if fq_response.text:
                    questions = [q.strip().rstrip('?').strip() for q in fq_response.text.strip().split('\n') if q.strip()]
                    followup_questions = questions[:3]  # Take first 3
                    print(f"DEBUG: Generated {len(followup_questions)} follow-up questions: {followup_questions}")
                else:
                    print("DEBUG: fq_response.text is empty")
            except Exception as e:
                print(f"Follow-up generation failed: {e}")
                import traceback
                traceback.print_exc()
                # Don't show fallback questions - hide section if generation fails
        else:
            print(f"DEBUG: Skipping follow-up generation (use_rag=False)")
        
        # Suggested interest
        ml = message.lower()
        interest = None
        if 'phase 1' in ml or 'feasibility' in ml:
            interest = 'phase-1'
        elif 'phase 2' in ml:
            interest = 'phase-2'
        elif 'phase 3' in ml:
            interest = 'phase-3'
        elif 'phase 4' in ml:
            interest = 'phase-4'
        elif 'roi' in ml:
            interest = 'roi'
        
        # Separate sources
        web = [s for s in sources if s.get('type') == 'website']
        blog = [s for s in sources if s.get('type') == 'blog']
        
        return jsonify({
            'message': html,
            'suggested_interest': interest,
            'sources': {'website': web, 'blog': blog},
            'followup_questions': followup_questions
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/email-chat-log', methods=['POST'])
def email_chat_log():
    """
    Email the chat log from the AI Contact Assistant conversation.
    """
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        conversation_history = data.get('history', [])
        user_name = data.get('name', '')
        company = data.get('company', '')
        
        if not email:
            return jsonify({'error': 'Email address is required'}), 400
        
        if not conversation_history:
            return jsonify({'error': 'No conversation history to email'}), 400
        
        # Generate email content
        email_subject = f"Curam-Ai Contact Assistant Conversation - {user_name or 'Inquiry'}"
        
        # Build HTML email content
        email_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                h1 {{ color: #0B1221; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }}
                .message {{ margin: 15px 0; padding: 12px; border-radius: 6px; }}
                .user-message {{ background: #0B1221; color: white; text-align: right; }}
                .assistant-message {{ background: #F8F9FA; border-left: 3px solid #D4AF37; }}
                .meta {{ color: #666; font-size: 0.9em; margin-top: 20px; padding-top: 20px; border-top: 1px solid #E5E7EB; }}
            </style>
        </head>
        <body>
            <h1>Your Curam-Ai Contact Assistant Conversation</h1>
            <p>Thank you for using our AI Contact Assistant. Here's a transcript of our conversation:</p>
        """
        
        if user_name or company:
            email_html += f"<p><strong>Name:</strong> {user_name or 'Not provided'}<br>"
            email_html += f"<strong>Company:</strong> {company or 'Not provided'}</p>"
        
        email_html += "<div style='margin: 20px 0;'>"
        
        for msg in conversation_history:
            role = msg.get('role', '')
            content = msg.get('content', '')
            if role == 'user':
                email_html += f'<div class="message user-message"><strong>You:</strong> {content}</div>'
            elif role == 'assistant':
                email_html += f'<div class="message assistant-message"><strong>AI Assistant:</strong> {content}</div>'
        
        email_html += """
            </div>
            <div class="meta">
                <p><strong>Next Steps:</strong></p>
                <ul>
                    <li>Fill out our contact form to continue the conversation</li>
                    <li>Book a diagnostic call to discuss your specific needs</li>
                    <li>Try our ROI Calculator to see potential savings</li>
                </ul>
                <p>Visit us at <a href="https://protocol.curam-ai.com.au">protocol.curam-ai.com.au</a></p>
                <p>Best regards,<br>Curam-Ai ProtocolÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Team</p>
            </div>
        </body>
        </html>
        """
        
        # Plain text version
        email_text = f"""Your Curam-Ai Contact Assistant Conversation\n\n"""
        if user_name or company:
            email_text += f"Name: {user_name or 'Not provided'}\n"
            email_text += f"Company: {company or 'Not provided'}\n\n"
        email_text += "Conversation:\n\n"
        for msg in conversation_history:
            role = msg.get('role', '')
            content = msg.get('content', '')
            if role == 'user':
                email_text += f"You: {content}\n\n"
            elif role == 'assistant':
                email_text += f"AI Assistant: {content}\n\n"
        email_text += "\nNext Steps:\n"
        email_text += "- Fill out our contact form to continue the conversation\n"
        email_text += "- Book a diagnostic call to discuss your specific needs\n"
        email_text += "- Try our ROI Calculator to see potential savings\n\n"
        email_text += "Visit us at https://protocol.curam-ai.com.au\n\n"
        email_text += "Best regards,\nCuram-Ai ProtocolÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Team"
        
        # Send email using Mailchannels API
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        if not mailchannels_api_key:
            app.logger.error("MAILCHANNELS_API_KEY not configured - email sending disabled")
            # Log available env vars for debugging (without exposing sensitive data)
            env_vars = [k for k in os.environ.keys() if 'MAIL' in k.upper() or 'EMAIL' in k.upper()]
            app.logger.info(f"Available email-related env vars: {env_vars}")
            return jsonify({
                'error': 'Email service is currently unavailable. Please fill out the contact form below or try again later.',
                'details': 'MAILCHANNELS_API_KEY environment variable is missing'
            }), 503
        
        # Get from email address (default to noreply, but can be configured)
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Mailchannels API endpoint
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        
        # Prepare email data for Mailchannels
        email_data = {
            "personalizations": [
                {
                    "to": [{"email": email}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam-Ai Protocol"
            },
            "subject": email_subject,
            "content": [
                {
                    "type": "text/plain",
                    "value": email_text
                },
                {
                    "type": "text/html",
                    "value": email_html
                }
            ]
        }
        
        # Set headers - MailChannel API key is optional if domain lockdown is configured
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        try:
            # Send email via Mailchannels API
            response = requests.post(mailchannels_url, json=email_data, headers=headers, timeout=10)
            
            if response.status_code == 202:
                app.logger.info(f"Chat log email sent successfully to {email}")
                return jsonify({
                    'success': True,
                    'message': 'Chat log email sent successfully'
                })
            else:
                app.logger.error(f"Mailchannels API error: {response.status_code} - {response.text}")
                return jsonify({
                    'error': f'Failed to send email. Please try again later.',
                    'details': response.text if response.text else 'Unknown error'
                }), 500
                
        except requests.RequestException as e:
            app.logger.error(f"Error sending email via Mailchannels: {e}")
            return jsonify({
                'error': 'Failed to send email. Please try again later.'
            }), 500
        
    except Exception as e:
        app.logger.error(f"Email chat log failed: {e}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


@app.route('/api/contact', methods=['POST'])
def contact_form_submission():
    """Handle contact form submissions with email tracking"""
    from flask import jsonify, request
    import requests
    from database import capture_email_request, mark_email_sent
    
    capture_id = None
    
    try:
        # Get form data (could be JSON or form data)
        if request.is_json:
            data = request.get_json()
        else:
            data = request.form.to_dict()
        
        # Extract form fields
        name = data.get('name', '')
        email = data.get('email', '')
        company = data.get('company', '')
        phone = data.get('phone', '')
        message = data.get('message', '')
        inquiry_type = data.get('inquiry_type', '') or data.get('type', '') or data.get('option', '')
        
        # Validation
        if not email:
            return jsonify({"success": False, "error": "Email is required"}), 400
        
        if not name:
            return jsonify({"success": False, "error": "Name is required"}), 400
        
        if not message:
            return jsonify({"success": False, "error": "Message is required"}), 400
        
        # Capture form submission for tracking
        capture_id = capture_email_request(
            email_address=email,
            report_type='contact_form',
            source_page=request.referrer or '/contact.html',
            request_data={
                'name': name,
                'company': company,
                'phone': phone,
                'inquiry_type': inquiry_type,
                'message': message[:500],  # First 500 chars of message
                'form_source': 'contact_page'
            },
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            session_id=session.get('_id')
        )
        
        # Prepare email content
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Email to internal team
        email_data = {
            "personalizations": [
                {
                    "to": [{"email": "michaelbarrett@bluelily.com.au"}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam AI Contact Form"
            },
            "reply_to": {
                "email": email,
                "name": name
            },
            "subject": f"New Contact Form Submission{' - ' + inquiry_type if inquiry_type else ''} from {name}",
            "content": [
                {
                    "type": "text/plain",
                    "value": f"""New Contact Form Submission

Name: {name}
Email: {email}
Company: {company or 'Not provided'}
Phone: {phone or 'Not provided'}
Inquiry Type: {inquiry_type or 'General inquiry'}

Message:
{message}

---
Submitted from: {request.referrer or 'Direct URL'}
IP Address: {request.remote_addr}
User Agent: {request.headers.get('User-Agent', 'Unknown')}
"""
                },
                {
                    "type": "text/html",
                    "value": f"""
                    <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #4B5563;">
                        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #0B1221; border-bottom: 3px solid #D4AF37; padding-bottom: 10px;">
                                New Contact Form Submission
                            </h2>
                            
                            <div style="background: #F8F9FA; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                <p style="margin: 5px 0;"><strong>Name:</strong> {name}</p>
                                <p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:{email}">{email}</a></p>
                                <p style="margin: 5px 0;"><strong>Company:</strong> {company or 'Not provided'}</p>
                                <p style="margin: 5px 0;"><strong>Phone:</strong> {phone or 'Not provided'}</p>
                                <p style="margin: 5px 0;"><strong>Inquiry Type:</strong> {inquiry_type or 'General inquiry'}</p>
                            </div>
                            
                            <div style="background: white; border-left: 4px solid #D4AF37; padding: 15px; margin: 20px 0;">
                                <h3 style="margin-top: 0; color: #0B1221;">Message:</h3>
                                <p style="white-space: pre-wrap;">{message}</p>
                            </div>
                            
                            <div style="background: #EEF2FF; padding: 15px; border-radius: 8px; margin-top: 20px; font-size: 0.9em;">
                                <p style="margin: 5px 0;"><strong>Source:</strong> {request.referrer or 'Direct URL'}</p>
                                <p style="margin: 5px 0;"><strong>IP:</strong> {request.remote_addr}</p>
                            </div>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB; text-align: center;">
                                <a href="mailto:{email}?subject=Re: Your inquiry about Curam-AI Protocol" 
                                   style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #D4AF37, #B8941F); color: #0B1221; text-decoration: none; border-radius: 8px; font-weight: 600;">
                                    Reply to {name}
                                </a>
                            </div>
                        </div>
                    </body>
                    </html>
                    """
                }
            ]
        }
        
        # Set headers
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        # Send notification email
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        response = requests.post(mailchannels_url, json=email_data, headers=headers, timeout=30)
        
        if response.status_code == 202:
            # Mark email as sent successfully
            if capture_id:
                mark_email_sent(capture_id, success=True)
            
            app.logger.info(f"Contact form submission from {email} ({name}) sent successfully")
            
            # Return success
            return jsonify({
                "success": True,
                "message": "Thank you for your inquiry! We'll get back to you within 24 hours."
            })
        else:
            # Mark email as failed
            if capture_id:
                mark_email_sent(capture_id, success=False, error_message=f"MailChannels error: {response.status_code}")
            
            app.logger.error(f"MailChannels API error: {response.status_code} - {response.text}")
            return jsonify({
                "success": False,
                "error": "Failed to send message. Please try again or email us directly at michaelbarrett@bluelily.com.au"
            }), 500
        
    except Exception as e:
        # Mark email as failed with error
        if capture_id:
            mark_email_sent(capture_id, success=False, error_message=str(e))
        
        app.logger.error(f"Error processing contact form: {e}")
        return jsonify({
            "success": False,
            "error": "An error occurred. Please try again or email us directly."
        }), 500



# ============================================================================
# ADD THIS ROUTE TO main.py
# Phase 3 Sample Email Route
# ============================================================================

@app.route('/email-phase3-sample', methods=['POST'])
def email_phase3_sample():
    """Email Phase 3 Compliance Shield sample PDF to user"""
    from flask import jsonify, request
    import requests
    import base64
    import os
    from database import capture_email_request, mark_email_sent
    
    capture_id = None
    
    try:
        data = request.get_json()
        email = data.get('email')
        
        if not email:
            return jsonify({"success": False, "error": "Email is required"}), 400
        
        # Capture email request for tracking
        capture_id = capture_email_request(
            email_address=email,
            report_type='phase3_sample',
            source_page='/phase-3-compliance.html',
            request_data={
                'sample_type': 'compliance_shield',
                'source': 'phase3_page'
            },
            ip_address=request.remote_addr,
            user_agent=request.headers.get('User-Agent'),
            session_id=session.get('_id')
        )
        
        # Read the Phase 3 PDF file
        pdf_path = os.path.join('assets', 'downloads', 'Phase-3-Compliance-Shield.pdf')
        
        if not os.path.exists(pdf_path):
            if capture_id:
                mark_email_sent(capture_id, success=False, error_message="PDF file not found")
            return jsonify({"success": False, "error": "PDF file not found"}), 500
        
        with open(pdf_path, 'rb') as f:
            pdf_bytes = f.read()
        
        # Encode PDF as base64
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        
        # Get MailChannels API key
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Prepare email
        email_data = {
            "personalizations": [
                {
                    "to": [{"email": email}],
                    "cc": [{"email": "michaelbarrett@bluelily.com.au"}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam AI"
            },
            "subject": "Phase 3 Compliance Shield - Sample Report",
            "content": [
                {
                    "type": "text/plain",
                    "value": """Thank you for your interest in the Curam-Ai Protocolâ„¢ Phase 3 Compliance Shield.

Please find attached the sample compliance documentation report showing our ISO 27001 control mappings, risk matrices, and pre-audit documentation package.

This sample demonstrates:
â€¢ ISO 27001 control mapping and evidence
â€¢ Risk assessment matrices
â€¢ Pre-filled compliance questionnaires
â€¢ Architecture and data flow documentation
â€¢ Shadow IT inventory and governance controls

Phase 3 Deliverables ($8-12k, 2 weeks):
â€¢ Complete audit-ready evidence package
â€¢ Risk control matrices aligned to ISO 27001
â€¢ Pre-filled insurance compliance questionnaires
â€¢ Technical architecture documentation
â€¢ 40-50% faster audit completion

Next Steps:
1. Review the sample to understand Phase 3 deliverables
2. Book a consultation to discuss your compliance requirements
3. Start Phase 3 to accelerate your audit process

Best regards,
The Curam AI Team"""
                },
                {
                    "type": "text/html",
                    "value": """
                    <html>
                    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #4B5563;">
                        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                            <h2 style="color: #0B1221;">Phase 3 Compliance Shield - Sample Report</h2>
                            <p>Thank you for your interest in the Curam-Ai Protocolâ„¢ Phase 3 Compliance Shield.</p>
                            <p>Please find attached the sample compliance documentation report showing our ISO 27001 control mappings, risk matrices, and pre-audit documentation package.</p>
                            
                            <div style="background: #F8F9FA; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="color: #0B1221; margin-top: 0;">This sample demonstrates:</h3>
                                <ul style="padding-left: 20px;">
                                    <li>ISO 27001 control mapping and evidence</li>
                                    <li>Risk assessment matrices</li>
                                    <li>Pre-filled compliance questionnaires</li>
                                    <li>Architecture and data flow documentation</li>
                                    <li>Shadow IT inventory and governance controls</li>
                                </ul>
                            </div>
                            
                            <div style="background: #EEF2FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="color: #0B1221; margin-top: 0;">Phase 3 Deliverables</h3>
                                <p style="margin: 0;"><strong>Investment:</strong> $8-12k | <strong>Timeline:</strong> 2 weeks</p>
                                <ul style="padding-left: 20px; margin-top: 10px;">
                                    <li>Complete audit-ready evidence package</li>
                                    <li>Risk control matrices aligned to ISO 27001</li>
                                    <li>Pre-filled insurance compliance questionnaires</li>
                                    <li>Technical architecture documentation</li>
                                    <li><strong>Result:</strong> 40-50% faster audit completion</li>
                                </ul>
                            </div>
                            
                            <h3 style="color: #0B1221;">Next Steps:</h3>
                            <ol>
                                <li>Review the sample to understand Phase 3 deliverables</li>
                                <li>Book a consultation to discuss your compliance requirements</li>
                                <li>Start Phase 3 to accelerate your audit process</li>
                            </ol>
                            
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="https://curam-protocol.curam-ai.com.au/contact.html?option=phase-3-consultation" 
                                   style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #D4AF37, #B8941F); color: #0B1221; text-decoration: none; border-radius: 8px; font-weight: 600;">
                                    Book Consultation
                                </a>
                            </div>
                            
                            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
                                <p style="color: #6B7280; font-size: 0.9em;">
                                    Best regards,<br>
                                    <strong>The Curam AI Team</strong>
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                    """
                }
            ],
            "attachments": [
                {
                    "content": pdf_base64,
                    "filename": "Phase-3-Compliance-Shield-Sample.pdf",
                    "type": "application/pdf",
                    "disposition": "attachment"
                }
            ]
        }
        
        # Set headers
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        # Send email
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        response = requests.post(mailchannels_url, json=email_data, headers=headers, timeout=30)
        
        if response.status_code == 202:
            # Mark email as sent successfully
            if capture_id:
                mark_email_sent(capture_id, success=True)
            
            app.logger.info(f"Phase 3 sample sent successfully to {email}")
            return jsonify({"success": True, "message": "Sample report sent successfully!"})
        else:
            # Mark email as failed
            if capture_id:
                mark_email_sent(capture_id, success=False, error_message=f"MailChannels error: {response.status_code}")
            
            app.logger.error(f"MailChannels API error: {response.status_code} - {response.text}")
            return jsonify({"success": False, "error": "Failed to send email. Please try again later."}), 500
        
    except Exception as e:
        # Mark email as failed with error
        if capture_id:
            mark_email_sent(capture_id, success=False, error_message=str(e))
        
        app.logger.error(f"Error sending Phase 3 sample email: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# =============================================================================
# AUTOMATER & DEMO ROUTES
# =============================================================================

# Feasibility Preview - Sector-aware HTML page with iframe (database-driven)
# Feasibility Preview HTML page with iframe (serves feasibility-preview.html)
@app.route('/feasibility-preview.html')
def feasibility_preview_html():
    """Serve feasibility-preview.html page with iframe to automater"""
    # Try to render as template with default sector data
    sector_slug = request.args.get('sector', 'professional-services')
    
    # Default sector configuration
    sector_config = {
        'name': 'Professional Services',
        'headline': 'Sample Industry P1 Feasibility Demo',
        'subheadline': 'Test our AI-powered document classification and extraction engine live.',
        'demo_title': 'P1 Feasibility Sprint',
        'demo_description': 'Upload PDFs, images, or scanned documents to test extraction',
        'icon': None
    }
    
    try:
        return render_template('feasibility-preview.html', sector=sector_config)
    except:
        # Fallback: try to send as static file
        return send_file('feasibility-preview.html')

@app.route('/feasibility-preview', methods=['GET', 'POST'])
def feasibility_preview_redirect():
    """Redirect /feasibility-preview to /feasibility-preview.html preserving query params"""
    sector = request.args.get('sector', 'professional-services')
    return redirect(f'/feasibility-preview.html?sector={sector}', code=301)

# Legacy demo routes (301 redirects to new name)
@app.route('/demo.html')
def demo_html_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

@app.route('/demo', methods=['GET', 'POST'])
def demo_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

# Automater routes moved to routes/automater_routes.py

@app.route('/export_csv')
def export_csv():
    """Export results as CSV"""
    saved = session.get('last_results')
    if not saved or not saved.get('rows'):
        return "No data to export", 404

    department = saved.get('department', DEFAULT_DEPARTMENT)
    df = pd.DataFrame(saved['rows'])

    if department == 'finance':
        df_export = df.copy()
        for currency_col in ['Cost', 'GST', 'FinalAmount']:
            if currency_col in df_export.columns:
                df_export[currency_col] = df_export[currency_col].apply(
                    lambda x: format_currency(x) if x and x not in ("N/A", "") else "N/A"
                )
            else:
                df_export[currency_col] = "N/A"
        columns = ['Filename', 'Vendor', 'Date', 'InvoiceNum', 'Currency', 'Cost', 'GST', 'FinalAmount', 'Summary', 'ABN', 'POReference', 'PaymentTerms', 'DueDate', 'ShippingTerms', 'PortOfLoading', 'PortOfDischarge', 'VesselVoyage', 'BillOfLading', 'HSCodes', 'LineItems', 'Flags']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
        # Convert arrays to strings for CSV
        if 'HSCodes' in df_export.columns:
            df_export['HSCodes'] = df_export['HSCodes'].apply(lambda x: ', '.join(x) if isinstance(x, list) else (x or ''))
        if 'LineItems' in df_export.columns:
            df_export['LineItems'] = df_export['LineItems'].apply(lambda x: json.dumps(x) if isinstance(x, list) else (x or ''))
        if 'Flags' in df_export.columns:
            df_export['Flags'] = df_export['Flags'].apply(lambda x: '; '.join(x) if isinstance(x, list) else (x or ''))
        df_export.columns = ['Filename', 'Vendor', 'Date', 'Invoice #', 'Currency', 'Cost', 'GST', 'Final Amount', 'Summary', 'ABN', 'PO Reference', 'Payment Terms', 'Due Date', 'Shipping Terms', 'Port of Loading', 'Port of Discharge', 'Vessel/Voyage', 'Bill of Lading', 'HS Codes', 'Line Items', 'Flags']
    elif department == 'transmittal':
        df_export = df.copy()
        columns = ['Filename', 'DwgNo', 'Rev', 'Title', 'Scale']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
    elif department == 'engineering':
        df_export = df.copy()
        schedule_type = saved.get('schedule_type')
        if schedule_type == 'column':
            columns = ['Filename', 'Mark', 'SectionType', 'Size', 'Length', 'Grade', 'BasePlate', 'CapPlate', 'Finish', 'Comments']
        else:
            columns = ['Filename', 'Mark', 'Size', 'Qty', 'Length', 'Grade', 'PaintSystem', 'Comments']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
    else:
        df_export = df.copy()
        columns = ['Filename', 'Mark', 'Size', 'Qty', 'Length', 'Grade', 'PaintSystem', 'Comments']
        df_export = df_export[[col for col in columns if col in df_export.columns]]

    # Sanitize all string columns to fix corrupt UTF-8 characters before CSV export
    from utils.encoding_fix import sanitize_csv_export
    df_export = sanitize_csv_export(df_export)

    output = io.StringIO()
    df_export.to_csv(output, index=False)
    csv_string = output.getvalue()

    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=takeoff_results.csv'}
    )
    return response

@app.route('/export_transmittal_csv')
def export_transmittal_csv():
    """Export a specific transmittal category as CSV"""
    saved = session.get('last_results')
    if not saved:
        return "No data to export", 404
    
    category = request.args.get('category')
    if not category:
        return "Category parameter required", 400
    
    transmittal_data = saved.get('transmittal_aggregated')
    if not transmittal_data or not isinstance(transmittal_data, dict):
        return "No transmittal data available", 404
    
    # Map category names to data keys
    category_map = {
        'DrawingRegister': 'DrawingRegister',
        'Standards': 'Standards',
        'Materials': 'Materials',
        'Connections': 'Connections',
        'Assumptions': 'Assumptions',
        'VOSFlags': 'VOSFlags',
        'CrossReferences': 'CrossReferences'
    }
    
    data_key = category_map.get(category)
    if not data_key or data_key not in transmittal_data:
        return f"Category '{category}' not found", 404
    
    category_data = transmittal_data[data_key]
    if not category_data or len(category_data) == 0:
        return f"No data available for category '{category}'", 404
    
    # Convert to DataFrame
    # Handle DrawingRegister which might be a list of dicts or a single dict
    if data_key == 'DrawingRegister':
        if isinstance(category_data, list):
            df = pd.DataFrame(category_data)
        elif isinstance(category_data, dict):
            df = pd.DataFrame([category_data])
        else:
            return "Invalid data format for DrawingRegister", 500
    else:
        df = pd.DataFrame(category_data)
    
    # Generate filename based on category
    filename_map = {
        'DrawingRegister': 'drawing_register',
        'Standards': 'standards_compliance',
        'Materials': 'material_specifications',
        'Connections': 'connection_details',
        'Assumptions': 'design_assumptions',
        'VOSFlags': 'vos_flags',
        'CrossReferences': 'cross_references'
    }
    
    filename = filename_map.get(category, category.lower())
    
    # Sanitize all string columns to fix corrupt UTF-8 characters before CSV export
    from utils.encoding_fix import sanitize_csv_export
    df = sanitize_csv_export(df)
    
    output = io.StringIO()
    df.to_csv(output, index=False)
    csv_string = output.getvalue()
    
    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename={filename}.csv'}
    )
    return response


@app.route('/sample')
def view_sample():
    requested = request.args.get('path')
    if not requested or requested not in ALLOWED_SAMPLE_PATHS:
        abort(404)

    if not os.path.isfile(requested):
        abort(404)

    return send_file(requested)

# =============================================================================
# ROI CALCULATOR BLUEPRINT REGISTRATION
# =============================================================================

# Import ROI calculator routes BEFORE running the app
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    # Mount ROI calculator at /roi-calculator (with trailing slash support)
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
    print("ROI Calculator blueprint registered successfully at /roi-calculator")
except ImportError as e:
    print(f"Warning: Could not import ROI calculator: {e}")
    import traceback
    traceback.print_exc()
except Exception as e:
    print(f"Error registering ROI calculator: {e}")
    import traceback
    traceback.print_exc()

if __name__ == '__main__':
    # This allows local testing
    app.run(debug=True, port=5000)