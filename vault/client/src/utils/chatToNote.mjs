// Turning a chat reply, or a whole chat, into a note. Pure (no React, no fetch) so it is unit-tested:
//   node client/src/utils/chatToNote.test.mjs
// The note is ordinary Markdown text like any other note; nothing about it remembers it came from a chat except one line at the end.

const MAX_TITLE = 80;

const clip = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The first line worth being a title: a heading if there is one, otherwise the first line of text, with Markdown symbols taken off. */
function firstLine(content) {
  for (const raw of String(content || '').split('\n')) {
    const line = raw.replace(/^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').replace(/[*_`~]/g, '').trim();
    if (line) return line;
  }
  return '';
}

const footer = (chatTitle) => (chatTitle ? `\n\n---\nSaved from the chat "${clip(chatTitle, 100)}".` : '');

/** One reply as a note: titled by its first line (or the chat's name), the reply as written, a line saying where it came from. */
export function replyToNote(content, chatTitle) {
  const body = String(content || '').trim();
  const title = clip(firstLine(body), MAX_TITLE) || clip(chatTitle, MAX_TITLE) || 'Chat reply';
  return { title, body: `${body}${footer(chatTitle)}` };
}

/** A whole chat as a note: the chat's name, then each message under who said it. Empty messages are left out. */
export function chatToNote(messages, chatTitle) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim());
  const firstQuestion = list.find((m) => m.role === 'user')?.content;
  const title = clip(chatTitle, MAX_TITLE) || clip(firstQuestion, MAX_TITLE) || 'Chat';
  const body = list.map((m) => `**${m.role === 'user' ? 'You' : 'Assistant'}:**\n${String(m.content).trim()}`).join('\n\n');
  return { title, body: `${body}${footer(chatTitle)}`, count: list.length };
}
