import { useEffect, useMemo, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import { getNavItemCatalog } from '../../config/appNavigation';
import api from '../../utils/apiClient';

const EMPTY_LAYOUT = {
  sets: [
    { id: 'set1', label: 'Apps', groups: [] },
    { id: 'set2', label: 'More', groups: [] },
  ],
};

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

function nextGroupId(layout) {
  const used = new Set(layout.sets.flatMap((s) => s.groups.map((g) => g.id)));
  let n = 1;
  while (used.has(`g${n}`)) n += 1;
  return `g${n}`;
}

/** Removes an item id from every group across both sets — used before re-adding
 * it somewhere else, so an item is never in two places at once. */
function removeItemEverywhere(layout, itemId) {
  layout.sets.forEach((set) => {
    set.groups.forEach((g) => { g.itemIds = g.itemIds.filter((id) => id !== itemId); });
  });
}

export default function NavLayoutEditor() {
  const getIcon = useIcon();
  const [layout, setLayout] = useState(null); // null = loading
  const [configured, setConfigured] = useState(false);
  const [newGroupLabel, setNewGroupLabel] = useState({}); // { [setId]: string }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const catalog = useMemo(() => getNavItemCatalog(), []);

  useEffect(() => {
    api.get('/api/settings/nav-layout')
      .then((res) => (res.ok ? res.json() : { navLayout: null }))
      .then((data) => {
        if (data.navLayout) {
          setLayout(data.navLayout);
          setConfigured(true);
        } else {
          setLayout(cloneLayout(EMPTY_LAYOUT));
          setConfigured(false);
        }
      })
      .catch(() => setLayout(cloneLayout(EMPTY_LAYOUT)));
  }, []);

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
      await api.post('/api/settings/nav-layout', { navLayout: layout });
      setConfigured(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      await api.post('/api/settings/nav-layout', { navLayout: null });
      setLayout(cloneLayout(EMPTY_LAYOUT));
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
        Splits the header "Apps" menu into two separate dropdown buttons for everyone. Drag apps from the pool below into groups in either set. {!configured && 'Nothing is split until you save — everyone currently sees the single Apps menu.'}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {layout.sets.map((set) => (
          <div key={set.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <input
              value={set.label}
              onChange={(e) => renameSet(set.id, e.target.value)}
              className="w-full mb-3 px-2 py-1.5 rounded-lg border text-sm font-semibold"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <div
              className="space-y-2.5"
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
          {saved ? 'Saved' : 'Save layout'}
        </button>
        {configured && !confirmReset && (
          <button
            type="button"
            className="text-xs hover:opacity-60"
            style={{ color: '#ef4444' }}
            onClick={() => setConfirmReset(true)}
          >
            Reset to single Apps menu
          </button>
        )}
        {confirmReset && (
          <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
            Discard this split and go back to one Apps menu for everyone?
            <button type="button" className="font-medium hover:opacity-60" style={{ color: '#ef4444' }} onClick={reset}>Yes</button>
            <button type="button" className="font-medium hover:opacity-60" onClick={() => setConfirmReset(false)}>No</button>
          </span>
        )}
      </div>
    </div>
  );
}
