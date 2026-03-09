import { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';
import { MODELS as DEFAULT_MODELS } from '../utils/models';

export function useModels() {
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/settings');
      const data = await res.json();
      if (data.vault_models) {
        const parsed = JSON.parse(data.vault_models);
        if (Array.isArray(parsed) && parsed.length > 0) setModels(parsed);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveModels = useCallback(async (newModels) => {
    setModels(newModels);
    await api.post('/api/settings', { key: 'vault_models', value: JSON.stringify(newModels) });
  }, []);

  return { models, saveModels, loading, reload: load };
}
