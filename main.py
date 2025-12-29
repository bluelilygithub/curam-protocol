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

# Phase 3.2: PDF Service (extracted from main.py lines 150-158, 3494-3522)
from services.pdf_service import (
    extract_text,
    prepare_prompt_text
)

# Phase 3.3c: Gemini Service - COMPLETE (all 3 functions extracted)
from services.gemini_service import get_available_models, build_prompt, analyze_gemini

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

# Configure Gemini API
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Create upload directories
os.makedirs(FINANCE_UPLOAD_DIR, exist_ok=True)

# Cache for available models
_available_models = None

@app.route('/invoices/<path:filename>')
def invoices(filename):
    return send_from_directory('invoices', filename)

# Serve drawing PDFs
@app.route('/drawings/<path:filename>')
def drawings(filename):
    return send_from_directory('drawings', filename)

# Serve static website files
@app.route('/homepage')
@app.route('/homepage.html')
def homepage():
    try:
        return send_file('homepage.html')
    except:
        return "Homepage not found.", 404

@app.route('/contact')
@app.route('/contact.html')
def contact_page():
    try:
        return send_file('contact.html')
    except:
        return "Contact page not found.", 404

@app.route('/about')
@app.route('/about.html')
def about_page():
    try:
        return send_file('about.html')
    except:
        return "About page not found.", 404

@app.route('/search')
@app.route('/search.html')
def search_page():
    """Serve the RAG Search Demo page"""
    try:
        return send_file('search.html')
    except:
        return "Search page not found.", 404

@app.route('/services')
@app.route('/services.html')
def services_page():
    try:
        return send_file('services.html')
    except:
        return "Services page not found.", 404

@app.route('/faq')
@app.route('/faq.html')
def faq_page():
    try:
        return send_file('faq.html')
    except:
        return "FAQ page not found.", 404

@app.route('/target-markets')
@app.route('/target-markets.html')
def target_markets():
    try:
        return send_file('target-markets.html')
    except:
        return "Target Markets page not found.", 404

@app.route('/accounting')
@app.route('/accounting.html')
@app.route('/industries/accounting.html')
def accounting_page():
    try:
        return render_template('industries/accounting.html')
    except:
        return "Accounting page not found.", 404

@app.route('/professional-services')
@app.route('/professional-services.html')
def professional_services_page():
    try:
        return send_file('professional-services.html')
    except:
        return "Professional Services page not found.", 404

@app.route('/logistics-compliance')
@app.route('/logistics-compliance.html')
def logistics_compliance_page():
    try:
        return send_file('logistics-compliance.html')
    except:
        return "Logistics Compliance page not found.", 404

@app.route('/built-environment')
@app.route('/built-environment.html')
def built_environment_page():
    try:
        return send_file('built-environment.html')
    except:
        return "Built Environment page not found.", 404

@app.route('/legal-services')
@app.route('/legal-services.html')
@app.route('/industries/legal-services.html')
def legal_services_page():
    try:
        return render_template('industries/legal-services.html')
    except:
        return "Legal Services page not found.", 404

@app.route('/wealth-management')
@app.route('/wealth-management.html')
@app.route('/industries/wealth-management.html')
def wealth_management_page():
    try:
        return render_template('industries/wealth-management.html')
    except:
        return "Wealth Management page not found.", 404

@app.route('/insurance-underwriting')
@app.route('/insurance-underwriting.html')
@app.route('/industries/insurance-underwriting.html')
def insurance_underwriting_page():
    try:
        return render_template('industries/insurance-underwriting.html')
    except:
        return "Insurance Underwriting page not found.", 404

@app.route('/logistics-freight')
@app.route('/logistics-freight.html')
@app.route('/logistics')
@app.route('/logistics.html')
@app.route('/industries/logistics-freight.html')
def logistics_freight_page():
    try:
        return render_template('industries/logistics-freight.html')
    except:
        return "Logistics & Freight page not found.", 404

@app.route('/healthcare-admin')
@app.route('/healthcare-admin.html')
@app.route('/healthcare')
@app.route('/healthcare.html')
@app.route('/industries/healthcare-admin.html')
def healthcare_admin_page():
    try:
        return render_template('industries/healthcare-admin.html')
    except:
        return "Healthcare Admin page not found.", 404

