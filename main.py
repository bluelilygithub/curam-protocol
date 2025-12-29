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
    get_samples_for_template
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

# =============================================================================
# RAG ANALYTICS HELPER FUNCTION
# =============================================================================

def log_rag_query(query, response, sources, page_source, session_id=None, user_email=None, user_name=None, user_company=None):
    """Log RAG query to database for analytics"""
    try:
        sources_count = len(sources) if sources else 0
        has_blog = any(s.get('type') == 'blog' for s in sources) if sources else False
        has_website = any(s.get('type') == 'website' for s in sources) if sources else False
        
        query_words_list = query.lower().split()
        
        with engine.connect() as conn:
            result = conn.execute(text("""
                INSERT INTO rag_queries (
                    query_text,
                    response_text,
                    sources_cited,
                    page_source,
                    session_id,
                    user_email,
                    user_name,
                    user_company,
                    character_count_query,
                    character_count_response,
                    sources_count,
                    query_words,
                    has_blog_sources,
                    has_website_sources
                ) VALUES (
                    :query_text,
                    :response_text,
                    :sources_cited,
                    :page_source,
                    :session_id,
                    :user_email,
                    :user_name,
                    :user_company,
                    :character_count_query,
                    :character_count_response,
                    :sources_count,
                    :query_words,
                    :has_blog_sources,
                    :has_website_sources
                ) RETURNING id
            """), {
                'query_text': query,
                'response_text': response,
                'sources_cited': json.dumps(sources) if sources else None,
                'page_source': page_source,
                'session_id': session_id,
                'user_email': user_email,
                'user_name': user_name,
                'user_company': user_company,
                'character_count_query': len(query),
                'character_count_response': len(response),
                'sources_count': sources_count,
                'query_words': json.dumps(query_words_list),
                'has_blog_sources': has_blog,
                'has_website_sources': has_website
            })
            conn.commit()
            query_id = result.fetchone()[0]
            print(f"✓ Logged RAG query ID: {query_id}")
            return query_id
    except Exception as e:
        print(f"✗ Error logging RAG query: {e}")
        import traceback
        traceback.print_exc()
        return None


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

# =============================================================================
# API ROUTES
# =============================================================================

@app.route('/api/search-blog', methods=['POST'])
def search_blog_rag():
    """
    RAG Search: Fetches blog content from www.curam-ai.com.au and static HTML pages,
    then uses Gemini to generate answers.
    
    Now uses the extracted perform_rag_search() function for cleaner code.
    """
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Perform RAG search using extracted function
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
                'answer': f"I couldn't find specific information about '{query}' in our blog or website content. This topic might not be directly related to AI document automation, the Curam-Ai Protocol, or our services. Please visit <a href='https://curam-ai.com.au/?s={query}' target='_blank'>curam-ai.com.au</a> to search our full blog, or <a href='contact.html'>contact us</a> if you have questions about our services.",
                'sources': [],
                'query': query
            })
        
        # Use Gemini to generate answer based on retrieved context
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            prompt = f"""You are a helpful assistant for Curam-Ai Protocolâ„¢, an AI document automation service for engineering firms.

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
            answer = response.text if response.text else "I couldn't generate an answer. Please visit curam-ai.com.au for more information."
            
            # Log the query to database
            log_rag_query(
                query=query,
                response=answer,
                sources=rag_results['sources'],
                page_source='header_search',
                session_id=session.get('session_id')
            )
            
            return jsonify({
                'answer': answer,
                'sources': rag_results['sources'],
                'query': query
            })
            
        except Exception as e:
            return jsonify({
                'answer': f"I encountered an error processing your question. Please visit curam-ai.com.au to search for information about '{query}'.",
                'sources': rag_results['sources'],
                'query': query,
                'error': str(e)
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
            system_prompt = f"""You are an AI assistant for Curam-Ai Protocolâ„¢.

User asked: "{message}"

Content from our blog/website:
{rag_context}

Answer using this content. Put source titles in "quotes". Use paragraphs (\n\n).

