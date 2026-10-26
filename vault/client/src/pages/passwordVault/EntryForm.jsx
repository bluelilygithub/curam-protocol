import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { generatePassword } from '../../utils/passwordGen.mjs';
import { BTN, BTN_OUTLINE, BTN_PRIMARY, CARD, CARD_STYLE, FIELD, FIELD_STYLE, Message, SecretInput, StrengthMeter, loadGenOptions } from './shared';

const LABEL = 'text-xs font-medium';

/**
 * Add or change one login. `item` is the decrypted entry being changed (omit for a new one); `startPassword` pre-fills the password
 * (from the generator). Title and username have a microphone; the password and the notes do not, since speech goes to a speech service.
 */
export default function EntryForm({ item, clients, startPassword = '', startClientId = '', onSave, onCancel }) {
  const getIcon = useIcon();
  const [title, setTitle] = useState(item?.title || '');
  const [username, setUsername] = useState(item?.username || '');
  const [url, setUrl] = useState(item?.url || '');
  const [password, setPassword] = useState(item ? item.password || '' : startPassword);
  const [notes, setNotes] = useState(item?.notes || '');
  const [clientId, setClientId] = useState(item?.clientId ? String(item.clientId) : startClientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setError('');
    const changed = !item || item.password !== password;
    try {
      await onSave({
        id: item?.id,
        clientId: clientId ? Number(clientId) : null,
        data: {
          title: title.trim(), username: username.trim(), url: url.trim(), password, notes,
          passwordChangedAt: changed ? new Date().toISOString() : (item.passwordChangedAt || item.createdAt),
        },
      });
    } catch (e) { setError(e.message || 'Could not save.'); setBusy(false); }
  };

  return (
    <div className={CARD} style={CARD_STYLE} data-tour="vault-form">
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{item ? 'Change this login' : 'Add a login'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 block sm:col-span-2">
          <span className={LABEL} style={{ color: 'var(--color-muted)' }}>Title (required)</span>
          <VoiceInput value={title} onChange={setTitle} placeholder="e.g. Acme hosting" label="Title" className="w-full" />
        </label>
        <label className="space-y-1 block">
          <span className={LABEL} style={{ color: 'var(--color-muted)' }}>Username or email</span>
          <VoiceInput value={username} onChange={setUsername} placeholder="Username or email" label="Username or email" className="w-full" />
        </label>
        <label className="space-y-1 block">
          <span className={LABEL} style={{ color: 'var(--color-muted)' }}>Web address</span>
          <input className={`${FIELD} w-full`} style={FIELD_STYLE} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label="Web address" autoCapitalize="none" spellCheck={false} maxLength={500} />
        </label>
        <div className="space-y-1 sm:col-span-2">
          <span className={LABEL} style={{ color: 'var(--color-muted)' }}>Password</span>
          <div className="flex gap-2 items-start">
            <SecretInput value={password} onChange={setPassword} label="Password" placeholder="Password" className="flex-1" autoComplete="new-password" />
            <Tooltip text="Fill in a strong random password. It uses the length and characters you last chose in the Password generator.">
              <button type="button" onClick={() => setPassword(generatePassword(loadGenOptions()))} className={BTN} style={BTN_OUTLINE}>
                {getIcon('refresh-cw', { size: 14 })}Make one
              </button>
            </Tooltip>
          </div>
          <StrengthMeter password={password} />
        </div>
        <label className="space-y-1 block sm:col-span-2" data-guide="client-link">
          <span className={LABEL} style={{ color: 'var(--color-muted)' }}>Client (optional)</span>
          <select className={`${FIELD} w-full`} style={FIELD_STYLE} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client this login belongs to">
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
          </select>
          <span className="text-xs block" style={{ color: 'var(--color-muted)' }}>Files the login under the client. The client link is the one thing that is not locked.</span>
        </label>
        <label className="space-y-1 block sm:col-span-2">
          <span className={LABEL} style={{ color: 'var(--color-muted)' }}>Notes</span>
          <textarea className={`${FIELD} w-full`} style={FIELD_STYLE} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Security questions, which email it uses, anything useful" aria-label="Notes" maxLength={8000} />
        </label>
      </div>
      <Message>{error}</Message>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || !title.trim()} className={BTN} style={BTN_PRIMARY}>{getIcon('check', { size: 14 })}{busy ? 'Locking and saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} disabled={busy} className={BTN} style={BTN_OUTLINE}>Cancel</button>
      </div>
    </div>
  );
}
