import { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';

export function useModels() {
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [branchEvalModel, setBranchEvalModel] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [effectiveRes, settingsRes] = await Promise.all([
        api.get('/api/settings/effective-models'),
        api.get('/api/settings'),
      ]);
      if (effectiveRes.ok) {
        const data = await effectiveRes.json();
        if (Array.isArray(data.models) && data.models.length > 0) {
          setModels(data.models);
        }
        if (data.defaultModel) {
          setDefaultModel(data.defaultModel);
        } else if (data.models?.[0]?.id) {
          setDefaultModel(data.models[0].id);
        }
      }
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (settings.branch_eval_model) setBranchEvalModel(settings.branch_eval_model);
      }
    } catch {
      /* keep empty — chat preflight will surface missing config */
    }
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

  const saveBranchEvalModel = useCallback(async (modelId) => {
    setBranchEvalModel(modelId);
    await api.post('/api/settings', { key: 'branch_eval_model', value: modelId });
  }, []);

  return { models, saveModels, defaultModel, saveDefaultModel, branchEvalModel, saveBranchEvalModel, loading, reload: load };
}
