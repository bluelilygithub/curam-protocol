// Fixed literal category values written by app-generated tasks (task.category
// is otherwise free text with no DB constraint — see docs/crm-deals-schema.md
// §5). Centralised here so the "Schedule follow-up" button, any task-list
// filter/badge, and future digest logic all agree on the exact string.
export const FOLLOW_UP_CATEGORY = 'follow-up';
