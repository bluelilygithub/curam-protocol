import React from 'react';
import api from '../../utils/apiClient';

const BUDGET_PRESETS = [0.10, 0.25, 0.50, 1.00, 5.00];

/**
 * Settings -> AI & Chat (admins): the chat-side settings only — session cost warnings,
 * token budget alerts and accepted upload types. Model management lives in ModelsView.
 */
export default function AiChatView({
  sessionBudget, setSessionBudget, customBudget, setCustomBudget,
  budgetAlertThreshold, setBudgetAlertThreshold,
  budgetCriticalThreshold, setBudgetCriticalThreshold,
  budgetReAlertFrequency, setBudgetReAlertFrequency,
  allowedFileTypes, setAllowedFileTypes,
  saveFileTypes, resetFileTypes, fileTypesSaved,
}) {
  return (
    <>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Session Budget
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Show a warning when a single chat session approaches or exceeds a cost limit.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => { setSessionBudget(null); setCustomBudget(''); }}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
            style={{
              background: sessionBudget === null ? 'var(--color-primary)' : 'var(--color-surface)',
              borderColor: sessionBudget === null ? 'var(--color-primary)' : 'var(--color-border)',
              color: sessionBudget === null ? '#fff' : 'var(--color-text)',
            }}
          >
            Off
          </button>
          {BUDGET_PRESETS.map(v => (
            <button
              key={v}
              onClick={() => { setSessionBudget(v); setCustomBudget(''); }}
              className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
              style={{
                background: sessionBudget === v ? 'var(--color-primary)' : 'var(--color-surface)',
                borderColor: sessionBudget === v ? 'var(--color-primary)' : 'var(--color-border)',
                color: sessionBudget === v ? '#fff' : 'var(--color-text)',
              }}
            >
              ${v.toFixed(2)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Custom ($)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="e.g. 2.50"
            value={customBudget}
            onChange={e => {
              setCustomBudget(e.target.value);
              const v = parseFloat(e.target.value);
              if (v > 0) setSessionBudget(v);
            }}
            className="w-28 px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{
              background: 'var(--color-surface)',
              borderColor: customBudget && !BUDGET_PRESETS.includes(sessionBudget) && sessionBudget !== null
                ? 'var(--color-primary)'
                : 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          {sessionBudget !== null && (
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Warn at ${(sessionBudget * (budgetAlertThreshold / 100)).toFixed(3)} ({budgetAlertThreshold}%) and ${(sessionBudget * (budgetCriticalThreshold / 100)).toFixed(3)} ({budgetCriticalThreshold}%)
            </span>
          )}
        </div>
      </section>

      {/* Token Budget Alert Controls */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Token Budget Alerts
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Control when and how often budget alerts appear in the chat interface.
        </p>

        <div className="space-y-4">
          {/* Initial alert threshold */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Initial alert threshold</p>
            <div className="flex flex-wrap gap-2">
              {[50, 60, 70, 80, 90].map(pct => (
                <button
                  key={pct}
                  onClick={() => { setBudgetAlertThreshold(pct); api.post('/api/settings', { key: 'budgetAlertThreshold', value: String(pct) }).catch(() => {}); }}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                  style={{
                    background: budgetAlertThreshold === pct ? 'var(--color-primary)' : 'var(--color-surface)',
                    borderColor: budgetAlertThreshold === pct ? 'var(--color-primary)' : 'var(--color-border)',
                    color: budgetAlertThreshold === pct ? '#fff' : 'var(--color-text)',
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Critical threshold */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Critical threshold</p>
            <div className="flex flex-wrap gap-2">
              {[90, 95, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => { setBudgetCriticalThreshold(pct); api.post('/api/settings', { key: 'budgetCriticalThreshold', value: String(pct) }).catch(() => {}); }}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
                  style={{
                    background: budgetCriticalThreshold === pct ? '#ef4444' : 'var(--color-surface)',
                    borderColor: budgetCriticalThreshold === pct ? '#ef4444' : 'var(--color-border)',
                    color: budgetCriticalThreshold === pct ? '#fff' : 'var(--color-text)',
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Re-alert frequency */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Re-alert frequency after dismissal</p>
            <div className="flex flex-col gap-1.5">
              {[
                { value: 'session', label: "Don't show again this session" },
                { value: 'every10', label: 'Every 10 messages' },
                { value: 'every20', label: 'Every 20 messages' },
                { value: 'at95', label: 'When I hit 95%' },
              ].map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="reAlertFreq"
                    value={opt.value}
                    checked={budgetReAlertFrequency === opt.value}
                    onChange={() => { setBudgetReAlertFrequency(opt.value); api.post('/api/settings', { key: 'budgetReAlertFrequency', value: opt.value }).catch(() => {}); }}
                    className="accent-current"
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Upload File Types */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>
          Upload File Types
        </h2>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Comma-separated list of accepted file extensions and MIME types for all file upload inputs.
        </p>
        <input
          type="text"
          value={allowedFileTypes}
          onChange={(e) => setAllowedFileTypes(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          placeholder=".pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={saveFileTypes}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Save
          </button>
          <button
            onClick={resetFileTypes}
            className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
          >
            Reset to defaults
          </button>
          {fileTypesSaved && (
            <span className="text-xs" style={{ color: 'var(--color-primary)' }}>Saved ✓</span>
          )}
        </div>
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
          Examples: <code>.pdf,.docx,.xlsx</code> or <code>image/*</code> or <code>.pdf,image/*,.txt</code>
        </p>
      </section>
    </>
  );
}
