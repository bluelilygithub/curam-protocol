import apiClient from '../utils/apiClient';
export default function ChatPage() { apiClient('/api/chat/send'); return null; }
