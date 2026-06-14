'use strict';

const { execFile } = require('child_process');

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

const OLLAMA_MODELS = ['qwen2.5-coder:14b', 'deepseek-r1:7b'];

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

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function scanBrew() {
  const outdated = await runCommand('brew', ['outdated', '--json=v2'], { timeout: 2 * 60 * 1000 });
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
  const items = formulae.map((formula) => ({
    name: formula.name,
    current: Array.isArray(formula.installed_versions) ? formula.installed_versions.join(', ') : '',
    latest: formula.current_version || formula.newest_version || '',
    status: 'Update available',
    action: 'brew upgrade',
    willUpdate: true,
    restore: `Recorded previous Homebrew version(s). If rollback is needed, review Homebrew cache/Cellar availability for ${formula.name}.`,
  }));
  return {
    key: 'homebrew',
    label: 'Homebrew formulae',
    available: true,
    estimatedMinutes: items.length ? `${Math.max(5, items.length * 2)}-${Math.max(15, items.length * 5)}` : '1-2',
    items,
    restoreNotes: 'Report lists outdated formulae and currently installed versions. Homebrew rollback depends on formula/cache availability and may require manual reinstall of a previous formula.',
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

function commandsForGroup(group) {
  if (group === 'homebrew') return ['brew update', 'brew outdated', 'brew upgrade'];
  if (group === 'python') return [`python -m pip install --upgrade ${PIP_PACKAGES.join(' ')}`];
  if (group === 'ollama') return [
    ...OLLAMA_MODELS.map((model) => `ollama pull ${model} # manually refresh/install tag if desired`),
    'ollama rm <older same-family model tags> # optional manual cleanup after confirming refreshed models work',
  ];
  return [
    ...commandsForGroup('homebrew'),
    ...commandsForGroup('python'),
    ...commandsForGroup('ollama'),
  ];
}

function estimateTotal(scans) {
  const hasPip = scans.some((scan) => scan.key === 'python' && scan.items.some((item) => item.willUpdate));
  const hasBrew = scans.some((scan) => scan.key === 'homebrew' && scan.items.length);
  const hasOllama = scans.some((scan) => scan.key === 'ollama' && scan.items.some((item) => item.willUpdate));
  let min = 2;
  let max = 5;
  if (hasBrew) { min += 5; max += 20; }
  if (hasPip) { min += 10; max += 30; }
  if (hasOllama) { min += 5; max += 60; }
  return `${min}-${max} minutes`;
}

async function scanToolMaintenance() {
  const scannedAt = new Date().toISOString();
  const scans = await Promise.all([scanBrew(), scanPip(), scanOllama()]);
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
