'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const HOMEBREW_FORMULAE = [
  'ffmpeg',
  'whisper-cpp',
  'ollama',
];

const PIP_PACKAGES = [
  'pip',
  'setuptools',
  'torch',
  'transformers',
  'accelerate',
  'streamlit',
  'docling',
  'python-docx',
  'pdfplumber',
  'pypdf2',
  'pandas',
  'numpy',
  'pillow',
  'scipy',
  'python-dotenv',
  'loguru',
  'rich',
  'ollama',
];

const PIPX_PACKAGES = [
  'piper-tts',
];
const PIPX_PACKAGE_BINARIES = {
  'piper-tts': ['piper', 'piper-tts', path.join(os.homedir(), '.local/bin/piper')],
};

const OLLAMA_MODELS = ['qwen2.5-coder:14b', 'deepseek-r1:7b'];
const BREW_BINARY = process.env.HOMEBREW_COMMAND || '/opt/homebrew/bin/brew';
const PIPX_BINARY = process.env.PIPX_COMMAND || path.join(os.homedir(), '.local/bin/pipx');
const HOMEBREW_BINARIES = {
  ffmpeg: 'ffmpeg',
  'whisper-cpp': 'whisper-cli',
  ollama: 'ollama',
};

function defaultWhisperModelPath() {
  return path.join(os.homedir(), '.local/share/whisper.cpp/models/ggml-base.en.bin');
}

