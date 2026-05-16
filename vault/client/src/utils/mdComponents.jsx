import React from 'react';
import CodeBlock from '../components/CodeBlock';

/**
 * Shared ReactMarkdown component map used across chat, debate, and comparison pages.
 * Code blocks get the styled dark CodeBlock; inline code gets teal-on-navy styling.
 */
export const mdComponents = {
  // react-markdown v9 removed the `inline` prop — detect block vs inline via className / newlines
  pre: ({ children }) => <>{children}</>,
  code({ node, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const isBlock = match || String(children).includes('\n');
    if (isBlock) {
      return (
        <CodeBlock
          language={match ? match[1] : null}
          code={String(children).replace(/\n$/, '')}
        />
      );
    }
    return (
      <code
        className="not-prose"
        style={{
          background: 'rgba(27, 58, 92, 0.12)',
          color: '#0D7B8A',
          borderRadius: '4px',
          padding: '2px 6px',
          fontFamily: 'monospace',
          fontSize: '0.9em',
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  p: ({ children }) => <p className="mb-3.5 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 pl-5 space-y-1.5 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 pl-5 space-y-1.5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-lg font-semibold mt-6 mb-3 first:mt-0" style={{ color: 'var(--color-text)' }}>{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold mt-5 mb-2.5 first:mt-0" style={{ color: 'var(--color-text)' }}>{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-4 mb-2 first:mt-0" style={{ color: 'var(--color-text)' }}>{children}</h3>,
  strong: ({ children }) => <strong className="font-semibold" style={{ color: 'var(--color-text)' }}>{children}</strong>,
  em: ({ children }) => <em className="italic" style={{ color: 'var(--color-text)' }}>{children}</em>,
  hr: () => <hr className="my-6 border-0 border-t" style={{ borderColor: 'var(--color-border)' }} />,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0.75em 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875em' }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ borderBottom: '2px solid var(--color-border)' }}>{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>{children}</tr>
  ),
  th: ({ children }) => (
    <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ padding: '6px 12px', color: 'var(--color-text)', verticalAlign: 'top' }}>
      {children}
    </td>
  ),
  blockquote: ({ children }) => (
    <blockquote
      className="border-l-2 pl-3 my-2"
      style={{ borderColor: 'var(--color-primary)', color: 'var(--color-muted)' }}
    >
      {children}
    </blockquote>
  ),
  a: ({ href, children, ...props }) => {
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
    return (
      <a href={href} {...(isExternal && { target: '_blank', rel: 'noopener noreferrer' })} {...props}>
        {children}
      </a>
    );
  },
};
