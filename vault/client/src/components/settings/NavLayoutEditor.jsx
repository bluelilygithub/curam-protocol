import { useEffect, useMemo, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import { getNavItemCatalog } from '../../config/appNavigation';
import api from '../../utils/apiClient';

const EMPTY_LAYOUT = {
  sets: [
    { id: 'set1', label: 'Apps', groups: [] },
    { id: 'set2', label: 'More', groups: [] },
    { id: 'set3', label: 'Tools', groups: [] },
    { id: 'set4', label: 'Extras', groups: [] },
    { id: 'set5', label: 'Other', groups: [] },
  ],
};

const DEFAULT_SET_LABELS = { 2: 'More', 3: 'Tools', 4: 'Extras', 5: 'Other' };

// The Home tiles are one set of groups (server/utils/homeTiles.js).
const EMPTY_HOME = { sets: [{ id: 'home', label: 'Home', groups: [] }] };
const emptyLayout = (setCount) => cloneLayout(setCount === 1 ? EMPTY_HOME : EMPTY_LAYOUT);

/** A layout saved with fewer than five sets gets empty ones to fill (an empty set shows no button). */
function withSets(layout, setCount) {
  const next = cloneLayout(layout);
  while (next.sets.length < setCount) {
    const n = next.sets.length + 1;
    next.sets.push({ id: `set${n}`, label: DEFAULT_SET_LABELS[n] || 'More', groups: [] });
  }
  return next;
}

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

function nextGroupId(layout) {
  const used = new Set(layout.sets.flatMap((s) => s.groups.map((g) => g.id)));
  let n = 1;
  while (used.has(`g${n}`)) n += 1;
  return `g${n}`;
}

/** Removes an item id from every group across all sets — used before re-adding
 * it somewhere else, so an item is never in two places at once. */
function removeItemEverywhere(layout, itemId) {
  layout.sets.forEach((set) => {
    set.groups.forEach((g) => { g.itemIds = g.itemIds.filter((id) => id !== itemId); });
  });
}

/**
 * Drag apps into named groups and order them. By default it arranges the header Apps menu (up to five dropdown sets); with
 * endpoint="/api/settings/home-tiles", field="homeTiles" and setCount={1} it arranges the Home page tiles. `children` go beside Save.
 */
export default function NavLayoutEditor({
  endpoint = '/api/settings/nav-layout', field = 'navLayout', setCount = 5, intro, notSetUp,
  saveLabel = 'Save layout', resetLabel = 'Reset to single Apps menu', resetConfirm = 'Discard this split and go back to one Apps menu for everyone?', children,
}) {
  const getIcon = useIcon();
  const [layout, setLayout] = useState(null); // null = loading
  const [configured, setConfigured] = useState(false);
  const [newGroupLabel, setNewGroupLabel] = useState({}); // { [setId]: string }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState('');

  const catalog = useMemo(() => getNavItemCatalog(), []);

  useEffect(() => {
    api.get(endpoint)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (data[field]) {
          setLayout(withSets(data[field], setCount));
          setConfigured(true);
        } else {
          setLayout(emptyLayout(setCount));
          setConfigured(false);
        }
      })
      .catch(() => setLayout(emptyLayout(setCount)));
  }, [endpoint, field, setCount]);

  if (!layout) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  }

  const placedIds = new Set(layout.sets.flatMap((s) => s.groups.flatMap((g) => g.itemIds)));
  const poolItems = Object.values(catalog).filter((item) => !placedIds.has(item.id));
  const poolByGroup = {};
  poolItems.forEach((item) => {
    (poolByGroup[item.defaultGroupLabel] ||= []).push(item);
  });

  function update(fn) {
    setLayout((prev) => {
      const next = cloneLayout(prev);
      fn(next);
      return next;
    });
    setSaved(false);
  }

  function moveItemToGroup(itemId, setId, groupId, beforeItemId = null) {
    update((next) => {
      removeItemEverywhere(next, itemId);
      const group = next.sets.find((s) => s.id === setId).groups.find((g) => g.id === groupId);
      if (!group) return;
      const at = beforeItemId ? group.itemIds.indexOf(beforeItemId) : -1;
      if (at === -1) group.itemIds.push(itemId);
      else group.itemIds.splice(at, 0, itemId);
    });
  }

  function moveItemToPool(itemId) {
    update((next) => removeItemEverywhere(next, itemId));
  }

  function moveGroup(groupId, targetSetId, beforeGroupId = null) {
    update((next) => {
      let group = null;
      next.sets.forEach((s) => {
        const idx = s.groups.findIndex((g) => g.id === groupId);
        if (idx !== -1) { [group] = s.groups.splice(idx, 1); }
      });
      if (!group) return;
      const targetSet = next.sets.find((s) => s.id === targetSetId);
      const at = beforeGroupId ? targetSet.groups.findIndex((g) => g.id === beforeGroupId) : -1;
      if (at === -1) targetSet.groups.push(group);
      else targetSet.groups.splice(at, 0, group);
    });
  }

  function addGroup(setId) {
    const label = (newGroupLabel[setId] || '').trim();
    if (!label) return;
    update((next) => {
      const set = next.sets.find((s) => s.id === setId);
      set.groups.push({ id: nextGroupId(next), label, itemIds: [] });
    });
    setNewGroupLabel((prev) => ({ ...prev, [setId]: '' }));
  }

  function renameGroup(setId, groupId, label) {
    update((next) => {
      const group = next.sets.find((s) => s.id === setId).groups.find((g) => g.id === groupId);
      group.label = label;
    });
  }

  function deleteGroup(setId, groupId) {
    update((next) => {
      const set = next.sets.find((s) => s.id === setId);
      set.groups = set.groups.filter((g) => g.id !== groupId);
    });
  }

  function renameSet(setId, label) {
    update((next) => { next.sets.find((s) => s.id === setId).label = label; });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api.post(endpoint, { [field]: layout });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      setConfigured(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await api.post(endpoint, { [field]: null });
      setLayout(emptyLayout(setCount));
      setConfigured(false);
      setConfirmReset(false);
    } finally {
      setSaving(false);
    }
  }

  function onDragStartItem(e, itemId) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'item', id: itemId }));
  }
  function onDragStartGroup(e, groupId) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'group', id: groupId }));
  }
  function readPayload(e) {
    try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; }
  }
  // Dropped directly on an item chip — insert the dragged item just before it
  // (reordering within the group, or moving in from elsewhere at that exact spot).
  function onDropOnItem(e, setId, groupId, targetItemId) {
    e.preventDefault();
    e.stopPropagation();
    const payload = readPayload(e);
    if (payload?.type === 'item' && payload.id !== targetItemId) moveItemToGroup(payload.id, setId, groupId, targetItemId);
  }
  // Dropped on the group's item area but not on a specific chip — append to the end.
  function onDropOnGroupBody(e, setId, groupId) {
    e.preventDefault();
    e.stopPropagation();
    const payload = readPayload(e);
    if (payload?.type === 'item') moveItemToGroup(payload.id, setId, groupId);
  }
  // Dropped on another group's header — reorder groups (insert dragged group before this one).
  function onDropOnGroupHeader(e, setId, groupId) {
    e.preventDefault();
    e.stopPropagation();
    const payload = readPayload(e);
    if (payload?.type === 'group' && payload.id !== groupId) moveGroup(payload.id, setId, groupId);
    else if (payload?.type === 'item') moveItemToGroup(payload.id, setId, groupId);
  }
  // Dropped on empty space below the last group in a set — append group to the end of that set.
  function onDropOnSetTail(e, setId) {
    e.preventDefault();
    const payload = readPayload(e);
    if (payload?.type === 'group') moveGroup(payload.id, setId);
  }
  function onDropOnPool(e) {
    e.preventDefault();
    const payload = readPayload(e);
    if (payload?.type === 'item') moveItemToPool(payload.id);
  }

  return (
    <div>
      <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
        {intro ?? 'Splits the header "Apps" menu into up to five separate dropdown buttons for everyone. Drag apps from the pool below into groups in any set; a set with no groups shows no button.'}{' '}
        {!configured && (notSetUp ?? 'Nothing is split until you save — everyone currently sees the single Apps menu.')}
      </p>

      <div className={setCount === 1 ? 'mb-5' : 'grid grid-cols-1 lg:grid-cols-3 2xl:grid-cols-5 gap-4 mb-5'}>
        {layout.sets.map((set) => (
          <div key={set.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            {setCount > 1 && <input
              value={set.label}
              onChange={(e) => renameSet(set.id, e.target.value)}
              className="w-full mb-3 px-2 py-1.5 rounded-lg border text-sm font-semibold"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />}
            <div
              className={setCount === 1 ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5' : 'space-y-2.5'}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropOnSetTail(e, set.id)}
            >
              {set.groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-lg border p-2"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDropOnGroupBody(e, set.id, group.id)}
                >
                  <div
                    className="flex items-center gap-1.5 mb-1.5"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDropOnGroupHeader(e, set.id, group.id)}
                  >
                    <span
                      draggable
                      onDragStart={(e) => onDragStartGroup(e, group.id)}
                      title="Drag to reorder this group"
                      className="flex-none cursor-grab active:cursor-grabbing"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {getIcon('grip-vertical', { size: 13 })}
                    </span>
                    <input
                      value={group.label}
                      onChange={(e) => renameGroup(set.id, group.id, e.target.value)}
                      className="flex-1 min-w-0 px-1.5 py-1 rounded text-xs font-semibold uppercase tracking-wide"
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)' }}
                    />
                    <button
                      type="button"
                      title="Delete group"
                      className="flex-none hover:opacity-60"
                      style={{ color: '#ef4444' }}
                      onClick={() => deleteGroup(set.id, group.id)}
                    >
                      {getIcon('trash', { size: 13 })}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                    {group.itemIds.length === 0 && (
                      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Drop apps here</p>
                    )}
                    {group.itemIds.map((id) => catalog[id] && (
                      <span
                        key={id}
                        draggable
                        onDragStart={(e) => onDragStartItem(e, id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onDropOnItem(e, set.id, group.id, id)}
                        title="Drag to reorder"
                        className="text-xs px-2 py-1 rounded-md border cursor-grab active:cursor-grabbing flex items-center gap-1"
                        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                      >
                        {getIcon(catalog[id].icon, { size: 11 })} {catalog[id].label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex gap-1.5">
                <input
                  value={newGroupLabel[set.id] || ''}
                  onChange={(e) => setNewGroupLabel((prev) => ({ ...prev, [set.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addGroup(set.id)}
                  placeholder="New group name"
                  className="flex-1 px-2 py-1.5 rounded-lg border text-xs"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <button
                  type="button"
                  className="text-xs px-2.5 py-1.5 rounded-lg border hover:opacity-60"
                  style={{ borderColor: 'var(--color-border)' }}
                  onClick={() => addGroup(set.id)}
                >
                  + Add
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        className="rounded-xl border p-3 mb-4"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropOnPool}
      >
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-muted)' }}>
          Unplaced apps (drag into a group above)
        </p>
        {poolItems.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Every app is placed in a group.</p>
        ) : (
          Object.entries(poolByGroup).map(([label, items]) => (
            <div key={label} className="mb-2 last:mb-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
              <div className="flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <span
                    key={item.id}
                    draggable
                    onDragStart={(e) => onDragStartItem(e, item.id)}
                    className="text-xs px-2 py-1 rounded-md border cursor-grab active:cursor-grabbing flex items-center gap-1"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                  >
                    {getIcon(item.icon, { size: 11 })} {item.label}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-70 disabled:opacity-40"
          style={{ background: 'var(--color-text)', color: 'var(--color-bg)' }}
        >
          {saved ? 'Saved' : saveLabel}
        </button>
        {configured && !confirmReset && (
          <button
            type="button"
            className="text-xs hover:opacity-60"
            style={{ color: '#ef4444' }}
            onClick={() => setConfirmReset(true)}
          >
            {resetLabel}
          </button>
        )}
        {confirmReset && (
          <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
            {resetConfirm}
            <button type="button" className="font-medium hover:opacity-60" style={{ color: '#ef4444' }} onClick={reset}>Yes</button>
            <button type="button" className="font-medium hover:opacity-60" onClick={() => setConfirmReset(false)}>No</button>
          </span>
        )}
        {children}
        {error && <span className="text-xs" role="alert" style={{ color: '#ef4444' }}>{error}</span>}
      </div>
    </div>
  );
}
