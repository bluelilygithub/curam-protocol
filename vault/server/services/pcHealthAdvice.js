'use strict';

// PC Health agent: the "More info" text for each finding. Pure code, by fixed rules on the finding's id, area and path, so the same
// finding always gets the same wording (no model). It only EXPLAINS and suggests options for the person to weigh: nothing here acts on
// the PC, and no text names a command to run (a test checks that). Added at read time, so wording changes apply to old scans too.
//
// explain(finding) -> { what, why, options: string[], caution }
//   what     what this item is
//   why      why it matters (or why it is probably fine)
//   options  things the person could consider, in their own hands
//   caution  what to check before touching anything ('' when there is nothing special)

const lower = (s) => String(s || '').toLowerCase();
const has = (p, ...bits) => bits.some((b) => p.includes(b));
const ext = (p) => { const m = /\.([a-z0-9]+)$/.exec(p); return m ? m[1] : ''; };

const CHECK_BEFORE = 'Open it in File Explorer first and make sure you recognise it. If you are unsure, leave it alone, or ask whoever set the program up.';

const WHAT_TO_DO_NEARLY_FULL = [
  'Work down the Large files and Logs and leftovers lists, starting with the biggest items you recognise.',
  'Move things you want to keep but rarely use (old archives, backups, installers) to an external drive or cloud storage.',
  'Empty the Recycle Bin once you are sure nothing in it is needed.',
  'If the drive is small for the way you work, a larger drive is the lasting fix.',
];

function diskAdvice() {
  return {
    what: 'The drive is close to full.',
    why: 'Windows needs free space for updates, temporary files and virtual memory, and programs (browsers, Docker, editors) can fail or slow right down when it runs out. Keeping roughly 15 to 20 percent free is a good habit.',
    options: WHAT_TO_DO_NEARLY_FULL,
    caution: 'Free space on an SSD also helps it last and stay fast, so it is worth fixing before it reaches zero.',
  };
}

function memoryAdvice(name) {
  const n = lower(name);
  if (!n) {
    return {
      what: 'Most of the computer\'s memory is in use.',
      why: 'When memory runs out Windows moves data to the disk, which makes everything slow, and a nearly full disk makes that worse.',
      options: ['Look at the programs listed under Memory and processor and close the ones you are not using.', 'Restart the PC if it has been on for days; memory use builds up.', 'If it is high every day with normal use, more memory is the lasting fix.'],
      caution: '',
    };
  }
  if (/chrome|msedge|firefox|brave|opera/.test(n)) {
    return {
      what: 'A web browser. Each tab, extension and background page runs as its own copy, which is why there are so many.',
      why: 'Browsers are usually the biggest memory user on a PC. Many open tabs, and tabs left open for days, add up.',
      options: ['Close tabs you are finished with, or use a tab-suspender feature so unused tabs give their memory back.', 'Look at the browser\'s own task manager (Shift+Esc in Chrome) to see which tab or extension is heaviest.', 'Remove extensions you do not use.'],
      caution: 'Make sure you have saved anything open in a tab (forms, drafts) before closing it.',
    };
  }
  if (n === 'node' || n === 'nodejs') {
    return {
      what: 'Node.js programs. For you this is usually development tools: dev servers, build watchers, and editor helpers.',
      why: 'Servers left running from earlier work, or tools that did not stop when a terminal was closed, keep holding memory.',
      options: ['Check Task Manager for node entries you do not recognise and stop the ones belonging to work you have finished.', 'Closing terminals and editors you are not using, and restarting the PC now and then, clears left-over ones.'],
      caution: 'Do not stop a node entry that belongs to something you are using right now (your Vault dev server, for example).',
    };
  }
  if (/vmmem|wsl|docker|com\.docker/.test(n)) {
    return {
      what: 'The virtual machine behind WSL or Docker Desktop. It holds the memory that Linux programs and containers use.',
      why: 'By default it can take a large share of the PC\'s memory and hold on to it even when the containers are idle.',
      options: ['Stop containers you are not using, or quit Docker Desktop when you are not working with it.', 'WSL can be given a memory limit in its settings file if it keeps taking too much.'],
      caution: 'Stopping it ends anything running inside it, so save work in those containers first.',
    };
  }
  if (/cursor|code|devenv|idea|pycharm|webstorm|studio/.test(n)) {
    return {
      what: 'A code editor and the helper programs it starts (language servers, extensions, terminals).',
      why: 'Editors with many windows, large projects or many extensions use a lot of memory, and it is not always given back when a project is closed.',
      options: ['Close windows for projects you are not working on.', 'Restart the editor now and then, and disable extensions you do not use.'],
      caution: '',
    };
  }
  return {
    what: `A program called ${name} (the number of running copies is in the finding).`,
    why: 'It is one of the larger memory users on the PC at the moment of the scan. That is normal if you were actively using it.',
    options: ['If you were not using it, close it from the taskbar or Task Manager.', 'If it uses this much memory every day with normal use, check the program for an update or a setting that limits it.'],
    caution: 'A background program with an unfamiliar name may belong to Windows or a driver. Search its name before stopping it.',
  };
}

