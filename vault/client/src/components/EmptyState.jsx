import React from 'react';
import { useIcon } from '../providers/IconProvider';

// What a list or page says when there is nothing in it yet: what it is for, and the one thing to do next. Use this instead of a bare "No items".
//   <EmptyState icon="inbox" title="No invoices yet" body="Invoices you create appear here." action={<button ...>New invoice</button>} />
export default function EmptyState({ icon, title, body, action, className = '' }) {
  const getIcon = useIcon();
  return (
    <div className={`flex flex-col items-center text-center px-6 py-10 ${className}`}>
      {icon && <div className="mb-3" style={{ color: 'var(--color-muted)' }}>{getIcon(icon, { size: 28 })}</div>}
      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
      {body && <p className="text-sm mt-1 max-w-sm" style={{ color: 'var(--color-muted)' }}>{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
