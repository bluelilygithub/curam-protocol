import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bridge, ClipContent } from './bridge/types';

export interface ToastState { id: number; text: string; kind: 'ok' | 'error' | 'info'; leaving: boolean }

/** One small message at a time that fades away by itself (errors stay longer). The fade-out is part of the state so it can be animated. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  const show = useCallback((text: string, kind: ToastState['kind'] = 'ok') => {
    clear();
    const id = Date.now() + Math.random();
    setToast({ id, text, kind, leaving: false });
    const life = kind === 'error' ? 4500 : 2000;
    timers.current.push(window.setTimeout(() => setToast((t) => (t && t.id === id ? { ...t, leaving: true } : t)), life));
    timers.current.push(window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), life + 220));
  }, []);
  useEffect(() => clear, []);
  return { toast, show };
}

/**
 * The full content of the open clip. It is cleared the moment the choice changes, so a previous picture or long text is not kept in memory
 * while the next one loads. `undefined` = loading, `null` = gone.
 */
export function useClipContent(bridge: Bridge | null, id: string | null): ClipContent | null | undefined {
  const [content, setContent] = useState<ClipContent | null | undefined>(undefined);
  useEffect(() => {
    setContent(undefined);
    if (!bridge || !id) return undefined;
    let live = true;
    bridge.getClip(id).then((c) => { if (live) setContent(c); }).catch(() => { if (live) setContent(null); });
    return () => { live = false; setContent(undefined); };
  }, [bridge, id]);
  return content;
}

const MAX_THUMBS = 12;

/**
 * Small pictures for the picture cards that are in view. At most MAX_THUMBS are kept; when more are wanted the oldest asked-for are let go,
 * and the cards that scrolled away free theirs as soon as the list moves on. The page never holds the whole history's pictures.
 */
export function useThumbs(bridge: Bridge | null, wantedIds: string[]): Map<string, string> {
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const asked = useRef<Set<string>>(new Set());
  const key = wantedIds.join('|');
  useEffect(() => {
    if (!bridge) return;
    const wanted = new Set(wantedIds.slice(0, MAX_THUMBS));
    setThumbs((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) if (!wanted.has(id)) { next.delete(id); asked.current.delete(id); changed = true; }
      return changed ? next : prev;
    });
    for (const id of wanted) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      bridge.getClip(id).then((c) => {
        if (c && c.kind === 'image') setThumbs((prev) => (wanted.has(id) || prev.size < MAX_THUMBS ? new Map(prev).set(id, c.dataUrl) : prev));
      }).catch(() => { asked.current.delete(id); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, key]);
  return thumbs;
}
