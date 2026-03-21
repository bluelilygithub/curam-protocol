import React, { useState, useEffect, useRef } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';

export default function TopicChat({ topicId }) {
  const [messages, setMessages]   = useState(null); // null = not yet loaded
  const [input, setInput]         = useState('');
  const [sending, setSending]     = useState(false);
  const [open, setOpen]           = useState(false);
  const [clearing, setClearing]   = useState(false);
  const bottomRef                 = useRef(null);
  const inputRef                  = useRef(null);
  const { addToast }              = useToastStore();

  // Load chat history when panel is first opened
  useEffect(() => {
    if (!open || messages !== null) return;
    api.get(`/api/news-digest/topics/${topicId}/chat`)
      .then(r => r.json())
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [open, topicId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when messages change
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);

    // Optimistic user message
    const optimistic = { id: Date.now(), role: 'user', content: text };
    setMessages(prev => [...(prev || []), optimistic]);

    try {
      const res  = await api.post(`/api/news-digest/topics/${topicId}/chat`, { message: text });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(prev => [...(prev || []), data.assistantMessage]);
    } catch (err) {
      addToast(err.message || 'Failed to send message', 'error');
      // Remove optimistic message on failure
      setMessages(prev => (prev || []).filter(m => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear all chat history for this topic?')) return;
    setClearing(true);
    try {
      await api.delete(`/api/news-digest/topics/${topicId}/chat`);
      setMessages([]);
      addToast('Chat cleared');
    } catch {
      addToast('Failed to clear chat', 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        style={{ background: 'var(--color-surface)' }}
      >
        <span className="text-base">💬</span>
        <span className="flex-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Ask about this topic
        </span>
        {messages && messages.length > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {messages.length}
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div style={{ background: 'var(--color-bg)' }}>
          {/* Message list */}
          <div
            className="px-4 py-3 space-y-3 overflow-y-auto"
            style={{ maxHeight: '320px', minHeight: '80px' }}
          >
            {messages === null && (
              <div className="text-center py-4">
                <div
                  className="inline-block w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)' }}
                />
              </div>
            )}

            {messages !== null && messages.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: 'var(--color-muted)' }}>
                Ask anything about this topic — the AI has access to the last 7 days of summaries.
              </p>
            )}

            {(messages || []).map((msg, i) => (
              <div
                key={msg.id || i}
                className={msg.role === 'user' ? 'ml-8' : 'mr-8'}
              >
                <div
                  className="px-3 py-2 rounded-xl text-sm"
                  style={{
                    background: msg.role === 'user'
                      ? 'var(--color-primary)' + '22'
                      : 'var(--color-surface)',
                    color: 'var(--color-text)',
                    borderLeft: msg.role === 'assistant'
                      ? '2px solid var(--color-border)'
                      : 'none',
                  }}
                >
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                    {msg.role === 'user' ? 'You' : 'AI'}
                  </p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                </div>
              </div>
            ))}

            {sending && (
              <div className="mr-8">
                <div
                  className="px-3 py-2 rounded-xl text-sm"
                  style={{ background: 'var(--color-surface)', borderLeft: '2px solid var(--color-border)' }}
                >
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>AI</p>
                  <span className="opacity-50 animate-pulse" style={{ color: 'var(--color-muted)' }}>
                    Thinking…
                  </span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input form */}
          <div className="px-4 pb-3 flex gap-2 items-end border-t" style={{ borderColor: 'var(--color-border)' }}>
            <form onSubmit={handleSend} className="flex-1 flex gap-2 pt-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
                }}
                placeholder="Ask about this topic… (Enter to send)"
                rows={1}
                disabled={sending}
                className="flex-1 px-3 py-2 rounded-lg border text-sm resize-none"
                style={{
                  background: 'var(--color-bg)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)',
                  fontFamily: 'inherit',
                  outline: 'none',
                  minHeight: '38px',
                }}
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white flex-shrink-0 disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                Send
              </button>
            </form>

            {messages && messages.length > 0 && (
              <button
                onClick={handleClear}
                disabled={clearing}
                className="text-xs pb-3 hover:opacity-70 flex-shrink-0 disabled:opacity-40"
                style={{ color: 'var(--color-muted)' }}
                title="Clear chat history"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
