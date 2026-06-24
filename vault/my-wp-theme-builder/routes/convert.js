const express = require('express');
const { suggestAcfFields } = require('../utils/suggestAcfFields');
const { writeFile, readFile, fileExists, tryReadFile } = require('../utils/filewriter');
const { buildThemeZip, streamThemeZip, getDownloadFilename, buildFileTree } = require('../utils/zip');
const { generateWordPressTheme, slugifyTheme } = require('../services/generateTheme');
const { createJobReporter, mapStage2Progress } = require('../utils/jobProgress');

const router = express.Router();

function generationContext(req) {
  return {
    userId: req.user?.id ?? req.body.userId ?? null,
    model: req.body.model ?? null,
    jobId: req.body.jobId ?? null,
  };
}

router.post('/suggest-fields', async (req, res, next) => {
  try {
    const { sessionId, approvedHtml } = req.body;
    const html = approvedHtml
      || (sessionId && (await fileExists(sessionId, 'index.html')) ? await tryReadFile(sessionId, 'index.html') : '');

    if (!html) {
      return res.status(400).json({ error: 'approvedHtml or sessionId with saved design is required' });
    }

    const suggestions = await suggestAcfFields(html, generationContext(req));

    if (sessionId && (await fileExists(sessionId, 'meta.json'))) {
      await writeFile(sessionId, 'stage2/field-suggestions.json', JSON.stringify(suggestions, null, 2));
    }

    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

router.post('/theme', async (req, res, next) => {
  try {
    const { sessionId, intakeData, wpData, approvedHtml } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!wpData || typeof wpData !== 'object') {
      return res.status(400).json({ error: 'wpData is required' });
    }
    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const html = approvedHtml
      || (await tryReadFile(sessionId, 'stage1/approved/index.html'))
      || (await tryReadFile(sessionId, 'index.html'))
      || '';

    if (!html) {
      return res.status(400).json({ error: 'approvedHtml is required' });
    }

    const approvedCss = (await tryReadFile(sessionId, 'stage1/approved/style.css'))
      || (await tryReadFile(sessionId, 'style.css'))
      || '';
    const approvedResponsiveCss = (await tryReadFile(sessionId, 'stage1/approved/responsive.css'))
      || (await tryReadFile(sessionId, 'responsive.css'))
      || '';

    if (intakeData) {
      await writeFile(sessionId, 'intake.json', JSON.stringify(intakeData, null, 2));
    }

    await writeFile(sessionId, 'wpData.json', JSON.stringify(wpData, null, 2));
    if (db.isEnabled()) {
      await db.saveApprovedHtml(sessionId, html, approvedCss);
    } else {
      await writeFile(sessionId, 'stage1/approved/index.html', html);
      if (approvedCss) await writeFile(sessionId, 'stage1/approved/style.css', approvedCss);
    }

    const intakeRaw = await tryReadFile(sessionId, 'intake.json');
    const storedIntake = intakeData || (intakeRaw ? JSON.parse(intakeRaw) : {});

    const ctx = generationContext(req);
    const progress = createJobReporter(ctx.jobId, 'stage2');

    try {
      progress.start('prepare', 'Saving WordPress brief');
      progress.complete('prepare');

      const result = await generateWordPressTheme({
        sessionId,
        intakeData: storedIntake,
        wpData,
        approvedHtml: html,
        approvedCss,
        approvedResponsiveCss,
        ctx,
        onProgress: (payload) => mapStage2Progress(ctx.jobId, payload),
      });

      progress.start('package', 'Building downloadable ZIP');
      await buildThemeZip(sessionId, result.themeSlug);
      progress.complete('package');
      progress.finish();

      if (db.isEnabled()) {
        await db.setThemeSlug(sessionId, result.themeSlug);
      }

      const meta = JSON.parse(await readFile(sessionId, 'meta.json'));
      meta.stage = 'conversion-complete';
      meta.themeSlug = result.themeSlug;
      meta.updatedAt = new Date().toISOString();
      await writeFile(sessionId, 'meta.json', JSON.stringify(meta, null, 2));

      const themeName = wpData?.setup?.themeName || wpData?.themeName || result.themeSlug;
      const downloadFilename = await getDownloadFilename(sessionId, result.themeSlug);
      const fileTree = buildFileTree(result.files, result.themeSlug);

      res.json({
        ok: true,
        sessionId,
        themeSlug: result.themeSlug,
        themeName,
        analysis: result.analysis,
        files: result.files,
        fileTree,
        downloadUrl: `/download/${sessionId}`,
        downloadFilename,
        storage: db.isEnabled() ? 'postgres' : 'filesystem',
      });
    } catch (err) {
      progress.fail(err);
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.post('/session/:sessionId/build', async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!(await fileExists(sessionId, 'stage2/analysis.json'))) {
      return res.status(400).json({ error: 'Run theme conversion before build' });
    }

    const metaRaw = await tryReadFile(sessionId, 'meta.json');
    const meta = metaRaw ? JSON.parse(metaRaw) : {};
    const themeSlug = meta.themeSlug || slugifyTheme(
      (await tryReadFile(sessionId, 'wpData.json'))
        ? JSON.parse(await readFile(sessionId, 'wpData.json'))?.setup?.themeName
        : 'my-theme'
    );

    const hasTheme = db.isEnabled()
      ? (await db.listThemeFiles(sessionId, `theme/${themeSlug}/`)).length > 0
      : await fileExists(sessionId, `theme/${themeSlug}/style.css`);

    if (!hasTheme) {
      return res.status(400).json({ error: 'Theme files not found — run POST /convert/theme first' });
    }

    res.json({ ok: true, sessionId, themeSlug });
  } catch (err) {
    next(err);
  }
});

router.get('/session/:sessionId/download', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const metaRaw = await tryReadFile(sessionId, 'meta.json');
    const themeSlug = req.query.themeSlug
      || (metaRaw ? JSON.parse(metaRaw).themeSlug : 'my-theme');

    if (!(await fileExists(sessionId, 'theme.zip'))) {
      await buildThemeZip(sessionId, themeSlug);
    }

    const filename = await getDownloadFilename(sessionId, themeSlug);
    await streamThemeZip(sessionId, res, filename);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
