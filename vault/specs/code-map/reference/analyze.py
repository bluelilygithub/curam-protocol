"""Static code map of Curam Vault: tools, ownership, dependency graph, convention checks.
Usage: python3 -I analyze.py <vault_dir> <out.json>
"""
import json, os, re, sys, subprocess
from collections import defaultdict, deque

ROOT = os.path.abspath(sys.argv[1])
OUT = sys.argv[2]
EXTS = ('.js', '.jsx', '.mjs', '.cjs')
SKIP_DIRS = {'node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__'}

def rel(p): return os.path.relpath(p, ROOT).replace(os.sep, '/')

def read(p):
    try:
        with open(p, encoding='utf-8', errors='replace') as f: return f.read()
    except Exception: return ''

# ---------- collect files ----------
files = {}
for base in ('server', 'client/src'):
    for dp, dns, fns in os.walk(os.path.join(ROOT, base)):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith(EXTS):
                p = os.path.join(dp, fn)
                files[rel(p)] = read(p)

def is_test(f): return bool(re.search(r'\.(test|spec)\.(m?js|jsx|cjs)$', f)) or '/__tests__/' in f
loc = {f: s.count('\n') + 1 for f, s in files.items()}

# ---------- import graph ----------
IMP_RE = re.compile(r"""(?:require\(\s*|import\s*\(\s*|from\s+|import\s+)(['"])(\.{1,2}/[^'"]+)\1""")
def resolve(src, spec):
    base = os.path.normpath(os.path.join(os.path.dirname(src), spec)).replace(os.sep, '/')
    for cand in (base, *(base + e for e in EXTS), *(base + '/index' + e for e in EXTS)):
        if cand in files: return cand
    return None

deps = defaultdict(set)
importers = defaultdict(set)
for f, s in files.items():
    for m in IMP_RE.finditer(s):
        t = resolve(f, m.group(2))
        if t and t != f:
            deps[f].add(t); importers[t].add(f)

# ---------- tools from nav catalog ----------
nav = files.get('client/src/config/appNavigation.js', '')
block = nav[nav.index('APP_NAV_GROUPS'):nav.index('export function isNavItemActive')]
tools = []
group = None
for line in block.splitlines():
    g = re.search(r"^\s*id: '([\w-]+)',\s*$", line)
    if g: group = g.group(1); continue
    gl = re.search(r"^\s*label: '([^']+)',\s*$", line)
    if gl: group_label = gl.group(1); continue
    m = re.search(r"\{ id: '(\w+)',\s*label: '([^']+)',\s*path: '([^']+)'.*?featureKey: (null|'(\w+)')", line)
    if m and not m.group(3).startswith('http'):
        tools.append(dict(id=m.group(1), label=m.group(2), path=m.group(3), featureKey=m.group(5),
                          group=group_label, adminOnly='adminOnly: true' in line))
tools.insert(1, dict(id='tasks', label='Tasks', path='/tasks', featureKey=None, group='Everyday', adminOnly=False))
tools.insert(2, dict(id='chat', label='Chat & Projects', path='/chat', featureKey=None, group='Everyday', adminOnly=False))
tools = [t for t in tools if t['id'] not in ('guide',)]

# ---------- page component per tool ----------
app = files['client/src/App.jsx']
comp_file = {}
for m in re.finditer(r"import\s+(\w+)\s+from\s+'(\./[^']+)'", app):
    r = resolve('client/src/App.jsx', m.group(2))
    if r: comp_file[m.group(1)] = r
for m in re.finditer(r"const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*'(\./[^']+)'", app):
    r = resolve('client/src/App.jsx', m.group(2))
    if r: comp_file[m.group(1)] = r
route_comp = defaultdict(list)
for m in re.finditer(r'<Route\s+path="([^"]+)"\s+element=\{(.*?)\}\s*/>', app):
    comps = re.findall(r'<(\w+)', m.group(2))
    comps = [c for c in comps if c not in ('FeatureRoute', 'Navigate', 'AdminOnly', 'AdminRoute')] or comps
    route_comp[m.group(1)].append(comps[-1] if comps else None)
