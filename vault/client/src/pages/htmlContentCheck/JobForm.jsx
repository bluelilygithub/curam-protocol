import React from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { FIELD_CLASS, FIELD_STYLE, Label } from './shared';
import { STATUS_LABELS } from './htmlContentCheckTools.mjs';

// The fields of a job, shared by New job and Job details. `form` is a plain object; `set(key)` returns a setter for one field.
// `clients` / `tickets` are null while they load or when the person has no CRM / Tickets, and the picker is then left out.
export default function JobForm({ form, set, clients, tickets, isNew, urlLocked }) {
  const request = form.kind === 'request';
  return (
    <div className="space-y-4">
      <div>
        <Label hint={urlLocked ? 'Fixed once the page has been fetched; start a new job for another address.' : 'The web page to check, for example example.com.au/about.'}>Page address</Label>
        <Tooltip text="The address of the page the edits were made on. Only public pages can be fetched.">
          <VoiceInput value={form.url} onChange={set('url')} label="Page address" placeholder="https://" className={FIELD_CLASS} style={FIELD_STYLE} disabled={urlLocked} />
        </Tooltip>
      </div>
      <div>
        <Label hint={isNew ? 'Optional. Left empty, the page address is used.' : undefined}>Name</Label>
        <Tooltip text="A name you will recognise in Your jobs, such as the client and the page.">
          <VoiceInput value={form.name} onChange={set('name')} label="Job name" placeholder="Dorothy Stoner: artist page" className={FIELD_CLASS} style={FIELD_STYLE} />
        </Tooltip>
      </div>
      {request && (
        <div>
          <Label hint={isNew ? 'Paste it as you received it. It is split into numbered lines you can fix next.' : 'Changing it here does not change the lines: use Split the request again on Request lines.'}>Change request</Label>
          <Tooltip text="The edits that were asked for, as sent to you (email text, a list, a document's text).">
            <VoiceInput type="textarea" append rows={8} value={form.requestText} onChange={set('requestText')} label="Change request"
              placeholder={'- Change the heading to ...\n- Remove the 1998 exhibition\n- Fix the spelling of ...'} className={FIELD_CLASS} style={FIELD_STYLE} />
          </Tooltip>
        </div>
      )}
      <div>
        <Label hint="Optional. Text from before the edits, if you have it (an old copy, the approved draft). It is kept with the job; the page itself is always fetched as the starting point.">Text from before the edits</Label>
        <Tooltip text="Paste the page text as it was before the developer made the changes, if you have it.">
          <VoiceInput type="textarea" append rows={4} value={form.previousText} onChange={set('previousText')} label="Text from before the edits" className={FIELD_CLASS} style={FIELD_STYLE} />
        </Tooltip>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {clients && (
          <div>
            <Label>Client</Label>
            <Tooltip text="Optional: the CRM client this page belongs to.">
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
      <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
        <Tooltip text="Use this for pages built with JavaScript, which show almost no text to a plain fetch. Slower. Without the tick, a real browser is still used when a plain fetch finds almost no text.">
          <input type="checkbox" className="mt-0.5" checked={form.fetchMode === 'browser'} onChange={(e) => set('fetchMode')(e.target.checked ? 'browser' : 'auto')} />
        </Tooltip>
        <span>Load in a real browser<span className="block text-xs" style={{ color: 'var(--color-muted)' }}>Fetching the page arrives in the next update; this choice is kept with the job.</span></span>
      </label>
    </div>
  );
}