@app.route('/government-contractors')
@app.route('/government-contractors.html')
@app.route('/government')
@app.route('/government.html')
@app.route('/industries/government-contractors.html')
def government_contractors_page():
    try:
        return render_template('industries/government-contractors.html')
    except:
        return "Government Contractors page not found.", 404

@app.route('/construction')
@app.route('/construction.html')
@app.route('/industries/construction.html')
def construction_page():
    try:
        return render_template('industries/construction.html')
    except:
        return "Construction page not found.", 404

@app.route('/architecture')
@app.route('/architecture.html')
@app.route('/industries/architecture.html')
def architecture_page():
    try:
        return render_template('industries/architecture.html')
    except:
        return "Architecture page not found.", 404

@app.route('/engineering')
@app.route('/engineering.html')
@app.route('/industries/engineering.html')
def engineering_page():
    try:
        return render_template('industries/engineering.html')
    except:
        return "Engineering page not found.", 404

@app.route('/mining-services')
@app.route('/mining-services.html')
@app.route('/mining')
@app.route('/mining.html')
@app.route('/industries/mining-services.html')
def mining_services_page():
    try:
        return render_template('industries/mining-services.html')
    except:
        return "Mining Services page not found.", 404

@app.route('/property-management')
@app.route('/property-management.html')
@app.route('/property')
@app.route('/property.html')
@app.route('/industries/property-management.html')
def property_management_page():
    try:
        return render_template('industries/property-management.html')
    except:
        return "Property Management page not found.", 404

@app.route('/case-study')
@app.route('/case-study.html')
def case_study_page():
    try:
        return send_file('case-study.html')
    except:
        return "Case study page not found.", 404

@app.route('/search-results')
@app.route('/search-results.html')
def search_results_page():
    try:
        return send_file('search-results.html')
    except:
        return "Search results page not found.", 404

def extract_text_from_html(file_path):
    """
    Extract text content from an HTML file.
    Returns dict with title, content, and filename.
    """
    import re
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        # Extract title from <title> tag or first <h1>
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else ''
        # Clean title HTML entities
        title = re.sub('<[^<]+?>', '', title)
        title = re.sub(r'\s+', ' ', title).strip()
        
        # Extract content from <main>, <article>, or <body>
        # Try main first, then article, then body
        content_match = None
        for tag in ['<main', '<article', '<body']:
            pattern = rf'{tag}[^>]*>(.*?)</(?:main|article|body)>'
            match = re.search(pattern, html_content, re.IGNORECASE | re.DOTALL)
            if match:
                content_match = match
                break
        
        if not content_match:
            # Fallback: extract from body if no main/article
            body_match = re.search(r'<body[^>]*>(.*?)</body>', html_content, re.IGNORECASE | re.DOTALL)
            if body_match:
                content_html = body_match.group(1)
            else:
                content_html = html_content
        else:
            content_html = content_match.group(1)
        
        # Remove script and style tags completely
        content_html = re.sub(r'<script[^>]*>.*?</script>', '', content_html, flags=re.IGNORECASE | re.DOTALL)
        content_html = re.sub(r'<style[^>]*>.*?</style>', '', content_html, flags=re.IGNORECASE | re.DOTALL)
        
        # Remove HTML tags
        content_clean = re.sub('<[^<]+?>', '', content_html)
        
        # Remove extra whitespace and newlines
        content_clean = re.sub(r'\s+', ' ', content_clean).strip()
        
        # Get filename for link
        filename = os.path.basename(file_path)
        
        return {
            'title': title or filename.replace('.html', '').replace('-', ' ').title(),
            'content': content_clean,
            'link': f'/{filename}',
            'filename': filename
        }
    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
        return None

