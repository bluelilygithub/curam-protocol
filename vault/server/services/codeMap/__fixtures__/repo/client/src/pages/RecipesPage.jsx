import Common from '../components/Common';
import apiClient from '../utils/apiClient';
export default function RecipesPage() {
  apiClient('/api/recipes');
  apiClient('/api/recipes-tutor');
  apiClient('/api/mood/today');
  import('./recipes/lazyPanel');
  return <Common />;
}
