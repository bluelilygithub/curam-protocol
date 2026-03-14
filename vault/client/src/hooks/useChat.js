import { useState, useCallback, useRef } from 'react';
import api from '../utils/apiClient';

export function useChat({ projectId }) {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [sessionUsage, setSessionUsage] = useState({ inputTokens: 0, outputTokens: 0, model: null });
  const [streamError, setStreamError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef(null);
  const timeoutRef = useRef(null);

  const clearStreamError = useCallback(() => setStreamError(null), []);

  const sendMessage = useCallback(async (
    userContent,
    attachmentIds = [],
    attachmentMeta = [],
    model = null,
    urlAttachments = [],
    temperature = 0.7,
    personaId = null,
    reasoning = false,
    inlineImages = [],
    webSearch = true,
  ) => {
    setStreamError(null);
    setIsSearching(false);
    const newMessages = [...messages, { role: 'user', content: userContent, attachments: attachmentMeta, urlAttachments }];
    setMessages(newMessages);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '', thinking: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    // 30-second timeout — aborts if no first chunk arrives
    let gotFirstChunk = false;
    timeoutRef.current = setTimeout(() => {
      if (!gotFirstChunk) {
        controller.abort();
        setStreamError({ code: 'timeout', message: 'No response received after 30 seconds.', hint: 'The API may be unreachable. Check your API key and try again.' });
      }
    }, 30000);

    try {
      const res = await api.stream('/api/chat', {
        messages: newMessages,
        projectId: projectId || undefined,
        sessionId: sessionId || undefined,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        urlAttachments: urlAttachments.length ? urlAttachments : undefined,
        inlineImages: inlineImages.length ? inlineImages : undefined,
        model: model || undefined,
        temperature,
        personaId: personaId || undefined,
        reasoning: reasoning || undefined,
        webSearch: webSearch,
      }, controller.signal);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break outer;
          try {
            const parsed = JSON.parse(data);
            if (parsed.streamError) {
              setStreamError(parsed.streamError);
              // Remove the empty assistant placeholder
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant' && !last.content) updated.pop();
                return updated;
              });
              break outer;
            }
            if (parsed.sessionId && !sessionId) setSessionId(parsed.sessionId);
            if (parsed.usage) {
              setSessionUsage(u => ({
                inputTokens: u.inputTokens + (parsed.usage.inputTokens || 0),
                outputTokens: u.outputTokens + (parsed.usage.outputTokens || 0),
                model: parsed.usage.model || u.model,
              }));
            }
            if (parsed.searching) {
              if (!gotFirstChunk) {
                gotFirstChunk = true;
                clearTimeout(timeoutRef.current);
              }
              setIsSearching(true);
            }
            if (parsed.delta) {
              setIsSearching(false);
              if (!gotFirstChunk) {
                gotFirstChunk = true;
                clearTimeout(timeoutRef.current);
              }
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
              if (!gotFirstChunk) {
                gotFirstChunk = true;
                clearTimeout(timeoutRef.current);
              }
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
            // ignore JSON parse errors
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Chat error:', err);
        setStreamError({ code: 'unknown', message: 'Connection error.', hint: err.message });
      }
      // Remove the empty assistant placeholder on any error/abort
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && !last.content) updated.pop();
        return updated;
      });
    } finally {
      clearTimeout(timeoutRef.current);
      setIsStreaming(false);
      setIsSearching(false);
      abortRef.current = null;
    }
  }, [messages, projectId, sessionId]);

  const stopStreaming = useCallback(() => abortRef.current?.abort(), []);

  const loadHistory = useCallback(async (sid) => {
    const res = await api.get(`/api/chat/history/${sid}`);
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
    await api.delete('/api/chat/messages/pair', { sessionId, startIndex });
    setMessages(prev => {
      const updated = [...prev];
      updated.splice(startIndex, 2);
      return updated;
    });
  }, [sessionId]);

  // Regenerate: remove last assistant (and possibly user) pair, re-send last user message
  const regenerate = useCallback(async (lastUserText, attachmentIds, attachmentMeta, model, urlAttachments, temperature, personaId, reasoning, webSearch = true) => {
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
      const msgs = await api.get(`/api/chat/history/${sessionId}`).then(r => r.json());
      if (msgs.length >= 2) {
        await api.delete('/api/chat/messages/pair', { sessionId, startIndex: msgs.length - 2 });
      }
    }
    // Re-send
    if (lastUserContent) {
      await sendMessage(lastUserContent, attachmentIds || [], attachmentMeta || [], model, urlAttachments || [], temperature || 0.7, personaId, reasoning, [], webSearch);
    }
  }, [isStreaming, sessionId, sendMessage]);

  return { messages, isStreaming, isSearching, sessionId, sessionUsage, sendMessage, stopStreaming, loadHistory, clearMessages, deleteMessagePair, regenerate, streamError, clearStreamError };
}
