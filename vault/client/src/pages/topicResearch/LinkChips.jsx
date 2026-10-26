import React from 'react';
import { useNavigate } from 'react-router-dom';

// Who a topic (and so its briefs and drafts) is for, as small links to the Client and Project pages. Nothing is shown when it is for no one.
// `link` = { client: { id, name, viaProject }, project: { id, name } } as the server sends it. A client that only comes from the project says so.
export default function LinkChips({ link, className = '' }) {
  const navigate = useNavigate();
  if (!link || (!link.client && !link.project)) return null;
  const chip = 'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full hover:opacity-70 transition-opacity';
  const style = { border: '1px solid var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' };
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`} data-guide="linkchips">
      {link.client && (
        <a href={`/clients/${link.client.id}`} onClick={(e) => { e.preventDefault(); navigate(`/clients/${link.client.id}`); }} className={chip} style={style}
          title={link.client.viaProject ? 'This client comes from the project' : 'Open this client'}>
          Client: {link.client.name}{link.client.viaProject ? ' (via project)' : ''}
        </a>
      )}
      {link.project && (
        <a href={`/projects/${link.project.id}`} onClick={(e) => { e.preventDefault(); navigate(`/projects/${link.project.id}`); }} className={chip} style={style} title="Open this project">
          Project: {link.project.name}
        </a>
      )}
    </span>
  );
}
