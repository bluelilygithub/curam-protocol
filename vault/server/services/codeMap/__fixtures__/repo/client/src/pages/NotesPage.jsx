import Common from '../components/Common';
import apiClient from '../utils/apiClient';
export default function NotesPage() { apiClient('/api/notes'); return <Common />; }