function processorAdvice(name) {
  const n = lower(name);
  return {
    what: n ? `${name} was busy at the moment of the scan.` : 'The processor was busy when the scan ran.',
    why: 'This is a few seconds of activity, not an average. A scan itself, a build, a video or an update can all cause a short burst, so one reading is a hint rather than a diagnosis.',
    options: ['Run another scan at a quieter time, or at the time it feels slow, and see if the same program shows again.', 'If the same program is busy every time, look for an update, a stuck task inside it, or close and reopen it.'],
    caution: 'Windows Update, antivirus scans and indexing can be busy for a while and should be left to finish.',
  };
}

function fileAdvice(path) {
  const p = lower(path);
  const e = ext(p);
  const inDownloads = has(p, '\\downloads\\');

  if (has(p, 'docker_data.vhdx', '\\docker\\') && e === 'vhdx') {
    return {
      what: 'Docker Desktop\'s disk. Every image, container and volume (including any databases kept in volumes) lives inside this one file.',
      why: 'It grows as you use Docker, and it does not shrink by itself when you delete things inside Docker, so it can stay huge long after the space was used.',
      options: ['In Docker Desktop, remove images, containers and volumes you no longer need (its clean-up area helps).', 'After removing things, Docker Desktop\'s settings have disk options that can compact the disk image so the space is returned to Windows.', 'You can set a limit on the disk image size in Docker Desktop\'s settings.'],
      caution: 'Never delete the file itself: that removes every image, container and volume, including data you may not have copied out.',
    };
  }
  if (e === 'vhdx' && has(p, '\\wsl\\', 'ext4')) {
    return {
      what: 'The disk of a Linux (WSL) distribution. Its whole Linux system and every file you keep inside it live in this one file.',
      why: 'It grows as the Linux side fills and does not shrink by itself when files are deleted there.',
      options: ['Clean up inside the Linux system first (old packages, caches, projects you do not need).', 'Microsoft documents how to shrink a WSL disk afterwards so Windows gets the space back.', 'If you no longer use that distribution, exporting what you need and removing it through WSL itself frees the lot.'],
      caution: 'Deleting the file by hand destroys the whole Linux system and everything stored in it. Use WSL\'s own tools, and back up first.',
    };
  }
  if (has(p, 'claudevm.bundle', '\\vm_bundles\\')) {
    return {
      what: 'A virtual-machine disk kept by the Claude desktop app, and a compressed copy of it (the .zst file).',
      why: 'The app keeps it so it can start its sandbox quickly. It is large but it is the app\'s own working file.',
      options: ['Leave it unless you need the space; it belongs to the app.', 'If you do not use that part of the app, look in the app\'s settings for a way to turn it off or reset it.', 'Reinstalling the app clears it.'],
      caution: 'Deleting files inside an app\'s folder by hand can leave the app broken. Use the app\'s own settings or reinstall.',
    };
  }
  if (e === 'vhdx' || e === 'vhd' || e === 'vdi' || e === 'vmdk') {
    return {
      what: 'A virtual-machine disk. It holds a whole other system and its files.',
      why: 'These grow to their set size and stay big even when mostly empty.',
      options: ['If the virtual machine is no longer used, copy off anything you need and remove it through the program that owns it.', 'If you still use it, the program usually has a "compact" option.'],
      caution: 'Deleting it destroys that virtual machine and everything on it.',
    };
  }
  if (inDownloads && (e === 'exe' || e === 'msi')) {
    return {
      what: 'A program installer in your Downloads folder.',
      why: 'Once a program is installed, the installer is rarely needed again, and installers are often hundreds of megabytes.',
      options: ['If the program is installed and working, the installer is a good candidate to remove, since you can download a fresh one from the maker if needed.', 'If you want to keep it for a reinstall, move it to an external drive.'],
      caution: 'Check it is not the only copy of something you cannot download again, such as an old or licensed version.',
    };
  }
  if (inDownloads && (e === 'zip' || e === '7z' || e === 'rar' || e === 'tar' || e === 'gz' || e === 'daf')) {
    return {
      what: 'An archive file in your Downloads folder (a compressed bundle of other files, often a backup or an export).',
      why: 'Archives left in Downloads are the most common reason for a full drive. The files inside are often already extracted or backed up elsewhere.',
      options: ['Open it (or look at its date) to see what it holds and whether you have already extracted or stored that content.', 'Move ones you want to keep to an external drive or cloud storage.', 'Remove the ones you no longer need once you are sure.'],
      caution: 'Backups and site exports (the name often says what it is) may be the only copy. Check before removing.',
    };
  }
  if (e === 'iso' || e === 'img') {
    return {
      what: 'A disk image, usually an operating system or program install disc.',
      why: 'It is only needed while installing something.',
      options: ['If the install is done, you can usually download it again later, so removing it is reasonable.', 'Otherwise move it to external storage.'],
      caution: CHECK_BEFORE,
    };
  }
  if (e === 'sql') {
    return {
      what: 'A database export (a text copy of a database).',
      why: 'Exports are handy as a backup but are often forgotten once the job is done.',
      options: ['Keep it if it is your only backup of that database; otherwise move it to external storage or remove it when you are sure it is not needed.'],
      caution: 'It may hold real customer data, so store or dispose of it deliberately.',
    };
  }
  if (has(p, 'state.vscdb') && has(p, '\\cursor\\', '\\code\\')) {
    return {
      what: 'The editor\'s saved state database (settings, workspace memory and chat history), and its automatic backup copy if the name ends in .backup.',
      why: 'It grows with long histories. A very large one can make the editor slow to start.',
      options: ['Clearing old chat or workspace history inside the editor shrinks it.', 'The .backup copy is made by the editor itself.'],
      caution: 'Do not delete these while the editor is open. Removing the database by hand loses your saved state.',
    };
  }
  if (has(p, 'binlog.') || (has(p, '\\mysql\\') && has(p, 'binlog'))) {
    return {
      what: 'MySQL binary logs, a record of every change made to a local site\'s database.',
      why: 'They are kept for recovery and replication, and in local development they just accumulate.',
      options: ['Local (the WordPress tool) or MySQL can purge old logs safely through its own settings.', 'If a local site is finished with, removing the site in Local frees its whole database and logs.'],
      caution: 'Do not delete log files by hand while the site is running, as the database can fail to start.',
    };
  }
  if (e === 'pack' && has(p, '\\.git\\objects\\pack\\')) {
    return {
      what: 'The stored history of a Git repository (its commit history packed into one file).',
      why: 'Large packs mean the repository has big files or a long history. The size is usually permanent for that repository.',
      options: ['If you no longer need the project locally, the whole folder can be removed once everything is pushed to its remote.', 'Shrinking the history means changing the repository, which should be a deliberate decision.'],
      caution: 'Make sure the work is pushed elsewhere before removing a repository, since this pack is its history.',
    };
  }
  if (has(p, '\\local-updater\\')) {
    return {
      what: 'The downloaded update installer for the Local app.',
      why: 'It stays after the update is done.',
      options: ['It is a copy the app itself keeps. Updating or reinstalling the app usually replaces it.'],
      caution: 'Use the app rather than deleting files in its folder.',
    };
  }
  return {
    what: 'A large file.',
    why: 'Single big files are the quickest way to recover space, but only you know whether this one is needed.',
    options: ['Check when it was last changed (shown in the finding). One untouched for a year or more is a good candidate to move to external storage.', 'Open its folder to see what program or project it belongs to.'],
    caution: CHECK_BEFORE,
  };
}