special = {'/student/quiz': 'StudentQuizLayout', '/admin': 'AdminPage', '/chat': 'ChatPage'}
for t in tools:
    base = t['path'].split('?')[0]
    entries = []
    names = [special[base]] if base in special else route_comp.get(base, [])
    # detail routes belonging to the tool (e.g. /clients/:id)
    for p, cs in route_comp.items():
        if p.startswith(base + '/') and base != '/':
            names += cs
    if t['id'] == 'chat': names += ['ProjectDetail', 'ProjectList', 'ChatHistoryPage']
    if t['id'] == 'student': names += ['StudentCardsChatPage', 'StudentSavedDecksPage']
    for n in names:
        if n and n in comp_file: entries.append(comp_file[n])
    t['clientEntries'] = sorted(set(entries))

def bfs(starts, graph):
    seen = set(starts); q = deque(starts)
    while q:
        x = q.popleft()
        for y in graph.get(x, ()):
            if y not in seen: seen.add(y); q.append(y)
    return seen

# ---------- server mounts ----------
idx = files['server/index.js']
mounts = []
for i, line in enumerate(idx.splitlines(), 1):
    m = re.search(r"app\.use\('(/api/[^']+)'\s*,(.*)\);", line)
    if not m: continue
    body = m.group(2)
    mods = []
    for rm in re.finditer(r"require\('(\./routes/[^']+)'\)", body):
        r = resolve('server/index.js', rm.group(1))
        if r: mods.append(r)
    feats = re.findall(r"requireFeature\('(\w+)'\)", body) + sum([re.findall(r"'(\w+)'", a) for a in re.findall(r"requireAnyFeature\(([^)]*)\)", body)], [])
    if not mods:
        # router objects defined earlier (cellarLiteConfig.staffRouter etc.)
        for name in re.findall(r"(\w+)\.\w+Router", body):
            dm = re.search(r"const\s+%s\s*=\s*require\('(\./routes/[^']+)'\)" % name, idx)
            if dm:
                r = resolve('server/index.js', dm.group(1))
                if r: mods.append(r)
    mounts.append(dict(path=m.group(1), line=i, modules=mods, features=feats,
                       aiLimiter='aiLimiter' in body, admin='requireAdmin' in body,
                       public=i < idx.splitlines().index(next(l for l in idx.splitlines() if "app.use('/api', requireAuth)" in l)) + 1))

def mounts_for_api(api):
    best = [m for m in mounts if api == m['path'] or api.startswith(m['path'] + '/')]
    if not best: return []
    L = max(len(m['path']) for m in best)
    return [m for m in best if len(m['path']) == L]

API_RE = re.compile(r"""['"`](/api/[a-zA-Z0-9_/-]+)""")

# ---------- reach sets ----------
client_reach, server_reach, tool_mounts = {}, {}, {}
for t in tools:
    client_reach[t['id']] = bfs(t['clientEntries'], deps) if t['clientEntries'] else set()

client_count = defaultdict(int)
for tid, rs in client_reach.items():
    for f in rs: client_count[f] += 1

def owned_client(tid):
    return {f for f in client_reach[tid] if client_count[f] <= 2}

key_count = defaultdict(int)
for t in tools:
    if t['featureKey']: key_count[t['featureKey']] += 1