Services: Phase 1 ($1,500), Phase 2 ($7,500), Phase 3 ($8-12k), Phase 4 ($20-30k)"""
        else:
            system_prompt = """You are an AI assistant for Curam-Ai Protocolâ„¢.

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
            if '- ' in para or 'â€¢ ' in para:
                items = []
                for line in para.split('\n'):
                    if line.strip().startswith(('-', 'â€¢')):
                        items.append(f'<li>{line.lstrip("-â€¢ ").strip()}</li>')
                if items:
                    parts.append(f'<ul>{"".join(items)}</ul>')
            else:
                parts.append(f'<p>{para.replace(chr(10), "<br>")}</p>')
        
        html = ''.join(parts) if parts else f'<p>{text}</p>'
        
        # Log the query to database
        log_rag_query(
            query=message,
            response=html,
            sources=sources,
            page_source='contact_chatbot',
            session_id=session.get('session_id')
        )
        
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
                <p>Best regards,<br>Curam-Ai ProtocolÃ¢â€žÂ¢ Team</p>
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
        email_text += "Best regards,\nCuram-Ai ProtocolÃ¢â€žÂ¢ Team"
        
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
                "name": "Curam-Ai ProtocolÃ¢â€žÂ¢"
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
                
                # Update database - mark transcripts as requested
                try:
                    with engine.connect() as conn:
                        conn.execute(text("""
                            UPDATE rag_queries
                            SET transcript_requested = TRUE,
                                transcript_sent_at = NOW(),
                                user_email = :email,
                                user_name = :name,
                                user_company = :company
                            WHERE session_id = :session_id
                                AND user_email IS NULL
                        """), {
                            'email': email,
                            'name': user_name,
                            'company': company,
                            'session_id': session.get('session_id')
                        })
                        conn.commit()
                        print(f"✓ Updated transcript status for session {session.get('session_id')}")
                except Exception as e:
                    print(f"✗ Error updating transcript status: {e}")
                
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


# =============================================================================
# AUTOMATER & DEMO ROUTES
# =============================================================================

# Feasibility Preview HTML page with iframe (serves feasibility-preview.html)
@app.route('/feasibility-preview.html')
def feasibility_preview_html():
    """Serve feasibility-preview.html page with iframe to automater"""
    return send_file('feasibility-preview.html')

