const express = require('express');
const { writeFile, readFile, fileExists, tryReadFile } = require('../utils/filewriter');
const { loadWebsiteSummary, defaultDisplayName, initPagesFromIntake } = require('../utils/projects');
const {
  listGroupedProjects,
  createProject,
  addWebsite,
  patchProject,
  deleteProject,
  deleteWebsite,
  touchProjectFromWebsite,
} = require('../utils/projectRegistry');
const db = require('../utils/db');

const router = express.Router();

router.get('/projects', async (_req, res, next) => {
  try {
    const data = await listGroupedProjects();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/projects', async (req, res, next) => {
  try {
    const displayName = String(req.body?.displayName || '').trim();
    const websiteLabel = String(req.body?.websiteLabel || '').trim();
    const result = await createProject(displayName, { websiteLabel });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/projects/:projectId', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const project = await patchProject(projectId, {
      displayName: req.body?.displayName,
      status: req.body?.status,
    });
    res.json({ ok: true, project });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.delete('/projects/:projectId', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const result = await deleteProject(projectId);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.post('/projects/:projectId/websites', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const websiteLabel = String(req.body?.websiteLabel || req.body?.displayName || '').trim();
    const result = await addWebsite(projectId, websiteLabel);
    res.status(201).json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

/** @deprecated use GET /projects */
router.get('/sessions', async (_req, res, next) => {
  try {
    const data = await listGroupedProjects();
    const flat = data.projects.flatMap((p) => p.websites.map((w) => ({
      ...w,
      projectName: p.displayName,
      projectId: p.projectId,
    })));
    const active = flat.filter((w) => w.status !== 'completed');
    const completed = flat.filter((w) => w.status === 'completed');
    res.json({ projects: flat, active, completed, grouped: data });
  } catch (err) {
    next(err);
  }
});

/** @deprecated use POST /projects */
router.post('/session', async (req, res, next) => {
  try {
    const displayName = String(req.body?.displayName || '').trim();
    const result = await createProject(displayName);
    res.status(201).json({
      sessionId: result.sessionId,
      projectId: result.project.projectId,
      meta: result.meta,
      project: result.project,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Website not found' });
    }

    const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
    if (req.body?.displayName != null || req.body?.websiteLabel != null) {
      const label = String(req.body.websiteLabel ?? req.body.displayName ?? '').trim();
      if (label) {
        meta.websiteLabel = label;
        meta.displayName = label;
      }
    }
    if (req.body?.status === 'active' || req.body?.status === 'completed') {
      meta.status = req.body.status;
    }
    meta.updatedAt = new Date().toISOString();
    await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));
    await touchProjectFromWebsite(sessionId);

    const summary = await loadWebsiteSummary(sessionId);
    res.json({ ok: true, sessionId, meta, website: summary });
  } catch (err) {
    next(err);
  }
});

router.delete('/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const result = await deleteWebsite(sessionId);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.get('/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Website not found' });
    }

    const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
    const intakeRaw = await tryReadFile(sessionId, 'intake.json');
    const intakeData = intakeRaw ? JSON.parse(intakeRaw) : null;
    const wpRaw = await tryReadFile(sessionId, 'wpData.json');
    const wpData = wpRaw ? JSON.parse(wpRaw) : null;

    if (!meta.websiteLabel && !meta.displayName && intakeData) {
      meta.displayName = defaultDisplayName(intakeData, sessionId);
      meta.websiteLabel = meta.displayName;
    }

    const hasDesign = await fileExists(sessionId, 'index.html');
    const hasApproved = await fileExists(sessionId, 'stage1/approved/index.html')
      || Boolean(db.isEnabled() && (await db.getSessionRow(sessionId))?.approved_html);
    const hasThemeZip = await fileExists(sessionId, 'theme.zip');
    const currentRaw = await tryReadFile(sessionId, 'stage1/current.json');
    const currentVersion = currentRaw ? JSON.parse(currentRaw).version : null;

    res.json({
      sessionId,
      meta,
      intakeData,
      wpData,
      resume: {
        stage: meta.stage,
        hasDesign,
        hasApproved,
        hasThemeZip,
        themeSlug: meta.themeSlug || null,
        locked: Boolean(meta.locked),
        currentVersion,
        canUndo: Number(currentVersion) > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const intakeData = req.body;

    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Website not found' });
    }

    await writeFile(sessionId, 'intake.json', JSON.stringify(intakeData, null, 2));

    const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
    meta.stage = 'intake-complete';
    meta.updatedAt = new Date().toISOString();
    if (!meta.websiteLabel && !meta.displayName) {
      meta.displayName = defaultDisplayName(intakeData, sessionId);
      meta.websiteLabel = meta.displayName;
    }
    if (!meta.pages?.items?.length) {
      meta.pages = initPagesFromIntake(intakeData);
    }
    await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));
    await touchProjectFromWebsite(sessionId);

    res.json({ ok: true, sessionId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
