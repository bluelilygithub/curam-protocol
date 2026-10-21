// What the PC Health page shows in its left-hand list, the hover text for it, and the controls its guide (the round button) can point
// at. The ids are the guide's catalogue (server/services/pcHealthTutor.js); npm run test:pc-health-tutor fails if the two lists drift
// apart. `tool` is the page the guide's Open button switches to. PC Health REPORTS; the one exception is Safe clean-up, which can empty
// four rebuildable folders (Temp, npm, pip and Yarn caches) only after the person switches items on and confirms.

export const PC_HEALTH_TOOLS = [
  { id: 'overview', label: 'Overview', group: 'Report', icon: 'activity', tour: 'pch-tab-overview' },
  { id: 'scan', label: 'Run a scan', group: 'Report', icon: 'play', tour: 'pch-tab-scan' },
  { id: 'disk', label: 'Disk space', group: 'Findings', icon: 'hard-drive', tour: 'pch-tab-disk' },
  { id: 'files', label: 'Large files', group: 'Findings', icon: 'files', tour: 'pch-tab-files' },
  { id: 'logs', label: 'Logs and leftovers', group: 'Findings', icon: 'file-text', tour: 'pch-tab-logs' },
  { id: 'growth', label: 'Growth', group: 'Findings', icon: 'trending-up', tour: 'pch-tab-growth' },
  { id: 'performance', label: 'Memory and processor', group: 'Findings', icon: 'cpu', tour: 'pch-tab-performance' },
  { id: 'history', label: 'Past scans', group: 'History and setup', icon: 'history', tour: 'pch-tab-history' },
  { id: 'helper', label: 'Set up the helper', group: 'History and setup', icon: 'key', tour: 'pch-tab-helper' },
  { id: 'cleanup', label: 'Safe clean-up', group: 'Clean-up', icon: 'trash', tour: 'pch-tab-cleanup' },
];

export const GROUPS = ['Report', 'Findings', 'Clean-up', 'History and setup'];

export const GROUP_TIPS = {
  Report: 'The latest findings in one page, and the button that asks your PC for a fresh look.',
  Findings: 'What the scan found, one kind of thing at a time. Everything here is a report only: nothing is changed.',
  'Clean-up': 'The only place PC Health can change anything: a short fixed list of caches that rebuild themselves, which you switch on and confirm yourself.',
  'History and setup': 'Earlier scans to compare with, and the small program that runs on your PC.',
};

export const TOOL_TIPS = {
  overview: 'The newest scan in one page: what needs a look first, then the numbers for disk, memory and processor. Each finding has a More info toggle, and Copy report copies it all as text to paste elsewhere.',
  scan: 'Ask your PC for a fresh look. Pick a quick check of the usual places, or the whole drive, and see when the helper has picked it up.',
  disk: 'How full each drive is, and the biggest folders on it.',
  files: 'The largest files found, biggest first, with when each was last changed and a More info toggle on each. Look only; nothing is deleted.',
  logs: 'Log files that keep growing, plus crash dumps, temporary files, caches, old installers and other things left behind.',
  growth: 'Folders that grew since the previous scan, and big new folders. Needs at least two scans.',
  performance: 'Memory in use and which programs use the most memory and processor time.',
  history: 'Your earlier scans. Open one to read it again.',
  helper: 'The small program that runs on your PC and does the looking. Create its key, download it and see if it is connected.',
  cleanup: 'See which items from the latest scan are safe to clear (Temp and the npm, pip and Yarn caches), switch on the ones you want and confirm. Nothing else is ever offered or removed.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  overview: 'The newest findings, most important first. This page only reports. The one thing that can change your PC is Safe clean-up, and only when you switch it on.',
  scan: 'Ask your PC for a fresh look. The helper on your PC does the scan and sends the report here.',
  disk: 'How full each drive is and which folders take the space.',
  files: 'The largest files found on the PC.',
  logs: 'Logs and other things that look left behind.',
  growth: 'What got bigger since the last scan.',
  performance: 'What is using memory and processor time.',
  history: 'Earlier scans you can open again.',
  helper: 'Connect the helper on your PC to Vault.',
  cleanup: 'Clear the few things that are safe to clear, only the ones you switch on.',
};

// The longer text for the (i) "How PC Health works" box.
export const HOW_IT_WORKS = [
  ['What it does', 'PC Health looks at your own computer and writes a report: how full each drive is, memory and processor use and which programs use the most, the largest files, the biggest folders, log files that keep growing, and things that look left behind (crash dumps, temporary files, caches, old installers).'],
  ['Reports first', 'PC Health reports and explains. It does not delete, move, rename or change any file, and it does not stop any program, except through Safe clean-up below. Every other finding is for you to look at and decide about yourself.'],
  ['Safe clean-up', 'The one exception. It can empty only four things that rebuild themselves: your Temp folder (files over a day old) and the npm, pip and Yarn download caches. It lists what it found in the latest scan, with what would be removed and why that is safe; you switch on the items you want and confirm. Nothing else is ever offered. It needs the helper started with an extra -AllowCleanup, so it cannot happen by accident, and what is removed is reported back. Deleting is permanent: these files do not go to the Recycle Bin.'],
  ['More info and Copy report', 'Each finding has a More info toggle: what the item is, why it matters, what you could consider doing and what to check first. The options are advice, never something PC Health does. Copy report copies the whole report as plain text (Copy with explanations adds every More info), ready to paste into a chat or email.'],
  ['How it reaches your PC', 'Vault runs on the internet and cannot see inside your PC. So a small helper program runs on your PC and checks Vault every 30 seconds. When you press Run a scan, the helper does the looking and sends the report back. Scanning only reads; it writes no files on your PC.'],
  ['Growth', 'Each scan is compared with your previous one, so folders that are growing show up. The first scan has nothing to compare with.'],
  ['Limits', 'Windows keeps some folders private even from programs you run, so a few sizes can be too low (the Recycle Bin, for example). A long scan stops at its time limit and says so. A processor reading is a few seconds of activity, not an average over the day.'],
  ['Who can use it', 'Only the Vault admin account can see this page, make the helper key or run a scan.'],
];

// Everything the guide can point at: the nine tools plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'overview', label: 'Overview', tool: 'overview' },
  { id: 'scan', label: 'Run a scan', tool: 'scan' },
  { id: 'scan-scope', label: 'Where to look', tool: 'scan' },
  { id: 'disk', label: 'Disk space', tool: 'disk' },
  { id: 'files', label: 'Large files', tool: 'files' },
  { id: 'logs', label: 'Logs and leftovers', tool: 'logs' },
  { id: 'growth', label: 'Growth', tool: 'growth' },
  { id: 'performance', label: 'Memory and processor', tool: 'performance' },
  { id: 'history', label: 'Past scans', tool: 'history' },
  { id: 'helper', label: 'Set up the helper', tool: 'helper' },
  { id: 'cleanup', label: 'Safe clean-up', tool: 'cleanup' },
  { id: 'cleanup-allow', label: 'Allow clean-up on the helper', tool: 'cleanup' },
];