@app.route('/feasibility-preview', methods=['GET', 'POST'])
def feasibility_preview_redirect():
    """Redirect /feasibility-preview to /feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

# Legacy demo routes (301 redirects to new name)
@app.route('/demo.html')
def demo_html_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

@app.route('/demo', methods=['GET', 'POST'])
def demo_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

# Automater route (document extraction tool) - moved from root
@app.route('/automater', methods=['GET', 'POST'])
@app.route('/extract', methods=['GET', 'POST'])
def automater():
    # Call the original index function logic
    return index_automater()

# Original index function (document extraction) - renamed
def index_automater():
    department = request.form.get('department') or request.args.get('department')
    results = []
    error_message = None
    last_model_used = None
    model_attempts = []
    model_actions = []
    detected_schedule_type = None
    selected_samples = []

    # Default to DEFAULT_DEPARTMENT if still not set
    if not department:
        department = DEFAULT_DEPARTMENT

    # Load results from session on GET requests (only if department matches)
    if request.method == 'GET':
        saved = session.get('last_results')
        if saved:
            saved_department = saved.get('department')
            # Only load from session if department matches (respect user's selection)
            if saved_department == department:
                session_results = saved.get('rows', [])
                if session_results:
                    results = session_results
                    # Get schedule type for engineering
                    if saved_department == "engineering":
                        detected_schedule_type = saved.get('schedule_type')
                    model_actions.append(f"Loaded {len(results)} row(s) from previous session")

    if request.method == 'POST':
        # Log the department received
        model_actions.append(f"POST request received. Department from form: '{department}'")
        
        finance_defaults = []
        finance_uploaded_paths = []
        transmittal_defaults = []

        # For engineering and finance (now checkboxes), get list of values; for others handle custom logic
        if department == 'engineering' or department == 'finance':
            selected_samples = request.form.getlist('samples')
            model_actions.append(f"{department.capitalize()} mode: selected_samples from form = {selected_samples}")
        elif department == 'transmittal':
            transmittal_defaults = request.form.getlist('transmittal_defaults')
            selected_samples = transmittal_defaults.copy()
            model_actions.append(f"Transmittal mode: auto-selecting {len(transmittal_defaults)} sample drawing(s)")
        else:
            selected_samples = request.form.getlist('samples')
            model_actions.append(f"Non-engineering mode: selected_samples from form = {selected_samples}")
        allowed_folder = DEPARTMENT_SAMPLES.get(department, {}).get("folder", "")
        
        # Handle finance uploads
        if department == 'finance':
            uploaded_files = request.files.getlist('finance_uploads')
            if uploaded_files:
                model_actions.append(f"Finance mode: {len(uploaded_files)} uploaded file(s) received")
            for file_storage in uploaded_files:
                if not file_storage or not file_storage.filename:
                    continue
                filename = secure_filename(file_storage.filename)
                if not filename.lower().endswith('.pdf'):
                    error_message = "Only PDF files can be uploaded for Finance."
                    model_actions.append(f"Ã¢Å“â€” ERROR: {filename} rejected (not a PDF)")
                    break
                unique_name = f"{int(time.time() * 1000)}_{filename}"
                file_path = os.path.join(FINANCE_UPLOAD_DIR, unique_name)
                file_storage.save(file_path)
                finance_uploaded_paths.append(file_path)
                model_actions.append(f"Ã¢Å“â€œ Uploaded invoice saved: {file_path}")
            selected_samples.extend(finance_uploaded_paths)

        # Filter samples to only those matching the current department (skip for auto-select departments)
        if department == 'transmittal':
            samples = [sample for sample in selected_samples if sample]
        else:
            samples = [
                sample for sample in selected_samples
                if sample and SAMPLE_TO_DEPT.get(sample) == department
            ]
        # Log what was selected for debugging
        if selected_samples:
            model_actions.append(f"Selected samples: {selected_samples}")
            for sample in selected_samples:
                if sample:
                    dept_match = SAMPLE_TO_DEPT.get(sample, "NOT FOUND")
                    model_actions.append(f"  - {sample}: mapped to department '{dept_match}'")
            model_actions.append(f"Filtered to department '{department}': {samples}")
        else:
            model_actions.append("No samples selected in form")

        # Check if there's anything to process
        if not samples:
            if selected_samples:
                error_message = f"No samples matched department '{department}'. Selected: {selected_samples}"
                model_actions.append(f"Ã¢Å“â€” ERROR: {error_message}")
            else:
                error_message = "Please select at least one sample file."
                model_actions.append(f"Ã¢Å“â€” ERROR: {error_message}")

        if not error_message:
            if samples:
                model_actions.append(f"Processing {len(samples)} sample file(s)")
                for sample_path in samples:
                    if not os.path.exists(sample_path):
                        error_msg = f"File not found: {sample_path}"
                        model_actions.append(f"Ã¢Å“â€” {error_msg}")
                        if not error_message:
                            error_message = error_msg
                        continue
                
                    filename = os.path.basename(sample_path)
                    model_actions.append(f"Processing file: {filename} (path: {sample_path})")
                    
                    # Check if it's an image file
                    file_ext = os.path.splitext(sample_path)[1].lower()
                    is_image = file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']
                    
                    image_path = None
                    if is_image:
                        model_actions.append(f"Detected image file: {filename} - will use Gemini vision API")
                        image_path = sample_path
                        text = f"[IMAGE_FILE:{sample_path}]"
                    else:
                        model_actions.append(f"Extracting text from {filename}")
                        text = extract_text(sample_path)
                        if text.startswith("Error:"):
                            model_actions.append(f"Ã¢Å“â€” Text extraction failed for {filename}: {text}")
                            if not error_message:
                                error_message = f"Text extraction failed for {filename}"
                            continue
                        else:
                            model_actions.append(f"Ã¢Å“â€œ Text extracted successfully ({len(text)} characters)")
                    
                    model_actions.append(f"Analyzing {filename} with AI models")
                    entries, api_error, model_used, attempt_log, file_action_log, schedule_type = analyze_gemini(text, department, image_path)
                    if file_action_log:
                        model_actions.extend(file_action_log)
                    if model_used:
                        last_model_used = model_used
                        model_actions.append(f"Ã¢Å“â€œ Successfully processed {filename} with {model_used}")
                    if attempt_log:
                        model_attempts.extend(attempt_log)
                    if api_error:
                        model_actions.append(f"Ã¢Å“â€” Failed to process {filename}: {api_error}")
                        if not error_message:
                            error_message = api_error
                    if entries:
                        if department == "transmittal":
                            # Transmittal returns a single object with multiple arrays
                            if isinstance(entries, list) and len(entries) > 0 and isinstance(entries[0], dict):
                                transmittal_data = entries[0]
                                # Add filename to DrawingRegister (handle both dict and list)
                                if 'DrawingRegister' in transmittal_data:
                                    dr = transmittal_data['DrawingRegister']
                                    if isinstance(dr, dict):
                                        dr['Filename'] = filename
                                    elif isinstance(dr, list) and len(dr) > 0:
                                        for item in dr:
                                            if isinstance(item, dict):
                                                item['Filename'] = filename
                                # Add SourceDocument to all sub-arrays
                                for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                                    if key in transmittal_data and isinstance(transmittal_data[key], list):
                                        for item in transmittal_data[key]:
                                            if isinstance(item, dict):
                                                item['SourceDocument'] = filename
                                results.append(transmittal_data)
                                model_actions.append(f"Ã¢Å“â€œ Extracted structured data from {filename}")
                            else:
                                # Fallback to old format
                                for entry in entries if isinstance(entries, list) else [entries]:
                                    entry['Filename'] = filename
                                    results.append(entry)
                                model_actions.append(f"Ã¢Å“â€œ Extracted {len(entries)} row(s) from {filename}")
                        else:
                            model_actions.append(f"Ã¢Å“â€œ Extracted {len(entries)} row(s) from {filename}")
                            for entry in entries:
                                entry['Filename'] = filename
                                if department == "finance":
                                    cost_value = entry.get('Cost')
                                    gst_value = entry.get('GST')
                                    final_value = entry.get('FinalAmount') or entry.get('Total')
                                    if final_value and not entry.get('FinalAmount'):
                                        entry['FinalAmount'] = final_value
                                    entry['CostFormatted'] = format_currency(cost_value) if cost_value not in ("", None, "N/A") else (cost_value or "N/A")
                                    entry['GST'] = gst_value if gst_value not in ("", None) else "N/A"
                                    entry['GSTFormatted'] = format_currency(gst_value) if gst_value not in ("", None, "N/A") else "N/A"
                                    entry['FinalAmountFormatted'] = format_currency(final_value) if final_value not in ("", None, "N/A") else (final_value or "N/A")
                                else:
                                    entry['TotalFormatted'] = format_currency(entry.get('Total', ''))
                                    # Add confidence indicators, validation, and CORRECTION for engineering fields
                                    # CRITICAL: Error flagging system must always be active for safety
                                    if department == "engineering":
                                        entry['critical_errors'] = []
                                        entry['corrections_applied'] = []
                                        
                                        # Get context from other entries for correction
                                        context_entries = [e for e in results if e != entry]
                                        
                                        # Check confidence and validate key fields
                                        # CRITICAL: Comments field must be preserved EXACTLY - no corrections, no processing
                                        for field in ['Comments', 'PaintSystem', 'Size', 'Grade', 'Mark', 'Length', 'Qty']:
                                            if field in entry and entry[field]:
                                                # For Comments field: NO processing, NO validation, NO correction - preserve exactly
                                                if field == 'Comments':
                                                    # Only check if it's garbled for display purposes, but don't modify it
                                                    confidence = detect_low_confidence(entry[field])
                                                    entry[f'{field}_confidence'] = confidence
                                                    # DO NOT validate or correct Comments - preserve exactly as extracted
                                                else:
                                                    # For other fields: check confidence and validate
                                                    confidence = detect_low_confidence(entry[field])
                                                    entry[f'{field}_confidence'] = confidence
                                                    
                                                    # ATTEMPT CORRECTION ONLY for Size field (most critical)
                                                    if field == 'Size':
                                                        corrected_value, correction_confidence = correct_ocr_errors(
                                                            entry[field], field, context_entries
                                                        )
                                                        if corrected_value != entry[field]:
                                                            entry['corrections_applied'].append(
                                                                f"Size corrected: '{entry[field]}' Ã¢â€ â€™ '{corrected_value}'"
                                                            )
                                                            entry[field] = corrected_value
                                                            if correction_confidence == 'medium':
                                                                entry[f'{field}_confidence'] = 'medium'
                                                    
                                                    # Validate for critical errors (but not Comments)
                                                    validation = validate_engineering_field(field, entry[field], entry)
                                                    if validation['errors']:
                                                        entry['critical_errors'].extend(validation['errors'])
                                                        if validation['confidence'] == 'low':
                                                            entry[f'{field}_confidence'] = 'low'
                                                        elif validation['confidence'] == 'medium' and confidence == 'high':
                                                            entry[f'{field}_confidence'] = 'medium'
                                                
                                                # Then validate for critical errors (after correction)
                                                validation = validate_engineering_field(field, entry[field], entry)
                                                if validation['errors']:
                                                    entry['critical_errors'].extend(validation['errors'])
                                                    # Update confidence if validation found issues
                                                    if validation['confidence'] == 'low':
                                                        entry[f'{field}_confidence'] = 'low'
                                                    elif validation['confidence'] == 'medium' and entry.get(f'{field}_confidence') == 'high':
                                                        entry[f'{field}_confidence'] = 'medium'
                                        
                                        # Mark entry as having critical errors if any found
                                        # This flagging system is essential for safety - never remove it
                                        if entry['critical_errors']:
                                            entry['has_critical_errors'] = True
                                        
                                        # ENGINEERING SAFETY: Reject entries with critical extraction errors
                                        # If Size or Quantity are wrong, this could cause structural failure
                                        critical_fields_with_errors = []
                                        for error in entry.get('critical_errors', []):
                                            if 'Size' in error or 'size' in error.lower():
                                                critical_fields_with_errors.append('Size')
                                            if 'Quantity' in error or 'quantity' in error.lower() or 'Qty' in error:
                                                critical_fields_with_errors.append('Quantity')
                                        
                                        if critical_fields_with_errors:
                                            entry['requires_manual_verification'] = True
                                            entry['rejection_reason'] = f"CRITICAL: {', '.join(critical_fields_with_errors)} extraction appears incorrect - MANUAL VERIFICATION REQUIRED before use"
                                results.append(entry)
                            
                            # Post-processing: Cross-entry validation for engineering
                            if department == "engineering" and len(results) > 1:
                                # Check for quantity anomalies by comparing similar entries
                                for i, entry in enumerate(results):
                                    if entry.get('Qty') == 1:
                                        # Check if similar entries (same mark prefix, similar size) have higher quantities
                                        mark = entry.get('Mark', '')
                                        size = entry.get('Size', '')
                                        if mark:
                                            # Look for similar entries (same prefix like "NB-")
                                            similar_entries = [
                                                r for r in results 
                                                if r != entry and r.get('Mark', '').startswith(mark.split('-')[0] + '-')
                                            ]
                                            if similar_entries:
                                                # Check if any similar entries have quantity > 1
                                                higher_qty_entries = [e for e in similar_entries if int(e.get('Qty', 0)) > 1]
                                                if higher_qty_entries:
                                                    # Flag quantity issues - especially if entry has other problems
                                                    if entry.get('has_critical_errors'):
                                                        entry['critical_errors'].append(f"Quantity is 1, but similar entries (e.g., {higher_qty_entries[0].get('Mark')}) have quantity {higher_qty_entries[0].get('Qty')} - please verify column alignment")
                                                    else:
                                                        # Even if no other errors, flag for review if pattern is clear
                                                        if len(higher_qty_entries) >= 2:  # Multiple similar entries with higher qty
                                                            entry['critical_errors'].append(f"Quantity is 1, but {len(higher_qty_entries)} similar entries have quantity > 1 - please verify")
                                                            entry['has_critical_errors'] = True
                            # Store schedule type for engineering documents (use first detected type)
                            if department == "engineering" and schedule_type and not detected_schedule_type:
                                detected_schedule_type = schedule_type
                    else:
                        model_actions.append(f"Ã¢Å¡Â  No data extracted from {filename}")

        # Aggregate transmittal data into structured categories
        transmittal_aggregated = None
        if department == "transmittal" and results:
            transmittal_aggregated = {
                "DrawingRegister": [],
                "Standards": [],
                "Materials": [],
                "Connections": [],
                "Assumptions": [],
                "VOSFlags": [],
                "CrossReferences": []
            }
            for result in results:
                if isinstance(result, dict):
                    # Extract drawing register - handle both dict and list
                    if 'DrawingRegister' in result:
                        dr = result['DrawingRegister']
                        if isinstance(dr, dict):
                            transmittal_aggregated["DrawingRegister"].append(dr)
                        elif isinstance(dr, list):
                            transmittal_aggregated["DrawingRegister"].extend(dr)
                    # Aggregate arrays
                    for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                        if key in result and isinstance(result[key], list):
                            transmittal_aggregated[key].extend(result[key])

        if results:
            session_data = {"department": department, "rows": results}
            if department == "engineering" and 'detected_schedule_type' in locals():
                session_data["schedule_type"] = detected_schedule_type
            if transmittal_aggregated:
                session_data["transmittal_aggregated"] = transmittal_aggregated
            session['last_results'] = session_data
        else:
            session.pop('last_results', None)

    # Get schedule type from session or detected value
    schedule_type = None
    if department == "engineering":
        saved = session.get('last_results', {})
        schedule_type = saved.get('schedule_type')
        if not schedule_type and 'detected_schedule_type' in locals() and detected_schedule_type:
            schedule_type = detected_schedule_type
    
    # Get aggregated transmittal data
    transmittal_data = None
    if department == "transmittal":
        saved = session.get('last_results', {})
        transmittal_data = saved.get('transmittal_aggregated')
        if not transmittal_data and 'transmittal_aggregated' in locals():
            transmittal_data = transmittal_aggregated
        # If still no transmittal_data, try to aggregate from results
        if not transmittal_data and results:
            transmittal_data = {
                "DrawingRegister": [],
                "Standards": [],
                "Materials": [],
                "Connections": [],
                "Assumptions": [],
                "VOSFlags": [],
                "CrossReferences": []
            }
            for result in results:
                if isinstance(result, dict):
                    # Extract drawing register - handle both dict and list
                    if 'DrawingRegister' in result:
                        dr = result['DrawingRegister']
                        if isinstance(dr, dict):
                            transmittal_data["DrawingRegister"].append(dr)
                        elif isinstance(dr, list):
                            transmittal_data["DrawingRegister"].extend(dr)
                    # Aggregate arrays
                    for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                        if key in result and isinstance(result[key], list):
                            transmittal_data[key].extend(result[key])
        # Ensure all keys are lists, not None
        if transmittal_data and isinstance(transmittal_data, dict):
            for key in ['DrawingRegister', 'Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                if key not in transmittal_data or transmittal_data[key] is None:
                    transmittal_data[key] = []
    
    # Group engineering and finance results by filename for separate tables
    grouped_engineering_results = {}
    grouped_finance_results = {}
    if department == 'engineering' and results:
        for row in results:
            filename = row.get('Filename', 'Unknown')
            if filename not in grouped_engineering_results:
                grouped_engineering_results[filename] = []
            grouped_engineering_results[filename].append(row)
    elif department == 'finance' and results:
        for row in results:
            filename = row.get('Filename', 'Unknown')
            if filename not in grouped_finance_results:
                grouped_finance_results[filename] = []
            grouped_finance_results[filename].append(row)
    
    # Build sample_files from database (INSIDE function, before return)
    db_samples = {}
    for dept in ['finance', 'engineering', 'transmittal']:
        try:
            samples = get_samples_for_template(dept)
            if samples:
                print(f"âœ“ Database returned {len(samples)} samples for {dept}")
                dept_info = DEPARTMENT_SAMPLES.get(dept, {})
                db_samples[dept] = {
                    "label": dept_info.get("label", "Samples"),
                    "description": dept_info.get("description", ""),
                    "folder": dept_info.get("folder", ""),
                    "samples": samples
                }
            else:
                print(f"âš  Database returned 0 samples for {dept} - using hardcoded")
        except Exception as e:
            print(f"âœ— Database error for {dept}: {e}")
            # Continue with hardcoded samples on error
    
    # Merge database samples with hardcoded (database takes priority)
    sample_files_merged = {**DEPARTMENT_SAMPLES, **db_samples}
    print(f"Final sample count - Finance: {len(sample_files_merged.get('finance', {}).get('samples', []))}")
    
    # Debug: Show first sample path for finance
    finance_samples = sample_files_merged.get('finance', {}).get('samples', [])
    if finance_samples:
        print(f"First finance sample path: {finance_samples[0].get('path', 'NO PATH')}")
    else:
        print("âš  No finance samples in merged data!")
    
    return render_template_string(
        HTML_TEMPLATE,
        results=results if results else [],
        grouped_engineering_results=grouped_engineering_results if department == 'engineering' else {},
        grouped_finance_results=grouped_finance_results if department == 'finance' else {},
        department=department,
        selected_samples=selected_samples,
        sample_files=sample_files_merged,
        error=error_message,
        routine_descriptions=ROUTINE_DESCRIPTIONS,
        routine_summary=ROUTINE_SUMMARY.get(department, []),
        model_in_use=last_model_used,
        model_attempts=model_attempts,
        model_actions=model_actions,
        schedule_type=schedule_type,
        transmittal_data=transmittal_data
    )

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
    print("Ã¢Å“â€œ ROI Calculator blueprint registered successfully at /roi-calculator")
except ImportError as e:
    print(f"Ã¢Å“â€” Warning: Could not import ROI calculator: {e}")
    import traceback
    traceback.print_exc()
except Exception as e:
    print(f"Ã¢Å“â€” Error registering ROI calculator: {e}")
    import traceback
    traceback.print_exc()

if __name__ == '__main__':
    # This allows local testing
    app.run(debug=True, port=5000)