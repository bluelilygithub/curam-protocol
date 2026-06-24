'use strict';

const path = require('path');
const express = require('express');
const { initDb, isEnabled } = require('./utils/db');
const { runtimeConfig } = require('../server/config/runtime');
const { isOllamaAvailable } = require('../server/services/ollamaClient');
const { resolveStage1Model, resolveStage2Model } = require('./utils/modelCall');
const { describeThemeBuilderDesignModel } = require('./utils/themeBuilderModel');
const { isPlaywrightAvailable } = require('./utils/inspirationContext');

const intakeRouter = require('./routes/intake');
const generateRouter = require('./routes/generate');
const convertRouter = require('./routes/convert');
const previewRouter = require('./routes/preview');
const downloadRouter = require('./routes/download');
const jobsRouter = require('./routes/jobs');

const BUILD_ID = '2026-06-18-vault-preview-fix';

let app = null;
let initPromise = null;

function createThemeBuilderApp() {
  if (app) return app;

  app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/health', async (_req, res) => {
    const ollama = runtimeConfig.isLocal ? await isOllamaAvailable() : false;
    let stage1Model = null;
    let stage1Source = null;
    let stage2Model = null;
    try {
      const resolved = await describeThemeBuilderDesignModel({ userId: null, model: null });
      stage1Model = resolved.model;
      stage1Source = resolved.source;
      stage2Model = await resolveStage2Model({ userId: null, model: null });
    } catch (_) {}

    res.json({
      ok: true,
      buildId: BUILD_ID,
      previewFix: true,
      service: 'my-wp-theme-builder',
      storage: isEnabled() ? 'postgres' : 'filesystem',
      appEnv: runtimeConfig.appEnv,
      isLocal: runtimeConfig.isLocal,
      ollama,
      stage1Model,
      stage1Source,
      stage2Model,
      model: stage1Model,
      playwright: isPlaywrightAvailable(),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      geminiVision: Boolean(process.env.GEMINI_API_KEY),
      inspirationVision: Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY),
    });
  });

  app.use('/api/intake', intakeRouter);
  app.use('/api/generate', generateRouter);
  app.use('/generate', generateRouter);
  app.use('/preview', previewRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/download', downloadRouter);
  app.use('/api/convert', convertRouter);
  app.use('/convert', convertRouter);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      canRetryLocal: Boolean(err.canRetryLocal),
    });
  });

  return app;
}

async function initThemeBuilder() {
  if (!initPromise) {
    initPromise = (async () => {
      await initDb();
      if (isEnabled()) {
        console.log('[theme-builder] PostgreSQL storage enabled');
      } else {
        console.log('[theme-builder] Filesystem storage');
      }
      createThemeBuilderApp();
    })();
  }
  return initPromise;
}

module.exports = {
  createThemeBuilderApp,
  initThemeBuilder,
  BUILD_ID,
};