def seg(path): return path[len('/api/'):].split('/')[0]
CHAT_SEGS = {'chat', 'projects', 'files', 'session-files', 'pinned-urls', 'folders', 'bookmarks', 'fetch-url', 'web-search'}
EXTRA_SEGS = {'student': {'study-decks', 'student-quizzes'}, 'goals': {'mission'}, 'tasks': {'task-templates'}, 'html': {'page-speed-tutor'},
              'clients': {'deals', 'cases', 'shelf-inbox', 'crm-tutor'}, 'gmailIntel': {'gmail'}, 'searchConsole': {'gsc'},
              'admin': {'admin', 'backup'}, 'pcHealth': {'pc-helper'}, 'shares': {'metals'}, 'videos': {'local-audio'},
              'gardenPlanner': {'map-tiles', 'plant-images', 'geocode'}, 'routeTracer': {'route-tracks', 'route-tutor'},
              'cellarPlanner': {'cellar-planner', 'cellar-tutor', 'cellar-lite'}, 'roomPlanner': {'room-projects'},
              'guitar': {'guitar-play'}, 'liveTv': {'live-tv-player'}, 'burnerMail': {'inbound-mail'}, 'fitness': {'fitness'},
              'measurements': {'measurements-tutor'}, 'restyle': {'restyle', 'restyle-tutor'}, 'shelf': set()}
def mount_owner(m):
    sg = seg(m['path'])
    base = sg[:-len('-tutor')] if sg.endswith('-tutor') else sg
    if base in CHAT_SEGS: return 'chat'
    for t in tools:
        if sg in EXTRA_SEGS.get(t['id'], ()) or base in EXTRA_SEGS.get(t['id'], ()): return t['id']
    for t in tools:
        tp = t['path'].split('?')[0].strip('/').split('/')[0]
        if base in (tp, kebab(t['id'])): return t['id']
    for t in tools:
        if t['featureKey'] and t['featureKey'] in m['features']: return t['id']
    return None
def kebab(s): return re.sub(r'(?<!^)(?=[A-Z])', '-', s).lower()
for m in mounts: m['owner'] = mount_owner(m)

for t in tools:
    apis = set()
    for f in owned_client(t['id']):
        apis.update(API_RE.findall(files[f]))
    called = {}
    for a in apis:
        for m in mounts_for_api(a.rstrip('/')): called[m['line']] = m
    primary = {m['line']: m for m in mounts if m['owner'] == t['id']}
    tool_mounts[t['id']] = sorted(primary.values(), key=lambda m: m['line'])
    t['calls'] = sorted({(m['owner'] or 'platform:' + seg(m['path'])) for m in called.values() if m['owner'] != t['id']})
    starts = sorted({mod for m in primary.values() for mod in m['modules']})
    server_reach[t['id']] = bfs(starts, deps) if starts else set()
    t['apiCalls'] = sorted(apis)
platform_mounts = [m for m in mounts if not m['owner']]
server_count = defaultdict(int)
for tid, rs in server_reach.items():
    for f in rs: server_count[f] += 1

COMMON_T = 3
for t in tools:
    tid = t['id']
    oc = sorted(f for f in client_reach[tid] if client_count[f] < COMMON_T and not is_test(f))
    primary_mods = {mod for m in tool_mounts[tid] for mod in m['modules']}
    os_ = sorted(f for f in server_reach[tid] if (server_count[f] < COMMON_T or f in primary_mods) and not is_test(f))
    t['ownedClient'] = oc; t['ownedServer'] = os_
    t['sharedClient'] = sorted(f for f in client_reach[tid] if client_count[f] >= COMMON_T)
    t['sharedServer'] = sorted(f for f in server_reach[tid] if server_count[f] >= COMMON_T)
    t['locClient'] = sum(loc[f] for f in oc); t['locServer'] = sum(loc[f] for f in os_)
    owned = set(oc) | set(os_)
    tests = sorted(f for f in files if is_test(f) and (deps[f] & owned))
    t['tests'] = tests
    t['mounts'] = [dict(path=m['path'], line=m['line'], aiLimiter=m['aiLimiter'], features=m['features'], admin=m['admin'], public=m['public'], modules=m['modules']) for m in tool_mounts[tid]]
    biggest = sorted(owned, key=lambda f: -loc[f])[:5]
    t['biggest'] = [dict(file=f, loc=loc[f]) for f in biggest]

# ---------- convention checks ----------
srv_flags = files['server/config/featureAccess.js']
cli_flags = files['client/src/utils/featureAccess.js']
def flag_keys(src):
    blk = src[src.index('{', src.index('DEFAULT')):]
    blk = blk[:blk.index('};')]
    return dict(re.findall(r"^\s*(\w+):\s*(true|false)", blk, re.M))
