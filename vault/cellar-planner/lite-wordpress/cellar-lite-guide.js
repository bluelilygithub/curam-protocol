/*
 * Cellar Planner lite: the help chat for the website's planner page.
 *
 * It is the same chat as the guide inside Vault: a round button in the bottom right corner that opens a chat you can drag out of the way (by its
 * title bar; double-click the bar to put it back), make wider or narrower, resize by its top-left corner, and speak into (microphone button, where the
 * browser has one). A visitor types or says what they want to do ("how do I measure my room?"); the chat answers in plain words and its "Show me"
 * links take the planner to the right step. After an answer, "Email this conversation to the team" sends the chat to your team.
 *
 * cellar-lite-fill.js loads this file for you on the planner page (GUIDE_SCRIPT there); it is inside the upload zip beside the planner.
 *  - It stays hidden until you switch it on in Vault (Cellar Planner -> Settings -> Website help chat). Off there = no button on the site.
 *  - It never sees the visitor's design, never gives a price, and sends nothing until the visitor asks a question or presses Send.
 *  - "Email this conversation" goes to YOUR admin address (set in Vault). Never to an address the visitor types.
 *  - It runs in the page around the planner, not inside it: the planner's frame is as tall as the planner, so a button inside it would sit at the
 *    bottom of the page instead of staying on the screen.
 */
