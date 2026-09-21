import { create } from 'zustand';

let _id = 0;

const useToastStore = create((set) => ({
  toasts: [],
  // `action` (optional): { label, href } — renders a clickable link inside
  // the toast (e.g. "Log outcome in CRM" -> that client's Activity box).
  // Longer duration when an action is present so there's time to click it.
  addToast: (message, type = 'success', duration, action) => {
    const id = ++_id;
    const finalDuration = duration ?? (action ? 8000 : 3500);
    set(s => ({ toasts: [...s.toasts, { id, message, type, action }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), finalDuration);
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export default useToastStore;
