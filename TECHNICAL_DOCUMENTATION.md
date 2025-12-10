# Technical Documentation: AI Document Extraction Platform

## Architecture Overview

### Technology Stack

- **Backend Framework:** Flask (Python)
- **AI/ML:** Google Generative AI (Gemini API)
- **PDF Processing:** pdfplumber
- **Data Processing:** pandas
- **Deployment:** Gunicorn (WSGI server)
- **Frontend:** Server-side rendered HTML with vanilla JavaScript

### Application Structure

```
main.py                 # Flask application (multi-purpose)
├── Configuration       # API keys, department settings, field mappings
├── HTML Templates      # Multiple HTML pages served via send_file
├── Helper Functions    # PDF extraction, currency formatting, prompt building
├── AI Integration      # Gemini API calls with retry/fallback logic
├── Routes              # Marketing pages, automater, APIs
│   ├── Marketing Pages # homepage, about, services, industry pages, etc.
│   ├── Automater       # Document extraction tool (/automater)
│   ├── ROI Calculator  # Embedded via iframe (/roi.html)
│   ├── RAG Search API  # /api/search-blog
│   └── Contact APIs    # /api/contact-assistant, /api/contact
└── Static Assets       # CSS, JS, images, videos served via Flask

roi_calculator_flask.py # Flask ROI calculator (blueprint)
├── Industry Config     # Industry-specific questions and calculations
├── Calculation Logic  # ROI calculations based on user inputs
└── PDF Generation      # Business case PDF report generation

assets/
├── css/styles.css      # Main stylesheet (dark theme)
├── js/
│   ├── main.js         # Search, FAQ accordion, smooth scroll
│   ├── navbar-loader.js # Dynamic navbar loading
│   ├── scripts.js       # Mobile menu, scroll effects
│   ├── hero_rotation.js # Hero background rotation
│   └── hero-text-rotation.js # Hero text rotation
└── includes/navbar.html # Reusable navigation component
```

## Setup Instructions

### Prerequisites

- Python 3.8+
- Google Cloud account with Gemini API access
- Gemini API key

### Installation

1. **Clone/Download the application**
   ```bash
   cd Fsace-Invoices
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set environment variables**
   ```bash
   export GEMINI_API_KEY="your-api-key-here"
   export SECRET_KEY="your-secret-key-for-sessions"  # Optional, defaults to dev key
   ```

4. **Prepare sample PDFs**
   - Create `invoices/` directory with sample invoice PDFs
   - Create `drawings/` directory with sample schedule/drawing PDFs
   - Update `DEPARTMENT_SAMPLES` in `main.py` to match your file paths

5. **Run the application**
   ```bash
   # Development
   python main.py
   
   # Production (with Gunicorn)
   gunicorn -w 4 -t 120 main:app
   ```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key from AI Studio (required for automater, RAG search, contact assistant) |
| `SECRET_KEY` | No | Flask session secret (defaults to dev key) |
| `PORT` | No | Server port (automatically set by Railway) |

## Technical Implementation Details

### PDF Text Extraction

**Library:** `pdfplumber`

```python
def extract_text(file_obj):
    # Opens PDF and extracts text from all pages
    # Returns concatenated text string
    # Handles errors gracefully
