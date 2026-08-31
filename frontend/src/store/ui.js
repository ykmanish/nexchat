'use client';

import { create } from 'zustand';
import { feedback } from '@/lib/sound';

let toastId = 0;

export const useUI = create((set, get) => ({
  /* ─── transient surfaces ─── */
  sheet: null, // { type, props }
  modal: null,
  lightbox: null, // { items, index }
  toasts: [],
  contextMenu: null, // { message, x, y, isMine }

  /* ─── composer state shared across components ─── */
  replyTo: null,
  /** Root message id of the open reply panel, or null. */
  repliesFor: null,
  editing: null,
  selection: [], // multi-select message ids
  forwarding: null,

  /* ─── in-thread search ─── */
  search: { open: false, query: '', hits: [], index: 0 },

  /* ─── calls ─── */
  call: null, // { callId, mode, peer, direction, status }

  /** A one-shot flourish over the whole app — see MessageEffects. */
  effect: null, // { id, at }

  openSheet(type, props = {}) {
    feedback('open');
    set({ sheet: { type, props } });
  },
  closeSheet() {
    if (get().sheet) feedback('close');
    set({ sheet: null });
  },

  openModal(type, props = {}) {
    feedback('open');
    set({ modal: { type, props } });
  },
  closeModal() {
    if (get().modal) feedback('close');
    set({ modal: null });
  },

  openLightbox(items, index = 0) {
    set({ lightbox: { items, index } });
  },
  closeLightbox: () => set({ lightbox: null }),

  openContextMenu(payload) {
    feedback('select');
    set({ contextMenu: payload });
  },
  closeContextMenu: () => set({ contextMenu: null }),

  setReplyTo: (message) => set({ replyTo: message, editing: null }),
  /* The panel has its own composer, so any half-written reply or edit in the
     conversation's composer is cleared — otherwise the banner stays up behind
     a panel that cannot act on it. */
  openReplies: (rootId) => set({ repliesFor: rootId, replyTo: null, editing: null }),
  closeReplies: () => set({ repliesFor: null }),
  setEditing: (message) => set({ editing: message, replyTo: null }),
  clearComposerState: () => set({ replyTo: null, editing: null }),

  toggleSelection(messageId) {
    set((s) => ({
      selection: s.selection.includes(messageId)
        ? s.selection.filter((id) => id !== messageId)
        : [...s.selection, messageId],
    }));
  },
  clearSelection: () => set({ selection: [] }),

  setForwarding: (messages) => set({ forwarding: messages }),

  openSearch() {
    feedback('open');
    set({ search: { open: true, query: '', hits: [], index: 0 } });
  },
  closeSearch() {
    set({ search: { open: false, query: '', hits: [], index: 0 } });
  },
  setSearchQuery(query) {
    set((s) => ({ search: { ...s.search, query, index: 0 } }));
  },
  setSearchHits(hits) {
    set((s) => ({ search: { ...s.search, hits } }));
  },
  stepSearch(delta) {
    set((s) => {
      const total = s.search.hits.length;
      if (!total) return {};
      const next = (s.search.index + delta + total) % total;
      return { search: { ...s.search, index: next } };
    });
  },

  setCall: (call) => set({ call }),
  endCall: () => set({ call: null }),

  /**
   * Fires a message effect.
   *
   * `at` is a timestamp rather than a bare id so two birthday messages in a row
   * are two separate effects: without it the state would not change on the
   * second, and the animation would simply not play.
   */
  playEffect(id) {
    if (id) set({ effect: { id, at: Date.now() } });
  },
  clearEffect: () => set({ effect: null }),

  /* ─── toasts ─── */
  toast(message, { type = 'info', duration = 3200, action } = {}) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, type, action }] }));

    if (type === 'error') feedback('error');
    else if (type === 'success') feedback('success');

    if (duration) setTimeout(() => get().dismissToast(id), duration);
    return id;
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  success: (m, o) => useUI.getState().toast(m, { ...o, type: 'success' }),
  error: (m, o) => useUI.getState().toast(m, { ...o, type: 'error' }),
  info: (m, o) => useUI.getState().toast(m, { ...o, type: 'info' }),
};