function logAdvice(path, isTotal) {
  const p = lower(path);
  if (isTotal) {
    return {
      what: 'Many log files (records programs write about what they did).',
      why: 'Most logs are tiny, but ones that are never rotated or switched off keep growing. The biggest are listed under Logs and leftovers.',
      options: ['Deal with the largest few; they usually make up most of the total.', 'Where a program has a setting to turn off or limit logging, use that so it does not just fill up again.'],
      caution: 'Logs help find the cause of a fault. If something is currently misbehaving, keep recent logs.',
    };
  }
  if (has(p, 'wp-content') && has(p, 'debug')) {
    return {
      what: 'A WordPress debug log from a local site.',
      why: 'WordPress writes to it whenever debugging is switched on, and it never empties itself. Huge ones usually mean a warning is repeating many times.',
      options: ['Old ones from sites you have finished with can usually go with the site.', 'For a site you still work on, turning WordPress debug logging off, or fixing the repeating warning, stops it growing again.'],
      caution: 'If you are chasing a problem on that site right now, read the end of the log before clearing it.',
    };
  }
  return {
    what: 'A large log file.',
    why: 'A single log this big usually means something has been writing to it for a long time, or the same message is repeating.',
    options: ['Check the "last written" date. An old log from a program you no longer use is safe to remove.', 'For a program you still use, look in its settings for a log size limit or level.'],
    caution: CHECK_BEFORE,
  };
}

