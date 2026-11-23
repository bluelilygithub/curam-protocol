'use strict';

// The Skill Scanner guide (the round button on /skill-scan). It knows the page's controls and what SkillSpector can and cannot check.
// It never sees a link, a zip, a scan or a finding. Built on guideCore.js; ids match client/src/pages/skillScan/skillScanTools.mjs.
// See docs/guide-chat.md and docs/skill-scan.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'scan', label: 'Scan a skill', group: 'Scan',
    does: 'Scan a skill in the tool list on the left (or a job tile on the start screen). Paste a public github.com link to a skill or plugin (the whole repository, or a folder in it via a /tree/ link), or upload a zip of its folder, up to 20 MB. Tick "Scan each skill separately" for a repository or plugin that holds several skills. Press Scan; it runs in the background and the report opens when it finishes.',
    notes: 'The static scan reads the files and never runs them. It is free; only dependency names are sent to OSV.dev to look up known vulnerabilities. A plugin on your own computer must be zipped and uploaded.' },
  { id: 'deep', label: 'Deep scan', group: 'Scan',
    does: 'The Deep scan tick box next to Scan. As well as the static checks, an AI model reads the files for risks the patterns miss. It uses the Skill Scanner model chosen in Settings → AI & Chat, which must be an Anthropic (Claude) model.',
    notes: 'Slower (up to about 20 minutes) and costs a little per scan; the skill’s files are sent to Anthropic. Greyed out unless the Skill Scanner model in Settings → AI & Chat is a Claude model.' },
  { id: 'report', label: 'Report', group: 'Results',
    does: 'The verdict for a scan: Safe, Caution or Do not install, and a risk score from 0 to 100. Under it, "What the findings mean": AI’s plain-English explanation, with its own reading (likely fine for its purpose, review first, or do not install) shown next to the verdict, and what to do next; Regenerate writes it again. Then the findings grouped by rule, each marked expected, worth checking or concerning, and every finding with its file and line, explanation, code and fix. Copy and Download (Markdown or JSON) are at the top. A repository scanned skill by skill shows one section per skill.',
    notes: '0 to 20 is Safe, 21 to 50 Caution, 51 and over Do not install. The score adds points per finding and stops at 100, so routine findings in a skill that calls web APIs can reach 100; the explanation says which findings matter. If the scan could not read everything, it says so and a Safe verdict is shown as Caution. The explanation is written by the Skill Scanner model chosen in Settings → AI & Chat (by default the default chat model; an Anthropic Claude model is recommended), which receives the findings with short code examples; text inside a skill can try to mislead it.' },
  { id: 'history', label: 'Saved scans', group: 'Results',
    does: 'Saved scans in the tool list: every scan you have run, newest first, with its verdict and score (the start screen also shows the latest). Open one to read its report again; Delete moves it to the recycle bin.',
    notes: 'A deleted scan can be restored from Settings → Recycle bin for 30 days.' },
];

const RULES = [
  'The scanner is NVIDIA’s open-source SkillSpector. It checks AI agent skills and plugins (Claude Code, Codex, MCP and similar) for prompt injection, data exfiltration, credential access, privilege escalation, dangerous code, supply-chain problems, tool misuse and persistence.',
  'It never runs the skill’s code or installs its packages, and works on a copy that is deleted after the scan.',
  'Only public github.com links or uploaded zips (up to 20 MB) can be scanned. At most two scans run at once.',
  'The risk score bands are: 0 to 20 Safe, 21 to 50 Caution, 51 and over Do not install.',
  'Skill Scanner is for admins only.',
  'The page opens on "What do you want to do?": job tiles (check from GitHub, check a plugin on my computer, get a deeper AI check, keep or share a report) and the latest scans. The list on the left has every tool.',
  'The Open buttons in this chat only switch to a tool on the page; they never start a scan or delete anything by themselves.',
];

const NOT_POSSIBLE = [
  'Scanning the plugins installed on someone’s own computer directly: zip the folder and upload it instead.',
  'Scanning private repositories, or links outside github.com.',
  'Guaranteeing a skill is safe: a Safe verdict means no known risky pattern was found, not that the skill is harmless.',
  'Fixing, editing or installing a skill.',
  'Watching a skill for changes or scanning on a schedule.',
];

const SYSTEM = `You are the guide to Skill Scanner in Vault, for an admin who wants to check an AI agent skill or plugin before installing it. They say what they want in everyday words. You point them to the right control, in order, and explain how it works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Skill Scanner cannot do.
- You cannot see any link, zip, scan, report or finding. Never state or guess whether a particular skill is safe.
- Be plain and short. Explain words such as prompt injection, exfiltration or supply chain in a few everyday words the first time you use them.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Skill Scanner guide', feature: 'skill_scan_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'SKILL SCANNER TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to check, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askSkillScanTutor: guide.ask,
};
