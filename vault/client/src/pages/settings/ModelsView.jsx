import React from 'react';
import { formatModelSelectLabel } from '../../utils/models';
import SkillScanModelCard from '../skillScan/SkillScanModelCard';

/**
 * Settings -> Models (admins): the model inventory, the default and each tool's model slot.
 * Every value is passed down from SettingsPage: useModels() stays there because Chat,
 * Document Redaction, Presentations, Student Cards and other Settings tabs share it.
 */
export default function ModelsView({
  user,
  models, resetModels, openAdd, openEdit, deleteModel,
  modelInventoryError, modelInventoryDirty, modelInventorySaving, saveInventoryAfterConfirm,
  editingModel, modelFormCardRef, modelForm, setModelForm, modelIdInputRef, saveModel, cancelEdit,
  defaultModel, saveDefaultModel, defaultModelError, setDefaultModelError,
  branchEvalModel, saveBranchEvalModel, branchEvalModelError, setBranchEvalModelError,
  documentRedactionLocalModel, documentRedactionFrontierModel,
  saveDocumentRedactionLocalModel, saveDocumentRedactionFrontierModel,
  docRedactionSlotError, setDocRedactionSlotError,
  contractReviewModel, saveContractReviewModel, contractReviewModelError, setContractReviewModelError,
  embeddingConfig, embeddingModel, saveEmbeddingModel, embeddingModelError, setEmbeddingModelError,
  graphicsModel, saveGraphicsModel, graphicsModelOptions, graphicsModelChoices,
  graphicsModelError, setGraphicsModelError,
  textModelChoices, modelStatus, modelProviderStatusKey, modelProviderKeyHint,
  testResults, setTestResults, testModel,
}) {
  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
            AI Models
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={resetModels}
              className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
              title="Reload saved inventory from the server"
            >
              Reload inventory
            </button>
            <button
              onClick={openAdd}
              className="text-xs px-2 py-1 rounded-lg text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              + Add model
            </button>
          </div>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Manage your model inventory, then assign models on the agent cards below. Dropdowns only list models you have configured.
        </p>

        {(modelInventoryError || modelInventoryDirty) && (
          <div
            className="mb-4 p-4 rounded-xl border space-y-3"
            style={{ background: '#FFFBEB', borderColor: '#F59E0B' }}
          >
            {modelInventoryError && (
              <p className="text-xs" style={{ color: '#b45309' }}>{modelInventoryError}</p>
            )}
            {modelInventoryDirty && !modelInventoryError && (
              <p className="text-xs" style={{ color: '#92400e' }}>
                Inventory updated locally — Save inventory to persist.
              </p>
            )}
            <button
              type="button"
              onClick={saveInventoryAfterConfirm}
              disabled={modelInventorySaving || !modelInventoryDirty}
              className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
              title="Save model inventory"
            >
              {modelInventorySaving ? 'Saving…' : 'Save inventory'}
            </button>
          </div>
        )}

        {/* Add / Edit form — placed near "+ Add model" so it scrolls into focus immediately */}
        {editingModel && (
          <div
            ref={modelFormCardRef}
            className="rounded-xl border p-4 mb-4 space-y-3"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-primary)' }}
          >
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              {editingModel === 'new' ? 'Add model' : 'Edit model'}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Provider</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  value={modelForm.provider}
                  onChange={(e) => setModelForm((f) => ({ ...f, provider: e.target.value }))}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="ollama">Ollama local</option>
                  <option value="fal">FAL</option>
                  <option value="serper">Serper (Google Shopping)</option>
                  <option value="serpapi">SerpAPI (Google Shopping)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Model API ID *</label>
                <input
                  ref={modelIdInputRef}
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none font-mono"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="Exact provider model id"
                  value={modelForm.id}
                  onChange={e => setModelForm(f => ({ ...f, id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Display name *</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="Display name"
                  value={modelForm.name}
                  onChange={e => setModelForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Label</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Economy"
                  value={modelForm.label}
                  onChange={e => setModelForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Emoji</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="⚡"
                  value={modelForm.emoji}
                  onChange={e => setModelForm(f => ({ ...f, emoji: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Tagline</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="e.g. Fast & affordable"
                  value={modelForm.tagline}
                  onChange={e => setModelForm(f => ({ ...f, tagline: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Description</label>
              <input
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                placeholder="e.g. Best for quick tasks, drafts, and simple Q&A"
                value={modelForm.desc}
                onChange={e => setModelForm(f => ({ ...f, desc: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveModel}
                disabled={!modelForm.id.trim() || !modelForm.name.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {editingModel === 'new' ? 'Add' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Default model selector */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Default model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Used for general chat and as the default for new workspaces when you can pick a model. Clearing the selection removes the explicit default so the first entry in your configured model list is used (same rules as the server model resolver).
          </p>
          <select
            value={defaultModel}
            onChange={async (e) => {
              setDefaultModelError('');
              try { await saveDefaultModel(e.target.value); }
              catch (err) { setDefaultModelError(err.message || 'Could not save default model'); }
            }}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">No default selected</option>
            {textModelChoices.map(m => (
              <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
            ))}
          </select>
          {defaultModelError && (
            <p className="text-xs mt-2" style={{ color: '#b45309' }}>{defaultModelError}</p>
          )}
        </div>

        {/* Branch evaluation model selector */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Branch evaluation model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Used to evaluate whether a response warrants branch suggestions. Set to a capable model — flash/economy models will not trigger branches.
          </p>
          <select
            value={branchEvalModel}
            onChange={async (e) => {
              setBranchEvalModelError('');
              try { await saveBranchEvalModel(e.target.value); }
              catch (err) { setBranchEvalModelError(err.message || 'Could not save branch evaluation model'); }
            }}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">Use current chat model</option>
            {textModelChoices.map(m => (
              <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
            ))}
          </select>
          {branchEvalModelError && (
            <p className="text-xs mt-2" style={{ color: '#b45309' }}>{branchEvalModelError}</p>
          )}
        </div>

        {/* Document redaction agent — two model slots */}
        <div className="mb-4 p-4 rounded-xl border space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              Document redaction agent
            </label>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Pick any models from your inventory. <strong style={{ color: 'var(--color-text)' }}>Candidate / apply</strong> runs extract,
              resuggest, coherence, and Realistic synthetics — DeepSeek (or any connected model) is fine here and explains long waits if Fast extract is off.
              <strong style={{ color: 'var(--color-text)' }}> Residual-risk / frontier</strong> only sees the sanitized PDF after local apply.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Candidate / apply model
            </label>
            <select
              value={documentRedactionLocalModel}
              onChange={async (e) => {
                setDocRedactionSlotError('');
                try {
                  await saveDocumentRedactionLocalModel(e.target.value);
                } catch (err) {
                  setDocRedactionSlotError(err.message || 'Could not save model');
                }
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Select model…</option>
              {textModelChoices.map((m) => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Residual-risk / frontier model
            </label>
            <select
              value={documentRedactionFrontierModel}
              onChange={async (e) => {
                setDocRedactionSlotError('');
                try {
                  await saveDocumentRedactionFrontierModel(e.target.value);
                } catch (err) {
                  setDocRedactionSlotError(err.message || 'Could not save model');
                }
              }}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Select model…</option>
              {textModelChoices.map((m) => (
                <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
              ))}
            </select>
          </div>

          {docRedactionSlotError && (
            <p className="text-xs" style={{ color: '#b45309' }}>{docRedactionSlotError}</p>
          )}
        </div>

        {/* Contract Review agent — same own-setting -> admin-fallback -> vault default
            pattern as Document Redaction above, collapsed to one slot since the whole
            pipeline (type detection through summary) uses one model. */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Contract Review model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Used for every stage of the Contract Review pipeline (type detection, parties, definitions, clause classification, risk scoring, obligations, summary). Leave blank to use Vault's standard-tier default.
          </p>
          <select
            value={contractReviewModel}
            onChange={async (e) => {
              setContractReviewModelError('');
              try { await saveContractReviewModel(e.target.value); }
              catch (err) { setContractReviewModelError(err.message || 'Could not save Contract Review model'); }
            }}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">Use vault default / standard tier</option>
            {textModelChoices.map((m) => (
              <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
            ))}
          </select>
          {contractReviewModelError && (
            <p className="text-xs mt-2" style={{ color: '#b45309' }}>{contractReviewModelError}</p>
          )}
        </div>

        {/* Embedding model — memory + file RAG */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Embedding model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Powers semantic memory, file RAG, and related-chat recall. Local Mac testing uses Ollama automatically; production uses Gemini from this setting.
          </p>
          {embeddingConfig?.provider === 'ollama' ? (
            <div className="text-sm space-y-1" style={{ color: 'var(--color-text)' }}>
              <p>
                <strong>Local:</strong> Ollama <code>{embeddingConfig.model}</code>
                {embeddingConfig.available ? ' — connected' : ' — not running'}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Run <code>ollama pull {embeddingConfig.model}</code> if needed. Requires pgvector on Postgres for storage.
              </p>
            </div>
          ) : (
            <>
              <select
                value={embeddingModel || embeddingConfig?.model || 'embedding-001'}
                onChange={async (e) => {
                  setEmbeddingModelError('');
                  try { await saveEmbeddingModel(e.target.value); }
                  catch (err) { setEmbeddingModelError(err.message || 'Could not save embedding model'); }
                }}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {(embeddingConfig?.options || [{ id: 'embedding-001', label: 'Gemini embedding-001' }]).map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              {embeddingModelError && (
                <p className="text-xs mt-2" style={{ color: '#b45309' }}>{embeddingModelError}</p>
              )}
              <p className="text-xs mt-2" style={{ color: embeddingConfig?.available ? 'var(--color-muted)' : '#b45309' }}>
                {embeddingConfig?.available
                  ? `Production: ${embeddingConfig.hint}`
                  : (embeddingConfig?.hint || 'GEMINI_API_KEY required on Railway')}
              </p>
            </>
          )}
        </div>

        {/* Graphics model selector */}
        <div className="mb-4 p-4 rounded-xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
            Graphics model
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
            Used by the Graphics agent in production. Local development uses `LOCAL_IMAGE_MODEL` from the environment for ComfyUI.
          </p>
          <select
            value={graphicsModel}
            onChange={async (e) => {
              setGraphicsModelError('');
              try { await saveGraphicsModel(e.target.value); }
              catch (err) { setGraphicsModelError(err.message || 'Could not save graphics model'); }
            }}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none font-mono"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">No graphics model selected</option>
            {graphicsModelOptions.map(m => (
              <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
            ))}
          </select>
          {graphicsModelError && (
            <p className="text-xs mt-2" style={{ color: '#b45309' }}>{graphicsModelError}</p>
          )}
          <p className="text-[11px] mt-2" style={{ color: 'var(--color-muted)' }}>
            This dropdown lists models configured below with provider `fal`. Leave blank to use the server fallback.
          </p>
          {graphicsModelChoices.length === 0 && (
            <p className="text-[11px] mt-2" style={{ color: '#b45309' }}>
              No FAL models are configured yet. Add one below and choose `FAL` as the provider.
            </p>
          )}
        </div>

        {/* Model list */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {models.map((m, i) => {
            const configured = modelStatus ? modelStatus[modelProviderStatusKey(m.provider)] : null;
            return (
              <div
                key={m.id}
                className="flex flex-col px-4 py-3"
                style={{
                  background: 'var(--color-surface)',
                  borderBottom: i < models.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl flex-shrink-0">{m.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{m.name}</span>
                      {m.label && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>{m.label}</span>}
                    </div>
                    <div className="text-xs font-mono mt-0.5 truncate" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>{m.id}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {configured === true && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>✓ Key set</span>
                    )}
                    {configured === false && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" title={modelProviderKeyHint(m.provider)} style={{ background: '#fef3c7', color: '#b45309' }}>⚠️ Key missing</span>
                    )}
                    <button
                      onClick={() => testModel(m.id)}
                      disabled={testResults[m.id]?.status === 'testing'}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70 disabled:opacity-50"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      {testResults[m.id]?.status === 'testing' ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      onClick={() => openEdit(m)}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteModel(m.id)}
                      className="text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70"
                      style={{ borderColor: '#fca5a5', color: '#991b1b' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {testResults[m.id] && testResults[m.id].status !== 'testing' && (
                  <div
                    className="mt-2 px-3 py-2 rounded-lg text-xs flex items-start gap-2"
                    style={{
                      background: testResults[m.id].status === 'ok' ? '#f0fdf4' : '#fff1f2',
                      color: testResults[m.id].status === 'ok' ? '#16a34a' : '#991b1b',
                    }}
                  >
                    <span className="flex-shrink-0">{testResults[m.id].status === 'ok' ? '✓' : '✗'}</span>
                    <span className="flex-1">{testResults[m.id].message}{testResults[m.id].hint ? ` — ${testResults[m.id].hint}` : ''}</span>
                    <button onClick={() => setTestResults(r => { const n = { ...r }; delete n[m.id]; return n; })} className="flex-shrink-0 opacity-50 hover:opacity-100">✕</button>
                  </div>
                )}
              </div>
            );
          })}
          {models.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--color-muted)' }}>
              No models configured. Add one above.
            </div>
          )}
        </div>
      </section>
      {/* Skill Scanner is admin-only, so its model choice is too */}
      {user?.isAdmin && <SkillScanModelCard choices={textModelChoices} defaultModel={defaultModel} />}
    </>
  );
}
