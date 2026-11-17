import React, { useState, useEffect } from 'react';
import api from '../../utils/apiClient';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { useIcon } from '../../providers/IconProvider';

// Small pieces every Translate screen shares: the form controls, the status pill, the upload rules and the option lists.

// Deployed commit shown on QA/Lessons-learnt reports so a stale build is checkable at a glance
// instead of re-testing a fix against a report that never actually deployed — see /api/health.
// Module-level cache: one fetch per page load, not one per modal open.
export let _appVersionCache = null;
export function useAppVersion() {
  const [version, setVersion] = useState(_appVersionCache);
  useEffect(() => {
    if (_appVersionCache) return;
    api.get('/api/health').then(r => r.json()).then(d => {
      const v = d.commit ? `${d.commit.slice(0, 7)}${d.branch ? ` (${d.branch})` : ''}` : 'unknown';
      _appVersionCache = v;
      setVersion(v);
    }).catch(() => setVersion('unknown'));
  }, []);
  return version;
}

export let _pdfjsLib = null;
export async function getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  _pdfjsLib = await import('pdfjs-dist');
  if (_pdfjsLib.GlobalWorkerOptions) {
    _pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
    ).toString();
  }
  return _pdfjsLib;
}

// Job stage order mirrors server pipeline stages (see docs/translate-agent.md § Pipeline):
// pending → extracting → ocr → preparing → translating → reviewing → generating → done/failed.
export const ACCEPT_UPLOAD =
  '.pdf,.docx,.xlsx,.xls,.txt,application/pdf,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document,'
  + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,'
  + 'application/vnd.ms-excel,text/plain';

export function detectUploadKind(file) {
  if (!file) return null;
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx')
    || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (name.endsWith('.xlsx')
    || type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (name.endsWith('.xls') || type === 'application/vnd.ms-excel') return 'xls';
  if (name.endsWith('.txt') || type === 'text/plain') return 'txt';
  return null;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
export function Btn({ onClick, disabled, variant = 'primary', children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${className}`}
      style={{
        background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
        color: variant === 'primary' ? '#fff' : 'var(--color-text)',
        border: variant === 'secondary' ? '1px solid var(--color-border)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }) {
  const getIcon = useIcon();
  return (
    <Dialog raw onClose={onClose}
        overlayClassName="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4"
        overlayStyle={{ background: 'rgba(0,0,0,0.5)' }}
        panelClassName={`relative w-full ${wide === 'xl' ? 'max-w-4xl' : wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl shadow-xl overflow-y-auto`}
        panelStyle={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="w-7 h-7 flex items-center justify-center rounded transition-opacity duration-200 hover:opacity-60"
            style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 16 })}</button>
        </div>
        <div className="p-5">{children}</div>
      </Dialog>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
      {hint && <p className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.8 }}>{hint}</p>}
    </div>
  );
}

export function Input({ value, onChange, placeholder, type = 'text', ...rest }) {
  return (
    <input type={type} value={value}
      onChange={e => onChange(typeof e === 'string' ? e : e.target.value)}
      placeholder={placeholder}
      className="text-sm px-3 py-2 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      {...rest}
    />
  );
}

export function Sel({ value, onChange, children, ...rest }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-sm px-3 py-2 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      {...rest}>
      {children}
    </select>
  );
}

export function StatusBadge({ status }) {
  const map = {
    pending:    { label: 'Waiting',     color: 'var(--color-muted)', bg: 'rgba(0,0,0,0.06)' },
    extracting: { label: 'Reading',  color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    ocr:        { label: 'Reading scans',         color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
    preparing:  { label: 'Preparing wording',    color: '#9333ea', bg: 'rgba(147,51,234,0.1)' },
    translating:{ label: 'Translating', color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
    reviewing:  { label: 'Checking',   color: '#c2410c', bg: 'rgba(194,65,12,0.1)' },
    generating: { label: 'Making the files',  color: '#d97706', bg: 'rgba(217,119,6,0.1)'  },
    ready:      { label: 'Ready to read', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    done:       { label: 'Kept',        color: '#16a34a', bg: 'rgba(22,163,74,0.1)'  },
    failed:     { label: 'Failed',      color: '#dc2626', bg: 'rgba(220,38,38,0.1)'  },
    cancelled:  { label: 'Cancelled',   color: 'var(--color-muted)', bg: 'rgba(0,0,0,0.06)' },
  };
  const s = map[status] || map.pending;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ color: s.color, background: s.bg }}>{s.label}</span>
  );
}

export const DOMAIN_OPTIONS = [
  { value: 'ai_compliance', label: 'AI, compliance or IT rules' },
  { value: 'legal', label: 'Legal or contracts' },
  { value: 'finance', label: 'Finance or accounting' },
  { value: 'medical', label: 'Medical or clinical' },
  { value: 'general', label: 'General business' },
  { value: 'other', label: 'Other' },
];

export const AUDIENCE_OPTIONS = [
  { value: 'auditor', label: 'An auditor or regulator' },
  { value: 'insurer', label: 'An insurer' },
  { value: 'client', label: 'A client' },
  { value: 'internal', label: 'My own team' },
  { value: 'other', label: 'Other' },
];

/** A hover tip on any control. Tooltip needs a real element to attach to, so components (a select, a mic field) are wrapped in one. */
export function Tip({ text, children, className = 'w-full', side }) {
  return <Tooltip text={text} side={side}><div className={className}>{children}</div></Tooltip>;
}

/** Fetch a file from the API (the login travels in a header, so a plain link cannot do it) and save it under `name`. */
export async function saveFromApi(api, path, name, failText = 'Download failed') {
  const res = await api.get(path);
  if (!res.ok) throw new Error(failText);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const baseName = (job) => (job.filename || 'document').replace(/\.[^.]+$/, '');
export const isSpreadsheet = (job) => /\.xlsx?$/i.test(job.filename || '');
