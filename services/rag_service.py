"""
RAG (Retrieval-Augmented Generation) Search Service

This module handles searching across blog posts and static HTML pages
to provide context for AI-powered responses.

Functions:
- extract_text_from_html(): Extract text content from HTML files
- calculate_authority_score(): Score sources by relevance and authority
- search_static_html_pages(): Search local HTML files
- perform_rag_search(): Main RAG search function
"""

import os
import re
import requests
from datetime import datetime


def extract_text_from_html(file_path):
    """
    Extract text content from an HTML file.
    Returns dict with title, content, and filename.
    """
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
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Go up one level from services/
    
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
    # Step 1: Fetch blog content from WordPress REST API
    # Get blog URL from environment variable or use new subdomain as default
    env_blog_url = os.getenv('WORDPRESS_BLOG_URL', 'https://blog.curam-ai.com.au')
    
    blog_urls = [
        env_blog_url,                    # From environment variable or new subdomain
        'https://blog.curam-ai.com.au',  # Primary (new subdomain)
        'https://www.curam-ai.com.au',   # Fallback (old www subdomain)
        'https://curam-ai.com.au'        # Fallback (old no-www)
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
                print(f"âœ“ Blog URL accessible: {blog_url}")
                break
        except requests.RequestException as e:
            print(f"âœ— Blog URL failed: {test_url} - {str(e)[:100]}")
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