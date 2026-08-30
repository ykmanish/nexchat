import { create } from 'zustand';

/** Transient UI state: toasts and whichever bottom sheet is open. */
export const useUI = create((set, get) => ({
  toasts: [],
  sheet: null,

  push(kind, message) {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));

    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, kind === 'error' ? 4200 : 2600);

    return id;
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  openSheet: (name, props = {}) => set({ sheet: { name, props } }),
  closeSheet: () => set({ sheet: null }),
}));

/** Callable from non-React code — the stores reach for this on failure. */
export const toast = {
  success: (message) => useUI.getState().push('success', message),
  error: (message) => useUI.getState().push('error', message),
  info: (message) => useUI.getState().push('info', message),
};