```

**Limitations:**
- Requires text-based PDFs (scanned PDFs need OCR preprocessing)
- Complex layouts may require prompt truncation (see Engineering workflow)

### AI Model Selection & Fallback

**Strategy:** Tiered fallback system prioritizing high-capacity models

**Model Priority Order:**
1. `gemini-2.5-flash-lite` (highest RPM capacity: 30,000 RPM)
2. `gemini-2.5-pro` (highest quality, complex reasoning)
3. `gemini-2.5-flash` (high speed, cost-effective)
4. `gemini-pro-latest` (legacy stable, separate quota bucket)

**Fallback Logic:**
- Queries `genai.list_models()` to get available models
- Filters for preferred models in priority order
- Falls back to preview variants if GA models unavailable
- Falls back to legacy `gemini-1.5-*` models if needed
- Falls back to any available model as last resort

### Error Handling & Resilience

#### Exponential Backoff Retry
- **Attempts:** 3 per model
- **Backoff:** 1s, 2s, 4s (2^attempt seconds)
- **Applies to:** Timeout errors, network errors, transient API failures

#### Error Types Handled
1. **ResourceExhausted (429):** Quota exceeded → Try next model
2. **DeadlineExceeded (504):** Request timeout → Retry with backoff
3. **NotFound (404):** Model not available → Try next model
4. **JSONDecodeError:** Malformed AI response → Log and retry
5. **Empty Response:** No content returned → Retry

#### Prompt Optimization
- **Engineering/Transmittal workflows:** Truncate prompts to 6,000 chars (reduced to 3,200 on timeout)
- **Finance workflow:** No truncation (invoices are typically short)
- **Rationale:** Prevents timeout errors on large PDFs while maintaining extraction quality

### Department-Specific Prompts

Each department has a tailored prompt that:
- Defines expected output fields
- Provides context about document type
- Specifies JSON output format
- Includes examples where helpful

**Example (Finance):**
```python
Extract from this invoice PDF:
- Vendor name
- Invoice date
- Invoice number
- Total amount
- Summary/description