def calculate_authority_score(source_type, title, content, date_str, query, query_words):
    """
    Calculate an authority score for a source (0-100).
    Higher score = more authoritative/relevant.
    Prioritizes content depth and quality over title optimization.
    """
    from datetime import datetime
    import re
    
    score = 0
    
    # Base score by source type
    if source_type == 'website':
        score += 50  # Protocol pages are more authoritative
    else:  # blog
        score += 30  # Blog posts are less authoritative but still valuable
    
    # Prepare text for analysis
    title_lower = title.lower()
    content_lower = content.lower()
    query_lower = query.lower()
    
    # 1. CONTENT DEPTH SCORING (NEW - prioritizes substance)
    # Count how many times query keywords appear in content
    content_keyword_count = 0
    for word in query_words:
        content_keyword_count += content_lower.count(word)
    
    # Award points for content depth (capped at +15)
    content_depth_score = min(content_keyword_count * 2, 15)
    score += content_depth_score
    
    # 2. TITLE RELEVANCE (REDUCED weight to avoid clickbait favoritism)
    title_keyword_count = 0
    for word in query_words:
        if word in title_lower:
            score += 3  # Reduced from 5
            title_keyword_count += 1
    
    if query_lower in title_lower:
        score += 6  # Reduced from 10 (exact phrase match)
    
    # 3. CONTENT-TO-TITLE RATIO (NEW - rewards substance over headline optimization)
    if content_keyword_count > title_keyword_count and content_keyword_count >= 3:
        score += 5  # Bonus for articles that discuss topic in depth, not just headline
    
    # 4. ENHANCED CONTENT QUALITY (Better gradations for comprehensive articles)
    content_length = len(content)
    if content_length > 1000:
        score += 3   # Basic article
    if content_length > 2000:
        score += 5   # Substantial content
    if content_length > 5000:
        score += 8   # Very detailed content
    if content_length > 10000:
        score += 12  # Comprehensive, in-depth article
    
    # 5. RECENCY BONUS (for blog posts only)
    if date_str and source_type == 'blog':
        try:
            post_date = datetime.strptime(date_str.split('T')[0], '%Y-%m-%d')
            days_old = (datetime.now() - post_date).days
            if days_old < 30:
                score += 10  # Very recent
            elif days_old < 90:
                score += 7   # Recent
            elif days_old < 180:
                score += 5   # Fairly recent
            elif days_old < 365:
                score += 3   # Within last year
        except:
            pass
    
    # Cap at 100
    return min(score, 100)


def search_static_html_pages(query):
    """
    Search static HTML pages in the current directory.
    Returns list of relevant pages with extracted content.
    """
    import re
    
    # Pages to exclude from search (navigation, includes, generic pages, etc.)
    excluded_pages = {
        'navbar.html', 'embed_snippet.html', 'index.html',  # index.html typically redirects
        'sitemap.html',  # Sitemap is not content
        'search-results.html',  # Search results page itself
        'search.html',  # Search demo page
        'about.html',  # Generic about page (rarely relevant to specific queries)
        'contact.html',  # Contact form
        'homepage.html',  # Homepage (too generic)
        'services.html'  # Services overview (too generic)
    }
    
    # Get all HTML files in the root directory
    html_files = []
    root_dir = os.path.dirname(os.path.abspath(__file__))
    
    for filename in os.listdir(root_dir):
        if filename.endswith('.html') and filename not in excluded_pages:
            html_files.append(os.path.join(root_dir, filename))
    
    # Extract content from all HTML files
    pages = []
    for file_path in html_files:
        page_data = extract_text_from_html(file_path)
        if page_data and page_data['content']:
            pages.append(page_data)
    
    if not pages:
        return []
    
    # Rank pages by relevance
    query_lower = query.lower()
    stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
    query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
    
    if not query_words:
        query_words = set(query_lower.split())
    
    def calculate_page_relevance(page):
        score = 0
        title = page.get('title', '').lower()
        content = page.get('content', '').lower()
        filename = page.get('filename', '').lower()
        
        # Title matches are most important
        for word in query_words:
            if word in title:
                score += 10
            if word in filename:
                score += 8
            if word in content:
                score += 1
        
        # Exact phrase match bonus
        if query_lower in title:
            score += 20
        if query_lower in content:
            score += 5
        
        return score
    
    # Sort by relevance
    ranked_pages = sorted(pages, key=calculate_page_relevance, reverse=True)
    
    # Filter out pages with low relevance (require minimum score of 10)
    # This ensures we only return pages that have meaningful matches
    MINIMUM_SCORE = 10  # Require at least one title/filename match, or phrase match in content
    relevant_pages = [p for p in ranked_pages if calculate_page_relevance(p) >= MINIMUM_SCORE][:5]
    
    # Log results for debugging
    if relevant_pages:
        print(f"Static HTML search for '{query}' found {len(relevant_pages)} pages:")
        for p in relevant_pages[:3]:
            score = calculate_page_relevance(p)
            print(f"  - {p.get('filename', 'unknown')} (score: {score})")
    
    return relevant_pages

