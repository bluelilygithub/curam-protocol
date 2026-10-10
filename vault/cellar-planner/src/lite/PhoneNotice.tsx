import { useEffect, useState } from 'react';
import { telHref } from './config';

// A note at the top of the public planner on a phone-sized screen: it is made for a desktop computer or a tablet, so the person knows before they
// struggle with it. It never blocks them (Continue hides it for the rest of the visit) and offers the owner's phone number when there is one.
// "Phone-sized" is the same width the layout already treats as a phone (700 px), so a narrow desktop window sees it too and can dismiss it.

export const PHONE_QUERY = '(max-width: 700px)';
export const PHONE_NOTICE_KEY = 'cellar-lite:phone-notice:v1';

/** True while the screen is phone-sized, following rotation and resizing. */
export function usePhoneWidth(): boolean {
  const get = (): boolean => { try { return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches; } catch { return false; } };
  const [phone, setPhone] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = (): void => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

const wasDismissed = (): boolean => { try { return sessionStorage.getItem(PHONE_NOTICE_KEY) === '1'; } catch { return false; } };

export function PhoneNotice({ show, text, phone, onCall }: { show: boolean; text: string; phone: string; onCall?: () => void }) {
  const small = usePhoneWidth();
  const [gone, setGone] = useState(wasDismissed);
  if (!show || !small || gone) return null;
  const dismiss = (): void => { try { sessionStorage.setItem(PHONE_NOTICE_KEY, '1'); } catch { /* not remembered: it simply shows again next time */ } setGone(true); };
  return (
    <section className="lite-phone-notice" role="note" aria-label="Best on a larger screen" data-testid="lite-phone-notice">
      <p><strong>Best on a computer or tablet.</strong> <span data-testid="lite-phone-notice-text">{text}</span></p>
      <div className="lite-phone-notice-actions">
        <button type="button" className="btn primary" onClick={dismiss} title="Hide this note and carry on using the planner on this phone." data-testid="lite-phone-continue">Continue on this phone</button>
        {phone && <a className="lite-call" href={telHref(phone)} onClick={onCall} title="Rather talk to someone? Tap to call." data-testid="lite-phone-call">Call us instead</a>}
      </div>
    </section>
  );
}