Return as JSON array...
```

### Session Management

- Uses Flask `session` to store last extraction results
- Enables CSV export without re-processing
- Session key: `last_results` containing `{"department": str, "rows": list}`

### CSV Export

- Department-specific column selection
- Currency formatting for finance reports
- In-memory generation (no file system writes)
- Proper CSV headers and MIME type

## New Features

### RAG Search System

**Endpoint:** `POST /api/search-blog`

**Purpose:** Provides AI-powered search that queries blog content from www.curam-ai.com.au and generates contextual answers.

**Implementation:**
1. **WordPress API Integration:**
   - Fetches posts from WordPress REST API (`/wp-json/wp/v2/posts`)
   - Uses search parameter for keyword matching
   - Falls back to recent posts if search returns no results
   - Ranks posts by relevance (title matches > excerpt matches > content matches)

2. **Static HTML Page Search:**
   - Searches local HTML pages for additional context
   - Extracts text content from HTML files
   - Ranks by keyword frequency and relevance

3. **AI Answer Generation:**
   - Uses Gemini AI to generate contextual answers from retrieved content
   - Includes source citations (blog posts and HTML pages)
   - Handles HTML formatting and cleaning

4. **Error Handling:**
   - Gracefully handles WordPress API failures
   - Falls back to static HTML search if WordPress unavailable
   - Returns helpful error messages if no content found

**Usage:**
- Frontend JavaScript sends POST request with `query` parameter
- Response includes `answer` (HTML formatted) and `sources` (array of citations)
- Used by search functionality on homepage and search-results page

### Contact Assistant (AI Chat)

**Endpoint:** `POST /api/contact-assistant`

**Purpose:** AI-powered contact assistant that helps users understand their needs and guides them through the contact process.

**Implementation:**
1. **Conversation Management:**
   - Maintains conversation history (last 10 exchanges)
   - Uses Gemini 2.0 Flash Exp model for responses
   - Formats responses as HTML for better readability

2. **System Prompt:**
   - Defines assistant role and capabilities
   - Includes pricing and service information
   - Instructs to ask clarifying questions
   - Guides users toward appropriate next steps

3. **Response Formatting:**
   - Converts plain text to HTML paragraphs if needed
   - Removes markdown code blocks
   - Ensures proper HTML structure
   - Handles malformed HTML gracefully

4. **Additional Endpoints:**
   - `/api/check-message-relevance`: Checks if message is relevant
   - `/api/email-chat-log`: Emails conversation log

**Usage:**
- Frontend JavaScript maintains conversation state
- Sends messages with conversation history
- Displays HTML-formatted responses in chat interface
- Used by contact page for user guidance

### Dynamic Navigation System

**Implementation:**
- Navbar loaded dynamically from `assets/includes/navbar.html`
- JavaScript (`assets/js/navbar-loader.js`) handles:
  - Fetching navbar HTML
  - Setting active states based on current page
  - Dispatching events for other scripts
- Supports dropdown menus for "Target Markets" and "Resources"
- Mobile-responsive hamburger menu

**Benefits:**
- Single source of truth for navigation
- Consistent navigation across all pages
- Easy to update navigation structure
- Active state highlighting

### Industry-Specific Pages

**Pages:**
- `/accounting`: Australian accounting firms (15-100 staff)
- `/professional-services`: Legal, Accounting, Wealth Management, Insurance
- `/logistics-compliance`: Logistics, Healthcare, NDIS/Defence Contractors
- `/built-environment`: Engineering, Architecture, Construction, Mining

**Features:**
- Industry-specific content and use cases
- ROI calculations tailored to each industry
- Pain points and solutions specific to sector
- Links to ROI calculator with industry pre-selection

### ROI Calculator Integration

**Routes:**
- `/roi.html`: Embedded page with iframe to Flask calculator
- `/roi-calculator/`: Direct Flask blueprint access

**URL Parameters:**
- `?industry=<name>`: Pre-selects industry in calculator
- `?section=<name>`: Shows industry group selector

**Implementation:**
- JavaScript in `roi.html` reads URL parameters
- Updates iframe `src` to include industry parameter
- Supports industry group selection (professional-services, built-environment, logistics-compliance)

## Critical Lessons Learned

### 1. Model Availability & Quota Management

**Problem:** Initial implementation targeted `gemini-1.5-pro/flash`, which were deprecated/retired during development.

**Solution:**
- Implemented dynamic model discovery via `genai.list_models()`
- Built tiered fallback system prioritizing GA models
- Added model selection logging to UI for transparency

**Lesson:** Never hardcode model names. Always query available models and implement fallback chains.

### 2. Quota Exhaustion Handling

**Problem:** Free tier quotas exhausted quickly, causing all requests to fail with `ResourceExhausted (429)`.

**Solution:**
- Prioritize high-capacity models (`gemini-2.5-flash-lite` with 30,000 RPM)
- Implement exponential backoff to avoid quota hammering
- Build intelligent fallback to models with separate quota buckets
- Add comprehensive error logging to action log

**Lesson:** Production apps must handle quota exhaustion gracefully. Implement:
- Model fallback chains
- Exponential backoff
- Quota monitoring/alerting
- User-facing error messages

### 3. Timeout Management

**Problem:** Large PDFs (engineering schedules) caused `DeadlineExceeded (504)` errors.

**Solution:**
- Added `request_options={"timeout": 10}` to API calls (later increased to 60s)
- Implemented prompt truncation for large documents
- Added retry logic with exponential backoff
- Shortened prompts on timeout (engineering: 6,000 → 3,200 chars)

**Lesson:** Set appropriate timeouts and implement prompt optimization for large inputs. Monitor timeout rates and adjust accordingly.

### 4. UI State Management

**Problem:** Department toggle visibility broke, showing all sections simultaneously.

**Solution:**
- Added default `display: none` CSS for sections
- Wrapped JavaScript in `DOMContentLoaded` event
- Ensured initial visibility set on page load

**Lesson:** Always set initial CSS state, don't rely solely on JavaScript for initial rendering.

### 5. Single-File Architecture Trade-offs

**Decision:** Entire application in single `main.py` file (~1,000 lines).

**Pros:**
- Easy deployment (one file to copy)
- No import path issues
- Simple for demos

**Cons:**
- Harder to maintain at scale
- No separation of concerns
- Difficult to test individual components

**Lesson:** Single-file works for demos/MVPs, but refactor to modular structure before production scaling.

### 6. Error Visibility

**Problem:** Users couldn't see why requests failed or which models were tried.

**Solution:**
- Added comprehensive "Action log" showing:
  - Model selection logic
  - Each attempt with model name
  - Retry delays (exponential backoff)
  - Success/failure per file
- Removed redundant "Model attempts" block
- Added per-file processing status

**Lesson:** Users need visibility into system behavior, especially when things fail. Logging should be user-facing, not just developer-facing.

### 7. PDF Validation

**Problem:** Users could upload non-PDF files, causing errors.

**Solution:**
- Added client-side `accept=".pdf"` attribute
- Added server-side validation checking file extension
- Clear error message: "Only PDF files are accepted"

**Lesson:** Validate inputs at both client and server side. Provide clear, actionable error messages.

## Deployment Considerations

### Production Checklist

- [ ] Set `SECRET_KEY` environment variable (don't use dev key)
- [ ] Configure Gunicorn workers (4 workers recommended)
- [ ] Set appropriate timeout (120s for Gunicorn, 60s for Gemini API)
- [ ] Enable HTTPS (required for production)
- [ ] Set up error monitoring/logging
- [ ] Configure quota alerts for Gemini API
- [ ] Set up backup for session data (if using persistent sessions)

### Gunicorn Configuration

```bash
gunicorn -w 4 -t 120 --bind 0.0.0.0:5000 main:app
```

**Parameters:**
- `-w 4`: 4 worker processes
- `-t 120`: 120 second timeout (accommodates Gemini API delays)
- `--bind`: Host and port

### Scaling Considerations

**Current Limitations:**
- Single-file architecture limits horizontal scaling
- Session storage in memory (not shared across workers)
- No database for result persistence
- No queue system for async processing

**Future Improvements:**
- Move to Redis for session storage
- Add database for result history
- Implement Celery/Redis queue for async PDF processing
- Add caching layer for repeated document types
- Implement rate limiting per user/IP

## API Costs & Quota Management

### Gemini API Pricing (as of development)

- **Free Tier:** Limited RPM/RPD (varies by model)
- **Paid Tier:** Higher limits, pay-per-use pricing
- **Model Differences:**
  - `gemini-2.5-flash-lite`: Highest RPM (30,000), lowest cost
  - `gemini-2.5-pro`: Highest quality, higher cost
  - `gemini-2.5-flash`: Balanced speed/cost

### Quota Monitoring

**Recommended:**
- Monitor quota usage in Google Cloud Console
- Set up alerts for quota exhaustion
- Request quota increases before hitting limits
- Implement user-facing quota warnings

## Security Considerations

### Current Implementation

- API key stored in environment variable (not hardcoded)
- Session secret configurable (defaults to dev key)
- File upload validation (PDF only)
- Path traversal protection for sample file serving

### Recommended Enhancements

- Add authentication/authorization
- Implement rate limiting per user
- Add file size limits
- Scan uploaded files for malware
- Encrypt sensitive data in sessions
- Add audit logging

## Testing Strategy

### Current State

- Manual testing via web UI
- No automated tests
- No unit tests for helper functions

### Recommended Testing

1. **Unit Tests:**
   - PDF text extraction
   - Currency formatting
   - Prompt building
   - Model selection logic

2. **Integration Tests:**
   - End-to-end PDF processing
   - CSV export functionality
   - Error handling paths

3. **Load Testing:**
   - Concurrent user handling
   - Large PDF processing
   - Quota exhaustion scenarios

## Future Technical Improvements

1. **Modular Architecture:**
   - Separate routes, models, services
   - Dependency injection
   - Configuration management
   - Split `main.py` into multiple modules

2. **Async Processing:**
   - Queue system for PDF processing
   - WebSocket for real-time progress updates
   - Background job processing
   - Async RAG search for better performance

3. **Caching:**
   - Cache extracted text for repeated documents
   - Cache model responses for identical inputs
   - Redis for session storage
   - Cache blog post content for RAG search
   - Cache static HTML search results

4. **Monitoring:**
   - Application performance monitoring (APM)
   - Error tracking (Sentry)
   - Usage analytics
   - Cost tracking per user/department
   - RAG search query analytics
   - Contact assistant conversation analytics

5. **Database Integration:**
   - Store extraction history
   - User management
   - Document metadata
   - Audit trails
   - Search query history
   - Contact assistant conversation logs

6. **Enhanced RAG Search:**
   - Vector embeddings for semantic search
   - Better ranking algorithms
   - Multi-source citation tracking
   - Search result caching

7. **Contact Assistant Improvements:**
   - Conversation persistence
   - Better context understanding
   - Integration with CRM systems
   - Automated follow-up emails

## Conclusion

This application demonstrates a practical use of AI for document automation in a professional services context. The key technical lessons center on:

1. **Resilience:** Build for failure (quota exhaustion, timeouts, model unavailability)
2. **Transparency:** Users need visibility into system behavior
3. **Flexibility:** Don't hardcode assumptions (model names, quotas, timeouts)
4. **User Experience:** Error messages should be actionable, not technical

The single-file architecture served well for rapid development and demo purposes, but production deployment would benefit from modularization, proper testing, and enhanced monitoring.