const LEFTOVER = {
  temp: {
    what: 'Temporary files that programs create while they work and leave behind.',
    why: 'They are meant to be short-lived, but many are never cleaned up.',
    options: ['Windows Settings has Storage Sense and a "Temporary files" clean-up that removes the safe ones for you.', 'Closing programs first lets more of them be cleared.'],
    caution: 'Do not clear a temp folder by hand while programs are installing or updating.',
  },
  cache: {
    what: 'A cache: copies of downloaded data that a program keeps to work faster.',
    why: 'Caches are rebuilt when needed, so they are one of the safer things to reclaim, but they can grow very large.',
    options: ['Use the program\'s own clear-cache option (for a browser, its clear browsing data screen) or Windows\' Disk Cleanup for Windows Update files.', 'The cache will fill up again with use, so this is a temporary gain.'],
    caution: 'Clearing a browser cache may log you out of some sites.',
  },
  'package-cache': {
    what: 'A package cache: copies of downloaded software libraries (for example npm, pip or NuGet) kept so installs are quicker.',
    why: 'It is only a convenience copy. Anything removed is downloaded again the next time a project needs it, so it is safe in the sense that nothing is lost, but the next install is slower.',
    options: ['Each tool has its own cache clean-up option; use that rather than removing folders.', 'A very large cache usually means many different project versions have been installed over time.'],
    caution: 'Clean it while you have a good internet connection, as the next installs will re-download.',
  },
  'recycle-bin': {
    what: 'Files you deleted that are still held in the Recycle Bin.',
    why: 'They still take up their full space until the bin is emptied.',
    options: ['Look through the Recycle Bin and restore anything you still need, then empty it.', 'Storage Sense can empty it automatically after a set number of days.'],
    caution: 'Emptying it is permanent. This size may be too low, since other accounts\' bins are private.',
  },
  'crash-dump': {
    what: 'Crash reports and memory dumps written when a program or Windows crashed.',
    why: 'They help a developer find a fault, but you rarely need them, and each can be large.',
    options: ['Windows Settings\' temporary files clean-up includes system error memory dump files.', 'If you have had no crashes lately, these are old.'],
    caution: 'If you are trying to diagnose repeated crashes, keep the recent ones until you have found the cause.',
  },
  installer: {
    what: 'A program installer left in your Downloads folder.',
    why: 'Once installed, an installer is rarely needed again.',
    options: ['If the program is installed and working, removing the installer is usually fine; you can download it again.', 'Move any you want to keep to external storage.'],
    caution: 'Keep installers for older or licensed versions you cannot download again.',
  },
  'disk-image': {
    what: 'A disk image or virtual disk file.',
    why: 'These are large and only needed while the thing they install or contain is in use.',
    options: ['Remove install images once the install is done, or move them to external storage.'],
    caution: 'A virtual disk may contain a whole system and its data. Check what it is first.',
  },
  'old-windows': {
    what: 'The previous Windows version, kept after an upgrade so you can roll back.',
    why: 'It is large, and Windows removes it by itself after about a month.',
    options: ['Let Windows remove it, or use the "Previous Windows installation" option in Windows Settings\' temporary files clean-up.'],
    caution: 'Once removed you can no longer roll back to the older Windows.',
  },
  'system-file': {
    what: 'A file Windows manages itself: the hibernation file, the page file (virtual memory), the swap file or a crash dump.',
    why: 'It explains where some space went, but it is not clutter. Windows needs the page file, and hibernation lets the PC resume where it left off.',
    options: ['No action is normally needed.', 'If you never use hibernation, Windows has a setting to turn it off, which gives the space back.'],
    caution: 'Do not try to delete these files by hand.',
  },
  other: {
    what: 'Something that looks left behind.',
    why: 'It is large enough to be worth a look.',
    options: ['Open the location and see what it belongs to.'],
    caution: CHECK_BEFORE,
  },
};

