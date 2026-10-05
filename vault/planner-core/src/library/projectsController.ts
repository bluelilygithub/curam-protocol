import { LibraryError, MAX_PROJECT_NAME, type BaseEntry, type ChosenLibrary, type ProjectLibrary, type StorageLike } from './library';
import type { LibraryStore } from './libraryStore';

/**
 * The open project and its library: which project is open, saving it (autosave after a pause, or now), and creating, opening,
 * renaming, duplicating and deleting projects. DOM-free: storage, timers and the library are passed in, so the whole save state
 * machine is tested in Node. It never touches design state except to load a whole project and to set the project's name.
 * Shared by Room Planner and Garden Planner.
 */
/** Quiet time after the last change before autosave. */
export const AUTOSAVE_MS = 1500;
/** Retry delay after a network failure. */
export const RETRY_MS = 15000;

/** The planner's project store, seen from the controller. */
export interface DocPort<P> {
  /** The whole project being edited, or null. */
  get(): P | null;
  /** Bumped on every change to the project. */
  revision(): number;
  subscribe(fn: () => void): () => void;
  /** Replace the project (clears undo history). */
  load(p: P): void;
  /** Set the project's name without making an undo step. */
  setName(name: string): void;
}

export interface ProjectsPorts<P, E extends BaseEntry> {
  doc: DocPort<P>;
  store: LibraryStore<E>;
  choose(): Promise<ChosenLibrary<P, E>>;
  storage: StorageLike;
  newId(): string;
  newEmpty(name: string): P;
  schedule(fn: () => void, ms: number): () => void;
  notify(text: string, severity?: 'info' | 'warn' | 'error'): void;
  /** Called after a project has been loaded into the editor (the app fits the view). */
  onLoaded?(): void;
  currentKey: string;
  dirtyKey: string;
  /** An independent copy under a new name and new ids. */
  clone(p: P, name: string): P;
  nameOf(p: P): string;
  withName(p: P, name: string): P;
  cleanName(raw: string, fallback: string, max: number): string;
  /** A project with nothing in it yet. */
  isEmpty(p: P): boolean;
  /** The draft the browser kept of the open project (for recovery after a session that ended unsaved). */
  loadDraft(): P | null;
}

