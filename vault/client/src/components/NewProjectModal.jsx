import React, { useState, useEffect, useRef } from 'react';
import { MODELS, PROJECT_TYPES, TYPE_FIELDS, getModelById } from '../utils/models';

function buildDefaultTypeConfig(typeId) {
  const fields = TYPE_FIELDS[typeId];
  if (!fields) return {};
  return Object.fromEntries(fields.map(f => [f.key, f.default]));
}

function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState(null);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6');
  const [typeConfig, setTypeConfig] = useState({});
  const [creating, setCreating] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    setSelectedModel(type.model);
    setTypeConfig(buildDefaultTypeConfig(type.id));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        model: selectedModel,
        projectType: selectedType?.id || null,
        typeConfig: selectedType ? typeConfig : null,
      });
    } finally {
      setCreating(false);
    }
  };

  const recommendedModel = selectedType ? getModelById(selectedType.model) : null;
  const activeModel = getModelById(selectedModel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-xl rounded-2xl shadow-2xl"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>New Project</h2>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Choose a type so we can recommend the right AI model.
          </p>
        </div>

        <form onSubmit={handleCreate}>
          <div className="px-6 space-y-5 pb-5">

            {/* Project name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Project Name
              </label>
              <input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="My Project"
                required
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>

            {/* Project type tiles */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
                What type of project?
              </label>
              <div className="grid grid-cols-5 gap-2">
                {PROJECT_TYPES.map(type => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => handleTypeSelect(type)}
                    className="flex flex-col items-center gap-1 px-2 py-3 rounded-xl border text-center transition-all"
                    style={{
                      background: selectedType?.id === type.id ? 'var(--color-primary)' : 'var(--color-surface)',
                      borderColor: selectedType?.id === type.id ? 'var(--color-primary)' : 'var(--color-border)',
                      color: selectedType?.id === type.id ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    <span className="text-xl leading-none">{type.emoji}</span>
                    <span className="text-xs font-medium leading-tight">{type.label}</span>
                  </button>
                ))}
              </div>
              {selectedType && (
                <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
                  {selectedType.desc}
                </p>
              )}
            </div>

            {/* Type-specific behavior fields */}
            {selectedType && TYPE_FIELDS[selectedType.id] && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
                  Behaviour
                </label>
                <div className="space-y-3">
                  {TYPE_FIELDS[selectedType.id].map(field => (
                    <div key={field.key}>
                      <p className="text-xs mb-1.5" style={{ color: 'var(--color-text)', opacity: 0.7 }}>{field.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {field.options.map(opt => {
                          const active = typeConfig[field.key] === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              title={opt.desc || ''}
                              onClick={() => setTypeConfig(prev => ({ ...prev, [field.key]: opt.value }))}
                              className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                              style={{
                                background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                                borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                                color: active ? '#fff' : 'var(--color-text)',
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Model selector */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  AI Model
                </label>
                {recommendedModel && selectedModel === recommendedModel.id && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
                  >
                    Recommended
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {MODELS.map(model => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
                    className="flex flex-col gap-1 px-3 py-2.5 rounded-xl border text-left transition-all"
                    style={{
                      background: selectedModel === model.id ? model.color + '15' : 'var(--color-surface)',
                      borderColor: selectedModel === model.id ? model.color : 'var(--color-border)',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{model.emoji}</span>
                      <span className="text-xs font-semibold" style={{ color: selectedModel === model.id ? model.color : 'var(--color-text)' }}>
                        {model.label}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{model.tagline}</p>
                  </button>
                ))}
              </div>

              {selectedType && (
                <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  <span style={{ color: 'var(--color-primary)' }}>Why {activeModel.name}?</span>{' '}
                  {selectedType.model === selectedModel ? selectedType.reason : activeModel.desc}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-2 px-6 py-4 border-t"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="px-5 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NewProjectModal;
