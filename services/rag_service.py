"""
RAG (Retrieval-Augmented Generation) Search Service - TWO-PHASE VERSION

This module handles searching across blog posts and static HTML pages
with a two-phase approach for better UX:

Phase 1: Fast search of static HTML pages (instant results)
Phase 2: Slower search of 800+ blog posts (appended when ready)

Functions:
- extract_text_from_html(): Extract text content from HTML files
- calculate_authority_score(): Score sources by relevance and authority
- search_static_html_pages(): Search local HTML files
- search_blog_posts(): Search WordPress blog (can be run async)
- perform_rag_search_fast(): Quick search (static pages only)
- perform_rag_search(): Full search (both phases)
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
    
    FAST: Typically completes in <100ms
    """
    # Pages to exclude from search (navigation, includes, generic pages, etc.)
    excluded_pages = {
        'navbar.html', 'embed_snippet.html', 'index.html',
        'sitemap.html', 'search-results.html', 'search.html',
        'about.html', 'contact.html', 'homepage.html', 'services.html'
    }
    
    # Get all HTML files in the root directory
    html_files = []
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
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
    
    # Filter and return top results
    # Use dynamic minimum score: lower for single-word queries, higher for multi-word
    # This ensures single words like "tesla" or "audit" aren't filtered out
    if len(query_words) == 1:
        MINIMUM_SCORE = 1  # Single word: accept any match (content match = 1 point)
    else:
        MINIMUM_SCORE = 5  # Multi-word: require at least 5 points (e.g., 2 words in content = 2 points, or 1 in title = 10 points)
    
    relevant_pages = [p for p in ranked_pages if calculate_page_relevance(p) >= MINIMUM_SCORE][:5]
    
    # If no results with minimum score, return top 3 anyway (even with score 0)
    # This ensures users always get some results, even if relevance is low
    if not relevant_pages and ranked_pages:
        relevant_pages = ranked_pages[:3]
    
    return relevant_pages


def search_blog_posts(query, max_results=5):
    """
    Search WordPress blog posts (800+ articles).
    
    SLOW: Can take 3-10 seconds due to API calls and processing.
    Should be called asynchronously or after returning static page results.
    
    Returns:
        dict: {
            'posts': list of blog post objects,
            'query_words': set of filtered query keywords,
            'error': str (optional)
        }
    """
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
                print(f"✓ Blog URL accessible: {blog_url}")
                break
        except requests.RequestException as e:
            print(f"✗ Blog URL failed: {test_url} - {str(e)[:100]}")
            continue
    
    # If neither URL works, return error
    if not blog_url:
        return {
            'posts': [],
            'query_words': set(),
            'error': 'Unable to reach blog API'
        }
    
    posts = []
    try:
        all_posts = []
        
        # Strategy 1: Search in WordPress API
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
        
        # Strategy 2: Fetch recent posts as backup (reduced from 300 to 50 posts)
        try:
            pages_to_fetch = 1  # 50 posts max (reduced from 300)
            for page in range(1, pages_to_fetch + 1):
                response = requests.get(wp_api_url, params={
                    'per_page': 50,  # Reduced from 100
                    '_fields': 'id,title,content,excerpt,link,date',
                    'orderby': 'date',
                    'order': 'desc',
                    'page': page
                }, timeout=10)  # Reduced from 15s
                if response.status_code == 200:
                    page_posts = response.json()
                    if not page_posts:
                        break
                    existing_ids = {p.get('id') for p in all_posts}
                    for post in page_posts:
                        if post.get('id') not in existing_ids:
                            all_posts.append(post)
                else:
                    break
            print(f"Fetched {len(all_posts)} total posts for query: {query}")
        except Exception as e:
            print(f"WordPress recent posts API error: {e}")
        
        # Rank posts by relevance
        query_lower = query.lower()
        stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
        query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
        
        if not query_words:
            query_words = set(query_lower.split())
        
        # Business domain keywords - posts should relate to these topics
        domain_keywords = {
            'document', 'automation', 'ai', 'artificial intelligence', 'machine learning', 'llm',
            'extraction', 'pdf', 'ocr', 'rag', 'retrieval', 'augmented', 'generation',
            'workflow', 'process', 'business', 'consulting', 'implementation', 'enterprise',
            'invoice', 'contract', 'tender', 'compliance', 'audit', 'finance', 'accounting',
            'legal', 'engineering', 'construction', 'logistics', 'transmittal', 'protocol',
            'gemini', 'openai', 'chatgpt', 'claude', 'anthropic', 'api', 'integration',
            'feasibility', 'roi', 'cost', 'pricing', 'guarantee', 'phase', 'delivery',
            'data', 'intelligence', 'semantic', 'embedding', 'vector', 'nlp', 'ml',
            'curam', 'software', 'system', 'platform', 'solution', 'service', 'technology'
        }
        
        # Consumer/off-topic keywords - posts with these (without domain keywords) are penalized
        off_topic_keywords = {
            'consumer device', 'smartphone', 'tablet', 'gadget', 'appliance', 'rabbit r1',
            'recipe', 'cooking', 'weather', 'sports', 'celebrity', 'movie', 'game',
            'restaurant', 'hotel', 'travel', 'vacation', 'music', 'fashion', 'car review',
            'bitcoin', 'crypto', 'stock', 'forex', 'dating', 'pets', 'gardening',
            'mars', 'venus', 'planet', 'space exploration', 'relationship advice', 'novel', 'fiction'
        }
        
        def calculate_relevance(post):
            score = 0
            title = post.get('title', {}).get('rendered', '').lower()
            excerpt = post.get('excerpt', {}).get('rendered', '').lower()
            content = post.get('content', {}).get('rendered', '').lower()
            
            # Combine all text for domain relevance check
            combined_text = f"{title} {excerpt} {content[:1000]}".lower()
            
            # Check domain relevance - penalize if no domain keywords found
            has_domain_keywords = any(keyword in combined_text for keyword in domain_keywords)
            has_off_topic = any(keyword in combined_text for keyword in off_topic_keywords)
            
            # Domain relevance penalty: if query is a single word and post has off-topic but no domain keywords, heavily penalize
            if len(query_words) == 1 and has_off_topic and not has_domain_keywords:
                # This is likely a consumer product or unrelated topic
                score -= 50  # Heavy penalty for completely off-topic content
            
            # Keyword matching scoring
            for word in query_words:
                if word in title:
                    score += 10
                if word in excerpt:
                    score += 5
                if word in content:
                    score += 1
            
            if query_lower in title:
                score += 20
            if query_lower in excerpt:
                score += 10
            if query_lower in content:
                score += 5
            
            # Domain relevance bonus: boost posts that have domain keywords
            if has_domain_keywords:
                score += 15  # Bonus for business-relevant content
            
            return max(score, 0)  # Ensure non-negative
        
        # Sort and take top results
        posts_with_scores = [(p, calculate_relevance(p)) for p in all_posts]
        posts_with_scores.sort(key=lambda x: x[1], reverse=True)
        
        # Filter by minimum score, but ensure domain relevance for single-word queries
        # Single-word queries now need domain keywords (15 bonus) + at least 1 keyword match = 16+ total
        if len(query_words) == 1:
            MINIMUM_SCORE = 15  # Single word: require domain relevance (off-topic posts get negative scores)
        else:
            MINIMUM_SCORE = 5  # Multi-word: require at least 5 points
        
        # Filter posts by minimum score AND ensure they're not penalized (score > 0)
        filtered_posts = [p for p, score in posts_with_scores if score >= MINIMUM_SCORE and score > 0]
        
        # If no results meet minimum, return top results anyway (but only positive scores)
        if not filtered_posts and posts_with_scores:
            # Only return posts with positive scores (filter out penalized off-topic posts)
            positive_posts = [p for p, score in posts_with_scores if score > 0][:max_results]
            posts = positive_posts if positive_posts else []
        else:
            posts = filtered_posts[:max_results]
        
        return {
            'posts': posts,
            'query_words': query_words,
            'error': None
        }
        
    except requests.RequestException as e:
        print(f"WordPress API request error: {e}")
        return {
            'posts': [],
            'query_words': set(),
            'error': str(e)
        }