export class ProjectsController<P, E extends BaseEntry> {
  private library: (ProjectLibrary<P, E> & { importLegacy?(): Promise<E | null> }) | null = null;
  private updatedAt: string | null = null;
  private cancelTimer: (() => void) | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;
  /** True while a project is being loaded programmatically, so that is not mistaken for an edit. */
  private loading = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly p: ProjectsPorts<P, E>) {}

  private get st() { return this.p.store.getState(); }
  private get doc(): P | null { return this.p.doc.get(); }

  // ------------------------------------------------------------------ start up

  /** Choose the library, load the list and open the last project (or the newest, or a fresh one). */
  async init(): Promise<void> {
    const revisionAtStart = this.p.doc.revision();
    const dirtyId = this.readDirty(); // before opening a project clears it
    this.st.set({ status: 'loading' });
    const chosen = await this.p.choose();
    this.library = chosen.library;
    this.st.set({ kind: chosen.library.kind, note: chosen.note });
    let entries: E[] = [];
    try {
      entries = await chosen.library.list();
      if (entries.length === 0 && chosen.library.importLegacy) {
        const imported = await chosen.library.importLegacy();
        if (imported) entries = [imported];
      }
    } catch (e) {
      this.fail(e);
    }
    this.st.set({ entries });

    // Edited before the library answered: keep that work as a new project rather than replacing it.
    if (this.p.doc.revision() !== revisionAtStart && this.doc && !this.p.isEmpty(this.doc)) {
      await this.adopt(this.doc);
      return;
    }

    let id = this.remembered();
    if (!entries.some((e) => e.id === id)) id = entries[0]?.id ?? null;
    if (!id) {
      await this.createAndOpen(this.p.newEmpty('Untitled project'));
    } else {
      await this.openLoaded(id);
      if (dirtyId === id) this.recoverDraft();
    }
    this.st.set({ ready: true });
  }

  /** Watch the project store: any change to the design marks the project unsaved and schedules an autosave. */
  attach(): () => void {
    let last = this.p.doc.revision();
    this.unsubscribe?.();
    this.unsubscribe = this.p.doc.subscribe(() => {
      const rev = this.p.doc.revision();
      if (rev === last) return;
      last = rev;
      this.changed();
    });
    return () => { this.unsubscribe?.(); this.unsubscribe = null; this.cancelTimer?.(); this.cancelTimer = null; };
  }

  // ------------------------------------------------------------------ saving

  private changed(): void {
    if (this.loading || !this.library || !this.st.currentId) return;
    this.setDirty(true);
    if (this.st.status === 'conflict') return; // paused until the owner chooses
    this.st.set({ status: 'unsaved', error: null });
    this.cancelTimer?.();
    this.cancelTimer = this.p.schedule(() => { void this.saveNow(); }, AUTOSAVE_MS);
  }

  /** Save the open project now (also what the Save button does). Resolves when saved or failed; never throws. */
  saveNow(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (!this.library || !this.st.currentId) return Promise.resolve();
    if (this.inFlight) { this.again = true; return this.inFlight; }
    this.inFlight = (async () => {
      do {
        this.again = false;
        await this.saveOnce();
      } while (this.again);
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async saveOnce(): Promise<void> {
    const library = this.library;
    const id = this.st.currentId;
    const document = this.doc;
    if (!library || !id || !document) return;
    const rev = this.p.doc.revision();
    this.st.set({ status: 'saving', error: null });
    try {
      const entry = await library.save(id, document, this.updatedAt ?? undefined);
      this.updatedAt = entry.updatedAt;
      this.replaceEntry(entry);
      const unchanged = this.p.doc.revision() === rev;
      this.st.set({ status: unchanged ? 'saved' : 'unsaved', lastSavedAt: entry.updatedAt, error: null });
      if (unchanged) this.setDirty(false);
      else { this.again = false; this.cancelTimer = this.p.schedule(() => { void this.saveNow(); }, AUTOSAVE_MS); }
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    const err = e instanceof LibraryError ? e : new LibraryError('network', 'Could not save the project.');
    if (err.code === 'conflict') {
      this.st.set({ status: 'conflict', error: 'This project was changed in another window or tab. Choose which version to keep.' });
      return;
    }
    this.st.set({ status: 'error', error: err.message });
    if (err.code === 'network') this.cancelTimer = this.p.schedule(() => { void this.saveNow(); }, RETRY_MS);
  }

  // ------------------------------------------------------------------ conflict

  /** Throw away what is open and take the saved version. */
  async reloadTheirs(): Promise<void> {
    const id = this.st.currentId;
    if (!id) return;
    await this.openLoaded(id);
  }

  /** Keep what is open and save over the other version. */
  async overwriteMine(): Promise<void> {
    const id = this.st.currentId;
    if (!id || !this.library) return;
    try {
      const latest = (await this.library.list()).find((e) => e.id === id);
      this.updatedAt = latest?.updatedAt ?? null;
    } catch (e) { this.fail(e); return; }
    this.st.set({ status: 'unsaved', error: null });
    await this.saveNow();
  }

  // ------------------------------------------------------------------ actions

  /** Save pending changes before switching to another project. */
  private async flush(): Promise<boolean> {
    if (this.st.status === 'unsaved' || this.st.status === 'error' || this.cancelTimer) await this.saveNow();
    if (this.st.status === 'conflict' || this.st.status === 'error') {
      this.p.notify('Resolve the save problem first, so the open project is not lost.', 'warn');
      return false;
    }
    return true;
  }

  async newProject(name?: string): Promise<void> {
    if (!(await this.flush())) return;
    await this.createAndOpen(this.p.newEmpty(this.p.cleanName(name ?? '', 'Untitled project', MAX_PROJECT_NAME)));
  }

  async open(id: string): Promise<void> {
    if (id === this.st.currentId) return;
    if (!(await this.flush())) return;
    await this.openLoaded(id);
  }

  async rename(id: string, name: string): Promise<void> {
    if (!this.library) return;
    try {
      const entry = await this.library.rename(id, name);
      this.replaceEntry(entry);
      if (id === this.st.currentId) {
        this.updatedAt = entry.updatedAt;
        this.loading = true; // the rename is already saved; it must not look like an unsaved edit
        try { this.p.doc.setName(entry.name); } finally { this.loading = false; }
      }
    } catch (e) { this.report(e); }
  }

  async duplicate(id: string): Promise<void> {
    if (!this.library) return;
    try {
      const source = id === this.st.currentId && this.doc ? this.doc : (await this.library.load(id)).project;
      const copy = this.p.clone(source, this.p.cleanName(`${this.p.nameOf(source)} (copy)`, 'Untitled project', MAX_PROJECT_NAME));
      const entry = await this.library.create(copy);
      this.st.set({ entries: [...this.st.entries, entry].sort(newest) });
    } catch (e) { this.report(e); }
  }

  async remove(id: string): Promise<void> {
    if (!this.library) return;
    try {
      await this.library.remove(id);
    } catch (e) { this.report(e); return; }
    const entries = this.st.entries.filter((e) => e.id !== id);
    this.st.set({ entries });
    if (id !== this.st.currentId) return;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.setDirty(false);
    this.st.set({ currentId: null, status: 'saved', error: null });
    if (entries[0]) await this.openLoaded(entries[0].id);
    else await this.createAndOpen(this.p.newEmpty('Untitled project'));
  }

  /** Add a project from a file and open it. */
  async importProject(project: P): Promise<void> {
    if (!(await this.flush())) return;
    await this.createAndOpen(project);
  }

  async refresh(): Promise<void> {
    if (!this.library) return;
    try { this.st.set({ entries: await this.library.list() }); } catch (e) { this.report(e); }
  }

  // ------------------------------------------------------------------ internals

  private remembered(): string | null {
    try { return this.p.storage.getItem(this.p.currentKey); } catch { return null; }
  }

  private setDirty(on: boolean): void {
    try {
      if (on && this.st.currentId) this.p.storage.setItem(this.p.dirtyKey, this.st.currentId);
      else this.p.storage.removeItem(this.p.dirtyKey);
    } catch { /* the draft is a convenience */ }
  }

  private replaceEntry(entry: E): void {
    const entries = this.st.entries.some((e) => e.id === entry.id)
      ? this.st.entries.map((e) => (e.id === entry.id ? entry : e))
      : [...this.st.entries, entry];
    this.st.set({ entries: entries.sort(newest) });
  }

  private report(e: unknown): void {
    this.p.notify(e instanceof LibraryError ? e.message : 'Something went wrong with the project library.', 'error');
  }

  /** Put a loaded project into the editor and make it the open one. */
  private show(project: P, entry: E): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.loading = true;
    try { this.p.doc.load(project); } finally { this.loading = false; }
    this.updatedAt = entry.updatedAt;
    try { this.p.storage.setItem(this.p.currentKey, entry.id); } catch { /* ignore */ }
    this.setDirty(false);
    this.st.set({ currentId: entry.id, status: 'saved', error: null, lastSavedAt: entry.updatedAt });
    this.p.onLoaded?.();
  }

  private async openLoaded(id: string): Promise<void> {
    if (!this.library) return;
    try {
      const { project, entry } = await this.library.load(id);
      this.replaceEntry(entry);
      this.show(project, entry);
    } catch (e) {
      this.report(e);
      if (e instanceof LibraryError && e.code === 'not_found') {
        const entries = this.st.entries.filter((x) => x.id !== id);
        this.st.set({ entries });
        if (entries[0] && entries[0].id !== id) await this.openLoaded(entries[0].id);
      }
    }
  }

  private async createAndOpen(project: P): Promise<void> {
    if (!this.library) return;
    try {
      const entry = await this.library.create(project);
      this.replaceEntry(entry);
      this.show(this.p.withName(project, entry.name), entry);
    } catch (e) { this.fail(e); }
  }

  /** Make the project already in the editor a library entry and keep editing it. */
  private async adopt(project: P): Promise<void> {
    if (!this.library) return;
    try {
      const entry = await this.library.create(project);
      this.replaceEntry(entry);
      this.updatedAt = entry.updatedAt;
      try { this.p.storage.setItem(this.p.currentKey, entry.id); } catch { /* ignore */ }
      this.st.set({ currentId: entry.id, status: 'saved', error: null, ready: true, lastSavedAt: entry.updatedAt });
    } catch (e) { this.fail(e); }
  }

  private readDirty(): string | null {
    try { return this.p.storage.getItem(this.p.dirtyKey); } catch { return null; }
  }

  /** The last session ended with unsaved changes to this project: the browser still has them, so take them and save. */
  private recoverDraft(): void {
    const draft = this.p.loadDraft();
    if (!draft) return;
    const keep = this.doc ? this.p.nameOf(this.doc) : this.p.nameOf(draft);
    this.loading = true;
    try { this.p.doc.load(this.p.withName(draft, keep)); } finally { this.loading = false; }
    this.p.notify('Restored your unsaved changes from this browser.', 'info');
    this.p.onLoaded?.();
    this.changed();
  }
}

const newest = (a: BaseEntry, b: BaseEntry): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1);
