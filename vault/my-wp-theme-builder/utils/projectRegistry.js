'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  OUTPUT_ROOT,
  writeFile,
  tryReadFile,
  fileExists,
  deleteSession,
} = require('./filewriter');
const {
  loadWebsiteSummary,
  projectStatusFromStage,
  defaultDisplayName,
} = require('./projects');
const db = require('./db');

const PROJECTS_ROOT = process.env.THEME_BUILDER_PROJECTS_DIR
  || path.join(__dirname, '..', '..', 'data', 'theme-builder-projects');
const INDEX_PATH = path.join(PROJECTS_ROOT, 'index.json');

function ensureProjectsDir() {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
}

function emptyRegistry() {
  return { version: 1, projects: [] };
}

async function loadRegistry() {
  ensureProjectsDir();
  if (!fs.existsSync(INDEX_PATH)) return emptyRegistry();
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.projects)) return emptyRegistry();
    return data;
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(registry) {
  ensureProjectsDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(registry, null, 2), 'utf8');
}

function findProject(registry, projectId) {
  return registry.projects.find((p) => p.projectId === projectId) || null;
}

async function createWebsiteSession(projectId, websiteLabel) {
  const sessionId = uuidv4();
  const label = String(websiteLabel || '').trim() || `Website ${sessionId.slice(0, 8)}`;
  const meta = {
    stage: 'intake',
    status: 'active',
    projectId,
    websiteLabel: label,
    displayName: label,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pages: { homepage: 'pending', items: [] },
  };

  if (db.isEnabled()) {
    await db.ensureSession(sessionId, meta);
  } else {
    await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));
  }

  return { sessionId, meta };
}

async function migrateOrphanSessions(registry) {
  if (!fs.existsSync(OUTPUT_ROOT)) return registry;

  const knownWebsiteIds = new Set();
  for (const project of registry.projects) {
    for (const websiteId of project.websiteIds || []) {
      knownWebsiteIds.add(websiteId);
    }
  }

  const sessionDirs = fs.readdirSync(OUTPUT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let changed = false;

  for (const sessionId of sessionDirs) {
    if (!(await fileExists(sessionId, 'meta.json'))) continue;

    const metaRaw = await tryReadFile(sessionId, 'meta.json');
    const meta = metaRaw ? JSON.parse(metaRaw) : {};
    const intakeRaw = await tryReadFile(sessionId, 'intake.json');
    const intakeData = intakeRaw ? JSON.parse(intakeRaw) : null;

    if (meta.projectId) {
      let project = findProject(registry, meta.projectId);
      if (!project) {
        project = {
          projectId: meta.projectId,
          displayName: meta.projectName || meta.displayName || defaultDisplayName(intakeData, sessionId),
          status: projectStatusFromStage(meta.stage, meta.status),
          createdAt: meta.createdAt || new Date().toISOString(),
          updatedAt: meta.updatedAt || new Date().toISOString(),
          websiteIds: [],
        };
        registry.projects.push(project);
        changed = true;
      }
      if (!project.websiteIds.includes(sessionId)) {
        project.websiteIds.push(sessionId);
        project.updatedAt = new Date().toISOString();
        changed = true;
      }
      if (!meta.websiteLabel) {
        meta.websiteLabel = meta.displayName || defaultDisplayName(intakeData, sessionId);
        await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));
      }
      knownWebsiteIds.add(sessionId);
      continue;
    }

    if (knownWebsiteIds.has(sessionId)) continue;

    const projectId = uuidv4();
    const displayName = meta.displayName || defaultDisplayName(intakeData, sessionId);
    registry.projects.push({
      projectId,
      displayName,
      status: projectStatusFromStage(meta.stage, meta.status),
      createdAt: meta.createdAt || new Date().toISOString(),
      updatedAt: meta.updatedAt || new Date().toISOString(),
      websiteIds: [sessionId],
    });

    meta.projectId = projectId;
    meta.websiteLabel = meta.websiteLabel || displayName;
    await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));

    knownWebsiteIds.add(sessionId);
    changed = true;
  }

  if (changed) await saveRegistry(registry);
  return registry;
}

async function enrichProject(project) {
  const websites = [];
  for (const sessionId of project.websiteIds || []) {
    const summary = await loadWebsiteSummary(sessionId);
    if (summary) websites.push(summary);
  }

  websites.sort((a, b) => {
    const ta = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
    const tb = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
    return tb - ta;
  });

  const latest = websites[0]?.updatedAt || project.updatedAt;

  return {
    projectId: project.projectId,
    displayName: project.displayName,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: latest || project.updatedAt,
    websites,
    websiteCount: websites.length,
  };
}

