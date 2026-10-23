import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import Tooltip from '../../components/Tooltip';
import { useIcon } from '../../providers/IconProvider';
import { NOTE_TIPS } from './noteTips.mjs';
import { buildExtensions, editorMarkdown, roundTripChangesMeaning } from './richEditorConfig.mjs';

// The enhanced editor, opened on demand from the Write / Rich / Preview switch (lazy-loaded: this file and Tiptap are only
// fetched the first time someone picks Rich). The note is still the same Markdown text: `value` goes in, `onChange(markdown)`
// comes out, and only when the person actually edits, so merely opening a note never rewrites it.

const GROUPS = [
  [
    { id: 'bold', label: 'B', style: { fontWeight: 700 }, active: (e) => e.isActive('bold'), run: (c) => c.toggleBold() },
    { id: 'italic', label: 'I', style: { fontStyle: 'italic' }, active: (e) => e.isActive('italic'), run: (c) => c.toggleItalic() },
    { id: 'strike', icon: 'strikethrough', active: (e) => e.isActive('strike'), run: (c) => c.toggleStrike() },
  ],
  [
    { id: 'h1', label: 'H1', active: (e) => e.isActive('heading', { level: 1 }), run: (c) => c.toggleHeading({ level: 1 }) },
    { id: 'h2', label: 'H2', active: (e) => e.isActive('heading', { level: 2 }), run: (c) => c.toggleHeading({ level: 2 }) },
    { id: 'h3', label: 'H3', active: (e) => e.isActive('heading', { level: 3 }), run: (c) => c.toggleHeading({ level: 3 }) },
  ],
  [
    { id: 'bullet', icon: 'list', active: (e) => e.isActive('bulletList'), run: (c) => c.toggleBulletList() },
    { id: 'numbered', label: '1.', active: (e) => e.isActive('orderedList'), run: (c) => c.toggleOrderedList() },
    { id: 'todo', icon: 'check-square', active: (e) => e.isActive('taskList'), run: (c) => c.toggleTaskList() },
  ],
  [
    { id: 'quote', label: '“', active: (e) => e.isActive('blockquote'), run: (c) => c.toggleBlockquote() },
    { id: 'code', label: '</>', style: { fontFamily: 'monospace', fontSize: 11 }, active: (e) => e.isActive('codeBlock'), run: (c) => c.toggleCodeBlock() },
    { id: 'rule', icon: 'minus', active: () => false, run: (c) => c.setHorizontalRule() },
  ],
];

function ToolButton({ def, editor, mobile, onLink, onTouch }) {
  const getIcon = useIcon();
  const active = def.active(editor);
  const size = mobile ? 36 : 26;
  const press = () => { onTouch?.(); if (def.id === 'link') onLink(); else def.run(editor.chain().focus()).run(); };
  return (
    <Tooltip text={NOTE_TIPS.richBar[def.id]}>
      <button
        type="button"
        // keep the text selection: pressing a button must not take focus from the editor
        onMouseDown={(e) => e.preventDefault()}
        onClick={press}
        aria-pressed={active}
        aria-label={NOTE_TIPS.richBar[def.id].split(':')[0]}
        className="flex items-center justify-center rounded text-xs transition-opacity duration-200 hover:opacity-70 flex-shrink-0"
        style={{ minWidth: size, height: size, padding: '0 6px', background: active ? 'var(--color-primary)' : 'transparent', color: active ? '#fff' : 'var(--color-text)', ...def.style }}
      >{def.icon ? getIcon(def.icon, { size: 14 }) : def.label}</button>
    </Tooltip>
  );
}

