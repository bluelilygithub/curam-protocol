import React, { useEffect, useMemo, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { offerUndo } from '../../utils/binUndo';
import useToastStore from '../../store/toastStore';
import UnlockGate from './UnlockGate';
import EntryForm from './EntryForm';
import { BTN, BTN_OUTLINE, BTN_PRIMARY, CARD, CARD_STYLE, FIELD, FIELD_STYLE, STATUS, copyPlain, copySecret } from './shared';

const NO_CLIENT = 'none';

function IconButton({ icon, tip, label, onClick, danger }) {
  const getIcon = useIcon();
  return (
    <Tooltip text={tip}>
      <button
        type="button" onClick={onClick} aria-label={label}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs hover:opacity-70 transition-opacity duration-200"
        style={{ borderColor: 'var(--color-border)', color: danger ? STATUS.bad : 'var(--color-text)', background: 'transparent' }}
      >{getIcon(icon, { size: 12 })}<span className="hidden sm:inline">{label}</span></button>
    </Tooltip>
  );
}

function Detail({ item, clients, onEdit, onDelete, onClient }) {
  const getIcon = useIcon();
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const row = (label, children) => (
    <div className="grid sm:grid-cols-[8rem_1fr] gap-1 sm:gap-3 text-sm">
      <span className="text-xs pt-0.5" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div className="min-w-0" style={{ color: 'var(--color-text)' }}>{children}</div>
    </div>
  );
  const safeUrl = /^https?:\/\//i.test(item.url || '') ? item.url : (item.url ? `https://${item.url}` : '');
  const when = (d) => (d ? new Date(d).toLocaleDateString() : '');

  if (item.unreadable) {
    return <p className="text-sm" style={{ color: STATUS.bad }}>This one could not be opened with your master password. It may have been saved before the master password was changed.</p>;
  }
  return (
    <div className="space-y-2.5 pt-3">
      {item.username && row('Username', <span className="inline-flex items-center gap-2 break-all">{item.username}<IconButton icon="copy" tip="Copy the username." label="Copy username" onClick={() => copyPlain(item.username, 'Username')} /></span>)}
      {item.url && row('Web address', <span className="inline-flex items-center gap-2 break-all"><a href={safeUrl} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70 transition-opacity duration-200">{item.url}</a><IconButton icon="copy" tip="Copy the web address." label="Copy address" onClick={() => copyPlain(item.url, 'Address')} /></span>)}
      {row('Password', (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm break-all">{item.password ? (shown ? item.password : '••••••••••••') : <em style={{ color: 'var(--color-muted)' }}>none saved</em>}</span>
          {item.password && <>
            <IconButton icon={shown ? 'eye-off' : 'eye'} tip={shown ? 'Hide the password.' : 'Show the password on screen.'} label={shown ? 'Hide' : 'Show'} onClick={() => setShown((v) => !v)} />
            <span data-guide="copy-password"><IconButton icon="copy" tip="Copy the password without showing it. It is cleared from the clipboard after 30 seconds." label="Copy password" onClick={() => copySecret(item.password)} /></span>
          </>}
        </span>
      ))}
      {item.notes && row('Notes', <span className="whitespace-pre-wrap break-words">{item.notes}</span>)}
      {row('Client', (
        <select
          className={`${FIELD} !py-1 !text-xs`} style={FIELD_STYLE} value={item.clientId || ''} aria-label="Client this login belongs to"
          onChange={(e) => onClient(item.id, e.target.value)}
        >
          <option value="">No client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          {item.clientId && !clients.some((c) => c.id === item.clientId) && <option value={item.clientId}>{item.clientName || 'Archived client'}</option>}
        </select>
      ))}
      {row('Saved', <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Added {when(item.createdAt)}{item.passwordChangedAt ? ` · password changed ${when(item.passwordChangedAt)}` : ''}</span>)}
      <div className="flex flex-wrap items-center gap-2 pt-1" data-guide="delete-password">
        <button type="button" onClick={() => onEdit(item)} className={BTN} style={BTN_OUTLINE}>{getIcon('pencil-line', { size: 14 })}Change</button>
        {confirming ? (
          <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
            Delete?
            <button type="button" onClick={() => onDelete(item)} className="font-medium hover:opacity-70 transition-opacity duration-200" style={{ color: STATUS.bad }}>Yes</button>
            <button type="button" onClick={() => setConfirming(false)} className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>No</button>
          </span>
        ) : (
          <Tooltip text="Move this login to the Recycle bin for 30 days. You can undo it straight after.">
            <button type="button" onClick={() => setConfirming(true)} className={BTN} style={{ ...BTN_OUTLINE, color: STATUS.bad }}>{getIcon('trash', { size: 14 })}Delete</button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function PasswordsTool({ vault, focusId, onFocused, draftPassword, onDraftUsed, initialClient = '', onForgot }) {
  const getIcon = useIcon();
  const toast = useToastStore((s) => s.addToast);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState(initialClient || '');
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // null | { item?: entry, password?: string }

  const usable = vault.status?.setUp && vault.unlocked;

  // The generator's "Put it in a new login", and the health list's "Open", both arrive here.
  useEffect(() => {
    if (usable && draftPassword) { setForm({ password: draftPassword }); onDraftUsed?.(); }
  }, [usable, draftPassword]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (usable && focusId && vault.items.some((i) => i.id === focusId)) { setOpenId(focusId); setSearch(''); setClientFilter(''); onFocused?.(); }
  }, [usable, focusId, vault.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vault.items
      .filter((i) => (clientFilter === '' ? true : clientFilter === NO_CLIENT ? !i.clientId : String(i.clientId) === clientFilter))
      .filter((i) => !q || [i.title, i.username, i.url, i.notes, i.clientName].some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
  }, [vault.items, search, clientFilter]);

  const gate = <UnlockGate vault={vault} onForgot={onForgot} />;
  if (!usable) return gate;

  const save = async (payload) => {
    await vault.save(payload);
    toast(payload.id ? 'Saved ✓' : 'Added ✓', 'success');
    setForm(null);
    if (payload.id) setOpenId(payload.id);
  };

  const remove = async (item) => {
    try {
      const d = await vault.remove(item.id);
      setOpenId(null);
      offerUndo({ message: 'Moved to the Recycle bin.', binIds: d.binId, after: vault.reload });
    } catch (e) { toast(e.message || 'Could not delete.', 'error'); }
  };

  const changeClient = async (id, clientId) => {
    try { await vault.setClient(id, clientId); } catch (e) { toast(e.message || 'Could not change the client.', 'error'); }
  };

  const usedClientIds = new Set(vault.items.map((i) => i.clientId).filter(Boolean));

  return (
    <div className="space-y-4">
      {form ? (
        <EntryForm
          item={form.item} clients={vault.clients} startPassword={form.password || ''}
          startClientId={!form.item && /^\d+$/.test(clientFilter) ? clientFilter : ''}
          onSave={save} onCancel={() => setForm(null)}
        />
      ) : (
        <div className="flex flex-col sm:flex-row gap-2" data-guide="add-password">
          <div className="flex-1 min-w-0">
            <Tooltip text="Search by title, username, web address, notes or client. The microphone lets you say it.">
              <div className="w-full">
                <VoiceInput value={search} onChange={setSearch} placeholder="Search your logins…" label="Search your logins" className="w-full" />
              </div>
            </Tooltip>
          </div>
          <Tooltip text="Show every login, only those with no client, or only those for one client.">
            <select
              className={FIELD} style={FIELD_STYLE} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
              aria-label="Filter by client" data-tour="vault-client-filter" data-guide="client-filter"
            >
              <option value="">All clients</option>
              <option value={NO_CLIENT}>No client</option>
              {vault.clients.filter((c) => usedClientIds.has(c.id)).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              {vault.clients.filter((c) => !usedClientIds.has(c.id)).map((c) => <option key={c.id} value={String(c.id)}>{c.name} (none yet)</option>)}
            </select>
          </Tooltip>
          <Tooltip text="Add a login: title, username, web address, password, notes, and which client it belongs to.">
            <button type="button" onClick={() => setForm({})} className={BTN} style={BTN_PRIMARY} data-tour="vault-add">{getIcon('plus', { size: 14 })}Add a password</button>
          </Tooltip>
        </div>
      )}

      {!form && (
        <>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {shown.length} of {vault.items.length} login{vault.items.length === 1 ? '' : 's'}. The vault locks itself after a quiet spell.
          </p>
          {vault.items.length === 0 && (
            <div className={CARD} style={CARD_STYLE}>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>Nothing saved yet. Press <strong>Add a password</strong> to save your first login. You can link it to a client so it is easy to find later.</p>
            </div>
          )}
          {vault.items.length > 0 && shown.length === 0 && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No logins match.</p>}
          <ul className="space-y-2">
            {shown.map((i) => {
              const open = openId === i.id;
              return (
                <li key={i.id} className="rounded-xl border p-4" style={{ borderColor: open ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setOpenId(open ? null : i.id)} aria-expanded={open} className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity duration-200">
                      <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{i.title}</span>
                      <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{i.username || i.url || ' '}</span>
                    </button>
                    {i.clientName && (
                      <span className="shrink-0 max-w-[10rem] truncate text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }} title={`Client: ${i.clientName}`}>{i.clientName}</span>
                    )}
                    {!i.unreadable && i.password && (
                      <IconButton icon="copy" tip="Copy the password without showing it. It is cleared from the clipboard after 30 seconds." label="Copy" onClick={() => copySecret(i.password)} />
                    )}
                  </div>
                  {open && <Detail item={i} clients={vault.clients} onEdit={(item) => setForm({ item })} onDelete={remove} onClient={changeClient} />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
