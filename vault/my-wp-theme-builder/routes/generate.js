const express = require('express');
const { v4: uuidv4 } = require('uuid');
const {
  buildHomeDesignPrompt,
  buildStage1IteratePrompt,
} = require('../prompts/stage1-design');
const { buildWireframePrompt, buildWireframeIteratePrompt } = require('../prompts/stage1-wireframe');
const { createDesignMessage, resolveIterateModel, resolveCssIterateModel, resolveStage1Model, enrichDesignPrompt } = require('../utils/modelCall');
const { parseDesignResponse, parseWireframeResponse } = require('../utils/parseDesign');
const { applyWireframeEnhancements, applyDesignEnhancements, listMissingFeatures, guaranteeFunctionality } = require('../utils/functionalityInject');
const { generateResponsiveCss, ensureStylesheetLinks, fallbackResponsiveCss, appendResponsiveGuarantees } = require('../utils/responsiveCss');
const { buildSiteShell } = require('../utils/siteShell');
const { normalizeIntakeData } = require('../utils/normalizeIntake');
const { stampRegionIds, describeTarget, extractRegionHtml, normalizeTargetId, stampIdAtLocator, findElementBounds } = require('../utils/regionIds');
const {
  buildTargetedWireframePrompt,
  buildTargetedDesignPrompt,
  buildTargetedCssPrompt,
  buildPageCssPrompt,
  isCssFocusedRequest,
  extractTargetFromRequest,
  applyCssOnlyIteration,
  appendGlobalCss,
  applyTargetedIteration,
  applyWireframeCssIteration,
  tryDirectColorCssPatch,
  consolidateWireframeIterateStyles,
  extractIteratePreviewCss,
} = require('../utils/targetedIterate');
const { detectSlop, buildDesloppifyPrompt } = require('../utils/slopDetect');
const { getTemplateType, isValidTemplateType, listTemplateTypes } = require('../utils/templateTypes');
const { buildTemplateDesignPrompt, buildTemplateIteratePrompt } = require('../prompts/template-design');
const { pageToSectionId } = require('../prompts/stage1-design');
const { writeFile, readFile, fileExists, tryReadFile } = require('../utils/filewriter');
const { createJobReporter, isJobCancelled } = require('../utils/jobProgress');
const { researchInspirationSites } = require('../utils/inspirationContext');
const { appendTraceEntry, loadTrace, clearTrace } = require('../utils/iterationTrace');
const { captureLesson, lessonFromIteration, lessonFromTruncation, loadLessons } = require('../utils/lessonsLearned');
const { initPagesFromIntake } = require('../utils/projects');
const db = require('../utils/db');

const router = express.Router();

async function nextVersion(sessionId) {
  const versionsPath = 'stage1/versions.json';
  const versionsRaw = await tryReadFile(sessionId, versionsPath);
  const versions = versionsRaw ? JSON.parse(versionsRaw) : [];
  const version = versions.length + 1;
  versions.push({ version, createdAt: new Date().toISOString() });
  await writeFile(sessionId, versionsPath, JSON.stringify(versions, null, 2));
  return version;
}

async function savePreview(sessionId, html, css, stage, responsiveCss = null) {
  let finalHtml = html;
  try {
    const intakeRaw = await tryReadFile(sessionId, 'intake.json');
    const functionality = intakeRaw ? (JSON.parse(intakeRaw).functionality || []) : [];
    finalHtml = guaranteeFunctionality(html, functionality);
  } catch {
    finalHtml = guaranteeFunctionality(html, []);
  }

  if (db.isEnabled()) {
    await db.saveHtml(sessionId, finalHtml, css);
  } else {
    await writeFile(sessionId, 'index.html', finalHtml);
    await writeFile(sessionId, 'style.css', css);
  }

  if (responsiveCss != null) {
    await writeFile(sessionId, 'responsive.css', responsiveCss);
  }

  const version = await nextVersion(sessionId);
  await writeFile(sessionId, `stage1/v${version}/index.html`, finalHtml);
  await writeFile(sessionId, `stage1/v${version}/style.css`, css);
  if (responsiveCss != null) {
    await writeFile(sessionId, `stage1/v${version}/responsive.css`, responsiveCss);
  }
  await writeFile(sessionId, 'stage1/current.json', JSON.stringify({
    version,
    phase: stage,
    hasResponsive: responsiveCss != null,
  }, null, 2));

  const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
  meta.stage = stage;
  meta.updatedAt = new Date().toISOString();
  await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));

  return version;
}

async function restorePreviousVersion(sessionId) {
  const currentRaw = await tryReadFile(sessionId, 'stage1/current.json');
  if (!currentRaw) {
    const err = new Error('No version history to undo');
    err.status = 400;
    throw err;
  }
  const current = JSON.parse(currentRaw);
  const prevVersion = Number(current.version) - 1;
  if (prevVersion < 1) {
    const err = new Error('Nothing to undo');
    err.status = 400;
    throw err;
  }

  const html = await tryReadFile(sessionId, `stage1/v${prevVersion}/index.html`);
  if (!html) {
    const err = new Error(`Previous version v${prevVersion} not found`);
    err.status = 404;
    throw err;
  }
  const css = (await tryReadFile(sessionId, `stage1/v${prevVersion}/style.css`)) || '';
  const responsiveCss = (await tryReadFile(sessionId, `stage1/v${prevVersion}/responsive.css`)) || null;

  if (db.isEnabled()) {
    await db.saveHtml(sessionId, html, css);
  } else {
    await writeFile(sessionId, 'index.html', html);
    await writeFile(sessionId, 'style.css', css);
  }
  if (responsiveCss != null) {
    await writeFile(sessionId, 'responsive.css', responsiveCss);
  }

  await writeFile(sessionId, 'stage1/current.json', JSON.stringify({
    version: prevVersion,
    phase: current.phase,
    hasResponsive: responsiveCss != null,
    undoneFrom: current.version,
    undoneAt: new Date().toISOString(),
  }, null, 2));

  const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
  meta.updatedAt = new Date().toISOString();
  await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));

  return { version: prevVersion, html, css, responsiveCss, phase: current.phase };
}

async function recordPrompt(sessionId, progress, prompt, model, label = 'last-prompt') {
  const payload = {
    model: model || null,
    recordedAt: new Date().toISOString(),
    label,
    system: prompt.system || '',
    user: prompt.user || '',
  };
  await writeFile(sessionId, `stage1/${label}.json`, JSON.stringify(payload, null, 2));
  await writeFile(sessionId, 'stage1/last-prompt.json', JSON.stringify(payload, null, 2));
  progress.setPrompt(payload);
}

async function callModelParsed({ sessionId, prompt, ctx, progress, parseFn, maxTokens = 16000 }) {
  const callCtx = {
    ...ctx,
    stage: 'stage1',
    maxTokens,
    onProgress: (label) => progress.addItem(label),
  };

  const runOnce = async (activePrompt, tokenLimit) => {
    const result = await createDesignMessage({ ...activePrompt, ...callCtx, maxTokens: tokenLimit });
    await writeFile(sessionId, 'stage1/last-raw-response.txt', result.text.slice(0, 80000));
    const parsed = parseFn(result.text);
    return { ...parsed, model: result.model };
  };

  try {
    return await runOnce(prompt, maxTokens);
  } catch (err) {
    if (err.truncated) {
      progress.addItem('Response truncated — retrying with compact layout…');
      const retryPrompt = {
        ...prompt,
        user: `${prompt.user}\n\nCRITICAL: Your previous response was cut off before </html>. Keep CSS under 100 lines using shared utility classes only. Complete ALL homepage sections and stub sections in the body.`,
      };
      try {
        return await runOnce(retryPrompt, maxTokens);
      } catch (retryErr) {
        retryErr.model = err.model;
        retryErr.canRetryLocal = true;
        throw retryErr;
      }
    }
    err.model = err.model || null;
    err.canRetryLocal = true;
    throw err;
  }
}

