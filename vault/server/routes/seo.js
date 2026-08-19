'use strict';

const express = require('express');
const {
  getSeoStatus,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  generateKeywordsForProject,
} = require('../services/seo/seoProjectService');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    res.json(await getSeoStatus(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects', async (req, res) => {
  try {
    res.json(await listProjects(req.user.id));
  } catch (err) {
    console.error('[seo/projects GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const project = await createProject(req.user.id, {
      url: req.body?.url,
      name: req.body?.name,
      notes: req.body?.notes,
    });
    res.status(201).json(project);
  } catch (err) {
    console.error('[seo/projects POST]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await getProject(req.user.id, Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(project);
  } catch (err) {
    console.error('[seo/projects/:id GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id', async (req, res) => {
  try {
    const project = await updateProject(req.user.id, Number(req.params.id), {
      name: req.body?.name,
      notes: req.body?.notes,
    });
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(project);
  } catch (err) {
    console.error('[seo/projects/:id PATCH]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    const ok = await deleteProject(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[seo/projects/:id DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/keywords', async (req, res) => {
  try {
    const project = await generateKeywordsForProject(req.user.id, Number(req.params.id));
    res.json(project);
  } catch (err) {
    console.error('[seo/projects/:id/keywords]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