def lifecycle_keys(src):
    if 'FEATURE_LIFECYCLE' not in src: return {}
    blk = src[src.index('{', src.index('FEATURE_LIFECYCLE =')):]
    blk = blk[:blk.index('};')]
    return dict(re.findall(r"^\s*(\w+):\s*'(\w+)'", blk, re.M))
SF, CF = flag_keys(srv_flags), flag_keys(cli_flags)
SL, CL = lifecycle_keys(srv_flags), lifecycle_keys(cli_flags)
guides_src = files['server/config/guides.js']
guide_endpoints = set(re.findall(r"endpoint: '([^']+)'", guides_src))
docs = set(os.listdir(os.path.join(ROOT, 'docs')))
keyfiles = read(os.path.join(ROOT, 'docs/key-files.md'))

def lines_matching(fs, rx, limit=6, skip=None):
    out = []
    for f in fs:
        if skip and skip(f): continue
        for i, l in enumerate(files[f].splitlines(), 1):
            if rx.search(l):
                out.append(dict(file=f, line=i, text=l.strip()[:160]))
                if len(out) >= limit: return out
    return out

MODEL_RX = re.compile(r"""['"`](claude-(?:opus|sonnet|haiku|3|instant)[\w.\-]*|gemini-\d[\w.\-]*|gpt-[34o][\w.\-]*|deepseek-[\w.\-]+)['"`]""")
AI_RX = re.compile(r"callModel|messages\.create|messages\.stream|generateContent|GoogleGenerativeAI|@anthropic-ai/sdk|streamAnthropic|callClaude|askGuide|guideCore|runTutor")
RESOLVE_RX = re.compile(r"getModelsForUser|ModelResolver|resolve\w*Model|modelResolver|guideCore|guideBasicsKit")
RAWFETCH_RX = re.compile(r"""\bfetch\(\s*[`'"]/api""")
LUCIDE_RX = re.compile(r"""from\s+['"]lucide-react['"]""")
MODAL_RX = re.compile(r"fixed inset-0")
CONSOLE_RX = re.compile(r"\bconsole\.(log|warn|error|info)\(")
DEL_RX = re.compile(r"router\.delete\(")
BIN_RX = re.compile(r"moveToBin|recycleBin")
NETFETCH_RX = re.compile(r"\b(axios\.(get|post)|got\(|https?\.get\(|\bfetch\()")
SAFE_RX = re.compile(r"safeFetch|htmlFetch|checkSsrf")

def kebab(s): return re.sub(r'(?<!^)(?=[A-Z])', '-', s).lower()
doc_alias = {'clients': 'crm-activity-model.md', 'gmailIntel': 'gmail-intel.md', 'html': 'html-agent.md', 'seo': 'seo-agent.md',
             'googleAds': 'google-ads-agent.md', 'searchConsole': 'search-console-agent.md', 'youtube': 'youtube-agent.md',
             'videos': 'video-tools.md', 'graphics': 'graphics-tools.md', 'pdf': 'pdf-agent.md', 'translate': 'translate-agent.md',
             'documentRedaction': 'document-redaction-agent-architecture.md', 'contractReview': 'contract-review-spec.md',
             'measurements': 'measurement-converter.md', 'wellbeing': 'wellbeing-assessment-app.md', 'goals': 'goals-guide.md',
             'fitness': 'fitness-planner.md', 'memory': 'semantic-memory.md', 'suggestions': 'suggestions-inbox.md',
             'chat': 'chat-navigation.md', 'student': None, 'devicePreview': None, 'restyle': 'restyle.md', 'shares': 'shares-thesis.md',
             'clientProjects': None, 'expenseReview': None, 'changelog': 'changelog.md', 'admin': None, 'tasks': None, 'usage': None}

def check(status, note, evidence=None):
    return dict(status=status, note=note, evidence=evidence or [])

