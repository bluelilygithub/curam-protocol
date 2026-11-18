import Common from '../components/Common';
import MapView from '../components/MapView';
import apiClient from '../utils/apiClient';
export default function GardenPage() {
  apiClient('/api/garden');
  apiClient('/api/garden-tutor');
  apiClient('/api/geocode?q=x');
  return <div className="fixed inset-0"><Common /><MapView /></div>;
}
