// The CRM guide's controls: what each Open button in the guide chat can reach. `where` says which page it lives on:
//   list     the CRM page (/clients)          detail   a client's page (/clients/:id), `section` is the key in its `sections` state
//   pipeline the Pipeline page (/pipeline)
// The ids must match CATALOG in server/services/crmTutor.js (npm run test:crm-tutor fails if they drift).

export const GUIDE_TOOLS = [
  { id: 'client-list', label: 'Client list', where: 'list' },
  { id: 'new-client', label: 'New client', where: 'list' },
  { id: 'client-info', label: 'Info', where: 'detail', section: 'info' },
  { id: 'outstanding', label: 'Outstanding', where: 'detail', section: 'outstanding' },
  { id: 'activity', label: 'Activity', where: 'detail', section: 'activity' },
  { id: 'deals', label: 'Deals', where: 'detail', section: 'deals' },
  { id: 'contacts', label: 'Contacts', where: 'detail', section: 'contacts' },
  { id: 'projects', label: 'Projects', where: 'detail', section: 'projects' },
  { id: 'tasks', label: 'Tasks', where: 'detail', section: 'tasks' },
  { id: 'pipeline', label: 'Pipeline', where: 'pipeline' },
];

export const byId = (id) => GUIDE_TOOLS.find((t) => t.id === id) || null;
