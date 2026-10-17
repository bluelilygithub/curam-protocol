/*
 * Cellar Planner lite: the help chat for the website's planner page.
 *
 * Load this one file ONLY on the page that holds the planner (next to cellar-lite-fill.js). It adds a round help button in the bottom
 * right corner. A visitor types what they want to do ("how do I measure my room?"); the chat answers in plain words and its "Show me"
 * buttons take the planner to the right step. At the end the visitor can send the chat to your team.
 *
 *  - It stays hidden until you switch it on in Vault (Cellar Planner -> Settings -> Website help chat). Off there = no button on the site.
 *  - It never sees the visitor's design, never gives a price, and sends nothing until the visitor presses Send or asks a question.
 *  - "Send this chat to the team" emails YOUR admin address (set in Vault). Never an address the visitor types.
 *  - It must run in the page around the planner, not inside it: the planner's frame is as tall as the planner, so a button inside it
 *    would sit at the bottom of the page instead of staying on the screen.
 */
(function () {
  'use strict';

  // 1. Vault's public address (scheme + host, no trailing slash). The same one cellar-lite-fill.js posts enquiries to.
  var VAULT_URL = 'https://curam-vault.up.railway.app';
  // 2. The origin that serves the planner iframe, exactly as in the iframe's src (scheme + host, no path, no trailing slash).
  var PLANNER_ORIGIN = 'https://www.wiwc.com.au';
  // 3. The button's colour (white text goes on it). Default is the planner's olive; keep it dark enough to read.
  var ACCENT = '#4a5a2a';
  // 4. Set to false once everything works. While true, each step is written to the browser Console (F12), every line starting "[cellar-guide]".
  var DEBUG = false;
  function log() { if (DEBUG && window.console) console.log.apply(console, ['[cellar-guide]'].concat([].slice.call(arguments))); }

  if (window.__cellarGuideLoaded) return;
  window.__cellarGuideLoaded = true;

  var STARTERS = ['How do I measure my room?', 'What do the door settings mean?', 'How many bottles will fit?', 'How do I get a quote?'];
  var VERDICTS = { doable: 'Here is how', partly: 'Partly', missing: 'Not in the planner yet', beyond: 'Outside the planner', question: '' };
  var INTRO = 'Hi! Ask me how to use the planner, in your own words. I can take you to the right step. I cannot see your design or give prices: the team does that after a site measure.';

  var history = [];   // what the model is sent: [{ role, content }]
  var turns = [];     // what an emailed copy shows
  var currentStep = '';
  var busy = false, panel, list, input, sendBtn, teamBox, root, openBtn;

  function sameSite(a, b) {
    try {
      var x = new URL(a), y = new URL(b);
      return x.protocol === y.protocol && x.port === y.port && x.hostname.replace(/^www\./, '') === y.hostname.replace(/^www\./, '');
    } catch (e) { return false; }
  }
  function plannerFrame() {
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i++) if (frames[i].src && sameSite(frames[i].src, PLANNER_ORIGIN)) return frames[i];
    return null;
  }

  // The planner tells the page which step the visitor is on (the same anonymous events the analytics use), so answers can say "you are here".
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.type !== 'cellar-lite:event' || d.name !== 'step') return;
    var f = plannerFrame();
    if (!f || ev.source !== f.contentWindow) return;
    if (/^(space|racking|features|review)$/.test(d.step)) currentStep = d.step;
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function css() {
    var s = document.createElement('style');
    s.textContent =
      '#clg{position:fixed;right:16px;bottom:16px;z-index:99995;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a}' +
      '@media (max-width:640px){#clg{bottom:84px}}' +
      '#clg *{box-sizing:border-box}' +
      '#clg .open{width:56px;height:56px;border-radius:50%;border:0;background:' + ACCENT + ';color:#fff;font:700 26px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}' +
      '#clg .open:hover,#clg button:hover{opacity:.85}' +
      '#clg .open:focus-visible,#clg button:focus-visible,#clg textarea:focus-visible,#clg input:focus-visible{outline:3px solid #f5a623;outline-offset:2px}' +
      '#clg .panel{display:none;position:absolute;right:0;bottom:68px;width:min(380px,calc(100vw - 32px));height:min(540px,calc(100vh - 120px));background:#fff;border:1px solid #d8d8d0;border-radius:14px;box-shadow:0 10px 32px rgba(0,0,0,.28);flex-direction:column;overflow:hidden}' +
      '#clg.on .panel{display:flex}' +
      '#clg .head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:' + ACCENT + ';color:#fff}' +
      '#clg .head b{flex:1;font-size:15px}' +
      '#clg .head button{border:0;background:transparent;color:#fff;font:700 20px system-ui,sans-serif;cursor:pointer;min-width:32px;min-height:32px}' +
      '#clg .list{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;background:#faf9f6}' +
      '#clg .bot,#clg .me{max-width:92%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}' +
      '#clg .bot{align-self:flex-start;background:#fff;border:1px solid #e1ddd2}' +
      '#clg .me{align-self:flex-end;background:#ece7d8}' +
      '#clg .tag{display:block;font-size:11px;font-weight:700;color:#6b6b5f;margin-bottom:3px;text-transform:uppercase;letter-spacing:.03em}' +
      '#clg ol{margin:8px 0 0 18px;padding:0}#clg li{margin:0 0 8px}' +
      '#clg li button,#clg .chip{border:1px solid ' + ACCENT + ';background:#fff;color:' + ACCENT + ';border-radius:999px;font:600 13px system-ui,sans-serif;padding:4px 10px;cursor:pointer;margin-top:4px;min-height:30px}' +
      '#clg .miss{margin-top:8px;padding:6px 8px;border:1px solid #d98e00;border-radius:8px;font-size:13px}' +
      '#clg .tip{margin-top:6px;font-size:12px;font-style:italic;color:#666}' +
      '#clg .chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '#clg .foot{border-top:1px solid #e1ddd2;padding:8px 10px;background:#fff}' +
      '#clg .row{display:flex;gap:6px;align-items:flex-end}' +
      '#clg textarea{flex:1;resize:none;height:42px;max-height:100px;border:1px solid #bbb;border-radius:10px;padding:8px;font:15px system-ui,sans-serif}' +
      '#clg .go{flex:none;min-height:42px;padding:0 14px;border:0;border-radius:10px;background:' + ACCENT + ';color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer}' +
      '#clg .go[disabled]{opacity:.5;cursor:default}' +
      '#clg .team{margin-top:6px;font-size:12px;color:#555}#clg .team a{color:' + ACCENT + ';cursor:pointer;text-decoration:underline;background:none;border:0;font:inherit;padding:0}' +
      '#clg .tbox{display:none;margin-top:6px;padding:8px;border:1px solid #e1ddd2;border-radius:10px;background:#faf9f6;font-size:13px}' +
      '#clg .tbox input[type=text]{width:100%;border:1px solid #bbb;border-radius:8px;padding:6px;margin:4px 0;font:14px system-ui,sans-serif}' +
      '#clg .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}' +
      '#clg .sr{position:absolute;left:-9999px}';
    document.head.appendChild(s);
  }

  function say(cls, node) { var d = el('div', cls); d.appendChild(node); list.appendChild(d); list.scrollTop = list.scrollHeight; return d; }
  function showBot(text) { say('bot', document.createTextNode(text)); }

  function showMe(text) { say('me', document.createTextNode(text)); }

  function showReply(r) {
    var box = el('div', 'bot');
    if (VERDICTS[r.verdict]) box.appendChild(el('span', 'tag', VERDICTS[r.verdict]));
    if (r.answer) box.appendChild(document.createTextNode(r.answer));
    if (r.steps && r.steps.length) {
      var ol = el('ol');
      r.steps.forEach(function (s) {
        var li = el('li');
        li.appendChild(el('b', '', s.label || s.tool));
        li.appendChild(document.createElement('br'));
        li.appendChild(document.createTextNode(s.do));
        li.appendChild(document.createElement('br'));
        var b = el('button', '', 'Show me');
        b.type = 'button';
        b.setAttribute('aria-label', 'Show me: ' + (s.label || s.tool));
        b.addEventListener('click', function () { goTo(s.tool); });
        li.appendChild(b);
        ol.appendChild(li);
      });
      box.appendChild(ol);
    }
    if (r.missing) box.appendChild(el('div', 'miss', 'Not available yet: ' + r.missing));
    if (r.tip) box.appendChild(el('div', 'tip', 'Tip: ' + r.tip));
    list.appendChild(box);
    list.scrollTop = list.scrollHeight;
  }

  /** Take the planner to a step (or open its Help / tour), and bring it into view. */
  function goTo(id) {
    var f = plannerFrame();
    if (!f) return;
    try { f.contentWindow.postMessage({ type: 'cellar-lite:go', version: 1, id: id }, PLANNER_ORIGIN); } catch (e) { log('go failed', e); }
    var r = f.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.6) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: Math.max(0, window.pageYOffset + r.top - 8), behavior: reduce ? 'auto' : 'smooth' });
    }
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) toggle(false); // on a phone the chat covers the planner
  }

  function post(path, body) {
    return fetch(VAULT_URL + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, status: res.status, json: j }; }); });
  }

  function ask(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    showMe(text); input.value = '';
    history.push({ role: 'user', content: text });
    turns.push({ role: 'user', text: text });
    var wait = el('div', 'bot', 'Checking the planner…'); list.appendChild(wait); list.scrollTop = list.scrollHeight;
    post('/api/cellar-lite/guide', { messages: history.slice(-10), currentTool: currentStep, website: '' }).then(function (r) {
      list.removeChild(wait);
      if (!r.ok || !r.json || !r.json.answer && !(r.json.steps && r.json.steps.length)) {
        history.pop(); turns.pop();
        showBot((r.json && r.json.error) || 'Sorry, I could not answer just now. Please try again, or use the Request a quote button and the team will help.');
        return;
      }
      history.push({ role: 'assistant', content: r.json.answer || '' });
      turns.push({ role: 'guide', verdictLabel: VERDICTS[r.json.verdict] || '', answer: r.json.answer || '', steps: (r.json.steps || []).map(function (s) { return { label: s.label, do: s.do }; }), missing: r.json.missing || '', tip: r.json.tip || '' });
      showReply(r.json);
      teamBox.style.display = 'block';
    }).catch(function () {
      list.removeChild(wait); history.pop(); turns.pop();
      showBot('Sorry, I could not reach the help service. Please try again in a moment.');
    }).then(function () { busy = false; sendBtn.disabled = false; input.focus(); });
  }

  function buildTeamBox() {
    var wrap = el('div', 'team');
    var link = el('button', '', 'Send this chat to the team');
    link.type = 'button';
    wrap.appendChild(document.createTextNode('Need a person? '));
    wrap.appendChild(link);
    var box = el('div', 'tbox');
    var lbl = el('label', '', 'Your email or phone, so the team can reply (optional):');
    var inp = el('input'); inp.type = 'text'; inp.maxLength = 120; inp.autocomplete = 'off'; inp.id = 'clg-contact'; lbl.setAttribute('for', 'clg-contact');
    var hp = el('input', 'hp'); hp.type = 'text'; hp.tabIndex = -1; hp.setAttribute('aria-hidden', 'true'); hp.autocomplete = 'off';
    var note = el('div', '', 'This sends the chat above to the team, nothing else. It does not include your design.');
    note.style.cssText = 'font-size:12px;color:#666;margin:2px 0 6px';
    var go = el('button', 'go', 'Send'); go.type = 'button';
    var status = el('div', '', ''); status.setAttribute('role', 'status'); status.style.marginTop = '6px';
    box.appendChild(lbl); box.appendChild(inp); box.appendChild(hp); box.appendChild(note); box.appendChild(go); box.appendChild(status);
    wrap.appendChild(box);
    link.addEventListener('click', function () { box.style.display = box.style.display === 'block' ? 'none' : 'block'; if (box.style.display === 'block') inp.focus(); });
    go.addEventListener('click', function () {
      go.disabled = true; status.textContent = 'Sending…';
      post('/api/cellar-lite/guide/email', { turns: turns.slice(-40), contact: inp.value, website: hp.value }).then(function (r) {
        if (r.ok) { status.textContent = 'Sent. The team will see this chat.'; box.removeChild(go); } else { status.textContent = (r.json && r.json.error) || 'It could not be sent. Please use the Request a quote button instead.'; go.disabled = false; }
      }).catch(function () { status.textContent = 'It could not be sent. Please use the Request a quote button instead.'; go.disabled = false; });
    });
    wrap.style.display = 'none';
    return wrap;
  }

  function toggle(on) {
    var open = on === undefined ? !root.classList.contains('on') : on;
    root.classList.toggle('on', open);
    openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) input.focus(); else openBtn.focus();
  }

  function build() {
    css();
    root = el('div'); root.id = 'clg';
    openBtn = el('button', 'open', '?'); openBtn.type = 'button';
    openBtn.setAttribute('aria-label', 'Ask the planner help chat'); openBtn.setAttribute('aria-expanded', 'false'); openBtn.title = 'Ask for help using the planner';
    panel = el('div', 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Planner help chat');
    var head = el('div', 'head'); head.appendChild(el('b', '', 'Planner help'));
    var close = el('button', '', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close the help chat'); head.appendChild(close);
    list = el('div', 'list'); list.setAttribute('aria-live', 'polite');
    showBot(INTRO);
    var chips = el('div', 'chips');
    STARTERS.forEach(function (t) { var c = el('button', 'chip', t); c.type = 'button'; c.addEventListener('click', function () { chips.style.display = 'none'; ask(t); }); chips.appendChild(c); });
    list.appendChild(chips);
    var foot = el('div', 'foot'); var row = el('div', 'row');
    input = el('textarea'); input.setAttribute('aria-label', 'Type your question'); input.placeholder = 'Type your question…'; input.maxLength = 600;
    sendBtn = el('button', 'go', 'Ask'); sendBtn.type = 'button';
    row.appendChild(input); row.appendChild(sendBtn); foot.appendChild(row);
    teamBox = buildTeamBox(); foot.appendChild(teamBox);
    panel.appendChild(head); panel.appendChild(list); panel.appendChild(foot);
    root.appendChild(panel); root.appendChild(openBtn);
    document.body.appendChild(root);
    openBtn.addEventListener('click', function () { toggle(); });
    close.addEventListener('click', function () { toggle(false); });
    sendBtn.addEventListener('click', function () { ask(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('on')) toggle(false); });
    log('help chat shown');
  }

  // Start only when (a) this page holds the planner and (b) the owner has switched the chat on in Vault.
  function start() {
    fetch(VAULT_URL + '/api/cellar-lite/config').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (!c || !c.guide || c.guide.enabled !== true) { log('help chat is switched off in Vault'); return; }
      var tries = 0;
      (function wait() {
        if (plannerFrame()) { build(); return; }
        if (++tries < 20) window.setTimeout(wait, 500); else log('no planner frame on this page: no help chat');
      })();
    }).catch(function (e) { log('could not read the settings', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
