import { useCallback, useEffect, useMemo, useState } from 'react';
import { botanicalLabel, PLANTS, plantLabel } from '../plants/plants';
import type { AdminPhoto, AdminSummaryRow, DefaultRole } from '../state/plantPhotos';
import { useApp, useUi } from './AppContext';
import { Icon } from './icons';

const ROLES = ['flower', 'foliage', 'plant', 'habitat', 'other'] as const;
const DEFAULTS: ReadonlyArray<readonly [DefaultRole, string]> = [['flower', 'Flower'], ['foliage', 'Leaves'], ['plant', 'Whole plant']];
const ROLE_LABEL: Record<string, string> = { flower: 'Flower', foliage: 'Leaves', plant: 'Whole plant', habitat: 'In the landscape', other: 'Other' };
type Filter = 'all' | 'none' | 'nodefaults' | 'hidden' | 'failed' | 'unlooked';

const FILTERS: ReadonlyArray<readonly [Filter, string]> = [
  ['all', 'All plants'], ['unlooked', 'Not looked up yet'], ['none', 'No photos shown'], ['nodefaults', 'Photos but no chosen defaults'], ['hidden', 'Has hidden photos'], ['failed', 'Last lookup failed'],
];

/** The summary line for a plant in the list. */
export function summaryText(r: AdminSummaryRow | undefined): string {
  if (!r || (r.status === null && r.visible === 0 && r.hidden === 0)) return 'not looked up yet';
  if (r.status === 'error' && r.visible === 0) return 'lookup failed';
  const parts = [`${r.visible} shown`];
  if (r.hidden) parts.push(`${r.hidden} hidden`);
  parts.push(`${r.defaults}/3 chosen`);
  return parts.join(' · ');
}

/** Does this plant belong in the chosen filter? */
export function inFilter(r: AdminSummaryRow | undefined, f: Filter): boolean {
  switch (f) {
    case 'all': return true;
    case 'unlooked': return !r || (r.status === null && r.visible === 0 && r.hidden === 0);
    case 'none': return !r || r.visible === 0;
    case 'nodefaults': return !!r && r.visible > 0 && r.defaults === 0;
    case 'hidden': return !!r && r.hidden > 0;
    case 'failed': return r?.status === 'error';
  }
}

/**
 * The photo curator (admin only; the server checks again on every call). Pick a plant, see every photo found for it (hidden ones too, dimmed),
 * hide the wrong ones, say what each shows, and choose the default flower, leaves and whole-plant photos that the plant card shows first.
 */
export function CuratorModal() {
  const app = useApp();
  const open = useUi((s) => s.curatorOpen);
  if (!open) return null;
  return <Curator close={() => app.ui.getState().set({ curatorOpen: false })} />;
}

