const { readFile, writeFile, tryReadFile } = require('./filewriter');

async function loadTrace(sessionId) {
  const raw = await tryReadFile(sessionId, 'stage1/iteration-trace.json');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendTraceEntry(sessionId, entry) {
  const trace = await loadTrace(sessionId);
  const record = {
    id: trace.length + 1,
    at: new Date().toISOString(),
    ...entry,
  };
  trace.push(record);
  await writeFile(sessionId, 'stage1/iteration-trace.json', JSON.stringify(trace, null, 2));
  return record;
}

async function clearTrace(sessionId) {
  await writeFile(sessionId, 'stage1/iteration-trace.json', '[]');
}

module.exports = {
  loadTrace,
  appendTraceEntry,
  clearTrace,
};
