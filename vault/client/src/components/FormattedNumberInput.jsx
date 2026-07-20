import React, { useRef } from 'react';
import { formatThousands } from '../utils/numericInput';

/**
 * Text input that inserts thousand separators while typing.
 * Passes the formatted string to onChange; parse with parseFormattedNumber when submitting.
 */
export default function FormattedNumberInput({
  value,
  onChange,
  allowDecimals = false,
  maxDecimals = 2,
  style,
  className,
  ...rest
}) {
  const inputRef = useRef(null);

  function handleChange(e) {
    const el = e.target;
    const prev = el.value;
    const caret = el.selectionStart ?? prev.length;
    const digitsLeft = prev.slice(0, caret).replace(/[^\d]/g, '').length;

    const next = formatThousands(prev, { allowDecimals, maxDecimals });
    onChange(next);

    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      let pos = 0;
      let seen = 0;
      while (pos < next.length && seen < digitsLeft) {
        if (/\d/.test(next[pos])) seen += 1;
        pos += 1;
      }
      // If user typed a trailing decimal, keep caret after it
      if (allowDecimals && next.endsWith('.') && prev.endsWith('.')) {
        pos = next.length;
      }
      try {
        node.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    });
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={allowDecimals ? 'decimal' : 'numeric'}
      value={value ?? ''}
      onChange={handleChange}
      style={style}
      className={className}
      {...rest}
    />
  );
}
