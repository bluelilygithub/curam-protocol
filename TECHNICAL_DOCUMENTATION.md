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
main.py                 # Single-file Flask application
├── Configuration       # API keys, department settings, field mappings
├── HTML Template       # Embedded Jinja2 template
├── Helper Functions    # PDF extraction, currency formatting, prompt building
├── AI Integration      # Gemini API calls with retry/fallback logic
└── Routes              # Index (main), export_csv, view_sample
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
| `GEMINI_API_KEY` | Yes | Google Gemini API key from AI Studio |
| `SECRET_KEY` | No | Flask session secret (defaults to dev key) |

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

2. **Async Processing:**
   - Queue system for PDF processing
   - WebSocket for real-time progress updates
   - Background job processing

3. **Caching:**
   - Cache extracted text for repeated documents
   - Cache model responses for identical inputs
   - Redis for session storage

4. **Monitoring:**
   - Application performance monitoring (APM)
   - Error tracking (Sentry)
   - Usage analytics
   - Cost tracking per user/department

5. **Database Integration:**
   - Store extraction history
   - User management
   - Document metadata
   - Audit trails

## Conclusion

This application demonstrates a practical use of AI for document automation in a professional services context. The key technical lessons center on:

1. **Resilience:** Build for failure (quota exhaustion, timeouts, model unavailability)
2. **Transparency:** Users need visibility into system behavior
3. **Flexibility:** Don't hardcode assumptions (model names, quotas, timeouts)
4. **User Experience:** Error messages should be actionable, not technical

The single-file architecture served well for rapid development and demo purposes, but production deployment would benefit from modularization, proper testing, and enhanced monitoring.

