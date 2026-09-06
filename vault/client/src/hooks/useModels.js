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
  const [documentRedactionLocalModel, setDocumentRedactionLocalModel] = useState('');
  const [documentRedactionFrontierModel, setDocumentRedactionFrontierModel] = useState('');
  const [documentRedactionCard, setDocumentRedactionCard] = useState(null);
  const [translateModel, setTranslateModel] = useState('');
  const [translateReviewModel, setTranslateReviewModel] = useState('');
  const [translateAgentCard, setTranslateAgentCard] = useState(null);
  const [translateTargetLanguage, setTranslateTargetLanguage] = useState('fr');

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
        if (data.documentRedactionAgent) {
          setDocumentRedactionCard(data.documentRedactionAgent);
          setDocumentRedactionLocalModel(data.documentRedactionAgent.local?.modelId || '');
          setDocumentRedactionFrontierModel(data.documentRedactionAgent.frontier?.modelId || '');
        }
        if (data.translateAgent) {
          setTranslateAgentCard(data.translateAgent);
          setTranslateModel(data.translateAgent.translate?.modelId || '');
          setTranslateReviewModel(data.translateAgent.review?.modelId || '');
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
        if (settings.translate_model) setTranslateModel(settings.translate_model);
        if (settings.translate_review_model) setTranslateReviewModel(settings.translate_review_model);
        if (settings.translate_target_language) setTranslateTargetLanguage(settings.translate_target_language);
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
    const res = await api.post('/api/settings', { key: 'vault_models', value: JSON.stringify(newModels) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not save model inventory');
    }
    setModels(newModels);
    const effectiveRes = await api.get('/api/settings/effective-models');
    if (effectiveRes.ok) {
      const effective = await effectiveRes.json();
      if (effective.documentRedactionAgent) setDocumentRedactionCard(effective.documentRedactionAgent);
      if (effective.translateAgent) setTranslateAgentCard(effective.translateAgent);
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
      throw new Error(data.error || 'Could not save candidate redaction model');
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

  const saveTranslateModel = useCallback(async (modelId) => {
    const res = await api.post('/api/settings', { key: 'translate_model', value: modelId });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save translate model');
    setTranslateModel(modelId);
    return { ok: true };
  }, []);

  const saveTranslateReviewModel = useCallback(async (modelId) => {
    const res = await api.post('/api/settings', { key: 'translate_review_model', value: modelId });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save translate review model');
    setTranslateReviewModel(modelId);
    return { ok: true };
  }, []);

  const saveTranslateTargetLanguage = useCallback(async (lang) => {
    const res = await api.post('/api/settings', { key: 'translate_target_language', value: lang });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save translate target language');
    setTranslateTargetLanguage(lang);
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
    documentRedactionLocalModel,
    documentRedactionFrontierModel,
    documentRedactionCard,
    saveDocumentRedactionLocalModel,
    saveDocumentRedactionFrontierModel,
    translateModel,
    translateReviewModel,
    translateAgentCard,
    saveTranslateModel,
    saveTranslateReviewModel,
    translateTargetLanguage,
    saveTranslateTargetLanguage,
  };
}
