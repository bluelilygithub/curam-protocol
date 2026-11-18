import { Map } from 'lucide-react';
import MapView from '../components/MapView';
import apiClient from '../utils/apiClient';
export default function RoutesPage() { apiClient('/api/route-tracks'); return <MapView><Map /></MapView>; }
