// The enhanced ("Rich") note editor's settings, kept apart from React so a test can run the same editor with no screen:
//   node client/src/pages/notes/richEditorConfig.test.mjs
// A note is always stored as plain Markdown text. Rich only changes how it is edited, so search, Ask, Preview, the AI actions and
// the recycle bin never need to know which editor was used.
import StarterKit from '@tiptap/starter-kit';
import HardBreak from '@tiptap/extension-hard-break';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from 'tiptap-markdown';

// Preview shows a single line break as a line break (remark-breaks), so Rich writes one as a plain new line too, not the
// backslash tiptap-markdown would add. Inside a table cell a line break cannot be plain text, so it is left to the library there.
const PlainBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent, index) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              state.write(state.inTable ? ' ' : '\n');
              return;
            }
          }
        },
        parse: {}, // handled by the Markdown parser (breaks: true)
      },
    };
  },
});

// tiptap-markdown only marks bullet and numbered lists as "tight" (no blank line between items); a to-do list would be written with one.
const TightTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), tight: { default: true, parseHTML: () => true, renderHTML: () => ({}) } };
  },
});

export function buildExtensions({ placeholder = '' } = {}) {
  return [
    StarterKit.configure({
      hardBreak: false,
      underline: false, // Markdown has no underline, so it would be lost on saving
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
    }),
    PlainBreak,
    TightTaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder }),
    Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', breaks: true, linkify: false, transformPastedText: true, transformCopiedText: false }),
  ];
}

/** The Markdown text of what the editor now holds (no trailing blank lines: a table would otherwise end with one). */
export function editorMarkdown(editor) {
  return editor.storage.markdown
    .getMarkdown()
    // tiptap-markdown writes < > & as entities; Preview shows the plain character either way, and Write/search/Ask should too
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+$/, '');
}

const words = (t) => String(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const taskMarks = (t) => (String(t).match(/^\s*[-*+]\s+\[[ xX]\]/gm) || []).length;
const listItems = (t) => (String(t).match(/^\s*(?:[-*+]|\d+[.)])\s/gm) || []).length;

/**
 * True when the Rich editor would change what a note says, not only how it is spaced or marked up: different words, a different
 * number of list items or to-dos (for example one list that mixes bullets and to-dos). The page then asks before letting Rich edit it.
 */
export function roundTripChangesMeaning(source, rewritten) {
  return words(source) !== words(rewritten) || taskMarks(source) !== taskMarks(rewritten) || listItems(source) !== listItems(rewritten);
}