for t in tools:
    oc, os_ = t['ownedClient'], t['ownedServer']
    k = t['featureKey']
    c = {}
    # 1 feature flag parity
    if t['adminOnly']: c['flag'] = check('na', 'Admin-only page; no feature flag needed.')
    elif not k: c['flag'] = check('na', 'Always on (core tool, no feature flag).')
    elif k in SF and k in CF:
        c['flag'] = check('pass' if SF[k] == CF[k] else 'fail', f'Flag "{k}" is in both lists' + ('' if SF[k] == CF[k] else f' but defaults differ (server {SF[k]}, client {CF[k]})') + '.')
    else: c['flag'] = check('fail', f'Flag "{k}" missing from ' + ('client' if k in SF else 'server') + ' list.')
    # 2 lifecycle
    if k and SF.get(k) == 'false':
        ok = k in SL and k in CL and SL[k] == CL[k]
        c['lifecycle'] = check('pass' if ok else 'fail', f'Ships off: lifecycle server={SL.get(k, "missing")}, client={CL.get(k, "missing")}.')
    elif k: c['lifecycle'] = check('pass' if k not in SL else 'pass', 'Ships on' + (f' (lifecycle {SL[k]})' if k in SL else ' (counts as ga)') + '.')
    else: c['lifecycle'] = check('na', 'No flag.')
    # 3 guide chat
    tutor_calls = [a for a in t['apiCalls'] if 'tutor' in a]
    has_guide_cfg = any('guideId' in files[f] for f in oc)
    registered = [a for a in tutor_calls if a in guide_endpoints]
    if t['adminOnly'] and not tutor_calls:
        c['guide'] = check('na', 'Admin-only page.')
    elif registered or (has_guide_cfg and tutor_calls):
        c['guide'] = check('pass', 'Guide chat: ' + ', '.join(sorted(set(registered or tutor_calls))))
    elif tutor_calls:
        c['guide'] = check('warn', 'Calls a tutor endpoint not listed in server/config/guides.js: ' + ', '.join(tutor_calls))
    else:
        c['guide'] = check('fail', 'No guide chat found (convention: every tool has one).')
    # 4 docs
    cands = [kebab(t['id']) + '.md', kebab(k or '') + '.md' if k else None, doc_alias.get(t['id'])]
    found = [d for d in cands if d and d in docs]
    pref = [d for d in docs if d.startswith(kebab(t['id']) + '-')]
    if found or pref: c['docs'] = check('pass', 'docs/' + (found or pref)[0])
    else:
        mentioned = t['label'] in keyfiles or (t['clientEntries'] and os.path.basename(t['clientEntries'][0]) in keyfiles)
        c['docs'] = check('warn' if mentioned else 'fail', ('Only mentioned in docs/key-files.md; no docs/<tool>.md.' if mentioned else 'No docs file found.'))
    # 5 hardcoded model ids
    ev = lines_matching(os_ + oc, MODEL_RX, skip=lambda f: re.search(r'costCalculator|pricing|\.test\.|client/src/utils/models\.js', f))
    c['models'] = check('fail' if ev else 'pass', f'{len(ev)}+ hardcoded model id(s) outside pricing tables.' if ev else 'No hardcoded model ids.', ev)
    # 6 model resolution for AI calls
    uses_ai = any(AI_RX.search(files[f]) for f in os_)
    resolves = any(RESOLVE_RX.search(files[f]) for f in os_) or any(RESOLVE_RX.search(files[f]) for f in t['sharedServer'] if AI_RX.search(files[f]))
    if not uses_ai: c['modelResolver'] = check('na', 'No direct AI calls in its own server code.')
    else: c['modelResolver'] = check('pass' if resolves else 'warn', 'AI calls resolve models via Settings.' if resolves else 'Makes AI calls but no getModelsForUser / resolver seen in its own files; check.')
    # 7 apiClient
    ev = lines_matching(oc, RAWFETCH_RX)
    c['apiClient'] = check('fail' if ev else 'pass', f'Raw fetch(\'/api...\') used.' if ev else 'All /api calls through apiClient.', ev)
    # 8 recycle bin
    dels = lines_matching(os_, DEL_RX, limit=4, skip=lambda f: not f.startswith('server/routes/'))
    if not dels: c['recycleBin'] = check('na', 'No delete routes of its own.')
    else:
        uses_bin = any(BIN_RX.search(files[f]) for f in os_)
        c['recycleBin'] = check('pass' if uses_bin else 'warn', 'Deletes go to the recycle bin.' if uses_bin else f'{len(dels)}+ delete route(s), no moveToBin seen. Fine if items are trivial; check.', [] if uses_bin else dels)
    # 9 icons
    ev = lines_matching(oc, LUCIDE_RX, skip=lambda f: re.search(r'IconProvider|IconLibraryGenerator', f))
    c['icons'] = check('fail' if ev else 'pass', 'Imports lucide-react directly (use getIcon).' if ev else 'Icons via getIcon.', ev)
    # 10 modals
    ev = lines_matching(oc, MODAL_RX, skip=lambda f: f.endswith('Dialog.jsx'))
    c['modals'] = check('warn' if ev else 'pass', f'Hand-rolled "fixed inset-0" overlay(s) ({len(ev)}+). Use Dialog.jsx unless it is a full-screen mode.' if ev else 'Uses the shared Dialog.', ev)
    # 11 logging
    n_console = sum(len(CONSOLE_RX.findall(files[f])) for f in os_)
    uses_logger = any('getLogger' in files[f] for f in os_)
    if not os_: c['logging'] = check('na', 'No server code of its own.')
    else: c['logging'] = check('pass' if n_console == 0 else ('warn' if n_console > 5 else 'pass'), f'{n_console} console.* call(s); ' + ('uses getLogger.' if uses_logger else 'no getLogger.'))
    # 12 SSRF
    risky = []
    for f in os_:
        src = files[f]
        if SAFE_RX.search(src): continue
        if re.search(r"(fetch|axios\.(get|post)|got)\(\s*(req\.(body|query|params)\.\w*url|url|targetUrl|pageUrl)\b", src, re.I) and \
           re.search(r"req\.(body|query|params)\.\w*url|\{[^}]*\burl\b[^}]*\}\s*=\s*req\.(body|query)", src, re.I):
            risky.append(f)
    if risky:
        c['ssrf'] = check('warn', 'Fetches a URL taken from the request without safeFetch/htmlFetch: ' + ', '.join(os.path.basename(f) for f in risky[:4]) + '. Check whether the URL can be user-supplied.', [dict(file=f, line=0, text='') for f in risky[:4]])
    else: c['ssrf'] = check('pass', 'No unguarded user-URL fetch seen.')
    # 13 tests
    n = len(t['tests'])
    c['tests'] = check('fail' if n == 0 else ('warn' if n < 2 and (t['locServer'] + t['locClient']) > 3000 else 'pass'), f'{n} test file(s) cover its own code.')
    # 14 aiLimiter on AI mounts
    ai_mounts = [m for m in t['mounts'] if any(AI_RX.search(files[mod]) for mod in m['modules'])]
    missing = [m for m in ai_mounts if not m['aiLimiter'] and not m['admin']]
    if not ai_mounts: c['rateLimit'] = check('na', 'No AI routes mounted directly.')
    else:
        inside = [m for m in missing if any('aiLimiter' in files[mod] for mod in m['modules'])]
        real = [m for m in missing if m not in inside]
        c['rateLimit'] = check('warn' if real else 'pass', ('AI route(s) without aiLimiter: ' + ', '.join(m['path'] for m in real)) if real else 'AI routes rate-limited.', [dict(file='server/index.js', line=m['line'], text=m['path']) for m in real])
    t['checks'] = c
    score = sum(1 for v in c.values() if v['status'] == 'pass')
    total = sum(1 for v in c.values() if v['status'] != 'na')
    t['score'] = round(100 * score / total) if total else 100
    t['fails'] = sum(1 for v in c.values() if v['status'] == 'fail')
    t['warns'] = sum(1 for v in c.values() if v['status'] == 'warn')
    t['lifecycle'] = SL.get(k, 'ga') if k else 'ga'
    t['defaultOn'] = (SF.get(k, 'true') == 'true') if k else True

