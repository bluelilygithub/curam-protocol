import React, { useState, useRef } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

const CSV_HEADERS = ['title', 'notes', 'priority', 'status', 'category', 'dueDate', 'tags', 'projectId'];

const TEMPLATE_ROWS = [
  ['Write project brief', 'Document the project goals and constraints', 'high', 'todo', 'Planning', '2026-03-15', 'planning,docs', ''],
  ['Review pull requests', 'Check open PRs in the repo', 'medium', 'in-progress', 'Development', '', 'dev', ''],
];

function generateTemplate() {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of TEMPLATE_ROWS) {
    lines.push(row.map(v => `"${v}"`).join(','));
  }
  return lines.join('\n');
}

/**
 * Parse a single CSV line handling quoted fields.
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  const rows = lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return headers.reduce((obj, h, i) => { obj[h] = values[i] || ''; return obj; }, {});
  });
  return { headers, rows };
}

function validateRow(row, idx) {
  const errors = [];
  if (!row.title || !row.title.trim()) errors.push('Title required');
  if (row.priority && !['high', 'medium', 'low'].includes(row.priority.toLowerCase())) errors.push(`Invalid priority "${row.priority}"`);
  if (row.status && !['todo', 'in-progress', 'done'].includes(row.status.toLowerCase())) errors.push(`Invalid status "${row.status}"`);
  if (row.dueDate && !/^\d{4}-\d{2}-\d{2}/.test(row.dueDate)) errors.push('Invalid date format (use YYYY-MM-DD)');
  return errors;
}

export default function TaskImport({ onClose, onImported }) {
  const getIcon = useIcon();
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState(null); // parsed rows with validation
  const [checked, setChecked] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleDownload = () => {
    const content = generateTemplate();
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasks-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const processFile = (file) => {
    if (!file || !file.name.endsWith('.csv')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows: rawRows } = parseCsv(e.target.result);
      const processed = rawRows.map((row, i) => {
        const errors = validateRow(row, i);
        return { ...row, _errors: errors, _valid: errors.length === 0 };
      });
      setRows(processed);
      setChecked(new Set(processed.filter(r => r._valid).map((_, i) => i)));
      setResult(null);
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e) => processFile(e.target.files[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };

  const toggleRow = (i) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else if (rows[i]._valid) next.add(i);
      return next;
    });
  };

  const handleImport = async () => {
    if (!rows || checked.size === 0) return;
    setImporting(true);
    try {
      const tasks = [...checked].map(i => {
        const r = rows[i];
        return {
          title: r.title?.trim(),
          notes: r.notes?.trim() || null,
          priority: (['high', 'medium', 'low'].includes(r.priority?.toLowerCase()) ? r.priority.toLowerCase() : 'medium'),
          status: (['todo', 'in-progress', 'done'].includes(r.status?.toLowerCase()) ? r.status.toLowerCase() : 'todo'),
          category: r.category?.trim() || null,
          dueDate: r.dueDate?.trim() || null,
          tags: r.tags?.trim() || null,
          projectId: r.projectid ? Number(r.projectid) : (r.projectId ? Number(r.projectId) : null),
        };
      });
      const data = await api.post('/api/tasks/import', { tasks }).then(r => r.json());
      setResult(data);
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setImporting(false);
    }
  };

  const validCount = rows ? rows.filter(r => r._valid).length : 0;
  const invalidCount = rows ? rows.filter(r => !r._valid).length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            {getIcon('upload', { size: 16, style: { color: 'var(--color-primary)' } })}
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Import Tasks from CSV</h2>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 16 })}</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Download template */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Download template</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>CSV with: {CSV_HEADERS.join(', ')}</p>
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
            >
              {getIcon('download', { size: 13 })} Download
            </button>
          </div>

          {/* Upload zone */}
          <div
            className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center py-8 gap-3 cursor-pointer transition-all"
            style={{ borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)', background: dragOver ? 'rgba(var(--color-primary-rgb,99,102,241),0.05)' : 'transparent' }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {getIcon('upload', { size: 24, style: { color: 'var(--color-muted)', opacity: 0.5 } })}
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Drag & drop a CSV file here, or <span style={{ color: 'var(--color-primary)' }}>click to browse</span></p>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          </div>

          {/* Preview table */}
          {rows && rows.length > 0 && !result && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                  Preview — <span style={{ color: '#22c55e' }}>{validCount} valid</span>{invalidCount > 0 && <>, <span style={{ color: '#ef4444' }}>{invalidCount} invalid</span></>}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{checked.size} selected</span>
              </div>
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                      <th className="w-8 px-3 py-2"></th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--color-muted)' }}>Title</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--color-muted)' }}>Priority</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--color-muted)' }}>Status</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--color-muted)' }}>Due</th>
                      <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--color-muted)' }}>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        title={row._errors.join('; ')}
                        style={{
                          background: !row._valid ? '#ef444408' : checked.has(i) ? 'transparent' : 'rgba(0,0,0,0.02)',
                          borderBottom: '1px solid var(--color-border)',
                          opacity: !row._valid ? 0.7 : 1,
                        }}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked.has(i)}
                            onChange={() => toggleRow(i)}
                            disabled={!row._valid}
                            style={{ accentColor: 'var(--color-primary)' }}
                          />
                        </td>
                        <td className="px-3 py-2 max-w-[180px] truncate" style={{ color: row._valid ? 'var(--color-text)' : '#ef4444' }}>{row.title || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{row.priority || 'medium'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{row.status || 'todo'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{row.dueDate || '—'}</td>
                        <td className="px-3 py-2" style={{ color: '#ef4444' }}>{row._errors.join('; ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Result */}
          {result && !result.error && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="text-3xl">✅</div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Import complete!</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {result.created} task{result.created !== 1 ? 's' : ''} created
                {result.skipped > 0 && `, ${result.skipped} skipped`}
              </p>
              <button
                onClick={onImported}
                className="mt-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: 'var(--color-primary)' }}
              >
                View tasks
              </button>
            </div>
          )}

          {result?.error && (
            <div className="px-4 py-3 rounded-xl text-xs" style={{ background: '#ef444411', color: '#ef4444', border: '1px solid #ef4444' }}>
              Error: {result.error}
            </div>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="flex items-center justify-between px-6 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Cancel</button>
            <button
              onClick={handleImport}
              disabled={importing || !rows || checked.size === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {importing ? 'Importing…' : `Import ${checked.size} task${checked.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
