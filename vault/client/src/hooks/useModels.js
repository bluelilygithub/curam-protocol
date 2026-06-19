import { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';

export function useModels() {
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [branchEvalModel, setBranchEvalModel] = useState('');
  const [graphicsModel, setGraphicsModel] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [embeddingConfig, setEmbeddingConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [effectiveRes, settingsRes, embeddingRes] = await Promise.all([
        api.get('/api/settings/effective-models'),
        api.get('/api/settings'),
        api.get('/api/settings/embedding-config'),
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
      let resolvedEmbeddingModel = '';
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (settings.branch_eval_model) setBranchEvalModel(settings.branch_eval_model);
        if (settings.graphics_model) setGraphicsModel(settings.graphics_model);
        if (settings.embedding_model) resolvedEmbeddingModel = settings.embedding_model;
      }
      if (embeddingRes.ok) {
        const emb = await embeddingRes.json();
        setEmbeddingConfig(emb);
        if (!resolvedEmbeddingModel && emb.model) resolvedEmbeddingModel = emb.model;
      }
      if (resolvedEmbeddingModel) setEmbeddingModel(resolvedEmbeddingModel);
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

  const saveGraphicsModel = useCallback(async (modelId) => {
    setGraphicsModel(modelId);
    await api.post('/api/settings', { key: 'graphics_model', value: modelId });
  }, []);

  const saveEmbeddingModel = useCallback(async (modelId) => {
    setEmbeddingModel(modelId);
    await api.post('/api/settings', { key: 'embedding_model', value: modelId });
    const embRes = await api.get('/api/settings/embedding-config');
    if (embRes.ok) setEmbeddingConfig(await embRes.json());
  }, []);

  return {
    models,
    saveModels,
    defaultModel,
    saveDefaultModel,
    branchEvalModel,
    saveBranchEvalModel,
    graphicsModel,
    saveGraphicsModel,
    embeddingModel,
    saveEmbeddingModel,
    embeddingConfig,
    loading,
    reload: load,
  };
}
