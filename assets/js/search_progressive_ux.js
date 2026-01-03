// ============================================================================
// TWO-PHASE RAG SEARCH - CLIENT-SIDE JAVASCRIPT (BEST UX)
// ============================================================================
// 
// This implements progressive enhancement:
// 1. Shows initial results from static pages in <500ms
// 2. Displays "Searching blog..." message
// 3. Enhances results with blog posts when ready
//
// Usage:
// - Add this to your search page JavaScript
// - Call searchBlogProgressive(query) when user searches
// - Make sure you have the HTML elements (see HTML section below)
// ============================================================================

/**
 * Progressive two-phase search with best UX
 * @param {string} query - User's search query
 */
async function searchBlogProgressive(query) {
    if (!query || query.trim() === '') {
        showError('Please enter a search query');
        return;
    }

    try {
        // Clear previous results
        clearResults();
        
        // Phase 1: Get fast results from static pages
        showLoadingState('Searching website...');
        
        const fastResponse = await fetch('/api/search-blog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query.trim() })
        });

        if (!fastResponse.ok) {
            throw new Error('Search failed');
        }

        const fastResult = await fastResponse.json();
        
        // Handle errors
        if (fastResult.error) {
            showError(fastResult.error);
            return;
        }

        // Display initial results immediately
        hideLoadingState();
        displayResults(fastResult.answer, fastResult.sources, false);
        
        // Phase 2: Get complete results with blog posts
        if (fastResult.searching_blog) {
            // Show "searching blog" indicator
            showBlogSearching(fastResult.message || '🔍 Searching 800+ blog articles...');
            
            // Fetch complete results in background
            const completeResponse = await fetch('/api/search-blog-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query.trim() })
            });

            if (!completeResponse.ok) {
                hideBlogSearching();
                console.warn('Blog search failed, showing static page results only');
                return;
            }

            const completeResult = await completeResponse.json();
            
            // Update with complete results
            hideBlogSearching();
            
            if (!completeResult.error) {
                displayResults(completeResult.answer, completeResult.sources, true);
                showUpdateNotification('✨ Enhanced with blog insights');
            }
        }
        
    } catch (error) {
        console.error('Search error:', error);
        hideLoadingState();
        hideBlogSearching();
        showError('An error occurred. Please try again.');
    }
}

/**
 * Display search results
 * @param {string} answer - AI-generated answer
 * @param {Array} sources - Array of source objects
 * @param {boolean} isUpdate - Whether this is an update to existing results
 */
function displayResults(answer, sources, isUpdate = false) {
    const resultsContainer = document.getElementById('search-results');
    const answerDiv = document.getElementById('search-answer');
    const sourcesDiv = document.getElementById('search-sources');
    
    if (!resultsContainer || !answerDiv || !sourcesDiv) {
        console.error('Required DOM elements not found');
        return;
    }

    // Show results container
    resultsContainer.style.display = 'block';
    
    // Add smooth transition class for updates
    if (isUpdate) {
        resultsContainer.classList.add('updating');
        setTimeout(() => resultsContainer.classList.remove('updating'), 500);
    }

    // Display answer
    answerDiv.innerHTML = answer;
    
    // Display sources
    sourcesDiv.innerHTML = '';
    
    if (sources && sources.length > 0) {
        // Group sources by type
        const websiteSources = sources.filter(s => s.type === 'website');
        const blogSources = sources.filter(s => s.type === 'blog');
        
        // Add website sources
        if (websiteSources.length > 0) {
            const websiteHeader = document.createElement('h3');
            websiteHeader.className = 'sources-header';
            websiteHeader.textContent = 'Website Pages';
            sourcesDiv.appendChild(websiteHeader);
            
            websiteSources.forEach(source => {
                sourcesDiv.appendChild(createSourceElement(source, isUpdate));
            });
        }
        
        // Add blog sources
        if (blogSources.length > 0) {
            const blogHeader = document.createElement('h3');
            blogHeader.className = 'sources-header';
            blogHeader.textContent = 'Blog Articles';
            blogHeader.style.marginTop = '20px';
            sourcesDiv.appendChild(blogHeader);
            
            blogSources.forEach(source => {
                sourcesDiv.appendChild(createSourceElement(source, isUpdate));
            });
        }
    } else {
        sourcesDiv.innerHTML = '<p>No sources found.</p>';
    }
}

/**
 * Create a source element
 * @param {Object} source - Source object with title, link, excerpt, type
 * @param {boolean} isNew - Whether this is a newly added source
 * @returns {HTMLElement}
 */
function createSourceElement(source, isNew = false) {
    const sourceEl = document.createElement('div');
    sourceEl.className = `source source-${source.type}`;
    
    // Add highlight class for new sources
    if (isNew) {
        sourceEl.classList.add('source-new');
        // Remove highlight after animation
        setTimeout(() => sourceEl.classList.remove('source-new'), 2000);
    }
    
    sourceEl.innerHTML = `
        <div class="source-header">
            <h4 class="source-title">${escapeHtml(source.title)}</h4>
            <span class="source-badge source-badge-${source.type}">${source.type}</span>
        </div>
        <p class="source-excerpt">${escapeHtml(source.excerpt)}</p>
        <a href="${escapeHtml(source.link)}" target="_blank" class="source-link">
            Read more →
        </a>
    `;
    
    return sourceEl;
}

/**
 * Show loading state
 * @param {string} message - Loading message
 */
function showLoadingState(message = 'Searching...') {
    const loadingDiv = document.getElementById('search-loading');
    if (loadingDiv) {
        loadingDiv.textContent = message;
        loadingDiv.style.display = 'block';
    }
}

