import React, { useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { searchGlossary } from './glossary.mjs';
import { GlossaryDiagram } from './GlossaryTerm';

/** Every glossary word with its explanation and drawing, with a search box. For when you want to look a word up rather than meet it in a sentence. */
export default function GlossaryList() {
  const [query, setQuery] = useState('');
  const list = searchGlossary(query);

  return (
    <section className="rounded-xl border p-4 flex flex-col gap-3 xl:col-span-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-tour="guitar-glossary">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Words guitarists use</h2>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        You will also see words with a dotted underline all over Guitar. Press one for a short explanation.
      </p>
      <Tooltip text={GT.glossSearch}>
        <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search the words" placeholder="Search, e.g. capo, barre, sus4"
          className="text-sm px-3 py-2 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
      </Tooltip>
      {list.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No word matches that. Try a shorter search.</p>}
      <div className="flex flex-col gap-2 xl:grid xl:grid-cols-2 2xl:grid-cols-3 xl:gap-3 xl:items-start">
        {list.map(g => (
          <div key={g.id} className="rounded-lg border p-3 flex gap-3 items-start" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{g.term}</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{g.short}</p>
            </div>
            {g.diagram && <div className="flex-shrink-0 hidden sm:block"><GlossaryDiagram diagram={g.diagram} /></div>}
          </div>
        ))}
      </div>
    </section>
  );
}
