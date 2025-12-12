// RAG Search Demo - Simulated search functionality
// In production, this would query a real vector database and LLM

// Sample knowledge base (simulating RAG retrieval)
const knowledgeBase = [
    {
        question: ["phase 1", "guarantee", "refund", "feasibility sprint"],
        answer: "Phase 1 is the Feasibility Sprint, a 48-hour test costing <strong>$1,500</strong> with a <strong>90%+ accuracy guarantee</strong>. If we cannot extract your target data with >90% accuracy from your sample set (minimum 10 documents), you receive a <strong>full $1,500 refund</strong> within 5 business days. We pride ourselves on transparency: 43 of our last 47 Feasibility Sprints passed. The 4 failures were due to poor source material (e.g., 100% handwritten forms) and all received full refunds.",
        sources: [
            { title: "Phase 1 Feasibility Sprint", url: "phase-1-feasibility.html" },
            { title: "Homepage FAQ", url: "homepage.html#faq" }
        ]
    },
    {
        question: ["hallucinations", "prevent", "accuracy", "validation"],
        answer: "We use a <strong>three-layer validation system</strong> targeting 99%+ production accuracy: <br><br>1. <strong>Grounding:</strong> The AI only extracts data from your documents—it is incapable of generating or guessing information from the internet.<br>2. <strong>Confidence Scoring:</strong> If the AI scores <90% confident on any item, it flags the record for human review through a simple approval queue.<br>3. <strong>ERP Cross-Checks:</strong> We validate extracted data against your existing vendor master lists, project codes, and approval thresholds for hard-coded correctness.",
        sources: [
            { title: "Homepage FAQ - Accuracy", url: "homepage.html#faq" },
            { title: "How It Works", url: "how-it-works.html" }
        ]
    },
    {
        question: ["industries", "sectors", "markets", "target"],
        answer: "We serve three primary industry sectors:<br><br>• <strong>Built Environment:</strong> Civil Engineering, Construction, Architecture, Mining Services, Property Management<br>• <strong>Professional Services:</strong> Accounting & Advisory, Legal Services, Wealth Management, Insurance Underwriting<br>• <strong>Logistics & Compliance:</strong> Logistics & Freight, Healthcare Admin, Government Contractors<br><br>Each industry has specific document types and compliance requirements that our Protocol addresses.",
        sources: [
            { title: "Target Markets", url: "target-markets.html" },
            { title: "Professional Services", url: "professional-services.html" },
            { title: "Built Environment", url: "built-environment.html" }
        ]
    },
    {
        question: ["phase 2", "roadmap", "readiness", "strategy"],
        answer: "Phase 2 is <strong>The Readiness Roadmap</strong>, a 3-week engagement costing <strong>$7,500</strong> (fixed fee). Deliverables include:<br><br>• Board-ready business case with ROI projections<br>• Workflow analysis & stakeholder interviews<br>• Security audit (Azure/AWS/Private infrastructure)<br>• Phased implementation plan (Wave 1 & Wave 2)<br>• Risk register and governance framework<br><br>You receive all reports regardless of whether you proceed to implementation—<strong>no obligation to continue</strong>.",
        sources: [
            { title: "Phase 2 Roadmap", url: "phase-2-roadmap.html" },
            { title: "The Protocol", url: "curam-ai-protocol.html" }
        ]
    },
    {
        question: ["phase 3", "compliance", "iso", "audit"],
        answer: "Phase 3 is <strong>The Compliance Shield</strong>, a 2-week audit support engagement costing <strong>$8,000–$12,000</strong> (custom scope). Deliverables include:<br><br>• Risk assessment & mitigation matrix<br>• Shadow IT inventory & retirement plan<br>• Pre-filled ISO 27001 documentation<br>• Governance framework & remediation roadmap<br>• Audit-ready documentation for PI insurance reviews<br><br>This prepares your auditor—we don't replace them, we accelerate their review.",
        sources: [
            { title: "Phase 3 Compliance Shield", url: "phase-3-compliance.html" },
            { title: "Risk Audit Report", url: "risk-audit-report.html" }
        ]
    },
    {
        question: ["phase 4", "implementation", "deployment", "wave"],
        answer: "Phase 4 is <strong>Implementation</strong>, typically delivered in <strong>two waves</strong> over 6–8 weeks, costing <strong>$20,000–$30,000</strong> per wave. Includes:<br><br><strong>Wave 1 (Foundation):</strong><br>• Live workflows in your tenant<br>• Core automation (70% of volume)<br>• Team training & handover<br>• Performance dashboard<br><br><strong>Wave 2 (Expansion):</strong><br>• Advanced workflows & edge cases<br>• Additional document types<br>• Integration with downstream systems<br><br>Comes with a <strong>95% accuracy SLA</strong> and 15% held until targets met.",
        sources: [
            { title: "Phase 4 Implementation", url: "phase-4-implementation.html" },
            { title: "The Protocol", url: "curam-ai-protocol.html" }
        ]
    },
    {
        question: ["cost", "price", "pricing", "investment"],
        answer: "The Protocol is structured in fixed-price phases:<br><br>• <strong>Phase 1:</strong> $1,500 (48-hour Feasibility Sprint with 90% guarantee)<br>• <strong>Phase 2:</strong> $7,500 (3-week Readiness Roadmap)<br>• <strong>Phase 3:</strong> $8,000–$12,000 (2-week Compliance Shield)<br>• <strong>Phase 4:</strong> $20,000–$30,000 per wave (Implementation)<br><br>You can exit at any phase with valuable deliverables—never sunk-cost regret. Total typical investment for full deployment: <strong>$35,000–$50,000</strong>.",
        sources: [
            { title: "The Protocol", url: "curam-ai-protocol.html" },
            { title: "Homepage", url: "homepage.html#protocol" }
        ]
    },
    {
        question: ["ownership", "ip", "vendor lock", "source code"],
        answer: "You own everything. We provide:<br><br>• Full source code & documentation<br>• Video walkthroughs of maintenance tasks<br>• Complete IP transfer at project completion<br>• <strong>No ongoing licensing fees</strong><br>• No vendor lock-in—you can maintain it yourself or re-engage us<br><br>Routine maintenance (adding vendors, adjusting rules, managing permissions) can be handled by any IT admin familiar with M365. No coding required.",
        sources: [
            { title: "Homepage FAQ", url: "homepage.html#faq" },
            { title: "About", url: "about.html" }
        ]
    },
    {
        question: ["technologies", "tech stack", "platform", "models"],
        answer: "We use multiple AI models and platforms based on your requirements:<br><br><strong>AI Models:</strong><br>• OpenAI GPT-4 / GPT-4 Turbo<br>• Anthropic Claude 3.5 Sonnet<br>• Google Gemini 1.5 Pro<br>• Azure Document Intelligence<br>• Custom fine-tuned models<br><br><strong>Platforms:</strong><br>• Microsoft Power Platform<br>• Azure AI Services<br>• Custom API development<br>• MCP (Model Context Protocol) for agentic AI<br><br>Your deployment uses the optimal combination for your document types and compliance requirements.",
        sources: [
            { title: "Services - Technologies", url: "services.html" },
            { title: "How It Works", url: "how-it-works.html" }
        ]
    },
    {
        question: ["roi", "savings", "return", "payback"],
        answer: "ROI varies by firm size and document volume, but typical results show:<br><br>• <strong>70+ hours/week</strong> recovered from manual data entry<br>• <strong>$500,000–$750,000</strong> annual revenue leakage reduced<br>• <strong>3–6 month payback period</strong> on full implementation<br>• <strong>40–70% reduction</strong> in document processing time<br><br>Phase 1 includes a detailed ROI calculation specific to YOUR documents and workflows. Use our ROI Calculator for an instant estimate.",
        sources: [
            { title: "ROI Calculator", url: "roi.html" },
            { title: "Feasibility Sprint Report", url: "feasibility-sprint-report.html" }
        ]
    }
];