# ---------- tool-to-tool coupling ----------
entry_owner = {}
for t in tools:
    for f in t['clientEntries']: entry_owner.setdefault(f, t['id'])
    for m in t['mounts']:
        for mod in m['modules']: entry_owner.setdefault(mod, t['id'])
own_map = defaultdict(set)
for t in tools:
    for f in t['ownedClient'] + t['ownedServer']: own_map[f].add(t['id'])
edges = {}
for t in tools:
    for f in set(t['ownedClient']) | set(t['ownedServer']):
        for o in own_map[f] - {t['id']}:
            a_, b_ = sorted((t['id'], o))
            e = edges.setdefault((a_, b_), dict(files=set(), api=set()))
            e['files'].add(f)
    for o in t['calls']:
        if o.startswith('platform:'): continue
        a_, b_ = sorted((t['id'], o))
        e = edges.setdefault((a_, b_), dict(files=set(), api=set()))
        e['api'].add(f"{t['id']}->{o}")
tool_edges = [dict(a=a_, b=b_, files=sorted(v['files'])[:12], n=len(v['files']), api=sorted(v['api'])) for (a_, b_), v in edges.items()]
# shared modules: top fan-in across tools
shared_mods = []
for f in files:
    if is_test(f): continue
    n = server_count.get(f, 0) if f.startswith('server/') else client_count.get(f, 0)
    if n >= 6:
        shared_mods.append(dict(file=f, tools=n, importers=len(importers[f]), loc=loc[f]))