async function loadInspirationResearch(sessionId, intakeData) {
  if (!intakeData?.inspiration?.urls?.length) return [];
  const cached = await tryReadFile(sessionId, 'stage1/inspiration-research.json');
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through
    }
  }
  return researchInspirationSites(intakeData.inspiration.urls, { sessionId });
}

async function generateWireframeFromAI(sessionId, intakeData, { userId, model, jobId, inspirationResearch = [] } = {}) {
  const progress = createJobReporter(jobId, 'stage1');
  const normalized = normalizeIntakeData(intakeData);
  const shellHtml = normalized.functionality?.length ? buildSiteShell(normalized) : '';

  try {
    progress.start('analyse', 'Planning homepage wireframe');
    const prompt = buildWireframePrompt(normalized, inspirationResearch, shellHtml);
    const resolvedModel = await resolveStage1Model({ userId, model });
    await recordPrompt(sessionId, progress, prompt, resolvedModel, 'wireframe-prompt');
    progress.complete('analyse');

    const enrichedUser = await enrichDesignPrompt({
      system: prompt.system,
      user: prompt.user,
      userId,
      onProgress: (label) => progress.addItem(label),
    });

    progress.start('generate', 'Building homepage wireframe…');
    const result = await callModelParsed({
      sessionId,
      prompt: { system: prompt.system, user: enrichedUser },
      ctx: { userId, model },
      progress,
      parseFn: parseWireframeResponse,
      maxTokens: 16000,
    });

    progress.addItem('Guaranteeing wizard functionality…');
    let enhanced = applyWireframeEnhancements(
      result.html,
      result.css,
      normalized.functionality
    );
    let { html, css, model: modelUsed } = { ...result, ...enhanced };

    const stillMissing = listMissingFeatures(html, normalized.functionality);
    if (stillMissing.length && shellHtml) {
      progress.addItem(`Model omitted ${stillMissing.join(', ')} — using guaranteed shell`);
      html = applyWireframeEnhancements(shellHtml, result.css, normalized.functionality).html;
    } else if (stillMissing.length) {
      progress.addItem(`Warning: could not inject ${stillMissing.join(', ')}`);
    } else if (normalized.functionality?.length) {
      progress.addItem(`Functionality applied: ${normalized.functionality.join(', ')}`);
    }
    progress.complete('generate');

    progress.start('parse', 'Validating wireframe');
    progress.complete('parse');

    progress.start('save', 'Saving wireframe preview');
    html = stampRegionIds(html);
    await writeFile(sessionId, 'stage1/wireframe.html', html);
    const version = await savePreview(sessionId, html, css, 'wireframe');
    await updatePagesMeta(sessionId, { homepage: 'wireframe' });
    progress.complete('save');
    progress.finish();

    return { sessionId, version, html, css, model: modelUsed, phase: 'wireframe' };
  } catch (err) {
    progress.fail(err);
    throw err;
  }
}

async function loadSessionHtmlForPick(sessionId) {
  const html = await tryReadFile(sessionId, 'index.html');
  if (!html) return null;
  try {
    const intakeRaw = await tryReadFile(sessionId, 'intake.json');
    const functionality = intakeRaw ? (JSON.parse(intakeRaw).functionality || []) : [];
    return guaranteeFunctionality(html, functionality);
  } catch {
    return guaranteeFunctionality(html, []);
  }
}

async function resolveIterateHtml(sessionId, currentHtml) {
  const savedHtml = await loadSessionHtmlForPick(sessionId);
  return savedHtml || currentHtml || '';
}

async function assertSessionEditable(sessionId) {
  const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
  if (meta.locked || meta.stage === 'design-approved' || meta.stage === 'conversion-complete') {
    const err = new Error('This design is locked after approval — start a new iteration before approving, or create a new project');
    err.status = 403;
    throw err;
  }
  return meta;
}

async function updatePagesMeta(sessionId, patch) {
  const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
  meta.pages = { ...(meta.pages || {}), ...patch };
  if (patch.homepage) {
    meta.pages.homepage = patch.homepage;
  }
  if (patch.items) {
    meta.pages.items = patch.items;
  }
  meta.updatedAt = new Date().toISOString();
  await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));
}

async function loadApprovedWireframeHtml(sessionId) {
  const approved = await tryReadFile(sessionId, 'stage1/wireframe-approved.html');
  if (approved) return approved;

  if (db.isEnabled()) {
    const stored = await db.getHtml(sessionId);
    if (stored?.html) return stored.html;
  }

  const indexHtml = await tryReadFile(sessionId, 'index.html');
  if (indexHtml) return indexHtml;

  return tryReadFile(sessionId, 'stage1/wireframe.html');
}

async function loadSessionCss(sessionId) {
  if (db.isEnabled()) {
    const stored = await db.getHtml(sessionId);
    return stored?.css || '';
  }
  return (await tryReadFile(sessionId, 'style.css')) || '';
}

async function loadApprovedWireframeCss(sessionId) {
  const approved = await tryReadFile(sessionId, 'stage1/wireframe-approved.css');
  if (approved) return approved;
  return loadSessionCss(sessionId);
}

async function snapshotApprovedWireframe(sessionId) {
  let html = null;

  if (db.isEnabled()) {
    const stored = await db.getHtml(sessionId);
    html = stored?.html || null;
  } else {
    html = await tryReadFile(sessionId, 'index.html');
  }

  if (!html) {
    html = await tryReadFile(sessionId, 'stage1/wireframe.html');
  }

  if (!html) {
    const err = new Error('No wireframe preview found to approve — generate a wireframe first');
    err.status = 400;
    throw err;
  }

  const css = await loadSessionCss(sessionId);
  const { html: cleanHtml, css: cleanCss, consolidated } = consolidateWireframeIterateStyles(html, css);

  if (db.isEnabled()) {
    await db.saveHtml(sessionId, cleanHtml, cleanCss);
  } else {
    await writeFile(sessionId, 'index.html', cleanHtml);
    await writeFile(sessionId, 'style.css', cleanCss);
  }

  await writeFile(sessionId, 'stage1/wireframe-approved.html', cleanHtml);
  await writeFile(sessionId, 'stage1/wireframe-approved.css', cleanCss);
  await writeFile(sessionId, 'stage1/wireframe-approved.json', JSON.stringify({
    approvedAt: new Date().toISOString(),
    source: 'index.html',
    consolidatedTargets: consolidated,
  }, null, 2));

  return { html: cleanHtml, css: cleanCss, consolidated };
}

