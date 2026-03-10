import React from 'react';
import CodeBlock from '../components/CodeBlock';

/**
 * Shared ReactMarkdown component map used across chat, debate, and comparison pages.
 * Code blocks get the styled dark CodeBlock; inline code gets teal-on-navy styling.
 */
export const mdComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    if (!inline) {
      return (
        <CodeBlock
          language={match ? match[1] : null}
          code={String(children).replace(/\n$/, '')}
        />
      );
    }
    return (
      <code
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
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 pl-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 pl-4 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="list-disc">{children}</li>,
  h1: ({ children }) => <h1 className="text-base font-semibold mt-4 mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
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
