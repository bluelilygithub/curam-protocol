import { createStore, type StoreApi } from 'zustand/vanilla';
import { readVaultToken, type ReadableStorage } from '@planner-core/library/library';
import { projectFromCode } from '../ui/CodeModal';
import { applyRackType, defaultType, type Catalogue } from './catalogue';
import type { AppProject } from './model';

// Website enquiries ("leads") from the CRM side of Vault (server/routes/cellarLeadsRouter.js). A visitor sends the website's contact form with a
// design from the public planner; Vault files them in the CRM and keeps the design. Staff see the list here and open any enquiry as a new design,
// which starts from the visitor's room, door and racks with the catalogue's default rack type, linked back to the enquiry so a quote can be logged.

export const LEADS_URL = '/api/cellar-planner/leads';

export interface Lead {
  id: number; name: string; email: string; phone: string | null; summary: string | null; priceText: string | null; bottles: number | null;
  status: 'new' | 'opened' | 'quoted'; clientId: number | null; dealId: number | null; createdAt: string;
  /** Only on a single read. */
  message?: string | null; code?: string;
}
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
type Storage = ReadableStorage;

const log = (...a: unknown[]): void => { try { console.info('[cellar-leads]', ...a); } catch { /* no console */ } };

const isStatus = (v: unknown): v is Lead['status'] => v === 'new' || v === 'opened' || v === 'quoted';
/** Never trusts the network: a row that is not shaped like an enquiry is dropped. */
export function parseLead(raw: unknown): Lead | null {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!o || !Number.isInteger(o.id) || (o.id as number) < 1 || typeof o.name !== 'string' || typeof o.email !== 'string' || !isStatus(o.status)) return null;
  const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const created = typeof o.createdAt === 'string' && !Number.isNaN(Date.parse(o.createdAt)) ? o.createdAt : new Date(0).toISOString();
  return {
    id: o.id as number, name: o.name.slice(0, 100), email: o.email.slice(0, 254), phone: s(o.phone), summary: s(o.summary), priceText: s(o.priceText), bottles: n(o.bottles),
    status: o.status, clientId: n(o.clientId), dealId: n(o.dealId), createdAt: created,
    ...('message' in o ? { message: s(o.message) } : {}), ...(typeof o.code === 'string' ? { code: o.code } : {}),
  };
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One authenticated request to Vault. Never throws: the reason comes back in plain words. */
async function request(fetchFn: FetchFn | undefined, storage: Storage, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Result<unknown>> {
  const token = readVaultToken(storage);
  if (!fetchFn) return { ok: false, reason: 'this browser cannot make the request' };
  if (!token) return { ok: false, reason: 'you are not signed in to Vault' };
  try {
    const res = await fetchFn(`${LEADS_URL}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 404) return { ok: false, reason: 'that enquiry was not found (it may belong to another account)' };
    if (res.status === 403) return { ok: false, reason: 'your Vault account does not have the Cellar Planner feature' };
    if (!res.ok) return { ok: false, reason: `Vault answered ${res.status}` };
    return { ok: true, value: await res.json() };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type LeadsStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export interface LeadsState {
  leads: Lead[]; status: LeadsStatus; reason: string;
  load(fetchFn: FetchFn | undefined, storage: Storage): Promise<void>;
}
export type LeadsStore = StoreApi<LeadsState>;

export function createLeadsStore(): LeadsStore {
  return createStore<LeadsState>((set) => ({
    leads: [], status: 'idle', reason: '',
    async load(fetchFn, storage) {
      set({ status: 'loading', reason: '' });
      const r = await request(fetchFn, storage, 'GET', '');
      if (!r.ok) { log('could not load the enquiries:', r.reason); set({ status: 'unavailable', reason: r.reason }); return; }
      const list = (r.value as { leads?: unknown } | null)?.leads;
      if (!Array.isArray(list)) { log('Vault sent something that is not a list of enquiries'); set({ status: 'unavailable', reason: 'Vault sent something that is not a list of enquiries' }); return; }
      const leads = list.map(parseLead).filter((l): l is Lead => l !== null);
      log('enquiries loaded:', leads.length, '| new:', leads.filter((l) => l.status === 'new').length);
      set({ leads, status: 'ready', reason: '' });
    },
  }));
}

export async function fetchLead(fetchFn: FetchFn | undefined, storage: Storage, id: number): Promise<Result<Lead>> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, reason: 'that is not an enquiry number' };
  const r = await request(fetchFn, storage, 'GET', `/${id}`);
  if (!r.ok) return r;
  const lead = parseLead((r.value as { lead?: unknown } | null)?.lead);
  if (!lead || !lead.code) return { ok: false, reason: 'Vault sent something that is not an enquiry' };
  return { ok: true, value: lead };
}

export async function markOpened(fetchFn: FetchFn | undefined, storage: Storage, id: number): Promise<void> {
  const r = await request(fetchFn, storage, 'POST', `/${id}/opened`, {});
  if (!r.ok) log('could not mark the enquiry opened (the design is open anyway):', r.reason);
}

export interface QuoteLog { total: number; text: string; reference: string }
/** Tell Vault a quote was made: status quoted, a CRM timeline note, and the deal value filled in if it had none. */
export async function logQuote(fetchFn: FetchFn | undefined, storage: Storage, id: number, q: QuoteLog): Promise<Result<{ valueSet: boolean }>> {
  const r = await request(fetchFn, storage, 'POST', `/${id}/quote`, q);
  if (!r.ok) return r;
  return { ok: true, value: { valueSet: (r.value as { valueSet?: unknown } | null)?.valueSet === true } };
}

/**
 * The design an enquiry stands for: the visitor's room, door and rack runs from their design code, with the catalogue's default rack type, named for
 * them, linked to the enquiry and with the client's name ready for the drawing package and the quote. A reason in plain words when it cannot be made.
 */
export function projectFromLead(lead: Lead, cat: Catalogue | null): { project: AppProject } | { error: string } {
  if (!lead.code) return { error: 'This enquiry has no design.' };
  const r = projectFromCode(lead.code);
  if ('error' in r) return r;
  let project: AppProject = { ...r.project, name: `Enquiry: ${lead.name}`.slice(0, 100), lead: { id: lead.id, name: lead.name }, drawing: { company: '', client: lead.name, address: '', projectNo: '', drawnBy: '', checkedBy: '' } };
  const t = defaultType(cat);
  if (t) project = applyRackType(project, t);
  return { project };
}

/** Open an enquiry as a new design. Returns a plain-words message either way. */
export async function openLeadDesign(p: {
  id: number; fetchFn: FetchFn | undefined; storage: Storage; catalogue: Catalogue | null;
  importProject(project: AppProject): Promise<void>;
}): Promise<{ ok: boolean; message: string }> {
  const got = await fetchLead(p.fetchFn, p.storage, p.id);
  if (!got.ok) return { ok: false, message: `Could not open the enquiry: ${got.reason}.` };
  const made = projectFromLead(got.value, p.catalogue);
  if ('error' in made) return { ok: false, message: `Could not open the enquiry: ${made.error}` };
  await p.importProject(made.project);
  void markOpened(p.fetchFn, p.storage, p.id);
  const note = p.catalogue ? '' : ' The rack catalogue is not loaded, so the racks are best guesses.';
  return { ok: true, message: `Opened the enquiry from ${got.value.name} as a new design.${note}` };
}