// Region/section ids that must survive any desloppify repair (a fix that drops
// one of these would break targeted editing and WordPress conversion).
const REQUIRED_ID_RE = /\sid=["'](tb-[a-z0-9-]+|site-navigation|home|about|services|blog|portfolio|contact)["']/gi;

function extractRequiredIds(html) {
  const ids = new Set();
  let match = REQUIRED_ID_RE.exec(String(html || ''));
  while (match) {
    ids.add(match[1].toLowerCase());
    match = REQUIRED_ID_RE.exec(String(html || ''));
  }
  return ids;
}

function preservesRequiredIds(originalHtml, fixedHtml) {
  const before = extractRequiredIds(originalHtml);
  const after = extractRequiredIds(fixedHtml);
  for (const id of before) {
    if (!after.has(id)) return false;
  }
  return true;
}

function slopGateEnabled(ctx) {
  if (ctx?.skipSlopGate) return false;
  return process.env.THEME_BUILDER_SLOP_GATE !== 'off';
}

/**
 * QA gate: detect AI-slop tells in the generated skin and, when warranted,
 * run a single targeted repair pass through the model. Never throws — on any
 * failure it keeps the original design.
 */
async function runSlopGate({ sessionId, html, css, ctx, progress, force = false }) {
  const before = detectSlop(html, css);
  const report = { before, ranAt: new Date().toISOString(), fixed: false };

  const actionable = force || before.errorCount > 0 || before.warnCount >= 3;
  if (!slopGateEnabled(ctx) || !actionable) {
    progress?.addItem?.(
      before.findings.length
        ? `Quality check: ${before.grade} (${before.errorCount} issues, ${before.warnCount} warnings) — no repair needed`
        : 'Quality check: clean (no slop detected)'
    );
    await writeFile(sessionId, 'stage1/slop-report.json', JSON.stringify(report, null, 2)).catch(() => {});
    return { html, css, report };
  }

  try {
    progress?.start?.('desloppify', `Quality check ${before.grade} — removing AI-slop tells…`);
    before.findings.forEach((f) => progress?.addItem?.(`• ${f.severity === 'error' ? 'Fix' : 'Review'}: ${f.label}`));

    const prompt = buildDesloppifyPrompt({ html, css, findings: before.findings });
    await recordPrompt(sessionId, progress, prompt, ctx?.model || null, 'desloppify-prompt');

    const result = await createDesignMessage({
      ...prompt,
      userId: ctx?.userId,
      model: ctx?.model,
      stage: 'stage1',
      maxTokens: 16000,
      onProgress: (label) => progress?.addItem?.(label),
    });
    await writeFile(sessionId, 'stage1/last-desloppify-raw.txt', String(result.text || '').slice(0, 100000)).catch(() => {});

    const parsed = parseDesignResponse(result.text, { fallbackCss: css });
    const fixedHtml = stampRegionIds(parsed.html);
    const fixedCss = parsed.css || css;

    if (!preservesRequiredIds(html, fixedHtml)) {
      progress?.addItem?.('Repair discarded — it would have dropped required regions; keeping original');
      report.rejected = 'missing-required-ids';
      await writeFile(sessionId, 'stage1/slop-report.json', JSON.stringify(report, null, 2)).catch(() => {});
      progress?.complete?.('desloppify');
      return { html, css, report };
    }

    const after = detectSlop(fixedHtml, fixedCss);
    const improved = after.errorCount < before.errorCount
      || (after.errorCount === before.errorCount && after.findings.length < before.findings.length);

    report.after = after;
    if (improved) {
      report.fixed = true;
      progress?.addItem?.(`Quality improved: ${before.grade} → ${after.grade}`);
      progress?.complete?.('desloppify');
      await writeFile(sessionId, 'stage1/slop-report.json', JSON.stringify(report, null, 2)).catch(() => {});
      return { html: fixedHtml, css: fixedCss, report };
    }

    progress?.addItem?.('Repair did not improve the score — keeping original');
    report.rejected = 'no-improvement';
    progress?.complete?.('desloppify');
    await writeFile(sessionId, 'stage1/slop-report.json', JSON.stringify(report, null, 2)).catch(() => {});
    return { html, css, report };
  } catch (err) {
    progress?.addItem?.(`Quality repair skipped (${err.message})`);
    report.error = err.message;
    await writeFile(sessionId, 'stage1/slop-report.json', JSON.stringify(report, null, 2)).catch(() => {});
    return { html, css, report };
  }
}

async function generateHomeDesignFromAI(sessionId, intakeData, { userId, model, jobId } = {}) {
  const progress = createJobReporter(jobId, 'stage1-home');

  try {
    const wireframeHtml = await loadApprovedWireframeHtml(sessionId);
    if (!wireframeHtml) {
      const err = new Error('No wireframe found — generate wireframe first');
      err.status = 400;
      throw err;
    }

    const wireframeCss = await loadApprovedWireframeCss(sessionId);
    const wireframeIterateCss = extractIteratePreviewCss(wireframeCss);
    const inspirationResearch = await loadInspirationResearch(sessionId, intakeData);

    progress.start('analyse', 'Reading wireframe & brief');
    const resolvedModel = await resolveStage1Model({ userId, model });
    const prompt = buildHomeDesignPrompt(
      intakeData,
      inspirationResearch,
      wireframeHtml,
      wireframeIterateCss
    );
    await recordPrompt(sessionId, progress, prompt, resolvedModel, 'home-design-prompt');
    progress.complete('analyse');

    const enrichedUser = await enrichDesignPrompt({
      system: prompt.system,
      user: prompt.user,
      userId,
      onProgress: (label) => progress.addItem(label),
    });

    progress.start('generate', 'Designing homepage…');
    const designResult = await callModelParsed({
      sessionId,
      prompt: { system: prompt.system, user: enrichedUser },
      ctx: { userId, model: resolvedModel },
      progress,
      parseFn: (raw) => parseDesignResponse(raw, { fallbackCss: wireframeCss }),
      maxTokens: 16000,
    });
    progress.addItem('Guaranteeing wizard functionality…');
    const enhancedDesign = applyDesignEnhancements(
      designResult.html,
      designResult.css,
      intakeData.functionality
    );
    let html = stampRegionIds(enhancedDesign.html);
    let css = enhancedDesign.css;
    const modelUsed = designResult.model;

    const gated = await runSlopGate({
      sessionId,
      html,
      css,
      ctx: { userId, model: resolvedModel, skipSlopGate: intakeData?.skipSlopGate },
      progress,
    });
    html = stampRegionIds(gated.html);
    css = gated.css;

    progress.start('responsive', 'Applying standard mobile CSS…');
    const responsiveCss = appendResponsiveGuarantees(fallbackResponsiveCss());
    html = ensureStylesheetLinks(html);
    progress.complete('responsive');
    progress.addItem('Standard responsive.css applied (no AI changes after Claude design)');
    progress.complete('generate');

    progress.start('parse', 'Validating HTML & CSS');
    progress.complete('parse');

    progress.start('save', 'Saving design preview');
    const version = await savePreview(sessionId, html, css, 'design', responsiveCss);
    await updatePagesMeta(sessionId, { homepage: 'designed' });
    progress.complete('save');
    progress.finish();

    return {
      sessionId,
      version,
      html,
      css,
      responsiveCss,
      model: modelUsed,
      responsiveModel: 'deterministic',
      phase: 'design',
      slopReport: gated.report,
    };
  } catch (err) {
    progress.fail(err);
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Multi-template theme building (page / single / cpt) — Phase 1
// ----------------------------------------------------------------------------

function templateDir(key) {
  return `stage1/templates/${key}`;
}

function extractTag(html, tag) {
  const match = String(html || '').match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'i'));
  return match ? match[0] : '';
}

function replaceTag(html, tag, replacement) {
  if (!replacement) return html;
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'i');
  if (re.test(html)) return html.replace(re, replacement);
  return html;
}

function extractRootTokens(css) {
  const blocks = String(css || '').match(/:root\s*\{[\s\S]*?\}/gi);
  return blocks ? blocks.join('\n') : '';
}

function composeTemplateCss(homeCss, additions) {
  const base = String(homeCss || '').trim();
  const add = String(additions || '').trim();
  if (!add) return base;
  return `${base}\n\n/* === template additions === */\n${add}`;
}

