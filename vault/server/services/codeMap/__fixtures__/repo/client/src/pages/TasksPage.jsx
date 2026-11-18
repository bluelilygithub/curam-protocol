import apiClient from '../utils/apiClient';
export default function TasksPage() { apiClient('/api/tasks'); return null; }
