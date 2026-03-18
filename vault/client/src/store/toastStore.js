import { create } from 'zustand';

let _id = 0;

const useToastStore = create((set) => ({
  toasts: [],
  addToast: (message, type = 'success', duration = 3500) => {
    const id = ++_id;
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), duration);
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export default useToastStore;
