// node client/src/utils/chatToNote.test.mjs
import assert from 'node:assert';
import { replyToNote, chatToNote } from './chatToNote.mjs';

// a reply: titled by its heading, or its first line without Markdown symbols; says where it came from
assert.deepStrictEqual(replyToNote('## Oak pricing\n\nAbout $120 a metre.', 'Quote chat'),
  { title: 'Oak pricing', body: '## Oak pricing\n\nAbout $120 a metre.\n\n---\nSaved from the chat "Quote chat".' });
assert.strictEqual(replyToNote('**About** $120 a metre, installed.', '').title, 'About $120 a metre, installed.');
assert.strictEqual(replyToNote('- [ ] call Sam\n- [ ] send quote', 'x').title, 'call Sam');
assert.strictEqual(replyToNote('\n\n  \n', 'My chat').title, 'My chat', 'no text: the chat\'s name');
assert.strictEqual(replyToNote('', '').title, 'Chat reply');
assert.strictEqual(replyToNote('x'.repeat(200), '').title.length, 80);
assert.ok(replyToNote('x'.repeat(200), '').title.endsWith('…'));
assert.strictEqual(replyToNote('Hello', '').body, 'Hello', 'no chat name: no footer');

// a whole chat
const chat = chatToNote([
  { role: 'user', content: 'What do we charge for oak?' },
  { role: 'assistant', content: 'About $120 a metre.' },
  { role: 'assistant', content: '   ' },
  { role: 'system', content: 'ignored' },
  { role: 'user', content: 'And the install?' },
], 'Oak pricing');
assert.strictEqual(chat.title, 'Oak pricing');
assert.strictEqual(chat.count, 3);
assert.strictEqual(chat.body, '**You:**\nWhat do we charge for oak?\n\n**Assistant:**\nAbout $120 a metre.\n\n**You:**\nAnd the install?\n\n---\nSaved from the chat "Oak pricing".');
assert.strictEqual(chatToNote([{ role: 'user', content: 'Quote for the Hendersons please' }], '').title, 'Quote for the Hendersons please', 'no chat name: the first question');
assert.deepStrictEqual(chatToNote([], ''), { title: 'Chat', body: '', count: 0 });

console.log('ok - chat to note: titles, bodies, where it came from');