function Curator({ close }: { close: () => void }) {
  const app = useApp();
  const api = app.plantPhotos.admin;
  const [summary, setSummary] = useState<Map<string, AdminSummaryRow>>(new Map());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [plantId, setPlantId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<AdminPhoto[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const say = (text: string, bad = false): void => setMsg({ text, bad });
  const loadSummary = useCallback(async () => {
    const r = await api.summary();
    if (!r.ok) { say(r.error ?? 'Could not load the list.', true); return; }
    setSummary(new Map((r.data ?? []).map((x) => [x.plantId, x])));
  }, [api]);
  const loadPhotos = useCallback(async (id: string) => {
    const r = await api.all(id);
    if (!r.ok) { say(r.error ?? 'Could not load the photos.', true); setPhotos([]); return; }
    setPhotos(r.data ?? []);
  }, [api]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { setPhotos(null); if (plantId) void loadPhotos(plantId); }, [plantId, loadPhotos]);

  const q = query.trim().toLowerCase();
  const list = useMemo(() => PLANTS.filter((p) => (!q || plantLabel(p).toLowerCase().includes(q) || p.botanical.toLowerCase().includes(q)) && inFilter(summary.get(p.id), filter)), [q, filter, summary]);
  const plant = plantId ? PLANTS.find((p) => p.id === plantId) : undefined;

  /** Run one curator action, then show what is true now. */
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string): Promise<void> => {
    if (!plantId || busy) return;
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { say(r.error ?? 'That did not work.', true); return; }
    say(done);
    await Promise.all([loadPhotos(plantId), loadSummary()]);
  };

  const refreshFromSources = async (): Promise<void> => {
    if (!plantId) return;
    const id = plantId;
    setBusy(true);
    const r = await api.refresh(id);
    setBusy(false);
    if (!r.ok) { say(r.error ?? 'That did not work.', true); return; }
    say('Looking again at iNaturalist, Wikimedia Commons and the Atlas of Living Australia. This takes a few seconds.');
    for (const wait of [3000, 5000, 8000]) {
      await new Promise((res) => setTimeout(res, wait));
      await Promise.all([loadPhotos(id), loadSummary()]);
    }
  };

  const fetchMissing = async (): Promise<void> => {
    setBusy(true);
    const r = await api.refreshMissing();
    setBusy(false);
    if (!r.ok) { say(r.error ?? 'That did not work.', true); return; }
    say(r.data ? `Started looking for photos for ${r.data} plant${r.data === 1 ? '' : 's'}. It runs in the background, about 4 seconds a plant. Reopen this list in a few minutes.` : 'Every plant has been looked up already.');
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Plant photo curator" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal curator">
        <div className="modal-head"><h2>Plant photos: curator</h2><button type="button" className="icon-btn" title="Close" onClick={close}><Icon name="close" size={16} /></button></div>
        <div className="curator-top">
          <p className="note">Photos arrive on their own from open-licence sources. Here you hide the wrong ones, say what each shows, and choose the three that a plant card shows first. Changes apply to everyone.</p>
          <button type="button" className="btn" disabled={busy} onClick={() => void fetchMissing()} data-testid="fetch-missing"><Icon name="download" size={15} /> Look up the plants not done yet</button>
        </div>
        {msg && <p className={`note${msg.bad ? ' warn' : ''}`} role="status" data-testid="curator-msg">{msg.text}</p>}
        <div className="curator-body">
          <div className="curator-list">
            <input className="search" type="search" placeholder="Find a plant" aria-label="Find a plant" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="vi-input" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <p className="note">{list.length} of {PLANTS.length} plants</p>
            <ul data-testid="curator-plants">
              {list.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`curator-plant${p.id === plantId ? ' on' : ''}`} onClick={() => setPlantId(p.id)} aria-pressed={p.id === plantId}>
                    <strong>{plantLabel(p)}</strong>
                    <span className="sub">{summaryText(summary.get(p.id))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="curator-main">
            {!plant && <p className="note">Choose a plant on the left.</p>}
            {plant && (
              <>
                <div className="curator-plant-head">
                  <div><h3>{plantLabel(plant)}</h3><em>{botanicalLabel(plant)}</em></div>
                  <button type="button" className="btn" disabled={busy} onClick={() => void refreshFromSources()} data-testid="curator-refresh">Look again</button>
                </div>
                {photos === null && <p className="note">Loading…</p>}
                {photos && photos.length === 0 && <p className="note">No photos stored for this plant yet. Press Look again to search the sources.</p>}
                <ul className="curator-photos" data-testid="curator-photos">
                  {(photos ?? []).map((ph) => (
                    <li key={ph.id} className={`curator-photo${ph.hidden ? ' hidden' : ''}`} data-testid="curator-photo">
                      <img src={ph.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      <div className="curator-photo-info">
                        <p className="credit">Photo: {ph.creator}, {ph.licenceUrl ? <a href={ph.licenceUrl} target="_blank" rel="noopener noreferrer">{ph.licenceCode}</a> : ph.licenceCode} via <a href={ph.sourceUrl} target="_blank" rel="noopener noreferrer">{ph.sourceLabel}</a></p>
                        {ph.displayOnly && <span className="tag">Share-alike: shown unedited</span>}
                        {ph.hidden && <span className="tag warn">Hidden{ph.hiddenReason === 'removed-or-relicensed' ? ': gone from its source, or no longer allowed' : ph.hiddenReason === 'curator' ? ' by a curator' : ''}</span>}
                        <label className="curator-role">Shows
                          <select className="vi-input" value={ph.role} disabled={busy} aria-label="What the photo shows" onChange={(e) => void act(() => api.role(plant.id, ph.id, e.target.value), 'Saved.')}>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        </label>
                        <div className="row">
                          {DEFAULTS.map(([role, label]) => {
                            const on = ph.defaultFor.includes(role);
                            return (
                              <button key={role} type="button" className={`btn${on ? ' primary' : ''}`} aria-pressed={on} disabled={busy || ph.hidden}
                                title={ph.hidden ? 'Show the photo first' : on ? `Stop using this as the first ${label.toLowerCase()} photo` : `Show this first as the ${label.toLowerCase()} photo`}
                                onClick={() => void act(() => api.setDefault(plant.id, role, on ? null : ph.id), on ? 'Default cleared.' : `Set as the ${label.toLowerCase()} photo.`)}>
                                {on ? '✓ ' : ''}{label}
                              </button>
                            );
                          })}
                          <button type="button" className={`btn${ph.hidden ? '' : ' danger'}`} disabled={busy} onClick={() => void act(() => api.hide(plant.id, ph.id, !ph.hidden), ph.hidden ? 'Photo shown again.' : 'Photo hidden.')}>{ph.hidden ? 'Show' : 'Hide'}</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
