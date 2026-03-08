import React from 'react';
import { useIcon } from '../../providers/IconProvider';

export default function TaskFilters({
  quickFilter,
  onSetQuickFilter,
  filterCategory,
  onSetFilterCategory,
  filterProject,
  onSetFilterProject,
  filterStatus,
  onSetFilterStatus,
  search,
  onSetSearch,
  sortBy,
  onSetSortBy,
  categories,
  projects,
  searchInputRef,
}) {
  const getIcon = useIcon();

  return (
    <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-6 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
      {[
        { key: 'all', label: 'All' },
        { key: 'today', label: 'Today' },
        { key: 'week', label: 'This Week' },
        { key: 'high', label: 'High Priority' },
        { key: 'overdue', label: 'Overdue' },
      ].map(f => (
        <button
          key={f.key}
          onClick={() => onSetQuickFilter(f.key)}
          className="px-3 py-1 rounded-lg text-xs font-medium border transition-all"
          style={{
            background: quickFilter === f.key ? 'var(--color-primary)' : 'transparent',
            borderColor: quickFilter === f.key ? 'var(--color-primary)' : 'var(--color-border)',
            color: quickFilter === f.key ? '#fff' : 'var(--color-muted)',
          }}
        >{f.label}</button>
      ))}

      <select value={filterCategory} onChange={e => onSetFilterCategory(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
        <option value="">All categories</option>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <select value={filterProject} onChange={e => onSetFilterProject(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
        <option value="">All projects</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      <select value={filterStatus} onChange={e => onSetFilterStatus(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
        <option value="active">To Do + In Progress</option>
        <option value="todo">To Do</option>
        <option value="in-progress">In Progress</option>
        <option value="done">Done</option>
        <option value="all">All</option>
      </select>

      <div className="relative flex-1 min-w-[160px]">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>{getIcon('search', { size: 12 })}</span>
        <input
          ref={searchInputRef}
          value={search}
          onChange={e => onSetSearch(e.target.value)}
          placeholder="Search tasks…"
          className="w-full pl-7 pr-3 py-1 rounded-lg border text-xs outline-none"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>

      <select value={sortBy} onChange={e => onSetSortBy(e.target.value)} className="text-xs px-2 py-1 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
        <option value="due">Sort: Due Date</option>
        <option value="priority">Sort: Priority</option>
        <option value="created">Sort: Created</option>
        <option value="az">Sort: A–Z</option>
        <option value="za">Sort: Z–A</option>
      </select>
    </div>
  );
}
