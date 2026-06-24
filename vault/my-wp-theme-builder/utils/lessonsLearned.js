const path = require('path');
const { readFile, writeFile, tryReadFile } = require('./filewriter');

const MEMORY_SERVICE_PATH = path.join(__dirname, '..', '..', 'server', 'services', 'MemoryService');

async function loadLessons(sessionId) {
  const raw = await tryReadFile(sessionId, 'stage1/lessons-learned.json');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function captureLesson(sessionId, { lesson, category = 'iteration', metadata = {} } = {}) {
  const text = String(lesson || '').trim();
  if (!text) return null;

  const entry = {
    id: null,
    lesson: text,
    category,
    metadata,
    at: new Date().toISOString(),
    syncedToVault: false,
  };

  const lessons = await loadLessons(sessionId);
  entry.id = lessons.length + 1;
  lessons.push(entry);
  await writeFile(sessionId, 'stage1/lessons-learned.json', JSON.stringify(lessons, null, 2));

  const userId = parseInt(process.env.THEME_BUILDER_VAULT_USER_ID || '', 10);
  if (Number.isInteger(userId) && userId > 0 && process.env.DATABASE_URL) {
    try {
      const MemoryService = require(MEMORY_SERVICE_PATH);
      const prefix = '[WP Theme Builder]';
      const content = text.startsWith(prefix) ? text : `${prefix} ${text}`;
      await MemoryService.capture({
        userId,
        content,
        metadata: {
          source: 'theme-builder',
          category,
          sessionId,
          ...metadata,
        },
      });
      entry.syncedToVault = true;
      lessons[lessons.length - 1] = entry;
      await writeFile(sessionId, 'stage1/lessons-learned.json', JSON.stringify(lessons, null, 2));
    } catch (err) {
      console.warn('[lessons] Vault Memory sync skipped:', err.message);
    }
  }

  return entry;
}

function lessonFromIteration({ changeRequest, phase, version, ok, error }) {
  const phaseLabel = phase === 'design' ? 'homepage design' : 'wireframe';
  if (ok) {
    return `When iterating ${phaseLabel} (v${version}), user asked: "${changeRequest}" — applied successfully.`;
  }
  return `When iterating ${phaseLabel}, user asked: "${changeRequest}" — failed (${error || 'unknown error'}).`;
}

function lessonFromTruncation({ phase }) {
  const phaseLabel = phase === 'design' ? 'homepage design' : 'wireframe';
  return `${phaseLabel} generation was truncated — keep CSS under 100 lines and always complete </body></html>.`;
}

module.exports = {
  loadLessons,
  captureLesson,
  lessonFromIteration,
  lessonFromTruncation,
};
