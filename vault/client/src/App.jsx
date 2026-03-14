import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ThemeProvider from './providers/ThemeProvider';
import { IconProvider } from './providers/IconProvider';
import Layout from './components/Layout';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import MemoryPage from './pages/MemoryPage';
import PromptsPage from './pages/PromptsPage';
import UserGuidePage from './pages/UserGuidePage';
import PersonasPage from './pages/PersonasPage';
import ComparisonPage from './pages/ComparisonPage';
import DebatePage from './pages/DebatePage';
import AdminPage from './pages/AdminPage';
import ChatHistoryPage from './pages/ChatHistoryPage';
import TasksPage from './pages/TasksPage';
import GoalsPage from './pages/GoalsPage';
import NotesPage from './pages/NotesPage';
import ChainsPage from './pages/ChainsPage';
import SharedTaskPage from './pages/SharedTaskPage';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AuthGuard from './components/AuthGuard';
import SearchPalette from './components/SearchPalette';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';

function WildcardRedirect() {
  console.log('[App] wildcard route caught, redirecting to / — current path was:', window.location.pathname);
  return <Navigate to="/" replace />;
}

function App() {
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === '/') {
        e.preventDefault();
        setShowShortcuts(v => !v);
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('vault:toggle-sidebar'));
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('vault:new-chat'));
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <ThemeProvider>
      <IconProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SearchPalette />
          {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/register" element={<Navigate to="/login" replace />} />
            <Route path="/shared/task/:token" element={<SharedTaskPage />} />
            <Route element={<AuthGuard><Layout /></AuthGuard>}>
              <Route index element={<ProjectList />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/projects/:id/chat" element={<ChatPage />} />
              <Route path="/chat" element={<ChatPage general />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/prompts" element={<PromptsPage />} />
              <Route path="/guide" element={<UserGuidePage />} />
              <Route path="/personas" element={<PersonasPage />} />
              <Route path="/compare" element={<ComparisonPage />} />
              <Route path="/debate" element={<DebatePage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/history" element={<ChatHistoryPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/chains" element={<ChainsPage />} />
              <Route path="*" element={<WildcardRedirect />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </IconProvider>
    </ThemeProvider>
  );
}

export default App;