function growthAdvice() {
  return {
    what: 'A folder that is getting bigger between scans.',
    why: 'Growth is the early warning. A folder that grows by gigabytes a week will eventually fill the drive, even if it is small today.',
    options: ['Open the folder and sort by size or date to see what is being added.', 'Common causes are logs, caches, downloads, backups and database files. Fix the cause (turn down logging, set a cache limit, move backups) so it stops.', 'Run another scan in a few days to see whether it is still growing.'],
    caution: 'A new large folder may simply be a project or download you started recently.',
  };
}

/** The explanation for one finding (from analyse()). Always returns the same four fields. */
function explain(finding) {
  const id = lower(finding && finding.id);
  const path = finding && finding.path ? finding.path : '';
  if (id.startsWith('disk:')) return diskAdvice();
  if (id === 'ram:total') return memoryAdvice('');
  if (id.startsWith('ram:')) return memoryAdvice(id.slice(4));
  if (id === 'cpu:total') return processorAdvice('');
  if (id.startsWith('cpu:')) return processorAdvice(id.slice(4));
  if (id.startsWith('files:')) return fileAdvice(path);
  if (id === 'logs:total') return logAdvice('', true);
  if (id.startsWith('logs:')) return logAdvice(path, false);
  if (id.startsWith('leftover:')) {
    const kind = id.split(':')[1];
    return LEFTOVER[kind] || LEFTOVER.other;
  }
  if (id.startsWith('growth:')) return growthAdvice();
  return { what: '', why: '', options: [], caution: '' };
}

/** Attach `more` to every finding in a stored findings object ({ findings, growth, hadPrevious }). */
function withAdvice(stored) {
  if (!stored || !Array.isArray(stored.findings)) return stored;
  return { ...stored, findings: stored.findings.map((f) => ({ ...f, more: explain(f) })) };
}

module.exports = { explain, withAdvice };