def perform_rag_search(query, max_results=5):
    """
    Perform RAG (Retrieval-Augmented Generation) search across blog and website content.
    
    This function fetches relevant content from WordPress blog (800+ articles) and 
    static HTML pages, ranks them by relevance, and returns structured results.
    
    Args:
        query (str): The search query from the user
        max_results (int): Maximum number of sources to return (default: 5)
    
    Returns:
        dict: {
            'sources': list of source objects with title, link, excerpt, type, authority
            'context': str, combined text content from all sources for AI context
            'query': str, the original query
            'query_words': set, filtered query keywords
            'error': str (optional), error message if something failed
        }
        
    Raises:
        Returns error dict if WordPress API is unreachable
    """
    import re
    import requests
    
    # Step 1: Fetch blog content from WordPress REST API
    blog_urls = [
        'https://curam-ai.com.au',      # Primary (no www)
        'https://www.curam-ai.com.au'   # Fallback (with www)
    ]
    
    blog_url = None
    wp_api_url = None
    
    # Test which blog URL is accessible
    for test_url in blog_urls:
        try:
            test_response = requests.get(f'{test_url}/wp-json/wp/v2/posts', 
                                        params={'per_page': 1}, 
                                        timeout=5)
            if test_response.status_code == 200:
                blog_url = test_url
                wp_api_url = f'{blog_url}/wp-json/wp/v2/posts'
                print(f"✓ Blog URL accessible: {blog_url}")
                break
        except requests.RequestException as e:
            print(f"✗ Blog URL failed: {test_url} - {str(e)[:100]}")
            continue
    
    # If neither URL works, return error
    if not blog_url:
        return {
            'error': 'Unable to reach blog API',
            'sources': [],
            'context': '',
            'query': query
        }
    
    posts = []
    try:
        # Try multiple search strategies to get most relevant posts
        all_posts = []
        
        # Strategy 1: Search in WordPress API (searches title, content, excerpt)
        try:
            response = requests.get(wp_api_url, params={
                'per_page': 50, 
                'search': query,
                '_fields': 'id,title,content,excerpt,link,date'
            }, timeout=10)
            if response.status_code == 200:
                search_results = response.json()
                if search_results:
                    all_posts.extend(search_results)
        except Exception as e:
            print(f"WordPress search API error: {e}")
            pass
        
        # Strategy 2: Fetch recent posts as backup (WordPress search can be unreliable)
        try:
            pages_to_fetch = 3  # Fetch 3 pages = 300 posts
            for page in range(1, pages_to_fetch + 1):
                response = requests.get(wp_api_url, params={
                    'per_page': 100,  # Maximum allowed by WordPress
                    '_fields': 'id,title,content,excerpt,link,date',
                    'orderby': 'date',
                    'order': 'desc',
                    'page': page
                }, timeout=15)
                if response.status_code == 200:
                    page_posts = response.json()
                    if not page_posts:  # No more posts
                        break
                    # Merge with existing, avoiding duplicates
                    existing_ids = {p.get('id') for p in all_posts}
                    for post in page_posts:
                        if post.get('id') not in existing_ids:
                            all_posts.append(post)
                else:
                    print(f"WordPress API returned status {response.status_code} for page {page}")
                    break
            print(f"Fetched {len(all_posts)} total posts for query: {query}")
        except Exception as e:
            print(f"WordPress recent posts API error: {e}")
            pass
        
        # Rank posts by relevance (simple keyword matching)
        query_lower = query.lower()
        # Remove common stop words for better matching
        stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
        query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
        
        # If all words were stop words, use original query
        if not query_words:
            query_words = set(query_lower.split())
        
        def calculate_relevance(post):
            score = 0
            title = post.get('title', {}).get('rendered', '').lower()
            excerpt = post.get('excerpt', {}).get('rendered', '').lower()
            content = post.get('content', {}).get('rendered', '').lower()
            
            # Title matches are most important
            for word in query_words:
                if word in title:
                    score += 10
                if word in excerpt:
                    score += 5
                if word in content:
                    score += 1
            
            # Exact phrase match bonus
            if query_lower in title:
                score += 20
            if query_lower in excerpt:
                score += 10
            if query_lower in content:
                score += 5
            
            return score
        
        # Sort by relevance and take top results
        posts_with_scores = [(p, calculate_relevance(p)) for p in all_posts]
        posts_with_scores.sort(key=lambda x: x[1], reverse=True)
        
        # Log top results for debugging
        print(f"Query: {query}")
        print(f"Query words after filtering: {query_words}")
        if posts_with_scores[:3]:
            print("Top 3 results:")
            for p, score in posts_with_scores[:3]:
                title = p.get('title', {}).get('rendered', 'No title')
                print(f"  - Score {score}: {title}")
        
        # Take top N posts based on max_results
        posts = [p for p, score in posts_with_scores[:max_results]]
        
        # If top post has score 0, try a more lenient search
        if posts and posts_with_scores[0][1] == 0 and len(all_posts) > max_results:
            print("Top post has 0 score, trying lenient search...")
            for word in query_words:
                matching_posts = [p for p in all_posts 
                                if word in p.get('title', {}).get('rendered', '').lower() 
                                or word in p.get('excerpt', {}).get('rendered', '').lower()
                                or word in p.get('content', {}).get('rendered', '').lower()]
                if matching_posts:
                    posts = matching_posts[:max_results]
                    print(f"Found {len(matching_posts)} posts matching word: {word}")
                    break
        
    except requests.RequestException as e:
        print(f"WordPress API request error: {e}")
        posts = []
    
    # Step 2: Search static HTML pages
    static_pages = []
    try:
        static_pages = search_static_html_pages(query)
    except Exception as e:
        print(f"Error searching static HTML pages: {e}")
        static_pages = []
    
    # Step 3: Prepare context from blog posts and static HTML pages
    context = ""
    sources = []
    
    # Add blog posts to context
    if posts:
        for post in posts[:max_results]:
            title = post.get('title', {}).get('rendered', '')
            content = post.get('content', {}).get('rendered', '')
            link = post.get('link', '')
            excerpt = post.get('excerpt', {}).get('rendered', '')
            date_str = post.get('date', '')
            
            # Clean HTML tags more thoroughly
            import re
            content_clean = re.sub('<[^<]+?>', '', content)
            excerpt_clean = re.sub('<[^<]+?>', '', excerpt)
            
            # Remove extra whitespace and newlines
            content_clean = re.sub(r'\s+', ' ', content_clean).strip()
            excerpt_clean = re.sub(r'\s+', ' ', excerpt_clean).strip()
            
            # Calculate authority score
            authority_score = calculate_authority_score(
                source_type='blog',
                title=title,
                content=content_clean,
                date_str=date_str,
                query=query,
                query_words=query_words
            )
            
            # Get more content (up to 4000 chars per post)
            content_snippet = content_clean[:4000] if len(content_clean) > 4000 else content_clean
            
            context += f"\n\n---\nBlog Post: {title}\nExcerpt: {excerpt_clean}\nFull Content: {content_snippet}\n---\n"
            sources.append({
                'title': title,
                'link': link,
                'excerpt': excerpt_clean[:200] if excerpt_clean else content_clean[:200],
                'type': 'blog',
                'authority': authority_score,
                'date': date_str
            })
    
    # Add static HTML pages to context
    if static_pages:
        for page in static_pages[:max_results]:
            title = page.get('title', '')
            content = page.get('content', '')
            link = page.get('link', '')
            
            # Calculate authority score
            authority_score = calculate_authority_score(
                source_type='website',
                title=title,
                content=content,
                date_str=None,
                query=query,
                query_words=query_words
            )
            
            # Content is already cleaned, just truncate
            content_snippet = content[:4000] if len(content) > 4000 else content
            
            # Extract a snippet for excerpt
            excerpt = content[:200] + '...' if len(content) > 200 else content
            
            context += f"\n\n---\nWebsite Page: {title}\nContent: {content_snippet}\n---\n"
            sources.append({
                'title': title,
                'link': link,
                'excerpt': excerpt,
                'type': 'website',
                'authority': authority_score
            })
    
    return {
        'sources': sources,
        'context': context,
        'query': query,
        'query_words': query_words
    }

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
            answer = response.text if response.text else "I couldn't generate an answer. Please visit curam-ai.com.au for more information."
            
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

