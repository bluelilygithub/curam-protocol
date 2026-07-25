import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../utils/apiClient';
import { isValidModelExecution, modelsNeedingExecutionConfirm } from '../utils/models';

export function useModels() {
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [branchEvalModel, setBranchEvalModel] = useState('');
  const [graphicsModel, setGraphicsModel] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [embeddingConfig, setEmbeddingConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [executionNeedsConfirmation, setExecutionNeedsConfirmation] = useState([]);
  /** Sole source for document-redaction local slot — from getModelsByExecution('local'). */
  const [localExecutionModels, setLocalExecutionModels] = useState([]);
  const [documentRedactionLocalModel, setDocumentRedactionLocalModel] = useState('');
  const [documentRedactionFrontierModel, setDocumentRedactionFrontierModel] = useState('');
  const [documentRedactionCard, setDocumentRedactionCard] = useState(null);

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
        // Never invent local list client-side — only what the server returned from getModelsByExecution.
        setLocalExecutionModels(Array.isArray(data.localExecutionModels) ? data.localExecutionModels : []);
        if (data.documentRedactionAgent) {
          setDocumentRedactionCard(data.documentRedactionAgent);
          setDocumentRedactionLocalModel(data.documentRedactionAgent.local?.modelId || '');
          setDocumentRedactionFrontierModel(data.documentRedactionAgent.frontier?.modelId || '');
        }
        if (Array.isArray(data.executionNeedsConfirmation)) {
          setExecutionNeedsConfirmation(data.executionNeedsConfirmation);
        } else {
          setExecutionNeedsConfirmation(modelsNeedingExecutionConfirm(data.models || []));
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
        if (settings.document_redaction_local_model) {
          setDocumentRedactionLocalModel(settings.document_redaction_local_model);
        }
        if (settings.document_redaction_frontier_model) {
          setDocumentRedactionFrontierModel(settings.document_redaction_frontier_model);
        }
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

  const needsExecutionConfirm = useMemo(
    () => modelsNeedingExecutionConfirm(models),
    [models],
  );

  const saveModels = useCallback(async (newModels) => {
    const res = await api.post('/api/settings', { key: 'vault_models', value: JSON.stringify(newModels) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Could not save model inventory');
      err.needsConfirmation = data.needsConfirmation || [];
      err.invalid = data.invalid || [];
      throw err;
    }
    setModels(newModels);
    setExecutionNeedsConfirmation(modelsNeedingExecutionConfirm(newModels));
    // Refresh local-execution list from server after inventory change
    const effectiveRes = await api.get('/api/settings/effective-models');
    if (effectiveRes.ok) {
      const effective = await effectiveRes.json();
      setLocalExecutionModels(Array.isArray(effective.localExecutionModels) ? effective.localExecutionModels : []);
      if (effective.documentRedactionAgent) setDocumentRedactionCard(effective.documentRedactionAgent);
    }
    return { ok: true };
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

  const saveDocumentRedactionLocalModel = useCallback(async (modelId) => {
    const res = await api.post('/api/settings', {
      key: 'document_redaction_local_model',
      value: modelId,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Could not save local redaction model');
      err.localExecutionModelIds = data.localExecutionModelIds || [];
      throw err;
    }
    setDocumentRedactionLocalModel(modelId);
    return { ok: true };
  }, []);

  const saveDocumentRedactionFrontierModel = useCallback(async (modelId) => {
    const res = await api.post('/api/settings', {
      key: 'document_redaction_frontier_model',
      value: modelId,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not save frontier redaction model');
    }
    setDocumentRedactionFrontierModel(modelId);
    return { ok: true };
  }, []);

  return {
    models,
    setModels,
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
    needsExecutionConfirm,
    executionNeedsConfirmation,
    isValidModelExecution,
    localExecutionModels,
    documentRedactionLocalModel,
    documentRedactionFrontierModel,
    documentRedactionCard,
    saveDocumentRedactionLocalModel,
    saveDocumentRedactionFrontierModel,
  };
}