// DOM Elements
const searchInput = document.getElementById('rag-search-input');
const searchBtn = document.getElementById('search-btn');
const searchLoading = document.getElementById('search-loading');
const searchResults = document.getElementById('search-results');
const emptyState = document.getElementById('empty-state');
const exampleBtns = document.querySelectorAll('.example-question-btn');

// Event Listeners
if (searchBtn) {
    searchBtn.addEventListener('click', performSearch);
}

if (searchInput) {
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
}

exampleBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        const question = this.getAttribute('data-question');
        searchInput.value = question;
        performSearch();
    });
});

// Check if query is relevant to the domain
function isRelevantQuery(query) {
    const irrelevantKeywords = [
        'recipe', 'cooking', 'weather', 'sports', 'celebrity', 'movie', 'game',
        'restaurant', 'hotel', 'travel', 'vacation', 'music', 'fashion', 'car',
        'bitcoin', 'crypto', 'stock', 'forex', 'dating', 'pets', 'gardening',
        'mars', 'venus', 'planet', 'space', 'relationship', 'love', 'marriage',
        'book', 'novel', 'fiction', 'poem', 'song', 'album', 'tv show', 'netflix'
    ];
    
    const relevantKeywords = [
        'ai', 'automation', 'document', 'protocol', 'phase', 'roi', 'engineering',
        'accounting', 'legal', 'compliance', 'workflow', 'extraction', 'rag',
        'implementation', 'feasibility', 'audit', 'guarantee', 'pricing', 'cost',
        'invoice', 'contract', 'tender', 'data', 'extract', 'search', 'intelligence',
        'curam', 'gemini', 'python', 'api', 'pdf', 'ocr', 'azure', 'cloud'
    ];
    
    const queryLower = query.toLowerCase();
    
    // Remove common stop words for better analysis
    const stopWords = ['what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'how', 'why', 'when', 'where', 'who'];
    const queryWords = queryLower.split(/\s+/).filter(word => !stopWords.includes(word) && word.length > 2);
    
    // Check for obviously irrelevant queries
    const hasIrrelevant = irrelevantKeywords.some(keyword => queryLower.includes(keyword));
    const hasRelevant = relevantKeywords.some(keyword => queryWords.includes(keyword) || queryLower.includes(keyword));
    
    // If it has irrelevant keywords, mark as irrelevant
    if (hasIrrelevant) {
        return false;
    }
    
    // If it has no relevant keywords and is more than 3 words, likely irrelevant
    if (!hasRelevant && queryWords.length > 2) {
        return false;
    }
    
    return true;
}

// Search Function
async function performSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
        return;
    }

    // Check if query is relevant
    if (!isRelevantQuery(query)) {
        displayIrrelevantMessage(query);
        return;
    }

    // Show loading state
    emptyState.style.display = 'none';
    searchResults.style.display = 'none';
    searchLoading.style.display = 'flex';

    try {
        // Search both knowledge base and WordPress blog
        const [kbResults, wpResults] = await Promise.all([
            searchKnowledgeBase(query),
            searchWordPressBlog(query)
        ]);

        // Combine and display results
        const combinedResults = [...kbResults, ...wpResults];
        displayResults(combinedResults, query);
    } catch (error) {
        console.error('Search error:', error);
        displayResults([], query);
    } finally {
        searchLoading.style.display = 'none';
    }
}

