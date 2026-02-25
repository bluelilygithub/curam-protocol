# DiamondPlate AI Chatbot — Complete Build Specification

**Version:** 1.0
**Date:** February 2026
**Purpose:** Self-contained specification for building an AI-powered NLP chatbot as a WordPress plugin. The chatbot searches the client's website content (pages, posts, blog, PDFs) and generates natural language answers using Google Gemini AI.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Frontend: Chat Widget](#3-frontend-chat-widget)
4. [Backend: WordPress Plugin](#4-backend-wordpress-plugin)
5. [Content Indexing System](#5-content-indexing-system)
6. [Search & Retrieval Engine](#6-search--retrieval-engine)
7. [AI Answer Generation](#7-ai-answer-generation)
8. [Conversation Memory](#8-conversation-memory)
9. [Follow-Up Questions](#9-follow-up-questions)
10. [Source Attribution](#10-source-attribution)
11. [Voice Input (Speech-to-Text)](#11-voice-input-speech-to-text)
12. [Email Chat Transcript](#12-email-chat-transcript)
13. [Message Relevance Guard](#13-message-relevance-guard)
14. [Domain Filtering](#14-domain-filtering)
15. [Query Expansion & Synonyms](#15-query-expansion--synonyms)
16. [Search Logging & Analytics](#16-search-logging--analytics)
17. [Security Requirements](#17-security-requirements)
18. [Admin Settings Page](#18-admin-settings-page)
19. [API Endpoints](#19-api-endpoints)
20. [Database Schema](#20-database-schema)
21. [CSS & Visual Design](#21-css--visual-design)
22. [Error Handling](#22-error-handling)
23. [Performance Requirements](#23-performance-requirements)
24. [Testing Checklist](#24-testing-checklist)
25. [File Structure](#25-file-structure)

---

## 1. Product Overview

### What This Is
A floating chat widget that appears on every page of a WordPress website. Users click a button to open a slide-in panel where they can ask natural language questions about the business. The system searches the site's content (pages, posts, blog articles, and uploaded PDFs) and returns AI-generated answers with source links.

### Key Features
- Floating chat button (fixed position, always visible)
- Slide-in panel with chat interface (slides from right)
- Toggle between sidebar mode and full-screen mode
- Natural language Q&A powered by Google Gemini AI
- RAG (Retrieval-Augmented Generation) search across all site content
- PDF document text extraction and search
- Conversation memory (multi-turn context within session)
- AI-generated follow-up question suggestions (clickable)
- Source attribution (links back to original pages/posts)
- Voice input via Web Speech API
- Email chat transcript to user
- Spam/off-topic message filtering via AI
- Domain-aware query filtering (rejects clearly irrelevant questions)
- Search query logging for analytics
- WordPress admin settings page for configuration

### What This Is NOT
- Not a general-purpose chatbot — it only answers from the client's own content
- Not a customer support ticket system
- Not a live chat with human agents
- Does not use vector embeddings or a vector database (that is a future upgrade)

---

## 2. Architecture Overview

### Data Flow

```
User types question in chat widget
    |
    v
JavaScript sends POST to /wp-json/diamondplate-chat/v1/ask
    |
    v
WordPress plugin receives query + conversation history
    |
    v
Query Expansion: Synonym lookup from admin-managed dictionary
    |
    v
Domain Filter: Reject clearly off-topic queries (return polite message)
    |
    v
Search: Query the content index (wp_dp_chat_index table)
    |
    v
Rank: Score results by title match, heading match, content depth, recency
    |
    v
Context Assembly: Take top 5 results, extract relevant paragraphs
    |
    v
AI Generation: Send system prompt + context + conversation history to Gemini
    |
    v
Post-Processing: Convert quoted source titles to clickable links
    |
    v
Follow-Up Generation: Second Gemini call to generate 3 suggested questions
    |
    v
Return JSON: { message, sources, followup_questions }
    |
    v
JavaScript renders answer with formatted HTML, source links, follow-up buttons
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend Widget | Vanilla JavaScript (no framework dependencies) |
| Backend | WordPress plugin (PHP 8.0+) |
| Database | WordPress MySQL (custom tables via $wpdb) |
| AI Model | Google Gemini 2.0 Flash (via REST API) |
| PDF Extraction | PHP library: `smalot/pdfparser` (via Composer) |
| Speech Input | Web Speech API (browser-native, no library) |
| Email | WordPress `wp_mail()` function |

---

## 3. Frontend: Chat Widget

### 3.1 Floating Button

A circular button fixed to the right side of the viewport, vertically centred.

**Behaviour:**
- Always visible on every page (loaded via WordPress footer hook)
- Click opens the chat panel
- Subtle hover animation (scale + shadow increase)

**HTML Structure:**
```html
<button class="dp-chat-floating-btn" id="dpChatFloatingBtn" aria-label="Open AI chat assistant">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
</button>
```

**CSS Specifications:**
- `position: fixed`
- `top: 50%`; `right: 2rem`
- `transform: translateY(-50%)`
- `width: 56px`; `height: 56px`
- `border-radius: 50%`
- `z-index: 100`
- Background: gradient using brand primary colour
- Box shadow: `0 4px 16px rgba(brand-colour, 0.4)`
- Hover: scale(1.05), increased shadow, slight left shift

### 3.2 Chat Panel (Slide-In Modal)

A full-height panel that slides in from the right edge of the screen.

**Structure:**
```
Overlay (semi-transparent backdrop, blur)
  └── Panel (white, 450px max-width, full viewport height)
       ├── Header (brand colour background)
       │   ├── Title: "AI Assistant" + "AI" badge
       │   ├── Toggle Size button (sidebar ↔ full-screen)
       │   └── Close button (X)
       ├── Content Area (scrollable)
       │   ├── Intro text (one sentence explaining what the bot does)
       │   ├── Chat Window (message bubbles)
       │   │   └── Initial assistant message (greeting)
       │   ├── Input Row
       │   │   ├── Text input field
       │   │   ├── Microphone button
       │   │   └── Send button
       │   ├── Email Toggle Button ("Email this conversation")
       │   └── Email Section (hidden by default)
       │       ├── Email input field
       │       ├── Send Email button
       │       └── Status message area
```

**Behaviour:**
- Opening: Overlay fades in (opacity 0→1), panel slides from right (-100% → 0)
- Closing: Click X button, click overlay background, or press Escape key
- Body scroll is locked when panel is open (`overflow: hidden`)
- Full-screen toggle: Panel expands to 100% width/height, content centred at 800px max-width

**CSS Specifications:**

Overlay:
- `position: fixed`, full viewport
- `background: rgba(0, 0, 0, 0.5)`
- `backdrop-filter: blur(4px)`
- `z-index: 1010`
- `transition: opacity 0.3s ease, visibility 0.3s ease`

Panel:
- `position: fixed`; `top: 0`; `right: -100%` (hidden state)
- `width: 100%`; `max-width: 450px`; `height: 100vh`
- `background: #ffffff`
- `box-shadow: -4px 0 24px rgba(0, 0, 0, 0.2)`
- `z-index: 1011`
- `display: flex`; `flex-direction: column`
- `transition: right 0.3s ease-in-out`
- Active state: `right: 0`

### 3.3 Chat Messages

Two types of message bubbles:

**User messages:**
- Aligned right
- Background: brand primary colour (dark)
- Text colour: white
- Border radius: 12px 12px 0 12px

**Assistant messages:**
- Aligned left
- Background: light grey (#F8F9FA)
- Text colour: dark (#333)
- Border radius: 12px 12px 12px 0
- Left border accent: 3px solid brand accent colour

**Message rendering rules:**
- If content contains HTML tags → sanitize then render as HTML
- If content is plain text → convert to HTML:
  - Double newlines → paragraph breaks (`<p>`)
  - `**text**` → `<strong>text</strong>`
  - `*text*` → `<em>text</em>`
  - Single newlines within paragraph → `<br>`

**HTML Sanitization:**
Remove: `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<link>`, `<meta>`
Allow: `<a>` (href must start with `http://` or `https://`), `<p>`, `<br>`, `<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<h3>`, `<h4>`, `<code>`, `<button>` (only with class `chat-followup-btn`)
Allow attributes: `class`, `id`, `style`, `href` (on `<a>` only), `onclick` (on follow-up buttons only)

### 3.4 Loading State

When waiting for AI response, show inside the chat window:

```html
<div class="dp-chat-loading">
  <div class="dp-chat-loading-spinner"></div>
  <p>Searching articles...</p>
</div>
```

The spinner is a CSS-only animation (rotating circle with border-top coloured).

The Send button should also be disabled and show a small spinner during loading.

---

## 4. Backend: WordPress Plugin

### Plugin Header

```php
<?php
/**
 * Plugin Name: DiamondPlate AI Chat
 * Description: AI-powered chatbot that searches website content and answers questions using Google Gemini.
 * Version: 1.0.0
 * Author: DiamondPlate
 * Requires PHP: 8.0
 * Requires at least: 6.0
 */
```

### Plugin Activation

On activation, create custom database tables (see Section 20).

### Plugin Deactivation

On deactivation, do NOT drop tables (preserve data). Only drop on uninstall.

### Main Plugin File

The main file should be minimal (~50-80 lines). It should:
1. Define constants (`DIAMONDPLATE_CHAT_PATH`, `DIAMONDPLATE_CHAT_URL`, `DIAMONDPLATE_CHAT_VERSION`)
2. Register activation/deactivation hooks
3. Include class files from `includes/` directory
4. Initialise the plugin on `plugins_loaded` action

### Class Files (in `includes/` directory)

| File | Class | Responsibility |
|------|-------|----------------|
| `class-dp-chat-widget.php` | `DP_Chat_Widget` | Enqueue scripts/styles, render floating button and chat panel HTML in footer |
| `class-dp-chat-api.php` | `DP_Chat_API` | Register REST API endpoints, handle requests |
| `class-dp-chat-indexer.php` | `DP_Chat_Indexer` | Content indexing: extract text from pages/posts/PDFs, store in index table |
| `class-dp-chat-search.php` | `DP_Chat_Search` | Search the content index, rank results, return matches |
| `class-dp-chat-ai.php` | `DP_Chat_AI` | Communicate with Gemini API: generate answers, follow-up questions, relevance checks |
| `class-dp-chat-admin.php` | `DP_Chat_Admin` | Admin settings page, synonym management, analytics dashboard |
| `class-dp-chat-email.php` | `DP_Chat_Email` | Format and send chat transcript emails |

---

## 5. Content Indexing System

### What Gets Indexed

1. **WordPress Pages** — All published pages
2. **WordPress Posts** — All published posts (including custom post types if configured)
3. **PDF Files** — PDFs uploaded to the WordPress media library

### Index Table Structure

See Section 20 for full schema. Each indexed item stores:
- Source type (page, post, pdf)
- Source ID (WordPress post ID or attachment ID)
- Title
- URL/permalink
- Extracted headings (H1-H3, stored as JSON array)
- Full text content (stripped of HTML)
- Content excerpt (first 500 characters)
- Word count
- Last indexed timestamp
- Content hash (MD5 of content, for change detection)

### When Indexing Runs

1. **On post save/update** — Hook into `save_post` action. Re-index the specific post/page.
2. **On post delete** — Hook into `before_delete_post`. Remove from index.
3. **On media upload** — Hook into `add_attachment`. If PDF, extract text and index.
4. **Scheduled full re-index** — WP Cron job, runs daily. Re-indexes everything, detects changes via content hash.
5. **Manual re-index** — Button on admin settings page to trigger full re-index.

### Text Extraction

**From Pages/Posts:**
1. Get `post_content` from WordPress
2. Apply `the_content` filter (to process shortcodes, blocks, etc.)
3. Strip all HTML tags
4. Remove extra whitespace and normalise to single spaces
5. Extract headings (H1-H3) separately before stripping tags

**From PDFs:**
1. Use `smalot/pdfparser` PHP library (install via Composer)
2. Extract text from all pages
3. Concatenate with page breaks
4. Clean up extraction artefacts (multiple spaces, broken words)
5. Store full text in index table

**PDF Extraction Fallback:**
If `smalot/pdfparser` fails (e.g., scanned PDF with no text layer), log the failure and store an empty content field. Do NOT silently skip — set a `status` field to `extraction_failed` so the admin can see which PDFs need OCR processing.

### Content Hash for Change Detection

```php
$content_hash = md5($title . $content);
```

During re-index, compare new hash with stored hash. Skip if unchanged (saves processing time).

---

## 6. Search & Retrieval Engine

### Search Algorithm

The search uses MySQL `FULLTEXT` search combined with weighted scoring.

### Step 1: Query Preprocessing

```
Input: "What are your financial planning fees?"
    |
    v
Lowercase: "what are your financial planning fees?"
    |
    v
Remove stop words: ["financial", "planning", "fees"]
    |
    v
Synonym expansion (from admin dictionary):
  "fees" → also search "costs", "pricing", "charges"
  "financial planning" → also search "wealth management", "advice"
    |
    v
Final search terms: ["financial", "planning", "fees", "costs", "pricing", "charges", "wealth", "management", "advice"]
```

### Stop Words List

```
what, is, the, a, an, and, or, but, in, on, at, to, for, of, with, by, from, as,
are, was, were, been, be, have, has, had, do, does, did, will, would, could, should,
may, might, must, can, how, why, when, where, who, tell, me, about, explain, describe
```

### Step 2: Search Execution

Run a MySQL FULLTEXT search in NATURAL LANGUAGE MODE against the index table:

```sql
SELECT *, MATCH(title, headings_text, content) AGAINST(%s IN NATURAL LANGUAGE MODE) AS relevance
FROM wp_dp_chat_index
WHERE MATCH(title, headings_text, content) AGAINST(%s IN NATURAL LANGUAGE MODE)
AND status = 'indexed'
ORDER BY relevance DESC
LIMIT 20
```

### Step 3: Weighted Scoring

After retrieving initial results from MySQL, apply a custom scoring algorithm:

```
Score = 0

FOR EACH query keyword:
    IF keyword in title:           score += 10
    IF keyword in headings:        score += 5
    IF keyword in first 500 chars: score += 3
    IF keyword in full content:    score += 1

IF exact query phrase in title:    score += 20
IF exact query phrase in content:  score += 5

Content Depth Bonus:
    Count keyword occurrences in content
    score += min(occurrences * 2, 15)

Content Length Bonus:
    IF content > 1000 chars: score += 3
    IF content > 2000 chars: score += 5
    IF content > 5000 chars: score += 8
    IF content > 10000 chars: score += 12

Source Type Bonus:
    IF source_type = 'page':  score += 50  (pages are more authoritative)
    IF source_type = 'post':  score += 30
    IF source_type = 'pdf':   score += 40  (PDFs are often key documents)

Recency Bonus (for posts only):
    IF published < 30 days ago:  score += 10
    IF published < 90 days ago:  score += 7
    IF published < 180 days ago: score += 5
    IF published < 365 days ago: score += 3

Cap score at 100.
```

### Step 4: Filter and Return

- Minimum score threshold: 5 for multi-word queries, 1 for single-word queries
- Return top 5 results
- If no results meet the minimum score, return top 3 results regardless (so the user always gets something)

---

## 7. AI Answer Generation

### Gemini API Integration

Use the Google Gemini REST API directly (no SDK dependency in PHP).

**Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`

**Authentication:** API key passed as query parameter `?key=YOUR_API_KEY`

**Request format:**
```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "FULL_PROMPT_HERE"
        }
      ]
    }
  ]
}
```

### System Prompt (with RAG context)

When search results are found, use this prompt template:

```
You are an AI assistant for [BUSINESS_NAME].

User asked: "[USER_MESSAGE]"

Content from our website and documents:
[RAG_CONTEXT - concatenated search results]

Instructions:
1. Answer using ONLY the provided content — do not invent information
2. Put source page/document titles in "quotes" when referencing them
3. Use paragraphs (separate with double newlines)
4. If content doesn't contain the answer, say so honestly and suggest contacting the business directly
5. Be thorough but concise
6. Use plain Australian English
7. [BUSINESS-SPECIFIC GUARDRAILS — e.g., "Never give financial advice or product recommendations"]

Answer:
```

### System Prompt (without RAG context)

When no search results are found:

```
You are an AI assistant for [BUSINESS_NAME].

You help visitors learn about our services and offerings.

[BRIEF BUSINESS DESCRIPTION — 2-3 sentences about what the business does]

The user's question didn't match any specific content on our website.
Provide a helpful, general response and suggest they contact us directly for specific details.

Use paragraphs (separate with double newlines).

User asked: "[USER_MESSAGE]"

Answer:
```

### Prompt Assembly with Conversation History

```
[System Prompt]

[Last 10 conversation turns, formatted as:]
User: [message]
Assistant: [message]
User: [message]
Assistant: [message]

User: [current message]
Assistant:
```

Limit to last 10 turns to stay within token limits.

### Response Post-Processing

1. **Convert quoted titles to links:** Use regex to find `"Title Text"` in the AI response. For each match, check if it matches a source title (case-insensitive, partial match allowed). If so, replace with `<a href="URL" target="_blank">"Title Text"</a>`.

2. **Format paragraphs:** Split response by `\n\n`. For each paragraph:
   - Check if it's a list (lines starting with `-`, `•`, `*`, or `1.`, `2.`, etc.)
   - If list → wrap in `<ul><li>...</li></ul>` or `<ol><li>...</li></ol>`
   - If regular paragraph → wrap in `<p>...</p>`
   - Preserve `<br>` for single newlines within paragraphs

3. **Skip empty/meaningless content:** Ignore paragraphs that are only 1-2 characters of punctuation.

---

## 8. Conversation Memory

### How It Works

- Conversation history is stored in a JavaScript array on the client side: `let conversationHistory = []`
- Each message (user and assistant) is pushed to this array: `{ role: 'user'|'assistant', content: 'text' }`
- On each new message, the entire history is sent to the API
- The backend includes the last 10 turns in the Gemini prompt
- History persists as long as the page is open (lost on page refresh/navigation)

### Why Client-Side Only

This is intentional for privacy and simplicity:
- No user accounts or sessions to manage
- No conversation data stored on the server
- History is only needed for multi-turn context within a single visit
- If the user wants to save the conversation, they use the "Email transcript" feature

### Multi-Turn Context Example

```
Turn 1: User: "What services do you offer?"
         → AI answers with list of services

Turn 2: User: "Tell me more about the first one"
         → With conversation history, AI knows "the first one" refers to a specific service from Turn 1
         → Without history, this question would be meaningless
```

---

## 9. Follow-Up Questions

After each substantive AI response, generate 3 clickable follow-up questions.

### Generation

Use a second Gemini API call with this prompt:

```
Based on this user question: "[USER_MESSAGE]"

And these available sources:
- [Source Title 1]
- [Source Title 2]
- [Source Title 3]

Generate exactly 3 short, specific follow-up questions (max 10 words each) that would help the user learn more about [BUSINESS_NAME]'s services.

Questions MUST be derived from the provided source content or the business's core services.

Format: One question per line, no numbering, no punctuation at end.
```

### Display

Follow-up questions appear below the AI response in a styled container:

```html
<div class="dp-chat-followup">
  <p>You might also want to know:</p>
  <button class="dp-chat-followup-btn" onclick="...">How does your fee structure work</button>
  <button class="dp-chat-followup-btn" onclick="...">What documents do I need to provide</button>
  <button class="dp-chat-followup-btn" onclick="...">Can I book a consultation online</button>
</div>
```

**Behaviour:** Clicking a follow-up button:
1. Sets the chat input value to the question text
2. Triggers the send function (as if the user typed it and pressed Send)

**CSS:**
- Container: subtle background, left border accent (4px solid brand colour), rounded corners
- Buttons: full-width, transparent background, border: 2px solid brand accent, rounded
- Hover: background fills with brand accent colour

### When NOT to Generate

Skip follow-up generation for:
- Simple greetings ("hi", "hello", "thanks", "ok")
- Messages with 2 or fewer words

---

## 10. Source Attribution

### How Sources Are Displayed

Sources appear as a separate message bubble below the AI answer, grouped by type:

```
📄 FROM WEBSITE:
  • Page Title (clickable link)
  • Another Page Title (clickable link)

📚 FROM BLOG:
  • Blog Post Title (clickable link)

📎 FROM DOCUMENTS:
  • PDF Document Name (clickable link to media file)
```

### Source Object Format

```json
{
  "title": "Financial Services Guide",
  "link": "https://example.com/financial-services-guide/",
  "type": "page",
  "excerpt": "First 200 characters of content...",
  "authority": 78
}
```

### Grouping Logic (in frontend JavaScript)

```javascript
const pageSources = sources.filter(s => s.type === 'page');
const postSources = sources.filter(s => s.type === 'post');
const pdfSources = sources.filter(s => s.type === 'pdf');
```

### CSS for Source Links

- Container: subtle gradient background, left border accent (4px solid brand gold/accent), rounded
- Links: underline, bold (font-weight: 600), brand link colour
- Hover: darker shade of link colour

---

## 11. Voice Input (Speech-to-Text)

### Technology

Uses the browser's native Web Speech API (`webkitSpeechRecognition` / `SpeechRecognition`). No external libraries needed.

### Implementation

**Initialisation:**
```javascript
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'en-AU';  // Australian English
```

**States:**
1. **Idle** — Microphone icon, normal appearance
2. **Recording** — Red background, pulsing animation, "Listening... Speak now" placeholder
3. **Error** — Amber background, error message in title attribute, auto-resets after 3 seconds
4. **Unsupported** — Button disabled, title says "Voice input not supported"

**Recording Animation CSS:**
```css
@keyframes pulse-recording {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.7); }
  50% { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0); }
}
```

**Behaviour:**
- Click microphone → start recording (toggle)
- Click again → stop recording
- Final transcript → appended to input field value
- Interim transcript → shown in real-time as placeholder
- `no-speech` error → silently continue listening (don't stop)
- `audio-capture` error → "Microphone not found"
- `not-allowed` error → "Microphone permission denied"

**Edge Case Handling:**
- If recognition is already running when start is called → stop first, wait 200ms, restart
- If `InvalidStateError` → retry with stop/wait/start sequence (100ms → 300ms delays)
- Always get fresh DOM reference to input element inside `onresult` handler (prevents stale reference bugs)

### Browser Support

- Chrome/Edge: Full support
- Safari: Partial support (may require user gesture)
- Firefox: Not supported — disable button, show tooltip

---

## 12. Email Chat Transcript

### User Flow

1. User clicks "Email this conversation" toggle button at bottom of chat
2. Email section expands (was hidden)
3. User enters email address
4. Click "Send Email"
5. Success/error message shown

### API Request

```json
POST /wp-json/diamondplate-chat/v1/email-transcript
{
  "email": "user@example.com",
  "history": [
    { "role": "user", "content": "What services do you offer?" },
    { "role": "assistant", "content": "We offer..." }
  ],
  "name": "Optional User Name",
  "company": "Optional Company Name"
}
```

### Email Format

HTML email with:
- Business logo/header
- Heading: "Your [Business Name] Chat Conversation"
- User name and company if provided
- Each message styled as a bubble:
  - User messages: dark background, white text, right-aligned
  - Assistant messages: light background, dark text, left-aligned, gold left border
- Footer with business contact details
- Timestamp of when the conversation was emailed

### Sending

Use WordPress `wp_mail()` function. Set content type to HTML:

```php
add_filter('wp_mail_content_type', function() { return 'text/html'; });
```

### Validation

- Require non-empty email address
- Require at least 1 message in conversation history
- Validate email format
- Rate limit: max 3 emails per session (tracked client-side)

---

## 13. Message Relevance Guard

### Purpose

Prevents the AI from wasting API calls on clearly off-topic messages. This runs on the contact form textarea (if the chat widget is embedded alongside a contact form), checking as the user types.

### How It Works

1. User types into the form textarea
2. After 1 second of no typing (debounce), send message to relevance check API
3. API sends the message to Gemini with a classification prompt
4. If the message is deemed irrelevant, show a warning banner below the textarea
5. On form submission, if message is irrelevant AND confidence < 0.7, show a confirmation dialog

### Gemini Prompt for Relevance Check

```
You are analyzing a contact form message to determine if it's relevant to [BUSINESS_NAME]'s services.

Our business focuses on:
- [LIST OF SERVICES/TOPICS]

Contact form message:
"[USER_MESSAGE]"

Analyze if this message is relevant to our services. Consider:
1. Is it asking about [relevant topics]?
2. Is it clearly spam, unrelated, or completely off-topic?

Respond in JSON format:
{
    "is_relevant": true/false,
    "confidence": 0.0-1.0,
    "reason": "Brief explanation (max 50 words)"
}

Only respond with the JSON object, no other text.
```

### Response Caching

- Cache the result per message text
- If the user hasn't changed the message, return cached result
- Clear cache when message text changes

### Graceful Degradation

If the relevance check API fails, Gemini is unavailable, or JSON parsing fails:
- Default to `is_relevant: true` (never block the user)
- Log the error server-side

---

## 14. Domain Filtering

### Purpose

Client-side pre-filter that prevents obviously off-topic queries from being sent to the API at all. This saves API costs and provides instant feedback.

### Implementation (JavaScript)

Maintain two keyword lists:

**Irrelevant Keywords** (reject if found):
```javascript
const irrelevantKeywords = [
  'recipe', 'cooking', 'weather', 'sports', 'celebrity', 'movie', 'game',
  'restaurant', 'hotel', 'travel', 'vacation', 'music', 'fashion', 'car',
  'bitcoin', 'crypto', 'stock', 'forex', 'dating', 'pets', 'gardening',
  'mars', 'venus', 'planet', 'space', 'relationship', 'love', 'marriage',
  'novel', 'fiction', 'poem', 'song', 'album', 'tv show', 'netflix'
];
```

**Relevant Keywords** (accept if found):
```javascript
const relevantKeywords = [
  // Populated from admin settings — business-specific terms
  // Example for a financial planning firm:
  'financial', 'planning', 'advice', 'super', 'superannuation', 'smsf',
  'investment', 'retirement', 'estate', 'insurance', 'tax', 'wealth',
  'portfolio', 'strategy', 'consultation', 'fees', 'services'
];
```

**Logic:**
1. If query contains any irrelevant keyword → show "Query Outside Search Domain" message
2. If query has no relevant keywords AND is more than 5 words → show the same message
3. Otherwise → proceed with API search

**"Query Outside Search Domain" Message:**
Display a styled warning in the chat window (not a browser alert) with:
- Warning icon (amber)
- Heading: "Query Outside Search Domain"
- Explanation that the search is designed for specific topics
- Bulleted list of what topics the bot covers
- "Try a Different Search" button that clears the input

### Admin Configuration

The relevant keywords list should be manageable from the WordPress admin settings page (see Section 18). This allows the business owner to add industry-specific terms without code changes.

---

## 15. Query Expansion & Synonyms

### Purpose

Users often use different words than what appears in the content. A synonym dictionary maps user terms to content terms.

### Admin-Managed Dictionary

Stored in the `wp_dp_chat_synonyms` table (see Section 20).

**Example entries:**

| Term | Synonyms |
|------|----------|
| super | superannuation, super fund, retirement savings |
| SMSF | self-managed super fund, self managed superannuation |
| SOA | statement of advice, advice document |
| ROA | record of advice |
| fees | costs, pricing, charges, rate |
| appointment | meeting, consultation, booking |

### How It Works

Before searching, expand the query keywords:

```php
function expand_query($query_words, $synonyms) {
    $expanded = $query_words;
    foreach ($query_words as $word) {
        $word_lower = strtolower($word);
        if (isset($synonyms[$word_lower])) {
            $expanded = array_merge($expanded, $synonyms[$word_lower]);
        }
    }
    return array_unique($expanded);
}
```

The expanded keywords are used in the weighted scoring step (Section 6, Step 3), not in the MySQL FULLTEXT query (which handles its own stemming).

---

## 16. Search Logging & Analytics

### What Gets Logged

Every search query is logged to the `wp_dp_chat_search_logs` table:

| Field | Description |
|-------|-------------|
| id | Auto-increment primary key |
| query | The user's search query text |
| search_type | 'chat_assistant' or 'relevance_check' |
| source_page | The page URL where the search was initiated |
| ip_address | User's IP address |
| user_agent | Browser user agent string |
| results_count | Number of results returned |
| source_titles | JSON array of source titles returned |
| created_at | Timestamp |

### Admin Analytics Dashboard

The admin settings page should include a simple analytics section showing:
- Total searches (last 7 days, 30 days, all time)
- Top 10 most common queries
- Queries with 0 results (indicates content gaps)
- Average results per query
- Searches by source page

---

## 17. Security Requirements

### API Key Storage
- Gemini API key stored as a WordPress option (encrypted using `wp_options` table)
- Never exposed in frontend JavaScript
- All AI calls happen server-side through the WordPress REST API

### Input Sanitization
- All user input sanitized with `sanitize_text_field()` before processing
- HTML in AI responses sanitized before rendering (see Section 3.3)
- SQL queries use `$wpdb->prepare()` for all database operations

### Rate Limiting
- Maximum 30 API requests per IP per minute
- Maximum 100 API requests per IP per hour
- Track in WordPress transients: `dp_chat_rate_{ip_hash}`
- Return HTTP 429 with message "Please wait a moment before sending another message"

### CORS
- REST API endpoints should only accept requests from the same origin
- No cross-origin access needed (widget and API are on the same domain)

### Nonce Verification
- WordPress nonce included in the widget JavaScript as a localized variable
- Verified on each REST API request

```php
// In widget output:
wp_localize_script('dp-chat-widget', 'dpChatConfig', [
    'apiUrl' => rest_url('diamondplate-chat/v1/'),
    'nonce' => wp_create_nonce('wp_rest')
]);

// In API handler:
if (!wp_verify_nonce($_SERVER['HTTP_X_WP_NONCE'], 'wp_rest')) {
    return new WP_Error('invalid_nonce', 'Security check failed', ['status' => 403]);
}
```

---

## 18. Admin Settings Page

### Menu Location

Under the WordPress Settings menu: **Settings → DiamondPlate Chat**

### Settings Tabs

**Tab 1: General Settings**
- Business Name (text field)
- Business Description (textarea, 2-3 sentences used in system prompt)
- Gemini API Key (password field, masked)
- Chat Widget Title (default: "AI Assistant")
- Chat Widget Greeting Message (default: "Hi! How can I help you today?")
- Chat Widget Intro Text (default: "Ask me anything about our services.")
- Chat Widget Input Placeholder (default: "Type your question...")
- Enable/Disable chat widget (checkbox)
- Enable/Disable voice input (checkbox)
- Enable/Disable email transcript (checkbox)

**Tab 2: Content Indexing**
- Index Status: Shows total indexed pages, posts, PDFs, and last index date
- "Re-Index All Content" button (triggers full re-index)
- Post types to index (checkboxes: Pages, Posts, custom post types)
- Excluded pages/posts (multi-select or comma-separated IDs)
- PDF indexing enabled (checkbox)

**Tab 3: Domain & Keywords**
- Relevant Keywords (textarea, one per line — used for domain filtering)
- Irrelevant Keywords (textarea, one per line — used for domain filtering)
- Business-Specific Guardrails (textarea — added to system prompt, e.g., "Never give financial advice")

**Tab 4: Synonyms**
- Table showing all synonym entries (Term → Synonyms)
- Add New Synonym: term input + synonyms input (comma-separated)
- Edit/Delete existing entries
- Import/Export as CSV

**Tab 5: Analytics**
- See Section 16

**Tab 6: Appearance**
- Primary Colour (colour picker — used for button, header, accents)
- Accent Colour (colour picker — used for borders, highlights)
- Button Position: Right (default), Left
- Button Vertical Position: Middle (default), Bottom
- Panel Width: 450px (default), custom value

---

## 19. API Endpoints

All endpoints registered under the `diamondplate-chat/v1` namespace.

### POST `/wp-json/diamondplate-chat/v1/ask`

**Purpose:** Main chat endpoint. Receives user message, searches content, generates AI answer.

**Request Body:**
```json
{
  "message": "What services do you offer?",
  "history": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous answer" }
  ]
}
```

**Response (200):**
```json
{
  "message": "<p>We offer several services including...</p>",
  "sources": {
    "page": [
      { "title": "Our Services", "link": "https://...", "type": "page", "excerpt": "..." }
    ],
    "post": [
      { "title": "New Service Announcement", "link": "https://...", "type": "post", "excerpt": "..." }
    ],
    "pdf": []
  },
  "followup_questions": [
    "How much does a consultation cost",
    "Can I book an appointment online",
    "What areas do you service"
  ]
}
```

**Response (429 — Rate Limited):**
```json
{
  "error": "Please wait a moment before sending another message."
}
```

**Response (500 — Server Error):**
```json
{
  "error": "AI service unavailable. Please try again later."
}
```

### POST `/wp-json/diamondplate-chat/v1/check-relevance`

**Purpose:** Check if a contact form message is relevant to the business.

**Request Body:**
```json
{
  "message": "I want to talk about my superannuation options"
}
```

**Response (200):**
```json
{
  "is_relevant": true,
  "confidence": 0.92,
  "reason": "Message is about superannuation, which is a core service."
}
```

### POST `/wp-json/diamondplate-chat/v1/email-transcript`

**Purpose:** Email the chat conversation transcript to the user.

**Request Body:**
```json
{
  "email": "user@example.com",
  "history": [...],
  "name": "John Smith",
  "company": "Acme Corp"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Chat log sent successfully."
}
```

### POST `/wp-json/diamondplate-chat/v1/reindex`

**Purpose:** Trigger a full content re-index (admin only).

**Authentication:** Requires `manage_options` capability.

**Response (200):**
```json
{
  "success": true,
  "indexed": {
    "pages": 45,
    "posts": 230,
    "pdfs": 12
  },
  "duration_seconds": 34
}
```

---

## 20. Database Schema

### Table: `{prefix}_dp_chat_index`

```sql
CREATE TABLE {prefix}_dp_chat_index (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_type ENUM('page', 'post', 'pdf') NOT NULL,
    source_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(500) NOT NULL DEFAULT '',
    url VARCHAR(2048) NOT NULL DEFAULT '',
    headings_text TEXT,
    content LONGTEXT,
    excerpt TEXT,
    word_count INT UNSIGNED DEFAULT 0,
    content_hash VARCHAR(32) DEFAULT '',
    status ENUM('indexed', 'extraction_failed', 'excluded') DEFAULT 'indexed',
    published_at DATETIME DEFAULT NULL,
    indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FULLTEXT INDEX ft_search (title, headings_text, content),
    UNIQUE KEY unique_source (source_type, source_id),
    KEY idx_status (status),
    KEY idx_source_type (source_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Table: `{prefix}_dp_chat_synonyms`

```sql
CREATE TABLE {prefix}_dp_chat_synonyms (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    term VARCHAR(100) NOT NULL,
    synonyms TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_term (term)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`synonyms` field stores comma-separated values: `"superannuation, super fund, retirement savings"`

### Table: `{prefix}_dp_chat_search_logs`

```sql
CREATE TABLE {prefix}_dp_chat_search_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    query VARCHAR(500) NOT NULL,
    search_type VARCHAR(50) DEFAULT 'chat_assistant',
    source_page VARCHAR(2048) DEFAULT '',
    ip_address VARCHAR(45) DEFAULT '',
    user_agent VARCHAR(500) DEFAULT '',
    results_count INT UNSIGNED DEFAULT 0,
    source_titles TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_created_at (created_at),
    KEY idx_query (query(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 21. CSS & Visual Design

### Design System

The widget should adopt the host site's branding through admin-configurable colours. Use CSS custom properties:

```css
:root {
  --dp-chat-primary: #0B1221;      /* Dark navy - configurable */
  --dp-chat-accent: #D4AF37;       /* Gold - configurable */
  --dp-chat-accent-dark: #B8962E;
  --dp-chat-bg: #ffffff;
  --dp-chat-bg-light: #F8F9FA;
  --dp-chat-text: #333333;
  --dp-chat-text-secondary: #6B7280;
  --dp-chat-link: #0066cc;
  --dp-chat-link-hover: #004499;
  --dp-chat-error: #dc2626;
  --dp-chat-success: #10b981;
  --dp-chat-warning: #f59e0b;
  --dp-chat-radius: 8px;
  --dp-chat-radius-lg: 12px;
  --dp-chat-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}
```

### Prefix All CSS Classes

All CSS classes MUST be prefixed with `dp-chat-` to avoid conflicts with the host WordPress theme.

### Responsive Design

- Mobile (< 768px): Chat panel takes full width, no max-width constraint
- Tablet (768px - 1024px): Chat panel 450px max-width
- Desktop (> 1024px): Chat panel 450px max-width
- Floating button: `right: 1rem` on mobile, `right: 2rem` on desktop

### Z-Index Hierarchy

```
Floating button:  z-index: 100
Chat overlay:     z-index: 1010
Chat panel:       z-index: 1011
```

---

## 22. Error Handling

### Frontend Errors

| Scenario | Behaviour |
|----------|-----------|
| API returns error | Show: "I'm having trouble connecting right now. Please try again." |
| Network timeout (25s) | Show: "The request took too long. Please try again." |
| API returns empty response | Show: "I couldn't find an answer. Try rephrasing your question." |
| JavaScript exception | Log to console, show generic error message |

### Backend Errors

| Scenario | Behaviour |
|----------|-----------|
| Gemini API key missing | Return 500: "AI service not configured." |
| Gemini API rate limited | Return 503: "AI service is busy. Please try again in a moment." |
| Gemini API error | Log full error, return 500: "AI service unavailable." |
| Database error | Log full error, return 500: "Internal error." |
| Empty query | Return 400: "Please enter a question." |
| JSON parse error (Gemini response) | Use raw text as answer instead of structured response |

### Graceful Degradation

- If Gemini is completely unavailable → return search results without AI summary, labelled as "Search Results" rather than "AI Answer"
- If content index is empty → return message suggesting the admin run the indexer
- If PDF extraction fails → index the PDF with status `extraction_failed`, still searchable by title

---

## 23. Performance Requirements

### Response Times
- Chat panel open/close animation: < 300ms
- Domain filter check: < 10ms (client-side only)
- Search API response (with AI): < 8 seconds (target < 5 seconds)
- Search API response (without AI, index only): < 500ms
- Full content re-index (500 items): < 60 seconds
- Email transcript send: < 3 seconds

### Caching
- Gemini API responses: Cache by query hash for 1 hour (WordPress transients)
- Content index: Pre-built, queried on demand
- Synonym dictionary: Load once per request, cache in object cache if available

### Resource Limits
- Maximum content per indexed item: 50,000 characters (truncate longer content)
- Maximum PDF file size for extraction: 10MB
- Maximum conversation history sent to API: 10 turns
- Maximum RAG context sent to Gemini: 15,000 characters (truncate if necessary)

---

## 24. Testing Checklist

### Functional Tests

- [ ] Floating button appears on all pages
- [ ] Chat panel opens on button click
- [ ] Chat panel closes on: X button, overlay click, Escape key
- [ ] Full-screen toggle works
- [ ] User can type and send a message
- [ ] Loading spinner appears during API call
- [ ] AI response renders with proper HTML formatting
- [ ] Source links are clickable and open in new tab
- [ ] Follow-up question buttons work (populate input and send)
- [ ] Conversation context is maintained across turns
- [ ] Voice input works in Chrome/Edge
- [ ] Voice input button disabled in unsupported browsers
- [ ] Email transcript sends successfully
- [ ] Email contains proper formatting
- [ ] Off-topic query shows "outside domain" message
- [ ] Relevance check shows warning on contact form

### Content Indexing Tests

- [ ] Pages are indexed on publish
- [ ] Posts are indexed on publish
- [ ] PDFs are indexed on upload
- [ ] Content updates trigger re-index
- [ ] Deleted content is removed from index
- [ ] Manual re-index button works
- [ ] Content hash prevents unnecessary re-processing

### Security Tests

- [ ] API key is not exposed in page source
- [ ] Rate limiting blocks excessive requests
- [ ] Nonce verification prevents CSRF
- [ ] HTML sanitization removes dangerous tags
- [ ] SQL injection not possible (prepared statements)

### Edge Cases

- [ ] Very long query (1000+ characters) — truncate at 500
- [ ] Empty query — show validation message
- [ ] No indexed content — show helpful message
- [ ] Gemini API down — show search results only
- [ ] PDF with no text layer — log extraction failure
- [ ] Rapid message sending — rate limited gracefully
- [ ] Multiple browser tabs — each has independent conversation

---

## 25. File Structure

```
diamondplate-ai-chat/
├── diamondplate-ai-chat.php          # Main plugin file (~70 lines)
├── composer.json                      # PHP dependencies (pdfparser)
├── uninstall.php                      # Drop tables on plugin deletion
├── includes/
│   ├── class-dp-chat-widget.php       # Frontend widget rendering
│   ├── class-dp-chat-api.php          # REST API endpoints
│   ├── class-dp-chat-indexer.php      # Content indexing engine
│   ├── class-dp-chat-search.php       # Search & ranking engine
│   ├── class-dp-chat-ai.php           # Gemini API integration
│   ├── class-dp-chat-admin.php        # Admin settings page
│   └── class-dp-chat-email.php        # Email transcript handling
├── admin/
│   └── views/
│       ├── settings.php               # Admin settings page template
│       ├── synonyms.php               # Synonym management template
│       └── analytics.php              # Analytics dashboard template
├── assets/
│   ├── css/
│   │   ├── dp-chat-widget.css         # Frontend widget styles
│   │   └── dp-chat-admin.css          # Admin page styles
│   └── js/
│       ├── dp-chat-widget.js          # Frontend widget logic
│       └── dp-chat-admin.js           # Admin page logic
└── languages/
    └── diamondplate-ai-chat.pot       # Translation template
```

---

## Appendix A: Gemini API Quick Reference

### Authentication
```
GET/POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=YOUR_API_KEY
```

### PHP Request Example
```php
$response = wp_remote_post(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' . $api_key,
    [
        'headers' => ['Content-Type' => 'application/json'],
        'body' => json_encode([
            'contents' => [
                ['parts' => [['text' => $prompt]]]
            ]
        ]),
        'timeout' => 30
    ]
);

$body = json_decode(wp_remote_retrieve_body($response), true);
$answer = $body['candidates'][0]['content']['parts'][0]['text'] ?? '';
```

### Error Codes
- 400: Bad request (malformed prompt)
- 403: Invalid API key
- 429: Rate limited (quota exceeded)
- 500: Gemini internal error

---

## Appendix B: Configuration Constants

These can be defined in `wp-config.php` for advanced configuration:

```php
define('DIAMONDPLATE_CHAT_GEMINI_KEY', 'your-api-key-here');  // Alternative to admin setting
define('DIAMONDPLATE_CHAT_MAX_CONTEXT', 15000);                // Max chars of RAG context
define('DIAMONDPLATE_CHAT_MAX_HISTORY', 10);                   // Max conversation turns
define('DIAMONDPLATE_CHAT_RATE_LIMIT_MINUTE', 30);             // Requests per minute per IP
define('DIAMONDPLATE_CHAT_RATE_LIMIT_HOUR', 100);              // Requests per hour per IP
define('DIAMONDPLATE_CHAT_CACHE_TTL', 3600);                   // AI response cache TTL (seconds)
define('DIAMONDPLATE_CHAT_MAX_PDF_SIZE', 10485760);            // Max PDF size for extraction (bytes)
define('DIAMONDPLATE_CHAT_DEBUG', false);                       // Enable debug logging
```

---

## Appendix C: WordPress Hooks Used

| Hook | Type | Purpose |
|------|------|---------|
| `plugins_loaded` | Action | Initialise plugin |
| `wp_footer` | Action | Render chat widget HTML |
| `wp_enqueue_scripts` | Action | Enqueue frontend CSS/JS |
| `admin_menu` | Action | Register admin settings page |
| `admin_enqueue_scripts` | Action | Enqueue admin CSS/JS |
| `save_post` | Action | Re-index content on save |
| `before_delete_post` | Action | Remove content from index |
| `add_attachment` | Action | Index uploaded PDFs |
| `rest_api_init` | Action | Register REST endpoints |
| `dp_chat_daily_reindex` | Custom Cron | Scheduled full re-index |
| `wp_mail_content_type` | Filter | Set email content type to HTML |
| `register_activation_hook` | Function | Create database tables |
| `register_deactivation_hook` | Function | Clean up scheduled events |
| `register_uninstall_hook` | Function | Drop tables on uninstall |
