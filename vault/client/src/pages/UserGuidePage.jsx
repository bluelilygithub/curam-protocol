import React, { useState, useEffect, useRef } from 'react';

// ─── Section data ────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'overview',        label: 'Overview' },
  { id: 'navigation',      label: 'Navigation' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'projects',        label: 'Projects' },
  { id: 'chat',            label: 'Chat' },
  { id: 'general-chat',    label: 'Quick chat' },
  { id: 'history',         label: 'Chat History' },
  { id: 'web-search',      label: 'Web Search' },
  { id: 'files',           label: 'Files & Attachments' },
  { id: 'web-pages',       label: 'Web Pages' },
  { id: 'artifacts',       label: 'Artifacts' },
  { id: 'memory',          label: 'Memory' },
  { id: 'suggestions',     label: 'Suggestions' },
  { id: 'prompts',         label: 'Prompt Library' },
  { id: 'search',          label: 'Search' },
  { id: 'export',          label: 'Export & Share' },
  { id: 'voice',           label: 'Voice' },
  { id: 'settings',        label: 'Settings' },
  { id: 'shortcuts',       label: 'Keyboard Shortcuts' },
  { id: 'personas',        label: 'Personas' },
  { id: 'pinned-context',  label: 'Pinned Context' },
  { id: 'folders',         label: 'Collections' },
  { id: 'branching',       label: 'Conversation Branching' },
  { id: 'regenerate',      label: 'Regenerating Responses' },
  { id: 'reasoning',       label: 'Reasoning Mode' },
  { id: 'tasks',           label: 'Tasks' },
  { id: 'goals',           label: 'Goals' },
  { id: 'chains',          label: 'Prompt Chains' },
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
          <FeatureCard emoji="💬" title="Chat" desc="Stream responses from Claude or Gemini with full project context. Switch models, temperature, and sessions on the fly." />
          <FeatureCard emoji="🗨️" title="Quick chat" desc="A project-free workspace for ad-hoc questions. Sessions appear on Home → Continue and in the sidebar under Quick chat." />
          <FeatureCard emoji="🕐" title="Chat History" desc="Browse every session across all projects and Quick chat, filtered by date range or searched by content." />
          <FeatureCard emoji="📎" title="Files & URLs" desc="Attach PDFs, images, documents, and live web pages directly into the conversation." />
          <FeatureCard emoji="🔍" title="Web Search" desc="Type @search in chat to fetch live web results and attach them as context before sending." />
          <FeatureCard emoji="🧠" title="Memory" desc="Semantic personal notes — relevant facts recalled per message, not the full list every turn." />
          <FeatureCard emoji="📥" title="Suggestions" desc="Automatic findings from crons and services — triage rules, skills, automations, and alerts." />
          <FeatureCard emoji="📖" title="Prompt Library" desc="Save your best prompts, tag them, and insert them into any chat in one click." />
          <FeatureCard emoji="⬡" title="Artifacts" desc="Code and HTML from Claude renders in a live side panel — preview, copy, or iterate." />
          <FeatureCard emoji="🎭" title="Personas" desc="Give Claude a custom personality per project — Tech Lead, Copywriter, Devil's Advocate — with a reusable system prompt." />
          <FeatureCard emoji="📌" title="Pinned Context" desc="Pin files and web pages to a project so their content is always injected into every chat, automatically." />
          <FeatureCard emoji="🗂️" title="Collections" desc="Group projects in the sidebar (folder-plus icon). Collections organise projects only — not individual chats." />
          <FeatureCard emoji="🌿" title="Branching" desc="Fork any conversation at any message to explore alternative paths without losing the original thread." />
          <FeatureCard emoji="🔁" title="Regenerate" desc="Re-generate the last response with one click — no retyping required." />
          <FeatureCard emoji="🧮" title="Reasoning Mode" desc="Activate extended thinking for deep, step-by-step reasoning on complex problems (Sonnet & Opus only)." />
        </div>

        <Divider />

        {/* ── Navigation ── */}
        <SectionHeading id="navigation">Navigation</SectionHeading>
        <P>
          Vault uses two persistent areas: the <strong>top bar</strong> for frequent actions and an
          <strong> Apps</strong> launcher for everything else, plus the <strong>left sidebar</strong> for
          chat, workspace shortcuts, and projects.
        </P>

        <SubHeading>Top bar</SubHeading>
        <UL>
          <LI><strong>Search</strong> (<Kbd>⌘K</Kbd>) — projects, files, and messages.</LI>
          <LI><strong>Tasks</strong> and <strong>Chat History</strong> — always one click away.</LI>
          <LI><strong>Notes</strong> — always visible on the top bar for quick capture.</LI>
          <LI><strong>Apps</strong> (grid icon) — grouped menu: Workspace, Productivity, AI tools, Content tools, Money &amp; data, Personal, and Admin (Suggestions, Clients, Dashboard). Badge on Apps when new Suggestions exist.</LI>
        </UL>

        <SubHeading>Sidebar</SubHeading>
        <UL>
          <LI><strong>Quick chat</strong> — ad-hoc conversations without project context.</LI>
          <LI><strong>Workspace</strong> — Tasks, Notes, Goals, Clients.</LI>
          <LI><strong>Projects</strong> — collections, project list, recent chats. Expand a project (chevron) to see task/note/file counts.</LI>
        </UL>

        <SubHeading>How content fits together</SubHeading>
        <P>
          An optional <strong>Client</strong> can own one or more <strong>Projects</strong>. Projects may sit
          inside a <strong>Collection</strong> (sidebar grouping only). Each project holds <strong>chats</strong>,
          <strong>files</strong> (always project-scoped), and optionally linked <strong>tasks</strong> and
          <strong>notes</strong>. Open a project's <strong>Overview</strong> tab to see counts and recent activity.
        </P>

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
          stay grounded in your actual work. Tasks and notes can optionally link to a project; files
          always belong to one project.
        </P>

        <SubHeading>Project overview</SubHeading>
        <P>
          The project detail page opens on <strong>Overview</strong>: stat cards for chats, tasks, notes, and files,
          plus recent items with links to filtered Tasks/Notes pages or the chat view. Use <strong>Brief &amp; settings</strong>
          to edit context fields, model, collection, pinned URLs, and uploads.
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
          session using the model picker in the chat header. Both Anthropic and Google models are available.
        </P>
        <UL>
          <LI><strong>⚡ Haiku 4.5 (Economy)</strong> — Fast and affordable. Best for quick tasks, drafts, and Q&amp;A.</LI>
          <LI><strong>⚖️ Sonnet 4.6 (Standard)</strong> — Smart and balanced. Best for most work — code, writing, analysis.</LI>
          <LI><strong>🧠 Opus 4.6 (Premium)</strong> — Most capable. Best for complex reasoning and deep analysis.</LI>
          <LI><strong>🔷 Gemini 2.0 Flash</strong> — Google's fast multimodal model. Great alternative for speed-sensitive tasks.</LI>
          <LI><strong>🔮 Gemini 2.5 Pro</strong> — Google's most capable model with deep reasoning. Comparable to Opus for complex tasks.</LI>
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
          Press <Kbd>⌘</Kbd><Kbd>N</Kbd>, select <strong>+ New chat</strong> from the session dropdown, or click
          <strong> Quick chat</strong> / a project in the sidebar. You land on a blank composer immediately — no modal.
          On an empty chat, use the <strong>Context</strong> dropdown to switch between Quick chat and any project
          before your first message.
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
          <LI>Click the trash icon in the chat header to delete the <em>current</em> session. A confirmation banner appears before anything is removed.</LI>
          <LI>To delete any session (including ones you are not currently in), open the session dropdown and hover over the session — a trash icon appears on the right. Click it, then confirm with <strong>Yes</strong>.</LI>
        </UL>

        <Divider />

        {/* ── Quick chat ── */}
        <SectionHeading id="general-chat">Quick chat</SectionHeading>
        <P>
          <strong>Quick chat</strong> is a project-free workspace for ad-hoc conversations — questions,
          quick tasks, and anything that does not need a project brief or pinned files. Sessions created here are
          stored like project sessions, but have no project context injected.
        </P>

        <SubHeading>Starting a chat</SubHeading>
        <UL>
          <LI>Click <strong>Quick chat</strong> at the top of the left sidebar (or the <strong>+</strong> beside it) — opens instantly.</LI>
          <LI>Click a project name in the sidebar to resume its latest chat, or start blank if none exist.</LI>
          <LI>Use the <strong>Recent</strong> list in the sidebar to jump back to any of your last five conversations.</LI>
          <LI>Navigate directly to <code>/chat</code> or <code>/projects/:id/chat</code>.</LI>
          <LI>Press <Kbd>⌘</Kbd><Kbd>N</Kbd> for a new chat in the current context.</LI>
        </UL>

        <SubHeading>Session list</SubHeading>
        <P>
          The sidebar shows your most recent quick chats under the <em>Quick chat</em> heading.
          Click any session to open it. The count badge expands or collapses the list.
          Session titles use the auto-generated name or the first line of your message — not internal IDs.
        </P>

        <Callout type="tip">
          Quick chat still respects your active Persona and global Memory — preferences apply even without project context.
        </Callout>

        <Divider />

        {/* ── Chat History ── */}
        <SectionHeading id="history">Chat History</SectionHeading>
        <P>
          The <strong>Chat History</strong> browser shows every chat session across all projects and
          Quick chat in one place, filterable by date and searchable by content.
        </P>

        <SubHeading>Opening Chat History</SubHeading>
        <UL>
          <LI>Click the <strong>clock icon</strong> in the top navigation bar.</LI>
          <LI>Navigate directly to <code>/history</code>.</LI>
          <LI>Click <strong>Chat History</strong> at the bottom of the left sidebar.</LI>
        </UL>

        <SubHeading>Date filters</SubHeading>
        <P>
          Use the filter chips at the top to narrow sessions by time period:
        </P>
        <UL>
          <LI><strong>All time</strong> — every session ever (default).</LI>
          <LI><strong>Today / Yesterday</strong> — sessions from those days.</LI>
          <LI><strong>This week / Last 7 days / This month / Last month / Last 30 days</strong> — rolling window filters.</LI>
          <LI><strong>Custom</strong> — reveals two date pickers so you can set an exact from/to range.</LI>
        </UL>

        <SubHeading>Search</SubHeading>
        <P>
          The search box filters sessions in real time by title, project name, or the content of the
          last message. Useful for finding a session when you remember a phrase but not the date.
          From an expanded project in the sidebar, <strong>View all N chats →</strong> opens History
          pre-filtered to that project (<code>/history?projectId=</code>).
        </P>

        <SubHeading>Navigating to a session</SubHeading>
        <P>
          Click any row to open that session. Vault navigates to the correct project chat (or General
          Chat) and loads the session automatically.
        </P>

        <Divider />

        {/* ── Web Search ── */}
        <SectionHeading id="web-search">Web Search</SectionHeading>
        <P>
          Use <code>@search</code> in any chat to fetch live web results and attach them as context
          before sending your message. This lets Claude answer questions that require up-to-date
          information beyond its training data.
        </P>

        <SubHeading>How to use @search</SubHeading>
        <UL>
          <LI>Type <strong>@</strong> in the chat input to open the mention menu, then select <strong>Search the web</strong>.</LI>
          <LI>A search box appears — type your query and press <Kbd>Enter</Kbd>.</LI>
          <LI>Results are shown in the panel with title, snippet, and a clickable URL for each.</LI>
          <LI>Click <strong>Add all</strong> to attach all results as URL context chips, or click individual URLs to add them selectively.</LI>
          <LI>Click <strong>Done</strong> to close the panel and return to the chat input.</LI>
        </UL>

        <SubHeading>How results are used</SubHeading>
        <P>
          Each attached URL is fetched server-side and its text content is included in your message
          as context — the same as manually adding a URL via the link icon. Claude receives the full
          page text and can summarise, compare, or answer questions about it.
        </P>

        <Callout type="info">
          Web search requires a <strong>SEARCH_API_KEY</strong> to be configured. Vault auto-detects
          the provider from the key format: Brave Search (keys starting with <code>BSA</code>),
          Serper.dev (40-character hex keys), or SerpAPI (all others).
        </Callout>

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
          Memories use semantic embeddings. On your Mac (<code>APP_ENV=local</code>), Vault uses Ollama
          (<code>nomic-embed-text</code> by default). On Railway, it uses the Gemini embedding model
          in Settings → AI Models → Embedding model. In each chat, Vault selects relevant notes for your
          current message instead of injecting your entire list.
        </P>

        <SubHeading>Semantic search</SubHeading>
        <P>
          Use the search field to find memories by meaning, not just exact words. Results update as you type.
        </P>

        <SubHeading>Stats</SubHeading>
        <P>
          The page shows how many memories are stored, how many are searchable (embedded), and when the latest was added.
          If embeddings are unavailable locally, a warning explains what to configure (Ollama + pgvector).
          Vault may also add an item to <strong>Suggestions</strong> automatically.
        </P>

        <SubHeading>Removing a memory</SubHeading>
        <P>Click the trash icon on any memory row to delete it.</P>

        <Callout type="warning">
          Keep memories concise and factual. Vague or contradictory entries may confuse Claude.
          Review your memory list occasionally and remove anything that is outdated.
        </Callout>

        <Divider />

        {/* ── Suggestions ── */}
        <SectionHeading id="suggestions">Suggestions</SectionHeading>
        <P>
          The suggestions inbox collects findings from AI agents and automated routines — things you might
          want to act on later: missing Cursor rules, skill ideas, automation opportunities, code anomalies,
          or config alerts.
        </P>

        <SubHeading>Accessing Suggestions</SubHeading>
        <P>
          Open <strong>Apps</strong> (grid icon) in the top bar → <strong>Admin</strong> → <strong>Suggestions</strong>
          (or navigate to <code>/suggestions</code>). A badge on the Apps icon shows how many items are still <strong>new</strong>.
        </P>

        <SubHeading>Categories</SubHeading>
        <UL>
          <LI><strong>Rule</strong> — design doc or Cursor rule gaps</LI>
          <LI><strong>Skill</strong> — repetitive patterns worth codifying</LI>
          <LI><strong>Automation</strong> — cron, hook, or script opportunities</LI>
          <LI><strong>Source</strong> — specific file or config findings</LI>
          <LI><strong>Alert</strong> — warnings and misconfigurations</LI>
          <LI><strong>Other</strong> — anything else</LI>
        </UL>

        <SubHeading>Status workflow</SubHeading>
        <P>
          Each suggestion has a status you set while triaging:
        </P>
        <UL>
          <LI><strong>New</strong> — just added (default)</LI>
          <LI><strong>Opened</strong> — you've seen it</LI>
          <LI><strong>Implement</strong> — creates a task or note (or opens the relevant page) and marks the item done</LI>
          <LI><strong>Learn</strong> — revisit later</LI>
          <LI><strong>Ignore</strong> — dismiss</LI>
        </UL>

        <SubHeading>What Implement does</SubHeading>
        <UL>
          <LI><strong>Rule</strong> — draft note with suggested Cursor rule text and save path</LI>
          <LI><strong>Skill</strong> — draft note with SKILL.md outline</LI>
          <LI><strong>Automation</strong> — high-priority task tagged for automation work</LI>
          <LI><strong>Source</strong> — task with file/context in the description</LI>
          <LI><strong>Alert</strong> — opens the relevant settings page when Vault can detect it; otherwise a fix task</LI>
          <LI><strong>Other</strong> — standard task with the suggestion details</LI>
        </UL>
        <P>
          After Implement, use <strong>Open task</strong> or <strong>Open note</strong> on the card to jump to what was created.
          Clicking Implement again on the same item reopens the existing result without duplicating.
        </P>

        <SubHeading>How items arrive</SubHeading>
        <P>
          Suggestions are created automatically when Vault detects something worth your attention — you do not
          need to watch logs or chat for these. Emitters include:
        </P>
        <UL>
          <LI><strong>Server startup</strong> — missing pgvector, embeddings unavailable</LI>
          <LI><strong>News Digest cron</strong> — topics with no articles, analysis failures, high token cost</LI>
          <LI><strong>Shares cron</strong> — missing API keys, quote poll or briefing errors</LI>
          <LI><strong>Memory</strong> — embedding or searchability problems (when you open the Memory page)</LI>
          <LI><strong>Cursor agents</strong> — after substantial code work, via the shared suggestion service</LI>
        </UL>
        <P>
          Each card shows <strong>via source-name</strong> (e.g. <code>newsDigestCron</code>) so you know where it came from.
          Repeat findings refresh the same open item instead of flooding the inbox.
        </P>

        <SubHeading>Filtering</SubHeading>
        <P>
          Use the category and status filter chips to narrow the list. Search matches title, body, and context
          (e.g. a file path). You can also add suggestions manually with <strong>Add manually</strong>.
        </P>

        <Callout type="tip">
          As Vault matures, you should see fewer suggestions — that means fewer anomalies, not a broken inbox.
          Use <strong>Ignore</strong> for items you do not care about; ignored fingerprints can be suggested again later if the issue returns.
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

        {/* ── Collections (folders) ── */}
        <SectionHeading id="folders">Collections</SectionHeading>
        <P>
          <strong>Collections</strong> (sidebar folders) group projects in the sidebar. They do <em>not</em>
          organise individual chats — only project rows. Use projects (or move a quick chat into a project)
          when you want brief and file context.
        </P>

        <SubHeading>Creating a collection</SubHeading>
        <UL>
          <LI>In the sidebar, click the <strong>folder-plus</strong> icon (next to the project + button).</LI>
          <LI>Type a name and press Enter.</LI>
          <LI>The collection appears in the sidebar with a chevron toggle.</LI>
        </UL>

        <SubHeading>Assigning projects to collections</SubHeading>
        <UL>
          <LI>Open a project's detail page.</LI>
          <LI>In the <strong>Organisation</strong> section, choose a collection from the dropdown.</LI>
          <LI>Save — the project appears nested under that collection in the sidebar.</LI>
          <LI>Or drag a project row onto a collection header in the sidebar.</LI>
        </UL>

        <SubHeading>Opening a project from the sidebar</SubHeading>
        <P>
          Click the <strong>project name</strong> to enter the project (opens the latest chat, or a blank chat if none exist).
          Click the <strong>chevron</strong> to expand recent sessions without leaving the sidebar.
          Use the <strong>⋯</strong> menu for new chat, overview, move to collection, rename, archive, or delete.
          When a project has more than ten chats, <strong>View all N chats →</strong> opens Chat History filtered to that project.
        </P>

        <SubHeading>Collapsing collections</SubHeading>
        <P>
          Click a collection header to collapse or expand its projects. Collapse state resets on page reload.
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

        <Divider />

        {/* ── Tasks ── */}
        <SectionHeading id="tasks">Tasks</SectionHeading>
        <P>
          The Tasks workspace (<strong>/tasks</strong>) is a full personal task manager built into Vault.
          Capture, organise, and track work items alongside your AI conversations — with three views,
          smart filters, recurring tasks, templates, effort estimation, CSV import, public sharing,
          and AI-assisted capture. Tasks can be linked to Goals Key Results for progress tracking.
        </P>

        <SubHeading>Views</SubHeading>
        <P>Switch between three views using the icons in the top-right of the Tasks toolbar, or press <Kbd>b</Kbd> to cycle through them.</P>
        <UL>
          <LI><strong>List view</strong> — tasks grouped by category, drag-to-reorder within groups, expandable rows with subtasks and comments.</LI>
          <LI><strong>Board view</strong> — Kanban with three columns: To Do, In Progress, Done. Drag cards within a column to reorder, or across columns to change status.</LI>
          <LI><strong>Calendar view</strong> — Day, Week, Month, and Range sub-views. Drag task pills between date cells to reschedule. Click any day to see a detail panel. Use the <strong>+ Add</strong> button on a date to create a task pre-filled with that date.</LI>
        </UL>

        <SubHeading>Creating Tasks</SubHeading>
        <UL>
          <LI>Click <strong>New Task</strong> (top-right) or press <Kbd>n</Kbd> to open the full creation form.</LI>
          <LI>Fields: title, notes, status, priority, due date &amp; time, recurrence, category, tags, project, parent task, effort estimate, and optional Key Result link.</LI>
          <LI>Press <Kbd>Enter</Kbd> in the title field to save immediately.</LI>
          <LI>Click <strong>+ Save as template</strong> at the bottom of the form to turn the task into a reusable template.</LI>
        </UL>

        <SubHeading>Quick Capture</SubHeading>
        <P>
          A floating <strong>+</strong> button appears in the bottom-right corner of every page.
          Click it (or press <Kbd>Ctrl+Shift+N</Kbd>) to open a minimal capture modal — just title,
          priority, and optional due date. The task is created instantly without leaving your current page.
        </P>

        <SubHeading>Filtering &amp; Sorting</SubHeading>
        <UL>
          <LI>Press <Kbd>/</Kbd> to focus the search box. Press <Kbd>f</Kbd> to cycle quick-filters: All → Today → This Week → High Priority → Overdue.</LI>
          <LI>Press <Kbd>1</Kbd> / <Kbd>2</Kbd> / <Kbd>3</Kbd> to filter by To Do / In Progress / Done.</LI>
          <LI>Use the Sort dropdown to order by due date, priority, created date, or A–Z.</LI>
          <LI>Filter by project or category using the dropdowns in the toolbar.</LI>
        </UL>

        <SubHeading>Recurring Tasks</SubHeading>
        <P>
          Set a recurrence on any task with a due date: Daily, Weekly, Fortnightly, Monthly, or Annually.
          When you mark a recurring task as Done, a new copy is automatically created with the next due date.
          A <strong>↻</strong> badge shows on the task with a count of how many times it has recurred.
        </P>

        <SubHeading>Task Aging Indicator</SubHeading>
        <P>
          Any task sitting in <strong>To Do</strong> for more than 7 days displays an amber <strong>⏱ clock icon</strong> as a gentle nudge to take action. The indicator appears in all three views.
        </P>

        <SubHeading>Morning Digest</SubHeading>
        <P>
          On your first visit each day, an overlay appears summarising your overdue tasks and tasks due today,
          along with a Claude-generated suggestion for what to focus on first. Dismiss it with
          <strong> Got it — let's go</strong> and it won't appear again until the next day.
        </P>

        <SubHeading>Subtasks</SubHeading>
        <UL>
          <LI>Expand any task row (click the title) to reveal the subtasks panel.</LI>
          <LI>Type in the subtask input and press Enter to add. Click the circle to complete.</LI>
          <LI>Use <strong>Generate with AI</strong> to have Claude suggest subtasks based on the task title and notes.</LI>
        </UL>

        <SubHeading>Comments &amp; Activity Log</SubHeading>
        <P>
          Each task has a comment thread visible in the expanded row. System events (status change,
          priority change, due date change) are logged automatically. Add your own notes at any time.
        </P>

        <SubHeading>Bulk Actions</SubHeading>
        <UL>
          <LI>Hover any task row to reveal a checkbox. Tick one or more tasks to enter bulk mode.</LI>
          <LI>Bulk actions: mark Done, move to In Progress, change priority, set category, or delete.</LI>
          <LI>Click <strong>Select all</strong> to grab all visible tasks at once.</LI>
        </UL>

        <SubHeading>Templates</SubHeading>
        <P>
          Click the <strong>Templates</strong> button in the toolbar to open the templates panel.
          Create reusable task templates with predefined priority, category, and subtasks.
          Click <strong>Use</strong> on a template to instantly create a task from it.
        </P>

        <SubHeading>Effort Estimation</SubHeading>
        <P>
          Add an effort estimate to any task to plan your week and see a <strong>Total Effort</strong> stat
          in the toolbar. In the task form, click a quick-select preset (<strong>15m, 30m, 1h, 2h, 4h, 1d, 2d</strong>)
          or type a custom value like <Kbd>45m</Kbd>, <Kbd>3h</Kbd>, or <Kbd>1.5h</Kbd>. The estimate appears
          as a pill on task cards and is included in Weekly Review's week-ahead effort total.
        </P>

        <SubHeading>Weekly Review</SubHeading>
        <P>
          Press <Kbd>w</Kbd> or click <strong>Weekly Review</strong> in the toolbar to open the 3-step guided review modal:
        </P>
        <UL>
          <LI><strong>Step 1 — Last week recap:</strong> See all tasks completed during the previous Mon–Sun, grouped by category.</LI>
          <LI><strong>Step 2 — Overdue &amp; carry-forward:</strong> Work through overdue tasks — mark done, reschedule with preset buttons (Tomorrow / Next Week / +1 month), or remove the due date entirely.</LI>
          <LI><strong>Step 3 — Week ahead:</strong> View tasks due in the next 7 days grouped by day, your total estimated effort for the week, Claude's suggestions for focus, a quick-add input for new tasks, and a live progress update panel for your active Goals.</LI>
        </UL>

        <SubHeading>Import from CSV</SubHeading>
        <P>
          Click <strong>Import</strong> in the toolbar to bulk-import tasks from a CSV file.
          Download the template first to see the expected columns: <em>title, notes, priority, status, category, dueDate, tags, projectId</em>.
          After uploading, a preview table shows each row with validation — invalid rows (missing title, bad priority, wrong date format) are highlighted in red and unchecked.
          Select the rows you want and click <strong>Import</strong>.
        </P>

        <SubHeading>Public Task Sharing</SubHeading>
        <P>
          Hover over any task card and click the <strong>share icon</strong> that appears to generate a public share link.
          Anyone with the link can view a read-only version of the task (title, priority, status, notes, tags, subtasks)
          without needing to log in. Click <strong>Revoke</strong> in the share popover to delete the link at any time.
        </P>

        <SubHeading>Link Tasks to Goals</SubHeading>
        <P>
          In the task creation or edit form, scroll to the <strong>Link to Goal</strong> field.
          First pick an Objective, then select a Key Result within it.
          Linked tasks show a <strong>🎯</strong> badge with the Key Result name on the card.
          Completed linked tasks automatically count toward the Key Result's task progress in the Goals page.
        </P>

        <SubHeading>Extracting Tasks from Chat</SubHeading>
        <P>
          In any project chat, click the <strong>Extract tasks</strong> button to have Claude scan
          the conversation and pull out all action items as tasks automatically.
        </P>

        <SubHeading>@mention Tasks in Chat</SubHeading>
        <P>
          In the chat input, type <Kbd>@</Kbd> to open the mention dropdown. Scroll to the <strong>Tasks</strong>
          section to attach a task's details as context to your message. The task title, notes, and due date
          are injected into the conversation automatically.
        </P>

        <SubHeading>Task Search</SubHeading>
        <P>
          Press <Kbd>Ctrl+K</Kbd> (or <Kbd>⌘K</Kbd>) to open the global command palette.
          Type any keyword — tasks matching by title or notes appear under a <strong>Tasks</strong> section alongside projects, files, and messages.
        </P>

        <SubHeading>Keyboard Shortcuts</SubHeading>
        <UL>
          <LI><Kbd>n</Kbd> — New task</LI>
          <LI><Kbd>w</Kbd> — Open Weekly Review</LI>
          <LI><Kbd>/</Kbd> — Focus search</LI>
          <LI><Kbd>f</Kbd> — Cycle quick filters</LI>
          <LI><Kbd>1</Kbd> / <Kbd>2</Kbd> / <Kbd>3</Kbd> — Filter by status</LI>
          <LI><Kbd>b</Kbd> — Cycle view (List → Board → Calendar)</LI>
          <LI><Kbd>?</Kbd> — Show all shortcuts</LI>
          <LI><Kbd>Ctrl+Shift+N</Kbd> — Quick capture from anywhere</LI>
          <LI><Kbd>Esc</Kbd> — Close form / deselect / clear filter</LI>
        </UL>

        <Callout type="tip">
          Hover over any task to see its notes in a pop-up tooltip — works in List, Board, and Calendar views.
        </Callout>

        {/* ── Goals ── */}
        <SectionHeading id="goals">Goals</SectionHeading>
        <P>
          The Goals workspace (<strong>/goals</strong>) brings OKR-style goal tracking to Vault.
          Set high-level <strong>Objectives</strong>, break them down into measurable <strong>Key Results</strong>,
          and link your daily tasks to track real progress. A Goals summary widget also appears on the home page
          and in the Weekly Review's week-ahead step.
        </P>

        <SubHeading>Objectives</SubHeading>
        <P>
          An Objective is a qualitative, inspiring goal with a timeframe (e.g. <em>Q2 2026</em>).
          Click <strong>New</strong> in the Goals sidebar to create one. Each Objective has:
        </P>
        <UL>
          <LI>A <strong>title</strong> and optional <strong>description</strong></LI>
          <LI>A <strong>timeframe</strong> label (free text — Q1 2026, H1, This year, etc.)</LI>
          <LI>A <strong>colour</strong> (choose from 6 swatches) used across all progress bars</LI>
          <LI>A <strong>status</strong>: Active, Completed, or Paused</LI>
          <LI>An <strong>overall progress %</strong> automatically averaged from all its Key Results</LI>
        </UL>
        <P>Click any Objective in the left panel to open its detail view. Click the title, description, or timeframe inline to edit — changes save on blur.</P>

        <SubHeading>Key Results</SubHeading>
        <P>
          Key Results are quantitative measures that define what success looks like for an Objective.
          Each KR has a <strong>target value</strong>, <strong>current value</strong>, and a <strong>unit</strong> (%, tasks, calls, $, etc.).
        </P>
        <UL>
          <LI>Click <strong>+ Add KR</strong> in the detail panel to create a Key Result manually.</LI>
          <LI>Click the current value on a KR row to edit it inline — blur or press Enter to save.</LI>
          <LI>Progress bars colour green (≥70%), amber (30–69%), or red (&lt;30%) based on completion.</LI>
          <LI>Each KR also shows how many linked tasks have been completed vs. total linked tasks.</LI>
        </UL>

        <SubHeading>AI Suggest Key Results</SubHeading>
        <P>
          With an Objective selected, click <strong>AI Suggest</strong> to stream Claude-generated SMART Key Results
          for that objective. Suggestions appear as cards with a target value and unit — click <strong>Add</strong>
          to instantly create a KR from a suggestion.
        </P>

        <SubHeading>Linking Tasks to Key Results</SubHeading>
        <P>
          In the task creation or edit form, use the <strong>Link to Goal</strong> dropdown to associate a task with a
          specific Key Result. First select the Objective, then pick the KR. A <strong>🎯</strong> badge with the
          KR title appears on the task card. Completed linked tasks increment the KR's task counter on the Goals page.
        </P>

        <SubHeading>Goals on the Home Page</SubHeading>
        <P>
          The home page (<strong>/</strong>) shows a <strong>Goals widget</strong> above the Tasks widget
          whenever you have at least one active Objective. It displays the count of active goals, average
          progress, and mini progress bars for your top 3 Objectives. Click <strong>View all goals →</strong>
          to jump to the Goals page.
        </P>

        <SubHeading>Goals in Weekly Review</SubHeading>
        <P>
          Step 3 of the Weekly Review (Week ahead) includes a <strong>Your Goals</strong> section listing
          all active Objectives with their Key Results. Click any KR's current value to update it inline
          — a great habit to build into your end-of-week routine.
        </P>

        <Callout type="tip">
          The overall progress % on an Objective is the simple average of all its Key Results' individual progress percentages — not weighted by target value.
        </Callout>

        {/* ── Prompt Chains ── */}
        <SectionHeading id="chains">Prompt Chains</SectionHeading>
        <P>
          Prompt Chains (<strong>/chains</strong>) let you build reusable multi-step AI pipelines where the output of each
          step automatically becomes the input for the next. Use them for complex workflows that would be tedious to
          run manually — blog posts, code reviews, meeting note processing, and more.
        </P>

        <SubHeading>Creating a Chain</SubHeading>
        <P>
          Click <strong>+</strong> in the Chains sidebar to create a new chain, or pick one of the three built-in
          starter templates (Blog Post Generator, Code Review Pipeline, Meeting Notes Processor) that appear when
          your list is empty. Give the chain a name, an optional description, and add steps using the <strong>Add step</strong> button.
        </P>

        <SubHeading>Building Steps</SubHeading>
        <P>Each step has three fields:</P>
        <UL>
          <LI><strong>Label</strong> — a short name shown during the run (optional but helpful).</LI>
          <LI><strong>Prompt</strong> — the instruction for this step. Use template variables to pass context between steps.</LI>
          <LI><strong>Model</strong> — choose any available Claude or Gemini model per step. Use a faster/cheaper model for straightforward steps and a more capable model for complex ones.</LI>
        </UL>
        <P>
          Reorder steps with the ↑ / ↓ arrows, or remove a step with ✕. Changes are saved when you click <strong>Save</strong>.
        </P>

        <SubHeading>Template Variables</SubHeading>
        <UL>
          <LI><strong>{'{{input}}'}</strong> — the initial content you provide when running the chain (available in every step).</LI>
          <LI><strong>{'{{output}}'}</strong> — the full output of the immediately preceding step.</LI>
          <LI><strong>{'{{step_1}}'}</strong>, <strong>{'{{step_2}}'}</strong>… — the output of a specific step by its position number. Useful when a later step needs to combine outputs from multiple earlier steps.</LI>
        </UL>

        <SubHeading>Running a Chain</SubHeading>
        <P>
          Click <strong>▶ Run</strong> in the editor toolbar to open the run modal. Paste or type your initial input,
          then click <strong>Run Chain</strong>. Each step streams its output live — you can see progress in real time
          as the chain works through every stage. When a step finishes, its output card shows a <strong>Copy</strong>
          button so you can grab the result immediately. After the final step completes, a green <em>Chain complete ✓</em>
          banner appears. Use <strong>Run Again</strong> to re-run with the same or different input.
        </P>

        <Callout type="tip">
          Mix models within a chain — for example, use Claude Sonnet for complex reasoning steps and Claude Haiku for
          fast formatting or summarisation steps to keep costs low and speed high.
        </Callout>

        <div className="h-16" /> {/* Bottom padding */}
      </main>
    </div>
  );
}

export default UserGuidePage;
