import React, { useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { FIELD_CLASS, FIELD_STYLE, Label, SecondaryButton, IconButton } from './shared';
import { STATUS_LABELS, MAX_PAGES } from './htmlContentCheckTools.mjs';

// The pages of a job (one change request often covers several pages of a site): an address and a name each, and per page "Load in a real
// browser". A page that has been read keeps its address (`readIds`). Names matter: a request line pasted under "Under The Artist" goes on
// the page named "The Artist".
function PagesEditor({ pages, onChange, readIds, getIcon }) {
  const [pendingRemove, setPendingRemove] = useState(null);
  const update = (i, patch) => onChange(pages.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i, by) => { const n = [...pages]; [n[i], n[i + by]] = [n[i + by], n[i]]; onChange(n); };
  return (
    <div className="space-y-2" data-guide="pages">
      <Label hint="One job can cover several pages of the same site. Name each page as the request does (for example The Artist): lines pasted under that heading go on that page.">Pages</Label>
      {pages.map((p, i) => {
        const locked = p.id && readIds.has(p.id);
        return (
          <div key={p.key || p.id} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div className="flex flex-col sm:flex-row gap-2">
              <Tooltip text="The page's name, as the request calls it (for example The Artist or Events). Optional.">
                <VoiceInput value={p.label || ''} onChange={(v) => update(i, { label: v })} label={`Name of page ${i + 1}`} placeholder={`Page ${i + 1} name`} className={`${FIELD_CLASS} sm:w-56`} style={FIELD_STYLE} />
              </Tooltip>
              <Tooltip text={locked ? 'This page has been read, so its address is fixed. Remove it and add the new address as another page.' : 'The page\'s address. Only public pages can be fetched; use a saved copy for anything else.'}>
                <VoiceInput value={p.url} onChange={(v) => update(i, { url: v })} label={`Address of page ${i + 1}`} placeholder="https://" className={FIELD_CLASS} style={FIELD_STYLE} disabled={locked} />
              </Tooltip>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }} data-guide={i === 0 ? 'real-browser' : undefined}>
                <Tooltip text="For a page that builds itself with JavaScript: always read it in a real browser (slower). Without the tick a real browser is still used when a plain fetch finds almost no text.">
                  <input type="checkbox" checked={p.fetchMode === 'browser'} onChange={(e) => update(i, { fetchMode: e.target.checked ? 'browser' : 'auto' })} />
                </Tooltip>
                Load in a real browser
              </label>
              <span className="flex gap-1 ml-auto">
                <IconButton tip="Move this page up." label="Move page up" icon={getIcon('chevron-up', { size: 14 })} disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton tip="Move this page down." label="Move page down" icon={getIcon('chevron-down', { size: 14 })} disabled={i === pages.length - 1} onClick={() => move(i, 1)} />
                {pendingRemove === i ? (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text)' }}>
                    Remove?
                    <SecondaryButton danger tip={locked ? 'Yes: remove the page and its reads when you save. Its request lines stay, with no page.' : 'Yes: remove this page.'} onClick={() => { setPendingRemove(null); onChange(pages.filter((_, j) => j !== i)); }}>Yes</SecondaryButton>
                    <SecondaryButton tip="No: keep it." onClick={() => setPendingRemove(null)}>No</SecondaryButton>
                  </span>
                ) : (
                  <IconButton tip="Remove this page from the job." label="Remove page" icon={getIcon('trash', { size: 14 })} disabled={pages.length === 1} onClick={() => setPendingRemove(i)} />
                )}
              </span>
            </div>
          </div>
        );
      })}
      {pages.length < MAX_PAGES && (
        <SecondaryButton tip={`Add another page of the site to this job (${MAX_PAGES} at most).`} onClick={() => onChange([...pages, { key: `n${Date.now()}`, url: '', label: '', fetchMode: 'auto' }])}>Add a page</SecondaryButton>
      )}
    </div>
  );
}

// The fields of a job, shared by New job and Job details. `form` is a plain object; `set(key)` returns a setter for one field.
// `clients` / `tickets` are null while they load or when the person has no CRM / Tickets, and the picker is then left out.
export default function JobForm({ form, set, clients, tickets, isNew, readIds = new Set(), getIcon }) {
  const request = form.kind === 'request';
  return (
    <div className="space-y-4">
      <PagesEditor pages={form.pages} onChange={set('pages')} readIds={readIds} getIcon={getIcon} />
      <div>
        <Label hint={isNew ? 'Optional. Left empty, the first page\'s address is used.' : undefined}>Name</Label>
        <Tooltip text="A name you will recognise in Your jobs, such as the client and the site.">
          <VoiceInput value={form.name} onChange={set('name')} label="Job name" placeholder="Dorothy Stoner: website edits" className={FIELD_CLASS} style={FIELD_STYLE} />
        </Tooltip>
      </div>
      {request && (
        <div>
          <Label hint={isNew ? 'Paste it as you received it. It is split into numbered lines you can fix next; lines under "Under The Artist" and the like go on the page of that name.' : 'Changing it here does not change the lines: use Split the request again on Request lines.'}>Change request</Label>
          <Tooltip text="The edits that were asked for, as sent to you (email text, a list, a document's text). Headings like Under The Artist, Keep: lines and (hold over) are recognised.">
            <VoiceInput type="textarea" append rows={8} value={form.requestText} onChange={set('requestText')} label="Change request"
              placeholder={'Under The Artist\nChange the heading to ...\nKeep: the first paragraph\n\nUnder Events\nAdd the 2027 launch'} className={FIELD_CLASS} style={FIELD_STYLE} />
          </Tooltip>
        </div>
      )}
      <div>
        <Label hint="Optional. Text from before the edits, if you have it (an old copy, the approved draft). It is kept with the job; the pages themselves are always read as the starting point.">Text from before the edits</Label>
        <Tooltip text="Paste the page text as it was before the developer made the changes, if you have it.">
          <VoiceInput type="textarea" append rows={4} value={form.previousText} onChange={set('previousText')} label="Text from before the edits" className={FIELD_CLASS} style={FIELD_STYLE} />
        </Tooltip>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {clients && (
          <div>
            <Label>Client</Label>
            <Tooltip text="Optional: the CRM client these pages belong to.">
              <select value={form.clientId || ''} onChange={(e) => set('clientId')(e.target.value)} aria-label="Client" className={FIELD_CLASS} style={FIELD_STYLE}>
                <option value="">No client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Tooltip>
          </div>
        )}
        {tickets && (
          <div>
            <Label>Ticket</Label>
            <Tooltip text="Optional: the ticket this change request came in on.">
              <select value={form.ticketId || ''} onChange={(e) => set('ticketId')(e.target.value)} aria-label="Ticket" className={FIELD_CLASS} style={FIELD_STYLE}>
                <option value="">No ticket</option>
                {tickets.map((t) => <option key={t.id} value={t.id}>T-{t.id} {t.title}</option>)}
              </select>
            </Tooltip>
          </div>
        )}
        {!isNew && (
          <div>
            <Label>Status</Label>
            <Tooltip text="Open while you are checking; With the client once the report has gone to them; Closed when it is finished.">
              <select value={form.status} onChange={(e) => set('status')(e.target.value)} aria-label="Status" className={FIELD_CLASS} style={FIELD_STYLE}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
