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
import MobileDashboard from './pages/MobileDashboard';
import ChatHistoryPage from './pages/ChatHistoryPage';
import TasksPage from './pages/TasksPage';
import GoalsPage from './pages/GoalsPage';
import NotesPage from './pages/NotesPage';
import ChainsPage from './pages/ChainsPage';
import GraphPage from './pages/GraphPage';
import FinancePage from './pages/FinancePage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import UsagePage from './pages/UsagePage';
import MoodPage from './pages/MoodPage';
import SharedTaskPage from './pages/SharedTaskPage';
import NewsDigestPage from './pages/NewsDigestPage';
import StudentAgentPage from './pages/StudentAgentPage';
import StudentCardsChatPage from './pages/StudentCardsChatPage';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AuthGuard from './components/AuthGuard';
import SearchPalette from './components/SearchPalette';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import useAuthStore from './store/authStore';

function HomeRoute() {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  return isMobile ? <Navigate to="/mobile-dashboard" replace /> : <ProjectList />;
}

function AdminRoute() {
  const { user } = useAuthStore();
  return user?.isAdmin ? <AdminPage /> : <Navigate to="/" replace />;
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
              <Route index element={<HomeRoute />} />
              <Route path="/mobile-dashboard" element={<MobileDashboard />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/projects/:id/chat" element={<ChatPage />} />
              <Route path="/chat" element={<ChatPage general />} />
              <Route path="/student/quiz" element={<StudentAgentPage />} />
              <Route path="/student/cards" element={<StudentCardsChatPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/prompts" element={<PromptsPage />} />
              <Route path="/guide" element={<UserGuidePage />} />
              <Route path="/personas" element={<PersonasPage />} />
              <Route path="/compare" element={<ComparisonPage />} />
              <Route path="/debate" element={<DebatePage />} />
              <Route path="/admin" element={<AdminRoute />} />
              <Route path="/history" element={<ChatHistoryPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/chains" element={<ChainsPage />} />
              <Route path="/graph"    element={<GraphPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:id" element={<ClientDetailPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/mood" element={<MoodPage />} />
              <Route path="/news-digest" element={<NewsDigestPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </IconProvider>
    </ThemeProvider>
  );
}

export default App;