def perform_rag_search_fast(query, max_results=5):
    """
    FAST two-phase RAG search - returns static pages immediately.
    
    This is Phase 1 only - searches static HTML pages and returns quickly.
    Call search_blog_posts() separately for Phase 2.
    
    Returns:
        dict: {
            'sources': list (static pages only),
            'context': str (static pages only),
            'query': str,
            'query_words': set,
            'searching_blog': bool (always True - blog search needed)
        }
    """
    # Phase 1: Search static HTML pages (FAST)
    static_pages = search_static_html_pages(query)
    
    query_lower = query.lower()
    stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
    query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
    
    if not query_words:
        query_words = set(query_lower.split())
    
    context = ""
    sources = []
    
    # Add static HTML pages to context
    if static_pages:
        for page in static_pages[:max_results]:
            title = page.get('title', '')
            content = page.get('content', '')
            link = page.get('link', '')
            
            authority_score = calculate_authority_score(
                source_type='website',
                title=title,
                content=content,
                date_str=None,
                query=query,
                query_words=query_words
            )
            
            content_snippet = content[:4000] if len(content) > 4000 else content
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
        'query_words': query_words,
        'searching_blog': True  # Indicates blog search is still needed
    }


def perform_rag_search(query, max_results=5):
    """
    FULL two-phase RAG search - returns both static pages and blog posts.
    
    This combines Phase 1 (static pages) and Phase 2 (blog posts).
    Use this for synchronous full search, or call perform_rag_search_fast()
    followed by search_blog_posts() for async approach.
    
    Returns:
        dict: {
            'sources': list (both static pages and blog posts),
            'context': str (combined content),
            'query': str,
            'query_words': set
        }
    """
    # Phase 1: Static pages (fast)
    fast_results = perform_rag_search_fast(query, max_results)
    
    # Phase 2: Blog posts (slow)
    blog_results = search_blog_posts(query, max_results)
    
    context = fast_results['context']
    sources = fast_results['sources'].copy()
    query_words = fast_results['query_words']
    
    # Add blog posts to context
    if blog_results['posts']:
        for post in blog_results['posts'][:max_results]:
            title = post.get('title', {}).get('rendered', '')
            content = post.get('content', {}).get('rendered', '')
            link = post.get('link', '')
            excerpt = post.get('excerpt', {}).get('rendered', '')
            date_str = post.get('date', '')
            
            # Clean HTML tags
            content_clean = re.sub('<[^<]+?>', '', content)
            excerpt_clean = re.sub('<[^<]+?>', '', excerpt)
            content_clean = re.sub(r'\s+', ' ', content_clean).strip()
            excerpt_clean = re.sub(r'\s+', ' ', excerpt_clean).strip()
            
            authority_score = calculate_authority_score(
                source_type='blog',
                title=title,
                content=content_clean,
                date_str=date_str,
                query=query,
                query_words=query_words
            )
            
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
    
    return {
        'sources': sources,
        'context': context,
        'query': query,
        'query_words': query_words
    }