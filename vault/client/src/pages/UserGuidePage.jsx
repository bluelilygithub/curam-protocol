import React, { useState, useEffect, useRef } from 'react';

// ─── Section data ────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'overview',        label: 'Overview' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'projects',        label: 'Projects' },
  { id: 'chat',            label: 'Chat' },
  { id: 'files',           label: 'Files & Attachments' },
  { id: 'web-pages',       label: 'Web Pages' },
  { id: 'artifacts',       label: 'Artifacts' },
  { id: 'memory',          label: 'Memory' },
  { id: 'prompts',         label: 'Prompt Library' },
  { id: 'search',          label: 'Search' },
  { id: 'export',          label: 'Export & Share' },
  { id: 'voice',           label: 'Voice' },
  { id: 'settings',        label: 'Settings' },
  { id: 'shortcuts',       label: 'Keyboard Shortcuts' },
  { id: 'personas',        label: 'Personas' },
  { id: 'pinned-context',  label: 'Pinned Context' },
  { id: 'folders',         label: 'Folders' },
  { id: 'branching',       label: 'Conversation Branching' },
  { id: 'regenerate',      label: 'Regenerating Responses' },
  { id: 'reasoning',       label: 'Reasoning Mode' },
];

// ─── Micro-components ────────────────────────────────────────────────────────

function SectionHeading({ id, children }) {
  return (
    <h2
      id={id}
      className="text-xl font-bold mb-4 mt-2 scroll-mt-6"
      style={{ color: 'var(--color-text)' }}
    >
      {children}
    </h2>
  );
}

function SubHeading({ children }) {
  return (
    <h3 className="text-sm font-bold uppercase tracking-widest mt-8 mb-3" style={{ color: 'var(--color-primary)' }}>
      {children}
    </h3>
  );
}

function P({ children }) {
  return (
    <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--color-text)', opacity: 0.85 }}>
      {children}
    </p>
  );
}

function UL({ children }) {
  return (
    <ul className="text-sm leading-relaxed mb-4 space-y-1.5 ml-4" style={{ color: 'var(--color-text)', opacity: 0.85 }}>
      {children}
    </ul>
  );
}

function LI({ children }) {
  return (
    <li className="flex gap-2">
      <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>•</span>
      <span>{children}</span>
    </li>
  );
}

function Callout({ type = 'info', children }) {
  const styles = {
    info:    { bg: 'rgba(37,99,235,0.08)',  border: '#3b82f6', icon: 'ℹ' },
    tip:     { bg: 'rgba(5,150,105,0.08)',  border: '#10b981', icon: '✦' },
    warning: { bg: 'rgba(217,119,6,0.08)', border: '#f59e0b', icon: '⚠' },
  };
  const s = styles[type];
  return (
    <div
      className="flex gap-3 px-4 py-3 rounded-xl my-4 text-sm"
      style={{ background: s.bg, borderLeft: `3px solid ${s.border}`, color: 'var(--color-text)' }}
    >
      <span className="flex-shrink-0 font-bold" style={{ color: s.border }}>{s.icon}</span>
      <span className="leading-relaxed opacity-85">{children}</span>
    </div>
  );
}

function Kbd({ children }) {
  return (
    <kbd
      className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono border mx-0.5"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', minWidth: '22px' }}
    >
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, desc }) {
  return (
    <div
      className="flex items-center justify-between py-2.5 border-b"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <span className="text-sm" style={{ color: 'var(--color-text)', opacity: 0.85 }}>{desc}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}
      </div>
    </div>
  );
}

function FeatureCard({ emoji, title, desc }) {
  return (
    <div
      className="flex gap-3 p-3 rounded-xl border"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <span className="text-2xl flex-shrink-0">{emoji}</span>
      <div>
        <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>{title}</div>
        <div className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{desc}</div>
      </div>
    </div>
  );
}

function Divider() {
  return <hr className="my-10" style={{ borderColor: 'var(--color-border)' }} />;
}

// ─── Main page ───────────────────────────────────────────────────────────────

