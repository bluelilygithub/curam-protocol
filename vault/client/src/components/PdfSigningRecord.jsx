import React, { useEffect, useState } from 'react';
import api from '../utils/apiClient';

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' });

// Shows the hidden Vault signing stamp of a PDF, if it has one. `doc` is an open pdfjs document; `bytes` is a copy of the
// file the caller still owns (pdfjs may detach the buffer it was given), used to check the file is unchanged since signing.
export default function PdfSigningRecord({ doc, bytes }) {
  const [state, setState] = useState(null); // null = no stamp; { stamp, record?, intact?, error? }

  useEffect(() => {
    setState(null);
    if (!doc || !bytes) return;
    let cancelled = false;
    (async () => {
      try {
        const custom = (await doc.getMetadata())?.info?.Custom || {};
        const id = custom.VaultSigningId;
        if (!id) return;
        const stamp = { id, by: custom.VaultSignedBy, at: custom.VaultSignedAt };
        const [res, hash] = await Promise.all([api.get(`/api/pdf/signatures/${encodeURIComponent(id)}`), sha256Hex(bytes)]);
        if (cancelled) return;
        if (!res.ok) return setState({ stamp, error: res.status === 404 ? 'missing' : 'failed' });
        const record = await res.json();
        if (!cancelled) setState({ stamp, record, intact: record.signedSha256 === hash });
      } catch (e) {
        console.error('PdfSigningRecord:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, bytes]);

  if (!state) return null;
  const { stamp, record, intact, error } = state;
  const row = (label, value) => value ? (
    <div className="flex gap-2"><dt className="w-24 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</dt><dd className="break-all" style={{ color: 'var(--color-text)' }}>{value}</dd></div>
  ) : null;

  return (
    <section aria-label="Signing record" className="mt-3 rounded-lg px-3 py-2.5 text-xs space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>Signing record</h3>
      {record && (
        <p className="font-medium" style={{ color: intact ? '#16a34a' : '#d97706' }}>
          {intact ? '✓ This file is exactly what was signed.' : '⚠ This file has changed since it was signed. It may have been edited or just re-saved.'}
        </p>
      )}
      {error === 'missing' && <p style={{ color: '#d97706' }}>The PDF has a signing stamp, but there's no matching record in your Vault.</p>}
      {error === 'failed' && <p style={{ color: '#ef4444' }}>Couldn't load the signing record. Showing what's in the PDF only.</p>}
      <dl className="space-y-1">
        {row('Signed by', record?.signerEmail || stamp.by)}
        {row('Signed at', fmt(record?.signedAt || stamp.at))}
        {row('Signing ID', stamp.id)}
        {record && row('Original file', record.fileName)}
        {record && row('IP address', record.ipAddress)}
        {record && row('Browser', record.userAgent)}
        {record && row('Signatures', String(record.placements))}
        {record && row('Signed hash', record.signedSha256)}
        {record && row('Original hash', record.originalSha256)}
      </dl>
    </section>
  );
}