function defaultPiperVoicePath() {
  return path.join(os.homedir(), '.local/share/piper/voices/en_US-lessac-medium.onnx');
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    execFile(command, args, {
      timeout: options.timeout || 10 * 60 * 1000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 12,
      env: process.env,
    }, (error, stdout, stderr) => {
      resolve({
        command: [command, ...args].join(' '),
        ok: !error,
        exitCode: error?.code ?? 0,
        stdout: String(stdout || '').slice(-120000),
        stderr: String(stderr || error?.message || '').slice(-120000),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function runCommandCandidates(commands, args = [], options = {}) {
  let last = null;
  for (const command of commands) {
    const result = await runCommand(command, args, options);
    last = result;
    if (result.ok) return result;
  }
  return last;
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseBrewVersions(output = '') {
  const result = new Map();
  String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [name, ...versions] = line.split(/\s+/);
      if (name) result.set(name, versions.join(', '));
    });
  return result;
}

async function scanBrew() {
  const brewCommands = ['brew', BREW_BINARY];
  const outdated = await runCommandCandidates(brewCommands, ['outdated', '--json=v2'], { timeout: 2 * 60 * 1000 });
  if (!outdated.ok) {
    return {
      key: 'homebrew',
      label: 'Homebrew formulae',
      available: false,
      estimatedMinutes: '5-20',
      items: [],
      restoreNotes: 'Homebrew was not available or failed to report outdated packages.',
      error: outdated.stderr || outdated.stdout,
    };
  }
  const parsed = safeJson(outdated.stdout, {});
  const formulae = Array.isArray(parsed.formulae) ? parsed.formulae : [];
  const selectedVersionRows = await Promise.all(HOMEBREW_FORMULAE.map((name) => (
    runCommandCandidates(brewCommands, ['list', '--versions', name], { timeout: 60 * 1000 })
  )));
  const selectedByName = new Map();
  selectedVersionRows.forEach((result) => {
    parseBrewVersions(result.stdout).forEach((version, name) => selectedByName.set(name, version));
  });
  const outdatedByName = new Map(formulae.map((formula) => [formula.name, formula]));
  const selectedItems = await Promise.all(HOMEBREW_FORMULAE.map(async (name) => {
    const formula = outdatedByName.get(name);
    const installedVersion = selectedByName.get(name);
    const binaryName = HOMEBREW_BINARIES[name] || name;
    const binary = await runCommandCandidates(['which', '/usr/bin/which'], [binaryName], { timeout: 10 * 1000 });
    const binaryPath = binary.ok ? binary.stdout.trim() : '';
    return {
      name,
      current: formula?.installed_versions?.join(', ') || installedVersion || binaryPath || 'not installed',
      latest: formula?.current_version || formula?.newest_version || installedVersion || '',
      status: formula ? 'Update available' : installedVersion ? 'Up to date' : binaryPath ? 'Binary available; not managed by this Homebrew scan' : 'Not installed',
      action: formula || (!installedVersion && !binaryPath) ? 'brew upgrade/install' : 'verify installed / refresh if requested',
      willUpdate: !!formula || (!installedVersion && !binaryPath),
      restore: installedVersion || binaryPath
        ? `Recorded current Homebrew version(s). If rollback is needed, review Homebrew cache/Cellar availability for ${name}.`
        : `Uninstall ${name} if newly installed and rollback is needed.`,
    };
  }));
  const otherOutdatedItems = formulae
    .filter((formula) => !HOMEBREW_FORMULAE.includes(formula.name))
    .map((formula) => ({
      name: formula.name,
    current: Array.isArray(formula.installed_versions) ? formula.installed_versions.join(', ') : '',
    latest: formula.current_version || formula.newest_version || '',
    status: 'Update available',
    action: 'brew upgrade',
    willUpdate: true,
    restore: `Recorded previous Homebrew version(s). If rollback is needed, review Homebrew cache/Cellar availability for ${formula.name}.`,
    }));
  const items = [...selectedItems, ...otherOutdatedItems];
  return {
    key: 'homebrew',
    label: 'Homebrew formulae and local utilities',
    available: true,
    estimatedMinutes: items.length ? `${Math.max(5, items.length * 2)}-${Math.max(15, items.length * 5)}` : '1-2',
    items,
    restoreNotes: 'Report always includes monitored local utilities (ffmpeg, whisper-cpp, ollama) plus any other outdated formulae. Homebrew rollback depends on formula/cache availability and may require manual reinstall of a previous formula.',
  };
}

async function scanPip() {
  const installedResult = await runCommand('python', ['-m', 'pip', 'list', '--format=json'], { timeout: 2 * 60 * 1000 });
  const outdatedResult = await runCommand('python', ['-m', 'pip', 'list', '--outdated', '--format=json'], { timeout: 2 * 60 * 1000 });
  if (!installedResult.ok || !outdatedResult.ok) {
    return {
      key: 'python',
      label: 'Python packages',
      available: false,
      estimatedMinutes: '10-30',
      items: [],
      restoreNotes: 'Python/pip was not available or failed to report package state.',
      error: outdatedResult.stderr || installedResult.stderr,
    };
  }
  const installed = safeJson(installedResult.stdout, []);
  const outdated = safeJson(outdatedResult.stdout, []);
  const installedByName = new Map(installed.map((pkg) => [String(pkg.name || '').toLowerCase(), pkg]));
  const outdatedByName = new Map(outdated.map((pkg) => [String(pkg.name || '').toLowerCase(), pkg]));
  const items = PIP_PACKAGES
    .map((name) => {
      const key = name.toLowerCase();
      const current = installedByName.get(key);
      const newer = outdatedByName.get(key);
      if (!current && !newer) return null;
      return {
        name,
        current: current?.version || newer?.version || 'not installed',
        latest: newer?.latest_version || newer?.latest || current?.version || '',
        status: newer ? 'Update available' : 'Up to date',
        action: newer ? 'pip install --upgrade' : 'verify installed / refresh if requested',
        restore: current?.version ? `python -m pip install ${name}==${current.version}` : `python -m pip uninstall ${name}`,
        willUpdate: !!newer,
      };
    })
    .filter(Boolean);
  return {
    key: 'python',
    label: 'Python packages',
    available: true,
    estimatedMinutes: items.some((item) => item.willUpdate) ? '10-30' : '1-3',
    items,
    restoreNotes: 'Report lists exact package versions before any manual upgrade. Most Python package rollbacks can use the listed pip install package==version commands.',
  };
}

async function scanPipx() {
  let listed = await runCommandCandidates(['pipx', PIPX_BINARY], ['list', '--json'], { timeout: 60 * 1000 });
  if (!listed.ok) {
    listed = await runCommandCandidates(['python3', 'python'], ['-m', 'pipx', 'list', '--json'], { timeout: 60 * 1000 });
  }
  if (!listed.ok) {
    const fallbackItems = await Promise.all(PIPX_PACKAGES.map(async (name) => {
      const binaryNames = PIPX_PACKAGE_BINARIES[name] || [name];
      const binary = await runCommandCandidates(binaryNames, ['--version'], { timeout: 10 * 1000 });
      const explicitBinaryPath = binaryNames.find((candidate) => candidate.includes('/'));
      const binaryPathExists = explicitBinaryPath ? await pathExists(explicitBinaryPath) : false;
      const available = binary.ok || binaryPathExists;
      return {
        name,
        current: binary.ok
          ? (binary.stdout || binary.stderr || 'binary available').trim()
          : binaryPathExists ? explicitBinaryPath : 'unknown',
        latest: '',
        status: available ? 'Binary available; pipx metadata unavailable' : 'pipx unavailable; package not checked',
        action: available ? 'pipx upgrade' : 'pipx install/upgrade',
        willUpdate: !available,
        restore: available
          ? `Piper executable is available, but pipx metadata could not be read. Check pipx manually before changing ${name}.`
          : `Install ${name} with pipx install ${name} if needed.`,
      };
    }));
    return {
      key: 'pipx',
      label: 'pipx applications',
      available: fallbackItems.some((item) => !item.willUpdate),
      estimatedMinutes: '5-15',
      items: fallbackItems,
      restoreNotes: 'pipx was not available or failed to report application state. The report falls back to checking known app binaries such as piper.',
      error: fallbackItems.some((item) => !item.willUpdate) ? '' : (listed.stderr || listed.stdout),
    };
  }

  const parsed = safeJson(listed.stdout, {});
  const venvs = parsed.venvs && typeof parsed.venvs === 'object' ? parsed.venvs : {};
  const items = PIPX_PACKAGES.map((name) => {
    const venv = venvs[name];
    const mainPackage = venv?.metadata?.main_package || {};
    const version = mainPackage.package_version || mainPackage.version || '';
    return {
      name,
      current: version || (venv ? 'installed' : 'not installed'),
      latest: '',
      status: venv ? 'Installed; remote version not checked' : 'Not installed',
      action: venv ? 'pipx upgrade' : 'pipx install',
      restore: venv
        ? `Recorded current pipx version for ${name}. Rollback may require pipx uninstall ${name} && pipx install ${name}==${version || '<previous-version>'}.`
        : `Remove ${name} with pipx uninstall ${name} if newly installed and rollback is needed.`,
      willUpdate: !venv,
    };
  });

  return {
    key: 'pipx',
    label: 'pipx applications',
    available: true,
    estimatedMinutes: items.some((item) => item.willUpdate) ? '5-15' : '1-2',
    items,
    restoreNotes: 'Report checks selected pipx-managed apps such as Piper TTS. pipx does not provide a read-only outdated JSON report here, so installed apps are shown as remote-not-checked.',
  };
}

function parseOllamaList(output) {
  return String(output || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return { name: parts[0], id: parts[1], size: parts[2] && parts[3] ? `${parts[2]} ${parts[3]}` : parts[2] || '' };
    });
}

function ollamaFamily(name) {
  return String(name || '').split(':')[0];
}

function ollamaCleanupCandidates(models) {
  const selected = new Set(OLLAMA_MODELS);
  const selectedFamilies = new Set(OLLAMA_MODELS.map(ollamaFamily));
  return (models || []).filter((model) => {
    const name = model.name || '';
    return selectedFamilies.has(ollamaFamily(name)) && !selected.has(name);
  });
}

async function scanOllama() {
  const listed = await runCommand('ollama', ['list'], { timeout: 60 * 1000 });
  if (!listed.ok) {
    return {
      key: 'ollama',
      label: 'Ollama models',
      available: false,
      estimatedMinutes: '5-60',
      items: OLLAMA_MODELS.map((name) => ({
        name,
        current: 'unknown',
        latest: '',
        status: 'Ollama unavailable; remote tag not checked',
        action: 'ollama pull',
        willUpdate: false,
      })),
      restoreNotes: 'Ollama was not available. If models are updated manually later, record previous model IDs first if rollback matters.',
      error: listed.stderr || listed.stdout,
    };
  }
  const models = parseOllamaList(listed.stdout);
  const byName = new Map(models.map((model) => [model.name, model]));
  const cleanupCandidates = ollamaCleanupCandidates(models);
  const items = OLLAMA_MODELS.map((name) => {
    const current = byName.get(name);
    return {
      name,
      current: current?.id || 'not installed',
      latest: '',
      status: current ? 'Installed; remote tag not checked' : 'Not installed',
      action: 'ollama pull',
      restore: current?.id
        ? `Previous local model ID recorded as ${current.id}. Ollama tag rollback may require a saved model copy or repull if the registry tag changes.`
        : `Remove model with ollama rm ${name} if newly installed and rollback is needed.`,
      willUpdate: !current,
    };
  });
  return {
    key: 'ollama',
    label: 'Ollama models',
    available: true,
    estimatedMinutes: '5-60',
    items,
    cleanupCandidates,
    restoreNotes: 'Report lists current model IDs. Ollama does not expose a read-only outdated check here; use ollama pull manually if you want to refresh a tag.',
  };
}

async function scanLocalAssets() {
  const assets = [
    {
      name: 'Whisper STT model',
      filePath: process.env.LOCAL_WHISPER_MODEL || defaultWhisperModelPath(),
      installHint: 'Download a whisper.cpp ggml model and set LOCAL_WHISPER_MODEL if using a custom path.',
    },
    {
      name: 'Piper TTS voice',
      filePath: process.env.LOCAL_PIPER_VOICE || defaultPiperVoicePath(),
      installHint: 'Download a Piper .onnx voice file and set LOCAL_PIPER_VOICE if using a custom path.',
    },
  ];

  const checked = await Promise.all(assets.map(async (asset) => {
    const exists = await pathExists(asset.filePath);
    return {
      name: asset.name,
      current: exists ? asset.filePath : 'not found',
      latest: '',
      status: exists ? 'Found' : `Missing at ${asset.filePath}`,
      action: exists ? 'verify model file' : 'download/configure model file',
      restore: exists
        ? `Keep a backup copy of ${asset.filePath} before replacing this model asset.`
        : asset.installHint,
      willUpdate: !exists,
    };
  }));

  return {
    key: 'local-assets',
    label: 'Local speech model assets',
    available: true,
    estimatedMinutes: checked.some((item) => item.willUpdate) ? '5-20' : '1-2',
    items: checked,
    restoreNotes: 'Report checks local model/voice files used by offline STT/TTS. It does not download or replace model files.',
  };
}

function commandsForGroup(group) {
  if (group === 'homebrew') return ['brew update', 'brew outdated', 'brew upgrade'];
  if (group === 'python') return [`python -m pip install --upgrade ${PIP_PACKAGES.join(' ')}`];
  if (group === 'pipx') return PIPX_PACKAGES.map((pkg) => `pipx upgrade ${pkg} # or pipx install ${pkg} if missing`);
  if (group === 'ollama') return [
    ...OLLAMA_MODELS.map((model) => `ollama pull ${model} # manually refresh/install tag if desired`),
    'ollama rm <older same-family model tags> # optional manual cleanup after confirming refreshed models work',
  ];
  if (group === 'local-assets') return [
    'ls "$LOCAL_WHISPER_MODEL" # verify custom Whisper model path, if set',
    'ls "$LOCAL_PIPER_VOICE" # verify custom Piper voice path, if set',
  ];
  return [
    ...commandsForGroup('homebrew'),
    ...commandsForGroup('python'),
    ...commandsForGroup('pipx'),
    ...commandsForGroup('ollama'),
    ...commandsForGroup('local-assets'),
  ];
}

function estimateTotal(scans) {
  const hasPip = scans.some((scan) => scan.key === 'python' && scan.items.some((item) => item.willUpdate));
  const hasPipx = scans.some((scan) => scan.key === 'pipx' && scan.items.some((item) => item.willUpdate));
  const hasBrew = scans.some((scan) => scan.key === 'homebrew' && scan.items.length);
  const hasOllama = scans.some((scan) => scan.key === 'ollama' && scan.items.some((item) => item.willUpdate));
  const hasLocalAssets = scans.some((scan) => scan.key === 'local-assets' && scan.items.some((item) => item.willUpdate));
  let min = 2;
  let max = 5;
  if (hasBrew) { min += 5; max += 20; }
  if (hasPip) { min += 10; max += 30; }
  if (hasPipx) { min += 5; max += 15; }
  if (hasOllama) { min += 5; max += 60; }
  if (hasLocalAssets) { min += 5; max += 20; }
  return `${min}-${max} minutes`;
}

async function scanToolMaintenance() {
  const scannedAt = new Date().toISOString();
  const scans = await Promise.all([scanBrew(), scanPip(), scanPipx(), scanOllama(), scanLocalAssets()]);
  const groups = scans.map((scan) => ({
    ...scan,
    commands: commandsForGroup(scan.key),
  }));
  return {
    mode: 'report_only',
    enabled: true,
    scannedAt,
    estimatedTotal: estimateTotal(groups),
    groups,
    commands: commandsForGroup('all'),
    warning: 'This is a read-only update report. It does not run upgrades, delete models, or write restore manifests from the web app.',
  };
}

module.exports = {
  scanToolMaintenance,
};
