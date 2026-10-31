import React, { useEffect, useRef } from 'react';
import { attachDialogBehavior } from '../hooks/useDialogBehavior';

// Drop-in for a modal written inline inside a big page, where its own component or a hook is not practical:
//
//   <div className="fixed inset-0 z-50 flex items-center justify-center ...">   <- the dim overlay
//     <DialogGuard />                                                            <- first child, draws nothing
//     <div className="...panel...">...</div>                                     <- the panel
//   </div>
//
// It finds the panel (the overlay's first visible child) and gives it what <Dialog> gives: role="dialog" + aria-modal + a name (its first
// heading, or "Dialog"), focus moved in and trapped, page scroll locked, focus returned to the opener. Escape does exactly what clicking the
// dim background does (a modal that ignores the background click, such as a blocking prompt, also ignores Escape) and other Escape
// handlers still run. Prefer <Dialog> for anything new.
let guardCount = 0;

export default function DialogGuard() {
  const markerRef = useRef(null);
  // Read while rendering: an autoFocus input in the panel takes focus before effects run.
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    const marker = markerRef.current;
    const overlay = marker?.parentElement;
    if (!overlay) return undefined;
    const panel = Array.from(overlay.children).find((c) => c !== marker && c.getClientRects().length > 0)
      || Array.from(overlay.children).find((c) => c !== marker);
    if (!panel) return undefined;

    const added = [];
    const set = (name, value) => { if (!panel.hasAttribute(name)) { panel.setAttribute(name, value); added.push(name); } };
    set('role', 'dialog');
    set('aria-modal', 'true');
    if (!panel.hasAttribute('aria-label') && !panel.hasAttribute('aria-labelledby')) {
      const heading = panel.querySelector('h1, h2, h3');
      if (heading) {
        if (!heading.id) { heading.id = `dialog-guard-title-${++guardCount}`; added.push('heading-id'); }
        panel.setAttribute('aria-labelledby', heading.id);
        added.push('aria-labelledby');
      } else {
        panel.setAttribute('aria-label', 'Dialog');
        added.push('aria-label');
      }
    }

    // "Escape" = a click on the dim background, which is what the page's own close handler already listens for.
    const clickBackdrop = () => {
      for (const type of ['mousedown', 'mouseup', 'click']) overlay.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    };
    const detach = attachDialogBehavior(panel, { onEscape: clickBackdrop, swallowEscape: false, opener: openerRef.current });

    return () => {
      detach();
      for (const name of added) {
        if (name === 'heading-id') continue;
        panel.removeAttribute(name);
      }
    };
  }, []);

  return <span ref={markerRef} hidden aria-hidden="true" />;
}
