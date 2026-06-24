'use strict';

const STAGE1_WIREFRAME_STEPS = [
  { id: 'save-brief', label: 'Saving your brief' },
  { id: 'research', label: 'Reviewing inspiration sites' },
  { id: 'analyse', label: 'Analysing your brief' },
  { id: 'generate', label: 'Building homepage wireframe' },
  { id: 'parse', label: 'Validating wireframe' },
  { id: 'save', label: 'Saving wireframe preview' },
];

const STAGE1_HOME_DESIGN_STEPS = [
  { id: 'analyse', label: 'Reading wireframe & brief' },
  { id: 'generate', label: 'Designing homepage' },
  { id: 'responsive', label: 'Building responsive.css' },
  { id: 'parse', label: 'Validating HTML & CSS' },
  { id: 'save', label: 'Saving design preview' },
];

const STAGE1_ITERATE_STEPS = [
  { id: 'read', label: 'Reading your current design' },
  { id: 'generate', label: 'Generating updated content' },
  { id: 'responsive', label: 'Building responsive.css' },
  { id: 'validate', label: 'Validating the new layout' },
  { id: 'save', label: 'Saving preview' },
];

const STAGE1_STEPS = STAGE1_WIREFRAME_STEPS;

const STAGE2_STEPS = [
  { id: 'prepare', label: 'Preparing theme data' },
  { id: 'analyse', label: 'Analysing HTML structure' },
  { id: 'style', label: 'Generating style.css' },
  { id: 'functions', label: 'Generating functions.php' },
  { id: 'shell', label: 'Generating header & footer' },
  { id: 'templates', label: 'Generating templates' },
  { id: 'acf', label: 'Generating ACF JSON' },
  { id: 'blocks', label: 'Generating block files' },
  { id: 'readme', label: 'Generating README' },
  { id: 'package', label: 'Packaging theme ZIP' },
];

const STAGE2_PROGRESS_MAP = {
  1: 'analyse',
  2: 'style',
  3: 'functions',
  4: 'shell',
  5: 'templates',
  6: 'acf',
  7: 'blocks',
  8: 'readme',
};

const jobs = new Map();
const cancelledJobs = new Set();
const TTL_MS = 60 * 60 * 1000;

function cloneSteps(steps) {
  return steps.map((step) => ({ ...step, status: 'pending' }));
}

function pruneJobs() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

function initJob(jobId, type) {
  if (!jobId) return null;

  const existing = jobs.get(jobId);
  if (existing) return existing;

  pruneJobs();
  const steps = type === 'stage2'
    ? STAGE2_STEPS
    : type === 'stage1-home'
      ? STAGE1_HOME_DESIGN_STEPS
      : type === 'stage1-iterate'
        ? STAGE1_ITERATE_STEPS
        : STAGE1_WIREFRAME_STEPS;
  const job = {
    jobId,
    type,
    status: 'running',
    steps: cloneSteps(steps),
    message: null,
    buildingItems: [],
    prompt: null,
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(jobId, job);
  return job;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function touch(job) {
  job.updatedAt = Date.now();
}

function setActiveStep(job, stepId, message) {
  if (!job) return;

  let foundActive = false;
  job.steps.forEach((step) => {
    if (step.id === stepId) {
      step.status = 'active';
      foundActive = true;
      return;
    }
    if (!foundActive && step.status === 'active') {
      step.status = 'done';
    }
    if (!foundActive && step.status === 'pending') {
      // leave pending until active
    }
  });

  if (!foundActive) {
    const target = job.steps.find((step) => step.id === stepId);
    if (target) target.status = 'active';
  }

  for (let i = 0; i < job.steps.length; i += 1) {
    const step = job.steps[i];
    if (step.id === stepId) break;
    if (step.status !== 'done') step.status = 'done';
  }

  if (message) job.message = message;
  job.status = 'running';
  touch(job);
}

function completeStep(job, stepId) {
  if (!job) return;
  const step = job.steps.find((item) => item.id === stepId);
  if (step) step.status = 'done';
  touch(job);
}

function completeJob(jobId) {
  const job = getJob(jobId);
  if (!job) return null;
  job.steps.forEach((step) => {
    if (step.status !== 'done') step.status = 'done';
  });
  job.status = 'complete';
  job.message = 'Complete';
  touch(job);
  return job;
}

function failJob(jobId, error) {
  const job = getJob(jobId);
  if (!job) return null;
  job.status = 'error';
  job.error = String(error?.message || error || 'Generation failed');
  touch(job);
  return job;
}

function cancelJob(jobId) {
  const job = getJob(jobId);
  if (!job) return null;
  cancelledJobs.add(jobId);
  job.status = 'cancelled';
  job.message = 'Cancelled';
  job.error = null;
  job.steps.forEach((step) => {
    if (step.status === 'active') step.status = 'pending';
  });
  touch(job);
  return job;
}

function isJobCancelled(jobId) {
  return Boolean(jobId && cancelledJobs.has(jobId));
}

function createJobReporter(jobId, type) {
  if (!jobId) {
  return {
    start() {},
    complete() {},
    updateMessage() {},
    addItem() {},
    setPrompt() {},
    fail() {},
    finish() {},
  };
  }

  const job = initJob(jobId, type);
  let lastStepId = null;

  return {
    start(stepId, message) {
      if (lastStepId && lastStepId !== stepId) {
        completeStep(job, lastStepId);
      }
      setActiveStep(job, stepId, message);
      lastStepId = stepId;
    },
    complete(stepId) {
      completeStep(job, stepId);
      if (lastStepId === stepId) lastStepId = null;
    },
    updateMessage(message) {
      if (!job || !message) return;
      job.message = message;
      touch(job);
    },
    addItem(label) {
      if (!job || !label) return;
      if (!job.buildingItems.includes(label)) {
        job.buildingItems.push(label);
      }
      job.message = /^generating/i.test(label) ? label : `Creating ${label}…`;
      touch(job);
    },
    setPrompt(prompt) {
      if (!job || !prompt) return;
      job.prompt = {
        model: prompt.model || null,
        recordedAt: prompt.recordedAt || new Date().toISOString(),
        system: prompt.system || '',
        user: prompt.user || '',
      };
      touch(job);
    },
    fail(error) {
      failJob(jobId, error);
    },
    finish() {
      if (lastStepId) completeStep(job, lastStepId);
      completeJob(jobId);
    },
  };
}

function mapStage2Progress(jobId, { step, detail }) {
  const stepId = STAGE2_PROGRESS_MAP[step];
  if (!stepId) return;
  const job = getJob(jobId);
  if (!job) return;
  setActiveStep(job, stepId, detail);
}

module.exports = {
  STAGE1_STEPS,
  STAGE1_WIREFRAME_STEPS,
  STAGE1_HOME_DESIGN_STEPS,
  STAGE1_ITERATE_STEPS,
  STAGE2_STEPS,
  createJobReporter,
  mapStage2Progress,
  getJob,
  initJob,
  completeJob,
  failJob,
  cancelJob,
  isJobCancelled,
};