// Search Knowledge Base (existing logic)
function searchKnowledgeBase(query) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const results = findRelevantAnswers(query);
            resolve(results);
        }, 500);
    });
}

// Search WordPress Blog
async function searchWordPressBlog(query) {
    try {
        // WordPress REST API search endpoint
        const wpApiUrl = `https://curam-ai.com.au/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=5&_embed`;
        
        const response = await fetch(wpApiUrl);
        
        if (!response.ok) {
            console.warn('WordPress API not available');
            return [];
        }
        
        const posts = await response.json();
        
        // Transform WordPress posts into our result format
        return posts.map(post => {
            // Extract excerpt (strip HTML tags)
            const excerpt = post.excerpt.rendered.replace(/<[^>]*>/g, '').trim();
            const content = post.content.rendered.replace(/<[^>]*>/g, '').substring(0, 300) + '...';
            
            return {
                answer: excerpt || content,
                sources: [
                    {
                        title: post.title.rendered,
                        url: post.link
                    }
                ],
                score: 5, // WordPress results get a baseline score
                type: 'blog',
                date: new Date(post.date).toLocaleDateString('en-AU', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                })
            };
        });
    } catch (error) {
        console.error('WordPress search error:', error);
        return [];
    }
}

// Find relevant answers using keyword matching (simulating semantic search)
function findRelevantAnswers(query) {
    const queryLower = query.toLowerCase();
    
    // Remove stop words for better matching
    const stopWords = ['what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'how', 'why', 'when', 'where', 'who'];
    const queryWords = queryLower.split(/\s+/).filter(word => !stopWords.includes(word) && word.length > 2);
    
    // If no meaningful words after filtering, return empty
    if (queryWords.length === 0) {
        return [];
    }
    
    const scoredResults = knowledgeBase.map(item => {
        let score = 0;
        
        // Check if query words match the question keywords
        item.question.forEach(keyword => {
            queryWords.forEach(word => {
                // Exact match
                if (keyword === word) {
                    score += 20;
                }
                // Partial match
                else if (keyword.includes(word) && word.length > 3) {
                    score += 10;
                }
                else if (word.includes(keyword) && keyword.length > 3) {
                    score += 5;
                }
            });
        });
        
        // Bonus for exact phrase match in keywords
        item.question.forEach(keyword => {
            if (queryLower.includes(keyword) && keyword.length > 4) {
                score += 15;
            }
        });
        
        return { ...item, score };
    });

    // Sort by score and return top 3, but only if score is meaningful
    const MINIMUM_SCORE = 15; // Require at least one good match
    
    const results = scoredResults
        .filter(item => item.score >= MINIMUM_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    
    return results;
}

// Display irrelevant query message
function displayIrrelevantMessage(query) {
    searchResults.innerHTML = '';
    searchResults.style.display = 'block';
    
    searchResults.innerHTML = `
        <div class="irrelevant-query-message">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h3>Query Outside Search Domain</h3>
            <p>Your search "<strong>${query}</strong>" doesn't appear to be related to AI automation, document intelligence, or the Curam-Ai Protocol.</p>
            <p style="margin-top: var(--spacing-md); color: var(--text-secondary);">
                This search tool is designed to answer questions about:
            </p>
            <ul style="text-align: left; max-width: 500px; margin: var(--spacing-md) auto; color: var(--text-secondary);">
                <li>The Curam-Ai Protocol and its phases</li>
                <li>Document intelligence and extraction</li>
                <li>AI-powered workflow automation</li>
                <li>Industries we serve (Engineering, Accounting, Legal, etc.)</li>
                <li>Pricing, guarantees, and ROI</li>
            </ul>
            <button onclick="document.getElementById('rag-search-input').value=''; document.getElementById('rag-search-input').focus();" class="btn btn-primary" style="margin-top: var(--spacing-lg);">
                Try a Different Search
            </button>
        </div>
    `;
}

// Display search results
function displayResults(results, query) {
    searchResults.innerHTML = '';

    if (results.length === 0) {
        searchResults.style.display = 'block';
        searchResults.innerHTML = `
            <div class="no-results">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="M21 21l-4.35-4.35"/>
                </svg>
                <h3>No results found</h3>
                <p>Try rephrasing your question or use one of the example queries above.</p>
            </div>
        `;
        return;
    }

    // Sort results by score
    results.sort((a, b) => b.score - a.score);

    // Display results
    results.forEach((result, index) => {
        const resultCard = document.createElement('div');
        resultCard.className = 'search-result-card';
        resultCard.style.animationDelay = `${index * 0.1}s`;
        
        // Determine result type badge
        const resultType = result.type === 'blog' ? 'Blog Post' : 'Protocol Documentation';
        const badgeClass = result.type === 'blog' ? 'result-badge-blog' : 'result-badge';
        
        // Build sources HTML
        const sourcesHTML = result.sources.map(source => 
            `<a href="${source.url}" class="source-link" target="_blank">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                ${source.title}
            </a>`
        ).join('');

        // Date badge for blog posts
        const dateBadge = result.date ? `<span class="result-date">${result.date}</span>` : '';
        
        // Calculate relevance percentage (normalize score to 0-100%)
        // Score ranges from ~15 (minimum) to ~100+ (very high)
        const maxExpectedScore = 100;
        const relevancePercent = Math.min(100, Math.round((result.score / maxExpectedScore) * 100));
        
        // Determine relevance label
        let relevanceLabel = 'Low Relevance';
        let relevanceColor = '#f59e0b'; // amber
        if (relevancePercent >= 70) {
            relevanceLabel = 'High Relevance';
            relevanceColor = '#22c55e'; // green
        } else if (relevancePercent >= 40) {
            relevanceLabel = 'Medium Relevance';
            relevanceColor = '#3b82f6'; // blue
        }

        resultCard.innerHTML = `
            <div class="result-header">
                <div style="display: flex; align-items: center; gap: var(--spacing-sm);">
                    <span class="${badgeClass}">${resultType}</span>
                    ${dateBadge}
                </div>
                <span class="confidence-score" style="color: ${relevanceColor};" title="Based on keyword matching score: ${result.score}">${relevanceLabel}</span>
            </div>
            <div class="result-content">
                <p>${result.answer}</p>
            </div>
            <div class="result-sources">
                <div class="sources-label">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    Sources:
                </div>
                <div class="sources-list">
                    ${sourcesHTML}
                </div>
            </div>
        `;

        searchResults.appendChild(resultCard);
    });

    searchResults.style.display = 'block';
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Show empty state by default
    if (emptyState) {
        emptyState.style.display = 'flex';
    }
});

