import React, { useState, useEffect, useRef, useCallback } from 'react';
import MessageBubble from '../components/MessageBubble';
import { useChat } from '../hooks/useChat';
import { useModels } from '../hooks/useModels';
import useAuthStore from '../store/authStore';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const TEMPERATURES = [
  { label: 'Precise', value: 0.2 },
  { label: 'Balanced', value: 0.7 },
  { label: 'Creative', value: 1.0 },
];

export default function StudentCardsChatPage() {
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const getIcon = useIcon();
  const { models: MODELS, defaultModel } = useModels();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canSelectModel = isAdmin || featureAccess.memberModelSelection !== false;
  const canUseStudent = isAdmin || featureAccess.student !== false;

  const { messages, isStreaming, sessionId, sessionUsage, sendMessage, stopStreaming, clearMessages, streamError, clearStreamError } = useChat({
    projectId: null,
    studentCards: true,
  });

  const [input, setInput] = useState('');
  const [chatModel, setChatModel] = useState(null);
  const [temperature, setTemperature] = useState(0.7);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTempPicker, setShowTempPicker] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const effectiveModel = chatModel || defaultModel || MODELS[0]?.id;

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((data) => {
        if (data?.flags && typeof data.flags === 'object') {
          setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    await sendMessage(text, [], [], effectiveModel, [], temperature, null, false, [], false);
  }, [input, isStreaming, sendMessage, effectiveModel, temperature]);

  if (!canUseStudent) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12" style={{ background: 'var(--color-bg)' }}>
        <p className="text-sm text-center max-w-sm" style={{ color: 'var(--color-muted)' }}>
          Student (Cards) is turned off for member accounts in this workspace. Ask an admin to enable it under Settings → Feature Access.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--color-text)' }}>Cards</span>
        <span className="flex-1" />
        {canSelectModel && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowModelPicker((v) => !v); setShowTempPicker(false); }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
            >
              {(() => {
                const m = MODELS.find((x) => x.id === effectiveModel);
                return m ? `${m.emoji} ${m.name}` : effectiveModel;
              })()}
            </button>
            {showModelPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowModelPicker(false)} />
                <div
                  className="absolute right-0 top-full mt-1 w-52 rounded-xl border shadow-lg py-1.5 z-40 max-h-64 overflow-y-auto"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setChatModel(m.id); setShowModelPicker(false); }}
                      className="w-full text-left px-3 py-2 text-xs hover:opacity-70"
                      style={{ color: effectiveModel === m.id ? 'var(--color-primary)' : 'var(--color-text)' }}
                    >
                      {m.emoji} {m.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => { setShowTempPicker((v) => !v); setShowModelPicker(false); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
          >
            {getIcon('flame', { size: 12 })}
            {TEMPERATURES.find((t) => t.value === temperature)?.label || 'Balanced'}
          </button>
          {showTempPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowTempPicker(false)} />
              <div
                className="absolute right-0 top-full mt-1 w-40 rounded-xl border shadow-lg py-1 z-40"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                {TEMPERATURES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => { setTemperature(t.value); setShowTempPicker(false); }}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70"
                    style={{ color: temperature === t.value ? 'var(--color-primary)' : 'var(--color-text)' }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => { clearMessages(); clearStreamError(); }}
          className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          New session
        </button>
      </div>

      {messages.length === 0 && (
        <div
          className="flex-shrink-0 mx-4 mt-3 mb-2 px-4 py-3 rounded-xl border text-sm"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <p className="font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Step 1 — onboarding</p>
          <p>
            Your assistant will guide you one question at a time. When you are ready, type <strong>Start</strong> below (or reply with your own opening).
            Paste longer readings directly into the chat.
          </p>
        </div>
      )}

      {streamError && (
        <div className="flex-shrink-0 px-4 py-2 text-xs border-b flex items-center justify-between gap-2" style={{ background: '#fff1f2', borderColor: '#fca5a5', color: '#991b1b' }}>
          <span>{streamError.message}</span>
          <button type="button" onClick={clearStreamError} className="hover:opacity-70 font-bold">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-3xl mx-auto w-full">
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            messageIndex={i}
            isLatest={i === messages.length - 1 && msg.role === 'assistant'}
            searching={false}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex-shrink-0 border-t px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message your study assistant…"
            rows={1}
            className="flex-1 text-sm px-3 py-2 rounded-xl border outline-none resize-none min-h-[44px] max-h-[160px]"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white hover:opacity-90 transition-opacity"
              style={{ background: 'var(--color-primary)' }}
              title="Stop"
            >
              {getIcon('stop-circle', { size: 18, color: '#fff' })}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
              title="Send"
            >
              {getIcon('send', { size: 18, color: '#fff' })}
            </button>
          )}
        </div>
        {sessionUsage.inputTokens > 0 && (
          <p className="text-center text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
            Session: {(sessionUsage.inputTokens + sessionUsage.outputTokens).toLocaleString()} tokens
            {sessionId ? ` · ${sessionId.slice(-8)}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
