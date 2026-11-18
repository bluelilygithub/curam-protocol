import { lazy } from 'react';
import { APP_NAV_GROUPS } from './config/appNavigation';
import { DEFAULT_FEATURE_ACCESS } from './utils/featureAccess';
import NotesPage from './pages/NotesPage';
import TasksPage from './pages/TasksPage';
import ChatPage from './pages/ChatPage';
import GardenPage from './pages/GardenPage';
import RoutesPage from './pages/RoutesPage';
import MoodPage from './pages/MoodPage';
import ChangelogPage from './pages/ChangelogPage';
const RecipesPage = lazy(() => import('./pages/RecipesPage'));
const RecipeDetail = lazy(() => import('./pages/recipes'));

export default function App() {
  return (
    <Routes>
      <Route path="/notes" element={<NotesPage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/recipes" element={<FeatureRoute feature="recipes"><RecipesPage /></FeatureRoute>} />
      <Route path="/recipes/:id" element={<FeatureRoute feature="recipes"><RecipeDetail /></FeatureRoute>} />
      <Route path="/garden" element={<GardenPage />} />
      <Route path="/routes" element={<RoutesPage />} />
      <Route path="/mood" element={<MoodPage />} />
      <Route path="/changelog" element={<AdminRoute><ChangelogPage /></AdminRoute>} />
    </Routes>
  );
}