/**
 * Hide loading state
 */
function hideLoadingState() {
    const loadingDiv = document.getElementById('search-loading');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
}

/**
 * Show blog searching indicator
 * @param {string} message - Search message
 */
function showBlogSearching(message) {
    const searchingDiv = document.getElementById('blog-searching');
    if (searchingDiv) {
        searchingDiv.innerHTML = `
            <div class="searching-content">
                <span class="searching-spinner"></span>
                <span class="searching-text">${escapeHtml(message)}</span>
            </div>
        `;
        searchingDiv.style.display = 'block';
    }
}

/**
 * Hide blog searching indicator
 */
function hideBlogSearching() {
    const searchingDiv = document.getElementById('blog-searching');
    if (searchingDiv) {
        searchingDiv.style.display = 'none';
    }
}

/**
 * Show update notification
 * @param {string} message - Notification message
 */
function showUpdateNotification(message) {
    const notificationDiv = document.getElementById('update-notification');
    if (notificationDiv) {
        notificationDiv.textContent = message;
        notificationDiv.style.display = 'block';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            notificationDiv.style.display = 'none';
        }, 3000);
    }
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
    const errorDiv = document.getElementById('search-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

/**
 * Clear all results and messages
 */
function clearResults() {
    const resultsContainer = document.getElementById('search-results');
    const errorDiv = document.getElementById('search-error');
    const notificationDiv = document.getElementById('update-notification');
    
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (errorDiv) errorDiv.style.display = 'none';
    if (notificationDiv) notificationDiv.style.display = 'none';
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string}
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    
    if (searchForm) {
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const query = searchInput ? searchInput.value : '';
            searchBlogProgressive(query);
        });
    }
    
    if (searchButton) {
        searchButton.addEventListener('click', function(e) {
            e.preventDefault();
            const query = searchInput ? searchInput.value : '';
            searchBlogProgressive(query);
        });
    }
    
    // Enter key support
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchBlogProgressive(this.value);
            }
        });
    }
});


// ============================================================================
// REQUIRED HTML STRUCTURE
// ============================================================================
/*

Add this HTML to your search page:

<div class="search-container">
    <form id="search-form">
        <input 
            type="text" 
            id="search-input" 
            placeholder="Ask anything about AI document automation..."
            autocomplete="off"
        />
        <button type="submit" id="search-button">Search</button>
    </form>
    
    <!-- Loading indicator -->
    <div id="search-loading" style="display: none;"></div>
    
    <!-- Error message -->
    <div id="search-error" class="error-message" style="display: none;"></div>
    
    <!-- Blog searching indicator -->
    <div id="blog-searching" class="blog-searching" style="display: none;"></div>
    
    <!-- Update notification -->
    <div id="update-notification" class="update-notification" style="display: none;"></div>
    
    <!-- Results container -->
    <div id="search-results" style="display: none;">
        <div id="search-answer" class="search-answer"></div>
        <div id="search-sources" class="search-sources"></div>
    </div>
</div>

*/

// ============================================================================
// REQUIRED CSS STYLES
// ============================================================================
/*

Add this CSS to your stylesheet:

.search-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

#search-form {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
}

#search-input {
    flex: 1;
    padding: 12px;
    font-size: 16px;
    border: 2px solid #0F172A;
    border-radius: 8px;
}

#search-button {
    padding: 12px 24px;
    background: linear-gradient(135deg, #D4AF37, #B8941F);
    color: #0F172A;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
}

#search-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(212, 175, 55, 0.3);
}

#search-loading {
    text-align: center;
    padding: 20px;
    color: #666;
    font-style: italic;
}

.error-message {
    background: #fee;
    color: #c00;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 20px;
}

.blog-searching {
    background: #EEF2FF;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 20px;
    border-left: 4px solid #D4AF37;
}

.searching-content {
    display: flex;
    align-items: center;
    gap: 10px;
}

.searching-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #D4AF37;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.update-notification {
    background: #D4AF37;
    color: #0F172A;
    padding: 12px 20px;
    border-radius: 8px;
    text-align: center;
    font-weight: 600;
    margin-bottom: 20px;
    animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}

#search-results {
    margin-top: 30px;
}

#search-results.updating {
    animation: pulse 0.5s ease-in-out;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
}

.search-answer {
    background: #F8F9FA;
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 30px;
    line-height: 1.6;
}

.sources-header {
    color: #0F172A;
    margin-top: 20px;
    margin-bottom: 15px;
    font-size: 18px;
}

.search-sources {
    display: grid;
    gap: 15px;
}

.source {
    background: white;
    border: 1px solid #E5E7EB;
    border-radius: 8px;
    padding: 20px;
    transition: all 0.3s ease;
}

.source:hover {
    border-color: #D4AF37;
    box-shadow: 0 4px 12px rgba(212, 175, 55, 0.1);
}

.source-new {
    animation: highlight 2s ease-out;
    border-color: #D4AF37;
}

@keyframes highlight {
    0% { background: #FFF9E6; }
    100% { background: white; }
}

.source-header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    margin-bottom: 10px;
}

.source-title {
    color: #0F172A;
    margin: 0;
    font-size: 16px;
    flex: 1;
}

.source-badge {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
}

.source-badge-website {
    background: #EEF2FF;
    color: #0F172A;
}

.source-badge-blog {
    background: #FFF9E6;
    color: #B8941F;
}

.source-excerpt {
    color: #4B5563;
    line-height: 1.5;
    margin-bottom: 15px;
}

.source-link {
    color: #D4AF37;
    text-decoration: none;
    font-weight: 600;
}

.source-link:hover {
    text-decoration: underline;
}

*/