shared_mods.sort(key=lambda x: -x['tools'])
core_names = ['server/db.js', 'server/services/modelResolver.js', 'server/services/SuggestionService.js', 'server/middleware/auth.js',
              'server/services/recycleBin/index.js', 'server/utils/safeFetch.js', 'server/lib/logger.js', 'server/services/callModel.js',
              'client/src/utils/apiClient.js', 'client/src/components/tutor/TutorChat.jsx', 'client/src/components/Dialog.jsx',
              'client/src/providers/IconProvider.jsx', 'client/src/store/processingStore.js', 'client/src/components/Tooltip.jsx',
              'client/src/components/voiceInput/VoiceInput.jsx', 'server/services/guideCore.js']
core = []
for f in core_names:
    if f in files:
        reach = [t['id'] for t in tools if f in server_reach[t['id']] or f in client_reach[t['id']]]
        core.append(dict(file=f, tools=reach, loc=loc[f], importers=len(importers[f])))

# ---------- global structure ----------
# Tarjan SCC
sys.setrecursionlimit(100000)
index_c = [0]; stack = []; onst = set(); idxs = {}; low = {}; sccs = []
def strong(v):
    idxs[v] = low[v] = index_c[0]; index_c[0] += 1; stack.append(v); onst.add(v)
    for w in deps.get(v, ()):
        if w not in idxs: strong(w); low[v] = min(low[v], low[w])
        elif w in onst: low[v] = min(low[v], idxs[w])
    if low[v] == idxs[v]:
        comp = []
        while True:
            w = stack.pop(); onst.discard(w); comp.append(w)
            if w == v: break
        if len(comp) > 1: sccs.append(sorted(comp))
for v in list(files):
    if v not in idxs: strong(v)

largest = sorted(({'file': f, 'loc': loc[f]} for f in files if not is_test(f)), key=lambda x: -x['loc'])[:25]
fanin = sorted(({'file': f, 'importers': len(importers[f]), 'loc': loc[f]} for f in files if not is_test(f)), key=lambda x: -x['importers'])[:20]

