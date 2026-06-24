'use strict';

const fs = require('fs');
const path = require('path');
const { OUTPUT_ROOT, tryReadFile, fileExists } = require('./filewriter');
const { pageToSectionId } = require('../prompts/stage1-design');

function projectStatusFromStage(stage, metaStatus) {
  if (metaStatus === 'completed') return 'completed';
  if (stage === 'conversion-complete') return 'completed';
  return 'active';
}

function stageLabel(stage) {
  const map = {
    intake: 'Brief',
    'intake-complete': 'Brief saved',
    wireframe: 'Wireframe',
    design: 'Homepage designed',
    'design-approved': 'Design approved',
    'conversion-brief': 'WP brief',
    'conversion-complete': 'Theme ready',
  };
  return map[stage] || stage || 'New';
}

function defaultDisplayName(intakeData, sessionId) {
  const siteFor = intakeData?.purpose?.siteFor;
  const audience = intakeData?.purpose?.targetAudience;
  if (siteFor && audience) return `${siteFor} — ${audience}`.slice(0, 80);
  if (siteFor) return siteFor;
  return `Project ${String(sessionId).slice(0, 8)}`;
}

function initPagesFromIntake(intakeData) {
  const pages = intakeData?.structure?.pages?.length
    ? intakeData.structure.pages
    : ['Home', 'About', 'Services', 'Blog', 'Portfolio', 'Contact'];

  return {
    homepage: 'pending',
    items: pages
      .filter((p) => !/^home$/i.test(p))
      .map((label) => ({
        slug: pageToSectionId(label),
        label,
        template: 'page',
        status: 'pending',
      })),
  };
}

function enrichMeta(meta, intakeData, sessionId) {
  const stage = meta?.stage || 'intake';
  return {
    ...meta,
    displayName: meta.displayName || defaultDisplayName(intakeData, sessionId),
    status: projectStatusFromStage(stage, meta.status),
    stageLabel: stageLabel(stage),
    pages: meta.pages || (intakeData ? initPagesFromIntake(intakeData) : { homepage: 'pending', items: [] }),
  };
}

async function loadWebsiteSummary(sessionId) {
  if (!(await fileExists(sessionId, 'meta.json'))) return null;

  const metaRaw = await tryReadFile(sessionId, 'meta.json');
  const meta = metaRaw ? JSON.parse(metaRaw) : {};
  const intakeRaw = await tryReadFile(sessionId, 'intake.json');
  const intakeData = intakeRaw ? JSON.parse(intakeRaw) : null;
  const enriched = enrichMeta(meta, intakeData, sessionId);

  const hasDesign = await fileExists(sessionId, 'index.html');
  const hasApproved = await fileExists(sessionId, 'stage1/approved/index.html');
  const hasThemeZip = await fileExists(sessionId, 'theme.zip');

  const websiteLabel = meta.websiteLabel || enriched.displayName;

  return {
    sessionId,
    projectId: meta.projectId || null,
    websiteLabel,
    displayName: websiteLabel,
    status: enriched.status,
    stage: meta.stage || 'intake',
    stageLabel: enriched.stageLabel,
    locked: Boolean(meta.locked),
    pages: enriched.pages,
    updatedAt: meta.updatedAt || meta.createdAt || null,
    createdAt: meta.createdAt || null,
    canDownload: Boolean(meta.locked || hasApproved || hasThemeZip),
    resume: { hasDesign, hasApproved, hasThemeZip, themeSlug: meta.themeSlug || null },
  };
}

/** @deprecated use loadWebsiteSummary */
const loadProjectSummary = loadWebsiteSummary;

async function listProjects() {
  if (!fs.existsSync(OUTPUT_ROOT)) return [];

  const entries = fs.readdirSync(OUTPUT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const projects = [];
  for (const sessionId of entries) {
    try {
      const summary = await loadWebsiteSummary(sessionId);
      if (summary) projects.push(summary);
    } catch {
      // skip corrupt session dirs
    }
  }

  projects.sort((a, b) => {
    const ta = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
    const tb = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
    return tb - ta;
  });

  return projects;
}

module.exports = {
  listProjects,
  loadWebsiteSummary,
  loadProjectSummary,
  enrichMeta,
  initPagesFromIntake,
  projectStatusFromStage,
  stageLabel,
  defaultDisplayName,
};
