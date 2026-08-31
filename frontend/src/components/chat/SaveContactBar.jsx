'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { UserPlus, Ban, UserCheck } from 'lucide-react';
import { useChat } from '@/store/chat';
import { useUI, toast } from '@/store/ui';
import { api } from '@/lib/api';
import { feedback } from '@/lib/sound';

/**
 * The bar above the composer in a direct chat with someone who is not saved.
 *
 * The gap it fills: a contact is one-directional here, so a stranger can open a
 * conversation with you and there was no way to keep them. You could reply, but
 * the person never entered your address book, never appeared in New chat, and
 * the next time you wanted them you had to go hunting through the list for the
 * thread. "Save" has to be offered at the moment it is obvious — which is the
 * chat itself, not a separate New contact screen where you would have to retype
 * an email you were never told.
 *
 * It sits above the composer rather than at the top of the timeline for a
 * practical reason: on a phone, the top of a busy thread is scrolled off screen
 * within a message or two, and an affordance you have to scroll up to find is
 * one nobody uses. It is also not a modal — a stranger messaging you is usually
 * just a stranger messaging you, and demanding a decision before you can reply
 * would be worse than the problem.
 *
 * Dismiss is per-chat and lasts the session. Somebody who has decided not to
 * save this person should not be asked again on every message, and persisting
 * that choice to disk would mean a "no" made by mistake is permanent.
 */
const dismissed = new Set();

export function SaveContactBar({ conversation }) {
  const saveContact = useChat((s) => s.saveContact);
  const removeConversation = useChat((s) => s.removeConversation);
  const openSheet = useUI((s) => s.openSheet);

  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => dismissed.has(conversation?._id));

  const peer = conversation?.peer;
  const show =
    conversation?.type === 'direct' && !!peer && !conversation.peerIsContact && !hidden;

  if (!show) return null;

  async function save() {
    setBusy(true);
    try {
      await saveContact(peer._id, { name: peer.name });
      feedback('success');
      // No need to hide it by hand — `peerIsContact` flipping removes the bar.
    } catch (err) {
      toast.error(err.message || 'Could not save that contact');
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    setBusy(true);
    try {
      await api.post('/users/block/' + peer._id);
      removeConversation(conversation._id);
      toast.success(peer.name + ' is blocked');
    } catch (err) {
      toast.error(err.message || 'Could not block that person');
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
      className="relative z-[2] shrink-0 border-t border-line bg-surface px-3 py-2.5 sm:px-4"
    >
      <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-2">
        {/* Its own line on a phone. `flex-1` beside three shrink-0 buttons
            left this about one word wide on a 375px screen, so the sentence
            wrapped a word at a time down the side of them. */}
        <span className="w-full min-w-0 text-[13px] leading-snug text-ink-muted sm:mr-auto sm:w-auto sm:flex-1">
          <span className="font-medium text-ink">{peer.name}</span> is not in your contacts.
        </span>

        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-brand-ink transition-opacity disabled:opacity-60"
        >
          {busy ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-ink/30 border-t-brand-ink" />
          ) : (
            <UserPlus size={14} strokeWidth={2.4} />
          )}
          Save contact
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            feedback('select');
            openSheet('reportScam', { conversation });
          }}
          className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted transition-colors hover:bg-surface-3"
        >
          Report
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={block}
          aria-label={'Block ' + peer.name}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-danger transition-colors hover:bg-danger/10"
        >
          <Ban size={15} />
        </button>

        <button
          type="button"
          onClick={() => {
            feedback('tap');
            dismissed.add(conversation._id);
            setHidden(true);
          }}
          className="shrink-0 rounded-full px-2.5 py-1.5 text-[12.5px] font-medium text-ink-faint transition-colors hover:bg-surface-2"
        >
          Not now
        </button>
      </div>
    </motion.div>
  );
}

/**
 * The same action as a menu row, for the chat header and the info sheet.
 *
 * Kept here so the two places that offer it cannot drift apart in what they
 * actually do — and so "Not now" on the bar does not also hide it from the menu,
 * which is where somebody who changes their mind will look.
 */
export function saveContactMenuItem(conversation) {
  const peer = conversation?.peer;
  if (conversation?.type !== 'direct' || !peer) return null;

  if (conversation.peerIsContact) {
    return {
      label: 'Remove from contacts',
      icon: UserCheck,
      onClick: async () => {
        try {
          await useChat.getState().removeContact(peer._id);
          toast.success(peer.name + ' removed from contacts');
        } catch (err) {
          toast.error(err.message || 'Could not remove that contact');
        }
      },
    };
  }

  return {
    label: 'Add to contacts',
    icon: UserPlus,
    onClick: async () => {
      try {
        await useChat.getState().saveContact(peer._id, { name: peer.name });
        feedback('success');
      } catch (err) {
        toast.error(err.message || 'Could not save that contact');
      }
    },
  };
}