(function () {
  'use strict';

  // 1. Vault's public address (scheme + host, no trailing slash). The same one cellar-lite-fill.js posts enquiries to.
  var VAULT_URL = 'https://curam-vault.up.railway.app';
  // 2. The origin that serves the planner iframe, exactly as in the iframe's src (scheme + host, no path, no trailing slash).
  var PLANNER_ORIGIN = 'https://www.wiwc.com.au';
  // 3. The chat's colour if the owner has not set a brand colour in Vault (white text goes on it; keep it dark enough to read).
  var ACCENT = '#4a5a2a';
  // 4. Set to false once everything works. While true, each step is written to the browser Console (F12), every line starting "[cellar-guide]".
  var DEBUG = false;
  function log() { if (DEBUG && window.console) console.log.apply(console, ['[cellar-guide]'].concat([].slice.call(arguments))); }

  if (window.__cellarGuideLoaded) return;
  window.__cellarGuideLoaded = true;

  var NAME = 'Planner help';
  var SUBTITLE = 'Ask how to use the planner';
  var STARTERS = ['How do I measure my room?', 'What do the door settings mean?', 'How many bottles will fit?', 'How do I get a quote?'];
  var VERDICTS = { doable: ['Here is how', '#16a34a'], partly: ['Partly', '#b7791f'], missing: ['Not in the planner yet', '#b7791f'], beyond: ['Outside the planner', ''] };
  var INTRO = 'Hi! Ask me how to use the planner, in your own words. I will take you to the right step. I cannot see your design or give prices: the team does that after a site measure.';
  var KEY_POS_BTN = 'cellar-guide:pos-button', KEY_POS = 'cellar-guide:pos-panel', KEY_SIZE = 'cellar-guide:size';
  var NARROW = 390, WIDE = 700;

  var ICONS = {
    grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
    help: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.2 9.3a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1-1.5 2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.2"/>',
    wide: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    narrow: '<path d="M10 4v5H5M14 20v-5h5M10 9 4 3M14 15l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    send: '<path d="M4 12 20 4l-4 16-4-6-8-2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m12 14 8-10" fill="none" stroke="currentColor" stroke-width="2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
  };
  function icon(name, size) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('fill', 'currentColor'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name]; // constant markup above, never visitor text
    return s;
  }

  var history = [];   // what the model is sent: [{ role, content }]
  var turns = [];     // what an emailed copy shows
  var currentStep = '';
  var busy = false, root, panel, list, input, sendBtn, micBtn, openBtn, emailRow, wideBtn, clearBtn, endMark, accent = ACCENT;

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
  function btn(cls, label, aria) { var b = el('button', cls, label); b.type = 'button'; if (aria) b.setAttribute('aria-label', aria); return b; }
  function store(key, val) { try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* not remembered */ } }
  function recall(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }

  // ------------------------------------------------------------------ styles
  function css() {
    var s = document.createElement('style');
    s.textContent =
      '#clg{--p:' + accent + ';--bg:#f5f5f0;--surf:#eeeee8;--bd:#d8d8d0;--tx:#1a1a1a;--mu:#6b6b5f;position:fixed;right:20px;bottom:20px;z-index:99995;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx)}' +
      '@media (max-width:640px){#clg{bottom:84px;right:12px}}' +
      '#clg *{box-sizing:border-box}#clg button{font-family:inherit;cursor:pointer;transition:opacity .2s}' +
      '#clg button:hover:not(:disabled){opacity:.7}#clg button:disabled{opacity:.4;cursor:default}' +
      '#clg :focus-visible{outline:3px solid #f5a623;outline-offset:2px}' +
      '#clg .open{width:48px;height:48px;border-radius:50%;border:0;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.3);touch-action:none}' +
      '#clg .panel{display:none;flex-direction:column;position:relative;background:var(--surf);border:1px solid var(--bd);border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.28);overflow:hidden}' +
      '#clg.on .panel{display:flex}#clg.on .open{display:none}' +
      '#clg .head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bd);cursor:grab;touch-action:none;user-select:none}' +
      '#clg .head.drag{cursor:grabbing}' +
      '#clg .head .t{flex:1;min-width:0}#clg .head .t b{display:block;font-size:14px;line-height:1.2}#clg .head .t small{font-size:10px;color:var(--mu)}' +
      '#clg .head .ic{color:var(--mu);display:flex}#clg .head .pri{color:var(--p)}' +
      '#clg .head button{background:none;border:0;color:var(--mu);padding:2px;display:flex;align-items:center}' +
      '#clg .head .clear{font-size:11px;padding:2px 4px}' +
      '#clg .list{flex:1;min-height:0;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px}' +
      '#clg .intro{font-size:12px;line-height:1.55;margin:0}' +
      '#clg .starters{display:flex;flex-direction:column;gap:6px}' +
      '#clg .starter{text-align:left;font-size:12px;padding:8px 12px;border-radius:12px;border:1px solid var(--bd);background:var(--bg);color:var(--tx)}' +
      '#clg .me{align-self:flex-end;max-width:85%;font-size:12px;padding:8px 12px;border-radius:16px 16px 4px 16px;background:var(--p);color:#fff;white-space:pre-wrap;word-wrap:break-word;margin:0}' +
      '#clg .bot{align-self:flex-start;max-width:95%;padding:8px 12px;border-radius:16px 16px 16px 4px;border:1px solid var(--bd);background:var(--bg);font-size:12px;line-height:1.5;word-wrap:break-word}' +
      '#clg .bot p{margin:0 0 8px}#clg .bot p:last-child{margin:0}' +
      '#clg .err{font-size:12px;color:#c62828;margin:0}#clg .busy{font-size:12px;font-style:italic;color:var(--mu);margin:0}' +
      '#clg .v{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:1px 8px;border-radius:999px;border:1px solid;margin-bottom:8px}' +
      '#clg ol{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}' +
      '#clg li{display:flex;gap:8px}#clg li .n{flex:none;width:20px;height:20px;border-radius:50%;background:var(--p);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center}' +
      '#clg li .d{display:block;color:var(--mu)}' +
      '#clg .link{background:none;border:0;padding:0;margin-top:4px;color:var(--p);font-size:11px;font-weight:600;text-decoration:underline;text-underline-offset:2px}' +
      '#clg .miss{border:1px solid #f59e0b;border-radius:8px;padding:6px 8px;margin-top:8px}' +
      '#clg .tip{font-size:11px;font-style:italic;color:var(--mu);margin-top:6px}' +
      '#clg .emailrow{padding:8px 12px 0;border-top:1px solid var(--bd);font-size:12px}' +
      '#clg .elink{display:inline-flex;align-items:center;gap:6px;background:none;border:0;padding:0;color:var(--p);font-size:11px;font-weight:600;text-decoration:underline;text-underline-offset:2px}' +
      '#clg .ok{color:#16a34a;margin-left:8px}' +
      '#clg .ebox{display:none;border:1px solid var(--bd);border-radius:12px;background:var(--bg);padding:10px;margin-bottom:8px}' +
      '#clg .ebox p{margin:0 0 6px}#clg .ebox label{display:block;font-weight:600;margin-bottom:4px}' +
      '#clg .ebox input[type=text]{width:100%;border:1px solid var(--bd);border-radius:8px;padding:6px 8px;font:12px system-ui,sans-serif;background:#fff;color:var(--tx);margin-bottom:6px}' +
      '#clg .ebox .acts{display:flex;align-items:center;gap:10px}' +
      '#clg .pbtn{background:var(--p);color:#fff;border:0;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:600}' +
      '#clg .tbtn{background:none;border:0;padding:0;color:var(--mu);font-size:11px}' +
      '#clg .foot{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--bd)}' +
      '#clg .box{position:relative;flex:1;min-width:0}' +
      '#clg textarea{display:block;width:100%;height:84px;resize:none;border:1px solid var(--bd);border-radius:12px;padding:8px 36px 8px 10px;font:12px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--tx)}' +
      '#clg .mic{position:absolute;right:6px;top:6px;width:26px;height:26px;border-radius:50%;border:0;background:none;color:var(--mu);display:flex;align-items:center;justify-content:center}' +
      '#clg .mic.on{background:#e53935;color:#fff;animation:clgpulse 1.2s infinite}' +
      '@keyframes clgpulse{50%{box-shadow:0 0 0 6px rgba(229,57,53,.25)}}@media (prefers-reduced-motion:reduce){#clg .mic.on{animation:none}}' +
      '#clg .send{flex:none;width:36px;height:36px;border-radius:12px;border:0;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center}' +
      '#clg .grip{position:absolute;left:0;top:0;width:22px;height:22px;cursor:nwse-resize;touch-action:none;z-index:2}' +
      '#clg .grip::before{content:"";position:absolute;left:5px;top:5px;width:9px;height:9px;border-left:2px solid var(--mu);border-top:2px solid var(--mu);border-radius:3px 0 0 0;opacity:.55}' +
      '#clg-tip{position:fixed;z-index:99996;pointer-events:none;width:max-content;padding:6px 10px;border-radius:8px;border:1px solid #d8d8d0;background:#eeeee8;color:#1a1a1a;font:11px/1.35 system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.18)}' +
      '#clg .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}';
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ tooltips (the same small card as Vault's); text may be a function so it can follow the button's state
  var tipEl = null;
  function tip(node, text) {
    node.addEventListener('mouseenter', function () {
      var t = typeof text === 'function' ? text() : text;
      if (!t) return;
      hideTip();
      tipEl = el('div', '', t); tipEl.id = 'clg-tip'; tipEl.setAttribute('role', 'tooltip');
      tipEl.style.maxWidth = 'min(' + (t.length > 110 ? 320 : 240) + 'px, calc(100vw - 16px))';
      document.body.appendChild(tipEl);
      var r = node.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      var left = Math.min(Math.max(r.left + r.width / 2 - tw / 2, 8), window.innerWidth - tw - 8);
      var top = r.top - th - 8; if (top < 8) top = r.bottom + 8;
      tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
    });
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('mousedown', hideTip);
  }
  function hideTip() { if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl); tipEl = null; }

  // ------------------------------------------------------------------ dragging (button and chat); stays on the screen, remembered in this browser
  function draggable(node, handle, key, opts) {
    var off = recall(key) || { x: 0, y: 0 }, g = null, swallow = false;
    function clamp(o) {
      var r = node.getBoundingClientRect(), baseL = r.left - off.x, baseT = r.top - off.y, m = 6;
      return {
        x: Math.round(Math.min(Math.max(o.x, m - baseL), window.innerWidth - m - baseL - r.width)),
        y: Math.round(Math.min(Math.max(o.y, m - baseT), window.innerHeight - m - baseT - r.height))
      };
    }
    function apply() { node.style.transform = off.x || off.y ? 'translate(' + off.x + 'px,' + off.y + 'px)' : ''; }
    function settle() { if (!node.offsetWidth) return; off = clamp(off); apply(); }
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (opts.ignore && e.target.closest(opts.ignore))) return;
      g = { x: e.clientX, y: e.clientY, o: { x: off.x, y: off.y }, moved: false, id: e.pointerId };
      try { handle.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
    });
    handle.addEventListener('pointermove', function (e) {
      if (!g || e.pointerId !== g.id) return;
      var dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      g.moved = true; handle.classList.add('drag'); hideTip();
      off = clamp({ x: g.o.x + dx, y: g.o.y + dy }); apply();
    });
    function end(e) {
      if (!g || (e && e.pointerId !== g.id)) return;
      if (g.moved) { swallow = true; window.setTimeout(function () { swallow = false; }, 0); store(key, off.x || off.y ? off : null); }
      handle.classList.remove('drag'); g = null;
    }
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    if (opts.reset) handle.addEventListener('dblclick', function (e) { if (opts.ignore && e.target.closest(opts.ignore)) return; off = { x: 0, y: 0 }; apply(); store(key, null); });
    window.addEventListener('resize', settle);
    apply();
    return { settle: settle, swallowed: function () { return swallow; } };
  }

  // ------------------------------------------------------------------ size: wider/narrower, and a drag corner
  var size = recall(KEY_SIZE) || { w: NARROW, h: 0 };
  if (!(size.w >= 300 && size.w <= 4000) || !(size.h === 0 || (size.h >= 320 && size.h <= 4000))) size = { w: NARROW, h: 0 };
  var panelDrag = null;
  function isWide() { return size.w >= 600; }
  function applySize() {
    panel.style.width = 'min(' + Math.round(size.w) + 'px, calc(100vw - 24px))';
    panel.style.height = size.h ? 'min(' + Math.round(size.h) + 'px, calc(100dvh - 40px))' : 'min(80dvh, calc(100dvh - 40px))';
    wideBtn.replaceChild(icon(isWide() ? 'narrow' : 'wide', 16), wideBtn.firstChild);
    wideBtn.setAttribute('aria-label', isWide() ? 'Make the help chat narrower' : 'Make the help chat wider');
    wideBtn.setAttribute('aria-pressed', isWide() ? 'true' : 'false');
  }
  function sizeGrip() {
    var grip = el('div', 'grip');
    grip.setAttribute('aria-hidden', 'true');
    tip(grip, 'Drag this corner to make the help chat bigger or smaller.');
    var g = null;
    grip.addEventListener('pointerdown', function (e) {
      var r = panel.getBoundingClientRect();
      g = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, id: e.pointerId };
      try { grip.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      hideTip(); e.preventDefault(); e.stopPropagation();
    });
    grip.addEventListener('pointermove', function (e) {
      if (!g || e.pointerId !== g.id) return;
      size = { w: Math.min(window.innerWidth - 24, Math.max(300, g.w + (g.x - e.clientX))), h: Math.min(window.innerHeight - 40, Math.max(320, g.h + (g.y - e.clientY))) };
      applySize(); panelDrag.settle();
    });
    function done() { if (g) { g = null; store(KEY_SIZE, size); } }
    grip.addEventListener('pointerup', done); grip.addEventListener('pointercancel', done);
    return grip;
  }

  // ------------------------------------------------------------------ chat
  var intro, starters, btnDrag;
  function say(cls, node) { var d = el('div', cls); d.appendChild(node); list.insertBefore(d, endMark); scrollDown(); return d; }
  function scrollDown() { list.scrollTop = list.scrollHeight; }

  function showReply(r) {
    var box = el('div', 'bot');
    var v = VERDICTS[r.verdict];
    if (v) { var tag = el('span', 'v', v[0]); tag.style.color = v[1] || 'var(--mu)'; tag.style.borderColor = v[1] || 'var(--bd)'; box.appendChild(tag); }
    if (r.answer) box.appendChild(el('p', '', r.answer));
    if (r.steps && r.steps.length) {
      var ol = el('ol');
      r.steps.forEach(function (s, i) {
        var li = el('li');
        li.appendChild(el('span', 'n', String(i + 1)));
        var body = el('span');
        body.style.cssText = 'min-width:0;flex:1';
        body.appendChild(el('strong', '', s.label || s.tool));
        body.appendChild(el('span', 'd', s.do));
        var b = btn('link', 'Show me ' + (s.label || s.tool) + ' \u2192', 'Show me: ' + (s.label || s.tool));
        tip(b, 'Take the planner to the "' + (s.label || s.tool) + '" step. This chat stays open so you can keep following the steps.');
        b.addEventListener('click', function () { goTo(s.tool); });
        body.appendChild(b); li.appendChild(body); ol.appendChild(li);
      });
      box.appendChild(ol);
    }
    if (r.missing) { var m = el('p', 'miss'); m.appendChild(el('strong', '', 'Not available yet: ')); m.appendChild(document.createTextNode(r.missing)); box.appendChild(m); }
    if (r.tip) box.appendChild(el('p', 'tip', 'Tip: ' + r.tip));
    list.insertBefore(box, endMark); scrollDown();
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
    stopListening();
    busy = true; refresh();
    if (starters.parentNode) starters.parentNode.removeChild(starters);
    if (intro.parentNode) intro.parentNode.removeChild(intro);
    say('me', document.createTextNode(text)); input.value = '';
    history.push({ role: 'user', content: text });
    turns.push({ role: 'user', text: text });
    clearBtn.style.display = '';
    var wait = el('p', 'busy', 'Checking the planner\u2026'); list.insertBefore(wait, endMark); scrollDown();
    post('/api/cellar-lite/guide', { messages: history.slice(-10), currentTool: currentStep, website: '' }).then(function (r) {
      list.removeChild(wait);
      if (!r.ok || !r.json || (!r.json.answer && !(r.json.steps && r.json.steps.length))) {
        history.pop(); turns.pop();
        list.insertBefore(el('p', 'err', (r.json && r.json.error) || 'Sorry, I could not answer just now. Please try again, or use the Request a quote button and the team will help.'), endMark); scrollDown();
        return;
      }
      history.push({ role: 'assistant', content: r.json.answer || '' });
      turns.push({ role: 'guide', verdictLabel: (VERDICTS[r.json.verdict] || [''])[0], answer: r.json.answer || '', steps: (r.json.steps || []).map(function (s) { return { label: s.label, do: s.do }; }), missing: r.json.missing || '', tip: r.json.tip || '' });
      showReply(r.json);
      emailRow.style.display = 'block';
    }).catch(function () {
      list.removeChild(wait); history.pop(); turns.pop();
      list.insertBefore(el('p', 'err', 'Sorry, I could not reach the help service. Please try again in a moment.'), endMark); scrollDown();
    }).then(function () { busy = false; refresh(); input.focus(); });
  }
  function refresh() { sendBtn.disabled = busy || !input.value.trim(); }

  function clearChat() {
    history = []; turns = []; stopListening();
    while (list.firstChild) list.removeChild(list.firstChild);
    list.appendChild(intro); list.appendChild(starters); list.appendChild(endMark);
    emailRow.style.display = 'none'; clearBtn.style.display = 'none';
    resetEmail();
  }

  // ------------------------------------------------------------------ email this conversation: a text link, then a small form whose buttons match the rest
  var eLink, eBox, eStatus, eOk, eContact, eHp, eSend;
  function buildEmailRow() {
    var row = el('div', 'emailrow'); row.style.display = 'none';
    var line = el('div');
    eLink = btn('elink', ''); eLink.appendChild(icon('mail', 13)); eLink.appendChild(document.createTextNode('Email this conversation to the team'));
    tip(eLink, 'Send a copy of this chat to the team by email. Nothing is sent until you press Send.');
    eOk = el('span', 'ok'); eOk.setAttribute('role', 'status');
    line.appendChild(eLink); line.appendChild(eOk);
    eBox = el('div', 'ebox');
    eBox.appendChild(el('p', '', 'Email this conversation to the team'));
    var lbl = el('label', '', 'Your email or phone, so they can reply (optional)'); lbl.setAttribute('for', 'clg-contact');
    eContact = el('input'); eContact.type = 'text'; eContact.maxLength = 120; eContact.autocomplete = 'off'; eContact.id = 'clg-contact';
    eHp = el('input', 'hp'); eHp.type = 'text'; eHp.tabIndex = -1; eHp.autocomplete = 'off'; eHp.setAttribute('aria-hidden', 'true');
    var note = el('p', '', 'This sends only the chat above. It does not include your design.'); note.style.cssText = 'font-size:11px;color:var(--mu)';
    var acts = el('div', 'acts');
    eSend = btn('pbtn', 'Send'); tip(eSend, 'Email the whole conversation to the team.');
    var cancel = btn('tbtn', 'Cancel'); tip(cancel, 'Close this without sending anything.');
    eStatus = el('p', 'err'); eStatus.setAttribute('role', 'alert'); eStatus.style.display = 'none';
    acts.appendChild(eSend); acts.appendChild(cancel);
    eBox.appendChild(lbl); eBox.appendChild(eContact); eBox.appendChild(eHp); eBox.appendChild(note); eBox.appendChild(acts); eBox.appendChild(eStatus);
    row.appendChild(eBox); row.appendChild(line);
    eLink.addEventListener('click', function () { eOk.textContent = ''; eBox.style.display = 'block'; eLink.style.display = 'none'; eContact.focus(); scrollDown(); });
    cancel.addEventListener('click', resetEmail);
    eSend.addEventListener('click', function () {
      eSend.disabled = true; eSend.textContent = 'Sending\u2026'; eStatus.style.display = 'none';
      post('/api/cellar-lite/guide/email', { turns: turns.slice(-40), contact: eContact.value, website: eHp.value }).then(function (r) {
        if (r.ok) { resetEmail(); eOk.textContent = 'Sent. The team will see this chat.'; }
        else { eStatus.textContent = (r.json && r.json.error) || 'It could not be sent. Please use the Request a quote button instead.'; eStatus.style.display = 'block'; }
      }).catch(function () { eStatus.textContent = 'It could not be sent. Please use the Request a quote button instead.'; eStatus.style.display = 'block'; })
        .then(function () { eSend.disabled = false; eSend.textContent = 'Send'; });
    });
    return row;
  }
  function resetEmail() { if (!eBox) return; eBox.style.display = 'none'; eLink.style.display = ''; eStatus.style.display = 'none'; eOk.textContent = ''; }

  // ------------------------------------------------------------------ microphone (where the browser has speech recognition)
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, wantMic = false, micBase = '';
  function stopListening() {
    wantMic = false;
    if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } }
    if (micBtn) { micBtn.classList.remove('on'); micBtn.setAttribute('aria-pressed', 'false'); }
  }
  function startListening() {
    if (!SR) return;
    micBase = input.value.replace(/\s+$/, '');
    rec = new SR(); rec.lang = 'en-AU'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = function (e) {
      var t = '';
      for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      input.value = (micBase ? micBase + ' ' : '') + t.replace(/^\s+/, ''); refresh();
    };
    rec.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        stopListening();
        list.insertBefore(el('p', 'err', 'The microphone is blocked. Allow it in your browser\u2019s address bar to speak your question.'), endMark); scrollDown();
      }
    };
    // the browser ends a session by itself after a pause: carry on, adding what comes next after what is already there
    rec.onend = function () { if (wantMic) { micBase = input.value.replace(/\s+$/, ''); try { rec.start(); } catch (e) { stopListening(); } } };
    wantMic = true; micBtn.classList.add('on'); micBtn.setAttribute('aria-pressed', 'true');
    try { rec.start(); } catch (e) { stopListening(); }
  }

  // ------------------------------------------------------------------ build
  function toggle(on) {
    var open = on === undefined ? !root.classList.contains('on') : on;
    root.classList.toggle('on', open);
    openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    hideTip();
    if (open) { applySize(); window.setTimeout(function () { panelDrag.settle(); input.focus(); }, 0); } else { stopListening(); openBtn.focus(); btnDrag.settle(); }
  }

  function build() {
    css();
    root = el('div'); root.id = 'clg';
    openBtn = btn('open', '', 'Open the planner help chat'); openBtn.appendChild(icon('help', 24)); openBtn.setAttribute('aria-expanded', 'false');
    tip(openBtn, 'Ask the planner help chat. Tell it what you want to do, by typing or talking, and it tells you which steps to use. It cannot see your design. Drag it if it is in the way.');
    panel = el('div', 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', NAME);

    var head = el('div', 'head');
    var gripIc = el('span', 'ic'); gripIc.appendChild(icon('grip', 14)); tip(gripIc, 'Drag this bar to move the chat out of the way. Double-click it to put it back.');
    var helpIc = el('span', 'ic pri'); helpIc.appendChild(icon('help', 18));
    var title = el('div', 't'); title.appendChild(el('b', '', NAME)); title.appendChild(el('small', '', SUBTITLE));
    wideBtn = btn('', ''); wideBtn.appendChild(icon('wide', 16));
    tip(wideBtn, function () { return isWide() ? 'Make the help chat narrower again.' : 'Make the help chat wider, so there is more room to read and to speak into.'; });
    clearBtn = btn('clear', 'Clear'); tip(clearBtn, 'Clear this conversation and start again.'); clearBtn.style.display = 'none';
    var closeBtn = btn('', '', 'Close the help chat'); closeBtn.appendChild(icon('x', 18)); tip(closeBtn, 'Close the help chat. Your conversation is kept until you leave this page.');
    head.appendChild(gripIc); head.appendChild(helpIc); head.appendChild(title); head.appendChild(wideBtn); head.appendChild(clearBtn); head.appendChild(closeBtn);

    list = el('div', 'list'); list.setAttribute('aria-live', 'polite');
    intro = el('p', 'intro', INTRO);
    starters = el('div', 'starters');
    STARTERS.forEach(function (t) { var c = btn('starter', t); tip(c, 'Ask this question.'); c.addEventListener('click', function () { ask(t); }); starters.appendChild(c); });
    endMark = el('div');
    list.appendChild(intro); list.appendChild(starters); list.appendChild(endMark);

    emailRow = buildEmailRow();

    var foot = el('div', 'foot');
    var box = el('div', 'box');
    input = el('textarea'); input.setAttribute('aria-label', 'Ask the planner help chat'); input.placeholder = 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)'; input.maxLength = 600;
    box.appendChild(input);
    if (SR) {
      micBtn = btn('mic', '', 'Speak your question'); micBtn.appendChild(icon('mic', 15)); micBtn.setAttribute('aria-pressed', 'false');
      tip(micBtn, 'Speak your question. Press again to stop. What you say is added to the end of what is already typed.');
      box.appendChild(micBtn);
    }
    sendBtn = btn('send', '', 'Send'); sendBtn.appendChild(icon('send', 16)); tip(sendBtn, 'Send your question to the help chat.'); sendBtn.disabled = true;
    foot.appendChild(box); foot.appendChild(sendBtn);

    panel.appendChild(sizeGrip());
    panel.appendChild(head); panel.appendChild(list); panel.appendChild(emailRow); panel.appendChild(foot);
    root.appendChild(panel); root.appendChild(openBtn);
    document.body.appendChild(root);
    applySize();

    var ignore = 'button, input, textarea, select, a, [data-nodrag]';
    panelDrag = draggable(panel, head, KEY_POS, { ignore: ignore, reset: true });
    btnDrag = draggable(openBtn, openBtn, KEY_POS_BTN, {});
    wideBtn.addEventListener('click', function () { size = { w: isWide() ? NARROW : WIDE, h: size.h }; store(KEY_SIZE, size); applySize(); panelDrag.settle(); });
    openBtn.addEventListener('click', function () { if (btnDrag.swallowed()) return; toggle(true); });
    closeBtn.addEventListener('click', function () { toggle(false); });
    clearBtn.addEventListener('click', clearChat);
    sendBtn.addEventListener('click', function () { ask(input.value); });
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
    if (micBtn) micBtn.addEventListener('click', function () { if (wantMic) stopListening(); else startListening(); input.focus(); });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('on')) toggle(false); });
    log('help chat shown');
  }

  // Start only when (a) this page holds the planner and (b) the owner has switched the chat on in Vault.
  function start() {
    fetch(VAULT_URL + '/api/cellar-lite/config').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (!c || !c.guide || c.guide.enabled !== true) { log('help chat is switched off in Vault'); return; }
      if (typeof c.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.accent)) accent = c.accent; // the owner's brand colour
      var tries = 0;
      (function wait() {
        if (plannerFrame()) { build(); return; }
        if (++tries < 20) window.setTimeout(wait, 500); else log('no planner frame on this page: no help chat');
      })();
    }).catch(function (e) { log('could not read the settings', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