async function loadApprovedHomepage(sessionId) {
  if (db.isEnabled()) {
    const approved = await db.getApprovedHtml?.(sessionId);
    if (approved?.html) return { html: approved.html, css: approved.css || '' };
    const stored = await db.getHtml(sessionId);
    if (stored?.html) return { html: stored.html, css: stored.css || '' };
  }
  const approvedHtml = await tryReadFile(sessionId, 'stage1/approved/index.html');
  if (approvedHtml) {
    return { html: approvedHtml, css: (await tryReadFile(sessionId, 'stage1/approved/style.css')) || '' };
  }
  const indexHtml = await tryReadFile(sessionId, 'index.html');
  return { html: indexHtml || '', css: (await tryReadFile(sessionId, 'style.css')) || '' };
}

function upsertTemplateItem(meta, item) {
  meta.pages = meta.pages || { homepage: 'pending', items: [] };
  meta.pages.items = meta.pages.items || [];
  const idx = meta.pages.items.findIndex((i) => i.slug === item.slug);
  if (idx >= 0) {
    meta.pages.items[idx] = { ...meta.pages.items[idx], ...item };
  } else {
    meta.pages.items.push(item);
  }
}

async function patchTemplateItem(sessionId, key, patch) {
  const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
  upsertTemplateItem(meta, { slug: key, ...patch });
  meta.updatedAt = new Date().toISOString();
  await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));
  return meta;
}

async function saveTemplatePreview(sessionId, key, { html, additionsCss, fullCss, responsiveCss }) {
  const dir = templateDir(key);
  const versionsPath = `${dir}/versions.json`;
  const versionsRaw = await tryReadFile(sessionId, versionsPath);
  const versions = versionsRaw ? JSON.parse(versionsRaw) : [];
  const version = versions.length + 1;
  versions.push({ version, createdAt: new Date().toISOString() });
  await writeFile(sessionId, versionsPath, JSON.stringify(versions, null, 2));

  await writeFile(sessionId, `${dir}/index.html`, html);
  await writeFile(sessionId, `${dir}/style.css`, fullCss);
  await writeFile(sessionId, `${dir}/additions.css`, additionsCss || '');
  if (responsiveCss != null) await writeFile(sessionId, `${dir}/responsive.css`, responsiveCss);
  await writeFile(sessionId, `${dir}/v${version}/index.html`, html);
  await writeFile(sessionId, `${dir}/v${version}/style.css`, fullCss);
  await writeFile(sessionId, `${dir}/current.json`, JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2));
  return version;
}

async function loadTemplate(sessionId, key) {
  const dir = templateDir(key);
  const html = await tryReadFile(sessionId, `${dir}/index.html`);
  if (!html) return null;
  return {
    html,
    fullCss: (await tryReadFile(sessionId, `${dir}/style.css`)) || '',
    additionsCss: (await tryReadFile(sessionId, `${dir}/additions.css`)) || '',
    responsiveCss: (await tryReadFile(sessionId, `${dir}/responsive.css`)) || null,
  };
}

async function gatherTemplateReferences(sessionId, descriptor, home) {
  const refs = [];
  for (const refId of descriptor.inheritsFrom || []) {
    if (refId === 'home') {
      if (home?.html) refs.push({ label: 'homepage', html: home.html });
    } else {
      const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
      const item = (meta.pages?.items || []).find((i) => i.template === refId && i.status === 'approved');
      if (item) {
        const tpl = await loadTemplate(sessionId, item.slug);
        if (tpl?.html) refs.push({ label: item.label, html: tpl.html });
      }
    }
  }
  return refs;
}

function intakeSummaryText(intakeData) {
  const purpose = intakeData?.purpose || {};
  const parts = [];
  if (purpose.siteFor) parts.push(`Site type: ${purpose.siteFor}`);
  if (purpose.targetAudience) parts.push(`Audience: ${purpose.targetAudience}`);
  if (purpose.primaryAction) parts.push(`Primary action: ${purpose.primaryAction}`);
  return parts.join('; ');
}

async function finalizeTemplateOutput(sessionId, key, label, parsedHtml, additionsCss, home, miniBrief) {
  // Enforce inherited chrome regardless of what the model returned.
  let html = parsedHtml;
  const header = extractTag(home.html, 'header');
  const footer = extractTag(home.html, 'footer');
  if (header) html = replaceTag(html, 'header', header);
  if (footer) html = replaceTag(html, 'footer', footer);

  const components = Array.isArray(miniBrief?.components) ? miniBrief.components : [];
  const enhanced = applyDesignEnhancements(html, additionsCss, components);
  html = stampRegionIds(enhanced.html);
  const additions = enhanced.css;
  const fullCss = composeTemplateCss(home.css, additions);

  html = ensureStylesheetLinks(html);
  const responsiveCss = appendResponsiveGuarantees(fallbackResponsiveCss());

  const slopReport = detectSlop(html, fullCss);
  await writeFile(sessionId, `${templateDir(key)}/slop-report.json`, JSON.stringify({ before: slopReport, ranAt: new Date().toISOString() }, null, 2)).catch(() => {});

  const version = await saveTemplatePreview(sessionId, key, { html, additionsCss: additions, fullCss, responsiveCss });
  return { html, fullCss, additionsCss: additions, responsiveCss, slopReport, version };
}

async function generateTemplateDesign(sessionId, { key, label, type, cptSlug, miniBrief, intakeData, ctx }) {
  const descriptor = getTemplateType(type);
  if (!descriptor) {
    const err = new Error(`Unknown template type: ${type}`);
    err.status = 400;
    throw err;
  }

  const home = await loadApprovedHomepage(sessionId);
  if (!home.html) {
    const err = new Error('Design and approve the homepage before adding templates');
    err.status = 400;
    throw err;
  }

  const progress = createJobReporter(ctx.jobId, 'stage1-home');
  try {
    progress.start('analyse', `Reading the theme for "${label}"`);
    const references = await gatherTemplateReferences(sessionId, descriptor, home);
    const resolvedModel = await resolveStage1Model({ userId: ctx.userId, model: ctx.model });
    const prompt = buildTemplateDesignPrompt({
      descriptor,
      label,
      miniBrief,
      homepageHeader: extractTag(home.html, 'header'),
      homepageFooter: extractTag(home.html, 'footer'),
      tokensCss: extractRootTokens(home.css),
      homepageCssExcerpt: home.css,
      references,
      intakeSummary: intakeSummaryText(intakeData),
    });
    await recordPrompt(sessionId, progress, prompt, resolvedModel, `template-${key}-prompt`);
    progress.complete('analyse');

    progress.start('generate', `Designing the ${descriptor.label.toLowerCase()} template…`);
    const result = await createDesignMessage({
      ...prompt,
      userId: ctx.userId,
      model: resolvedModel,
      stage: 'stage1',
      maxTokens: 16000,
      onProgress: (lbl) => progress.addItem(lbl),
    });
    await writeFile(sessionId, `${templateDir(key)}/last-raw-response.txt`, String(result.text || '').slice(0, 80000)).catch(() => {});
    const parsed = parseDesignResponse(result.text, { fallbackCss: '' });
    progress.complete('generate');

    progress.start('save', 'Saving template preview');
    const out = await finalizeTemplateOutput(sessionId, key, label, parsed.html, parsed.css, home, miniBrief);
    await patchTemplateItem(sessionId, key, {
      label,
      template: type,
      cptSlug: cptSlug || null,
      miniBrief: miniBrief || {},
      status: 'designed',
      version: out.version,
    });
    progress.complete('save');
    progress.finish();

    return { sessionId, key, label, type, phase: 'design', model: result.model, ...out };
  } catch (err) {
    progress.fail(err);
    throw err;
  }
}

