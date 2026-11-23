// What the Skill Scanner page is made of, the plain-words help for it, and the controls its guide can point at. The ids are the guide's
// catalogue (server/services/skillScanTutor.js); a test fails if the two drift apart (node server/services/skillScanTutor.test.js).

export const SKILL_SCAN_TOOLS = [
  { id: 'scan', label: 'Scan a skill', group: 'Scan', icon: 'shield' },
  { id: 'deep', label: 'Deep scan', group: 'Scan', icon: 'sparkles' },
  { id: 'report', label: 'Report', group: 'Results', icon: 'file-text' },
  { id: 'history', label: 'Saved scans', group: 'Results', icon: 'list' },
];

export const GROUPS = ['Scan', 'Results'];

export const GROUP_TIPS = {
  Scan: 'Check an agent skill or plugin before you install it: paste a GitHub link or upload a zip.',
  Results: 'Read a scan’s verdict and findings, or open one you ran earlier.',
};

export const TOOL_TIPS = {
  scan: 'Paste a public github.com link to a skill or plugin, or upload a zip of its folder, then press Scan. The static scan reads the files and never runs them.',
  deep: 'Also has an AI model read the files for risks the patterns miss. Slower and costs a little per scan; the files are sent to Anthropic.',
  report: 'The verdict (Safe, Caution or Do not install), the risk score out of 100 and every finding with its file, line, explanation and fix.',
  history: 'Every scan you ran, newest first. Open one to read its report again, or delete it (it goes to the recycle bin).',
};

export const TOOL_BLURBS = {
  scan: 'A GitHub link or a zip in, a security verdict out.',
  deep: 'An AI read of the files on top of the static checks.',
  report: 'Verdict, score and findings.',
  history: 'Past scans, newest first.',
};

// The longer text for the (i) "How Skill Scanner works" box.
export const HOW_IT_WORKS = [
  ['What it does', 'Checks an AI agent skill or plugin (Claude Code, Codex, MCP and similar) for security risks before you install it, using NVIDIA’s open-source SkillSpector.'],
  ['What it looks for', 'Prompt injection, data exfiltration, credential access, privilege escalation, dangerous code, supply-chain problems (including known vulnerable dependencies), tool misuse, persistence and more: 71 patterns in 17 categories.'],
  ['Static and deep', 'The static scan reads the files and matches patterns, code structure and malware signatures. It is free and nothing leaves Vault except dependency names sent to OSV.dev to check for known vulnerabilities. A deep scan also has an AI model read the files, which catches subtler problems; it sends the files to Anthropic and costs a little per scan.'],
  ['The verdict', 'A risk score from 0 to 100: 0 to 20 Safe, 21 to 50 Caution, 51 and over Do not install. If the scan could not read everything, a Safe verdict is shown as Caution.'],
  ['Nothing is run', 'SkillSpector never runs the skill’s code or installs its packages. It works on a copy in a temporary folder that is deleted after the scan.'],
  ['What it cannot do', 'It cannot see the plugins installed on your own computer (zip the folder and upload it), cannot scan private repositories, and a Safe verdict is not a guarantee: read what a skill asks for before you trust it.'],
];

// Everything the guide can point at. `tool` is the tool its Open button switches to.
export const GUIDE_TOOLS = SKILL_SCAN_TOOLS.map(({ id, label }) => ({ id, label, tool: id }));

/** A public github.com repo link, optionally to a folder (/tree/<ref>/<path>). Mirrors the server's check in services/skillScan/runner.js. */
export const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}(?:\.git)?(?:\/tree\/[A-Za-z0-9._/-]{1,300})?\/?$/;
