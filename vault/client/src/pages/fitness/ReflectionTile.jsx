import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { Card } from './ui';

/**
 * A short look back at a finished week, in the model's words (or plain rule-based words if no model is set).
 * Shown only when something was logged that week; otherwise it stays out of the way.
 */
export default function ReflectionTile({ weekStart, title = 'Last week' }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    let live = true;
    setText(null);
    api.get(`/api/fitness/reflection?weekStart=${weekStart}`)
      .then((r) => r.json())
      .then((d) => { if (live) setText(d.reflection || null); })
      .catch(() => { if (live) setText(null); });
    return () => { live = false; };
  }, [weekStart]);
  if (!text) return null;
  return (
    <Card title={title} icon="calendar-days">
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{text}</p>
    </Card>
  );
}