function UserGuidePage() {
  const [activeSection, setActiveSection] = useState('overview');
  const contentRef = useRef(null);

  // Highlight the active section as you scroll
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );
    SECTIONS.forEach(s => {
      const node = document.getElementById(s.id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-full overflow-hidden">

      {/* Sidebar */}
      <aside
        className="flex-shrink-0 w-52 border-r overflow-y-auto py-6 px-3 hidden md:block"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest px-2 mb-4" style={{ color: 'var(--color-muted)' }}>
          User Guide
        </p>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all"
              style={{
                background: activeSection === s.id ? 'var(--color-bg)' : 'transparent',
                color: activeSection === s.id ? 'var(--color-primary)' : 'var(--color-muted)',
                fontWeight: activeSection === s.id ? 600 : 400,
                borderLeft: activeSection === s.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main ref={contentRef} className="flex-1 overflow-y-auto px-6 md:px-12 py-8 max-w-3xl">

        {/* ── Overview ── */}
        <SectionHeading id="overview">Project Vault</SectionHeading>
        <P>
          Project Vault is an AI workspace built around the idea that context matters.
          Instead of starting every conversation from scratch, you define a <strong>Project</strong> — its
          goals, audience, tech stack, tone — and every chat inside that project automatically has full
          awareness of that context.
        </P>
        <P>
          Think of it as a private, self-hosted AI assistant that knows your work, remembers your preferences,
          and adapts to how you think.
        </P>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-6">
          <FeatureCard emoji="📁" title="Projects" desc="Organise work into projects. Each project carries its own context, model, and behaviour settings." />
          <FeatureCard emoji="💬" title="Chat" desc="Stream responses from Claude with full project context. Switch models, temperature, and sessions on the fly." />
          <FeatureCard emoji="📎" title="Files & URLs" desc="Attach PDFs, images, documents, and live web pages directly into the conversation." />
          <FeatureCard emoji="🧠" title="Memory" desc="Teach Claude persistent facts about you — preferences, timezone, conventions — that carry across every project." />
          <FeatureCard emoji="📖" title="Prompt Library" desc="Save your best prompts, tag them, and insert them into any chat in one click." />
          <FeatureCard emoji="⬡" title="Artifacts" desc="Code and HTML from Claude renders in a live side panel — preview, copy, or iterate." />
          <FeatureCard emoji="🎭" title="Personas" desc="Give Claude a custom personality per project — Tech Lead, Copywriter, Devil's Advocate — with a reusable system prompt." />
          <FeatureCard emoji="📌" title="Pinned Context" desc="Pin files and web pages to a project so their content is always injected into every chat, automatically." />
          <FeatureCard emoji="🗂️" title="Folders" desc="Group projects into collapsible folders in the sidebar to keep your workspace tidy." />
          <FeatureCard emoji="🌿" title="Branching" desc="Fork any conversation at any message to explore alternative paths without losing the original thread." />
          <FeatureCard emoji="🔁" title="Regenerate" desc="Re-generate the last response with one click — no retyping required." />
          <FeatureCard emoji="🧮" title="Reasoning Mode" desc="Activate extended thinking for deep, step-by-step reasoning on complex problems (Sonnet & Opus only)." />
        </div>

        <Divider />

        {/* ── Getting Started ── */}
        <SectionHeading id="getting-started">Getting Started</SectionHeading>
        <P>
          The fastest way to get value from Vault is to create a project, give it a name and a goal,
          then start chatting. Here is the recommended first-run flow.
        </P>

        <SubHeading>Step 1 — Create a project</SubHeading>
        <P>
          Click <strong>+ New Project</strong> in the left sidebar or on the home screen.
          A wizard will appear asking three things:
        </P>
        <UL>
          <LI><strong>Project name</strong> — anything that helps you identify it.</LI>
          <LI><strong>Project type</strong> — Development, Research, Writing, Visual, or Quick Tasks. This pre-selects the best AI model and unlocks type-specific behaviour controls.</LI>
          <LI><strong>Behaviour</strong> — a set of pill choices that appear after you pick a type. For example, a Development project asks whether you want Claude to guide you, build the code outright, review, or pair-program.</LI>
        </UL>

        <SubHeading>Step 2 — Add context (optional but recommended)</SubHeading>
        <P>
          Open the project detail page and fill in as many fields as are relevant — Goal, Problem,
          Audience, Tech Stack, Constraints, Success Criteria, Tone, Notes. Claude receives all of
          these as its system prompt on every message. The more context you provide, the more
          focused the responses.
        </P>

        <SubHeading>Step 3 — Start chatting</SubHeading>
        <P>
          Click the <strong>Chat</strong> button at the top of the project detail page, or
          click a project name in the sidebar. Type a message and press <Kbd>Enter</Kbd>.
        </P>

        <Callout type="tip">
          After your first exchange, Claude will automatically generate a short title for the session
          (e.g. "Fix login bug"). You can rename it at any time by clicking the title in the chat header.
        </Callout>

        <Divider />

        {/* ── Projects ── */}
        <SectionHeading id="projects">Projects</SectionHeading>
        <P>
          A project is a persistent workspace that bundles together context, files, chat history,
          and AI behaviour settings. All of these are passed to Claude on every message, so responses
          stay grounded in your actual work.
        </P>

        <SubHeading>Context fields</SubHeading>
        <UL>
          <LI><strong>Goal</strong> — what the project is trying to achieve.</LI>
          <LI><strong>Problem</strong> — the specific problem it addresses.</LI>
          <LI><strong>Audience</strong> — who the output is for.</LI>
          <LI><strong>Tech Stack</strong> — frameworks, languages, infrastructure (for Development projects).</LI>
          <LI><strong>Constraints</strong> — budget, timeline, technical limits.</LI>
          <LI><strong>Success Criteria</strong> — how you will know the work is done.</LI>
          <LI><strong>Tone</strong> — the communication style you want Claude to use.</LI>
          <LI><strong>Notes</strong> — anything else Claude should know.</LI>
        </UL>

        <SubHeading>Project types</SubHeading>
        <P>Each type pre-selects a recommended AI model and unlocks a tailored set of behaviour controls:</P>
        <UL>
          <LI><strong>💻 Development</strong> — Code, APIs, architecture. Recommended: Sonnet.</LI>
          <LI><strong>🔬 Research</strong> — Analysis, reports, deep dives. Recommended: Opus.</LI>
          <LI><strong>✍️ Writing</strong> — Content, copy, storytelling. Recommended: Sonnet.</LI>
          <LI><strong>🖼️ Visual &amp; Images</strong> — Image analysis and visual tasks. Recommended: Sonnet.</LI>
          <LI><strong>⚡ Quick Tasks</strong> — Drafts, Q&amp;A, simple work. Recommended: Haiku.</LI>
        </UL>

        <SubHeading>Behaviour settings</SubHeading>
        <P>
          Found on the project detail page below <em>AI Model</em>. These are type-specific controls
          that shape how Claude communicates — not just what it says, but how it approaches the task.
          For example, Development projects let you choose:
        </P>
        <UL>
          <LI><strong>How should I help?</strong> — Guide me, Just build it, Review, or Pair program.</LI>
          <LI><strong>Decision style</strong> — Give me options vs. Be decisive.</LI>
          <LI><strong>Explanations</strong> — Code only vs. Explain choices.</LI>
          <LI><strong>Include tests?</strong> — Always vs. Only when asked.</LI>
          <LI><strong>Code style priority</strong> — Clean, Idiomatic, or Minimal.</LI>
        </UL>
        <P>
          Changes take effect on the next message. Click <strong>Save Changes</strong> to persist them.
        </P>

        <SubHeading>AI Model</SubHeading>
        <P>
          Set the default model for all chats within the project. This can be overridden per chat
          session using the model picker in the chat header.
        </P>
        <UL>
          <LI><strong>⚡ Haiku 4.5 (Economy)</strong> — Fast and affordable. Best for quick tasks, drafts, and Q&amp;A.</LI>
          <LI><strong>⚖️ Sonnet 4.6 (Standard)</strong> — Smart and balanced. Best for most work — code, writing, analysis.</LI>
          <LI><strong>🧠 Opus 4.6 (Premium)</strong> — Most capable. Best for complex reasoning and deep analysis.</LI>
        </UL>

        <SubHeading>Deleting a project</SubHeading>
        <P>
          Click the trash icon on the project detail page. You will see a confirmation dialog that
          lists exactly what will be removed: the project, all chat sessions, all uploaded files,
          and all messages. This action cannot be undone.
        </P>

        <Divider />

        {/* ── Chat ── */}
        <SectionHeading id="chat">Chat</SectionHeading>
        <P>
          Each project can hold multiple independent chat sessions. Sessions are listed in the
          dropdown at the top of the chat header, with starred sessions shown first.
        </P>

        <SubHeading>Starting a new session</SubHeading>
        <P>
          Select <strong>+ New chat</strong> from the session dropdown, or press
          <Kbd>⌘</Kbd><Kbd>N</Kbd>. Each session is independent — switching sessions does not
          affect others.
        </P>

        <SubHeading>Model and temperature</SubHeading>
        <P>
          Two controls appear in the chat header:
        </P>
        <UL>
          <LI>
            <strong>Model picker</strong> — the coloured emoji badge (e.g. ⚖️ Sonnet 4.6).
            Click to switch models for this session only, without changing the project default.
          </LI>
          <LI>
            <strong>🔥 Temperature</strong> — controls response creativity.
            <strong> Precise</strong> (0.2) gives focused, deterministic answers.
            <strong> Balanced</strong> (0.7) is the default.
            <strong> Creative</strong> (1.0) produces more varied and imaginative responses.
          </LI>
        </UL>

        <SubHeading>Starring sessions</SubHeading>
        <P>
          Click the ⭐ icon in the chat header to star the current session. Starred sessions
          float to the top of the session dropdown and are marked with a ⭐ prefix.
          Use this for long-running threads you return to frequently.
        </P>

        <SubHeading>Summarising a conversation</SubHeading>
        <P>
          Long conversations consume more context and can become less focused over time.
          Click the <strong>✦ sparkles</strong> icon in the chat header to compress the entire
          thread into a structured summary. From that point forward, Claude works from the
          summary rather than the full history — keeping responses sharp.
        </P>
        <UL>
          <LI>A banner appears confirming the conversation is summarised.</LI>
          <LI>Click <strong>View</strong> on the banner to read the summary.</LI>
          <LI>Click <strong>Revert to full thread</strong> to undo — Claude will use the full history again.</LI>
        </UL>

        <Callout type="warning">
          A context warning banner appears automatically when a session reaches 20+ messages or
          12,000+ characters. Summarising at this point keeps the conversation productive.
        </Callout>

        <SubHeading>Deleting messages</SubHeading>
        <P>
          Hover over any user message to reveal a trash icon. Clicking it deletes that prompt
          and its paired assistant response together. This is useful for removing dead ends or
          incorrect exchanges before continuing.
        </P>

        <SubHeading>Usage and cost</SubHeading>
        <P>
          After each response, the total token count and estimated cost for the session appear
          in the chat header (e.g. <em>3.2k tokens · $0.002</em>). This gives you a live sense
          of how much each session is consuming.
        </P>

        <SubHeading>Follow-up suggestions</SubHeading>
        <P>
          After each assistant response, three clickable suggestion chips appear below the message.
          These are generated automatically using Haiku and represent likely next steps or
          follow-on questions. Click any chip to send it immediately.
        </P>

        <SubHeading>Renaming and deleting sessions</SubHeading>
        <UL>
          <LI>Click the session title in the header to rename it inline. Press <Kbd>Enter</Kbd> or click away to save.</LI>
          <LI>Click the trash icon in the chat header to delete the session. All messages are permanently removed.</LI>
        </UL>

        <Divider />

        {/* ── Files ── */}
        <SectionHeading id="files">Files &amp; Attachments</SectionHeading>
        <P>
          Files can be attached at two levels: to the <strong>project</strong> (always available
          as background context) or to a specific <strong>chat message</strong> (used once for
          that exchange).
        </P>

        <SubHeading>Project-level files</SubHeading>
        <P>
          Open the project detail page and scroll to the <strong>Files</strong> section.
          Drag and drop files onto the upload zone, or click to browse. Supported formats:
        </P>
        <UL>
          <LI><strong>PDF</strong> — text is extracted automatically and an AI summary is generated.</LI>
          <LI><strong>Images</strong> — JPG, PNG, GIF, WEBP. Claude can analyse and describe them.</LI>
          <LI><strong>Text files</strong> — TXT, JSON, CSV, Markdown.</LI>
        </UL>

        <SubHeading>Chat-level attachments</SubHeading>
        <P>
          Click the <strong>📎 upload icon</strong> in the chat input toolbar to open the file picker.
          You can upload a new file or attach any file that already exists in the project.
        </P>
        <P>
          When files are attached, the placeholder text changes to
          <em> "What would you like to do with this file?"</em> — a reminder that you must
          include a question or instruction. Claude will not auto-review files without being asked.
        </P>
        <UL>
          <LI>Images are shown as thumbnails in the message after sending.</LI>
          <LI>Documents appear as a small chip with the filename.</LI>
          <LI>Multiple files can be attached to a single message.</LI>
        </UL>

        <Callout type="tip">
          For PDFs, the extracted text (up to 8,000 characters) is passed to Claude as context.
          The AI-generated summary is shown as a collapsible card on the file list.
        </Callout>

        <Divider />

        {/* ── Web Pages ── */}
        <SectionHeading id="web-pages">Web Pages</SectionHeading>
        <P>
          Attach any live web page to a message and Claude will receive its full text content
          as context — no copy-pasting required.
        </P>

        <SubHeading>Attaching a URL</SubHeading>
        <UL>
          <LI>Click the <strong>🔗 link icon</strong> in the chat input toolbar.</LI>
          <LI>Paste or type the URL and press <Kbd>Enter</Kbd> (or click <strong>Add</strong>).</LI>
          <LI>A chip appears showing the page title once it has been fetched.</LI>
          <LI>Add multiple URLs if needed — each gets its own chip.</LI>
          <LI>Remove any URL by clicking the ✕ on its chip.</LI>
        </UL>
        <P>
          The page is fetched server-side (avoiding browser CORS restrictions). Scripts,
          navigation, headers, and footers are stripped; only readable content is sent to Claude
          (up to 15,000 characters).
        </P>

        <Callout type="info">
          The send button will not activate while a URL is still loading. Wait for the chip to
          show the page title before sending.
        </Callout>

        <Divider />

        {/* ── Artifacts ── */}
        <SectionHeading id="artifacts">Artifacts</SectionHeading>
        <P>
          When Claude returns a response containing a significant code block, an
          <strong> Artifact</strong> button appears on hover above the message.
          Clicking it opens a split panel on the right side of the chat.
        </P>

        <SubHeading>What renders in the panel</SubHeading>
        <UL>
          <LI><strong>HTML / SVG</strong> — rendered live inside a sandboxed iframe. You see the actual output.</LI>
          <LI><strong>All other code</strong> — displayed with full syntax highlighting and line numbers.</LI>
        </UL>

        <SubHeading>Panel controls</SubHeading>
        <UL>
          <LI><strong>Language badge</strong> — shown top-left (e.g. <code>python</code>, <code>html</code>).</LI>
          <LI><strong>Copy</strong> — copies the full code to clipboard.</LI>
          <LI><strong>Prev / Next</strong> — navigate between multiple code blocks if the message contains more than one.</LI>
          <LI><strong>✕ Close</strong> — closes the panel and returns to full-width chat.</LI>
        </UL>

        <Callout type="tip">
          Ask Claude to iterate on the artifact — e.g. <em>"Make the button blue"</em> — and click the
          new Artifact button to update the panel with the revised version.
        </Callout>

        <Divider />

        {/* ── Memory ── */}
        <SectionHeading id="memory">Memory</SectionHeading>
        <P>
          Memory lets you teach Claude persistent facts about yourself that carry across
          <em> every project and every conversation</em> — not just the current one.
        </P>

        <SubHeading>Accessing Memory</SubHeading>
        <P>
          Click the <strong>🧠 brain icon</strong> in the top navigation bar (or navigate to <code>/memory</code>).
        </P>

        <SubHeading>Adding a memory</SubHeading>
        <P>
          Type a fact into the input field and click <strong>Add</strong>. Examples of useful memories:
        </P>
        <UL>
          <LI>I prefer TypeScript over JavaScript.</LI>
          <LI>My timezone is GMT+1.</LI>
          <LI>Always use Tailwind CSS for styling.</LI>
          <LI>I work in a small startup — keep suggestions practical and low-cost.</LI>
          <LI>My audience is non-technical business stakeholders.</LI>
        </UL>

        <SubHeading>How it works</SubHeading>
        <P>
          Memories are injected into the system prompt of every chat as a
          <em> "Persistent user memory"</em> section. Claude can reference them at any time
          without being reminded. They do not count against your per-session context — they are
          prepended once at the start of every conversation.
        </P>

        <SubHeading>Removing a memory</SubHeading>
        <P>Hover over any memory entry and click the trash icon that appears on the right.</P>

        <Callout type="warning">
          Keep memories concise and factual. Vague or contradictory entries may confuse Claude.
          Review your memory list occasionally and remove anything that is outdated.
        </Callout>

        <Divider />

        {/* ── Prompt Library ── */}
        <SectionHeading id="prompts">Prompt Library</SectionHeading>
        <P>
          The Prompt Library is a personal collection of reusable prompts. Save prompts you
          reach for repeatedly and insert them into any chat in one click.
        </P>

        <SubHeading>Accessing the library</SubHeading>
        <P>
          Click the <strong>📖 book icon</strong> in the top navigation bar (or navigate to <code>/prompts</code>).
        </P>

        <SubHeading>Saving a prompt</SubHeading>
        <P>Click <strong>+ New Prompt</strong> and fill in:</P>
        <UL>
          <LI><strong>Title</strong> — a short name to identify the prompt (e.g. "Code review checklist").</LI>
          <LI><strong>Prompt text</strong> — the full prompt content.</LI>
          <LI><strong>Tags</strong> — optional comma-separated keywords for filtering (e.g. <code>dev, review, checklist</code>).</LI>
        </UL>

        <SubHeading>Using a prompt in chat</SubHeading>
        <P>
          Click the <strong>book icon</strong> in the chat input toolbar. A picker opens above
          the input showing all your saved prompts. Type to filter by title or content.
          Click any prompt to load it into the message input — you can then edit it before sending.
        </P>

        <SubHeading>Copying a prompt</SubHeading>
        <P>
          On the Prompts page, hover over a prompt card and click the <strong>copy icon</strong>
          that appears. The prompt text is copied to the clipboard.
        </P>

        <Divider />

        {/* ── Search ── */}
        <SectionHeading id="search">Search</SectionHeading>
        <P>
          Full-text search spans all projects, files, and chat messages. It uses SQLite FTS5
          under the hood, so it is fast and searches across the entire content of indexed items.
        </P>

        <SubHeading>Opening search</SubHeading>
        <UL>
          <LI>Press <Kbd>⌘</Kbd><Kbd>K</Kbd> (or <Kbd>Ctrl</Kbd><Kbd>K</Kbd> on Windows).</LI>
          <LI>Click the <strong>Search</strong> button in the top navigation bar.</LI>
        </UL>

        <SubHeading>Using the palette</SubHeading>
        <UL>
          <LI>Start typing immediately — results appear as you type.</LI>
          <LI>Results are grouped by type: <strong>Projects</strong>, <strong>Files</strong>, and <strong>Messages</strong>.</LI>
          <LI>Use <Kbd>↑</Kbd><Kbd>↓</Kbd> to navigate results with the keyboard.</LI>
          <LI>Press <Kbd>Enter</Kbd> to navigate to the selected result.</LI>
          <LI>Press <Kbd>Esc</Kbd> to close.</LI>
        </UL>

        <Divider />

        {/* ── Export ── */}
        <SectionHeading id="export">Export &amp; Share</SectionHeading>
        <P>
          Everything in Vault can be exported in multiple formats — for sharing, archiving,
          or piping into other tools.
        </P>

        <SubHeading>Exporting a chat</SubHeading>
        <P>
          In the chat header, the <strong>Export</strong> menu (three-dot icon) offers:
        </P>
        <UL>
          <LI><strong>Export JSON</strong> — all messages in machine-readable format.</LI>
          <LI><strong>Export PDF</strong> — a formatted PDF with a title page and message blocks.</LI>
          <LI><strong>Export Project</strong> — project fields + file metadata + all messages in one JSON.</LI>
          <LI><strong>Email Thread</strong> — sends the chat as a formatted HTML email via your configured SMTP settings.</LI>
        </UL>

        <SubHeading>Saving as Markdown</SubHeading>
        <UL>
          <LI>Click the <strong>📥 file-down icon</strong> in the chat header to save the full session as a <code>.md</code> file.</LI>
          <LI>Hover over any <em>assistant message</em> and click the file icon to save just that response.</LI>
          <LI>On the project detail page, click the file icon in the header to save the entire project brief as Markdown.</LI>
        </UL>

        <Callout type="tip">
          The Markdown exports are designed to be readable and well-formatted — suitable for pasting into Notion,
          Obsidian, GitHub, or any Markdown-aware tool.
        </Callout>

        <Divider />

        {/* ── Voice ── */}
        <SectionHeading id="voice">Voice</SectionHeading>
        <P>
          Vault includes browser-native voice input (speech-to-text) and read-aloud
          (text-to-speech). Both features require a modern browser and appropriate permissions.
        </P>

        <SubHeading>Voice input (speech-to-text)</SubHeading>
        <P>
          Click the <strong>🎤 microphone icon</strong> in the chat input toolbar to begin
          recording. Speak your message — it will be transcribed into the input field in
          real time. Click the icon again to stop.
        </P>
        <P>
          The microphone icon is hidden if your browser does not support the Web Speech API.
        </P>

        <SubHeading>Read aloud (text-to-speech)</SubHeading>
        <P>
          Click the <strong>🔊 speaker icon</strong> in the chat input toolbar to read the
          last assistant message aloud using your system's text-to-speech engine.
        </P>

        <Callout type="info">
          Voice features use the browser's built-in Web Speech API — no external service or
          API key is required. Quality and language support varies by browser and operating system.
        </Callout>

        <Divider />

        {/* ── Settings ── */}
        <SectionHeading id="settings">Settings</SectionHeading>
        <P>
          Click the <strong>⚙ settings icon</strong> in the top navigation bar to access
          appearance preferences.
        </P>

        <SubHeading>Themes</SubHeading>
        <P>Five themes are available. The active theme is applied immediately across the entire app:</P>
        <UL>
          <LI><strong>Warm Sand</strong> — warm off-white with terracotta accents. Light.</LI>
          <LI><strong>Dark Slate</strong> — deep charcoal with indigo accents. Dark.</LI>
          <LI><strong>Forest</strong> — muted green tones with teal accents. Light.</LI>
          <LI><strong>Midnight Blue</strong> — deep navy with sky-blue accents. Dark.</LI>
          <LI><strong>Paper White</strong> — pure white with charcoal accents. Light.</LI>
        </UL>

        <SubHeading>Fonts</SubHeading>
        <P>
          Choose from five font options. The selected font is applied to all UI text immediately.
          Fonts are loaded from Google Fonts when first selected.
        </P>

        <SubHeading>Icon packs</SubHeading>
        <P>
          Choose between Lucide (default), Heroicons, and Phosphor icon styles.
          All icons throughout the app swap to the selected pack.
        </P>

        <Divider />

        {/* ── Keyboard Shortcuts ── */}
        <SectionHeading id="shortcuts">Keyboard Shortcuts</SectionHeading>
        <P>
          Press <Kbd>⌘</Kbd><Kbd>/</Kbd> at any time to open the shortcuts modal. The full
          list of shortcuts is below.
        </P>

        <div className="rounded-2xl border overflow-hidden mt-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Global
          </div>
          <div className="px-4" style={{ background: 'var(--color-bg)' }}>
            <ShortcutRow keys={['⌘', 'K']} desc="Open search palette" />
            <ShortcutRow keys={['⌘', 'N']} desc="Start a new chat" />
            <ShortcutRow keys={['⌘', 'B']} desc="Toggle sidebar" />
            <ShortcutRow keys={['⌘', '/']} desc="Show keyboard shortcuts" />
          </div>

          <div className="px-4 py-3 border-b border-t text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Chat input
          </div>
          <div className="px-4" style={{ background: 'var(--color-bg)' }}>
            <ShortcutRow keys={['Enter']} desc="Send message" />
            <ShortcutRow keys={['Shift', 'Enter']} desc="New line in message" />
            <ShortcutRow keys={['@']} desc="Mention a project to switch context" />
            <ShortcutRow keys={['Esc']} desc="Close open popover (URL input, file picker, prompts)" />
          </div>

          <div className="px-4 py-3 border-b border-t text-xs font-semibold uppercase tracking-wider" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Search palette
          </div>
          <div className="px-4" style={{ background: 'var(--color-bg)' }}>
            <ShortcutRow keys={['↑', '↓']} desc="Navigate results" />
            <ShortcutRow keys={['Enter']} desc="Go to selected result" />
            <ShortcutRow keys={['Esc']} desc="Close palette" />
          </div>
        </div>

        <Divider />

        {/* ── Personas ── */}
        <SectionHeading id="personas">Personas</SectionHeading>
        <P>
          A <strong>Persona</strong> is a reusable AI personality with a custom system prompt. Personas let you
          switch Claude's role, tone, and focus area without rewriting context every time.
        </P>

        <SubHeading>Creating a Persona</SubHeading>
        <UL>
          <LI>Navigate to <strong>Personas</strong> via the person icon in the top nav bar.</LI>
          <LI>Click <strong>New Persona</strong> and provide a name, an optional short description, and the system prompt.</LI>
          <LI>Example: <em>Name: "Tech Lead"</em>, <em>System Prompt: "You are a senior software architect. Always think about scalability, security, and maintainability first. Prefer typed languages and enforce code review standards."</em></LI>
        </UL>

        <SubHeading>Using a Persona</SubHeading>
        <UL>
          <LI>In any chat, click the <strong>Persona</strong> button in the chat header to pick a persona for that session.</LI>
          <LI>The selected persona overrides the project's default for the duration of the chat.</LI>
          <LI>Assign a <strong>default persona</strong> to a project in the project detail page — it will be applied automatically to every new chat in that project.</LI>
          <LI>Personas are additive: the persona prompt is appended to the project context, not replacing it.</LI>
        </UL>

        <Callout type="tip">
          Great use cases: "Rubber duck" for debugging sessions, "Copywriter" for marketing projects, "Code reviewer" for PRs, "Devil's Advocate" for strategy work.
        </Callout>

        <Divider />

        {/* ── Pinned Context ── */}
        <SectionHeading id="pinned-context">Pinned Context</SectionHeading>
        <P>
          <strong>Pinned context</strong> keeps specific files or web pages permanently injected into Claude's
          system prompt for every conversation in a project — no need to re-attach them manually.
        </P>

        <SubHeading>Pinning Files</SubHeading>
        <UL>
          <LI>Go to a project's detail page and scroll to the <strong>Files</strong> section.</LI>
          <LI>Each uploaded file now has a <strong>pin</strong> icon. Click it to toggle pinning.</LI>
          <LI>Pinned files show a <strong>"pinned"</strong> badge. Their extracted text is injected into every chat system prompt.</LI>
          <LI>Best for: architecture docs, coding standards, style guides, reference data.</LI>
        </UL>

        <SubHeading>Pinning Web Pages</SubHeading>
        <UL>
          <LI>In the project detail page, find the <strong>Pinned Web Pages</strong> section.</LI>
          <LI>Paste a URL and click <strong>Pin</strong>. Vault fetches the page in real time and stores its content.</LI>
          <LI>The page title is displayed as a label. The content is automatically injected into every chat.</LI>
          <LI>Useful for: live documentation, API references, competitor pages, news articles.</LI>
        </UL>

        <Callout type="warning">
          Pinned context is counted against the model's context window. Keep pinned files focused — aim for a few hundred words each to leave room for the conversation.
        </Callout>

        <Divider />

        {/* ── Folders ── */}
        <SectionHeading id="folders">Folders</SectionHeading>
        <P>
          Folders let you organise projects into groups in the sidebar, collapsing clutter when you
          have many projects.
        </P>

        <SubHeading>Creating a Folder</SubHeading>
        <UL>
          <LI>In the sidebar, click the <strong>folder-plus</strong> icon (next to the + button).</LI>
          <LI>Type a name and press Enter.</LI>
          <LI>The folder appears in the sidebar with a chevron toggle.</LI>
        </UL>

        <SubHeading>Assigning Projects to Folders</SubHeading>
        <UL>
          <LI>Open a project's detail page.</LI>
          <LI>In the <strong>Organisation</strong> section, choose a folder from the dropdown.</LI>
          <LI>Save the project — it will appear nested under the folder in the sidebar.</LI>
        </UL>

        <SubHeading>Collapsing Folders</SubHeading>
        <P>
          Click any folder header in the sidebar to collapse or expand its projects. Folders remember
          their collapsed state during the session.
        </P>

        <Divider />

        {/* ── Branching ── */}
        <SectionHeading id="branching">Conversation Branching</SectionHeading>
        <P>
          <strong>Branching</strong> lets you fork a conversation at any point — creating a new session that
          starts from that moment. This is useful when you want to explore an alternative path without
          losing the original thread.
        </P>

        <SubHeading>How to Branch</SubHeading>
        <UL>
          <LI>Hover over any of your messages in the chat.</LI>
          <LI>Click the <strong>branch icon</strong> (git branch symbol) that appears near the message.</LI>
          <LI>A new session is created containing all messages up to and including that message.</LI>
          <LI>You are immediately switched to the new branch and can continue from there.</LI>
          <LI>The original session is untouched and remains accessible from the session selector.</LI>
        </UL>

        <Callout type="info">
          Branches are labelled "Branch of: [original title]" automatically. You can rename them from the chat header.
        </Callout>

        <Divider />

        {/* ── Regenerate ── */}
        <SectionHeading id="regenerate">Regenerating Responses</SectionHeading>
        <P>
          If you're not happy with Claude's last response, you can regenerate it without retyping your
          message. Regenerating re-sends the last user message and gets a fresh response.
        </P>

        <SubHeading>How to Regenerate</SubHeading>
        <UL>
          <LI>After any assistant response finishes streaming, a <strong>Regenerate</strong> button appears just below it.</LI>
          <LI>Click <strong>Regenerate</strong>. The last user–assistant pair is removed and the user message is re-sent automatically.</LI>
          <LI>The new response streams in as normal and the database is updated.</LI>
        </UL>

        <Callout type="tip">
          To get a different style of answer, change the <strong>temperature</strong> before regenerating — set it to Creative for more varied responses, or Precise for a more focused one.
        </Callout>

        <Divider />

        {/* ── Reasoning mode ── */}
        <SectionHeading id="reasoning">Reasoning Mode</SectionHeading>
        <P>
          <strong>Reasoning mode</strong> activates Claude's extended thinking capability, giving the model
          extra computation to reason step-by-step before writing its final answer. This leads to
          more accurate, thorough responses on difficult problems — at the cost of extra time and tokens.
        </P>

        <SubHeading>When to Use Reasoning</SubHeading>
        <UL>
          <LI>Complex multi-step problems (algorithm design, architecture decisions, logical proofs).</LI>
          <LI>Tasks where the first answer is often wrong and you want Claude to self-check.</LI>
          <LI>Long-form analysis where structure and completeness matter.</LI>
        </UL>

        <SubHeading>Enabling Reasoning</SubHeading>
        <UL>
          <LI>In the chat header, click the <strong>Reason</strong> button (CPU icon). The button highlights blue when active.</LI>
          <LI>Reasoning mode is only available with <strong>Sonnet</strong> and <strong>Opus</strong> models — the button is hidden for Haiku.</LI>
          <LI>When Claude finishes, a collapsible <strong>Show reasoning</strong> button appears above the response. Click it to read the internal thought process.</LI>
        </UL>

        <Callout type="warning">
          Reasoning mode sets <code>max_tokens</code> to 16,000 and allocates 8,000 tokens to the thinking budget. Each request may take noticeably longer. Temperature is forced to 1 when reasoning is active — the temperature picker has no effect.
        </Callout>

        <div className="h-16" /> {/* Bottom padding */}
      </main>
    </div>
  );
}

export default UserGuidePage;