export default function RichNoteEditor({ value, onChange, readOnly = false, mobile = false, placeholder = '', onPasteFiles, onUseWrite }) {
  const getIcon = useIcon();
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange);
  const pasteRef = useRef(onPasteFiles);
  onChangeRef.current = onChange;
  pasteRef.current = onPasteFiles;
  // Nothing is saved until the person actually does something in the editor: opening a note must never rewrite it, whatever the
  // editor tidies up while it loads.
  const touched = useRef(false);
  const [lossy, setLossy] = useState(false); // this note cannot be held exactly by Rich: ask before editing
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    extensions: buildExtensions({ placeholder }),
    content: value || '',
    editable: !readOnly,
    editorProps: {
      attributes: { 'aria-label': 'Note text', class: 'notes-rich-doc' },
      handleDOMEvents: {
        keydown: () => { touched.current = true; return false; },
        beforeinput: () => { touched.current = true; return false; },
        cut: () => { touched.current = true; return false; },
        drop: () => { touched.current = true; return false; },
        click: (_view, e) => { if (e.target?.tagName === 'INPUT') touched.current = true; return false; },
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length || !pasteRef.current) return false;
        pasteRef.current(files);
        return true;
      },
      // pasted text is an edit too
      transformPasted: (slice) => { touched.current = true; return slice; },
    },
    onUpdate: ({ editor: ed }) => {
      if (!touched.current) return;
      const md = editorMarkdown(ed);
      lastEmitted.current = md;
      onChangeRef.current?.(md);
    },
  });

  // The note's text changed somewhere else (another note opened, an AI result applied, dictation, a pulled-in email): show it.
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

  // Is this a note Rich would change? (Checked once, as it opens.)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setLossy(!!value && roundTripChangesMeaning(value, editorMarkdown(editor)));
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!readOnly && !lossy); }, [readOnly, lossy, editor]);
  useEffect(() => { if (editor && !editor.isDestroyed && !readOnly && !mobile) editor.commands.focus('end'); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // re-render the toolbar as the cursor moves (which buttons are lit, whether a table is under the cursor)
  useEditorState({ editor, selector: ({ editor: ed }) => (ed ? `${ed.state.selection.from}:${ed.state.selection.to}:${ed.isActive('link')}:${ed.isActive('table')}:${ed.can().undo()}:${ed.can().redo()}` : '') });

  if (!editor || editor.isDestroyed) return <p className="px-4 py-2 text-sm" style={{ color: 'var(--color-muted)' }}>Opening the editor…</p>;

  const touch = () => { touched.current = true; };
  const inTable = editor.isActive('table');
  const small = { minHeight: mobile ? 36 : 26, color: 'var(--color-text)', border: '1px solid var(--color-border)', background: 'var(--color-bg)' };

  function openLink() {
    setLinkUrl(editor.getAttributes('link').href || 'https://');
    setLinkOpen(true);
  }
  function applyLink() {
    touched.current = true;
    const url = linkUrl.trim();
    if (url && url !== 'https://') {
      const safe = /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`;
      editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
    }
    setLinkOpen(false);
  }
  function removeLink() {
    touched.current = true;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" data-tour="notes-rich">
      <style>{`
        .notes-rich-doc { outline: none; min-height: 100%; color: var(--color-text); overflow-wrap: anywhere; line-height: 1.6; font-size: ${mobile ? 16 : 14}px; }
        .notes-rich-doc > * + * { margin-top: 0.6em; }
        .notes-rich-doc h1 { font-size: 1.5em; font-weight: 700; line-height: 1.25; }
        .notes-rich-doc h2 { font-size: 1.25em; font-weight: 700; line-height: 1.3; }
        .notes-rich-doc h3 { font-size: 1.1em; font-weight: 600; }
        .notes-rich-doc ul:not([data-type="taskList"]) { list-style: disc; padding-left: 1.4em; }
        .notes-rich-doc ol { list-style: decimal; padding-left: 1.5em; }
        .notes-rich-doc li > p { margin: 0; }
        .notes-rich-doc ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
        .notes-rich-doc ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
        .notes-rich-doc ul[data-type="taskList"] li > label { flex: 0 0 auto; padding-top: 0.2em; }
        .notes-rich-doc ul[data-type="taskList"] li > div { flex: 1 1 auto; }
        .notes-rich-doc ul[data-type="taskList"] input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--color-primary); cursor: pointer; }
        .notes-rich-doc ul[data-type="taskList"] li[data-checked="true"] > div { color: var(--color-muted); text-decoration: line-through; }
        .notes-rich-doc blockquote { border-left: 3px solid var(--color-border); padding-left: 12px; color: var(--color-muted); }
        .notes-rich-doc code { background: var(--color-surface); padding: 1px 4px; border-radius: 4px; font-size: 0.9em; }
        .notes-rich-doc pre { background: var(--color-surface); padding: 10px 12px; border-radius: 8px; overflow-x: auto; }
        .notes-rich-doc pre code { background: transparent; padding: 0; }
        .notes-rich-doc a { color: var(--color-primary); text-decoration: underline; cursor: text; }
        .notes-rich-doc hr { border: 0; border-top: 1px solid var(--color-border); margin: 1em 0; }
        .notes-rich-doc table { border-collapse: collapse; width: 100%; table-layout: fixed; }
        .notes-rich-doc th, .notes-rich-doc td { border: 1px solid var(--color-border); padding: 6px 8px; vertical-align: top; min-width: 3em; }
        .notes-rich-doc th { background: var(--color-surface); font-weight: 600; text-align: left; }
        .notes-rich-doc .selectedCell { background: var(--color-surface); }
        .notes-rich-doc p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--color-muted); float: left; height: 0; pointer-events: none; }
      `}</style>

      {lossy && (
        <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2 text-xs flex-shrink-0" style={{ background: '#f59e0b22', borderBottom: '1px solid #f59e0b', color: 'var(--color-text)' }} role="status">
          <span>Rich cannot keep this note exactly as it is (for example, one list that mixes bullets and to-dos). Editing it here may change it.</span>
          <span className="flex items-center gap-2">
            <Tooltip text={NOTE_TIPS.richBar.lossyWrite}><button type="button" onClick={() => onUseWrite?.()} className="px-3 rounded-lg font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 40 : 28 }}>Edit in Write</button></Tooltip>
            <Tooltip text={NOTE_TIPS.richBar.lossyEdit}><button type="button" onClick={() => setLossy(false)} className="px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...small, minHeight: mobile ? 40 : 28 }}>Edit here anyway</button></Tooltip>
          </span>
        </div>
      )}

      <div className="flex items-center gap-0.5 px-3 py-1 flex-shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-border)' }} role="toolbar" aria-label="Formatting">
        {GROUPS.map((group, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--color-border)', margin: '0 4px', flexShrink: 0 }} />}
            {group.map((def) => <ToolButton key={def.id} def={def} editor={editor} mobile={mobile} onTouch={touch} />)}
          </React.Fragment>
        ))}
        <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--color-border)', margin: '0 4px', flexShrink: 0 }} />
        <ToolButton def={{ id: 'link', icon: 'link', active: (e) => e.isActive('link') }} editor={editor} mobile={mobile} onLink={openLink} onTouch={touch} />
        <ToolButton def={{ id: 'table', label: '▦', active: (e) => e.isActive('table'), run: (c) => c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }) }} editor={editor} mobile={mobile} onTouch={touch} />
        <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--color-border)', margin: '0 4px', flexShrink: 0 }} />
        <ToolButton def={{ id: 'undo', label: '↶', active: () => false, run: (c) => c.undo() }} editor={editor} mobile={mobile} onTouch={touch} />
        <ToolButton def={{ id: 'redo', label: '↷', active: () => false, run: (c) => c.redo() }} editor={editor} mobile={mobile} onTouch={touch} />
      </div>

      {inTable && (
        <div className="flex items-center gap-1.5 px-3 py-1 flex-shrink-0 overflow-x-auto text-xs" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
          <span className="flex-shrink-0">Table:</span>
          {[['tableRow', 'Add row', () => editor.chain().focus().addRowAfter().run()],
            ['tableCol', 'Add column', () => editor.chain().focus().addColumnAfter().run()],
            ['tableDelRow', 'Delete row', () => editor.chain().focus().deleteRow().run()],
            ['tableDelCol', 'Delete column', () => editor.chain().focus().deleteColumn().run()],
            ['tableDelete', 'Delete table', () => editor.chain().focus().deleteTable().run()]].map(([id, label, run]) => (
            <Tooltip key={id} text={NOTE_TIPS.richBar[id]}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { touch(); run(); }} className="px-2 rounded transition-opacity duration-200 hover:opacity-70 flex-shrink-0" style={small}>{label}</button>
            </Tooltip>
          ))}
        </div>
      )}

      {linkOpen && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <input
            autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') setLinkOpen(false); }}
            aria-label="Link address" placeholder="https://…" className="flex-1 min-w-0 px-2 rounded text-sm outline-none" style={{ ...small, fontSize: mobile ? 16 : 13 }}
          />
          <Tooltip text={NOTE_TIPS.richBar.linkApply}><button type="button" onClick={applyLink} className="px-3 rounded text-xs font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: small.minHeight }}>Apply</button></Tooltip>
          {editor.isActive('link') && <Tooltip text={NOTE_TIPS.richBar.linkRemove}><button type="button" onClick={removeLink} className="px-2 rounded text-xs hover:opacity-70 transition-opacity duration-200" style={small}>Remove</button></Tooltip>}
          <button type="button" onClick={() => setLinkOpen(false)} className="px-2 rounded text-xs hover:opacity-70 transition-opacity duration-200" style={small} aria-label="Cancel">{getIcon('x', { size: 12 })}</button>
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto px-4 py-2"
        style={mobile ? { margin: '10px 12px', padding: '12px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 } : undefined}
        onClick={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end'); }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
