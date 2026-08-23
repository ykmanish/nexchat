'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CornerUpLeft,
  Copy,
  Forward,
  Trash2,
  Pencil,
  Star,
  Pin,
  CheckSquare,
  Plus,
  Info,
} from 'lucide-react';
import { useUI, toast } from '@/store/ui';
import { useChat } from '@/store/chat';
import { cn } from '@/lib/utils';
import { feedback } from '@/lib/sound';
import { ChoiceDialog } from '@/components/ui/Sheet';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const MENU_W = 216;
const REACTIONS_H = 56;
const PAD = 10;

/**
 * Long-press / right-click menu. It anchors to the touch point, flips when it
 * would run off the bottom, and grows from the corner nearest the finger so the
 * motion reads as coming *from* the message.
 */
export function MessageActions({ conversation }) {
  const contextMenu = useUI((s) => s.contextMenu);
  const closeContextMenu = useUI((s) => s.closeContextMenu);
  const setReplyTo = useUI((s) => s.setReplyTo);
  const setEditing = useUI((s) => s.setEditing);
  const setForwarding = useUI((s) => s.setForwarding);
  const toggleSelection = useUI((s) => s.toggleSelection);
  const openSheet = useUI((s) => s.openSheet);

  const toggleReaction = useChat((s) => s.toggleReaction);
  const toggleStar = useChat((s) => s.toggleStar);
  const deleteMessage = useChat((s) => s.deleteMessage);
  const plain = useChat((s) => s.plain);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, origin: 'top left' });
  const menuRef = useRef(null);

  const message = contextMenu?.message;
  const isMine = contextMenu?.isMine;

  useEffect(() => {
    if (!contextMenu) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const actionCount = 9;
    const menuH = actionCount * 42 + REACTIONS_H + 24;

    let left = contextMenu.x - MENU_W / 2;
    left = Math.max(PAD, Math.min(left, vw - MENU_W - PAD));

    const flipUp = contextMenu.y + menuH + PAD > vh;
    const top = flipUp
      ? Math.max(PAD, contextMenu.y - menuH)
      : Math.min(contextMenu.y - REACTIONS_H, vh - menuH - PAD);

    const originX = contextMenu.x - left < MENU_W / 2 ? 'left' : 'right';
    setPos({
      top: Math.max(PAD, top),
      left,
      origin: (flipUp ? 'bottom ' : 'top ') + originX,
    });
  }, [contextMenu]);

  /* Dismissal lives on the document rather than on the scrim.
     The scrim is a framer-motion element, so its React handler is wrapped and
     does not reliably receive a plain pointer event; and because a long-press
     opens this menu while the finger is still down, the scrim mounts under
     that finger and the release would close it instantly. Arming on the first
     pointerup consumes the gesture that opened the menu, so only a genuine
     new press outside the panel dismisses it. */
  useEffect(() => {
    if (!contextMenu) return undefined;

    let armed = false;
    const arm = () => {
      armed = true;
    };
    const onDown = (e) => {
      if (!armed) return;
      if (menuRef.current?.contains(e.target)) return;
      closeContextMenu();
    };

    document.addEventListener('pointerup', arm, { once: true, capture: true });
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerup', arm, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [contextMenu, closeContextMenu]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onKey = (e) => e.key === 'Escape' && closeContextMenu();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [contextMenu, closeContextMenu]);

  if (typeof document === 'undefined') return null;

  const editable =
    isMine &&
    !message?.deletedForEveryone &&
    message?.type === 'text' &&
    Date.now() - new Date(message?.createdAt).getTime() < 15 * 60_000;

  const actions = [
    {
      label: 'Message info',
      icon: Info,
      hidden: !isMine || message?.pending,
      onClick: () => openSheet('messageInfo', { message, conversation }),
    },
    { label: 'Reply', icon: CornerUpLeft, onClick: () => setReplyTo(message) },
    {
      label: 'Copy',
      icon: Copy,
      hidden: !plain[message?._id]?.text,
      onClick: async () => {
        await navigator.clipboard.writeText(plain[message._id]?.text || '');
        toast.success('Copied');
      },
    },
    { label: 'Forward', icon: Forward, onClick: () => setForwarding([message]) },
    {
      label: message?.starred ? 'Unstar' : 'Star',
      icon: Star,
      onClick: () => toggleStar(message),
    },
    {
      label: message?.pinned ? 'Unpin' : 'Pin',
      icon: Pin,
      hidden: conversation?.type !== 'direct' && !conversation?.isAdmin,
      onClick: async () => {
        const { api } = await import('@/lib/api');
        await api.post('/messages/' + message._id + '/pin');
      },
    },
    { label: 'Edit', icon: Pencil, hidden: !editable, onClick: () => setEditing(message) },
    { label: 'Select', icon: CheckSquare, onClick: () => toggleSelection(message._id) },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirmDelete(true) },
  ].filter((a) => !a.hidden);

  /* Deleting for everyone is only offered while it can still be honoured. */
  const withinRecall =
    isMine && Date.now() - new Date(message?.createdAt).getTime() < 2 * 60 * 60_000;

  const deleteChoices = [
    {
      label: 'Delete for me',
      sublabel: 'Removed from this device only',
      danger: true,
      onClick: () => runDelete('me'),
    },
    ...(withinRecall
      ? [
          {
            label: 'Delete for everyone',
            sublabel: 'Removed from every device in this chat',
            danger: true,
            onClick: () => runDelete('everyone'),
          },
        ]
      : []),
  ];

  async function runDelete(scope) {
    setDeleting(true);
    try {
      await deleteMessage(message, scope);
      toast.success(scope === 'everyone' ? 'Deleted for everyone' : 'Message deleted');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
      closeContextMenu();
    }
  }

  return createPortal(
    <>
      <AnimatePresence>
        {contextMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              /* Purely visual — dismissal is handled on the document above. */
              onContextMenu={(e) => {
                e.preventDefault();
                closeContextMenu();
              }}
              className="fixed inset-0 z-[90] bg-black/45"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', damping: 22, stiffness: 420, mass: 0.6 }}
              ref={menuRef}
              style={{ top: pos.top, left: pos.left, transformOrigin: pos.origin }}
              className="fixed z-[95]"
            >
              {/* reaction strip */}
              {!message?.deletedForEveryone && (
                <div
                  className="mb-2 flex items-center gap-0.5 rounded-full bg-surface-raised p-1.5 shadow-pop"
                  style={{ width: MENU_W }}
                >
                  {QUICK_REACTIONS.map((emoji, i) => (
                    <motion.button
                      key={emoji}
                      type="button"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{
                        delay: 0.02 + i * 0.028,
                        type: 'spring',
                        damping: 11,
                        stiffness: 420,
                      }}
                      whileHover={{ scale: 1.25, y: -2 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        toggleReaction(message, emoji);
                        closeContextMenu();
                      }}
                      className="grid h-8 flex-1 place-items-center rounded-full text-[19px] leading-none transition-colors hover:bg-surface-2"
                    >
                      {emoji}
                    </motion.button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      closeContextMenu();
                      openSheet('emojiPicker', { message });
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2"
                    aria-label="More reactions"
                  >
                    <Plus size={16} strokeWidth={2.4} />
                  </button>
                </div>
              )}

              {/* action list */}
              <div
                className="overflow-hidden rounded-xl bg-surface-raised py-1 shadow-pop"
                style={{ width: MENU_W }}
              >
                {actions.map((action, i) => (
                  <motion.button
                    key={action.label}
                    type="button"
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.03 + i * 0.018 }}
                    onClick={() => {
                      feedback('tap');
                      if (action.label !== 'Delete') closeContextMenu();
                      action.onClick();
                    }}
                    className={cn(
                      'flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors',
                      'hover:bg-surface-2 active:bg-surface-3',
                      action.danger && 'text-danger'
                    )}
                  >
                    <span className="text-[14.5px]">{action.label}</span>
                    <action.icon size={16} strokeWidth={1.9} className="opacity-60" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ChoiceDialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          closeContextMenu();
        }}
        title="Delete message?"
        message={
          withinRecall
            ? 'Deleting for everyone removes it from all devices in this chat.'
            : 'This removes the message from your device only.'
        }
        choices={deleteChoices}
        loading={deleting}
      />
    </>,
    document.body
  );
}
