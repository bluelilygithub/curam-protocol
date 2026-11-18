"""Slim data.json + curated findings into page data. Usage: python3 -I slim.py data.json out.json"""
import json, sys
d = json.load(open(sys.argv[1]))
T = {t['id']: t for t in d['tools']}

def ev(file, line=0, text=''): return dict(file=file, line=line, text=text)

findings = [
 dict(sev='high', area='Cost & abuse', title='Seven AI routes have no rate limit',
      body='These mounts call Claude or Gemini but are registered in server/index.js without aiLimiter, and the route files do not add it themselves. A runaway client loop or a shared login could run up model spend. Add aiLimiter at the mount, as the guide-chat routes already do.',
      tools=['tasks', 'mood', 'goals', 'newsDigest', 'student', 'chat', 'gmailIntel'],
      evidence=[ev('server/index.js', 176, "app.use('/api/tasks', require('./routes/tasks'))  // tasks.js uses callModel + messages.stream"),
                ev('server/index.js', 195, "app.use('/api/mood', requireFeature('mood'), ...)  // mood.js streams from Anthropic"),
                ev('server/index.js', 178, "app.use('/api/goals', requireFeature('goals'), ...)  // goals.js uses callModel"),
                ev('server/index.js', 203, "app.use('/api/news-digest', ...)  // newsDigest.js uses callModel"),
                ev('server/index.js', 163, "/api/student-quizzes"), ev('server/index.js', 149, "/api/files  // files.js calls callModel and embeddings"),
                ev('server/index.js', 171, "/api/pinned-urls"), ev('server/index.js', 122, "/api/gmail (public mount, check which handlers call a model)")]),
 dict(sev='high', area='Model selection', title='Hardcoded model fallbacks remain',
      body='Your rule is that model ids come from Settings through getModelsForUser. Property Scenario falls back to a fixed claude-sonnet-4-6 when no setting resolves, and chat.js keeps a FALLBACK_MODELS list (Claude 4.6, Gemini 2.0/2.5 preview) that will go stale. The TTS default in voiceProviders.js is env-overridable and lower risk.',
      tools=['propertyScenario', 'chat', 'videos', 'music'],
      evidence=[ev('server/services/propertyScenario/parseScenario.js', 187, "return 'claude-sonnet-4-6';"),
                ev('server/services/propertyScenario/insights/buildInsight.js', 67, "if (process.env.ANTHROPIC_API_KEY) return 'claude-sonnet-4-6';"),
                ev('server/routes/chat.js', 1899, 'const FALLBACK_MODELS = [ claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6, gemini-2.0-flash, gemini-2.5-pro-preview-05-06 ]'),
                ev('server/services/voiceProviders.js', 111, "process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'")]),
 dict(sev='high', area='Structure', title='A cron job reaches into a route file for Finance logic',
      body='server/cron/recurringCron.js requires routes/finance.js in four places to post journals, and finance.js requires the cron back, making an import cycle. Business logic living in a 4,700-line route file is why. Move posting and date helpers into a services/finance module that both can import.',
      tools=['finance'],
      evidence=[ev('server/cron/recurringCron.js', 40, "await require('../routes/finance').todayStr()"),
                ev('server/cron/recurringCron.js', 74, "const finRoutes = require('../routes/finance')"),
                ev('server/routes/finance.js', 3629, "const { runRecurring } = require('../cron/recurringCron')"),
                ev('server/routes/finance.js', 4688, '// Exposed for server/cron/recurringCron.js ...')]),
 dict(sev='medium', area='Maintainability', title='Big files that keep changing',
      body='Files that are both very large and edited often are where bugs and merge pain concentrate. db.js changed in 103 of the last 600 commits; every tool adds its tables there. Splitting it into per-tool schema modules (called in order from db.js) and breaking the largest pages into sub-components would make each change smaller.',
      tools=['finance', 'videos', 'pdf', 'propertyScenario'],
      evidence=[ev('server/db.js', 0, '5,611 lines · changed in 103 of 600 commits'),
                ev('client/src/pages/FinancePage.jsx', 0, '7,241 lines · 27 changes'),
                ev('client/src/pages/VideosPage.jsx', 0, '6,065 lines · 40 changes'),
                ev('client/src/pages/SettingsPage.jsx', 0, '3,832 lines · 47 changes'),
                ev('client/src/pages/PdfPage.jsx', 0, '5,193 lines'),
                ev('client/src/pages/PropertyScenarioPage.jsx', 0, '5,320 lines')]),
 dict(sev='medium', area='Tests', title='Eleven tools have no tests; Wellbeing has one for 14,500 lines',
      body='Most tools are well covered (404 test files overall). The gaps are concentrated: Product Scout (7.8k lines), Recipes (4.8k), SEO (3.8k), Contract Review (3.5k), Google Ads, News Digest, Mood, Search Console, Browser Agent, Suggestions, and Student. Wellbeing has 14.5k lines with a single test. Start with the ones that call paid APIs or handle money.',
      tools=['productScout', 'recipes', 'seo', 'contractReview', 'googleAds', 'newsDigest', 'mood', 'searchConsole', 'browserAgent', 'suggestions', 'student', 'wellbeing'], evidence=[]),
 dict(sev='medium', area='Conventions', title='23 tools have no guide chat',
      body='CLAUDE.md says every new tool follows the Video Tools conventions, including a guide chat. 36 tools have one; the gaps are mostly older tools (Tasks, Chat, CRM sub-pages, Mood, Goals, Recipes, the SEO family, Property, Wellbeing). Adding one is cheap with guideCore and the shared TutorChat.',
      tools=[t['id'] for t in d['tools'] if t['checks']['guide']['status'] == 'fail'], evidence=[]),
 dict(sev='medium', area='Structure', title='Restyle and Web Extractor services are tangled',
      body='Six files across two tools import each other in a loop (restyle/loadFromUrl, scrapeCss, inlineImages, selfContainedPage, webExtractorService, webExtractorPalette). Changing one tool can break the other. Pull the shared page-fetch and CSS-scrape code into one module both depend on.',
      tools=['restyle', 'webExtractor'],
      evidence=[ev(f) for f in next(c for c in d['cycles'] if any('restyle' in x for x in c))]),
 dict(sev='low', area='Conventions', title='Raw fetch and direct icon imports in a few places',
      body='Two spots bypass apiClient (file upload/preview in Chat, backup create/restore in Admin), likely for FormData or blobs. If apiClient lacks a FormData path, add one so auth and error handling stay in one place. ArtifactPanel and UrlBar import lucide-react directly instead of getIcon.',
      tools=['chat', 'admin', 'student'],
      evidence=T['chat']['checks']['apiClient']['evidence'] + T['admin']['checks']['apiClient']['evidence'] + T['chat']['checks']['icons']['evidence']),
 dict(sev='low', area='Data safety', title='31 tools delete without the recycle bin',
      body='Delete routes exist but moveToBin is not used in their code. Many are fine (cached lookups, logs), but some hold user content: Finance, CRM, Recipes, Wellbeing, Fitness, Property, Contract Review, Redaction. Decide per tool and record the decision in its doc.',
      tools=[t['id'] for t in d['tools'] if t['checks']['recycleBin']['status'] == 'warn'], evidence=[]),
 dict(sev='low', area='Housekeeping', title='Leftover backups and possibly unused files',
      body='server/db_bk.js and server/index_bk.js are old copies. Five small files have no importers and no string references; verify, then delete.',
      tools=[], evidence=[ev(f) for f in d['backups']] + [ev(o['file'], 0, f"{o['loc']} lines, no importers") for o in d['orphans']]),
]

keep = ['id', 'label', 'group', 'path', 'featureKey', 'lifecycle', 'defaultOn', 'adminOnly', 'locClient', 'locServer', 'score', 'fails', 'warns',
        'calls', 'biggest', 'churn', 'checks', 'tests', 'ownedClient', 'ownedServer', 'sharedClientCount', 'sharedServerCount', 'clientEntries']
tools = []
for t in d['tools']:
    x = {k: t[k] for k in keep}
    x['mounts'] = [dict(path=m['path'], line=m['line'], aiLimiter=m['aiLimiter'], public=m['public'], admin=m['admin']) for m in t['mounts']]
    tools.append(x)
out = dict(summary=d['summary'], tools=tools, edges=d['toolEdges'], cycles=d['cycles'], largest=d['largest'][:20], hotspots=d['hotspots'][:15],
           orphans=d['orphans'], backups=d['backups'], packages=d['packages'], core=[dict(file=c['file'], n=len(c['tools']), importers=c['importers'], loc=c['loc']) for c in d['core']],
           findings=findings, repo='bluelilygithub/curam-protocol', branch='version-7', commit='40bf883')
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
print(len(json.dumps(out)))
