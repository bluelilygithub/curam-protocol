import React, { useId } from 'react';
import useDialogBehavior from '../hooks/useDialogBehavior';
import { useIcon } from '../providers/IconProvider';

// The one modal shell. Gives every dialog the same behaviour (role and name for screen readers, focus moves in and is trapped, Escape and a
// click on the dim background close it, the page behind stops scrolling, focus returns to the opener) and the same close button.
//
//   <Dialog title="How this works" onClose={close} footer={<button>Got it</button>}>...body...</Dialog>
//
// Props: title (heading + accessible name) · icon (node beside the title) · footer (node, right-aligned) · size 'sm'|'md'|'lg'|'xl'
// · surface 'bg'|'surface' (panel colour) · position 'center'|'top' · role 'dialog'|'alertdialog' · closeOnBackdrop · closeOnEscape · hideClose
// · bare (no header/footer: you draw the inside, and give it a name with `label` or `labelledBy`) · panelClassName · zIndex (Tailwind class, default z-50)
const SIZE = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' };

export default function Dialog({
  title, icon, footer, onClose, children,
  size = 'md', surface = 'bg', position = 'center', role = 'dialog',
  closeOnBackdrop = true, closeOnEscape = true, hideClose = false,
  bare = false, label, labelledBy, panelClassName = '', zIndex = 'z-50',
}) {
  const getIcon = useIcon();
  const titleId = useId();
  const panelRef = useDialogBehavior({ onClose, closeOnEscape });
  const named = bare ? { 'aria-labelledby': labelledBy, 'aria-label': labelledBy ? undefined : label } : { 'aria-labelledby': titleId };

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex justify-center p-4 ${position === 'top' ? 'items-start pt-16 sm:pt-24' : 'items-center'}`}
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        {...named}
        className={`w-full ${SIZE[size] || SIZE.md} rounded-2xl shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col ${panelClassName}`}
        style={{ background: surface === 'surface' ? 'var(--color-surface)' : 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        {bare ? children : (
          <>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-2 min-w-0">
                {icon}
                <h2 id={titleId} className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
              </div>
              {!hideClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="p-1 hover:opacity-60 transition-opacity duration-200 flex-shrink-0"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon('x', { size: 16 })}
                </button>
              )}
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
                {footer}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
