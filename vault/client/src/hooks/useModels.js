import { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';
import { MODELS as DEFAULT_MODELS } from '../utils/models';

export function useModels() {
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/settings');
      const data = await res.json();
      if (data.vault_models) {
        const parsed = JSON.parse(data.vault_models);
        if (Array.isArray(parsed) && parsed.length > 0) setModels(parsed);
      }
      if (data.default_model) setDefaultModel(data.default_model);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveModels = useCallback(async (newModels) => {
    setModels(newModels);
    await api.post('/api/settings', { key: 'vault_models', value: JSON.stringify(newModels) });
  }, []);

  const saveDefaultModel = useCallback(async (modelId) => {
    setDefaultModel(modelId);
    await api.post('/api/settings', { key: 'default_model', value: modelId });
  }, []);

  return { models, saveModels, defaultModel, saveDefaultModel, loading, reload: load };
}
