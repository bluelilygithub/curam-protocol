import { useState, useCallback, useRef } from 'react';

export function useChat({ projectId }) {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [sessionUsage, setSessionUsage] = useState({ inputTokens: 0, outputTokens: 0, model: null });
  const abortRef = useRef(null);

  const sendMessage = useCallback(async (
    userContent,
    attachmentIds = [],
    attachmentMeta = [],
    model = null,
    urlAttachments = [],
    temperature = 0.7,
    personaId = null,
    reasoning = false,
  ) => {
    const newMessages = [...messages, { role: 'user', content: userContent, attachments: attachmentMeta, urlAttachments }];
    setMessages(newMessages);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '', thinking: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          projectId: projectId || undefined,
          sessionId: sessionId || undefined,
          attachmentIds: attachmentIds.length ? attachmentIds : undefined,
          urlAttachments: urlAttachments.length ? urlAttachments : undefined,
          model: model || undefined,
          temperature,
          personaId: personaId || undefined,
          reasoning: reasoning || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.sessionId && !sessionId) setSessionId(parsed.sessionId);
            if (parsed.usage) {
              setSessionUsage(u => ({
                inputTokens: u.inputTokens + (parsed.usage.inputTokens || 0),
                outputTokens: u.outputTokens + (parsed.usage.outputTokens || 0),
                model: parsed.usage.model || u.model,
              }));
            }
            if (parsed.delta) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + parsed.delta };
                }
                return updated;
              });
            }
            if (parsed.thinkingDelta) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, thinking: (last.thinking || '') + parsed.thinkingDelta };
                }
                return updated;
              });
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Chat error:', err);
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${err.message}` };
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, projectId, sessionId]);

  const stopStreaming = useCallback(() => abortRef.current?.abort(), []);

  const loadHistory = useCallback(async (sid) => {
    const res = await fetch(`/api/chat/history/${sid}`);
    const history = await res.json();
    setMessages(history.map((m) => ({ role: m.role, content: m.content, id: m.id })));
    setSessionId(sid);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setSessionId(null);
  }, []);

  const deleteMessagePair = useCallback(async (startIndex) => {
    if (!sessionId) return;
    await fetch('/api/chat/messages/pair', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, startIndex }),
    });
    setMessages(prev => {
      const updated = [...prev];
      updated.splice(startIndex, 2);
      return updated;
    });
  }, [sessionId]);

  // Regenerate: remove last assistant (and possibly user) pair, re-send last user message
  const regenerate = useCallback(async (lastUserText, attachmentIds, attachmentMeta, model, urlAttachments, temperature, personaId, reasoning) => {
    if (isStreaming) return;
    // Remove last 2 messages (user + assistant)
    let lastUserContent = lastUserText;
    let removedCount = 0;
    setMessages(prev => {
      const updated = [...prev];
      // Find last user message
      const lastAssistantIdx = updated.length - 1;
      const lastUserIdx = updated.length - 2;
      if (updated[lastAssistantIdx]?.role === 'assistant' && updated[lastUserIdx]?.role === 'user') {
        if (!lastUserContent) lastUserContent = updated[lastUserIdx].content;
        updated.splice(lastUserIdx, 2);
        removedCount = 2;
      }
      return updated;
    });
    // Delete from DB
    if (sessionId) {
      const msgs = await fetch(`/api/chat/history/${sessionId}`).then(r => r.json());
      if (msgs.length >= 2) {
        await fetch('/api/chat/messages/pair', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, startIndex: msgs.length - 2 }),
        });
      }
    }
    // Re-send
    if (lastUserContent) {
      await sendMessage(lastUserContent, attachmentIds || [], attachmentMeta || [], model, urlAttachments || [], temperature || 0.7, personaId, reasoning);
    }
  }, [isStreaming, sessionId, sendMessage]);

  return { messages, isStreaming, sessionId, sessionUsage, sendMessage, stopStreaming, loadHistory, clearMessages, deleteMessagePair, regenerate };
}