async function iterateTemplateDesign(sessionId, { key, changeRequest, ctx }) {
  const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
  const item = (meta.pages?.items || []).find((i) => i.slug === key);
  if (!item) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  const current = await loadTemplate(sessionId, key);
  if (!current) {
    const err = new Error('No template design to iterate on');
    err.status = 400;
    throw err;
  }
  const home = await loadApprovedHomepage(sessionId);

  const progress = createJobReporter(ctx.jobId, 'stage1-iterate');
  try {
    progress.start('generate', `Updating the "${item.label}" template…`);
    const resolvedModel = await resolveIterateModel({ userId: ctx.userId, model: ctx.model, phase: 'design' });
    const prompt = buildTemplateIteratePrompt({
      currentHtml: current.html,
      currentCss: current.additionsCss,
      changeRequest: changeRequest.trim(),
      label: item.label,
    });
    await recordPrompt(sessionId, progress, prompt, resolvedModel, `template-${key}-iterate-prompt`);
    const result = await createDesignMessage({
      ...prompt,
      userId: ctx.userId,
      model: resolvedModel,
      stage: 'stage1',
      maxTokens: 16000,
      onProgress: (lbl) => progress.addItem(lbl),
    });
    const parsed = parseDesignResponse(result.text, { fallbackCss: current.additionsCss });
    progress.complete('generate');

    progress.start('save', 'Saving template preview');
    const out = await finalizeTemplateOutput(sessionId, key, item.label, parsed.html, parsed.css, home, item.miniBrief);
    await patchTemplateItem(sessionId, key, { status: 'designed', version: out.version });
    progress.complete('save');
    progress.finish();

    return { sessionId, key, label: item.label, phase: 'design', model: result.model, ...out };
  } catch (err) {
    progress.fail(err);
    throw err;
  }
}

router.get('/session/:sessionId/prompt', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const raw = await tryReadFile(sessionId, 'stage1/last-prompt.json');
    if (!raw) {
      return res.status(404).json({ error: 'No saved prompt for this session' });
    }
    res.json(JSON.parse(raw));
  } catch (err) {
    next(err);
  }
});

router.get('/session/:sessionId/trace', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const trace = await loadTrace(sessionId);
    res.json({ sessionId, trace });
  } catch (err) {
    next(err);
  }
});

router.delete('/session/:sessionId/trace', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    await clearTrace(sessionId);
    res.json({ ok: true, sessionId });
  } catch (err) {
    next(err);
  }
});

router.get('/session/:sessionId/lessons', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const lessons = await loadLessons(sessionId);
    res.json({ sessionId, lessons });
  } catch (err) {
    next(err);
  }
});

// On-demand slop report: cached gate result, or a live detection on current files.
router.get('/session/:sessionId/slop', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const cached = await tryReadFile(sessionId, 'stage1/slop-report.json');
    if (cached) {
      return res.json({ sessionId, source: 'cached', report: JSON.parse(cached) });
    }
    const html = (await tryReadFile(sessionId, 'index.html')) || '';
    const css = (await tryReadFile(sessionId, 'style.css')) || '';
    if (!html) return res.status(400).json({ error: 'No design to analyse yet' });
    return res.json({ sessionId, source: 'live', report: { before: detectSlop(html, css) } });
  } catch (err) {
    next(err);
  }
});

// Manually run the desloppify repair pass on the current design and save a new version.
router.post('/session/:sessionId/desloppify', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await assertSessionEditable(sessionId);

    const html = await loadSessionHtmlForPick(sessionId);
    if (!html) return res.status(400).json({ error: 'No design to clean up' });
    const css = (await tryReadFile(sessionId, 'style.css')) || '';

    const ctx = generationContext(req);
    const progress = createJobReporter(ctx.jobId, 'stage1-desloppify');
    progress.start('desloppify', 'Running quality check…');

    const gated = await runSlopGate({
      sessionId,
      html,
      css,
      ctx: { ...ctx, model: resolveModelOverride(ctx) },
      progress,
      force: true,
    });

    if (!gated.report.fixed) {
      progress.finish();
      return res.json({ sessionId, changed: false, report: gated.report });
    }

    const currentRaw = await tryReadFile(sessionId, 'stage1/current.json');
    const phase = currentRaw ? JSON.parse(currentRaw).phase || 'design' : 'design';
    const responsiveCss = (await tryReadFile(sessionId, 'responsive.css')) || null;
    const version = await savePreview(sessionId, gated.html, gated.css, phase, responsiveCss);
    progress.finish();

    res.json({ sessionId, changed: true, version, html: gated.html, css: gated.css, report: gated.report });
  } catch (err) {
    next(err);
  }
});

function generationContext(req) {
  return {
    userId: req.user?.id ?? req.body.userId ?? null,
    model: req.body.model ?? null,
    jobId: req.body.jobId ?? null,
    useLocalModel: Boolean(req.body.useLocalModel),
  };
}

function resolveModelOverride(ctx) {
  if (ctx.useLocalModel) {
    return process.env.THEME_BUILDER_STAGE2_MODEL
      || process.env.DEFAULT_LOCAL_MODEL
      || 'ollama:qwen2.5-coder:14b';
  }
  return ctx.model;
}

async function ensureSession(sessionId) {
  if (!sessionId || !(await fileExists(sessionId, 'meta.json'))) {
    const newId = uuidv4();
    const meta = { stage: 'intake', createdAt: new Date().toISOString() };
    if (db.isEnabled()) {
      await db.ensureSession(newId, meta);
    } else {
      await writeFile(newId, 'meta.json', JSON.stringify(meta, null, 2));
    }
    return newId;
  }
  return sessionId;
}

async function saveBriefAndResearch(sessionId, intakeData, progress) {
  const normalized = normalizeIntakeData(intakeData);
  progress.start('save-brief', 'Saving intake data');
  await writeFile(sessionId, 'intake.json', JSON.stringify(normalized, null, 2));
  await writeFile(sessionId, 'stage1/functionality.json', JSON.stringify({
    selected: normalized.functionality,
    savedAt: new Date().toISOString(),
  }, null, 2));

  const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
  meta.stage = 'intake-complete';
  meta.updatedAt = new Date().toISOString();
  if (!meta.pages) meta.pages = initPagesFromIntake(normalized);
  if (!meta.displayName) {
    const { defaultDisplayName } = require('../utils/projects');
    meta.displayName = defaultDisplayName(normalized, sessionId);
  }
  await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));
  progress.complete('save-brief');

  let inspirationResearch = [];
  if (normalized?.inspiration?.urls?.length) {
    progress.start('research', 'Opening inspiration sites in headless browser…');
    try {
      inspirationResearch = await researchInspirationSites(normalized.inspiration.urls, {
        sessionId,
        onProgress: (message) => progress.updateMessage(message),
      });
      await writeFile(sessionId, 'stage1/inspiration-research.json', JSON.stringify(inspirationResearch, null, 2));
      const captured = inspirationResearch.filter((r) => r.ok).length;
      progress.updateMessage(`Inspiration research complete (${captured}/${inspirationResearch.length} sites captured)`);
    } catch (err) {
      console.error('Inspiration research failed:', err);
      progress.updateMessage(`Inspiration research failed (${err.message}) — continuing with your written brief`);
      inspirationResearch = [];
    }
    progress.complete('research');
  }

  return { inspirationResearch, intakeData: normalized };
}

