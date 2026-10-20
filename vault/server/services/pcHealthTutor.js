'use strict';

// The PC Health guide (the round button on Vault's /pc-health page, admin only): the admin says what they want to know about their
// PC ("why is it slow", "what is eating my disk", "how do I get a fresh report") and the guide points at the real tools and controls
// on the page, in order, or says plainly that PC Health does not do it. It only knows what is written here: it never sees a scan,
// a file name or a number from the PC. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/pcHealth/pcHealthTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/pc-health.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'overview', label: 'Overview', group: 'Report',
    does: 'The newest finished scan on one page: how many things are marked High and Watch, the findings in order of importance, and a card each for drives, memory and processor. Each finding says what was found and why it matters, and names the file or folder where there is one. Every finding has a More info toggle that opens what the item is, why it matters, what you could consider doing (your decision) and what to check first. Under the scan details, Copy report copies the whole report as plain text, and Copy with explanations does the same with every More info written out, so it can be pasted into a chat or email.',
    notes: 'It only reports and explains; the More info options are advice for you to weigh, never actions it takes. It has no delete, clean or fix button, and no finding carries a command to run. Nothing shows until the first scan has finished.' },
  { id: 'scan', label: 'Run a scan', group: 'Report',
    does: 'The Run a scan button asks the helper on the PC for a fresh look. The page shows Waiting for the helper, then Scanning, then the report opens by itself. Cancel stops a request that has not finished. Only one scan runs at a time.',
    notes: 'It needs the helper running on the PC (see Set up the helper). If the helper is not running the request waits until it is, and is dropped after a day.' },
  { id: 'scan-scope', label: 'Where to look', group: 'Report',
    does: 'Next to Run a scan, Where to look chooses between the usual places (your user folder, Public, ProgramData and the Windows temp and log folders; quick) and the whole C: drive (slow, up to the time limit). Large-file size sets how big a file must be to be listed (50 MB to 5 GB, 500 MB by default) and Time limit sets how many minutes the scan may take (1 to 30).',
    notes: 'A scan that hits its time limit stops and the report says it was cut short. Whole drive takes much longer than the usual places.' },
  { id: 'disk', label: 'Disk space', group: 'Findings',
    does: 'Every drive with a bar showing how full it is and the free space, then the biggest folders found (up to three levels deep) with their sizes.',
    notes: 'Folder sizes only cover the places the scan looked at. Windows keeps some folders private, so a few sizes can be too low.' },
  { id: 'files', label: 'Large files', group: 'Findings',
    does: 'The largest files the scan found, biggest first, with size, when each was last changed and its full location. A search box narrows the list, Copy location copies the location of a file so you can look at it in File Explorer, and More info on each file says what it probably is (Docker or WSL disk, installer, archive, editor database and so on) and what you could consider.',
    notes: 'It lists files; it does not say whether a file is safe to remove. That is for the person to decide. Only files above the large-file size are listed.' },
  { id: 'logs', label: 'Logs and leftovers', group: 'Findings',
    does: 'Four lists. Worth a look: the logs and leftovers large enough to flag, each with More info. Log files: how many were found, their total size, and the biggest (log, trace and event-trace files). Left behind: crash dumps, the Windows and user temp folders, caches (Windows Update, browsers, npm, pip, Yarn, NuGet), the Recycle Bin, an old Windows install, installers and disk images in a Downloads folder, and large Windows system files such as the hibernation and page files, each with a note about what it is.',
    notes: 'Windows manages the hibernation and page files itself; they are listed so the disk space is explained, not as something to remove. The Recycle Bin size can be too low because other accounts\' bins are private.' },
  { id: 'growth', label: 'Growth', group: 'Findings',
    does: 'Folders that grew since the previous scan, or large folders that are new, with how much they grew and about how much per day.',
    notes: 'Needs at least two finished scans of similar scope; after the first scan it says there is nothing to compare with yet. Scanning different places each time can make a folder look new.' },
  { id: 'performance', label: 'Memory and processor', group: 'Findings',
    does: 'How much memory is in use, the processor load when the scan ran, and a table of the programs using the most memory and processor time (several copies of one program, such as a browser, are added together).',
    notes: 'The processor figure is a few seconds of activity, not an average over the day, so a short burst can look worse than it is. A scan itself uses some processor and disk while it runs.' },
  { id: 'history', label: 'Past scans', group: 'History and setup',
    does: 'The last 30 scans with date, status and how many High and Watch findings each had. Open one to read it again.',
    notes: 'Older scans are removed automatically. A failed or cancelled scan is listed with the reason.' },
  { id: 'helper', label: 'Set up the helper', group: 'History and setup',
    does: 'Shows whether the helper is connected (and when it last checked in). Create helper key makes a new secret key, shown once; Download helper saves the PowerShell program; the page shows the one command to run it on the PC. Create a new key to replace the old one (the old helper stops working), or Remove key to switch the helper off.',
    notes: 'The helper is read-only: it looks and reports and writes no files on the PC. It must be running on the PC for scans to start. The key is shown only once, so keep the command it is in somewhere safe.' },
];

const RULES = [
  'PC Health only reports. It never deletes, moves, renames, cleans or changes a file, and never stops a program. Say so plainly whenever someone asks it to fix or clear something.',
  'Vault cannot see inside the PC itself. A small read-only helper running on the PC does the looking when Run a scan is pressed, and sends the report to Vault.',
  'Scans only ever cover the PC the helper is running on, and only the admin account can use this page.',
  'The usual places are checked quickly; the whole drive takes much longer and stops at the time limit.',
  'Each scan is compared with the previous one for Growth, so the first scan has nothing to compare with.',
  'Findings are marked High, Watch or Info by fixed rules in code (for example a drive more than 90% full, or a program using several gigabytes of memory), not by guesswork.',
  'The Open buttons in this chat only switch to a tool; they never scan or change anything by themselves.',
];

const NOT_POSSIBLE = [
  'Deleting, moving, cleaning up or fixing anything: PC Health only reports, so anything to remove has to be dealt with by the person themselves.',
  'Scanning a different computer, a phone, or the Vault server itself.',
  'Watching the PC all day or alerting in real time: it looks only when a scan is run.',
  'Telling whether a particular file is safe to delete, or removing malware or checking for viruses.',
  'Checking hardware faults, temperatures, drive health (SMART) or battery condition.',
  'Reading what is inside files or logs: it only sees names, sizes and dates.',
  'Running without the helper: with the helper off, no scan can start.',
];

const SYSTEM = `You are the guide to PC Health in Vault for the one admin who uses it to check their own computer for disk, memory and processor problems, large or growing files and left-behind logs. They say, in everyday words, what they want to know or do. You point them to the right tool(s) and controls on the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say PC Health cannot do.
- You cannot see any scan, file name, size or number from their PC. Never state or guess what is on their PC; point at the tool that shows it.
- PC Health never fixes anything. If they ask you to delete, clean or fix something, say it only reports and that they have to decide and act themselves, and never give a delete or cleanup command.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they have not run a scan yet, or the helper is not connected, start with Set up the helper, then Run a scan.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'PC Health guide', feature: 'pc_health_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'PC HEALTH TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to find out about your PC, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askPcHealthTutor: guide.ask,
};