def format_text_to_html(text):
    """
    Convert plain text to HTML with paragraph breaks and basic formatting.
    Handles double newlines as paragraph breaks, single newlines as line breaks.
    Also handles sentences that end with periods followed by newlines as paragraph breaks.
    """
    if not text:
        return ""
    
    import re
    
    # First, normalize whitespace - replace multiple spaces with single space
    text = re.sub(r' +', ' ', text.strip())
    
    # Split by double newlines (paragraphs)
    paragraphs = re.split(r'\n\s*\n', text)
    
    # If no double newlines, try to intelligently split into paragraphs
    # Look for sentence endings followed by capital letters (likely new paragraph)
    if len(paragraphs) == 1:
        # Pattern: sentence ending (. ! ?) followed by space and capital letter
        # This helps identify natural paragraph breaks
        parts = re.split(r'([.!?])\s+([A-Z][a-z])', text)
        
        if len(parts) > 3:  # If we found potential breaks
            # Reconstruct paragraphs intelligently
            paragraphs = []
            current_para = parts[0] if parts[0] else ""
            
            for i in range(1, len(parts), 3):
                if i + 1 < len(parts):
                    punctuation = parts[i] if i < len(parts) else ""
                    next_sentence = parts[i + 1] if i + 1 < len(parts) else ""
                    
                    # If current paragraph is substantial and next starts a new thought, break
                    if len(current_para.strip()) > 50 and next_sentence:
                        if current_para.strip():
                            paragraphs.append((current_para.strip() + punctuation).strip())
                        current_para = next_sentence
                    else:
                        current_para += punctuation + " " + next_sentence
                else:
                    current_para += parts[i] if i < len(parts) else ""
            
            if current_para.strip():
                paragraphs.append(current_para.strip())
        else:
            # Fallback: if text has single newlines, use those
            if '\n' in text:
                paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
    
    html_parts = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Replace single newlines with <br> within paragraphs (but preserve intentional breaks)
        para = para.replace('\n', '<br>')
        
        # Basic markdown-style formatting
        # Bold: **text** or *text* (but not if it's part of a URL or email)
        para = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', para)
        # Only italicize single asterisks that aren't part of bold
        para = re.sub(r'(?<!\*)\*([^*]+?)\*(?!\*)', r'<em>\1</em>', para)
        
        # Escape any remaining HTML that shouldn't be there
        # (This is a simple escape - more complex sanitization happens in frontend)
        
        # Wrap in paragraph tag
        html_parts.append(f'<p>{para}</p>')
    
    return ''.join(html_parts) if html_parts else f'<p>{text}</p>'


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
            system_prompt = f"""You are an AI assistant for Curam-Ai Protocol™.

User asked: "{message}"

Content from our blog/website:
{rag_context}

Answer using this content. Put source titles in "quotes". Use paragraphs (\n\n).

Services: Phase 1 ($1,500), Phase 2 ($7,500), Phase 3 ($8-12k), Phase 4 ($20-30k)"""
        else:
            system_prompt = """You are an AI assistant for Curam-Ai Protocol™.

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
            if '- ' in para or '• ' in para:
                items = []
                for line in para.split('\n'):
                    if line.strip().startswith(('-', '•')):
                        items.append(f'<li>{line.lstrip("-• ").strip()}</li>')
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
                <p>Best regards,<br>Curam-Ai Protocolâ„¢ Team</p>
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
        email_text += "Best regards,\nCuram-Ai Protocolâ„¢ Team"
        
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
                "name": "Curam-Ai Protocolâ„¢"
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


@app.route('/how-it-works')
@app.route('/how-it-works.html')
def how_it_works():
    try:
        return send_file('how-it-works.html')
    except:
        return "How it works page not found.", 404

@app.route('/curam-ai-protocol.html')
def curam_ai_protocol():
    try:
        return send_file('curam-ai-protocol.html')
    except:
        return "Protocol page not found.", 404

@app.route('/tier2-report.html')
def tier2_report():
    """Serve the Tier 2 report HTML file"""
    try:
        # Serve the actual Tier 2 report file (tier2-report.html contains the report)
        # The Curam-Ai-Redacted file appears to be homepage content, so use tier2-report.html
        html_file = 'tier2-report.html'
        
        if not os.path.exists(html_file):
            return f"Tier 2 report not found. Looking for: {html_file}", 404
        
        # Use absolute path to ensure we get the right file
        file_path = os.path.abspath(html_file)
        return send_file(file_path, mimetype='text/html')
    except Exception as e:
        return f"Error serving report: {str(e)}", 500

@app.route('/tier-one-feasibility-report')
@app.route('/tier-one-feasibility-report.html')
def tier_one_feasibility_report():
    """Serve the Tier One Feasibility Report HTML file"""
    try:
        return send_file('tier-one-feasibility-report.html')
    except:
        return "Tier One Feasibility Report not found.", 404

@app.route('/phase-1-feasibility')
@app.route('/phase-1-feasibility.html')
def phase_1_feasibility():
    """Serve the Phase 1 Feasibility page"""
    try:
        return send_file('phase-1-feasibility.html')
    except:
        return "Phase 1 Feasibility page not found.", 404

@app.route('/phase-2-roadmap')
@app.route('/phase-2-roadmap.html')
def phase_2_roadmap():
    """Serve the Phase 2 Roadmap page"""
    try:
        return send_file('phase-2-roadmap.html')
    except:
        return "Phase 2 Roadmap page not found.", 404

@app.route('/phase-3-compliance')
@app.route('/phase-3-compliance.html')
def phase_3_compliance():
    """Serve the Phase 3 Compliance Shield page"""
    try:
        return send_file('phase-3-compliance.html')
    except:
        return "Phase 3 Compliance Shield page not found.", 404

@app.route('/phase-4-implementation')
@app.route('/phase-4-implementation.html')
def phase_4_implementation():
    """Serve the Phase 4 Implementation page"""
    try:
        return send_file('phase-4-implementation.html')
    except:
        return "Phase 4 Implementation page not found.", 404

@app.route('/feasibility-sprint-report')
@app.route('/feasibility-sprint-report.html')
@app.route('/gate2-sample-report')
@app.route('/gate2-sample-report.html')
def feasibility_sprint_report():
    """Serve the Phase 1 Feasibility Sprint report slideshow page"""
    try:
        return send_file('feasibility-sprint-report.html')
    except:
        return "Feasibility Sprint report page not found.", 404

@app.route('/risk-audit-report')
@app.route('/risk-audit-report.html')
def risk_audit_report():
    """Serve the Risk Audit Report page"""
    try:
        return send_file('risk-audit-report.html')
    except:
        return "Risk Audit Report page not found.", 404

# Phase 2 Report Routes
@app.route('/phase-2-exec-summary')
@app.route('/phase-2-exec-summary.html')
def phase_2_exec_summary():
    """Serve the Phase 2 Executive Summary report"""
    try:
        return send_file('phase-2-exec-summary.html')
    except:
        return "Phase 2 Executive Summary not found.", 404

@app.route('/phase-2-discovery-baseline-report')
@app.route('/phase-2-discovery-baseline-report.html')
def phase_2_discovery_baseline():
    """Serve the Phase 2 Discovery Baseline report"""
    try:
        return send_file('phase-2-discovery-baseline-report.html')
    except:
        return "Phase 2 Discovery Baseline report not found.", 404

@app.route('/phase-2-metric-agreement')
@app.route('/phase-2-metric-agreement.html')
def phase_2_metric_agreement():
    """Serve the Phase 2 Metric Agreement report"""
    try:
        return send_file('phase-2-metric-agreement.html')
    except:
        return "Phase 2 Metric Agreement not found.", 404

@app.route('/phase-2-reports')
@app.route('/phase-2-reports.html')
def phase_2_reports():
    """Serve the Phase 2 reports index page"""
    try:
        return send_file('phase-2-reports.html')
    except:
        return "Phase 2 reports page not found.", 404

# Root route - serve the marketing homepage
@app.route('/')
def root():
    try:
        return send_file('homepage.html')
    except Exception as e:
        # Fallback message if homepage doesn't exist
        return f"Homepage not found. Error: {str(e)}", 404

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
                    model_actions.append(f"âœ— ERROR: {filename} rejected (not a PDF)")
                    break
                unique_name = f"{int(time.time() * 1000)}_{filename}"
                file_path = os.path.join(FINANCE_UPLOAD_DIR, unique_name)
                file_storage.save(file_path)
                finance_uploaded_paths.append(file_path)
                model_actions.append(f"âœ“ Uploaded invoice saved: {file_path}")
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
                model_actions.append(f"âœ— ERROR: {error_message}")
            else:
                error_message = "Please select at least one sample file."
                model_actions.append(f"âœ— ERROR: {error_message}")

        if not error_message:
            if samples:
                model_actions.append(f"Processing {len(samples)} sample file(s)")
                for sample_path in samples:
                    if not os.path.exists(sample_path):
                        error_msg = f"File not found: {sample_path}"
                        model_actions.append(f"âœ— {error_msg}")
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
                            model_actions.append(f"âœ— Text extraction failed for {filename}: {text}")
                            if not error_message:
                                error_message = f"Text extraction failed for {filename}"
                            continue
                        else:
                            model_actions.append(f"âœ“ Text extracted successfully ({len(text)} characters)")
                    
                    model_actions.append(f"Analyzing {filename} with AI models")
                    entries, api_error, model_used, attempt_log, file_action_log, schedule_type = analyze_gemini(text, department, image_path)
                    if file_action_log:
                        model_actions.extend(file_action_log)
                    if model_used:
                        last_model_used = model_used
                        model_actions.append(f"âœ“ Successfully processed {filename} with {model_used}")
                    if attempt_log:
                        model_attempts.extend(attempt_log)
                    if api_error:
                        model_actions.append(f"âœ— Failed to process {filename}: {api_error}")
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
                                model_actions.append(f"âœ“ Extracted structured data from {filename}")
                            else:
                                # Fallback to old format
                                for entry in entries if isinstance(entries, list) else [entries]:
                                    entry['Filename'] = filename
                                    results.append(entry)
                                model_actions.append(f"âœ“ Extracted {len(entries)} row(s) from {filename}")
                        else:
                            model_actions.append(f"âœ“ Extracted {len(entries)} row(s) from {filename}")
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
                                                                f"Size corrected: '{entry[field]}' â†’ '{corrected_value}'"
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
                        model_actions.append(f"âš  No data extracted from {filename}")

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
                print(f"✓ Database returned {len(samples)} samples for {dept}")
                dept_info = DEPARTMENT_SAMPLES.get(dept, {})
                db_samples[dept] = {
                    "label": dept_info.get("label", "Samples"),
                    "description": dept_info.get("description", ""),
                    "folder": dept_info.get("folder", ""),
                    "samples": samples
                }
            else:
                print(f"⚠ Database returned 0 samples for {dept} - using hardcoded")
        except Exception as e:
            print(f"✗ Database error for {dept}: {e}")
            # Continue with hardcoded samples on error
    
    # Merge database samples with hardcoded (database takes priority)
    sample_files_merged = {**DEPARTMENT_SAMPLES, **db_samples}
    print(f"Final sample count - Finance: {len(sample_files_merged.get('finance', {}).get('samples', []))}")
    
    # Debug: Show first sample path for finance
    finance_samples = sample_files_merged.get('finance', {}).get('samples', [])
    if finance_samples:
        print(f"First finance sample path: {finance_samples[0].get('path', 'NO PATH')}")
    else:
        print("⚠ No finance samples in merged data!")
    
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

# ROI calculator HTML page with iframe (serves roi.html)
@app.route('/roi.html')
def roi_html():
    """Serve roi.html page with iframe to ROI calculator"""
    return send_file('roi.html')

# ROI calculator redirect route (for /roi without .html)
@app.route('/roi')
def roi_redirect():
    """Redirect /roi to /roi.html"""
    return redirect('/roi.html', code=301)

# Blog HTML page with iframe (serves blog.html)
@app.route('/blog.html')
def blog_html():
    """Serve blog.html page with iframe to curam-ai.com.au"""
    return send_file('blog.html')

# Blog redirect route (for /blog without .html)
@app.route('/blog')
def blog_redirect():
    """Redirect /blog to /blog.html"""
    return redirect('/blog.html', code=301)

@app.route('/sitemap.html')
def sitemap_html():
    """Serve sitemap.html page"""
    try:
        return send_file('sitemap.html')
    except:
        return "Sitemap not found.", 404

@app.route('/sitemap.xml')
def sitemap_xml():
    """Serve sitemap.xml for search engines"""
    try:
        return send_file('sitemap.xml', mimetype='application/xml')
    except:
        return "Sitemap XML not found.", 404

# Import ROI calculator routes BEFORE running the app
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    # Mount ROI calculator at /roi-calculator (with trailing slash support)
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
    print("âœ“ ROI Calculator blueprint registered successfully at /roi-calculator")
except ImportError as e:
    print(f"âœ— Warning: Could not import ROI calculator: {e}")
    import traceback
    traceback.print_exc()
except Exception as e:
    print(f"âœ— Error registering ROI calculator: {e}")
    import traceback
    traceback.print_exc()

if __name__ == '__main__':
    # This allows local testing
    app.run(debug=True, port=5000)