router.post('/html', async (req, res, next) => {
  try {
    const { sessionId: bodySessionId, intakeData } = req.body;

    if (!intakeData || typeof intakeData !== 'object') {
      return res.status(400).json({ error: 'intakeData is required' });
    }

    const sessionId = await ensureSession(bodySessionId);
    const ctx = generationContext(req);
    const progress = createJobReporter(ctx.jobId, 'stage1');
    const { inspirationResearch, intakeData: savedIntake } = await saveBriefAndResearch(sessionId, intakeData, progress);

    const result = await generateWireframeFromAI(sessionId, savedIntake, {
      ...ctx,
      model: resolveModelOverride(ctx),
      inspirationResearch,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/design-home', async (req, res, next) => {
  try {
    const { sessionId: bodySessionId, intakeData, useLocalModel } = req.body;
    if (!bodySessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const sessionId = bodySessionId;
    const storedIntake = normalizeIntakeData(
      intakeData || JSON.parse(await readFile(sessionId, 'intake.json'))
    );
    const ctx = generationContext(req);

    await snapshotApprovedWireframe(sessionId);

    const result = await generateHomeDesignFromAI(sessionId, storedIntake, {
      ...ctx,
      model: useLocalModel
        ? (process.env.THEME_BUILDER_STAGE2_MODEL || 'ollama:qwen2.5-coder:14b')
        : ctx.model,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/session/:sessionId/design', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!(await fileExists(sessionId, 'intake.json'))) {
      return res.status(400).json({ error: 'Intake data required before generation' });
    }
    const intakeData = normalizeIntakeData(JSON.parse(await readFile(sessionId, 'intake.json')));
    const result = await generateHomeDesignFromAI(sessionId, intakeData, generationContext(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

async function runStage1Iterate({ sessionId, html, currentCss, changeRequest, phase, ctx, targetId }) {
  const progress = createJobReporter(ctx.jobId, 'stage1-iterate');
  const isWireframe = phase === 'wireframe';
  const trimmedRequest = changeRequest.trim();
  const stage = isWireframe ? 'wireframe' : 'design';
  const cssOnly = isCssFocusedRequest(trimmedRequest);
  let normalizedTarget = targetId ? normalizeTargetId(targetId) : '';
  if (!normalizedTarget) {
    normalizedTarget = normalizeTargetId(extractTargetFromRequest(trimmedRequest));
  }

  const assertNotCancelled = () => {
    if (ctx.jobId && isJobCancelled(ctx.jobId)) {
      const err = new Error('Generation cancelled');
      err.status = 499;
      err.cancelled = true;
      throw err;
    }
  };

  try {
    progress.start('read', 'Reading your current design');
    const resolvedModel = cssOnly
      ? await resolveCssIterateModel({ model: ctx.model })
      : await resolveIterateModel({
        userId: ctx.userId,
        model: ctx.model,
        targeted: Boolean(normalizedTarget),
        phase: stage,
        cssOnly,
      });

    const modelLabel = String(resolvedModel || '').replace(/^ollama:/, '');
    progress.addItem(`Model: ${modelLabel}${resolvedModel.startsWith('ollama:') ? ' (local)' : ''}`);

    let parsed;
    let modelUsed;

    assertNotCancelled();

    if (cssOnly) {
      progress.addItem('CSS/visual update');

      if (normalizedTarget) {
        const stamped = stampRegionIds(html);
        const target = describeTarget(stamped, normalizedTarget);
        if (!target) {
          const hint = /^tb-pick-/i.test(normalizedTarget)
            ? `Picked element #${normalizedTarget} is not in saved HTML. Use Pick element again, then iterate.`
            : `No region found for #${normalizedTarget}. Check the region ID in your message.`;
          const err = new Error(hint);
          err.status = 400;
          throw err;
        }
        const fragment = extractRegionHtml(stamped, normalizedTarget);

        const directPatch = tryDirectColorCssPatch(stamped, currentCss, normalizedTarget, trimmedRequest, {
          wireframe: isWireframe,
        });
        if (directPatch) {
          progress.addItem(`Applied colour directly on #${target.id} — no model call`);
          progress.complete('read');
          progress.start('generate', `Updating #${target.id}…`);
          parsed = directPatch;
          modelUsed = 'direct-css';
          progress.complete('generate');
        } else {
        const prompt = buildTargetedCssPrompt({
          target,
          fragment,
          changeRequest: trimmedRequest,
          currentCss,
        });

        await recordPrompt(sessionId, progress, prompt, resolvedModel, 'iterate-prompt');
        progress.complete('read');
        progress.start('generate', `Updating CSS for #${target.id}…`);

        assertNotCancelled();
        const result = await createDesignMessage({
          ...prompt,
          ...ctx,
          model: resolvedModel,
          stage: 'stage2',
          maxTokens: 512,
          temperature: 0.15,
          onProgress: (label) => progress.addItem(label),
          abortSignal: ctx.abortSignal,
        });
        modelUsed = result.model;
        await writeFile(sessionId, 'stage1/last-iterate-raw.txt', String(result.text || '').slice(0, 100000));

        if (isWireframe) {
          parsed = applyWireframeCssIteration(stamped, currentCss, normalizedTarget, result.text, trimmedRequest);
        } else {
          parsed = {
            html: stamped,
            css: applyCssOnlyIteration(currentCss, normalizedTarget, result.text, {
              changeRequest: trimmedRequest,
              wireframe: false,
            }),
          };
        }
        if (!parsed?.css) {
          const err = new Error('Could not extract CSS from model response');
          err.status = 502;
          throw err;
        }
        progress.complete('generate');
        }
      } else {
        const prompt = buildPageCssPrompt({ changeRequest: trimmedRequest, currentCss });
        await recordPrompt(sessionId, progress, prompt, resolvedModel, 'iterate-prompt');
        progress.complete('read');
        progress.start('generate', 'Updating stylesheet…');

        assertNotCancelled();
        const result = await createDesignMessage({
          ...prompt,
          ...ctx,
          model: resolvedModel,
          stage: 'stage2',
          maxTokens: 512,
          temperature: 0.15,
          onProgress: (label) => progress.addItem(label),
          abortSignal: ctx.abortSignal,
        });
        modelUsed = result.model;
        await writeFile(sessionId, 'stage1/last-iterate-raw.txt', String(result.text || '').slice(0, 100000));

        const mergedCss = applyCssOnlyIteration(currentCss, 'global', result.text, {
          changeRequest: trimmedRequest,
          wireframe: isWireframe,
        })
          || appendGlobalCss(currentCss, result.text.replace(/^---CSS---/i, '').trim());
        if (!mergedCss) {
          const err = new Error('Could not extract CSS from model response');
          err.status = 502;
          throw err;
        }
        parsed = { html, css: mergedCss };
      }
      progress.complete('generate');
    } else if (normalizedTarget) {
      const stamped = stampRegionIds(html);
      const target = describeTarget(stamped, normalizedTarget);
      if (!target) {
        const hint = /^tb-pick-/i.test(normalizedTarget)
          ? `Picked element #${normalizedTarget} is not in saved HTML. Use Pick element again, then iterate.`
          : `No region found for #${normalizedTarget}. Use Pick element in the preview, or reference an id such as tb-search, contact, tb-header.`;
        const err = new Error(hint);
        err.status = 400;
        throw err;
      }

      const fragment = extractRegionHtml(stamped, normalizedTarget);
      const prompt = isWireframe
        ? buildTargetedWireframePrompt({ target, fragment, changeRequest: trimmedRequest })
        : buildTargetedDesignPrompt({ target, fragment, changeRequest: trimmedRequest, currentCss });

      await recordPrompt(sessionId, progress, prompt, resolvedModel, 'iterate-prompt');
      progress.complete('read');

      progress.start('generate', `Updating #${target.id}…`);
      progress.addItem(`Target: #${target.id} (${target.label})`);
      progress.addItem(`Fragment update via ${resolvedModel.replace(/^ollama:/, '')}`);
      progress.addItem(`"${trimmedRequest.slice(0, 80)}${trimmedRequest.length > 80 ? '…' : ''}"`);

      assertNotCancelled();
      const result = await createDesignMessage({
        ...prompt,
        ...ctx,
        model: resolvedModel,
        stage: !isWireframe && resolvedModel.startsWith('ollama:') ? 'stage2' : 'stage1',
        maxTokens: 8000,
        onProgress: (label) => progress.addItem(label),
        abortSignal: ctx.abortSignal,
      });
      modelUsed = result.model;
      await writeFile(sessionId, 'stage1/last-iterate-raw.txt', String(result.text || '').slice(0, 100000));

      const applied = applyTargetedIteration(html, normalizedTarget, result.text, { isWireframe });
      parsed = {
        html: applied.html,
        css: applied.css
          ? `${currentCss}\n\n/* #${target.id} */\n${applied.css}`
          : currentCss,
      };
      progress.complete('generate');
    } else {
      const prompt = isWireframe
        ? buildWireframeIteratePrompt({ currentHtml: html, changeRequest: trimmedRequest })
        : buildStage1IteratePrompt({ currentHtml: html, currentCss, changeRequest: trimmedRequest });
      await recordPrompt(sessionId, progress, prompt, resolvedModel, 'iterate-prompt');
      progress.complete('read');

      progress.start('generate', 'Generating updated content…');
      progress.addItem(`"${trimmedRequest.slice(0, 80)}${trimmedRequest.length > 80 ? '…' : ''}"`);
      progress.addItem('Tip: use Pick element to target a specific region next time');

      const result = await createDesignMessage({
        ...prompt,
        ...ctx,
        stage: 'stage1',
        maxTokens: 16000,
        onProgress: (label) => progress.addItem(label),
      });
      modelUsed = result.model;

      try {
        parsed = isWireframe ? parseWireframeResponse(result.text) : parseDesignResponse(result.text);
      } catch (err) {
        await writeFile(sessionId, 'stage1/last-iterate-raw.txt', String(result.text || '').slice(0, 100000));

        const extractFailed = /extract wireframe HTML/i.test(err.message);
        const shouldRetry = isWireframe && (err.truncated || extractFailed);
        if (!shouldRetry) throw err;

        progress.updateMessage(extractFailed
          ? 'Could not read response — retrying with stricter format…'
          : 'Truncated — retrying with compact layout…');
        const retryPrompt = buildWireframeIteratePrompt({
          currentHtml: html,
          changeRequest: `${trimmedRequest}\n\nIMPORTANT: Return ONLY:\n---HTML---\n<!DOCTYPE html>…full document…</html>\nNo markdown fences. No commentary before or after. Must include </body></html>.`,
        });
        const retry = await createDesignMessage({
          ...retryPrompt,
          ...ctx,
          stage: 'stage1',
          maxTokens: 16000,
        });
        await writeFile(sessionId, 'stage1/last-iterate-retry-raw.txt', String(retry.text || '').slice(0, 100000));
        parsed = parseWireframeResponse(retry.text);
      }
      progress.complete('generate');
    }

    progress.start('validate', 'Validating the new layout');
    progress.complete('validate');

    progress.start('save', 'Saving preview');
    let outHtml = parsed.html;
    let outCss = parsed.css || currentCss;
    let responsiveCss = null;
    const intakeRaw = await tryReadFile(sessionId, 'intake.json');
    const functionality = intakeRaw ? (JSON.parse(intakeRaw).functionality || []) : [];

    if (isWireframe) {
      const enhanced = applyWireframeEnhancements(outHtml, outCss, functionality);
      outHtml = enhanced.html;
      outCss = enhanced.css;
      await writeFile(sessionId, 'stage1/wireframe.html', outHtml);
      progress.complete('responsive');
    } else {
      const enhanced = applyDesignEnhancements(outHtml, outCss, functionality);
      outHtml = enhanced.html;
      outCss = enhanced.css;

      responsiveCss = (await tryReadFile(sessionId, 'responsive.css')) || appendResponsiveGuarantees(fallbackResponsiveCss());
      outHtml = ensureStylesheetLinks(outHtml);
      progress.complete('responsive');
    }

    const version = await savePreview(sessionId, outHtml, outCss, stage, responsiveCss);
    progress.complete('save');
    progress.finish();

    const traceEntry = await appendTraceEntry(sessionId, {
      type: 'iteration',
      phase: stage,
      request: trimmedRequest,
      targetId: normalizedTarget || null,
      status: 'success',
      version,
      model: modelUsed,
    });

    const lesson = await captureLesson(sessionId, {
      lesson: lessonFromIteration({
        changeRequest: trimmedRequest,
        phase: stage,
        version,
        ok: true,
      }),
      category: 'iteration-success',
      metadata: { version, model: modelUsed },
    });

    return {
      sessionId,
      version,
      html: outHtml,
      css: outCss,
      responsiveCss,
      model: modelUsed,
      phase: stage,
      traceEntry,
      lesson,
    };
  } catch (err) {
    progress.fail(err);
    if (!(err.cancelled || err.status === 499)) {
      await appendTraceEntry(sessionId, {
        type: 'iteration',
        phase: stage,
        request: trimmedRequest,
        status: 'failed',
        error: err.message,
      });
      await captureLesson(sessionId, {
        lesson: lessonFromIteration({
          changeRequest: trimmedRequest,
          phase: stage,
          ok: false,
          error: err.message,
        }),
        category: 'iteration-failure',
      });
      if (err.truncated) {
        await captureLesson(sessionId, {
          lesson: lessonFromTruncation({ phase: stage }),
          category: 'truncation',
        });
      }
    }
    throw err;
  }
}

router.post('/iterate', async (req, res, next) => {
  try {
    const { sessionId, currentHtml, changeRequest, phase = 'design', targetId } = req.body;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!changeRequest?.trim()) return res.status(400).json({ error: 'changeRequest is required' });
    if (!(await fileExists(sessionId, 'meta.json'))) return res.status(404).json({ error: 'Session not found' });
    await assertSessionEditable(sessionId);

    const html = await resolveIterateHtml(sessionId, currentHtml);
    if (!html) return res.status(400).json({ error: 'No design to iterate on' });

    const currentCss = (await tryReadFile(sessionId, 'style.css')) || '';
    const ctx = generationContext(req);
    const data = await runStage1Iterate({
      sessionId,
      html,
      currentCss,
      changeRequest,
      phase,
      targetId,
      ctx,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/session/:sessionId/iterate', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { changeRequest, currentHtml, phase, jobId, targetId } = req.body;
    if (!changeRequest) return res.status(400).json({ error: 'changeRequest is required' });
    await assertSessionEditable(sessionId);
    if (!(await fileExists(sessionId, 'index.html'))) {
      return res.status(400).json({ error: 'No design to iterate on' });
    }

    const html = await resolveIterateHtml(sessionId, currentHtml);
    const currentCss = (await tryReadFile(sessionId, 'style.css')) || '';
    const ctx = { ...generationContext(req), jobId: jobId ?? generationContext(req).jobId };
    const data = await runStage1Iterate({
      sessionId,
      html,
      currentCss,
      changeRequest,
      phase,
      targetId,
      ctx,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/session/:sessionId/stamp-target', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { anchorId, childPath, locator, newId } = req.body || {};

    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await assertSessionEditable(sessionId);

    const anchor = normalizeTargetId(anchorId);
    const pickId = normalizeTargetId(newId);
    const path = Array.isArray(childPath) ? childPath : null;
    const steps = Array.isArray(locator) ? locator : null;

    if (!anchor || !pickId || (!path?.length && !steps?.length)) {
      return res.status(400).json({ error: 'anchorId, locator, and newId are required' });
    }
    if (!/^tb-pick-[a-z0-9]{4,12}$/i.test(pickId)) {
      return res.status(400).json({ error: 'Invalid pick id' });
    }

    const html = await loadSessionHtmlForPick(sessionId);
    if (!html) return res.status(400).json({ error: 'No design HTML found' });

    const stamped = stampIdAtLocator(html, anchor, steps?.length ? steps : { childPath: path }, pickId);
    if (!stamped || !findElementBounds(stamped, pickId)) {
      return res.status(400).json({ error: 'Could not locate the picked element in saved HTML. Try picking again.' });
    }

    const css = (await tryReadFile(sessionId, 'style.css')) || '';
    if (db.isEnabled()) {
      await db.saveHtml(sessionId, stamped, css);
    } else {
      await writeFile(sessionId, 'index.html', stamped);
    }

    res.json({ ok: true, id: pickId, html: stamped });
  } catch (err) {
    next(err);
  }
});

router.post('/session/:sessionId/undo', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await assertSessionEditable(sessionId);

    const restored = await restorePreviousVersion(sessionId);
    await appendTraceEntry(sessionId, {
      type: 'undo',
      phase: restored.phase,
      status: 'success',
      version: restored.version,
    });

    res.json({
      ok: true,
      sessionId,
      version: restored.version,
      html: restored.html,
      css: restored.css,
      phase: restored.phase,
    });
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/session/:sessionId/approve', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const meta = JSON.parse(await readFile(sessionId, 'meta.json'));

    if (meta.stage === 'wireframe') {
      return res.status(400).json({
        error: 'Wireframe must be turned into a designed homepage before final approval',
        needsDesignHome: true,
      });
    }

    if (!(await fileExists(sessionId, 'index.html'))) {
      return res.status(400).json({ error: 'No design to approve' });
    }

    const html = await readFile(sessionId, 'index.html');
    const css = (await tryReadFile(sessionId, 'style.css')) || '';
    const responsiveCss = (await tryReadFile(sessionId, 'responsive.css')) || '';

    const currentRaw = await tryReadFile(sessionId, 'stage1/current.json');
    const version = currentRaw ? JSON.parse(currentRaw).version : 1;

    await writeFile(sessionId, 'stage1/approved.json', JSON.stringify({ version, approvedAt: new Date().toISOString() }, null, 2));

    if (db.isEnabled()) {
      await db.saveApprovedHtml(sessionId, html, css);
    } else {
      await writeFile(sessionId, 'stage1/approved/index.html', html);
      await writeFile(sessionId, 'stage1/approved/style.css', css);
    }
    if (responsiveCss) {
      await writeFile(sessionId, 'stage1/approved/responsive.css', responsiveCss);
    }

    meta.stage = 'design-approved';
    meta.locked = true;
    meta.updatedAt = new Date().toISOString();
    if (!meta.pages) meta.pages = { homepage: 'approved', items: [] };
    else meta.pages.homepage = 'approved';
    await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));

    res.json({ ok: true, sessionId, version });
  } catch (err) {
    next(err);
  }
});

// List available template types (for the mini-brief type picker).
router.get('/template-types', (req, res) => {
  res.json({ types: listTemplateTypes() });
});

// List the theme's templates (homepage + added templates).
router.get('/session/:sessionId/templates', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
    res.json({ sessionId, pages: meta.pages || { homepage: 'pending', items: [] } });
  } catch (err) {
    next(err);
  }
});

// Create + design a new template from a mini-brief.
router.post('/session/:sessionId/templates', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { label, type, cptSlug, miniBrief } = req.body || {};
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (!label?.trim()) return res.status(400).json({ error: 'A template label is required' });
    if (!isValidTemplateType(type)) return res.status(400).json({ error: 'A valid template type is required (page, single, cpt)' });
    if (type === 'cpt' && !cptSlug?.trim()) return res.status(400).json({ error: 'cptSlug is required for a custom post type template' });

    const key = type === 'cpt' ? pageToSectionId(cptSlug) : pageToSectionId(label);
    const intakeRaw = await tryReadFile(sessionId, 'intake.json');
    const intakeData = intakeRaw ? normalizeIntakeData(JSON.parse(intakeRaw)) : {};

    await patchTemplateItem(sessionId, key, {
      label: label.trim(),
      template: type,
      cptSlug: cptSlug?.trim() || null,
      miniBrief: miniBrief || {},
      status: 'designing',
    });

    const ctx = generationContext(req);
    const data = await generateTemplateDesign(sessionId, {
      key,
      label: label.trim(),
      type,
      cptSlug: cptSlug?.trim() || null,
      miniBrief: miniBrief || {},
      intakeData,
      ctx: { ...ctx, model: resolveModelOverride(ctx) },
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Get one template's current design.
router.get('/session/:sessionId/templates/:key', async (req, res, next) => {
  try {
    const { sessionId, key } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
    const item = (meta.pages?.items || []).find((i) => i.slug === key);
    if (!item) return res.status(404).json({ error: 'Template not found' });
    const tpl = await loadTemplate(sessionId, key);
    const reportRaw = await tryReadFile(sessionId, `${templateDir(key)}/slop-report.json`);
    res.json({
      sessionId,
      item,
      html: tpl?.html || null,
      css: tpl?.fullCss || null,
      responsiveCss: tpl?.responsiveCss || null,
      slopReport: reportRaw ? JSON.parse(reportRaw) : null,
    });
  } catch (err) {
    next(err);
  }
});

// Iterate a template design.
router.post('/session/:sessionId/templates/:key/iterate', async (req, res, next) => {
  try {
    const { sessionId, key } = req.params;
    const { changeRequest } = req.body || {};
    if (!changeRequest?.trim()) return res.status(400).json({ error: 'changeRequest is required' });
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const ctx = generationContext(req);
    const data = await iterateTemplateDesign(sessionId, {
      key,
      changeRequest,
      ctx: { ...ctx, model: resolveModelOverride(ctx) },
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Approve a template.
router.post('/session/:sessionId/templates/:key/approve', async (req, res, next) => {
  try {
    const { sessionId, key } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const tpl = await loadTemplate(sessionId, key);
    if (!tpl) return res.status(400).json({ error: 'No template design to approve' });

    const dir = templateDir(key);
    await writeFile(sessionId, `${dir}/approved/index.html`, tpl.html);
    await writeFile(sessionId, `${dir}/approved/style.css`, tpl.fullCss);
    await writeFile(sessionId, `${dir}/approved/additions.css`, tpl.additionsCss);
    if (tpl.responsiveCss) await writeFile(sessionId, `${dir}/approved/responsive.css`, tpl.responsiveCss);
    await writeFile(sessionId, `${dir}/approved.json`, JSON.stringify({ approvedAt: new Date().toISOString() }, null, 2));

    await patchTemplateItem(sessionId, key, { status: 'approved' });
    res.json({ ok: true, sessionId, key, status: 'approved' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
