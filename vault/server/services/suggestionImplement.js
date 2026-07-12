'use strict';

const { pool } = require('../db');

function slugify(text) {
  return String(text || 'rule')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'rule';
}

function parseResult(row) {
  if (!row?.implementationResult) return null;
  if (typeof row.implementationResult === 'object') return row.implementationResult;
  try {
    return JSON.parse(row.implementationResult);
  } catch {
    return null;
  }
}

function resolveNavigatePath(suggestion) {
  const hay = `${suggestion.context || ''} ${suggestion.body || ''} ${suggestion.source || ''}`;
  if (/\/memory\b|MemoryService|memory page/i.test(hay)) return '/memory';
  if (/newsDigest|News Digest|news-digest/i.test(hay)) return '/news-digest';
  if (/sharesCron|Shares:|\/shares\b/i.test(hay)) return '/shares';
  if (/Settings|\/settings\b|feature-access|GEMINI_API|embedding/i.test(hay)) return '/settings';
  if (/suggestions-inbox|\/suggestions\b/i.test(hay)) return '/suggestions';
  const routeMatch = hay.match(/(\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]*)?)/i);
  if (routeMatch && routeMatch[1].length <= 40) return routeMatch[1];
  return null;
}

function buildRuleNoteBody(suggestion) {
  const slug = slugify(suggestion.title);
  return `# Cursor rule draft — ${suggestion.title}

${suggestion.body}

---

## Next steps

1. Create \`.cursor/rules/${slug}.mdc\` in the repo (or add to an existing rule).
2. Paste/adapt the content above.
3. Delete or archive this note when the rule is merged.

**Source:** ${suggestion.source || 'unknown'} · Suggestion #${suggestion.id}
${suggestion.context ? `**Context:** ${suggestion.context}` : ''}
`;
}

function buildSkillNoteBody(suggestion) {
  return `# Agent skill draft — ${suggestion.title}

${suggestion.body}

---

## SKILL.md outline

\`\`\`markdown
# ${suggestion.title}

## When to use
Describe when an agent should read this skill.

## Instructions
${suggestion.body}

## Checklist
- [ ] Save as \`.cursor/skills/${slugify(suggestion.title)}/SKILL.md\`
- [ ] Test with a representative task
\`\`\`

**Source:** ${suggestion.source || 'unknown'} · Suggestion #${suggestion.id}
${suggestion.context ? `**Context:** ${suggestion.context}` : ''}
`;
}

async function createNote(userId, title, body) {
  const { rows } = await pool.query(
    `INSERT INTO notes (user_id, project_id, title, body)
     VALUES ($1, NULL, $2, $3)
     RETURNING id`,
    [userId, title.slice(0, 500), body],
  );
  return { type: 'note', noteId: rows[0].id, path: `/notes?note=${rows[0].id}` };
}

async function createTask(userId, { title, notes, category, priority, tags = [] }) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, notes, status, priority, category, "userId", "updatedAt")
     VALUES ($1, $2, 'todo', $3, $4, $5, NOW())
     RETURNING id`,
    [title.slice(0, 500), notes, priority || 'medium', category || 'suggestion', userId],
  );
  const taskId = rows[0].id;
  const allTags = ['suggestion', ...tags].filter(Boolean);
  for (const tag of allTags) {
    if (tag.trim()) {
      await pool.query('INSERT INTO task_tags ("taskId", tag) VALUES ($1, $2)', [taskId, tag.trim()]);
    }
  }
  return { type: 'task', taskId, path: '/tasks' };
}

async function runImplementation(suggestion, userId) {
  const { category, title, body, context, source, id } = suggestion;
  const footer = `\n\n---\nSuggestion #${id}${source ? ` · ${source}` : ''}${context ? `\nContext: ${context}` : ''}`;

  switch (category) {
    case 'rule':
      return createNote(userId, `Rule: ${title}`, buildRuleNoteBody(suggestion));

    case 'skill':
      return createNote(userId, `Skill: ${title}`, buildSkillNoteBody(suggestion));

    case 'automation':
      return createTask(userId, {
        title: `Automate: ${title}`,
        notes: `${body}${footer}`,
        category: 'automation',
        priority: 'high',
        tags: ['automation'],
      });

    case 'source':
      return createTask(userId, {
        title: title,
        notes: `${body}${context ? `\n\nLocation: ${context}` : ''}${footer}`,
        category: 'code',
        priority: 'medium',
        tags: ['source'],
      });

    case 'alert': {
      const navPath = resolveNavigatePath(suggestion);
      if (navPath) {
        return { type: 'navigate', path: navPath, message: `Open ${navPath} to address this alert.` };
      }
      return createTask(userId, {
        title: `Fix: ${title}`,
        notes: `${body}${footer}`,
        category: 'alert',
        priority: 'high',
        tags: ['alert'],
      });
    }

    default:
      return createTask(userId, {
        title: title,
        notes: `${body}${footer}`,
        category: 'suggestion',
        priority: 'medium',
      });
  }
}

/**
 * Create an artifact (task, note, or navigation target) and mark suggestion implemented.
 */
async function implementSuggestion(suggestionId, userId) {
  const { rows } = await pool.query(
    `SELECT id, category, status, title, body, context, source, "implementationResult"
     FROM agent_suggestions
     WHERE id = $1 AND "userId" = $2`,
    [suggestionId, userId],
  );
  if (!rows.length) return { error: 'not_found' };

  const suggestion = rows[0];
  const existing = parseResult(suggestion);
  if (suggestion.status === 'implement' && existing) {
    return { already: true, suggestion, result: existing };
  }

  const result = await runImplementation(suggestion, userId);

  const { rows: updated } = await pool.query(
    `UPDATE agent_suggestions
     SET status = 'implement',
         "implementationResult" = $1::jsonb,
         "updatedAt" = NOW()
     WHERE id = $2 AND "userId" = $3
     RETURNING id, category, status, title, body, context, source, "implementationResult", "createdAt", "updatedAt"`,
    [JSON.stringify(result), suggestionId, userId],
  );

  return { suggestion: updated[0], result, already: false };
}

module.exports = {
  implementSuggestion,
  parseResult,
};