all_owned = set()
for t in tools: all_owned |= set(t['ownedClient']) | set(t['ownedServer']) | set(t['sharedClient']) | set(t['sharedServer'])
entry_like = re.compile(r"^server/(index|db)\.js$|^server/(scripts|seeds|testing|cron)/|^client/src/main\.jsx$|\.config\.|/scripts/|_bk\.js$|^server/assets/")
all_text = '\n'.join(files.values())
orphans = []
for f in files:
    if is_test(f) or importers[f] or entry_like.search(f): continue
    stem = os.path.splitext(os.path.basename(f))[0]
    if stem == 'index': stem = os.path.basename(os.path.dirname(f))
    # referenced by string anywhere else (dynamic require, path.join)?
    refs = len(re.findall(re.escape(stem), all_text)) - len(re.findall(re.escape(stem), files[f]))
    if refs > 0: continue
    orphans.append(dict(file=f, loc=loc[f]))
orphans.sort(key=lambda x: -x['loc'])
backups = sorted(f for f in files if re.search(r'_bk\.js$|\.bak|_old\.', f))

# churn from git history (bounded)
churn = defaultdict(int)
try:
    outp = subprocess.run(['git', '-C', ROOT, 'log', '--name-only', '--format=', '-n', '600', '--', 'server', 'client/src'],
                          capture_output=True, text=True, timeout=120).stdout
    for l in outp.splitlines():
        l = l.strip()
        if l.startswith('vault/'): l = l[6:]
        if l in files: churn[l] += 1
except Exception: pass
commits = subprocess.run(['git', '-C', ROOT, 'log', '-n', '600', '--format=%ad', '--date=short'], capture_output=True, text=True).stdout.split()
hot = sorted(({'file': f, 'changes': churn[f], 'loc': loc[f]} for f in churn if not is_test(f) and f not in ('server/config/changelogEntries.json',)),
             key=lambda x: -(x['changes'] * (x['loc'] ** 0.5)))[:20]
for t in tools:
    t['churn'] = sum(churn.get(f, 0) for f in t['ownedClient'] + t['ownedServer'])

# other packages (planners)
packages = []
for d in sorted(os.listdir(ROOT)):
    p = os.path.join(ROOT, d)
    if os.path.isdir(p) and os.path.exists(os.path.join(p, 'package.json')) and d not in ('client', 'server'):
        n = 0; c = 0
        for dp, dns, fns in os.walk(p):
            dns[:] = [x for x in dns if x not in SKIP_DIRS]
            for fn in fns:
                if fn.endswith(EXTS + ('.ts', '.tsx', '.py')):
                    c += 1; n += read(os.path.join(dp, fn)).count('\n')
        packages.append(dict(name=d, files=c, loc=n))

summary = dict(
    files=len(files), tests=sum(1 for f in files if is_test(f)),
    locServer=sum(loc[f] for f in files if f.startswith('server/') and not is_test(f)),
    locClient=sum(loc[f] for f in files if f.startswith('client/') and not is_test(f)),
    locTests=sum(loc[f] for f in files if is_test(f)),
    tools=len(tools), mounts=len(mounts), routesFiles=sum(1 for f in files if f.startswith('server/routes/') and not is_test(f)),
    commitsScanned=len(commits), historyFrom=commits[-1] if commits else None, historyTo=commits[0] if commits else None,
)
for t in tools:
    for k2 in ('sharedClient', 'sharedServer'):
        t[k2 + 'Count'] = len(t[k2]); del t[k2]

json.dump(dict(summary=summary, tools=tools, toolEdges=tool_edges, core=core, sharedModules=shared_mods[:30], cycles=sccs,
               largest=largest, fanin=fanin, orphans=orphans[:40], backups=backups, hotspots=hot, packages=packages,
               mounts=[dict(path=m['path'], owner=m['owner'], line=m['line'], features=m['features'], aiLimiter=m['aiLimiter'], admin=m['admin'], public=m['public']) for m in mounts]),
          open(OUT, 'w'), indent=1, default=list)
print(json.dumps(summary, indent=1))
print('tools', len(tools), 'cycles', len(sccs), 'orphans', len(orphans), 'edges', len(tool_edges))
