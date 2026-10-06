import { useState } from 'react';
import { VoiceInput } from '@planner-core/speech/VoiceInput';
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL, PlaceLookupError, PRECISION_TEXT, type PlaceHit } from '../state/geocode';
import { useApp } from './AppContext';
import { Icon } from './icons';

/**
 * Find a street address. One search per press of the button (or Enter): never while typing, because OpenStreetMap's lookup service forbids
 * search-as-you-type. Each result says how exactly it is known (a house on a street, only a street, only a place), so nobody believes a pin
 * is on their house when it is only somewhere on their street. The address is sent to OpenStreetMap's lookup service only when this is pressed.
 */
export function AddressLookup({ initial = '', onPick, label = 'Find address' }: { initial?: string; onPick(hit: PlaceHit): void; label?: string }) {
  const app = useApp();
  const [text, setText] = useState(initial);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [searched, setSearched] = useState(false);

  const search = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setMsg(''); setHits([]); setSearched(false);
    try {
      const r = await app.places.search(text);
      setHits(r.results);
      setSearched(true);
      if (!r.results.length) setMsg('No address found. Check the spelling, add the suburb and state, or choose a suburb below.');
    } catch (e) {
      setMsg(e instanceof PlaceLookupError ? e.message : 'Could not look that up. Choose a suburb below instead.');
    }
    setBusy(false);
  };

  return (
    <div className="addr" data-testid="address-lookup">
      <label className="field">
        <span className="field-label">Street address of the garden</span>
        <div className="addr-row">
          <VoiceInput
            value={text} onChange={setText} placeholder="e.g. 12 Smith Street, Paddington QLD 4064" aria-label="Street address"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
          />
          <button type="button" className="btn primary" disabled={busy || text.trim().length < 3} onClick={() => void search()} data-testid="address-find">
            <Icon name="search" size={15} /> {busy ? 'Looking…' : label}
          </button>
        </div>
        <span className="field-hint">It searches only when you press the button. The address is sent to OpenStreetMap's lookup service for that search and is saved only in your garden.</span>
      </label>
      {msg && <p className="note" role="status" data-testid="address-msg">{msg}</p>}
      {hits.length > 0 && (
        <ul className="hits addr-hits" data-testid="address-hits">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lng},${h.address ?? h.label}`}>
              <button type="button" className="btn addr-hit" data-testid="address-hit" data-precision={h.precision} onClick={() => { onPick(h); setHits([]); }}>
                <strong>{h.address ?? h.label}</strong>
                <span className={`prec prec-${h.precision}`}>{PRECISION_TEXT[h.precision]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && hits.length > 0 && <p className="note osm" data-testid="address-attribution">Address details: <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer noopener">{OSM_ATTRIBUTION}</a></p>}
    </div>
  );
}
