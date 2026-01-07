# Website Performance Optimization Plan

## Current Infrastructure Analysis

### Architecture
- **Pages**: Served from Railway (Flask)
- **Blog**: WordPress API (blog.curam-ai.com.au)
- **RAG**: Chatbot and search use RAG (Retrieval-Augmented Generation)
- **Video**: Homepage hero video (7.11 MB + 14.83 MB = 21.94 MB total)

### Performance Issues Identified

1. **Video Files** (CRITICAL - 21.94 MB)
   - Two large MP4 files (7.11 MB + 14.83 MB)
   - No lazy loading or preload optimization
   - No WebM format for better compression
   - Both videos loaded (fallback redundancy)

2. **No Caching Headers** (HIGH PRIORITY)
   - Static assets (CSS, JS, images) have no cache-control headers
   - Every request re-downloads assets
   - No ETag or Last-Modified headers

3. **WordPress API Calls** (HIGH PRIORITY)
   - Fetching 300 posts (3 pages × 100) for blog search
   - Multiple timeout settings (5s, 10s, 15s, 20s)
   - No response caching
   - Sequential API calls

4. **RAG Search Performance** (MEDIUM PRIORITY)
   - Blog search can take 3-10 seconds
   - No query result caching
   - Multiple API calls per search

5. **Font Loading** (MEDIUM PRIORITY)
   - Google Fonts loaded synchronously
   - No font-display: swap
   - No preload for critical fonts

6. **Large CSS File** (LOW PRIORITY)
   - 13,700+ lines (could be minified in production)
   - No CSS splitting

7. **No CDN** (LOW PRIORITY)
   - Static assets served directly from Railway
   - Could use Cloudflare or similar

## Optimization Implementation Plan

### Phase 1: Quick Wins (Immediate Impact)

#### 1.1 Add Caching Headers
**Impact**: High | **Effort**: Low
- Add Cache-Control headers for static assets
- CSS/JS: 1 year cache with versioning
- Images: 6 months cache
- Videos: 1 month cache (large files)

#### 1.2 Optimize Video Loading
**Impact**: High | **Effort**: Medium
- Add `preload="metadata"` (not "auto")
- Add `loading="lazy"` for below-fold content
- Remove duplicate video source
- Consider WebM format for better compression

#### 1.3 Font Loading Optimization
**Impact**: Medium | **Effort**: Low
- Add `font-display: swap` to Google Fonts
- Preload critical font weights
- Use `&display=swap` in Google Fonts URL

### Phase 2: API Optimizations (Medium Impact)

#### 2.1 WordPress API Caching
**Impact**: High | **Effort**: Medium
- Cache blog post responses (5-10 minutes)
- Use Flask-Caching or simple in-memory cache
- Cache key: query + page number

#### 2.2 Reduce WordPress Fetch Size
**Impact**: Medium | **Effort**: Low
- Reduce from 300 posts to 50-100 for search
- Use WordPress search API more effectively
- Only fetch needed fields

#### 2.3 RAG Query Caching
**Impact**: Medium | **Effort**: Medium
- Cache common RAG queries (5 minutes)
- Cache key: normalized query string
- Invalidate on new blog posts (optional)

### Phase 3: Advanced Optimizations (Long-term)

#### 3.1 Image Optimization
- Convert images to WebP format
- Add lazy loading for images
- Use responsive images (srcset)

#### 3.2 CSS/JS Minification
- Minify CSS for production
- Minify and bundle JavaScript
- Use versioned filenames for cache busting

#### 3.3 CDN Integration
- Move static assets to CDN (Cloudflare)
- Serve videos from CDN
- Enable CDN caching

## Implementation Priority

1. **Immediate** (Do Now):
   - Add caching headers
   - Optimize video loading
   - Font loading optimization

2. **Short-term** (This Week):
   - WordPress API caching
   - Reduce WordPress fetch size
   - RAG query caching

3. **Long-term** (Next Sprint):
   - Image optimization
   - CSS/JS minification
   - CDN integration

## Expected Performance Gains

- **Video optimization**: -15-20 MB initial load
- **Caching headers**: 50-80% reduction in repeat visits
- **WordPress caching**: 2-5 second improvement on blog searches
- **Font optimization**: 200-500ms faster first paint
- **Overall**: 30-50% improvement in page load times