async function listGroupedProjects() {
  let registry = await loadRegistry();
  registry = await migrateOrphanSessions(registry);

  const enriched = [];
  for (const project of registry.projects) {
    enriched.push(await enrichProject(project));
  }

  enriched.sort((a, b) => {
    const ta = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
    const tb = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
    return tb - ta;
  });

  const active = enriched.filter((p) => p.status !== 'completed');
  const completed = enriched.filter((p) => p.status === 'completed');

  return { projects: enriched, active, completed };
}

async function createProject(displayName, { websiteLabel } = {}) {
  const registry = await migrateOrphanSessions(await loadRegistry());
  const projectId = uuidv4();
  const name = String(displayName || '').trim() || `Project ${projectId.slice(0, 8)}`;

  const { sessionId, meta } = await createWebsiteSession(projectId, websiteLabel || name);

  const project = {
    projectId,
    displayName: name,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    websiteIds: [sessionId],
  };

  registry.projects.push(project);
  await saveRegistry(registry);

  return {
    project: await enrichProject(project),
    website: await loadWebsiteSummary(sessionId),
    sessionId,
    meta,
  };
}

async function addWebsite(projectId, websiteLabel) {
  const registry = await migrateOrphanSessions(await loadRegistry());
  const project = findProject(registry, projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const { sessionId } = await createWebsiteSession(projectId, websiteLabel);
  project.websiteIds.push(sessionId);
  project.updatedAt = new Date().toISOString();
  await saveRegistry(registry);

  return {
    project: await enrichProject(project),
    website: await loadWebsiteSummary(sessionId),
    sessionId,
  };
}

async function patchProject(projectId, patch) {
  const registry = await migrateOrphanSessions(await loadRegistry());
  const project = findProject(registry, projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  if (patch.displayName != null) {
    project.displayName = String(patch.displayName).trim() || project.displayName;
  }
  if (patch.status === 'active' || patch.status === 'completed') {
    project.status = patch.status;
  }
  project.updatedAt = new Date().toISOString();
  await saveRegistry(registry);

  return enrichProject(project);
}

async function deleteProject(projectId) {
  const registry = await migrateOrphanSessions(await loadRegistry());
  const project = findProject(registry, projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  for (const sessionId of [...(project.websiteIds || [])]) {
    await deleteSession(sessionId);
  }

  registry.projects = registry.projects.filter((p) => p.projectId !== projectId);
  await saveRegistry(registry);

  return { ok: true, projectId };
}

async function deleteWebsite(sessionId) {
  const registry = await migrateOrphanSessions(await loadRegistry());
  let parent = null;

  for (const project of registry.projects) {
    const idx = (project.websiteIds || []).indexOf(sessionId);
    if (idx >= 0) {
      parent = project;
      project.websiteIds.splice(idx, 1);
      project.updatedAt = new Date().toISOString();
      break;
    }
  }

  const exists = await fileExists(sessionId, 'meta.json');
  if (!exists && !parent) {
    const err = new Error('Website not found');
    err.status = 404;
    throw err;
  }

  if (exists) {
    await deleteSession(sessionId);
  }

  if (parent && parent.websiteIds.length === 0) {
    registry.projects = registry.projects.filter((p) => p.projectId !== parent.projectId);
  }

  await saveRegistry(registry);

  return { ok: true, sessionId, projectRemoved: Boolean(parent && parent.websiteIds.length === 0) };
}

async function touchProjectFromWebsite(sessionId) {
  const registry = await loadRegistry();
  const metaRaw = await tryReadFile(sessionId, 'meta.json');
  if (!metaRaw) return;
  const meta = JSON.parse(metaRaw);
  if (!meta.projectId) return;

  const project = findProject(registry, meta.projectId);
  if (!project) return;

  project.updatedAt = new Date().toISOString();
  if (project.status === 'completed' && meta.status === 'active') {
    project.status = 'active';
  }
  await saveRegistry(registry);
}

module.exports = {
  PROJECTS_ROOT,
  listGroupedProjects,
  createProject,
  addWebsite,
  patchProject,
  deleteProject,
  deleteWebsite,
  touchProjectFromWebsite,
  migrateOrphanSessions,
};
